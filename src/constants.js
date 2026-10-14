// -----------------------------------------------------------------------------
// Constantes de l'intégration Calendrier Tempo EDF.
//
// Mêmes choix que le composant Home Assistant du projet : mêmes endpoints, même
// rythme (30 min, 0 h 05, 11 h 35 heure de Paris), même relance unique à 5 min,
// mêmes seuils de fiabilité.
// -----------------------------------------------------------------------------

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// La version suit package.json (mise à jour par le workflow Release).
export const VERSION = require('../package.json').version;

export const NAME = 'Calendrier Tempo EDF';

export const SITE_URL = 'https://www.calendrier-tempo.fr/';
export const CALENDAR_URL = 'https://www.calendrier-tempo.fr/calendrier';
export const METHODOLOGY_URL = 'https://www.calendrier-tempo.fr/methodologie';
export const API_BASE_URL = 'https://www.calendrier-tempo.fr/api';

export const ENDPOINTS = Object.freeze({
  TODAY: 'today',
  TOMORROW: 'tomorrow',
  REMAINING: 'remaining',
  PREDICTIONS: 'predictions',
  // Couleur de la veille, lue seulement entre 0 h et 6 h si elle n'est pas déjà connue.
  HISTORY: 'history?days=2',
});

// User-Agent descriptif : le site compte les installations par famille de client.
export const USER_AGENT = `CalendrierTempo-Gladys/${VERSION}`;

export const REQUEST_TIMEOUT_MS = 15_000;

// L'API met ses réponses en cache 2 minutes et la couleur ne change que
// quelques fois par jour : 30 minutes suffisent largement.
export const SCAN_INTERVAL_MS = 30 * 60 * 1000;
// Après un échec ou une réponse incomplète : une seule relance, 5 minutes plus
// tard, puis retour au cycle de 30 minutes (jamais de relance en rafale).
export const RETRY_INTERVAL_MS = 5 * 60 * 1000;
// Prévisions et jours restants conservés pendant une panne de leur endpoint :
// 24 h au plus, pour ne jamais présenter d'anciennes prévisions comme récentes.
export const STALE_PAYLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Décalage aléatoire propre à chaque installation (0 à 120 s), pour étaler les
// appels de toutes les installations sur deux minutes.
export const MAX_JITTER_MS = 120_000;

// Horaires en heure de Paris (celle d'EDF), quel que soit le fuseau du conteneur.
export const TIMEZONE = 'Europe/Paris';
// Changement de jour : 0 h 05, une fois expirés les caches de l'API.
export const DAY_REFRESH = Object.freeze({ hour: 0, minute: 5 });
// Juste après l'annonce par EDF de la couleur du lendemain (vers 11 h).
export const ANNOUNCEMENT_REFRESH = Object.freeze({ hour: 11, minute: 35 });

// Journée Tempo : de 6 h à 6 h le lendemain ; heures pleines de 6 h à 22 h.
export const TEMPO_DAY_START_HOUR = 6;
export const PEAK_END_HOUR = 22;
export const PERIOD_PEAK = 'hp';
export const PERIOD_OFF_PEAK = 'hc';

// Prévisions individuelles. J+2 à J+5 : zone mesurée la plus fiable, toujours
// publiées. J+6 à J+15 : tendance indicative, publiées seulement si l'option
// est activée (Gladys n'a pas d'entité « désactivée par défaut »).
export const FORECAST_OFFSETS = Object.freeze([2, 3, 4, 5]);
export const INDICATIVE_OFFSETS = Object.freeze([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

// Dossier inscriptible du bac à sable Gladys (le seul).
export const DATA_DIR = process.env.CALENDRIER_TEMPO_DATA_DIR || '/data';
