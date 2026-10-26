import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buildForecastWidget } from '../src/widgets.js';
import { buildTempoData, percent, secondColor } from '../src/tempo.js';
import { calendrierTempo, FEATURE } from '../src/devices/calendrierTempo.js';
import { parseTariffs } from '../src/tariffs.js';
import { parisWallTimeToInstant } from '../src/time.js';
import {
  RECORDED_AT,
  TOMORROW_PENDING,
  fixture,
  realPayloads,
  seasonPayloads,
  withTariffs,
} from './helpers.js';

function data(overrides = {}) {
  const p = { ...realPayloads(), ...overrides };
  return buildTempoData(p.today, p.tomorrow, p.remaining, p.predictions, '2026-10-14');
}

/**
 * SCÉNARIO de saison : 2 décembre 2026 (mercredi), probabilités de rouge posées
 * sur des jours ouvrés seulement (R2 : 0 % le samedi 5, le dimanche 6...).
 */
const RED_SCENARIO = { 2: 0.15, 5: 0.72, 6: 0.55, 7: 0.4, 8: 0.62, 9: 0.2, 12: 0.48, 15: 0.25 };
function seasonData(redByOffset = RED_SCENARIO) {
  const p = seasonPayloads(49, redByOffset);
  return buildTempoData(p.today, p.tomorrow, p.remaining, p.predictions, p.referenceDate);
}

const byType = (content, type) => content.components.filter((c) => c.type === type);
const bodyTexts = (content) => byType(content, 'text').filter((c) => c.variant === 'body');

for (const language of ['fr', 'en']) {
  test(`widget sur les réponses réelles (${language}) : rendu exactement tel qu'envoyé`, () => {
    const content = buildForecastWidget(data(), language, RECORDED_AT);
    // [] = rien que Gladys ne retire, ne tronque ou ne coupe au budget.
    assert.deepEqual(validateWidgetContent(content), []);
    assert.equal(content.components.length, 8);
    assert.equal(byType(content, 'value').length, 4);
    assert.equal(byType(content, 'status')[0].items.length, 10);
  });

  test(`widget de saison (${language}) : graphique valide, dans le budget`, () => {
    const content = buildForecastWidget(seasonData(), language, RECORDED_AT);
    assert.deepEqual(validateWidgetContent(content), []);
    assert.equal(content.components.length, 8);
    assert.equal(byType(content, 'chart').length, 1);
  });
}

// REGRESSION : échelle « 0 à 2 » du graphique (demande du forum Gladys, 2026-10-17).
// Les valeurs étaient déjà en %, mais Gladys calait l'axe sur les données.
test('graphique : probabilités en % (entiers 0 à 100), axe ancré sur 0 et 100', () => {
  const [chart] = byType(buildForecastWidget(seasonData(), 'fr'), 'chart');
  assert.equal(chart.chart_type, 'area', 'une courbe : axe du minimum au maximum des séries');
  assert.equal(chart.unit, '%');
  const [other, red] = chart.series;
  assert.deepEqual([other.name.fr, red.name.fr], ['Bleu ou blanc', 'Rouge']);
  assert.equal(red.points.length, 16, "aujourd'hui puis J+1 à J+15");
  assert.equal(red.points.find((p) => p.t === '2026-12-07').v, 72, '0,72 → 72 %, pas 0,72');
  for (const [index, point] of red.points.entries()) {
    assert.ok(Number.isInteger(point.v) && point.v >= 0 && point.v <= 100, `${point.t}`);
    assert.equal(point.v + other.points[index].v, 100, `${point.t} : p + (100 - p)`);
    assert.equal(other.points[index].t, point.t);
  }
  const all = chart.series.flatMap((s) => s.points.map((p) => p.v));
  assert.equal(Math.min(...all), 0, 'ancre basse : axe à 0');
  assert.equal(Math.max(...all), 100, 'ancre haute : axe à 100, jamais 2 ni 150');
});

test('graphique : jour officiel rouge à 100 %, ancres toujours 0 et 100', () => {
  const p = seasonPayloads(49, RED_SCENARIO);
  Object.assign(p.today, { couleur: 'ROUGE', code: 3 });
  Object.assign(p.tomorrow, { couleur: 'ROUGE', code: 3 });
  const d = buildTempoData(p.today, p.tomorrow, p.remaining, p.predictions, p.referenceDate);
  const [chart] = byType(buildForecastWidget(d, 'fr'), 'chart');
  assert.deepEqual(chart.series[1].points[0], { t: '2026-12-02', v: 100 });
  assert.deepEqual(chart.series[0].points[0], { t: '2026-12-02', v: 0 });
  assert.equal(chart.title.fr, 'Probabilité de rouge, en % (15 jours)', '% dans le titre');
  // Une seule marque, sur demain : celle d'aujourd'hui mordait sur les graduations.
  assert.deepEqual(chart.annotations, [
    { t: '2026-12-03', value: 100, label: { en: 'Red', fr: 'Rouge' }, color: 'danger' },
  ]);
});

// REGRESSION KO-2 (recette du 2026-10-17) : à 375 px, les étiquettes « Rouge
// prévu » se chevauchaient dès que deux rouges prévus avaient moins de 5 jours
// d'écart (8 marques au plus). Une seule marque désormais : jamais de chevauchement.
test('graphique : une marque au plus, sur demain officiel, jamais sur un jour prévu', () => {
  const cluster = { 2: 0.8, 3: 0.75, 4: 0.7, 5: 0.72, 6: 0.9, 7: 0.85, 8: 0.62, 9: 0.6, 12: 0.7 };
  const p = seasonPayloads(49, cluster);
  Object.assign(p.today, { couleur: 'BLANC', code: 2 });
  Object.assign(p.tomorrow, { couleur: 'ROUGE', code: 3 });
  const d = buildTempoData(p.today, p.tomorrow, p.remaining, p.predictions, p.referenceDate);
  assert.ok(d.days.filter((day) => !day.official && day.color === 'rouge').length >= 8);
  for (const language of ['fr', 'en']) {
    const content = buildForecastWidget(d, language);
    assert.deepEqual(validateWidgetContent(content), []);
    const [chart] = byType(content, 'chart');
    assert.deepEqual(chart.annotations, [
      { t: '2026-12-03', value: 100, label: { en: 'Red', fr: 'Rouge' }, color: 'danger' },
    ]);
  }
  // Demain officiel blanc : marque « Blanc » à 0 ; demain bleu : aucune marque.
  Object.assign(p.tomorrow, { couleur: 'BLANC', code: 2 });
  const white = buildTempoData(p.today, p.tomorrow, p.remaining, p.predictions, p.referenceDate);
  const [whiteChart] = byType(buildForecastWidget(white, 'fr'), 'chart');
  assert.deepEqual(whiteChart.annotations, [
    { t: '2026-12-03', value: 0, label: { en: 'White', fr: 'Blanc' }, color: 'neutral' },
  ]);
  Object.assign(p.tomorrow, { couleur: 'BLEU', code: 1 });
  const blue = buildTempoData(p.today, p.tomorrow, p.remaining, p.predictions, p.referenceDate);
  assert.equal(byType(buildForecastWidget(blue, 'fr'), 'chart')[0].annotations, undefined);
});

test('graphique : demain avant l’annonce, aucune marque sur les rouges prévus', () => {
  const p = seasonPayloads(49, RED_SCENARIO);
  p.predictions.predictions[1].confirmed = false;
  const d = buildTempoData(p.today, TOMORROW_PENDING, p.remaining, p.predictions, p.referenceDate);
  const content = buildForecastWidget(d, 'fr');
  assert.deepEqual(validateWidgetContent(content), []);
  const [chart] = byType(content, 'chart');
  assert.equal(chart.annotations, undefined);
  assert.equal(chart.series[1].points.find((pt) => pt.t === '2026-12-07').v, 72);
  assert.equal(byType(content, 'value')[1].label.fr, 'Demain (prévision)');
  const [status] = byType(content, 'status');
  assert.deepEqual([status.items[3].label, status.items[3].value], ['lun. 7 · J+5', 'Rouge 72 %']);
  assert.equal(status.items[3].color, 'danger');
});

test('état vide : pas de graphique avant le 1er novembre, message court à la place', () => {
  for (const language of ['fr', 'en']) {
    const content = buildForecastWidget(data(), language, RECORDED_AT);
    assert.equal(byType(content, 'chart').length, 0, 'aucun graphique vide');
    assert.deepEqual(bodyTexts(content)[0].text, {
      en: 'No red day possible before 1 November.',
      fr: 'Pas de jour rouge possible avant le 1er novembre.',
    });
  }
});

test('état vide : même message du 1er avril au 31 octobre, graphique dès que novembre entre', () => {
  // Horizon du 1er au 16 avril : aucun rouge possible (R1).
  const april = seasonPayloads(169);
  assert.equal(april.referenceDate, '2027-04-01');
  const a = buildTempoData(
    april.today,
    april.tomorrow,
    april.remaining,
    april.predictions,
    april.referenceDate,
  );
  assert.equal(byType(buildForecastWidget(a, 'fr'), 'chart').length, 0);
  assert.equal(
    bodyTexts(buildForecastWidget(a, 'fr'))[0].text.fr.slice(0, 26),
    'Pas de jour rouge possible',
  );
  // Horizon du 21 octobre au 5 novembre : le graphique revient.
  const late = seasonPayloads(7);
  const l = buildTempoData(
    late.today,
    late.tomorrow,
    late.remaining,
    late.predictions,
    '2026-10-21',
  );
  assert.equal(byType(buildForecastWidget(l, 'fr'), 'chart').length, 1);
});

// REGRESSION N1 (recette du 2026-10-17) : le 17/10, l'horizon finit le dimanche
// 1er novembre (Toussaint) : aucun rouge possible, le message et non un graphique plat.
test('état vide : horizon qui finit le 1er novembre (dimanche, Toussaint), message', () => {
  const p = seasonPayloads(3); // réponses du 14/10 décalées : horizon du 17/10 au 01/11
  const d = buildTempoData(p.today, p.tomorrow, p.remaining, p.predictions, '2026-10-17');
  assert.equal(d.days.at(-1).date, '2026-11-01');
  const content = buildForecastWidget(d, 'fr');
  assert.equal(byType(content, 'chart').length, 0);
  assert.equal(bodyTexts(content)[0].text.fr, 'Pas de jour rouge possible avant le 1er novembre.');
  // Le 18/10, l'horizon atteint le lundi 2 novembre : le graphique revient.
  const next = seasonPayloads(4);
  const n = buildTempoData(
    next.today,
    next.tomorrow,
    next.remaining,
    next.predictions,
    '2026-10-18',
  );
  assert.equal(n.days.at(-1).date, '2026-11-02');
  assert.equal(byType(buildForecastWidget(n, 'fr'), 'chart').length, 1);
});

test('état vide générique : aucune donnée de prévision', () => {
  const empty = { status: 'ok', predictions: [] };
  const unknown = { status: 'unavailable' };
  const d = buildTempoData(unknown, unknown, fixture('remaining'), empty, '2026-12-02');
  const content = buildForecastWidget(d, 'fr');
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(byType(content, 'chart').length, 0);
  assert.equal(bodyTexts(content)[0].text.fr, 'Aucune prévision disponible pour le moment.');
});

test('widget : prix actuel en tête de liste (HP de 6 h à 22 h, HC sinon)', () => {
  const today = withTariffs(fixture('today'));
  const d = { ...data({ today }), tariffs: parseTariffs(today) };
  const at = (hour, minute = 0) => parisWallTimeToInstant('2026-10-14', hour, minute);
  const items = (language, instant) =>
    byType(buildForecastWidget(d, language, instant), 'status')[0].items;
  const fr = items('fr', at(14, 43));
  assert.deepEqual(fr[0], {
    label: 'Prix actuel',
    value: '0,1654 €/kWh (HP, bleu)',
    color: 'info',
  });
  assert.equal(fr.length, 10, 'prix + J+2 à J+10');
  assert.equal(fr.at(-1).label, 'sam. 24 · J+10', 'plus de « (tendance) »');
  assert.equal(items('fr', at(22, 0))[0].value, '0,1356 €/kWh (HC, bleu)');
  assert.equal(items('en', at(10, 0))[0].value, '€0.1654/kWh (peak, blue)');
  assert.deepEqual(validateWidgetContent(buildForecastWidget(d, 'fr', at(14, 43))), []);
});

test('widget : sans grille de prix (ancienne réponse), aucune ligne de prix', () => {
  const d = { ...data(), tariffs: null };
  const [status] = byType(buildForecastWidget(d, 'fr', RECORDED_AT), 'status');
  assert.equal(status.items.length, 10);
  assert.ok(status.items.every((item) => !item.label.startsWith('Prix')));
  assert.equal(status.items[9].label, 'dim. 25 · J+11');
});

test('widget sans données : état d’attente valide', () => {
  const content = buildForecastWidget(null, 'fr');
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(byType(content, 'value').length, 0);
});

// -----------------------------------------------------------------------------
// Hésitation (0.3.0) : même règle que le site (incertitude.py) et le composant
// Home Assistant 0.3.1. SCÉNARIOS (pas des données réelles) : une prévision des
// réponses du 14/10 remplacée par des probabilités choisies.
// -----------------------------------------------------------------------------

const NBSP = ' '; // espace insécable (U+00A0), comme le site
const UNCERTAINTY_FIELDS = ['hesitation', 'seconde_couleur', 'tendance', 'libelle'];

function withForecast(date, fields) {
  const predictions = fixture('predictions');
  const item = predictions.predictions.find((p) => p.date === date);
  for (const key of UNCERTAINTY_FIELDS) {
    delete item[key];
  }
  Object.assign(item, fields);
  return data({ predictions });
}

const rowFor = (d, offset, language = 'fr') =>
  byType(buildForecastWidget(d, language, RECORDED_AT), 'status')[0].items.find((item) =>
    item.label.endsWith(`J+${offset}`),
  );

const WHITE_OR_BLUE = {
  couleur_predite: 'BLANC',
  probabilite_bleu: 0.45,
  probabilite_blanc: 0.5,
  probabilite_rouge: 0.05,
};
const API_WHITE_OR_BLUE = {
  hesitation: true,
  seconde_couleur: 'BLEU',
  tendance: false,
  libelle: `Blanc ou bleu${NBSP}?`,
};

test('hésitation (champs de l’API) : libellé, puis les deux pourcentages', () => {
  const d = withForecast('2026-10-16', { ...WHITE_OR_BLUE, ...API_WHITE_OR_BLUE });
  assert.deepEqual(rowFor(d, 2, 'fr'), {
    label: 'ven. 16 · J+2',
    value: `Blanc ou bleu${NBSP}? 50 % / 45 %`,
    color: 'neutral',
  });
  assert.deepEqual(rowFor(d, 2, 'en'), {
    label: 'Fri 16 · J+2',
    value: 'White or blue? 50% / 45%',
    color: 'neutral',
  });
  for (const language of ['fr', 'en']) {
    assert.deepEqual(validateWidgetContent(buildForecastWidget(d, language, RECORDED_AT)), []);
  }
});

test('hésitation : les champs de l’API priment sur le calcul local', () => {
  const d = withForecast('2026-10-16', { ...WHITE_OR_BLUE, hesitation: false, libelle: 'Blanc' });
  assert.equal(rowFor(d, 2).value, 'Blanc 50 %');
  // Champs incohérents (seconde couleur = couleur prévue) : calcul local.
  const odd = withForecast('2026-10-16', {
    ...WHITE_OR_BLUE,
    ...API_WHITE_OR_BLUE,
    seconde_couleur: 'BLANC',
  });
  assert.equal(rowFor(odd, 2).value, `Blanc ou bleu${NBSP}? 50 % / 45 %`);
});

test('secours sans champs (ancienne API, cache) : même règle que le site', () => {
  const d = withForecast('2026-10-16', WHITE_OR_BLUE);
  assert.equal(rowFor(d, 2).value, `Blanc ou bleu${NBSP}? 50 % / 45 %`);
  assert.equal(rowFor(d, 2, 'en').value, 'White or blue? 50% / 45%');
  // Arrondi « demi vers le haut » : 0,505 → 51, 0,285 → 29 (Math.round donnerait 28).
  const rounded = withForecast('2026-10-16', {
    couleur_predite: 'BLEU',
    probabilite_bleu: 0.505,
    probabilite_blanc: 0.285,
    probabilite_rouge: 0.21,
  });
  assert.equal(rowFor(rounded, 2).value, `Bleu ou blanc${NBSP}? 51 % / 29 %`);
  assert.equal(percent(0.285), 29);
  assert.equal(percent(0.505), 51);
  assert.equal(percent(0.125), 13);
  // Les fixtures réelles du 14/10 n'ont pas les champs : aucun jour J+2 à J+11 n'hésite.
  assert.ok(
    byType(buildForecastWidget(data(), 'fr', RECORDED_AT), 'status')[0].items.every(
      (item) => !item.value.includes(' ou ') && !item.value.includes('/'),
    ),
  );
});

test('secours : seuils exacts (écart 0,30 et seconde 0,15 exclus), égalité bleu avant rouge', () => {
  const day = (color, probas) => ({
    official: false,
    offset: 3,
    color,
    attributes: Object.fromEntries(Object.entries(probas).map(([c, p]) => [`probabilite_${c}`, p])),
  });
  assert.equal(secondColor(day('bleu', { bleu: 0.7, blanc: 0.4, rouge: 0 })), null, '0,30 pile');
  assert.equal(secondColor(day('bleu', { bleu: 0.69, blanc: 0.4, rouge: 0 })), 'blanc');
  assert.equal(secondColor(day('blanc', { bleu: 0.15, blanc: 0.3, rouge: 0.1 })), null, '0,15');
  assert.equal(secondColor(day('blanc', { bleu: 0.3, blanc: 0.4, rouge: 0.3 })), 'bleu');
  assert.equal(secondColor(day('blanc', { blanc: 0.5 })), null, 'probabilités absentes');
});

test('jour officiel : jamais d’hésitation, même si l’API en signale une', () => {
  const d = withForecast('2026-10-16', { ...WHITE_OR_BLUE, ...API_WHITE_OR_BLUE, confirmed: true });
  assert.equal(rowFor(d, 2).value, 'Blanc (officielle)');
  assert.equal(rowFor(d, 2, 'en').value, 'White (official)');
  assert.equal(secondColor(d.days.find((day) => day.offset === 2)), null);
});

test('jour lointain : plus de « tendance » ni « trend », l’hésitation reste montrée', () => {
  const far = withForecast('2026-10-24', {
    tendance: true,
    hesitation: false,
    seconde_couleur: null,
    // Un libellé « Tendance » de l'API ne serait jamais affiché.
    libelle: 'Tendance bleu',
  });
  assert.deepEqual(rowFor(far, 10), { label: 'sam. 24 · J+10', value: 'Bleu 99 %', color: 'info' });
  for (const language of ['fr', 'en']) {
    const text = JSON.stringify(buildForecastWidget(far, language, RECORDED_AT));
    assert.doesNotMatch(text, /tendance|trend/i, language);
  }
  const hesitant = withForecast('2026-10-23', {
    couleur_predite: 'BLEU',
    probabilite_bleu: 0.5,
    probabilite_blanc: 0.45,
    probabilite_rouge: 0.05,
    hesitation: true,
    seconde_couleur: 'BLANC',
    tendance: true,
    libelle: `Bleu ou blanc${NBSP}?`,
  });
  assert.deepEqual(rowFor(hesitant, 9), {
    label: 'ven. 23 · J+9',
    value: `Bleu ou blanc${NBSP}? 50 % / 45 %`,
    color: 'info',
  });
});

test('valeur principale : couleur_predite inchangée (point, fonctionnalités, scènes)', () => {
  const d = withForecast('2026-10-16', { ...WHITE_OR_BLUE, ...API_WHITE_OR_BLUE });
  assert.equal(d.days.find((day) => day.offset === 2).color, 'blanc');
  assert.equal(rowFor(d, 2).color, 'neutral', 'point de la ligne : blanc, la couleur prévue');
  const gladys = { externalIds: () => ({ device: 'appareil', feature: (key) => key }) };
  const states = calendrierTempo.buildStates(gladys, d, RECORDED_AT, {
    previsions_indicatives: false,
  });
  const j2 = states.find((s) => s.device_feature_external_id === FEATURE.forecast(2));
  assert.equal(j2.text, 'blanc');
});
