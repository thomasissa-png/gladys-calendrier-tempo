// Outils communs aux tests : réponses réelles enregistrées, horloge et API factices.

import { readFileSync } from 'node:fs';

// Instant du relevé des fixtures : mercredi 14 octobre 2026, 14 h 43 à Paris.
export const RECORDED_AT = Date.parse('2026-10-14T12:43:41Z');

const PREFIX = '2026-10-14T12-43Z_';

/** Copie neuve d'une réponse réelle enregistrée (today, tomorrow, remaining...). */
export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${PREFIX}${name}.json`, import.meta.url)));
}

export function realPayloads() {
  return {
    today: fixture('today'),
    tomorrow: fixture('tomorrow'),
    remaining: fixture('remaining'),
    predictions: fixture('predictions'),
    'history?days=2': fixture('history-days-2'),
  };
}

// Forme de /api/tomorrow avant l'annonce d'EDF, telle qu'écrite par le site
// (app.py, _edf_unavailable, textes _EDF_UNAVAILABLE_MESSAGES).
export const TOMORROW_PENDING = {
  status: 'unavailable',
  message: 'Pas encore annoncé par EDF. Détection automatique dès publication.',
};

/**
 * API factice : `responses[endpoint]` est une réponse, une erreur (lancée) ou
 * une fonction. Chaque appel est noté dans `calls`.
 */
export function fakeApi(responses) {
  const calls = [];
  return {
    calls,
    responses,
    async get(endpoint) {
      calls.push(endpoint);
      let value = responses[endpoint];
      if (typeof value === 'function') {
        value = await value();
      }
      if (value instanceof Error) {
        throw value;
      }
      if (value === undefined) {
        throw new Error(`endpoint non prévu par le test : ${endpoint}`);
      }
      return structuredClone(value);
    },
  };
}

/** Horloge manuelle et minuteurs enregistrés (jamais exécutés seuls). */
export function fakeClock(start = RECORDED_AT) {
  let current = start;
  let nextId = 1;
  const pending = new Map();
  return {
    now: () => current,
    set(instant) {
      current = instant;
    },
    timers: {
      setTimeout(fn, delay) {
        const id = nextId++;
        pending.set(id, { fn, at: current + delay, delay });
        return id;
      },
      clearTimeout(id) {
        pending.delete(id);
      },
    },
    pending,
  };
}

/** Mémoire d'état en RAM, à la place de /data. */
export function memoryStore(initial = null) {
  const store = {
    saved: initial,
    async load() {
      return store.saved ? structuredClone(store.saved) : null;
    },
    async save(state) {
      store.saved = structuredClone({ ...state, version: 1 });
    },
  };
  return store;
}
