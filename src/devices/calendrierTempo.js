// -----------------------------------------------------------------------------
// L'appareil « Calendrier Tempo EDF » et ses fonctionnalités.
//
// Un seul appareil, proposé dans l'onglet « Découverte » de Gladys : c'est
// l'utilisateur qui le crée en un clic. Les couleurs sont des fonctionnalités
// texte (`bleu`, `blanc`, `rouge`, `inconnue`), les compteurs des
// `counter-sensor` entiers, les prix du kWh des `currency` décimaux en euros
// (catégorie « Devise » de Gladys) : utilisables au tableau de bord et dans
// les scènes.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { FORECAST_OFFSETS, INDICATIVE_OFFSETS, NAME } from '../constants.js';
import {
  COLOR_BLANC,
  COLOR_ROUGE,
  COLOR_UNKNOWN,
  countColor,
  dayForOffset,
  nextDayOfColor,
  officialColor,
  periodFor,
  tempoDay,
} from '../tempo.js';
import { currentPrice } from '../tariffs.js';
import { parisParts } from '../time.js';

const DEVICE_TYPE = 'calendrier-tempo';
// Identifiant stable de l'unique appareil (la source : l'API du site).
const PLATFORM_ID = 'calendrier-tempo-fr';

// Valeur d'une date absente de l'horizon (« Prochain jour rouge »).
export const NO_DATE = 'aucun';

// Clés des fonctionnalités : définitives (les scènes les référencent).
export const FEATURE = Object.freeze({
  TODAY: 'couleur-aujourd-hui',
  CURRENT: 'couleur-actuelle',
  PERIOD: 'periode',
  PRICE: 'prix-actuel',
  DAY_PEAK_PRICE: 'prix-hp-du-jour',
  DAY_OFF_PEAK_PRICE: 'prix-hc-du-jour',
  TOMORROW: 'couleur-demain',
  forecast: (offset) => `prevision-j${offset}`,
  RED_15_DAYS: 'jours-rouges-15-jours',
  NEXT_RED: 'prochain-jour-rouge',
  NEXT_WHITE: 'prochain-jour-blanc',
  RED_LEFT: 'jours-rouges-restants',
  WHITE_LEFT: 'jours-blancs-restants',
});

function textFeature(ids, key, name) {
  return {
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    read_only: true,
    has_feedback: false,
    keep_history: false,
    min: 0,
    max: 0,
  };
}

function counterFeature(ids, key, name, max) {
  return {
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max,
  };
}

// Prix du kWh en euros TTC (Gladys n'a pas d'unité « €/kWh » : l'unité est
// l'euro, le nom dit « par kWh »). Gardé en historique pour les graphiques.
function priceFeature(ids, key, name) {
  return {
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.CURRENCY,
    type: DEVICE_FEATURE_TYPES.CURRENCY.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.EURO,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: 10,
  };
}

/** Prévisions publiées une à une : J+2 à J+5, et J+6 à J+15 si l'option est active. */
export function forecastOffsets(config) {
  return config.previsions_indicatives
    ? [...FORECAST_OFFSETS, ...INDICATIVE_OFFSETS]
    : [...FORECAST_OFFSETS];
}

export const calendrierTempo = {
  key: DEVICE_TYPE,

  deviceExternalId(gladys) {
    return gladys.externalIds(DEVICE_TYPE, PLATFORM_ID).device;
  },

  featureExternalId(gladys, key) {
    return gladys.externalIds(DEVICE_TYPE, PLATFORM_ID).feature(key);
  },

  buildDevice(gladys, config) {
    const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_ID);
    return {
      name: NAME,
      external_id: ids.device,
      features: [
        textFeature(ids, FEATURE.TODAY, "Aujourd'hui (officielle)"),
        textFeature(ids, FEATURE.CURRENT, 'Couleur actuelle'),
        textFeature(ids, FEATURE.PERIOD, 'Période tarifaire'),
        priceFeature(ids, FEATURE.PRICE, 'Prix actuel du kWh'),
        priceFeature(ids, FEATURE.DAY_PEAK_PRICE, 'Prix HP du jour'),
        priceFeature(ids, FEATURE.DAY_OFF_PEAK_PRICE, 'Prix HC du jour'),
        textFeature(ids, FEATURE.TOMORROW, 'Demain (officielle)'),
        ...forecastOffsets(config).map((offset) =>
          textFeature(
            ids,
            FEATURE.forecast(offset),
            offset <= 5 ? `Prévision J+${offset}` : `Prévision J+${offset} (indicative)`,
          ),
        ),
        counterFeature(ids, FEATURE.RED_15_DAYS, 'Jours rouges sur 15 jours', 16),
        textFeature(ids, FEATURE.NEXT_RED, 'Prochain jour rouge'),
        textFeature(ids, FEATURE.NEXT_WHITE, 'Prochain jour blanc'),
        counterFeature(ids, FEATURE.RED_LEFT, 'Jours rouges restants', 22),
        counterFeature(ids, FEATURE.WHITE_LEFT, 'Jours blancs restants', 43),
      ],
    };
  },

  /**
   * États à publier pour les données lues et l'heure donnée. Une couleur
   * inconnue est publiée « inconnue » (jamais l'ancienne valeur) ; un compteur
   * ou un prix inconnu n'est pas publié (Gladys garde la dernière valeur, datée).
   * @param {object|null} data - TempoData, ou null si aucune lecture réussie
   */
  buildStates(gladys, data, now, config) {
    const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_ID);
    const paris = parisParts(now);
    const text = (key, value) => ({ device_feature_external_id: ids.feature(key), text: value });
    const number = (key, value) => ({ device_feature_external_id: ids.feature(key), state: value });
    // La période ne dépend que de l'heure : toujours publiée.
    const states = [text(FEATURE.PERIOD, periodFor(paris.hour))];
    if (!data) {
      // Aucune donnée valable pour aujourd'hui : couleurs « inconnue », jamais
      // une couleur d'un autre jour. Les compteurs gardent leur dernière valeur.
      const colorKeys = [FEATURE.TODAY, FEATURE.CURRENT, FEATURE.TOMORROW];
      for (const key of [...colorKeys, ...forecastOffsets(config).map(FEATURE.forecast)]) {
        states.push(text(key, COLOR_UNKNOWN));
      }
      return states;
    }
    const nextOf = (color) => nextDayOfColor(data, color)?.date ?? NO_DATE;
    states.push(
      text(FEATURE.TODAY, data.today.color ?? COLOR_UNKNOWN),
      text(FEATURE.CURRENT, officialColor(data, tempoDay(paris.date, paris.hour)) ?? COLOR_UNKNOWN),
      text(FEATURE.TOMORROW, data.tomorrow.color ?? COLOR_UNKNOWN),
      ...forecastOffsets(config).map((offset) =>
        text(FEATURE.forecast(offset), dayForOffset(data, offset)?.color ?? COLOR_UNKNOWN),
      ),
    );
    const red15 = countColor(data, COLOR_ROUGE);
    if (red15 !== null) {
      states.push(
        number(FEATURE.RED_15_DAYS, red15),
        text(FEATURE.NEXT_RED, nextOf(COLOR_ROUGE)),
        text(FEATURE.NEXT_WHITE, nextOf(COLOR_BLANC)),
      );
    }
    if (data.remaining.rouge !== null) {
      states.push(number(FEATURE.RED_LEFT, data.remaining.rouge));
    }
    if (data.remaining.blanc !== null) {
      states.push(number(FEATURE.WHITE_LEFT, data.remaining.blanc));
    }
    // Prix de la journée Tempo en cours (celle de la veille avant 6 h).
    const price = currentPrice(data, now);
    if (price.price !== null) {
      states.push(
        number(FEATURE.PRICE, price.price),
        number(FEATURE.DAY_PEAK_PRICE, price.hp),
        number(FEATURE.DAY_OFF_PEAK_PRICE, price.hc),
      );
    }
    return states;
  },
};
