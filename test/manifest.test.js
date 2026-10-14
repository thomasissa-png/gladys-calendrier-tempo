// Cohérence entre `gladys-assistant-integration.json`, le code et les documents
// exigés par le catalogue (repris du modèle officiel, adapté).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { SCENE_TRIGGER_KEYS } from '../src/scenes.js';
import { createWidgets } from '../src/widgets.js';
import { USER_AGENT, VERSION } from '../src/constants.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('gladys-assistant-integration.json'));
const pkg = JSON.parse(await read('package.json'));
const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

test('type device, catégorie énergie, Gladys 5.1.0 minimum (widgets et scènes)', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.deepEqual(manifest.categories, ['energy']);
  assert.deepEqual(minGladysVersion(), [5, 1, 0]);
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});

test('aucun calendrier tarifaire ni contrat d’énergie (le calendrier « tempo » est au natif)', () => {
  assert.equal(manifest.energy_contracts, undefined);
});

test('chaque widget déclaré a son contenu, et inversement', () => {
  const declared = keysOf(manifest.widgets);
  const widgets = createWidgets(() => null);
  assert.deepEqual(Object.keys(widgets), declared);
  assert.ok(declared.length <= 5);
});

test('chaque déclencheur émis est déclaré, et inversement', () => {
  assert.deepEqual([...keysOf(manifest.scene_triggers)].sort(), [...SCENE_TRIGGER_KEYS].sort());
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields ?? []) {
      assert.ok(
        trigger.variables.some((v) => v.key === field.key),
        `${trigger.key}.${field.key} : un filtre doit aussi être une variable émise`,
      );
    }
  }
});

test('valeurs par défaut du manifeste = DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema.filter((f) => f.type !== 'section')) {
    assert.equal(DEFAULT_CONFIG[field.key], field.default, field.key);
  }
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('version identique partout, image étiquetée avec elle', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(VERSION, pkg.version);
  assert.equal(USER_AGENT, `CalendrierTempo-Gladys/${pkg.version}`);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('description du catalogue : 10 à 100 caractères par langue', () => {
  assert.ok(manifest.description.en);
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang} : ${text.length}`);
  }
});

test('documentation obligatoire : docs/fr.md et docs/en.md, 300 caractères minimum', async () => {
  for (const lang of ['fr', 'en']) {
    const text = await read(`docs/${lang}.md`);
    assert.ok(text.length >= 300, `docs/${lang}.md : ${text.length} caractères`);
  }
});

test('textes destinés aux utilisateurs : sans tiret cadratin ni taux de réussite', async () => {
  const files = ['README.md', 'docs/fr.md', 'docs/en.md', 'gladys-assistant-integration.json'];
  for (const file of files) {
    const text = await read(file);
    assert.doesNotMatch(text, /—/, `${file} : tiret cadratin`);
    assert.doesNotMatch(
      text,
      /\d+(?:[.,]\d+)?\s?%\s+de (?:réussite|bonnes)/i,
      `${file} : taux affiché`,
    );
  }
});

test('licence MIT au nom de Calendrier Tempo EDF', async () => {
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.author, 'Calendrier Tempo EDF');
  assert.match(await read('LICENSE'), /Copyright \(c\) 2026 Calendrier Tempo EDF/);
});
