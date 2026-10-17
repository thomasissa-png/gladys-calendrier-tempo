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
import {
  RECORDED_AT,
  TOMORROW_PENDING,
  fakeApi,
  fakeClock,
  memoryStore,
  realPayloads,
  seasonPayloads,
  withTariffs,
} from './helpers.js';

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

test('appareil proposé en découverte, accepté par Gladys (16 fonctionnalités)', async () => {
  const { gladys } = await setup();
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.name, 'Calendrier Tempo EDF');
  assert.equal(device.features.length, 16);
  assert.ok(device.features.every((f) => f.read_only));
});

test('option J+6 à J+15 : 10 fonctionnalités de plus', async () => {
  const { gladys } = await setup({ config: { previsions_indicatives: true } });
  assert.equal(gladys.fake.discoveredDevices[0].features.length, 26);
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

test('panne qui dure après minuit : couleurs recalées sur leur date, jamais celles de la veille', async () => {
  const payloads = realPayloads();
  const { tempo, clock, gladys } = await setup({ payloads });
  await tempo.start();
  payloads.today = new TempoApiError('/api/today : délai de 15 s dépassé');
  clock.set(parisWallTimeToInstant('2026-10-15', 0, 6));
  await tempo.refresh();
  // La couleur officielle du 15 (lue la veille comme « demain ») devient « aujourd'hui ».
  assert.equal(tempo.data.referenceDate, '2026-10-15');
  assert.equal(last(gladys, FEATURE.TODAY), 'bleu');
  assert.equal(last(gladys, FEATURE.TOMORROW), 'inconnue');
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

// ---------------------------------------------------------------------------
// Non-régressions de la recette du 2026-10-14 (docs/audits/2026-10-14-recette-gladys.md)
// ---------------------------------------------------------------------------

/** Appareil tel que Gladys le rend après création, avec les valeurs qu'il a déjà. */
function createdDevice(gladys, values) {
  const device = calendrierTempo.buildDevice(gladys, { previsions_indicatives: false });
  return {
    ...device,
    features: device.features.map((f) => ({
      ...f,
      last_value_string: values[f.external_id.split(':').at(-1)] ?? null,
    })),
  };
}

const BLUE_EVERYWHERE = {
  [FEATURE.TODAY]: 'bleu',
  [FEATURE.CURRENT]: 'bleu',
  [FEATURE.PERIOD]: 'hp',
  [FEATURE.TOMORROW]: 'bleu',
  [FEATURE.forecast(2)]: 'bleu',
  [FEATURE.forecast(3)]: 'bleu',
  [FEATURE.forecast(4)]: 'bleu',
  [FEATURE.forecast(5)]: 'bleu',
  [FEATURE.NEXT_RED]: 'aucun',
  [FEATURE.NEXT_WHITE]: '2026-10-29',
};

const textsSent = (gladys) => gladys.fake.states.filter((s) => s.text !== undefined);

// REGRESSION: KO-1 (connexion à Gladys avant la fin de la première lecture), fixé le 2026-10-14
test('connexion avant la première lecture : aucun état « inconnue » publié', async () => {
  const payloads = realPayloads();
  let release;
  const todayGate = new Promise((resolve) => {
    release = resolve;
  });
  payloads.today = async () => {
    await todayGate;
    return realPayloads().today;
  };
  const gladys = createFakeGladys();
  const clock = fakeClock();
  const tempo = createTempoIntegration(gladys, {
    api: fakeApi(payloads),
    store: memoryStore(),
    now: clock.now,
    timers: clock.timers,
    random: () => 0.5,
    logger: silent,
  });
  registerHandlers(gladys, tempo);
  const started = tempo.start();
  await gladys.connect(); // la connexion arrive pendant la première lecture
  assert.deepEqual(textsSent(gladys), [], 'rien avant la fin de la lecture');
  release();
  await started;
  assert.ok(textsSent(gladys).length > 0);
  assert.ok(textsSent(gladys).every((s) => s.text !== 'inconnue'));
  assert.equal(last(gladys, FEATURE.TODAY), 'bleu');
  tempo.stop();
});

// REGRESSION: KO-1 (redémarrage pendant une panne de l'API), fixé le 2026-10-14
test('redémarrage pendant une panne : couleurs du jour reprises de /data', async () => {
  const store = memoryStore();
  const first = await setup({ store });
  await first.tempo.start();
  first.tempo.stop();
  const down = new TempoApiError('/api/today : HTTP 503');
  const payloads = { ...realPayloads(), today: down, tomorrow: down };
  const again = await setup({ store, payloads, start: RECORDED_AT + 10 * 60 * 1000 });
  await again.tempo.start();
  assert.equal(last(again.gladys, FEATURE.TODAY), 'bleu');
  assert.equal(last(again.gladys, FEATURE.CURRENT), 'bleu');
  assert.equal(last(again.gladys, FEATURE.TOMORROW), 'bleu');
  assert.equal(last(again.gladys, FEATURE.forecast(2)), 'bleu', 'prévisions gardées 24 h');
  assert.ok(textsSent(again.gladys).every((s) => s.text !== 'inconnue'));
  assert.equal(again.gladys.fake.connectionStatus.connected, false);
  again.tempo.stop();
});

// REGRESSION: KO-1 et KO-5 (couleurs déjà dans Gladys renvoyées au redémarrage), fixé le 2026-10-14
test('redémarrage : aucune couleur renvoyée si Gladys a déjà la même valeur', async () => {
  const probe = createFakeGladys();
  const gladys = createFakeGladys({ devices: [createdDevice(probe, BLUE_EVERYWHERE)] });
  const clock = fakeClock();
  const tempo = createTempoIntegration(gladys, {
    api: fakeApi(realPayloads()),
    store: memoryStore(),
    now: clock.now,
    timers: clock.timers,
    random: () => 0.5,
    logger: silent,
  });
  registerHandlers(gladys, tempo);
  await gladys.connect();
  await tempo.start();
  assert.deepEqual(textsSent(gladys), []);
  assert.equal(last(gladys, FEATURE.RED_LEFT), 22, 'les compteurs sont publiés');
  tempo.stop();
});

// REGRESSION: KO-1 et KO-5 (lecture finie avant la connexion), fixé le 2026-10-14
test('lecture finie avant la connexion : rien avant la connexion, puis seulement les écarts', async () => {
  const probe = createFakeGladys();
  const values = { ...BLUE_EVERYWHERE, [FEATURE.TOMORROW]: 'rouge' };
  const gladys = createFakeGladys({ devices: [createdDevice(probe, values)] });
  const clock = fakeClock();
  const tempo = createTempoIntegration(gladys, {
    api: fakeApi(realPayloads()),
    store: memoryStore(),
    now: clock.now,
    timers: clock.timers,
    random: () => 0.5,
    logger: silent,
  });
  registerHandlers(gladys, tempo);
  await tempo.start(); // première lecture terminée, Gladys pas encore joignable
  assert.deepEqual(gladys.fake.states, []);
  await gladys.connect();
  assert.deepEqual(
    textsSent(gladys).map((s) => [s.device_feature_external_id.split(':').at(-1), s.text]),
    [[FEATURE.TOMORROW, 'bleu']],
    'seule la valeur différente de celle de Gladys est envoyée',
  );
  tempo.stop();
});

// REGRESSION: KO-5 (republication de fond des textes inchangés), fixé le 2026-10-14
test('lecture suivante sans changement : textes non renvoyés, compteurs avec battement de 30 min', async (t) => {
  const { gladys, tempo, clock } = await setup();
  const calls = [];
  const original = gladys.publishChangedStates.bind(gladys);
  t.mock.method(gladys, 'publishChangedStates', (states, options) => {
    calls.push({ states, options });
    return original(states, options);
  });
  await tempo.start();
  const texts = textsSent(gladys).length;
  clock.set(RECORDED_AT + SCAN_INTERVAL_MS + 1000);
  await tempo.refresh();
  assert.equal(textsSent(gladys).length, texts, 'aucun texte inchangé renvoyé');
  // Les compteurs passent par publishChangedStates avec un battement de 30 min ;
  // les textes jamais.
  assert.ok(calls.length >= 2);
  for (const { states, options } of calls) {
    assert.deepEqual(options, { heartbeat: SCAN_INTERVAL_MS });
    assert.ok(states.every((s) => s.text === undefined));
    assert.equal(states.length, 3);
  }
  tempo.stop();
});

// REGRESSION: KO-2 (source_indisponible efface la couleur de demain), fixé le 2026-10-14
test('source officielle indisponible : couleur de demain gardée, relance à 5 min', async () => {
  const payloads = realPayloads();
  const { gladys, tempo } = await setup({ payloads });
  await tempo.start();
  // Forme écrite par le site (app.py, _edf_unavailable avec failed=True).
  payloads.tomorrow = {
    status: 'unavailable',
    message:
      "La couleur de demain n'a pas pu être vérifiée : la source officielle ne répond pas pour le moment. Nouvel essai automatique.",
    source_indisponible: true,
  };
  payloads.predictions.predictions[1].confirmed = false;
  assert.equal(await tempo.refresh(), RETRY_INTERVAL_MS);
  assert.equal(last(gladys, FEATURE.TOMORROW), 'bleu');
  assert.equal(tempo.data.tomorrow.color, 'bleu');
  tempo.stop();
});

test('demain confirmé par /api/predictions quand /api/tomorrow ne l’a pas encore', async () => {
  const payloads = realPayloads();
  payloads.tomorrow = TOMORROW_PENDING;
  const { gladys, tempo } = await setup({ payloads });
  await tempo.start();
  assert.equal(last(gladys, FEATURE.TOMORROW), 'bleu');
  tempo.stop();
});

// REGRESSION: KO-3 (valeurs de la veille entre 0 h et 0 h 05), fixé le 2026-10-14
test('minuit : jour recalé sans appel à l’API', async () => {
  const { gladys, tempo, clock, api } = await setup();
  await tempo.start();
  const calls = api.calls.length;
  const midnight = [...clock.pending.values()].find(
    (t) => new Date(t.at).toISOString() === '2026-10-14T22:00:01.000Z',
  );
  assert.ok(midnight, 'rendez-vous de minuit (+1 s) programmé');
  clock.set(parisWallTimeToInstant('2026-10-15', 0, 0, 1));
  await tempo.tick();
  assert.equal(api.calls.length, calls, 'aucun appel');
  assert.equal(tempo.data.referenceDate, '2026-10-15');
  assert.equal(last(gladys, FEATURE.TODAY), 'bleu');
  assert.equal(last(gladys, FEATURE.TOMORROW), 'inconnue');
  assert.equal(last(gladys, FEATURE.forecast(2)), 'bleu');
  assert.equal(tempo.data.days[0].date, '2026-10-15');
  tempo.stop();
});

test('réponse facultative qui n’est pas un objet : échec de l’endpoint, pas de la lecture', async () => {
  const payloads = realPayloads();
  const { gladys, tempo } = await setup({ payloads });
  await tempo.start();
  payloads.predictions = [];
  assert.equal(await tempo.refresh(), RETRY_INTERVAL_MS);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(tempo.data.days.length, 16, 'dernière réponse valide gardée');
  tempo.stop();
});

// ------------------------------------------------------------ prix du kWh (0.2.0)

function pricedPayloads() {
  const payloads = realPayloads();
  payloads.today = withTariffs(payloads.today);
  payloads.tomorrow = withTariffs(payloads.tomorrow, { grid: false });
  return payloads;
}

test('prix du kWh : HP du jour à 14 h 43, HC à 22 h, nuit = veille, HP à 6 h', async () => {
  const { gladys, tempo, clock } = await setup({ payloads: pricedPayloads() });
  await tempo.start();
  assert.equal(gladys.fake.requests.filter((r) => r.status === 400).length, 0);
  assert.equal(last(gladys, FEATURE.PRICE), 0.1654);
  assert.equal(last(gladys, FEATURE.DAY_PEAK_PRICE), 0.1654);
  assert.equal(last(gladys, FEATURE.DAY_OFF_PEAK_PRICE), 0.1356);
  clock.set(parisWallTimeToInstant('2026-10-14', 22, 0));
  await tempo.tick();
  assert.equal(last(gladys, FEATURE.PRICE), 0.1356, '22 h : heures creuses');
  // Minuit passé, sans appel à l'API : journée Tempo du 14 jusqu'à 6 h.
  clock.set(parisWallTimeToInstant('2026-10-15', 0, 0, 1));
  await tempo.tick();
  assert.equal(last(gladys, FEATURE.PRICE), 0.1356);
  assert.equal(last(gladys, FEATURE.CURRENT), 'bleu');
  clock.set(parisWallTimeToInstant('2026-10-15', 6, 0));
  await tempo.tick();
  assert.equal(last(gladys, FEATURE.PRICE), 0.1654, '6 h : HP du 15 (bleu)');
  const refreshes = gladys.fake.widgetRefreshes.length;
  clock.set(parisWallTimeToInstant('2026-10-15', 22, 0));
  await tempo.tick();
  assert.ok(gladys.fake.widgetRefreshes.length > refreshes, 'widget redemandé à 22 h');
  assert.equal(last(gladys, FEATURE.PRICE), 0.1356);
  const ack = await gladys.fake.widgetGet(FORECAST_WIDGET, {
    settings: {},
    language: 'fr',
    units: 'metric',
  });
  const [status] = ack.data.content.components.filter((c) => c.type === 'status');
  assert.deepEqual(status.items[0], {
    label: 'Prix actuel',
    value: '0,1356 €/kWh (HC, bleu)',
    color: 'info',
  });
  tempo.stop();
});

test('prix du kWh : API sans grille (réponse actuelle ou en cache) → rien de publié', async () => {
  const { gladys, tempo } = await setup();
  await tempo.start();
  for (const key of [FEATURE.PRICE, FEATURE.DAY_PEAK_PRICE, FEATURE.DAY_OFF_PEAK_PRICE]) {
    assert.equal(last(gladys, key), undefined, key);
  }
  assert.equal(tempo.data.tariffs, null);
  tempo.stop();
});

test('prix du kWh : grille gardée dans /data, reprise pendant une panne (24 h au plus)', async () => {
  const store = memoryStore();
  const first = await setup({ payloads: pricedPayloads(), store });
  await first.tempo.start();
  first.tempo.stop();
  assert.equal(store.saved.tariffs.grid.couleurs.bleu.hp, 0.1654);
  const down = new TempoApiError('panne');
  const outage = { today: down, tomorrow: down, remaining: down, predictions: down };
  const later = parisWallTimeToInstant('2026-10-14', 23, 0);
  const second = await setup({ payloads: outage, store, start: later });
  await second.tempo.start();
  assert.equal(last(second.gladys, FEATURE.PRICE), 0.1356, 'HC du 14, grille relue dans /data');
  second.tempo.stop();
  const tooOld = parisWallTimeToInstant('2026-10-15', 23, 0);
  const third = await setup({ payloads: outage, store, start: tooOld });
  await third.tempo.start();
  assert.equal(last(third.gladys, FEATURE.PRICE), undefined, 'grille de plus de 24 h : inconnue');
  third.tempo.stop();
});

// REGRESSION KO-1 (recette du 2026-10-17) : une réponse /api/today « ok » sans
// grille effaçait la grille gardée ; un jour rouge à 14 h, l'appareil restait au
// prix HC publié avant (0,1615) au lieu du prix HP (0,7295).
test('prix du kWh : réponse sans grille, la dernière grille lue sert 24 h au plus', async () => {
  const p = seasonPayloads(35); // SCÉNARIO : mercredi 18 novembre 2026
  assert.equal(p.referenceDate, '2026-11-18');
  Object.assign(p.today, { couleur: 'ROUGE', code: 3 });
  const payloads = { ...p, today: withTariffs(p.today) };
  const store = memoryStore();
  const readAt = parisWallTimeToInstant('2026-11-18', 9, 0);
  const { tempo, clock, gladys } = await setup({ payloads, store, start: readAt });
  await tempo.start();
  assert.equal(last(gladys, FEATURE.PRICE), 0.7295, 'HP rouge');
  const { tarifs, tarif, ...noGrid } = payloads.today;
  assert.ok(tarifs && tarif);
  payloads.today = noGrid;
  clock.set(parisWallTimeToInstant('2026-11-18', 14, 0));
  await tempo.refresh();
  assert.equal(last(gladys, FEATURE.PRICE), 0.7295, '14 h : toujours HP rouge');
  assert.equal(last(gladys, FEATURE.DAY_PEAK_PRICE), 0.7295);
  assert.equal(last(gladys, FEATURE.DAY_OFF_PEAK_PRICE), 0.1615);
  assert.equal(store.saved.tariffs.grid.couleurs.rouge.hp, 0.7295, 'grille gardée dans /data');
  assert.equal(store.saved.tariffs.at, readAt, 'datée de sa dernière lecture, pas de la réponse');
  clock.set(parisWallTimeToInstant('2026-11-18', 22, 0));
  await tempo.tick();
  assert.equal(last(gladys, FEATURE.PRICE), 0.1615, '22 h : HC rouge, grille gardée');
  // Plus de 24 h après la dernière grille lue : prix inconnu, plus rien de publié.
  clock.set(readAt + STALE_PAYLOAD_MAX_AGE_MS + 60_000);
  await tempo.refresh();
  assert.equal(tempo.data.tariffs, null);
  tempo.stop();
});
