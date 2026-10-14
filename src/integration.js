// -----------------------------------------------------------------------------
// Cœur de l'intégration : lecture de l'API, rythme, publication dans Gladys.
//
// Même logique que le coordinateur du composant Home Assistant :
//   - /api/today et /api/tomorrow indispensables, lus l'un après l'autre ;
//   - /api/remaining et /api/predictions facultatifs : dernière réponse valide
//     gardée 24 h au plus ;
//   - /api/history?days=2 seulement entre 0 h et 6 h, si la couleur de la veille
//     n'est pas déjà connue (journée Tempo de 6 h à 6 h) ;
//   - toutes les 30 min, plus 0 h 05 et 11 h 35 heure de Paris ; après un échec,
//     une seule relance 5 min plus tard, puis retour au cycle.
// En plus : décalage aléatoire de 0 à 120 s propre à l'installation sur les
// rendez-vous fixes, et minuit / 6 h / 22 h recalculés sans appel à l'API.
//
// Publication dans Gladys : rien avant la fin de la première lecture (jamais de
// passage à « inconnue » au redémarrage) ; une couleur n'est envoyée que si elle
// diffère de la valeur que Gladys a déjà (sinon les scènes « égal à » sans
// option de seuil repartiraient) ; les compteurs, eux, sont republiés toutes
// les 30 min pour rester datés. Si l'API ne répond pas, les couleurs officielles
// déjà lues (gardées dans /data) restent valables pour leur date.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { createApiClient, TempoApiError } from './api.js';
import {
  ANNOUNCEMENT_REFRESH,
  DATA_DIR,
  DAY_REFRESH,
  ENDPOINTS,
  MAX_JITTER_MS,
  PEAK_END_HOUR,
  RETRY_INTERVAL_MS,
  SCAN_INTERVAL_MS,
  STALE_PAYLOAD_MAX_AGE_MS,
  TEMPO_DAY_START_HOUR,
} from './constants.js';
import { normalizeConfig } from './config.js';
import { calendrierTempo } from './devices/calendrierTempo.js';
import { computeSceneEvents, emptyTriggerMemory } from './scenes.js';
import { createStateStore } from './store.js';
import {
  ApiDataError,
  buildTempoData,
  COLORS,
  dayForOffset,
  parseDay,
  parseHistory,
} from './tempo.js';
import { addDays, nextParisTime, parisParts } from './time.js';
import { FORECAST_WIDGET, createWidgets } from './widgets.js';

// Un compteur stable est republié toutes les 30 min, pour rester daté dans Gladys
// (les textes ne sont jamais marqués « trop anciens » : jamais republiés tels quels).
const HEARTBEAT_MS = SCAN_INTERVAL_MS;
// Rendez-vous de minuit : 1 s après, pour être sûr d'être le nouveau jour.
const MIDNIGHT_DELAY_MS = 1000;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Réponse au format de /api/today pour une couleur officielle déjà lue. */
function knownDayPayload(date, color) {
  return { status: 'ok', date, couleur: color.toUpperCase(), code: COLORS.indexOf(color) + 1 };
}

const API_DOWN_MESSAGE = {
  en: 'calendrier-tempo.fr cannot be reached. New attempt in a few minutes.',
  fr: 'calendrier-tempo.fr ne répond pas. Nouvel essai dans quelques minutes.',
};

export function createTempoIntegration(gladys, options = {}) {
  const logger = options.logger ?? createLogger({ name: 'calendrier-tempo' });
  const api = options.api ?? createApiClient();
  const store = options.store ?? createStateStore(DATA_DIR, { logger });
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const timers = options.timers ?? { setTimeout, clearTimeout };

  const state = {
    config: normalizeConfig(),
    data: null,
    payloads: {}, // endpoint -> { payload, at }
    failing: new Set(),
    officialColors: {}, // date ISO -> couleur officielle (hier, aujourd'hui, demain)
    triggers: emptyTriggerMemory(),
    jitterMs: null,
    shortRetryDone: false,
    apiReachable: null,
    started: false,
    stopped: false,
    // Faux tant que la première lecture (réussie ou non) n'est pas terminée.
    firstReadDone: false,
    // Faux tant que les valeurs que Gladys a déjà n'ont pas été relues (connexion).
    gladysValuesKnown: false,
    inflight: null,
    cycleTimer: null,
    dailyTimers: new Map(),
  };

  const widgets = createWidgets(() => state.data);
  // Valeur texte que Gladys a déjà, par fonctionnalité (relue à chaque connexion).
  const knownTexts = new Map();

  // ---------------------------------------------------------------- état /data
  async function loadState() {
    const saved = (await store.load()) ?? {};
    state.jitterMs = Number.isInteger(saved.jitterMs)
      ? saved.jitterMs
      : Math.floor(random() * (MAX_JITTER_MS + 1));
    state.officialColors = saved.officialColors ?? {};
    state.triggers = { ...emptyTriggerMemory(), ...(saved.triggers ?? {}) };
    state.payloads = saved.payloads ?? {};
  }

  function saveState() {
    return store.save({
      jitterMs: state.jitterMs,
      officialColors: state.officialColors,
      triggers: state.triggers,
      payloads: state.payloads,
    });
  }

  // ------------------------------------------------------------- publication
  /** Mémorise les couleurs que Gladys a pour notre appareil (null = rien). */
  function rememberGladysValues(device) {
    if (!device || device.external_id !== calendrierTempo.deviceExternalId(gladys)) {
      return;
    }
    for (const feature of device.features ?? []) {
      if (typeof feature.last_value_string === 'string') {
        knownTexts.set(feature.external_id, feature.last_value_string);
      } else {
        knownTexts.delete(feature.external_id);
      }
    }
  }

  async function publishStates() {
    // REGRESSION KO-1 (recette du 2026-10-14) : avant la première lecture, rien
    // n'est publié ; sinon les couleurs passaient à « inconnue » au redémarrage.
    // Ni avant d'avoir relu ce que Gladys a déjà : sinon une lecture finie avant
    // la connexion renvoyait des couleurs identiques (scènes sans seuil relancées).
    if (!state.firstReadDone || !state.gladysValuesKnown) {
      return;
    }
    const states = calendrierTempo.buildStates(gladys, state.data, now(), state.config);
    const id = (s) => s.device_feature_external_id;
    const texts = states.filter((s) => s.text !== undefined && knownTexts.get(id(s)) !== s.text);
    const numbers = states.filter((s) => s.text === undefined);
    try {
      if (texts.length > 0) {
        await gladys.publishStates(texts);
        for (const s of texts) {
          knownTexts.set(id(s), s.text);
        }
      }
      await gladys.publishChangedStates(numbers, { heartbeat: HEARTBEAT_MS });
    } catch (err) {
      logger.warn(`Publication des états impossible pour l'instant : ${err.message}`);
    }
  }

  /** Appareil créé ou modifié par l'utilisateur : ses valeurs sont envoyées aussitôt. */
  async function onDeviceChanged(device) {
    rememberGladysValues(device);
    gladys.forgetPublishedStates(calendrierTempo.deviceExternalId(gladys));
    await publishStates();
  }

  async function publishSceneEvents() {
    if (!state.data || !gladys.connected) {
      return;
    }
    const { events, memory } = computeSceneEvents(state.triggers, state.data, now());
    state.triggers = memory;
    for (const { key, data } of events) {
      try {
        logger.info(`Déclencheur ${key} : ${JSON.stringify(data)}`);
        await gladys.publishSceneEvent(key, data);
      } catch (err) {
        logger.warn(`Déclencheur ${key} non transmis : ${err.message}`);
      }
    }
  }

  async function setApiReachable(reachable) {
    if (state.apiReachable === reachable) {
      return;
    }
    state.apiReachable = reachable;
    try {
      await gladys.setConnectionStatus(reachable, reachable ? undefined : API_DOWN_MESSAGE);
    } catch (err) {
      logger.debug(`Statut de connexion non transmis : ${err.message}`);
    }
  }

  function refreshWidgets() {
    try {
      gladys.requestWidgetRefresh(FORECAST_WIDGET);
    } catch (err) {
      logger.debug(`Rafraîchissement du widget non demandé : ${err.message}`);
    }
  }

  // ------------------------------------------------------------------ lecture
  async function getOptional(endpoint, missing) {
    try {
      const payload = await api.get(endpoint);
      if (!isPlainObject(payload)) {
        throw new TempoApiError(`/api/${endpoint} : réponse inattendue`);
      }
      if (state.failing.delete(endpoint)) {
        logger.info(`/api/${endpoint} de nouveau disponible`);
      }
      state.payloads[endpoint] = { payload, at: now() };
      return payload;
    } catch (err) {
      if (!(err instanceof TempoApiError)) {
        throw err;
      }
      missing.push(endpoint);
      if (!state.failing.has(endpoint)) {
        state.failing.add(endpoint);
        logger.warn(`${err.message}, dernière réponse valide conservée 24 h au plus`);
      }
      const last = state.payloads[endpoint];
      if (!last || now() - last.at > STALE_PAYLOAD_MAX_AGE_MS) {
        return {};
      }
      return last.payload;
    }
  }

  async function fetchYesterday(yesterday) {
    try {
      const colors = parseHistory(await api.get(ENDPOINTS.HISTORY));
      if (colors[yesterday]) {
        state.officialColors[yesterday] = colors[yesterday];
      }
    } catch (err) {
      logger.debug(`Couleur de la veille indisponible : ${err.message}`);
    }
  }

  /** Dernière réponse valide d'un endpoint facultatif, 24 h au plus, sinon {}. */
  function lastPayload(endpoint) {
    const last = state.payloads[endpoint];
    return last && now() - last.at <= STALE_PAYLOAD_MAX_AGE_MS ? last.payload : {};
  }

  /**
   * REGRESSION KO-2 (recette du 2026-10-14) : une réponse sans couleur (panne de
   * la source officielle, `source_indisponible`) n'efface jamais une couleur
   * officielle déjà lue pour cette date.
   */
  function withKnownColor(payload, date) {
    const parsed = parseDay(payload);
    const known = state.officialColors[date];
    return parsed.color === null && known ? knownDayPayload(date, known) : payload;
  }

  /** Données reconstruites sans appel à l'API : couleurs déjà lues et réponses gardées. */
  function dataFromMemory(nowMs) {
    const date = parisParts(nowMs).date;
    const day = (d) => {
      const color = state.officialColors[d];
      return color ? knownDayPayload(d, color) : { status: 'unavailable' };
    };
    const data = buildTempoData(
      day(date),
      day(addDays(date, 1)),
      lastPayload(ENDPOINTS.REMAINING),
      lastPayload(ENDPOINTS.PREDICTIONS),
      date,
    );
    const yesterday = addDays(date, -1);
    return {
      ...data,
      yesterday: { date: yesterday, color: state.officialColors[yesterday] ?? null },
    };
  }

  async function read(nowMs) {
    const paris = parisParts(nowMs);
    const today = await api.get(ENDPOINTS.TODAY);
    const tomorrow = await api.get(ENDPOINTS.TOMORROW);
    const missing = [];
    const remaining = await getOptional(ENDPOINTS.REMAINING, missing);
    const predictions = await getOptional(ENDPOINTS.PREDICTIONS, missing);
    const tomorrowDate = addDays(paris.date, 1);
    const data = buildTempoData(
      withKnownColor(today, paris.date),
      withKnownColor(tomorrow, tomorrowDate),
      remaining,
      predictions,
      paris.date,
    );
    // Demain confirmé par /api/predictions alors que /api/tomorrow n'a pas répondu.
    const j1 = dayForOffset(data, 1);
    if (!data.tomorrow.color && j1?.official) {
      data.tomorrow = { date: tomorrowDate, color: j1.color, code: COLORS.indexOf(j1.color) + 1 };
    }

    const yesterday = addDays(paris.date, -1);
    for (const day of [data.yesterday, data.today, data.tomorrow]) {
      if (day.date && day.color) {
        state.officialColors[day.date] = day.color;
      }
    }
    if (paris.hour < TEMPO_DAY_START_HOUR && !state.officialColors[yesterday]) {
      await fetchYesterday(yesterday);
    }
    state.officialColors = Object.fromEntries(
      Object.entries(state.officialColors).filter(([date]) => date >= yesterday),
    );
    if (data.stale) {
      logger.info('Réponse de la veille reçue (cache), nouvelle lecture dans 5 minutes');
    }
    const sourceDown = [today, tomorrow].some((p) => p?.source_indisponible === true);
    if (sourceDown) {
      logger.info('Source officielle momentanément indisponible, couleurs déjà lues conservées');
    }
    const complete = missing.length === 0 && !data.stale && !sourceDown;
    const yesterdayColor = state.officialColors[yesterday] ?? null;
    return { data: { ...data, yesterday: { date: yesterday, color: yesterdayColor } }, complete };
  }

  // ------------------------------------------------------------------- rythme
  function planNext(complete) {
    let delay = SCAN_INTERVAL_MS;
    if (!complete && !state.shortRetryDone) {
      delay = RETRY_INTERVAL_MS;
      state.shortRetryDone = true;
    } else {
      state.shortRetryDone = !complete;
    }
    if (state.stopped) {
      return delay;
    }
    timers.clearTimeout(state.cycleTimer);
    state.cycleTimer = timers.setTimeout(() => refresh(), delay);
    return delay;
  }

  async function doRefresh() {
    const nowMs = now();
    let complete = false;
    try {
      const result = await read(nowMs);
      state.data = result.data;
      complete = result.complete;
      await setApiReachable(true);
    } catch (err) {
      if (!(err instanceof TempoApiError || err instanceof ApiDataError)) {
        throw err;
      }
      logger.warn(`Lecture impossible : ${err.message}`);
      await setApiReachable(false);
      // Les dernières valeurs restent affichées tant qu'elles concernent aujourd'hui ;
      // sinon (redémarrage, changement de jour), reprise des couleurs déjà lues.
      // REGRESSION KO-1 (recette du 2026-10-14) : un redémarrage pendant une panne
      // gardait « inconnue » alors que /data connaissait la couleur du jour.
      if (!state.data || state.data.referenceDate !== parisParts(nowMs).date) {
        state.data = dataFromMemory(nowMs);
      }
    }
    state.firstReadDone = true;
    await publishStates();
    await publishSceneEvents();
    refreshWidgets();
    await saveState();
    return planNext(complete);
  }

  /** Une lecture complète ; un appel pendant une lecture en cours la rejoint. */
  function refresh() {
    if (!state.inflight) {
      state.inflight = doRefresh().finally(() => {
        state.inflight = null;
      });
    }
    return state.inflight;
  }

  // Sans appel à l'API : changement de jour (minuit), période (6 h, 22 h),
  // couleur actuelle et début de journée.
  async function tick() {
    // REGRESSION KO-3 (recette du 2026-10-14) : de 0 h à la lecture de 0 h 05,
    // « Aujourd'hui » et « Demain » gardaient les couleurs de la veille.
    if (state.data && state.data.referenceDate !== parisParts(now()).date) {
      state.data = dataFromMemory(now());
      refreshWidgets();
    }
    await publishStates();
    await publishSceneEvents();
    await saveState();
  }

  function scheduleDaily(name, hour, minute, extraMs, action) {
    const arm = () => {
      if (state.stopped) {
        return;
      }
      const at = nextParisTime(now(), hour, minute) + extraMs;
      state.dailyTimers.set(
        name,
        timers.setTimeout(
          async () => {
            try {
              await action();
            } catch (err) {
              logger.error(`Tâche ${name} en échec`, err);
            }
            arm();
          },
          Math.max(0, at - now()),
        ),
      );
    };
    arm();
  }

  // ------------------------------------------------------------- cycle de vie
  async function start() {
    if (state.started) {
      return;
    }
    state.started = true;
    await loadState();
    logger.info(`Décalage propre à cette installation : ${Math.round(state.jitterMs / 1000)} s`);
    scheduleDaily(
      'changement-de-jour',
      DAY_REFRESH.hour,
      DAY_REFRESH.minute,
      state.jitterMs,
      refresh,
    );
    scheduleDaily(
      'annonce-edf',
      ANNOUNCEMENT_REFRESH.hour,
      ANNOUNCEMENT_REFRESH.minute,
      state.jitterMs,
      refresh,
    );
    scheduleDaily('minuit', 0, 0, MIDNIGHT_DELAY_MS, tick);
    scheduleDaily('debut-journee-tempo', TEMPO_DAY_START_HOUR, 0, 0, tick);
    scheduleDaily('fin-heures-pleines', PEAK_END_HOUR, 0, 0, tick);
    await refresh();
  }

  function stop() {
    state.stopped = true;
    timers.clearTimeout(state.cycleTimer);
    for (const timer of state.dailyTimers.values()) {
      timers.clearTimeout(timer);
    }
    state.dailyTimers.clear();
  }

  /** (Re)connexion à Gladys : configuration, appareil, états complets, widget. */
  async function onConnected() {
    state.config = normalizeConfig(await gladys.getConfig());
    await gladys.publishDiscoveredDevices([calendrierTempo.buildDevice(gladys, state.config)]);
    // Valeurs que Gladys a déjà : seules les couleurs différentes seront envoyées.
    knownTexts.clear();
    for (const device of await gladys.getDevices()) {
      rememberGladysValues(device);
    }
    state.gladysValuesKnown = true;
    // Statut déjà connu (lecture faite avant la connexion) : transmis de nouveau.
    const known = state.apiReachable;
    state.apiReachable = null;
    if (known !== null) {
      await setApiReachable(known);
    }
    await publishStates();
    await publishSceneEvents();
    refreshWidgets();
  }

  async function onConfigUpdated(newConfig) {
    state.config = normalizeConfig(newConfig);
    await gladys.publishDiscoveredDevices([calendrierTempo.buildDevice(gladys, state.config)]);
    await publishStates();
  }

  return {
    start,
    stop,
    refresh,
    tick,
    onConnected,
    onConfigUpdated,
    onDeviceChanged,
    publishStates,
    widgets,
    get data() {
      return state.data;
    },
    get config() {
      return state.config;
    },
    get jitterMs() {
      return state.jitterMs;
    },
    get triggers() {
      return state.triggers;
    },
  };
}
