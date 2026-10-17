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

// Grille de prix au format du contrat de l'API (/api/today, champ `tarifs`,
// contrat du 2026-10-17) ; valeurs de site_facts.TARIFS du site (1er août 2026).
export const TARIFS_API = Object.freeze({
  date_effet: '2026-08-01',
  unite: 'EUR/kWh TTC',
  heures_pleines: '06:00-22:00',
  heures_creuses: '22:00-06:00',
  couleurs: {
    BLEU: { hp: 0.1654, hc: 0.1356 },
    BLANC: { hp: 0.1921, hc: 0.1536 },
    ROUGE: { hp: 0.7295, hc: 0.1615 },
  },
});

/** Réponse /api/today ou /api/tomorrow « ok » enrichie des champs de prix du contrat. */
export function withTariffs(payload, { grid = true } = {}) {
  const color = payload.couleur;
  return {
    ...payload,
    tarif: structuredClone(TARIFS_API.couleurs[color]),
    ...(grid ? { tarifs: structuredClone(TARIFS_API) } : {}),
  };
}

const shiftDate = (isoDate, days) =>
  new Date(Date.parse(`${isoDate.slice(0, 10)}T12:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

/**
 * SCÉNARIO (pas une donnée réelle) : les réponses du 14/10 décalées de `days`
 * jours (multiple de 7 : mêmes jours de la semaine), pour tester la saison des
 * rouges. `redByOffset[i]` = probabilité de rouge posée sur la prévision i
 * (0 = aujourd'hui), couleur prévue ROUGE au-delà de 0,5.
 */
export function seasonPayloads(days = 49, redByOffset = {}) {
  const p = realPayloads();
  p.today.date = shiftDate(p.today.date, days);
  p.tomorrow.date = shiftDate(p.tomorrow.date, days);
  p.predictions.predictions.forEach((item, index) => {
    item.date = shiftDate(item.date, days);
    if (index in redByOffset) {
      const red = redByOffset[index];
      Object.assign(item, {
        probabilite_rouge: red,
        probabilite_bleu: 1 - red,
        probabilite_blanc: 0,
        couleur_predite: red > 0.5 ? 'ROUGE' : 'BLEU',
      });
    }
  });
  return { ...p, referenceDate: shiftDate('2026-10-14', days) };
}
