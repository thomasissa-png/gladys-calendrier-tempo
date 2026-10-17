// -----------------------------------------------------------------------------
// Widget de tableau de bord « Prévisions Tempo » (Gladys 5.1+).
//
// Contenu déclaratif, dans le budget d'une carte (8 composants, 1 focal,
// 6 tuiles, 1 liste d'état, 2 textes) :
//   - 4 tuiles : aujourd'hui, demain, rouges restants, blancs restants ;
//   - 1 graphique (focal) : probabilité de rouge d'aujourd'hui à J+15, en %,
//     remplacé par un message court quand il n'aurait rien à montrer ;
//   - 1 liste d'état : prix actuel du kWh (s'il est connu), puis J+2 à J+11
//     (J+10 avec le prix), couleur prévue et sa probabilité ;
//   - 1 légende (source, licence) et 1 bouton vers le calendrier du site.
// Les couleurs du widget sont une énumération de Gladys : bleu → info,
// blanc → neutral, rouge → danger.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { CALENDAR_URL, PERIOD_PEAK } from './constants.js';
import { currentPrice } from './tariffs.js';
import {
  COLOR_BLANC,
  COLOR_BLEU,
  COLOR_ROUGE,
  dayForOffset,
  probability,
  redPossible,
} from './tempo.js';

export const FORECAST_WIDGET = 'previsions_tempo';

// Mise à jour au plus tard toutes les 30 min ; chaque nouvelle lecture
// demande en plus un rafraîchissement immédiat (requestWidgetRefresh).
const TTL_SECONDS = 1800;
const STATUS_OFFSETS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MAX_STATUS_ITEMS = 10;
const PERCENT = 100;
// Une seule marque, pour demain (voir redChart) : deux marques peuvent se chevaucher.
const ANNOTATED_OFFSET = 1;
const ANNOTATION_LABELS = {
  [COLOR_ROUGE]: { en: 'Red', fr: 'Rouge' },
  [COLOR_BLANC]: { en: 'White', fr: 'Blanc' },
};

const COLOR_STYLE = {
  [COLOR_BLEU]: { color: WIDGET_COLORS.INFO, label: { en: 'Blue', fr: 'Bleu' } },
  [COLOR_BLANC]: { color: WIDGET_COLORS.NEUTRAL, label: { en: 'White', fr: 'Blanc' } },
  [COLOR_ROUGE]: { color: WIDGET_COLORS.DANGER, label: { en: 'Red', fr: 'Rouge' } },
};
const UNKNOWN_STYLE = {
  color: WIDGET_COLORS.NEUTRAL,
  label: { en: 'Unknown', fr: 'Inconnue' },
};

const styleOf = (color) => COLOR_STYLE[color] ?? UNKNOWN_STYLE;
const isFrench = (language) => language !== 'en';
const pick = (text, language) => (isFrench(language) ? text.fr : text.en);

// « jeu. 16 » / « Thu 16 », la date ISO étant un jour civil (libellés courts :
// la liste doit tenir sur un téléphone).
function shortDate(isoDate, language) {
  return new Intl.DateTimeFormat(isFrench(language) ? 'fr-FR' : 'en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

function formatPercent(value, language) {
  return isFrench(language) ? `${value} %` : `${value}%`;
}

function colorTile(label, day) {
  const style = styleOf(day.color);
  return { type: 'value', label, value: style.label, color: style.color, icon: 'zap' };
}

// Demain : couleur officielle dès l'annonce d'EDF, sinon la prévision, dite telle.
function tomorrowTile(data) {
  const official = data.tomorrow.color;
  if (official) {
    return colorTile({ en: 'Tomorrow', fr: 'Demain' }, data.tomorrow);
  }
  const forecast = dayForOffset(data, 1);
  return colorTile({ en: 'Tomorrow (forecast)', fr: 'Demain (prévision)' }, forecast ?? {});
}

function counterTile(label, value, color) {
  return { type: 'value', label, value: value ?? '?', color, icon: 'calendar' };
}

function statusItem(day, offset, language) {
  const style = styleOf(day?.color);
  const when = day ? shortDate(day.date, language) : '';
  const trend = offset > 5 ? (isFrench(language) ? ' (tendance)' : ' (trend)') : '';
  const label = `${when} · J+${offset}${trend}`.trim();
  if (!day) {
    return { label, value: pick(UNKNOWN_STYLE.label, language), color: style.color };
  }
  const p = probability(day, day.color);
  const official = day.official ? (isFrench(language) ? ' (officielle)' : ' (official)') : '';
  const value =
    p === null || day.official
      ? `${pick(style.label, language)}${official}`
      : `${pick(style.label, language)} ${formatPercent(Math.round(p * 100), language)}`;
  return { label, value, color: style.color };
}

// Messages à la place du graphique quand il n'aurait rien à montrer.
const NO_RED_BEFORE_NOVEMBER = {
  en: 'No red day possible before 1 November.',
  fr: 'Pas de jour rouge possible avant le 1er novembre.',
};
const NO_FORECAST = {
  en: 'No forecast available at the moment.',
  fr: 'Aucune prévision disponible pour le moment.',
};

const bodyText = (text) => ({ type: 'text', variant: 'body', text });

/**
 * Graphique du risque de rouge, en % sur un axe de 0 à 100 : deux aires par
 * jour, « Bleu ou blanc » (100 - p, 1re couleur de Gladys : bleu) et « Rouge »
 * (p, 2e couleur : rouge).
 * Cause de l'ancienne échelle « 0 à 2 » : les valeurs étaient bien en % (p x 100),
 * mais le contrat des widgets n'a pas de bornes d'axe et Gladys (ApexCharts) cale
 * l'axe sur les données : 0 à 2 quand toutes valent 0 (octobre), 0 à 80 pour un
 * pic à 72 %, 0 à 150 pour un pic à 100 % en barres (une graduation de plus
 * quand le maximum tombe sur une graduation). En courbe, l'axe va du minimum au
 * maximum des séries : avec p et 100 - p, il suffit d'un jour à 0 % ou à 100 %
 * pour avoir exactement 0 à 100. C'est toujours le cas en saison : aujourd'hui
 * est officiel (0 ou 100 %) et 16 jours comptent toujours un week-end (0 %).
 * Quand aucun jour de l'horizon ne peut être rouge (du 1er novembre au 31 mars,
 * hors week-ends et jours fériés : le 17/10, l'horizon finit le dimanche 1er
 * novembre, Toussaint) ou sans aucune probabilité : un message court à la place.
 * Graduations de l'axe : Gladys affiche « 50.00 », sans unité ni format (le
 * contrat des widgets n'a ni format ni suffixe d'axe, `unit` n'y apparaît pas) ;
 * le « % » est donc dans le titre.
 *
 * Une seule marque, sur demain quand sa couleur officielle est rouge ou blanc.
 * REGRESSION KO-2 (recette du 2026-10-17) : jusqu'à 8 marques (rouges prévus,
 * blancs) se chevauchaient à 375 px (un jour y fait environ 15 px, « Rouge
 * prévu » environ 70 px), et celle d'aujourd'hui, posée sur l'axe, mordait sur
 * ses graduations. Les jours prévus restent lisibles sur la courbe et la liste,
 * aujourd'hui et demain dans les tuiles.
 */
function redChart(data) {
  if (data.days.length > 0 && !data.days.some((day) => redPossible(day.date))) {
    return bodyText(NO_RED_BEFORE_NOVEMBER);
  }
  const values = data.days
    .map((day) => ({ t: day.date, p: probability(day, COLOR_ROUGE) }))
    .filter((point) => point.p !== null)
    .map(({ t, p }) => ({ t, red: Math.round(Math.min(Math.max(p, 0), 1) * PERCENT) }));
  if (values.length === 0) {
    return bodyText(NO_FORECAST);
  }
  const redOf = new Map(values.map(({ t, red }) => [t, red]));
  const annotations = data.days
    .filter(
      (day) =>
        day.offset === ANNOTATED_OFFSET &&
        day.official &&
        day.color in ANNOTATION_LABELS &&
        redOf.has(day.date),
    )
    .map((day) => ({
      t: day.date,
      value: redOf.get(day.date),
      label: ANNOTATION_LABELS[day.color],
      color: styleOf(day.color).color,
    }));
  return {
    type: 'chart',
    chart_type: 'area',
    title: { en: 'Chance of red, in % (15 days)', fr: 'Probabilité de rouge, en % (15 jours)' },
    unit: '%',
    series: [
      {
        name: { en: 'Blue or white', fr: 'Bleu ou blanc' },
        points: values.map(({ t, red }) => ({ t, v: PERCENT - red })),
      },
      { name: { en: 'Red', fr: 'Rouge' }, points: values.map(({ t, red }) => ({ t, v: red })) },
    ],
    ...(annotations.length ? { annotations } : {}),
  };
}

// « 0,1654 €/kWh (HP, bleu) » / « €0.1654/kWh (peak, blue) ».
function formatPrice({ price, period, color }, language) {
  const french = isFrench(language);
  const amount = new Intl.NumberFormat(french ? 'fr-FR' : 'en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(price);
  const colorName = pick(styleOf(color).label, language).toLowerCase();
  if (french) {
    return `${amount} €/kWh (${period === PERIOD_PEAK ? 'HP' : 'HC'}, ${colorName})`;
  }
  return `€${amount}/kWh (${period === PERIOD_PEAK ? 'peak' : 'off-peak'}, ${colorName})`;
}

/** Ligne « Prix actuel » de la liste d'état, null si le prix n'est pas connu. */
function priceItem(data, now, language) {
  const current = currentPrice(data, now);
  if (current.price === null) {
    return null;
  }
  return {
    label: isFrench(language) ? 'Prix actuel' : 'Current price',
    value: formatPrice(current, language),
    color: styleOf(current.color).color,
  };
}

const CAPTION = {
  type: 'text',
  variant: 'caption',
  text: {
    en: 'Forecasts by calendrier-tempo.fr (CC BY 4.0)',
    fr: 'Prévisions calendrier-tempo.fr (CC BY 4.0)',
  },
};

const CALENDAR_BUTTON = {
  type: 'button',
  label: { en: 'Full calendar', fr: 'Voir le calendrier' },
  icon: 'external-link',
  style: 'secondary',
  link: { url: CALENDAR_URL },
};

/**
 * Contenu du widget pour les dernières données (null : aucune lecture réussie).
 * @param {object|null} data
 * @param {string} language - langue de l'utilisateur qui regarde ('fr', 'en'...)
 * @param {number} now - instant de l'affichage (prix HP/HC en cours)
 */
export function buildForecastWidget(data, language = 'fr', now = Date.now()) {
  if (!data) {
    return {
      ttl_seconds: 60,
      components: [
        {
          type: 'text',
          variant: 'body',
          text: {
            en: 'Waiting for the first data from calendrier-tempo.fr.',
            fr: 'En attente des premières données de calendrier-tempo.fr.',
          },
        },
        CAPTION,
        CALENDAR_BUTTON,
      ],
    };
  }
  return {
    ttl_seconds: TTL_SECONDS,
    components: [
      colorTile({ en: 'Today', fr: "Aujourd'hui" }, data.today),
      tomorrowTile(data),
      counterTile({ en: 'Red left', fr: 'Rouges' }, data.remaining.rouge, WIDGET_COLORS.DANGER),
      counterTile({ en: 'White left', fr: 'Blancs' }, data.remaining.blanc, WIDGET_COLORS.NEUTRAL),
      redChart(data),
      {
        type: 'status',
        items: [
          priceItem(data, now, language),
          ...STATUS_OFFSETS.map((offset) =>
            statusItem(dayForOffset(data, offset), offset, language),
          ),
        ]
          .filter(Boolean)
          .slice(0, MAX_STATUS_ITEMS),
      },
      CAPTION,
      CALENDAR_BUTTON,
    ],
  };
}

/** Widgets déclarés dans le manifeste, par clé. `getData()` rend les dernières données. */
export function createWidgets(getData, now = () => Date.now()) {
  return {
    [FORECAST_WIDGET]: {
      async get(_gladys, { language }) {
        return buildForecastWidget(getData(), language, now());
      },
    },
  };
}
