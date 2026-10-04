import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { FOREST_SEED, MEADOW_SEED } from '../src/config.js';
import { loadAssets, parseManifest, USES_3D } from '../src/render/assets.js';
import { ART, artNames, artProblem } from '../src/render3d/art-assets.js';
import { installFakeDocument } from './fake-browser.js';
import {
  castsShadow, drawsForest, FOREST_KINDS, FOREST_ROWS, FOREST_SHADOW_RADIUS, FOREST_SPAN, FOREST_WALL_STRIPS,
  FOREST_WALL_WIDTH, forestInstanceGroups, forestShadowSpots, inForestZone, LOG_Z, planForest, skipForestZone,
  UNDERGROWTH, UNDERGROWTH_Z,
} from '../src/render3d/forest.js';
import {
  DEFAULT_FOREST_META, FOREST_META_URL, loadForestMeta, parseForestMeta, UNDERGROWTH_LOOKS, withForestMeta,
} from '../src/render3d/forest-meta.js';
import { FOREST_ROW_Z, FOREST_ZONE_Z, hazeAmount, WALL_BASE_Z } from '../src/render3d/haze.js';
import { CURB } from '../src/render3d/farm-layout.js';
import { meadowItems, planMeadow } from '../src/render3d/meadow.js';
import { QUALITY_LEVELS } from '../src/render3d/quality.js';
import { metaAnchor, parseV3Meta, tileMode } from '../src/render3d/v3-meta.js';

// art.js draws placeholders with Three.js helpers: 'three' is the vendored copy.
const hook = `
const root = ${JSON.stringify(new URL('../', import.meta.url).href)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: root + 'vendor/three/build/three.module.js', shortCircuit: true };
  return next(spec, ctx);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);

const { low, medium, high } = QUALITY_LEVELS;
const F = ART.v3.forest;
const FOREST_NAMES = [F.pine, F.oak, F.birch, F.poplar, F.wallRound, F.wallPine, F.undergrowth];

const assetsDir = new URL('../assets/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', assetsDir), 'utf8'));
const byName = Object.fromEntries(parseManifest(manifest).map((e) => [e.name, e]));
const rawForestMeta = JSON.parse(readFileSync(new URL('forest-meta.json', assetsDir), 'utf8'));

const plans = { low: planForest(low), medium: planForest(medium), high: planForest(high) };

function rowTrees(plan, row) {
  return plan.trees.filter((t) => t.row === row).sort((a, b) => a.x - b.x);
}

// --- planForest (docs/art-direction-v3-1.md section 6.9) ---

test('planForest is deterministic: the same output twice, seed 20261002', () => {
  assert.equal(FOREST_SEED, 20261002);
  for (const level of [low, medium, high]) assert.deepEqual(planForest(level), planForest(level));
  assert.deepEqual(planForest(high, FOREST_SEED), plans.high);
  assert.notDeepEqual(planForest(high, FOREST_SEED + 5).trees, plans.high.trees, 'the seed matters');
});

test('tree counts: High 190 to 240, Medium 80 to 110, Low none', () => {
  const count = (level) => plans[level].trees.length;
  assert.ok(count('high') >= 190 && count('high') <= 240, `High ${count('high')}`);
  assert.ok(count('medium') >= 80 && count('medium') <= 110, `Medium ${count('medium')}`);
  assert.equal(count('low'), 0);
  assert.deepEqual(plans.low, { trees: [], wall: [], undergrowth: [] }, 'Low draws nothing new');
});

test('rows: High has rows 1, 2, 3 at steps 1.03, 1.21, 1.54; Medium rows 1 and 3 at 1.54 and 2.32', () => {
  assert.deepEqual(FOREST_ROWS[high.treeRows], [[0, 1.03], [1, 1.21], [2, 1.54]]);
  assert.deepEqual(FOREST_ROWS[medium.treeRows], [[0, 1.54], [2, 2.32]]);
  assert.deepEqual([...new Set(plans.high.trees.map((t) => t.row))].sort(), [0, 1, 2]);
  assert.deepEqual([...new Set(plans.medium.trees.map((t) => t.row))].sort(), [0, 2]);
});

test('every tree base lies within 0.12 world units of its row depth', () => {
  for (const level of ['medium', 'high']) {
    for (const tree of plans[level].trees) {
      assert.ok(Math.abs(tree.z - FOREST_ROW_Z[tree.row]) <= 0.12, `${level} row ${tree.row}: ${tree.z}`);
    }
  }
});

test('every row runs from x -43 or less to 40 or more', () => {
  for (const level of ['medium', 'high']) {
    for (const [row] of FOREST_ROWS[QUALITY_LEVELS[level].treeRows]) {
      const trees = rowTrees(plans[level], row);
      assert.ok(trees[0].x <= -43, `${level} row ${row} starts at ${trees[0].x}`);
      assert.ok(trees[trees.length - 1].x >= 40, `${level} row ${row} ends at ${trees[trees.length - 1].x}`);
    }
  }
});

test('gaps vary: per row the gap deviation over the mean is 0.15 to 0.40, no two trees closer than 0.2', () => {
  for (const level of ['medium', 'high']) {
    for (const [row] of FOREST_ROWS[QUALITY_LEVELS[level].treeRows]) {
      const xs = rowTrees(plans[level], row).map((t) => t.x);
      const gaps = xs.slice(1).map((x, i) => x - xs[i]);
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
      assert.ok(sd / mean >= 0.15 && sd / mean <= 0.4, `${level} row ${row}: ${sd / mean}`);
      assert.ok(Math.min(...gaps) >= 0.2, `${level} row ${row}: ${Math.min(...gaps)}`);
    }
  }
});

test('kind shares follow the weights pine 3, oak 2, birch 1, poplar 2, old tree 1', () => {
  assert.deepEqual(FOREST_KINDS.map((k) => [k.sheet, k.weight]), [
    [F.pine, 3], [F.oak, 2], [F.birch, 1], [F.poplar, 2], [ART.v3.trees, 1],
  ]);
  const total = FOREST_KINDS.reduce((n, k) => n + k.weight, 0);
  for (const [level, tolerance] of [['high', 0.1], ['medium', 0.14]]) {
    const trees = plans[level].trees;
    for (const kind of FOREST_KINDS) {
      const share = trees.filter((t) => t.sheet === kind.sheet).length / trees.length;
      assert.ok(Math.abs(share - kind.weight / total) <= tolerance, `${level} ${kind.sheet}: ${share}`);
    }
  }
});

test('trees: about half mirrored, brightness 0.94 to 1.06, scale always 1, frames of their sheet', () => {
  for (const level of ['medium', 'high']) {
    const trees = plans[level].trees;
    const mirrored = trees.filter((t) => t.mirror).length / trees.length;
    assert.ok(mirrored >= 0.35 && mirrored <= 0.65, `${level} mirrored ${mirrored}`);
    for (const t of trees) {
      assert.equal(typeof t.mirror, 'boolean');
      assert.ok(t.brightness >= 0.94 && t.brightness <= 1.06, `brightness ${t.brightness}`);
      assert.equal(t.scale, 1);
      assert.ok(Number.isInteger(t.frame) && t.frame >= 0 && t.frame < byName[t.sheet].frames, `${t.sheet} frame ${t.frame}`);
      assert.equal(t.hazeAmount, hazeAmount(t.z));
    }
  }
  // Every frame of every kind shows somewhere on High.
  for (const kind of FOREST_KINDS) {
    const frames = new Set(plans.high.trees.filter((t) => t.sheet === kind.sheet).map((t) => t.frame));
    assert.equal(frames.size, byName[kind.sheet].frames, kind.sheet);
  }
});

test('the wall: 15 strips exactly 6.0 apart from -45 to 45, every third a pine strip, haze 0.42', () => {
  assert.equal(FOREST_WALL_WIDTH, 6);
  for (const level of ['medium', 'high']) {
    const wall = plans[level].wall;
    assert.equal(wall.length, FOREST_WALL_STRIPS);
    assert.equal(wall.length, 15);
    for (let i = 1; i < wall.length; i++) assert.equal(wall[i].x - wall[i - 1].x, 6);
    assert.equal(wall[0].x - FOREST_WALL_WIDTH / 2, -45);
    assert.equal(wall[wall.length - 1].x + FOREST_WALL_WIDTH / 2, 45);
    wall.forEach((strip, i) => {
      assert.equal(strip.sheet, (i + 1) % 3 === 0 ? F.wallPine : F.wallRound, `strip ${i}`);
      assert.equal(strip.z, WALL_BASE_Z);
      assert.equal(strip.scale, 1);
      assert.equal(strip.mirror, false);
      assert.ok(Math.abs(strip.hazeAmount - 0.42) < 1e-9);
    });
  }
  assert.equal(plans.low.wall.length, 0);
});

test('undergrowth: density times 88 within 20 percent, all seven looks on High, 3 and 1 logs and stumps', () => {
  assert.equal(FOREST_SPAN, 88);
  for (const level of ['medium', 'high']) {
    const items = plans[level].undergrowth;
    const regular = items.filter((u) => u.frame <= UNDERGROWTH.sapling);
    const want = QUALITY_LEVELS[level].undergrowth * 88;
    assert.ok(Math.abs(regular.length - want) <= want * 0.2, `${level}: ${regular.length} for ${want}`);
    for (const u of regular) {
      assert.ok(u.z >= UNDERGROWTH_Z[0] && u.z <= UNDERGROWTH_Z[1], `depth ${u.z}`);
      assert.ok(u.x >= -44 && u.x <= 44);
      assert.equal(u.sheet, F.undergrowth);
      assert.equal(u.scale, 1);
      assert.equal(u.hazeAmount, hazeAmount(u.z));
    }
    const logs = items.filter((u) => u.frame >= UNDERGROWTH.log);
    for (const u of logs) assert.ok(u.z >= LOG_Z[0] && u.z <= LOG_Z[1], `log depth ${u.z}`);
    assert.equal(logs.length, QUALITY_LEVELS[level].forestLogs);
  }
  assert.deepEqual([...new Set(plans.high.undergrowth.map((u) => u.frame).filter((f) => f <= 6))].sort(), [0, 1, 2, 3, 4, 5, 6]);
  const logLooks = (level) => plans[level].undergrowth.filter((u) => u.frame >= UNDERGROWTH.log).map((u) => u.frame);
  assert.deepEqual(logLooks('high'), [UNDERGROWTH.log, UNDERGROWTH.stump, UNDERGROWTH.log], 'log and stump take turns');
  assert.deepEqual(logLooks('medium'), [UNDERGROWTH.log]);
  assert.equal(plans.low.undergrowth.length, 0);
});

test('the whole forest stands inside the forest zone, behind the playable board and its curb', () => {
  const fieldBack = -(CURB.inner + CURB.width);
  for (const level of ['medium', 'high']) {
    const { trees, wall, undergrowth } = plans[level];
    for (const item of [...trees, ...wall, ...undergrowth]) {
      assert.ok(inForestZone(item.z), `${item.sheet} at z ${item.z}`);
      assert.ok(item.z < fieldBack - 0.5, `${item.sheet} at z ${item.z} is behind the field`);
    }
  }
});

test('one instanced mesh per sheet, 8 at most; shadows under trees and shrubs, saplings, logs, stumps only', () => {
  const groups = forestInstanceGroups(plans.high);
  assert.ok(groups.length <= 8, `${groups.length} meshes`);
  assert.equal(new Set(groups.map((g) => g.sheet)).size, groups.length, 'one per sheet');
  assert.deepEqual(groups.filter((g) => g.wall).map((g) => g.sheet).sort(), [F.wallPine, F.wallRound].sort());
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0),
    plans.high.trees.length + plans.high.wall.length + plans.high.undergrowth.length);
  assert.deepEqual(forestInstanceGroups(plans.low), []);
  for (const frame of [UNDERGROWTH.fern, UNDERGROWTH.fernSmall, UNDERGROWTH.tallGrass]) {
    assert.equal(castsShadow({ sheet: F.undergrowth, frame }), false);
  }
  for (const frame of [UNDERGROWTH.shrub, UNDERGROWTH.shrubBerries, UNDERGROWTH.shrubFlowers, UNDERGROWTH.sapling, UNDERGROWTH.log, UNDERGROWTH.stump]) {
    assert.equal(castsShadow({ sheet: F.undergrowth, frame }), true);
  }
  const spots = forestShadowSpots(plans.medium);
  assert.equal(spots.length, plans.medium.trees.length + plans.medium.undergrowth.filter(castsShadow).length);
  assert.ok(spots.every((s) => s.r === FOREST_SHADOW_RADIUS.tree || s.r === FOREST_SHADOW_RADIUS.undergrowth));
});

// --- The forest zone (section 6.7) ---

test('the forest zone helper skips meadow items inside the zone on Medium and High, keeps all on Low', () => {
  const plan = planMeadow(MEADOW_SEED);
  const before = meadowItems(plan);
  for (const level of [medium, high]) {
    const kept = meadowItems(skipForestZone(plan, level));
    assert.ok(kept.length < before.length, `${level.name} removes at least one item`);
    for (const item of kept) assert.ok(item.z >= FOREST_ZONE_Z, `${item.kind} at ${item.z} is inside the zone`);
    assert.ok(before.filter((i) => i.z >= FOREST_ZONE_Z).length === kept.length, 'everything outside the zone stays');
  }
  assert.equal(skipForestZone(plan, low), plan, 'Low keeps everything');
  assert.deepEqual(planMeadow(MEADOW_SEED), plan, 'planMeadow itself is unchanged by the helper');
  assert.equal(drawsForest(low), false);
  assert.equal(drawsForest(medium), true);
  assert.equal(drawsForest(high), true);
});

// --- Art and tuning data ---

test('the seven forest sheets are registered in ART.v3 with fitting placeholders and are loaded by the 3D game', () => {
  const v3 = new Set(artNames(ART.v3));
  for (const name of FOREST_NAMES) {
    assert.ok(v3.has(name), `${name} is in ART.v3`);
    assert.ok(byName[name], `${name} is in the manifest`);
    assert.ok(USES_3D.includes(byName[name].use), `${name} is loaded by the 3D game`);
    assert.equal(artProblem(name, byName[name]), null, name);
  }
  assert.ok(v3.has(ART.v3.trees), 'the old trees stay as one more kind');
});

test('every new manifest key loads; a missing one warns and does not crash', async () => {
  const subset = { assets: Object.fromEntries(FOREST_NAMES.map((name) => [name, manifest.assets[name]])) };
  const missing = manifest.assets[F.oak].file;
  const store = await loadAssets({
    fetchJson: async () => subset,
    loadImage: async (url) => {
      if (url.endsWith(missing)) throw new Error('404');
      const entry = Object.values(subset.assets).find((e) => url.endsWith(e.file));
      return { width: entry.width * entry.frames, height: entry.height, name: url };
    },
    uses: USES_3D,
  });
  for (const name of FOREST_NAMES) assert.equal(store.has(name), name !== F.oak, name);
  // The 3D world draws the loaded files and warns once for the missing one,
  // whose placeholder it draws instead.
  installFakeDocument();
  const { artSource, setArtAssets } = await import('../src/render3d/art.js');
  const warnings = [];
  setArtAssets(store, { warn: (message) => warnings.push(message) });
  try {
    for (const name of FOREST_NAMES) {
      const source = artSource(name);
      if (name === F.oak) assert.equal(source.width, byName[name].width * byName[name].frames, 'the placeholder has the sheet size');
      else assert.equal(source, store.get(name), name);
    }
    artSource(F.oak);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /tree-oak/);
  } finally {
    setArtAssets();
  }
});

test('forest-meta.json reads back without a warning, with the anchors of section 6.1', () => {
  const meta = parseForestMeta(rawForestMeta, { warn: (message) => assert.fail(message) });
  for (const name of Object.keys(rawForestMeta)) assert.ok(byName[name], `"${name}" is not in the manifest`);
  const merged = withForestMeta(parseV3Meta({}), meta);
  assert.deepEqual(metaAnchor(merged, F.pine), { x: 16, y: 62 });
  assert.deepEqual(metaAnchor(merged, F.oak), { x: 28, y: 56 });
  assert.deepEqual(metaAnchor(merged, F.birch), { x: 15, y: 56 });
  assert.deepEqual(metaAnchor(merged, F.poplar), { x: 11, y: 68 });
  assert.deepEqual(metaAnchor(merged, F.undergrowth), { x: 14, y: 21 });
  assert.equal(metaAnchor(merged, F.wallRound), null, 'the wall stands on its bottom edge');
  assert.equal(tileMode(merged, F.wallPine), 'repeat-x');
  assert.deepEqual(merged[F.undergrowth].looks, UNDERGROWTH_LOOKS);
  assert.equal(UNDERGROWTH_LOOKS.length, byName[F.undergrowth].frames);
  assert.ok(metaAnchor(merged, 'plant-x'), 'the v3 data stays');
  // The defaults are the same numbers, for a missing file.
  for (const [name, entry] of Object.entries(DEFAULT_FOREST_META)) {
    if (entry.anchor) assert.deepEqual(entry.anchor, rawForestMeta[name].anchor, name);
  }
});

test('a missing or broken forest-meta.json warns and gives the defaults', async () => {
  const warnings = [];
  const meta = await loadForestMeta({ fetchJson: async (url) => { throw new Error(`${url}: HTTP 404`); }, warn: (m) => warnings.push(m) });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], new RegExp(FOREST_META_URL.replace('.', '\\.')));
  assert.deepEqual(meta[F.pine].anchor, [16, 62]);
  const bad = parseForestMeta({ [F.oak]: { anchor: [1], wobble: 3 } }, { warn: (m) => warnings.push(m) });
  assert.deepEqual(bad[F.oak].anchor, [28, 56], 'a bad anchor keeps the default');
  assert.equal(warnings.length, 3);
  assert.doesNotThrow(() => parseForestMeta(null));
});

// --- The quality table (section 7) ---

test('quality table: tree rows 0, 2, 3; undergrowth 0, 2.1, 3.2; wall off, on, on; logs 0, 1, 3', () => {
  assert.deepEqual([low, medium, high].map((l) => l.treeRows), [0, 2, 3]);
  assert.deepEqual([low, medium, high].map((l) => l.undergrowth), [0, 2.1, 3.2]);
  assert.deepEqual([low, medium, high].map((l) => l.forestWall), [false, true, true]);
  assert.deepEqual([low, medium, high].map((l) => l.forestLogs), [0, 1, 3]);
  assert.deepEqual([low, medium, high].map((l) => l.shadows), ['none', 'blob', 'sun'], 'tree shadows: none, blob, long sun');
});

test('the forest code tests no level name and scales nothing', () => {
  for (const file of ['forest.js', 'forest-scene.js', 'forest-meta.js']) {
    const source = readFileSync(new URL(`../src/render3d/${file}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(source, /['"`](low|medium|high)['"`]/, `${file} names a level`);
    assert.doesNotMatch(source, /\.name\s*===/, `${file} tests a level name`);
  }
  const scene = readFileSync(new URL('../src/render3d/forest-scene.js', import.meta.url), 'utf8');
  assert.match(scene, /InstancedMesh/);
  assert.match(scene, /alphaTest: SPRITE_ALPHA_TEST/, 'cut-out alpha with depth writes');
  assert.doesNotMatch(scene, /transparent: true/);
  assert.match(scene, /placeUprightInstances/, 'the meadow trees\' placement path');
});
