import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSceneEvents, emptyTriggerMemory, TRIGGERS } from '../src/scenes.js';
import { buildTempoData } from '../src/tempo.js';
import { parisWallTimeToInstant } from '../src/time.js';
import { RECORDED_AT, TOMORROW_PENDING, fixture, realPayloads } from './helpers.js';

function data(overrides = {}, currentDate = '2026-10-14') {
  const p = { ...realPayloads(), ...overrides };
  return buildTempoData(p.today, p.tomorrow, p.remaining, p.predictions, currentDate);
}

function withRed(index, probabilite = 0.62) {
  const predictions = fixture('predictions');
  Object.assign(predictions.predictions[index], {
    couleur_predite: 'ROUGE',
    probabilite_rouge: probabilite,
  });
  return predictions;
}

test('première lecture : tout est mémorisé, rien ne se déclenche', () => {
  const { events, memory } = computeSceneEvents(emptyTriggerMemory(), data(), RECORDED_AT);
  assert.deepEqual(events, []);
  assert.deepEqual(memory.announced, { '2026-10-15': 'bleu' });
  assert.deepEqual(memory.redForecasts, []);
  assert.equal(memory.tempoDayStarted, '2026-10-14');
});

test('couleur de demain annoncée : un seul événement par date', () => {
  // Le 14 au matin, demain n'est pas encore annoncé.
  const morning = parisWallTimeToInstant('2026-10-14', 10, 0);
  let { memory } = computeSceneEvents(
    emptyTriggerMemory(),
    data({ tomorrow: TOMORROW_PENDING }),
    morning,
  );
  assert.equal(memory.announced, null, 'aucune annonce vue : pas encore de référence');
  ({ memory } = computeSceneEvents(memory, data(), morning));
  // Première annonce vue = référence (installation), pas d'événement.
  memory.announced = {};
  const first = computeSceneEvents(memory, data(), RECORDED_AT);
  assert.deepEqual(first.events, [
    { key: TRIGGERS.TOMORROW_ANNOUNCED, data: { couleur: 'bleu', date: '2026-10-15' } },
  ]);
  const again = computeSceneEvents(first.memory, data(), RECORDED_AT + 30 * 60 * 1000);
  assert.deepEqual(again.events, []);
});

test('jour rouge prévu : une fois par passage au rouge, avec probabilité en %', () => {
  const base = computeSceneEvents(emptyTriggerMemory(), data(), RECORDED_AT).memory;
  const red = computeSceneEvents(base, data({ predictions: withRed(4) }), RECORDED_AT);
  assert.deepEqual(red.events, [
    {
      key: TRIGGERS.RED_FORECAST,
      data: { date: '2026-10-18', jours_avant: 4, probabilite_rouge: 62, fiabilite: 'fiable' },
    },
  ]);
  // Toujours rouge à la lecture suivante : rien.
  assert.deepEqual(
    computeSceneEvents(red.memory, data({ predictions: withRed(4) }), RECORDED_AT).events,
    [],
  );
  // Prévisions indisponibles : la mémoire est gardée, rien ne redéclenche au retour.
  const outage = computeSceneEvents(red.memory, data({ predictions: {} }), RECORDED_AT);
  assert.deepEqual(outage.memory.redForecasts, ['2026-10-18']);
  assert.deepEqual(
    computeSceneEvents(outage.memory, data({ predictions: withRed(4) }), RECORDED_AT).events,
    [],
  );
  // Repassé bleu puis de nouveau rouge : nouvelle transition.
  const blue = computeSceneEvents(red.memory, data(), RECORDED_AT);
  const back = computeSceneEvents(blue.memory, data({ predictions: withRed(4) }), RECORDED_AT);
  assert.equal(back.events.length, 1);
});

test('jour rouge prévu : J+6 à J+15 marqué indicatif, J+1 jamais', () => {
  const base = computeSceneEvents(emptyTriggerMemory(), data(), RECORDED_AT).memory;
  const far = computeSceneEvents(base, data({ predictions: withRed(12, 0.41) }), RECORDED_AT);
  assert.equal(far.events[0].data.fiabilite, 'indicative');
  assert.equal(far.events[0].data.jours_avant, 12);
  // J+1 vient de l'annonce d'EDF (autre déclencheur), jamais de « rouge prévu ».
  const predictions = withRed(1);
  predictions.predictions[1].confirmed = false;
  const tomorrow = computeSceneEvents(
    base,
    data({ predictions, tomorrow: TOMORROW_PENDING }),
    RECORDED_AT,
  );
  assert.deepEqual(tomorrow.events, []);
});

test('journée Tempo commencée : à 6 h, avec la couleur du jour', () => {
  const night = parisWallTimeToInstant('2026-10-15', 5, 30);
  const atSix = parisWallTimeToInstant('2026-10-15', 6, 0);
  const d15 = data({}, '2026-10-15');
  const before = computeSceneEvents(emptyTriggerMemory(), d15, night);
  assert.equal(before.memory.tempoDayStarted, '2026-10-14');
  const six = computeSceneEvents(before.memory, d15, atSix);
  assert.deepEqual(
    six.events.filter((e) => e.key === TRIGGERS.TEMPO_DAY_STARTED),
    [{ key: TRIGGERS.TEMPO_DAY_STARTED, data: { couleur: 'bleu', date: '2026-10-15' } }],
  );
  assert.deepEqual(computeSceneEvents(six.memory, d15, atSix + 60_000).events, []);
});

test('journée Tempo commencée : jamais rattrapée après 7 h', () => {
  const night = parisWallTimeToInstant('2026-10-15', 5, 30);
  const late = parisWallTimeToInstant('2026-10-15', 9, 0);
  const d15 = data({}, '2026-10-15');
  const before = computeSceneEvents(emptyTriggerMemory(), d15, night);
  const after = computeSceneEvents(before.memory, d15, late);
  assert.deepEqual(
    after.events.filter((e) => e.key === TRIGGERS.TEMPO_DAY_STARTED),
    [],
  );
  assert.equal(after.memory.tempoDayStarted, '2026-10-15');
});
