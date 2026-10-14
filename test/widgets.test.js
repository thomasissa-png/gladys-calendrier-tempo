import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buildForecastWidget } from '../src/widgets.js';
import { buildTempoData } from '../src/tempo.js';
import { TOMORROW_PENDING, fixture, realPayloads } from './helpers.js';

function data(overrides = {}) {
  const p = { ...realPayloads(), ...overrides };
  return buildTempoData(p.today, p.tomorrow, p.remaining, p.predictions, '2026-10-14');
}

const byType = (content, type) => content.components.filter((c) => c.type === type);

for (const language of ['fr', 'en']) {
  test(`widget sur les réponses réelles (${language}) : rendu exactement tel qu'envoyé`, () => {
    const content = buildForecastWidget(data(), language);
    // [] = rien que Gladys ne retire, ne tronque ou ne coupe au budget.
    assert.deepEqual(validateWidgetContent(content), []);
    assert.equal(content.components.length, 8);
    assert.equal(byType(content, 'value').length, 4);
    assert.equal(byType(content, 'chart').length, 1);
    assert.equal(byType(content, 'status')[0].items.length, 10);
  });
}

test('widget : 15 jours de probabilité de rouge, couleurs sémantiques', () => {
  const content = buildForecastWidget(data(), 'fr');
  const [chart] = byType(content, 'chart');
  assert.equal(chart.series[0].points.length, 16, "aujourd'hui puis J+1 à J+15");
  assert.equal(chart.series[0].points.at(-1).t, '2026-10-29');
  const [today, tomorrow, reds, whites] = byType(content, 'value');
  assert.deepEqual([today.value.fr, today.color], ['Bleu', 'info']);
  assert.deepEqual([tomorrow.label.fr, tomorrow.value.fr], ['Demain', 'Bleu']);
  assert.deepEqual([reds.value, whites.value], [22, 43]);
  const [status] = byType(content, 'status');
  assert.equal(status.items[0].label, 'ven. 16 · J+2');
  assert.match(status.items[0].value, /^Bleu \d+ %$/);
  assert.equal(status.items[9].label, 'dim. 25 · J+11 (tendance)');
  // Le blanc réel prévu à J+15 est marqué sur le graphique.
  assert.deepEqual(chart.annotations, [
    {
      t: '2026-10-29',
      value: 0,
      label: { en: 'White forecast', fr: 'Blanc prévu' },
      color: 'neutral',
    },
  ]);
});

test('widget : rouge prévu signalé (scénario), demain avant l’annonce', () => {
  const predictions = fixture('predictions');
  Object.assign(predictions.predictions[3], { couleur_predite: 'ROUGE', probabilite_rouge: 0.7 });
  predictions.predictions[1].confirmed = false;
  const content = buildForecastWidget(data({ predictions, tomorrow: TOMORROW_PENDING }), 'fr');
  assert.deepEqual(validateWidgetContent(content), []);
  const [chart] = byType(content, 'chart');
  assert.deepEqual(chart.annotations[0], {
    t: '2026-10-17',
    value: 70,
    label: { en: 'Red forecast', fr: 'Rouge prévu' },
    color: 'danger',
  });
  const tomorrow = byType(content, 'value')[1];
  assert.equal(tomorrow.label.fr, 'Demain (prévision)');
  const [status] = byType(content, 'status');
  assert.deepEqual([status.items[1].value, status.items[1].color], ['Rouge 70 %', 'danger']);
});

test('widget sans données : état d’attente valide', () => {
  const content = buildForecastWidget(null, 'fr');
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(byType(content, 'value').length, 0);
});
