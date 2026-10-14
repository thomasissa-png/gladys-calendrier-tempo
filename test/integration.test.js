// Intégration complète contre le faux Gladys du SDK (mêmes contrôles que le
// vrai : catégories, types, états refusés en 400), avec les réponses réelles.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createLogger } from '@gladysassistant/integration-sdk';
import { TempoApiError } from '../src/api.js';
import { RETRY_INTERVAL_MS, SCAN_INTERVAL_MS, STALE_PAYLOAD_MAX_AGE_MS } from '../src/constants.js';
import { calendrierTempo, FEATURE } from '../src/devices/calendrierTempo.js';
import { registerHandlers } from '../src/handlers.js';
import { createTempoIntegration } from '../src/integration.js';
import { parisWallTimeToInstant } from '../src/time.js';
import { FORECAST_WIDGET } from '../src/widgets.js';
import { RECORDED_AT, fakeApi, fakeClock, memoryStore, realPayloads } from './helpers.js';

const silent = createLogger({ level: 'silent' });

async function setup({
  config = {},
  payloads = realPayloads(),
  store = memoryStore(),
  start = RECORDED_AT,
} = {}) {
  const gladys = createFakeGladys({ config });
  const api = fakeApi(payloads);
  const clock = fakeClock(start);
  const tempo = createTempoIntegration(gladys, {
    api,
    store,
    now: clock.now,
    timers: clock.timers,
    random: () => 0.5,
    logger: silent,
  });
  registerHandlers(gladys, tempo);
  await gladys.connect();
  return { gladys, api, clock, tempo, store };
}

const feature = (gladys, key) => calendrierTempo.featureExternalId(gladys, key);
const last = (gladys, key) => gladys.fake.lastState(feature(gladys, key));

// Délai du prochain cycle programmé (minuteur non quotidien le plus proche).
function cycleDelay(clock) {
  const delays = [...clock.pending.values()].map((t) => t.delay);
  return delays.filter((d) => d === SCAN_INTERVAL_MS || d === RETRY_INTERVAL_MS)[0];
}

test('appareil proposé en découverte, accepté par Gladys (13 fonctionnalités)', async () => {
  const { gladys } = await setup();
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.name, 'Calendrier Tempo EDF');
  assert.equal(device.features.length, 13);
  assert.ok(device.features.every((f) => f.read_only));
});

test('option J+6 à J+15 : 10 fonctionnalités de plus', async () => {
  const { gladys } = await setup({ config: { previsions_indicatives: true } });
  assert.equal(gladys.fake.discoveredDevices[0].features.length, 23);
});

test('lecture réelle : états publiés et acceptés par le faux Gladys', async () => {
  const { gladys, tempo, api } = await setup();
  await tempo.start();
  assert.deepEqual(api.calls, ['today', 'tomorrow', 'remaining', 'predictions']);
  assert.equal(last(gladys, FEATURE.TODAY), 'bleu');
  assert.equal(last(gladys, FEATURE.CURRENT), 'bleu');
  assert.equal(last(gladys, FEATURE.TOMORROW), 'bleu');
  assert.equal(last(gladys, FEATURE.PERIOD), 'hp');
  for (const offset of [2, 3, 4, 5]) {
    assert.equal(last(gladys, FEATURE.forecast(offset)), 'bleu');
  }
  assert.equal(last(gladys, FEATURE.RED_15_DAYS), 0);
  assert.equal(last(gladys, FEATURE.NEXT_RED), 'aucun');
  assert.equal(last(gladys, FEATURE.NEXT_WHITE), '2026-10-29');
  assert.equal(last(gladys, FEATURE.RED_LEFT), 22);
  assert.equal(last(gladys, FEATURE.WHITE_LEFT), 43);
  assert.equal(gladys.fake.requests.filter((r) => r.status === 400).length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.deepEqual(gladys.fake.sceneEvents, [], 'une installation ne déclenche rien');
  tempo.stop();
});

test('widget servi par Gladys avec les données lues', async () => {
  const { gladys, tempo } = await setup();
  await tempo.start();
  const ack = await gladys.fake.widgetGet(FORECAST_WIDGET, {
    settings: {},
    language: 'fr',
    units: 'metric',
  });
  assert.equal(ack.success, true);
  assert.equal(ack.data.content.components.length, 8);
  assert.ok(gladys.fake.widgetRefreshes.includes(FORECAST_WIDGET));
  tempo.stop();
});

test('rythme : 30 min, relance unique à 5 min après un échec', async () => {
  const payloads = realPayloads();
  const { tempo, clock, gladys } = await setup({ payloads });
  await tempo.start();
  assert.equal(cycleDelay(clock), SCAN_INTERVAL_MS);
  payloads.today = new TempoApiError('/api/today : HTTP 503');
  assert.equal(await tempo.refresh(), RETRY_INTERVAL_MS);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  // Les valeurs du jour restent affichées pendant la panne.
  assert.equal(last(gladys, FEATURE.TODAY), 'bleu');
  assert.equal(await tempo.refresh(), SCAN_INTERVAL_MS, 'jamais deux relances rapides de suite');
  payloads.today = realPayloads().today;
  assert.equal(await tempo.refresh(), SCAN_INTERVAL_MS);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  tempo.stop();
});

test('rendez-vous fixes : 0 h 05 et 11 h 35 + décalage, 6 h et 22 h sans appel', async () => {
  const { tempo, clock } = await setup();
  await tempo.start();
  assert.equal(tempo.jitterMs, 60_000, 'random() = 0.5 : 60 s');
  const at = [...clock.pending.values()].map((t) => new Date(t.at).toISOString()).sort();
  assert.ok(at.includes('2026-10-14T20:00:00.000Z'), '22 h');
  assert.ok(at.includes('2026-10-14T22:06:00.000Z'), '0 h 05 + 60 s');
  assert.ok(at.includes('2026-10-15T04:00:00.000Z'), '6 h');
  assert.ok(at.includes('2026-10-15T09:36:00.000Z'), '11 h 35 + 60 s');
  tempo.stop();
  assert.equal(clock.pending.size, 0);
});

test('prévisions et jours restants gardés 24 h au plus pendant une panne', async () => {
  const payloads = realPayloads();
  const { tempo, clock, gladys } = await setup({ payloads });
  await tempo.start();
  payloads.predictions = new TempoApiError('/api/predictions : HTTP 500');
  payloads.remaining = new TempoApiError('/api/remaining : HTTP 500');
  clock.set(RECORDED_AT + 60 * 60 * 1000);
  await tempo.refresh();
  assert.equal(tempo.data.days.length, 16);
  assert.equal(tempo.data.remaining.rouge, 22);
  clock.set(RECORDED_AT + STALE_PAYLOAD_MAX_AGE_MS + 60_000);
  await tempo.refresh();
  assert.ok(
    tempo.data.days.every((d) => d.official),
    'plus que les couleurs officielles',
  );
  assert.equal(tempo.data.remaining.rouge, null);
  assert.equal(last(gladys, FEATURE.forecast(2)), 'inconnue');
  tempo.stop();
});

test('panne qui dure après minuit : couleurs « inconnue », jamais celles de la veille', async () => {
  const payloads = realPayloads();
  const { tempo, clock, gladys } = await setup({ payloads });
  await tempo.start();
  payloads.today = new TempoApiError('/api/today : délai de 15 s dépassé');
  clock.set(parisWallTimeToInstant('2026-10-15', 0, 6));
  await tempo.refresh();
  assert.equal(tempo.data, null);
  assert.equal(last(gladys, FEATURE.TODAY), 'inconnue');
  assert.equal(last(gladys, FEATURE.RED_LEFT), 22, 'les compteurs gardent leur valeur');
  tempo.stop();
});

test('entre 0 h et 6 h : couleur de la veille lue dans l’historique si inconnue', async () => {
  const store = memoryStore();
  const night = parisWallTimeToInstant('2026-10-15', 1, 0);
  const payloads = realPayloads();
  // Le 15 à 1 h, la réponse « today » réelle du 14 est vue comme celle de la veille.
  const { tempo, api, gladys } = await setup({ payloads, store, start: night });
  await tempo.start();
  assert.ok(!api.calls.includes('history?days=2'), 'couleur du 14 déjà fournie par /api/today');
  assert.equal(last(gladys, FEATURE.CURRENT), 'bleu');
  tempo.stop();
  // Nouveau démarrage sans mémoire, réponse « today » déjà à jour : l'historique sert.
  payloads.today = { ...payloads.tomorrow };
  payloads.tomorrow = { status: 'unavailable' };
  const second = await setup({ payloads, store: memoryStore(), start: night });
  await second.tempo.start();
  assert.ok(second.api.calls.includes('history?days=2'));
  assert.equal(last(second.gladys, FEATURE.CURRENT), 'bleu');
  assert.equal(last(second.gladys, FEATURE.PERIOD), 'hc');
  second.tempo.stop();
});

test('état gardé : décalage et mémoire des déclencheurs survivent au redémarrage', async () => {
  const store = memoryStore();
  const first = await setup({ store });
  await first.tempo.start();
  first.tempo.stop();
  assert.equal(store.saved.jitterMs, 60_000);
  assert.deepEqual(store.saved.triggers.announced, { '2026-10-15': 'bleu' });
  const gladys = createFakeGladys();
  const clock = fakeClock();
  const again = createTempoIntegration(gladys, {
    api: fakeApi(realPayloads()),
    store,
    now: clock.now,
    timers: clock.timers,
    random: () => 0.99,
    logger: silent,
  });
  registerHandlers(gladys, again);
  await gladys.connect();
  await again.start();
  assert.equal(again.jitterMs, 60_000, 'le décalage reste celui de l’installation');
  assert.deepEqual(gladys.fake.sceneEvents, []);
  again.stop();
});

test('appareil créé par l’utilisateur : valeurs republiées aussitôt', async () => {
  const { gladys, tempo } = await setup();
  await tempo.start();
  const before = gladys.fake.states.length;
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  assert.ok(gladys.fake.states.length >= before + 13);
  tempo.stop();
});
