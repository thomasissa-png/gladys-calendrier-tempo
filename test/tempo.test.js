import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ApiDataError,
  buildTempoData,
  countColor,
  dayForOffset,
  easterSunday,
  fiabiliteFor,
  isFrenchHoliday,
  nextDayOfColor,
  normalizeColor,
  officialColor,
  parseDay,
  parseHistory,
  parsePredictions,
  parseRemaining,
  periodFor,
  probability,
  redPossible,
  tempoDay,
} from '../src/tempo.js';
import { TOMORROW_PENDING, fixture, realPayloads } from './helpers.js';

const TODAY = '2026-10-14';

function realData(overrides = {}) {
  const p = { ...realPayloads(), ...overrides };
  return buildTempoData(p.today, p.tomorrow, p.remaining, p.predictions, TODAY);
}

test('réponses réelles du 2026-10-14 : couleurs officielles du jour et du lendemain', () => {
  assert.deepEqual(parseDay(fixture('today')), { date: '2026-10-14', color: 'bleu', code: 1 });
  assert.deepEqual(parseDay(fixture('tomorrow'), 'tomorrow'), {
    date: '2026-10-15',
    color: 'bleu',
    code: 1,
  });
});

test('demain pas encore annoncé : couleur inconnue, le message n’est pas lu', () => {
  assert.deepEqual(parseDay(TOMORROW_PENDING, 'tomorrow'), { date: null, color: null, code: null });
  const data = realData({ tomorrow: TOMORROW_PENDING });
  assert.equal(data.tomorrow.color, null);
  assert.equal(data.tomorrow.date, '2026-10-15');
  // La prévision de demain reste dans l'horizon, marquée comme telle.
  const j1 = dayForOffset(data, 1);
  assert.equal(j1.official, true, 'la réponse réelle du 14 marque déjà J+1 confirmé');
});

test('le module de lecture ne lit jamais le champ « message » de l’API', async () => {
  const source = await readFile(new URL('../src/tempo.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.message\b|\[['"]message['"]\]/);
});

test('jours restants réels : compteurs EDF prioritaires, saison', () => {
  assert.deepEqual(parseRemaining(fixture('remaining')), {
    rouge: 22,
    blanc: 43,
    totalRouge: 22,
    totalBlanc: 43,
    seasonStart: '2026-09-01',
    seasonEnd: '2027-08-31',
    source: 'edf',
  });
  const withoutEdf = fixture('remaining');
  delete withoutEdf.edf_official;
  assert.equal(parseRemaining(withoutEdf).source, 'calcul');
  assert.equal(parseRemaining({ status: 'unavailable' }).rouge, null);
});

test('prévisions réelles : 16 jours, J0 à J+15, fiabilité par horizon', () => {
  const data = realData();
  assert.equal(data.days.length, 16);
  assert.deepEqual(
    data.days.map((d) => d.offset),
    Array.from({ length: 16 }, (_, i) => i),
  );
  assert.equal(data.generatedAt, fixture('predictions').generated_at);
  assert.equal(dayForOffset(data, 0).fiabilite, 'officielle');
  assert.equal(dayForOffset(data, 1).fiabilite, 'officielle');
  for (const offset of [2, 3, 4, 5]) {
    assert.equal(dayForOffset(data, offset).fiabilite, 'fiable');
  }
  for (let offset = 6; offset <= 15; offset += 1) {
    assert.equal(dayForOffset(data, offset).fiabilite, 'indicative');
  }
  const j2 = dayForOffset(data, 2);
  assert.equal(j2.date, '2026-10-16');
  assert.equal(probability(j2, 'bleu'), fixture('predictions').predictions[2].probabilite_bleu);
  assert.equal(probability(dayForOffset(data, 0), 'bleu'), 1);
  assert.equal(probability(dayForOffset(data, 0), 'rouge'), 0);
});

test('octobre réel : aucun jour rouge, un blanc prévu à J+15 (29 octobre)', () => {
  const data = realData();
  assert.equal(countColor(data, 'rouge'), 0);
  assert.equal(nextDayOfColor(data, 'rouge'), null);
  const white = nextDayOfColor(data, 'blanc');
  assert.equal(white.date, '2026-10-29');
  assert.equal(white.offset, 15);
  assert.equal(white.fiabilite, 'indicative');
  assert.equal(probability(white, 'blanc'), 0.502);
  // Sans prévisions : l'horizon se limite aux deux couleurs officielles.
  const officialOnly = buildTempoData(fixture('today'), fixture('tomorrow'), {}, {}, TODAY);
  assert.equal(officialOnly.days.length, 2);
  assert.equal(countColor(officialOnly, 'rouge'), 0);
});

test('scénario : une prévision passée en rouge est comptée et devient le prochain jour rouge', () => {
  const predictions = fixture('predictions');
  Object.assign(predictions.predictions[4], { couleur_predite: 'ROUGE', probabilite_rouge: 0.62 });
  const data = realData({ predictions });
  assert.equal(countColor(data, 'rouge'), 1);
  const next = nextDayOfColor(data, 'rouge');
  assert.equal(next.offset, 4);
  assert.equal(next.fiabilite, 'fiable');
  assert.equal(probability(next, 'rouge'), 0.62);
});

test('les entrées simulées ou invalides sont ignorées', () => {
  const predictions = fixture('predictions');
  predictions.predictions[3].simulated = true;
  predictions.predictions[5].couleur_predite = 'VIOLET';
  predictions.predictions.push({ date: 'pas une date', couleur_predite: 'BLEU' });
  assert.equal(parsePredictions(predictions).length, 14);
});

test('une réponse de la veille (cache juste après minuit) est rangée à sa date', () => {
  // Le 15 à 0 h 01, /api/today peut encore renvoyer la réponse du 14.
  const p = realPayloads();
  const data = buildTempoData(p.today, p.tomorrow, p.remaining, p.predictions, '2026-10-15');
  assert.equal(data.stale, true);
  assert.equal(data.yesterday.color, 'bleu');
  assert.equal(data.today.date, '2026-10-15');
  assert.equal(officialColor(data, '2026-10-14'), 'bleu');
});

test('historique réel : couleurs officielles par date', () => {
  assert.deepEqual(parseHistory(fixture('history-days-2')), {
    '2026-10-12': 'bleu',
    '2026-10-13': 'bleu',
    '2026-10-14': 'bleu',
    '2026-10-15': 'bleu',
  });
});

test('réponse inattendue : erreur explicite', () => {
  assert.throws(() => parseDay([], 'today'), ApiDataError);
  assert.throws(() => buildTempoData('x', {}, {}, {}, TODAY), ApiDataError);
});

test('journée Tempo de 6 h à 6 h, heures pleines de 6 h à 22 h', () => {
  assert.equal(tempoDay(TODAY, 5), '2026-10-13');
  assert.equal(tempoDay(TODAY, 6), TODAY);
  assert.equal(periodFor(5), 'hc');
  assert.equal(periodFor(6), 'hp');
  assert.equal(periodFor(21), 'hp');
  assert.equal(periodFor(22), 'hc');
});

test('couleurs et fiabilité', () => {
  assert.equal(normalizeColor(' Rouge '), 'rouge');
  assert.equal(normalizeColor('BLEU'), 'bleu');
  assert.equal(normalizeColor(3), null);
  assert.equal(fiabiliteFor(1, true), 'officielle');
  assert.equal(fiabiliteFor(1, false), 'fiable');
  assert.equal(fiabiliteFor(5, false), 'fiable');
  assert.equal(fiabiliteFor(6, false), 'indicative');
});

test('Pâques et jours fériés français (fêtes mobiles comprises)', () => {
  const easter = [2008, 2024, 2025, 2026, 2027, 2028, 2038, 2285].map(easterSunday);
  assert.deepEqual(easter, [
    '2008-03-23',
    '2024-03-31',
    '2025-04-20',
    '2026-04-05',
    '2027-03-28',
    '2028-04-16',
    '2038-04-25',
    '2285-03-22',
  ]);
  for (const date of [
    '2026-11-01',
    '2026-11-11',
    '2026-12-25',
    '2027-01-01',
    '2027-03-29', // lundi de Pâques, en mars
    '2027-05-06', // Ascension
    '2027-05-17', // lundi de Pentecôte
    '2027-05-01',
    '2027-05-08',
    '2027-07-14',
    '2027-08-15',
  ]) {
    assert.equal(isFrenchHoliday(date), true, date);
  }
  for (const date of ['2026-11-02', '2026-12-24', '2026-12-26', '2027-03-28', '2027-03-30']) {
    assert.equal(isFrenchHoliday(date), false, date);
  }
});

// REGRESSION N1 (recette du 2026-10-17) : le 1er novembre (Toussaint) comptait
// comme « rouge possible ».
test('rouge possible : du 1er novembre au 31 mars, hors week-ends et jours fériés', () => {
  const possible = {
    '2026-10-30': false, // octobre (R1)
    '2026-11-01': false, // dimanche et Toussaint
    '2026-11-02': true, // lundi
    '2026-11-11': false, // Armistice (mercredi)
    '2026-11-14': false, // samedi
    '2026-11-15': false, // dimanche
    '2026-12-25': false, // Noël
    '2027-01-01': false, // jour de l'an
    '2027-01-04': true,
    '2027-03-29': false, // lundi de Pâques
    '2027-03-31': true, // mercredi 31 mars
    '2027-04-01': false, // avril (R1)
  };
  for (const [date, expected] of Object.entries(possible)) {
    assert.equal(redPossible(date), expected, date);
  }
  // Novembre 2030 : le 1er tombe un vendredi, toujours férié.
  assert.equal(redPossible('2030-11-01'), false);
});
