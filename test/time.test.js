import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  daysBetween,
  nextParisTime,
  parisParts,
  parisWallTimeToInstant,
  parseIsoDate,
} from '../src/time.js';
import { RECORDED_AT } from './helpers.js';

test('heure de Paris, quel que soit le fuseau du conteneur', () => {
  assert.deepEqual(parisParts(RECORDED_AT), {
    date: '2026-10-14',
    hour: 14,
    minute: 43,
    second: 41,
  });
  // Heure d'hiver : UTC+1.
  assert.equal(parisParts(Date.parse('2026-12-07T23:30:00Z')).date, '2026-12-08');
});

test('prochain 0 h 05 et 11 h 35 heure de Paris', () => {
  assert.equal(
    new Date(nextParisTime(RECORDED_AT, 0, 5)).toISOString(),
    '2026-10-14T22:05:00.000Z',
  );
  assert.equal(
    new Date(nextParisTime(RECORDED_AT, 11, 35)).toISOString(),
    '2026-10-15T09:35:00.000Z',
  );
  // Strictement après : à 11 h 35 pile, le prochain est le lendemain.
  const at = parisWallTimeToInstant('2026-10-15', 11, 35);
  assert.equal(nextParisTime(at, 11, 35), parisWallTimeToInstant('2026-10-16', 11, 35));
});

test('changement d’heure du 25 octobre 2026', () => {
  // Samedi 24 à 12 h (UTC+2) : le 6 h du dimanche 25 est déjà à l'heure d'hiver (UTC+1).
  const saturday = Date.parse('2026-10-24T10:00:00Z');
  assert.equal(new Date(nextParisTime(saturday, 6, 0)).toISOString(), '2026-10-25T05:00:00.000Z');
  assert.equal(new Date(nextParisTime(saturday, 0, 5)).toISOString(), '2026-10-24T22:05:00.000Z');
  // Printemps : dimanche 28 mars 2027, 6 h = 4 h UTC.
  assert.equal(
    new Date(parisWallTimeToInstant('2027-03-28', 6, 0)).toISOString(),
    '2027-03-28T04:00:00.000Z',
  );
});

test('dates ISO', () => {
  assert.equal(parseIsoDate('2026-10-14T09:31:14+02:00'), '2026-10-14');
  assert.equal(parseIsoDate('2026-02-30'), null);
  assert.equal(parseIsoDate(20261014), null);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-10-25', -1), '2026-10-24');
  assert.equal(daysBetween('2026-10-14', '2026-10-29'), 15);
});
