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
// rendez-vous fixes, et 6 h / 22 h recalculés sans appel à l'API.
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
import { ApiDataError, buildTempoData, parseHistory } from './tempo.js';
import { addDays, nextParisTime, parisParts } from './time.js';
import { FORECAST_WIDGET, createWidgets } from './widgets.js';

// Une valeur stable est republiée toutes les 30 min, pour rester datée dans Gladys.
const HEARTBEAT_MS = SCAN_INTERVAL_MS;

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
    inflight: null,
    cycleTimer: null,
    dailyTimers: new Map(),
  };

  const widgets = createWidgets(() => state.data);

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
  async function publishStates({ force = false } = {}) {
    const states = calendrierTempo.buildStates(gladys, state.data, now(), state.config);
    try {
      if (force) {
        gladys.forgetPublishedStates(calendrierTempo.deviceExternalId(gladys));
      }
      await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    } catch (err) {
      logger.warn(`Publication des états impossible pour l'instant : ${err.message}`);
    }
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

  async function read(nowMs) {
    const paris = parisParts(nowMs);
    const today = await api.get(ENDPOINTS.TODAY);
    const tomorrow = await api.get(ENDPOINTS.TOMORROW);
    const missing = [];
    const remaining = await getOptional(ENDPOINTS.REMAINING, missing);
    const predictions = await getOptional(ENDPOINTS.PREDICTIONS, missing);
    const data = buildTempoData(today, tomorrow, remaining, predictions, paris.date);

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
    const complete = missing.length === 0 && !data.stale;
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
      // Les dernières valeurs restent affichées tant qu'elles concernent aujourd'hui.
      if (state.data && state.data.referenceDate !== parisParts(nowMs).date) {
        state.data = null;
      }
    }
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

  // Sans appel à l'API : période (6 h, 22 h), couleur actuelle et début de journée.
  async function tick() {
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
    // Statut déjà connu (lecture faite avant la connexion) : transmis de nouveau.
    const known = state.apiReachable;
    state.apiReachable = null;
    if (known !== null) {
      await setApiReachable(known);
    }
    await publishStates({ force: true });
    await publishSceneEvents();
    refreshWidgets();
  }

  async function onConfigUpdated(newConfig) {
    state.config = normalizeConfig(newConfig);
    await gladys.publishDiscoveredDevices([calendrierTempo.buildDevice(gladys, state.config)]);
    await publishStates({ force: true });
  }

  return {
    start,
    stop,
    refresh,
    tick,
    onConnected,
    onConfigUpdated,
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
