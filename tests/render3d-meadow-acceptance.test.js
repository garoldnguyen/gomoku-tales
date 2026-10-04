// Acceptance check of docs/art-direction-v3.md section 6 (meadow, flowers
// and scenery), one test per item of the Farmland v3 part 5b task. The
// rendering itself (meadow-scene.js, sprites.js) cannot run under Node; the
// tests check the pure plan, wind and data it draws from, and that the
// scene reads them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DANDELION_FLECK_MS, DANDELION_FLECK_POOL, GUST_EVERY_MS, GUST_MS, MEADOW_BALES, MEADOW_BUSHES, MEADOW_MARGIN,
  MEADOW_PATCH_PLANTS, MEADOW_SEED, MEADOW_SPACING, MEADOW_TREE_BRIGHTNESS, MEADOW_TREES_BACK, MEADOW_TREES_SIDE,
  MEADOW_TREES_BACK_MAX, MEADOW_TUFTS, PLANT_SWAY_SHARE, PX_WORLD, SPRITE_STRETCH_Y, SWAY_CALM_PX, SWAY_GUST_PX, WIND_DIR,
} from '../src/config.js';
import { placeholderShape } from '../src/render3d/art-assets.js';
import { gameCamera, projectToNdc } from '../src/render3d/camera.js';
import { SIDE_TREE_MAX_Z, TREE_ROW_Z } from '../src/render3d/horizon.js';
import { CURB, FIELD, fencePosts, fenceRails, PATH } from '../src/render3d/farm-layout.js';
import {
  dandelionPuffs, EDGE_GAP, FAR_HILLS, flowerSpecies, FLOWER_SPECIES, hazeMix, hillLift, isKeptOut, LOW_FRONT_Z,
  MEADOW_BOUNDS, meadowInstanceGroups, meadowItems, meadowKeepOut, meadowShadowSpots, planMeadow, showsBehindCalm,
  TALL_MAX_Z, TREE_LOOKS,
} from '../src/render3d/meadow.js';
import { QUALITY_LEVELS } from '../src/render3d/quality.js';
import { seededRandom } from '../src/render3d/seeded-random.js';
import {
  createGustClock, createPuffReleases, fleckSpeed, plantSwayAmplitudePx, plantSwayLeanPx, swayAmplitudePx, swayLeanPx, swayRowFraction,
  WIND_GROUND,
} from '../src/render3d/wind.js';

const SEEDS = [MEADOW_SEED, 1, 2, 3, 77, 4242];
const plans = new Map(SEEDS.map((seed) => [seed, planMeadow(seed)]));
const plan = plans.get(MEADOW_SEED);
const keepOut = meadowKeepOut();
const FIELD_EDGE = CURB.inner + CURB.width; // the outer edge of the curb
const WEIGHTS = {
  daisy: 3, tulip: 3, bluebell: 3, poppy: 3, cosmos: 2, marigold: 2, lavender: 2,
  forgetmenot: 2, dandelion: 2, hollyhock: 1.5, mushroom: 1.5, sunflower: 1,
};
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const near = (patch, item) => Math.hypot(item.x - patch.x, item.z - patch.z) <= (patch.radius + EDGE_GAP[1]) * 1.25 + 1e-9;

test('(1) about 36 patches of 5 to 14 plants of exactly one species', () => {
  assert.equal(plan.patches.length, 36);
  for (const [seed, p] of plans) {
    assert.ok(p.patches.length >= 33 && p.patches.length <= 36, `seed ${seed}: ${p.patches.length}`);
    for (const patch of p.patches) {
      assert.equal(typeof patch.species, 'string'); // one species per patch, its plants carry no other
      assert.ok(flowerSpecies(patch.species)?.weight > 0);
      assert.ok(patch.plants.length >= MEADOW_PATCH_PLANTS[0] && patch.plants.length <= MEADOW_PATCH_PLANTS[1]);
      for (const plant of patch.plants) assert.deepEqual(Object.keys(plant).sort(), ['look', 'x', 'z']);
    }
  }
  assert.deepEqual(MEADOW_PATCH_PLANTS, [5, 14]);
});

test('(2) every patch uses all the looks of its species, clover and grass tufts fill its edge', () => {
  for (const [seed, p] of plans) {
    for (const patch of p.patches) {
      const looks = new Set(patch.plants.map((plant) => plant.look));
      assert.equal(looks.size, flowerSpecies(patch.species).looks, `seed ${seed}: ${patch.species}`);
      // Clover and a tuft just outside the patch, not inside it.
      const edge = (item) => near(patch, item) && Math.hypot(item.x - patch.x, item.z - patch.z) > patch.radius * 0.85 * 0.99;
      assert.ok(p.clover.some(edge), `seed ${seed}: clover at the edge of a ${patch.species} patch`);
      assert.ok(p.tufts.some(edge), `seed ${seed}: a tuft at the edge of a ${patch.species} patch`);
    }
  }
});

test('(3) nothing in the keep-out area and no flower on a plot', () => {
  // The keep-out area: field, curb, fence line and path, each with a 1 cell margin.
  assert.equal(MEADOW_MARGIN, 1);
  const m = MEADOW_MARGIN - 0.01;
  for (const [x, z] of [[FIELD_EDGE + m, 0], [-FIELD_EDGE - m, 3], [0, -FIELD_EDGE - m], [2, FIELD_EDGE + m]]) assert.ok(isKeptOut(keepOut, x, z));
  for (const run of fenceRails()) assert.ok(isKeptOut(keepOut, run.from.x + Math.sign(run.from.x) * m, run.from.z));
  for (const post of fencePosts()) assert.ok(isKeptOut(keepOut, post.x, post.z));
  assert.ok(isKeptOut(keepOut, PATH.x + PATH.width / 2 + m, PATH.endZ + m));
  const half = FIELD.size / 2;
  for (const [seed, p] of plans) {
    for (const item of meadowItems(p)) {
      assert.ok(!isKeptOut(keepOut, item.x, item.z), `seed ${seed}: ${item.kind} kept out`);
      // a plot is the field square: no flower, tuft or anything else on it
      assert.ok(Math.abs(item.x) > half + MEADOW_MARGIN || Math.abs(item.z) > half + MEADOW_MARGIN, `seed ${seed}: ${item.kind} on a plot`);
    }
  }
});

test('(4) planMeadow is pure and deterministic, Poisson spacing 0.7, species weights', () => {
  assert.equal(MEADOW_SEED, 20261002);
  assert.equal(MEADOW_SPACING, 0.7);
  // pure: frozen inputs are fine (never written) and the same call gives the same plan
  const bounds = Object.freeze({ ...MEADOW_BOUNDS });
  const frozen = Object.freeze({ ...keepOut, rects: Object.freeze(keepOut.rects.map((r) => Object.freeze({ ...r }))) });
  assert.deepEqual(planMeadow(MEADOW_SEED, bounds, frozen), plan);
  assert.deepEqual(planMeadow(MEADOW_SEED), plan);
  // spacing between every two plants (patch plants and clover)
  for (const [seed, p] of plans) {
    const plants = [...p.patches.flatMap((patch) => patch.plants), ...p.clover];
    for (let i = 0; i < plants.length; i++) {
      for (let j = i + 1; j < plants.length; j++) {
        assert.ok(Math.hypot(plants[i].x - plants[j].x, plants[i].z - plants[j].z) >= MEADOW_SPACING - 1e-9, `seed ${seed}`);
      }
    }
  }
  // weights in the data, and the share of patches of each species
  for (const [name, weight] of Object.entries(WEIGHTS)) assert.equal(flowerSpecies(name).weight, weight, name);
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  for (const [seed, p] of plans) {
    const counts = {};
    for (const patch of p.patches) counts[patch.species] = (counts[patch.species] ?? 0) + 1;
    for (const [name, weight] of Object.entries(WEIGHTS)) {
      const share = (counts[name] ?? 0) / p.patches.length;
      assert.ok(Math.abs(share - weight / total) <= 0.03, `seed ${seed}: ${name} ${share.toFixed(3)} vs ${(weight / total).toFixed(3)}`);
    }
  }
});

test('(5) tall flowers at the back and sides, low ones at the front, no tall flower behind a HUD card', () => {
  const tallHeight = (name) => placeholderShape(`flower-${name}`).height * PX_WORLD * SPRITE_STRETCH_Y;
  for (const [seed, p] of plans) {
    for (const patch of p.patches) {
      const { height } = flowerSpecies(patch.species);
      for (const plant of patch.plants) {
        if (height === 'tall') {
          const back = plant.z < -FIELD_EDGE;
          const side = Math.abs(plant.x) > FIELD_EDGE;
          assert.ok((back || side) && patch.z <= TALL_MAX_Z, `seed ${seed}: ${patch.species} at ${plant.x}, ${plant.z}`);
          assert.ok(!showsBehindCalm(keepOut, plant.x, plant.z, tallHeight(patch.species)), `seed ${seed}: behind a card`);
        }
      }
      if (height === 'low') assert.ok(patch.z > LOW_FRONT_Z, `seed ${seed}: ${patch.species} at z ${patch.z}`);
    }
  }
  assert.ok(LOW_FRONT_Z >= 0 && TALL_MAX_Z < FIELD_EDGE);
  for (const name of ['hollyhock', 'sunflower', 'lavender']) assert.equal(flowerSpecies(name).height, 'tall');
  for (const name of ['clover', 'forgetmenot', 'mushroom']) assert.equal(flowerSpecies(name).height, 'low');
});

test('(6) one instanced draw call per species at most, upright billboards with fixed roots', () => {
  for (const [, p] of plans) {
    const groups = meadowInstanceGroups(p);
    const names = groups.map((g) => g.species);
    assert.equal(new Set(names).size, names.length);
    assert.ok(groups.length <= FLOWER_SPECIES.length);
    const drawn = groups.reduce((n, g) => n + g.items.length, 0);
    assert.equal(drawn, p.patches.reduce((n, patch) => n + patch.plants.length, 0) + p.clover.length);
  }
  assert.equal(meadowInstanceGroups(plan).length, 13);
  // The scene draws each group as one InstancedMesh of upright planes.
  const scene = source('../src/render3d/meadow-scene.js');
  assert.match(scene, /for \(const group of meadowInstanceGroups\(plan\)\)/);
  assert.match(scene, /new THREE\.InstancedMesh\(/);
  assert.match(scene, /rotation\.setFromAxisAngle\(up, yaw\)/); // turned about y only: upright
  // Roots fixed: the anchor row and below lean 0 pixels at any amplitude.
  for (const species of FLOWER_SPECIES) {
    const { height } = placeholderShape(`flower-${species.name}`);
    for (let root = 0; root < 4; root++) {
      for (let row = 0; row <= root; row++) assert.equal(swayLeanPx(swayRowFraction(row, height, root), 0, 650, 2), 0);
    }
  }
});

test('(7) trees: 12 to 14 of the back row on screen, 4 to 6 at the sides, three types, scale 1, mirrored and shaded', () => {
  assert.deepEqual(MEADOW_TREES_BACK, [12, 14]);
  assert.deepEqual(MEADOW_TREES_SIDE, [4, 6]);
  assert.equal(MEADOW_TREE_BRIGHTNESS, 0.06);
  for (const [seed, p] of plans) {
    // Part 6c: the back row stands just in front of the far edge and runs
    // past both screen edges; 12 to 14 of it show on the 16:9 screen.
    const back = p.trees.filter((t) => t.z <= TREE_ROW_Z[1]);
    const side = p.trees.filter((t) => t.z > TREE_ROW_Z[1]);
    const onScreen = back.filter((t) => Math.abs(projectToNdc({ x: t.x, y: 0, z: t.z }, gameCamera()).x) <= 1);
    assert.ok(onScreen.length >= 12 && onScreen.length <= 14, `seed ${seed}: ${onScreen.length} back trees on screen`);
    assert.ok(back.length <= MEADOW_TREES_BACK_MAX, `seed ${seed}: ${back.length} back trees`);
    assert.ok(side.length >= 4 && side.length <= 6, `seed ${seed}: ${side.length} side trees`);
    for (const tree of side) assert.ok(tree.z <= SIDE_TREE_MAX_Z, `seed ${seed}: side tree in the back third`);
    assert.ok(side.some((t) => t.x < -FIELD_EDGE) && side.some((t) => t.x > FIELD_EDGE));
    assert.equal(new Set(p.trees.map((t) => t.look)).size, TREE_LOOKS);
    for (const tree of p.trees) {
      assert.equal(tree.scale, 1);
      assert.equal(typeof tree.mirror, 'boolean');
      assert.ok(Math.abs(tree.brightness - 1) <= MEADOW_TREE_BRIGHTNESS + 1e-12);
    }
    assert.ok(p.trees.some((t) => t.mirror) && p.trees.some((t) => !t.mirror), `seed ${seed}: mirroring mixed`);
    assert.ok(new Set(p.trees.map((t) => t.brightness)).size > 1);
  }
  const scene = source('../src/render3d/meadow-scene.js');
  assert.match(scene, /mix\(vMapUv\.x, 1\.0 - vMapUv\.x, aMirror\)/); // mirrored in the shader, not by a negative scale
  assert.match(scene, /setColorAt\(i, tint\.setScalar\(item\.brightness/);
});

test('(8) 8 to 10 bushes, exactly 3 hay bales (one alone beside a patch), 120 to 160 grass tufts', () => {
  assert.deepEqual(MEADOW_BUSHES, [8, 10]);
  assert.equal(MEADOW_BALES, 3);
  assert.deepEqual(MEADOW_TUFTS, [120, 160]);
  const fence = Math.max(...keepOut.rects.map((r) => r.maxX));
  for (const [seed, p] of plans) {
    assert.ok(p.bushes.length >= 8 && p.bushes.length <= 10, `seed ${seed}: ${p.bushes.length} bushes`);
    assert.equal(p.bales.length, 3, `seed ${seed}`);
    assert.ok(p.tufts.length >= 120 && p.tufts.length <= 160, `seed ${seed}: ${p.tufts.length} tufts`);
    for (const tuft of p.tufts) assert.ok(!isKeptOut(keepOut, tuft.x, tuft.z));
    const [a, b, alone] = p.bales;
    for (const bale of [a, b]) assert.ok(Math.abs(bale.x) - fence <= 1.6 + 1e-9, `seed ${seed}: bale by the fence`);
    assert.ok(p.patches.some((patch) => Math.hypot(alone.x - patch.x, alone.z - patch.z) <= patch.radius * 1.25 + 1.2 + 1e-9), `seed ${seed}: bale beside a patch`);
    for (const other of [a, b]) assert.ok(Math.hypot(alone.x - other.x, alone.z - other.z) > 2, `seed ${seed}: the third bale stands alone`);
  }
});

test('(9) two far hills from sums of sines, far #8fcf8a and near #6fba6a, hazed toward the sky', () => {
  assert.equal(FAR_HILLS.length, 2);
  const [far, nearHill] = FAR_HILLS;
  assert.equal(far.color, '#8fcf8a');
  assert.equal(nearHill.color, '#6fba6a');
  assert.ok(far.z < nearHill.z, 'the far hill is further away');
  assert.ok(far.haze > nearHill.haze && nearHill.haze > 0, 'both hazed, the far one more');
  for (const hill of FAR_HILLS) {
    assert.ok(hill.waves.length >= 2);
    for (const x of [-60, -7.5, 0, 13, 99]) {
      const sum = hill.waves.reduce((s, [f, a, ph]) => s + a * Math.sin(x * f + ph), 0);
      assert.ok(Math.abs(hillLift(hill, x) - sum) < 1e-12);
    }
    assert.notEqual(hillLift(hill, 0), hillLift(hill, 20));
  }
  const sky = '#e2f1ec';
  assert.deepEqual(hazeMix('#8fcf8a', sky, 0), [0x8f / 255, 0xcf / 255, 0x8a / 255]);
  assert.deepEqual(hazeMix('#8fcf8a', sky, 1).map((v) => Math.round(v * 255)), [0xe2, 0xf1, 0xec]);
  const half = hazeMix('#6fba6a', sky, 0.5);
  assert.ok(Math.abs(half[0] - (0x6f + 0xe2) / 2 / 255) < 1e-12);
  // v3.1 (docs/art-direction-v3-1.md section 5.6): the flat hill band is no
  // longer drawn; the two soft ridges of ridges-scene.js replace it.
  const scene = source('../src/render3d/meadow-scene.js');
  assert.doesNotMatch(scene, /FAR_HILLS|createFarHills/);
  assert.match(source('../src/render3d/ridges-scene.js'), /RIDGES\.map\(layerGlsl\)/);
});

test('(10) Low shows no scenery or flowers; Medium adds blob shadows under trees, bushes, bales, posts and patches', () => {
  const { low, medium } = QUALITY_LEVELS;
  assert.equal(low.scenery, false);
  assert.equal(low.meadowFlowers, 'off');
  assert.equal(low.ridges, false); // v3.1: the ridges replace the far hills
  assert.equal(low.ground, 'mown'); // no grass tufts either
  assert.equal(low.shadows, 'none');
  assert.equal(medium.scenery, true);
  assert.equal(medium.meadowFlowers, 'still');
  assert.equal(medium.shadows, 'blob');
  const spots = meadowShadowSpots(plan);
  assert.equal(spots.scenery.length, plan.trees.length + plan.bushes.length + plan.bales.length);
  assert.equal(spots.patches.length, plan.patches.length);
  for (const spot of [...spots.scenery, ...spots.patches]) assert.ok(spot.r > 0);
  // The scene hides it all on Low and shows the shadows from Medium up;
  // fence posts are PixelSprites, which carry their own blob shadow.
  const scene = source('../src/render3d/meadow-scene.js');
  assert.match(scene, /tufts\.visible = features\.ground !== 'mown'/);
  assert.match(scene, /scenery\.visible = features\.scenery/);
  assert.match(scene, /flowers\.visible = features\.meadowFlowers !== 'off'/);
  // Blob shadows on Medium; High has the long sun shadows instead (part 9).
  assert.match(scene, /const blob = features\.shadows === 'blob'/);
  assert.match(scene, /sceneryShadows\.visible = blob;/);
  assert.match(scene, /flowerShadows\.visible = blob;/);
  assert.match(source('../src/render3d/farm-field.js'), /for \(const post of fencePosts\(\)\) \{\n\s+const sprite = addSprite\(new PixelSprite\(/);
  // Fence, path and stepping stones are scenery too: off on Low (curb only).
  assert.match(source('../src/render3d/farm-field.js'), /extras\.visible = features\.scenery;/);
  assert.match(source('../src/render3d/farm-field.js'), /for \(const sprite of extraSprites\) sprite\.object\.visible = features\.scenery;/);
  assert.match(source('../src/render3d/world.js'), /sprite\.shadow\.visible = blobShadows && !sprite\.noBlobShadow/);
  assert.match(source('../src/render3d/world.js'), /blobShadows = features\.shadows === 'blob'/);
});

test('(11) High sway: square of height, 1 pixel calm and 2 in a gust, wind (1, 0, 0.35), gusts, plants at half', () => {
  assert.equal(SWAY_CALM_PX, 1);
  assert.equal(SWAY_GUST_PX, 2);
  assert.deepEqual(WIND_DIR, [1, 0, 0.35]);
  const length = Math.hypot(1, 0.35);
  assert.ok(Math.abs(WIND_GROUND.x - 1 / length) < 1e-12 && Math.abs(WIND_GROUND.z - 0.35 / length) < 1e-12);
  assert.deepEqual(GUST_EVERY_MS, [7000, 11000]);
  assert.equal(GUST_MS, 1200);
  // lean grows with h squared (before rounding to whole pixels)
  const peak = 650; // a quarter of the 2600 ms wave: the crest with phase 0
  assert.equal(swayLeanPx(1, 0, peak, 2), 2);
  assert.equal(swayLeanPx(0.5, 0, peak, 2), 1); // 2 * 0.25 = 0.5, rounded
  assert.equal(swayLeanPx(0.7, 0, peak, 2), 1); // 2 * 0.49
  assert.equal(swayLeanPx(0.9, 0, peak, 2), 2); // 2 * 0.81
  for (let t = 0; t < 5200; t += 50) {
    for (const h of [0, 0.3, 0.6, 1]) {
      assert.ok(swayLeanPx(h, 1, t, swayAmplitudePx(0)) <= 1);
      assert.ok(swayLeanPx(h, 1, t, swayAmplitudePx(1)) <= 2);
      assert.ok(swayLeanPx(h, 1, t, plantSwayAmplitudePx(1)) <= 1);
    }
    assert.equal(swayLeanPx(0, 2, t, 2), 0); // the root
  }
  // gusts from the clock: 7 to 11 s apart, 1.2 s long
  const clock = createGustClock(seededRandom(5));
  let last = null;
  let was = false;
  for (let t = 0; t <= 90000; t += 10) {
    const on = clock.strength(t) > 0;
    if (on && !was) {
      if (last !== null) assert.ok(t - last >= 7000 - 10 && t - last <= 11000 + 10);
      last = t;
    }
    if (!on && was) assert.ok(t - last <= GUST_MS + 10);
    was = on;
  }
  // resting X and O plants: half the amplitude
  assert.equal(PLANT_SWAY_SHARE, 0.5);
  assert.equal(plantSwayAmplitudePx(0), 0.5);
  assert.equal(plantSwayAmplitudePx(1), 1);
  // and they really move: half a pixel is drawn as 1 whole pixel for part
  // of each wave, so the average lean of the top is half the meadow's
  const average = (lean, amplitude) => {
    let sum = 0;
    for (let t = 0; t < 2600; t++) sum += lean(1, 0.4, t, amplitude);
    return sum / 2600;
  };
  for (const gust of [0, 1]) {
    const meadow = average(swayLeanPx, swayAmplitudePx(gust));
    const plant = average(plantSwayLeanPx, plantSwayAmplitudePx(gust));
    assert.ok(plant > 0, `gust ${gust}: a resting plant sways`);
    assert.ok(Math.abs(plant - meadow / 2) < 0.02, `gust ${gust}: plant ${plant}, meadow ${meadow}`);
  }
  for (let t = 0; t < 5200; t += 7) {
    for (const gust of [0, 0.5, 1]) {
      const amplitude = plantSwayAmplitudePx(gust);
      assert.equal(plantSwayLeanPx(0, 1, t, amplitude), 0); // the root
      assert.ok(plantSwayLeanPx(1, 1, t, amplitude) <= 1);
      // never more lean lower down
      assert.ok(plantSwayLeanPx(0.5, 1, t, amplitude) <= plantSwayLeanPx(1, 1, t, amplitude));
      assert.ok(Number.isInteger(plantSwayLeanPx(0.8, 1, t, amplitude)));
    }
  }
  assert.match(source('../src/render3d/sprites.js'), /Same formula as plantSwayLeanPx in wind\.js/);
  assert.match(source('../src/render3d/world.js'), /swayFrame: STAGE_REST/);
  assert.match(source('../src/render3d/meadow-scene.js'), /PLANT_SWAY\.uSwayPx\.value = plantSwayAmplitudePx\(gust\)/);
});

test('(12) each dandelion puff lets one seed bit go every 6 to 10 seconds, drifting on the wind', () => {
  const puffs = dandelionPuffs(plan);
  assert.ok(puffs.length > 0);
  for (const puff of puffs) assert.equal(puff.look, 1); // the white seed puff look
  // A fleck is gone before its puff lets the next go, so the pool always has room.
  assert.ok(DANDELION_FLECK_MS < 6000);
  for (const [, p] of plans) assert.ok(dandelionPuffs(p).length <= DANDELION_FLECK_POOL);
  const releases = createPuffReleases(puffs.length, seededRandom(11));
  const times = puffs.map(() => []);
  for (let t = 0; t <= 120000; t += 16) releases.step(t, (p) => times[p].push(t));
  for (const list of times) {
    assert.ok(list.length >= 11, `${list.length} releases`);
    assert.ok(list[0] <= 10000 + 16);
    for (let i = 1; i < list.length; i++) {
      const gap = list[i] - list[i - 1];
      assert.ok(gap >= 6000 && gap <= 10000 + 16, `gap ${gap}`);
    }
  }
  // the puffs do not all go together
  assert.ok(new Set(times.map((list) => list[0])).size > puffs.length / 2);
  // it drifts along the wind, three times as fast in a gust
  assert.ok(fleckSpeed(0) > 0);
  assert.ok(Math.abs(fleckSpeed(1) - 3 * fleckSpeed(0)) < 1e-12);
  const scene = source('../src/render3d/meadow-scene.js');
  assert.match(scene, /createSeedFlecks\(dandelionPuffs\(plan\)/);
  assert.match(scene, /x\[i\] \+= WIND_GROUND\.x \* speed \* dt/);
  assert.match(scene, /z\[i\] \+= WIND_GROUND\.z \* speed \* dt/);
});
