// -----------------------------------------------------------------------------
// Prix du kWh Tempo, lus dans la grille publiée par l'API (/api/today, champ
// `tarifs`). Aucun prix n'est écrit en dur : sans grille valable, le prix est
// inconnu (null).
//
// Prix en cours : heures pleines (6 h à 22 h) ou heures creuses (22 h à 6 h) de
// la couleur de la journée Tempo en cours, qui va de 6 h à 6 h : entre 0 h et
// 6 h, c'est encore la journée (et la couleur) de la veille.
// -----------------------------------------------------------------------------

import { PERIOD_OFF_PEAK, PERIOD_PEAK } from './constants.js';
import { COLORS, officialColor, periodFor, tempoDay } from './tempo.js';
import { parseIsoDate, parisParts } from './time.js';

// Unité attendue (« EUR/kWh TTC ») : toute autre unité rend la grille inconnue.
const UNIT_PREFIX = 'EUR/kWh';
// Garde-fou : un prix hors de cet intervalle n'est pas un prix au kWh en euros.
const MAX_PRICE = 10;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const asPrice = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value < MAX_PRICE
    ? value
    : null;

/**
 * Grille `tarifs` d'une réponse /api/today « ok », sinon null.
 * @returns {{ dateEffet: string|null, couleurs: Record<string, {hp: number, hc: number}> }|null}
 */
export function parseTariffs(payload) {
  if (!isPlainObject(payload) || payload.status !== 'ok' || !isPlainObject(payload.tarifs)) {
    return null;
  }
  const { tarifs } = payload;
  if (typeof tarifs.unite !== 'string' || !tarifs.unite.startsWith(UNIT_PREFIX)) {
    return null;
  }
  const source = isPlainObject(tarifs.couleurs) ? tarifs.couleurs : {};
  const couleurs = {};
  for (const color of COLORS) {
    const entry = source[color.toUpperCase()];
    const hp = asPrice(entry?.hp);
    const hc = asPrice(entry?.hc);
    if (hp !== null && hc !== null) {
      couleurs[color] = { [PERIOD_PEAK]: hp, [PERIOD_OFF_PEAK]: hc };
    }
  }
  if (Object.keys(couleurs).length === 0) {
    return null;
  }
  return { dateEffet: parseIsoDate(tarifs.date_effet), couleurs };
}

/**
 * Prix de la journée Tempo `date` pour sa couleur, ou null : grille absente,
 * couleur inconnue, ou journée antérieure à la date d'effet de la grille
 * (l'ancienne grille n'est pas connue).
 */
export function dayPrices(tariffs, date, color) {
  if (!tariffs || !color || (tariffs.dateEffet && date < tariffs.dateEffet)) {
    return null;
  }
  return tariffs.couleurs[color] ?? null;
}

/**
 * Prix du kWh à l'instant `now`, avec la couleur et la période qui le fixent.
 * `color` et `period` sont toujours rendus ; `price`, `hp` et `hc` sont null
 * si le prix n'est pas connu.
 */
export function currentPrice(data, now) {
  const paris = parisParts(now);
  const period = periodFor(paris.hour);
  const date = tempoDay(paris.date, paris.hour);
  const color = data ? officialColor(data, date) : null;
  const prices = data ? dayPrices(data.tariffs, date, color) : null;
  return {
    date,
    color,
    period,
    price: prices ? prices[period] : null,
    hp: prices ? prices[PERIOD_PEAK] : null,
    hc: prices ? prices[PERIOD_OFF_PEAK] : null,
  };
}
