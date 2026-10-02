import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { loadAssets, parseManifest } from '../src/render/assets.js';
import { ART, artNames, artProblem } from '../src/render3d/art-assets.js';
import {
  bitKinds, boardCells, DEFAULT_V3_META, flowerLooks, loadV3Meta, metaAnchor, parseV3Meta, PLANT_STAGES,
  stageStartMs, tileMode,
} from '../src/render3d/v3-meta.js';

const assetsDir = new URL('../assets/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', assetsDir), 'utf8'));
const entries = parseManifest(manifest);
const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
const rawMeta = JSON.parse(readFileSync(new URL('v3-meta.json', assetsDir), 'utf8'));
const meta = parseV3Meta(rawMeta, { warn: (message) => assert.fail(`v3-meta.json: ${message}`) });

const v3Entries = entries.filter((e) => e.file.startsWith('3d/v3/'));
const flowerNames = artNames(ART.v3.flower);

// Width and height of a PNG from its IHDR chunk.
function pngSize(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.toString('latin1', 1, 4), 'PNG', `${path} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('every v3 manifest entry points to a PNG of width x frames by height', () => {
  assert.ok(v3Entries.length >= 38, 'the v3 pack is in the manifest');
  for (const entry of v3Entries) {
    const path = new URL(entry.file, assetsDir);
    assert.ok(existsSync(path), `${entry.file} is missing`);
    const { width, height } = pngSize(path);
    assert.equal(width, entry.width * entry.frames, `${entry.name} width`);
    assert.equal(height, entry.height, `${entry.name} height`);
  }
});

test('the 3D loader table names every v3 entry, each with a fitting placeholder', () => {
  const v3 = new Set(artNames(ART.v3));
  assert.deepEqual([...v3].sort(), v3Entries.map((e) => e.name).sort());
  for (const name of v3) assert.equal(artProblem(name, byName[name]), null, name);
  assert.equal(flowerNames.length, 13);
});

test('every key in v3-meta.json exists in the manifest', () => {
  for (const name of Object.keys(rawMeta)) assert.ok(byName[name], `"${name}" is not in the manifest`);
  for (const name of Object.keys(DEFAULT_V3_META)) assert.ok(byName[name], `default "${name}" is not in the manifest`);
});

test('plant stage start times start at 0 and ascend, one per stage', () => {
  for (const name of artNames(ART.v3.plant)) {
    assert.ok(rawMeta[name]?.stageStartMs, `${name} has stage times in the file`);
    const times = stageStartMs(meta, name);
    assert.equal(times.length, PLANT_STAGES.length);
    assert.equal(times.length, byName[name].frames, `${name} has one frame per stage`);
    assert.equal(times[0], 0);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], `${name} stage ${i}`);
    assert.deepEqual(metaAnchor(meta, name), { x: 18, y: 36 });
  }
});

test('each flower sheet has as many frames as it has looks', () => {
  for (const name of flowerNames) {
    const looks = flowerLooks(meta, name);
    assert.ok(looks.length > 0, `${name} has looks`);
    assert.equal(byName[name].frames, looks.length, name);
    const anchor = metaAnchor(meta, name);
    assert.ok(anchor && anchor.x < byName[name].width && anchor.y < byName[name].height, `${name} anchor is inside the frame`);
  }
  assert.equal(flowerNames.reduce((n, name) => n + flowerLooks(meta, name).length, 0), 31, '13 kinds, 31 looks');
});

test('the other tuning data reads back', () => {
  assert.deepEqual(boardCells(meta, ART.v3.board.field), { cell: 32, gutter: 2, plot: 30 });
  assert.equal(tileMode(meta, ART.v3.curb), 'repeat-x');
  assert.equal(tileMode(meta, ART.v3.path), 'repeat-y');
  assert.equal(tileMode(meta, ART.v3.trees), null);
  assert.equal(bitKinds(meta, ART.v3.windBits).length, byName[ART.v3.windBits].frames);
  assert.equal(metaAnchor(meta, 'no-such-art'), null);
  assert.deepEqual(flowerLooks(meta, 'no-such-art'), []);
});

test('bad tuning data only warns and falls back to the defaults', () => {
  const warnings = [];
  const warn = (message) => warnings.push(message);
  const bad = parseV3Meta({
    'plant-x': { stageStartMs: [10, 5, 1, 2, 3], anchor: [1], extra: true },
    'plant-o': 'nope',
    'flower-daisy': { looks: [] },
  }, { warn });
  assert.equal(warnings.length, 5);
  assert.deepEqual(stageStartMs(bad, 'plant-x'), [0, 150, 450, 850, 1200]);
  assert.deepEqual(metaAnchor(bad, 'plant-x'), { x: 18, y: 36 });
  assert.deepEqual(stageStartMs(bad, 'plant-o'), [0, 150, 450, 850, 1200]);
  assert.deepEqual(flowerLooks(bad, 'flower-daisy'), []);
  assert.ok(parseV3Meta(null, { warn }));
  assert.deepEqual(stageStartMs(parseV3Meta([], { warn }), 'plant-x'), [0, 150, 450, 850, 1200]);
});

test('loadV3Meta never rejects when the file is missing', async () => {
  const warnings = [];
  const loaded = await loadV3Meta({
    fetchJson: async () => { throw new Error('404'); },
    warn: (message) => warnings.push(message),
  });
  assert.equal(warnings.length, 1);
  assert.deepEqual(stageStartMs(loaded, 'plant-o'), [0, 150, 450, 850, 1200]);
  const fine = await loadV3Meta({ fetchJson: async () => rawMeta, warn: () => assert.fail('no warning') });
  assert.deepEqual(flowerLooks(fine, 'flower-poppy'), ['Red', 'Orange', 'Coral']);
});

test('a missing or wrong-size v3 file only warns and leaves the asset to its placeholder', async () => {
  const warnings = [];
  const store = await loadAssets({
    fetchJson: async () => manifest,
    loadImage: async (url) => {
      if (url.endsWith('plant-x.png')) throw new Error('not found');
      const found = entries.find((e) => url === `assets/${e.file}`);
      if (found.name === ART.v3.clouds) return { width: 10, height: 10 }; // wrong size
      return { width: found.width * found.frames, height: found.height };
    },
    warn: (message) => warnings.push(message),
  });
  assert.equal(store.has(ART.v3.plant.X), false);
  assert.equal(store.has(ART.v3.clouds), false);
  assert.equal(store.has(ART.v3.plant.O), true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /clouds\.png is 10x10/);
});
