// -----------------------------------------------------------------------------
// Widget de tableau de bord « Prévisions Tempo » (Gladys 5.1+).
//
// Contenu déclaratif, dans le budget d'une carte (8 composants, 1 focal,
// 6 tuiles, 1 liste d'état, 2 textes) :
//   - 4 tuiles : aujourd'hui, demain, rouges restants, blancs restants ;
//   - 1 graphique (focal) : probabilité de rouge d'aujourd'hui à J+15 ;
//   - 1 liste d'état : J+2 à J+11, couleur prévue et sa probabilité ;
//   - 1 légende (source, licence) et 1 bouton vers le calendrier du site.
// Les couleurs du widget sont une énumération de Gladys : bleu → info,
// blanc → neutral, rouge → danger.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { CALENDAR_URL } from './constants.js';
import { COLOR_BLANC, COLOR_BLEU, COLOR_ROUGE, dayForOffset, probability } from './tempo.js';

export const FORECAST_WIDGET = 'previsions_tempo';

// Mise à jour au plus tard toutes les 30 min ; chaque nouvelle lecture
// demande en plus un rafraîchissement immédiat (requestWidgetRefresh).
const TTL_SECONDS = 1800;
const STATUS_OFFSETS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MAX_ANNOTATIONS = 8;
const ANNOTATION_LABELS = {
  [COLOR_ROUGE]: {
    official: { en: 'Red', fr: 'Rouge' },
    forecast: { en: 'Red forecast', fr: 'Rouge prévu' },
  },
  [COLOR_BLANC]: {
    official: { en: 'White', fr: 'Blanc' },
    forecast: { en: 'White forecast', fr: 'Blanc prévu' },
  },
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

function redChart(data) {
  const points = data.days
    .map((day) => ({ t: day.date, v: probability(day, COLOR_ROUGE) }))
    .filter((point) => point.v !== null)
    .map((point) => ({ t: point.t, v: Math.round(point.v * 100) }));
  // Jours rouges d'abord, puis blancs (8 marques au plus).
  const marked = [COLOR_ROUGE, COLOR_BLANC].flatMap((color) =>
    data.days.filter((day) => day.color === color),
  );
  const annotations = marked.slice(0, MAX_ANNOTATIONS).map((day) => ({
    t: day.date,
    value: Math.round((probability(day, COLOR_ROUGE) ?? 0) * 100),
    label: ANNOTATION_LABELS[day.color][day.official ? 'official' : 'forecast'],
    color: styleOf(day.color).color,
  }));
  return {
    type: 'chart',
    chart_type: 'bar',
    title: { en: 'Chance of a red day (15 days)', fr: 'Probabilité de jour rouge (15 jours)' },
    unit: '%',
    series: [{ name: { en: 'Red', fr: 'Rouge' }, points }],
    ...(annotations.length ? { annotations } : {}),
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
 */
export function buildForecastWidget(data, language = 'fr') {
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
        items: STATUS_OFFSETS.map((offset) =>
          statusItem(dayForOffset(data, offset), offset, language),
        ),
      },
      CAPTION,
      CALENDAR_BUTTON,
    ],
  };
}

/** Widgets déclarés dans le manifeste, par clé. `getData()` rend les dernières données. */
export function createWidgets(getData) {
  return {
    [FORECAST_WIDGET]: {
      async get(_gladys, { language }) {
        return buildForecastWidget(getData(), language);
      },
    },
  };
}
