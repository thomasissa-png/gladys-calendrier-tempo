// Prix du kWh : lecture de la grille de /api/today et prix en cours (6 h / 22 h,
// minuit à 6 h = journée Tempo de la veille), sans aucun prix écrit en dur.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentPrice, dayPrices, parseTariffs } from '../src/tariffs.js';
import { parisWallTimeToInstant } from '../src/time.js';
import { TARIFS_API, fixture, withTariffs } from './helpers.js';

const GRID = parseTariffs(withTariffs(fixture('today')));

// Hier (13/10) ROUGE, aujourd'hui (14/10) BLANC : SCÉNARIO pour distinguer les journées.
const DATA = {
  yesterday: { date: '2026-10-13', color: 'rouge' },
  today: { date: '2026-10-14', color: 'blanc' },
  tomorrow: { date: '2026-10-15', color: 'bleu' },
  tariffs: GRID,
};
const at = (date, hour, minute = 0) => parisWallTimeToInstant(date, hour, minute);

test('grille lue telle que publiée (contrat du 2026-10-17)', () => {
  assert.deepEqual(GRID, {
    dateEffet: '2026-08-01',
    couleurs: {
      bleu: { hp: 0.1654, hc: 0.1356 },
      blanc: { hp: 0.1921, hc: 0.1536 },
      rouge: { hp: 0.7295, hc: 0.1615 },
    },
  });
});

test('API sans grille (ancienne réponse, attente, erreur) : aucun prix', () => {
  assert.equal(parseTariffs(fixture('today')), null, 'réponse réelle du 14/10, sans tarifs');
  assert.equal(parseTariffs(withTariffs(fixture('today'), { grid: false })), null, 'tarif seul');
  assert.equal(parseTariffs({ status: 'unavailable', tarifs: TARIFS_API }), null);
  assert.equal(parseTariffs(null), null);
  const otherUnit = {
    ...withTariffs(fixture('today')),
    tarifs: { ...TARIFS_API, unite: 'c€/kWh' },
  };
  assert.equal(parseTariffs(otherUnit), null, 'unité inattendue : prix inconnu');
  const broken = structuredClone(withTariffs(fixture('today')));
  broken.tarifs.couleurs.ROUGE.hp = '0,7295';
  assert.equal(parseTariffs(broken).couleurs.rouge, undefined, 'couleur invalide ignorée');
  assert.equal(currentPrice({ ...DATA, tariffs: null }, at('2026-10-14', 12)).price, null);
});

test('6 h : bascule HC de la veille → HP du jour', () => {
  const before = currentPrice(DATA, at('2026-10-14', 5, 59));
  assert.deepEqual(before, {
    date: '2026-10-13',
    color: 'rouge',
    period: 'hc',
    price: 0.1615,
    hp: 0.7295,
    hc: 0.1615,
  });
  const after = currentPrice(DATA, at('2026-10-14', 6, 0));
  assert.deepEqual(
    [after.date, after.color, after.period, after.price],
    ['2026-10-14', 'blanc', 'hp', 0.1921],
  );
});

test('22 h : bascule HP → HC de la même journée Tempo', () => {
  assert.equal(currentPrice(DATA, at('2026-10-14', 21, 59)).price, 0.1921);
  const night = currentPrice(DATA, at('2026-10-14', 22, 0));
  assert.deepEqual([night.color, night.period, night.price], ['blanc', 'hc', 0.1536]);
});

test('minuit à 6 h : la journée Tempo est encore celle de la veille', () => {
  // Le 15 à 0 h 30 : journée Tempo du 14 (blanc), heures creuses.
  const data = {
    ...DATA,
    yesterday: DATA.today,
    today: DATA.tomorrow,
    tomorrow: { date: '2026-10-16', color: null },
  };
  const p = currentPrice(data, at('2026-10-15', 0, 30));
  assert.deepEqual([p.date, p.color, p.period, p.price], ['2026-10-14', 'blanc', 'hc', 0.1536]);
  // Couleur de la veille inconnue : prix inconnu, jamais celui du nouveau jour.
  const unknown = { ...data, yesterday: { date: '2026-10-14', color: null } };
  assert.equal(currentPrice(unknown, at('2026-10-15', 0, 30)).price, null);
});

test('journée antérieure à la date d’effet de la grille : prix inconnu', () => {
  const grid = { ...GRID, dateEffet: '2026-10-14' };
  assert.equal(dayPrices(grid, '2026-10-13', 'rouge'), null);
  assert.deepEqual(dayPrices(grid, '2026-10-14', 'rouge'), { hp: 0.7295, hc: 0.1615 });
  assert.equal(dayPrices(GRID, '2026-10-14', null), null);
});
