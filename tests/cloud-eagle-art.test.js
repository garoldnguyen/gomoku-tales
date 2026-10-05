import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { CLOUD_SIZE, CLOUD_TURNS, COOLDOWN_LONG } from '../src/config.js';
import { CHARACTERS } from '../src/logic/characters.js';
import { loadAssets, parseManifest, USES_3D } from '../src/render/assets.js';
import {
  ART, ART_SLOTS, artNames, artProblem, CLOUD_EAGLE_ART_PX, PLACEHOLDERS_3D, placeholderShape,
} from '../src/render3d/art-assets.js';
import { installFakeDocument } from './fake-browser.js';

// art.js draws placeholders with Three.js helpers: 'three' is the vendored copy.
const hook = `
const root = ${JSON.stringify(new URL('../', import.meta.url).href)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: root + 'vendor/three/build/three.module.js', shortCircuit: true };
  return next(spec, ctx);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('assets/manifest.json'));
const byName = Object.fromEntries(parseManifest(manifest).map((e) => [e.name, e]));

// The Cloud Eagle art slots of the task, with their square frame sizes.
const SLOTS = {
  'cloud-eagle-avatar': 512,
  'cloud-eagle-hud': 256,
  'sky-watch-icon': 128,
  'cloud-icon': 128,
};

test('the Cloud Eagle manifest keys exist with their sizes, one still frame each, for the 3D game', () => {
  for (const [name, size] of Object.entries(SLOTS)) {
    const entry = byName[name];
    assert.ok(entry, `the manifest lacks "${name}"`);
    assert.equal(entry.use, '3d', name);
    assert.ok(USES_3D.includes(entry.use), `${name} is loaded by the 3D game`);
    assert.deepEqual([entry.width, entry.height, entry.frames, entry.frameMs], [size, size, 1, 0], name);
  }
});

test('the 3D loader table names the Cloud Eagle slots and has a placeholder of the same size for each', () => {
  assert.deepEqual(Object.values(ART.cloudEagle).sort(), Object.keys(SLOTS).sort());
  assert.deepEqual([...ART_SLOTS].sort(), Object.keys(SLOTS).sort());
  assert.ok(Object.keys(SLOTS).every((name) => artNames().includes(name)));
  for (const [name, size] of Object.entries(SLOTS)) {
    assert.equal(CLOUD_EAGLE_ART_PX[name], size, name);
    assert.ok(PLACEHOLDERS_3D[name]?.paint, `"${name}" has no placeholder`);
    assert.deepEqual(placeholderShape(name), { width: size, height: size, frames: 1 });
    assert.equal(artProblem(name, byName[name]), null);
  }
});

test('a missing Cloud Eagle file only warns and the 3D world draws its placeholder', async () => {
  const subset = { assets: Object.fromEntries(Object.keys(SLOTS).map((name) => [name, manifest.assets[name]])) };
  const store = await loadAssets({
    fetchJson: async () => subset,
    loadImage: async () => { throw new Error('404'); },
    uses: USES_3D,
  });
  for (const name of Object.keys(SLOTS)) assert.equal(store.has(name), false, name);
  installFakeDocument();
  const { artSource, setArtAssets } = await import('../src/render3d/art.js');
  const warnings = [];
  setArtAssets(store, { warn: (message) => warnings.push(message) });
  try {
    for (const [name, size] of Object.entries(SLOTS)) {
      const source = artSource(name);
      assert.deepEqual([source.width, source.height], [size, size], `${name} placeholder`);
    }
    assert.equal(warnings.length, Object.keys(SLOTS).length);
    for (const name of Object.keys(SLOTS)) assert.ok(warnings.some((w) => w.includes(name)), name);
  } finally {
    setArtAssets();
  }
});

test('the design doc lists the four characters, Cloud Eagle\'s skills and its numbers', () => {
  const design = read('docs/design.md');
  const section5 = design.slice(design.indexOf('## 5.'), design.indexOf('## 6.'));
  assert.match(section5, /There are four characters/);
  assert.equal(Object.keys(CHARACTERS).length, 4);
  for (const { name } of Object.values(CHARACTERS)) assert.ok(section5.includes(name), `section 5 lacks ${name}`);
  assert.match(section5, /### 5\.4 Cloud Eagle/);
  for (const text of ['SKY WATCH', 'CLOUD (', `${CLOUD_SIZE}x${CLOUD_SIZE}`, `CLOUD_TURNS = ${CLOUD_TURNS}`, `COOLDOWN_LONG = ${COOLDOWN_LONG}`]) {
    assert.ok(section5.includes(text), `section 5 lacks "${text}"`);
  }
  const section9 = design.slice(design.indexOf('## 9.'), design.indexOf('## 10.'));
  for (const text of ['Visual QA', 'Sky Watch', 'cloud', '#fff2a8']) assert.ok(section9.includes(text), `section 9 lacks "${text}"`);
  const flow = read('docs/flow-design.md');
  const select = flow.slice(flow.indexOf('### 3.5'), flow.indexOf('### 3.6'));
  assert.match(select, /Four character cards/);
  assert.ok(select.includes('Cloud Eagle'));
});
