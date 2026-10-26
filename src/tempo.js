// -----------------------------------------------------------------------------
// Lecture des réponses de l'API calendrier-tempo.fr.
//
// Portage du module `parsing.py` du composant Home Assistant : fonctions pures,
// sans SDK, testables seules. Les champs lus sont ceux du composant HA ; le
// texte `message` des réponses n'est jamais lu (il peut changer à tout moment).
// -----------------------------------------------------------------------------

import { PEAK_END_HOUR, PERIOD_OFF_PEAK, PERIOD_PEAK, TEMPO_DAY_START_HOUR } from './constants.js';
import { addDays, daysBetween, parseIsoDate } from './time.js';

// Couleurs publiées (minuscules, stables pour les scènes).
export const COLOR_BLEU = 'bleu';
export const COLOR_BLANC = 'blanc';
export const COLOR_ROUGE = 'rouge';
export const COLORS = Object.freeze([COLOR_BLEU, COLOR_BLANC, COLOR_ROUGE]);
// Valeur d'une couleur pas encore connue (demain avant l'annonce d'EDF, panne).
export const COLOR_UNKNOWN = 'inconnue';

// Fiabilité d'un jour, alignée sur le site (page méthodologie) : couleur publiée
// par EDF, prévision jusqu'à J+5 (J+2 à J+5 = zone mesurée la plus fiable),
// prévision J+6 à J+15 (tendance indicative).
export const FIABILITE_OFFICIELLE = 'officielle';
export const FIABILITE_FIABLE = 'fiable';
export const FIABILITE_INDICATIVE = 'indicative';
export const HORIZON_FIABLE_MAX = 5;

// Origine des jours restants : compteurs EDF, sinon calcul du site.
export const SOURCE_EDF = 'edf';
export const SOURCE_CALCUL = 'calcul';

// Hésitation, même règle que le site (incertitude.py) et le composant Home
// Assistant 0.3.1 : écart entre la probabilité de la couleur prévue et celle de
// la seconde couleur (la plus probable des deux autres) inférieur à 0,30 ET
// seconde couleur au-dessus de 0,15. Jamais pour un jour officiel.
export const HESITATION_ECART = 0.3;
export const HESITATION_SECONDE = 0.15;
// Espace insécable (U+00A0) avant « ? » dans le libellé (typographie du site).
const NBSP = ' ';

// Champs d'incertitude ajoutés à /api/predictions le 2026-10-26 (absents des
// anciennes réponses et des données gardées dans /data avant la 0.3.0).
const UNCERTAINTY_FIELDS = ['hesitation', 'seconde_couleur', 'tendance', 'libelle'];

// Champs d'une prévision repris tels quels, uniquement s'ils existent.
const PREDICTION_ATTRIBUTES = [
  'probabilite_bleu',
  'probabilite_blanc',
  'probabilite_rouge',
  'score_risque',
  'temp_min_prevue',
  'temp_max_prevue',
  'temp_moy_prevue',
  'raison',
  'confirmed',
  ...UNCERTAINTY_FIELDS,
];

export class ApiDataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApiDataError';
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** « BLEU », « Rouge »... → « bleu », « rouge ». null si inconnu. */
export function normalizeColor(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const color = value.trim().toLowerCase();
  return COLORS.includes(color) ? color : null;
}

/** Journée Tempo en cours (date de Paris) : celle de la veille avant 6 h. */
export function tempoDay(parisDate, parisHour) {
  return parisHour < TEMPO_DAY_START_HOUR ? addDays(parisDate, -1) : parisDate;
}

/** Heures pleines de 6 h à 22 h, heures creuses de 22 h à 6 h (heure de Paris). */
export function periodFor(parisHour) {
  return parisHour >= TEMPO_DAY_START_HOUR && parisHour < PEAK_END_HOUR
    ? PERIOD_PEAK
    : PERIOD_OFF_PEAK;
}

// Jours fériés nationaux à date fixe (MM-JJ).
const FIXED_HOLIDAYS = ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'];
// Jours fériés mobiles, en jours après Pâques : lundi de Pâques, Ascension, lundi de Pentecôte.
const EASTER_HOLIDAY_OFFSETS = [1, 39, 50];

/** Dimanche de Pâques (calendrier grégorien, algorithme de Meeus), date ISO. */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Jour férié national en France (métropole), dont les fêtes mobiles liées à Pâques. */
export function isFrenchHoliday(isoDate) {
  if (FIXED_HOLIDAYS.includes(isoDate.slice(5, 10))) {
    return true;
  }
  const easter = easterSunday(Number(isoDate.slice(0, 4)));
  return EASTER_HOLIDAY_OFFSETS.some((offset) => addDays(easter, offset) === isoDate);
}

/**
 * Règles d'EDF : un jour rouge n'est possible que du 1er novembre au 31 mars (R1),
 * jamais un samedi, un dimanche ni un jour férié (R2). Le 1er novembre (Toussaint)
 * n'est donc jamais rouge.
 */
export function redPossible(isoDate) {
  const month = Number(isoDate.slice(5, 7));
  if (month > 3 && month < 11) {
    return false;
  }
  const weekday = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !isFrenchHoliday(isoDate);
}

/** Fiabilité d'un jour selon qu'il est officiel et son éloignement. */
export function fiabiliteFor(offset, official) {
  if (official) {
    return FIABILITE_OFFICIELLE;
  }
  return offset <= HORIZON_FIABLE_MAX ? FIABILITE_FIABLE : FIABILITE_INDICATIVE;
}

function requireObject(payload, endpoint) {
  if (!isPlainObject(payload)) {
    throw new ApiDataError(`Réponse inattendue de /api/${endpoint}`);
  }
  return payload;
}

function asInt(value) {
  return Number.isInteger(value) ? value : null;
}

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** /api/today ou /api/tomorrow. status « unavailable » = couleur inconnue. */
export function parseDay(payload, endpoint = 'today') {
  const data = requireObject(payload, endpoint);
  const date = parseIsoDate(data.date);
  if (data.status !== 'ok') {
    return { date, color: null, code: null };
  }
  return { date, color: normalizeColor(data.couleur), code: asInt(data.code) };
}

function counters(value) {
  const source = isPlainObject(value) ? value : {};
  return [asInt(source.ROUGE), asInt(source.BLANC)];
}

/** /api/remaining : compteurs EDF (`edf_official`) en priorité, calcul du site sinon. */
export function parseRemaining(payload) {
  const empty = { rouge: null, blanc: null, totalRouge: null, totalBlanc: null };
  const data = requireObject(payload, 'remaining');
  if ((data.status ?? 'ok') !== 'ok') {
    return { ...empty, seasonStart: null, seasonEnd: null, source: null };
  }
  const totals = isPlainObject(data.totals) ? data.totals : {};
  let [rouge, blanc] = counters(data.edf_official);
  let source = SOURCE_EDF;
  if (rouge === null || blanc === null) {
    [rouge, blanc] = counters(data.remaining);
    source = SOURCE_CALCUL;
  }
  return {
    rouge,
    blanc,
    totalRouge: asInt(totals.ROUGE),
    totalBlanc: asInt(totals.BLANC),
    seasonStart: parseIsoDate(data.season_start),
    seasonEnd: parseIsoDate(data.season_end),
    source: rouge !== null || blanc !== null ? source : null,
  };
}

/** /api/history : couleurs officielles des derniers jours, { date: couleur }. */
export function parseHistory(payload) {
  const data = requireObject(payload, 'history');
  const colors = {};
  for (const item of Array.isArray(data.history) ? data.history : []) {
    if (!isPlainObject(item)) {
      continue;
    }
    const date = parseIsoDate(item.date);
    const color = normalizeColor(item.couleur_reelle);
    if (date && color) {
      colors[date] = color;
    }
  }
  return colors;
}

/** /api/predictions, triées par date. Ignore les entrées invalides ou simulées. */
export function parsePredictions(payload) {
  const data = requireObject(payload, 'predictions');
  const byDate = new Map();
  for (const item of Array.isArray(data.predictions) ? data.predictions : []) {
    if (!isPlainObject(item) || item.simulated === true) {
      continue;
    }
    const date = parseIsoDate(item.date);
    const color = normalizeColor(item.couleur_predite);
    if (!date || !color || byDate.has(date)) {
      continue;
    }
    const attributes = {};
    for (const key of PREDICTION_ATTRIBUTES) {
      if (key in item) {
        attributes[key] = item[key];
      }
    }
    byDate.set(date, { date, color, attributes });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Probabilité (0 à 1) d'une couleur ; 1 ou 0 pour un jour officiel. */
export function probability(day, color) {
  if (day.official) {
    return color === day.color ? 1 : 0;
  }
  return asNumber(day.attributes[`probabilite_${color}`]);
}

/** Arrondi « demi vers le haut », comme le site : 0,505 → 51, 0,285 → 29 (pas 28). */
export function percent(value) {
  return Math.floor(Number((value * 100).toFixed(9)) + 0.5);
}

/** Écart < 0,30 et seconde > 0,15 (écart arrondi : 0,70 - 0,40 vaut bien 0,30). */
export function hesitates(p1, p2) {
  if (p1 === null || p2 === null) {
    return false;
  }
  return Number((p1 - p2).toFixed(9)) < HESITATION_ECART && p2 > HESITATION_SECONDE;
}

/** Prévision au-delà de J+5 : une tendance (calcul local, toujours à jour). */
export function isTrend(day) {
  return !day.official && day.offset > HORIZON_FIABLE_MAX;
}

// Champs `hesitation` et `seconde_couleur` de l'API : { usable, second }.
function apiSecondColor(day) {
  const flag = day.attributes.hesitation;
  if (typeof flag !== 'boolean') {
    return { usable: false, second: null };
  }
  if (!flag) {
    return { usable: true, second: null };
  }
  const second = normalizeColor(day.attributes.seconde_couleur);
  if (second === null || second === day.color) {
    return { usable: false, second: null };
  }
  return { usable: true, second };
}

/**
 * Seconde couleur en cas d'hésitation, sinon null (jamais pour un jour officiel).
 * Champs `hesitation` et `seconde_couleur` de l'API s'ils sont présents et
 * cohérents, sinon même calcul que le site à partir des probabilités (ancienne
 * réponse, copie de secours, données gardées avant la 0.3.0).
 */
export function secondColor(day) {
  if (day.official) {
    return null;
  }
  const api = apiSecondColor(day);
  if (api.usable) {
    return api.second;
  }
  // À égalité, ordre stable bleu, blanc, rouge (comme le site).
  let best = null;
  for (const color of COLORS) {
    const p = color === day.color ? null : probability(day, color);
    if (p !== null && (best === null || p > best.p)) {
      best = { color, p };
    }
  }
  return best && hesitates(probability(day, day.color), best.p) ? best.color : null;
}

/**
 * Libellé du site, en français : « Blanc » ou « Blanc ou bleu ? », jamais
 * « Tendance » (2026-10-26). Celui de l'API s'il est cohérent (et sans
 * « tendance »), sinon calculé.
 */
export function libelle(day) {
  const label = day.attributes.libelle;
  const trend = day.attributes.tendance;
  if (
    !day.official &&
    typeof label === 'string' &&
    label.trim() &&
    !/tendance/i.test(label) &&
    apiSecondColor(day).usable &&
    (typeof trend !== 'boolean' || trend === isTrend(day))
  ) {
    return label.trim();
  }
  const second = secondColor(day);
  const name = day.color.charAt(0).toUpperCase() + day.color.slice(1);
  return second ? `${name} ou ${second}${NBSP}?` : name;
}

function forecastDay(date, referenceDate, color, official, attributes) {
  const offset = daysBetween(referenceDate, date);
  return { date, offset, color, official, fiabilite: fiabiliteFor(offset, official), attributes };
}

/**
 * Horizon complet à partir de referenceDate, jour par jour. La couleur
 * officielle EDF (/api/today, /api/tomorrow) prime sur la prévision ; une
 * entrée marquée `confirmed` par l'API est aussi officielle.
 */
export function buildForecastDays(predictions, today, tomorrow, referenceDate) {
  const days = new Map();
  for (const p of predictions) {
    if (p.date >= referenceDate) {
      const official = p.attributes.confirmed === true;
      days.set(p.date, forecastDay(p.date, referenceDate, p.color, official, { ...p.attributes }));
    }
  }
  for (const known of [today, tomorrow]) {
    if (known.date && known.color && known.date >= referenceDate) {
      const attributes = { ...(days.get(known.date)?.attributes ?? {}), confirmed: true };
      days.set(known.date, forecastDay(known.date, referenceDate, known.color, true, attributes));
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Assemble les 4 réponses autour de la date du jour à Paris (`currentDate`).
 * Chaque couleur officielle est rangée selon SA date : une réponse en retard
 * (cache juste après minuit, copie de secours) ne fait jamais passer la couleur
 * de la veille pour celle d'aujourd'hui.
 */
export function buildTempoData(
  todayPayload,
  tomorrowPayload,
  remainingPayload,
  predictionsPayload,
  currentDate,
) {
  const parsed = [parseDay(todayPayload, 'today'), parseDay(tomorrowPayload, 'tomorrow')];
  const expected = [currentDate, addDays(currentDate, 1)];
  const stale = parsed.some((d, i) => d.date !== null && d.date !== expected[i]);
  const byDate = new Map(parsed.filter((d) => d.date && d.color).map((d) => [d.date, d]));
  const pick = (date) => byDate.get(date) ?? { date, color: null, code: null };
  const today = pick(currentDate);
  const tomorrow = pick(expected[1]);
  const predictions = parsePredictions(predictionsPayload);
  const generatedAt = isPlainObject(predictionsPayload) ? predictionsPayload.generated_at : null;
  return {
    referenceDate: currentDate,
    today,
    tomorrow,
    // Réponse « aujourd'hui » de la veille (en retard) : couleur d'hier, utile jusqu'à 6 h.
    yesterday: pick(addDays(currentDate, -1)),
    remaining: parseRemaining(remainingPayload),
    days: buildForecastDays(predictions, today, tomorrow, currentDate),
    generatedAt: typeof generatedAt === 'string' && generatedAt ? generatedAt : null,
    stale,
  };
}

/** Couleur officielle connue pour ce jour (hier, aujourd'hui ou demain), sinon null. */
export function officialColor(data, date) {
  const known = [data.today, data.tomorrow, data.yesterday].find((d) => d.date === date && d.color);
  return known ? known.color : null;
}

/** Jour J+offset de l'horizon (couleur officielle prioritaire), sinon null. */
export function dayForOffset(data, offset) {
  return data.days.find((d) => d.offset === offset) ?? null;
}

/** Premier jour de cette couleur (officielle ou prévue) à partir d'aujourd'hui. */
export function nextDayOfColor(data, color) {
  return data.days.find((d) => d.color === color) ?? null;
}

/** Nombre de jours de cette couleur sur l'horizon (aujourd'hui à J+15), null sans horizon. */
export function countColor(data, color) {
  return data.days.length ? data.days.filter((d) => d.color === color).length : null;
}
