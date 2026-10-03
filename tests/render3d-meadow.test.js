import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DANDELION_RELEASE_MS, GUST_EVERY_MS, GUST_MS, MEADOW_BALES, MEADOW_BUSHES, MEADOW_PATCH_PLANTS, MEADOW_SEED,
  MEADOW_PATCHES, MEADOW_SHADOW_LIFT, MEADOW_SPACING, MEADOW_TREES_BACK, MEADOW_TREES_BACK_MAX, MEADOW_TREES_SIDE,
  MEADOW_TUFTS, PX_WORLD, SPRITE_STRETCH_Y,
} from '../src/config.js';
import { placeholderShape } from '../src/render3d/art-assets.js';
import { cameraPosition, cameraRay, gameCamera, projectToNdc } from '../src/render3d/camera.js';
import { TREE_ROW_Z } from '../src/render3d/horizon.js';
import { CURB, fencePosts, PATH, pathStones } from '../src/render3d/farm-layout.js';
import {
  BUSH_FLOWERING, BUSH_LOOKS, flowerSpecies, FLOWER_SPECIES, hudCardScreens, isKeptOut, MEADOW_BOUNDS, meadowItems,
  meadowKeepOut, meadowShadowSpots, patchQuota, planMeadow, showsBehindCalm, TREE_LOOKS, TUFT_LOOKS,
} from '../src/render3d/meadow.js';
import { seededRandom } from '../src/render3d/seeded-random.js';
import { groundMeshHeight, TERRAIN_GRID } from '../src/render3d/terrain.js';
import {
  createGustClock, gustEnvelope, nextReleaseMs, swayAmplitudePx, swayLeanPx, swayLeanSide, swayPhase, swayRowFraction, WIND_GROUND,
} from '../src/render3d/wind.js';

const meta = JSON.parse(readFileSync(new URL('../assets/v3-meta.json', import.meta.url)));
const keepOut = meadowKeepOut();
const plan = planMeadow(MEADOW_SEED);
const OTHER_SEEDS = [1, 2, 3, 77, 4242];
const inside = (bounds, item) => item.x >= bounds.minX && item.x <= bounds.maxX && item.z >= bounds.minZ && item.z <= bounds.maxZ;
const flowerPoints = (p) => [
  ...p.patches.flatMap((patch) => patch.plants),
  ...p.clover,
];

test('the meadow seed is 20261002', () => {
  assert.equal(MEADOW_SEED, 20261002);
});

test('the same seed gives the same meadow, another seed a different one', () => {
  assert.deepEqual(planMeadow(MEADOW_SEED), plan);
  assert.deepEqual(planMeadow(MEADOW_SEED, MEADOW_BOUNDS, meadowKeepOut()), plan);
  assert.notDeepEqual(planMeadow(MEADOW_SEED + 1), plan);
});

test('the keep-out area covers the field, curb, fence, path and characters', () => {
  const edge = CURB.inner + CURB.width;
  for (const x of [-edge, 0, edge]) for (const z of [-edge, 0, edge]) assert.ok(isKeptOut(keepOut, x, z));
  // the 1 cell margin
  assert.ok(isKeptOut(keepOut, edge + 0.99, 0));
  assert.ok(isKeptOut(keepOut, 0, -(edge + 0.99)));
  for (const post of fencePosts()) {
    assert.ok(isKeptOut(keepOut, post.x, post.z));
    assert.ok(isKeptOut(keepOut, post.x + Math.sign(post.x) * 0.99, post.z));
  }
  for (const stone of pathStones()) assert.ok(isKeptOut(keepOut, stone.x, stone.z));
  assert.ok(isKeptOut(keepOut, PATH.x + PATH.width / 2 + 0.99, PATH.endZ + 0.99));
  // the meadow beyond is free
  assert.ok(!isKeptOut(keepOut, 14, 4));
  assert.ok(!isKeptOut(keepOut, -14, 6));
});

test('nothing is ever planted inside the keep-out area or outside the bounds', () => {
  for (const seed of [MEADOW_SEED, ...OTHER_SEEDS]) {
    const items = meadowItems(planMeadow(seed));
    assert.ok(items.length > 300);
    for (const item of items) {
      assert.ok(!isKeptOut(keepOut, item.x, item.z), `seed ${seed}: ${item.kind} at ${item.x}, ${item.z}`);
      assert.ok(inside(MEADOW_BOUNDS, item), `seed ${seed}: ${item.kind} out of bounds`);
    }
  }
});

test('planMeadow follows any keep-out area and bounds it is given', () => {
  const bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
  const custom = { rects: [{ minX: -3, maxX: 3, minZ: -3, maxZ: 3 }], circles: [{ x: 6, z: 6, r: 2.5 }], calm: null };
  for (const seed of [MEADOW_SEED, ...OTHER_SEEDS]) {
    for (const item of meadowItems(planMeadow(seed, bounds, custom))) {
      assert.ok(!isKeptOut(custom, item.x, item.z));
      assert.ok(inside(bounds, item));
    }
  }
});

test('about 36 patches, each a drift of 5 to 14 plants of one species', () => {
  assert.equal(plan.patches.length, 36);
  for (const seed of OTHER_SEEDS) {
    const count = planMeadow(seed).patches.length;
    assert.ok(count >= 32 && count <= 36, `seed ${seed}: ${count} patches`);
  }
  for (const patch of plan.patches) {
    const species = flowerSpecies(patch.species);
    assert.ok(species && species.weight > 0, patch.species);
    assert.ok(patch.plants.length >= MEADOW_PATCH_PLANTS[0] && patch.plants.length <= MEADOW_PATCH_PLANTS[1]);
    // one drift around its centre, not plants scattered over the meadow
    for (const plant of patch.plants) assert.ok(Math.hypot(plant.x - patch.x, plant.z - patch.z) <= patch.radius * 1.25 + 1e-9);
  }
  // Each plant belongs to exactly one patch.
  const points = new Set(plan.patches.flatMap((p) => p.plants));
  assert.equal(points.size, plan.patches.reduce((n, p) => n + p.plants.length, 0));
});

test('patches are shared out by the species weights, at least one of each kind', () => {
  const quota = patchQuota();
  const names = FLOWER_SPECIES.filter((s) => s.name !== 'clover').map((s) => s.name);
  assert.deepEqual(Object.keys(quota).sort(), [...names].sort());
  assert.equal(Object.values(quota).reduce((a, b) => a + b, 0), MEADOW_PATCHES);
  for (const name of names) assert.ok(quota[name] >= 1, name);
  // heavier kinds never get fewer patches than lighter ones
  for (const a of names) {
    for (const b of names) {
      if (flowerSpecies(a).weight > flowerSpecies(b).weight) assert.ok(quota[a] >= quota[b], `${a} vs ${b}`);
    }
  }
  assert.deepEqual(patchQuota(), {
    daisy: 4, tulip: 4, bluebell: 4, poppy: 4, sunflower: 1, lavender: 3, cosmos: 3,
    forgetmenot: 3, marigold: 3, hollyhock: 2, mushroom: 2, dandelion: 3,
  });
  for (const seed of [MEADOW_SEED, ...OTHER_SEEDS]) {
    const p = planMeadow(seed);
    const counts = {};
    for (const patch of p.patches) counts[patch.species] = (counts[patch.species] ?? 0) + 1;
    for (const name of names) assert.ok((counts[name] ?? 0) <= quota[name], `seed ${seed}: ${name}`);
  }
});

test('the game meadow shows all 13 flower kinds', () => {
  const kinds = new Set(plan.patches.map((p) => p.species));
  if (plan.clover.length) kinds.add('clover');
  assert.equal(kinds.size, FLOWER_SPECIES.length);
  const counts = {};
  for (const patch of plan.patches) counts[patch.species] = (counts[patch.species] ?? 0) + 1;
  assert.deepEqual(counts, patchQuota());
});

test('every look index is valid and looks mix inside a patch', () => {
  for (const seed of [MEADOW_SEED, ...OTHER_SEEDS]) {
    const p = planMeadow(seed);
    for (const patch of p.patches) {
      const looks = flowerSpecies(patch.species).looks;
      const used = new Set();
      for (const plant of patch.plants) {
        assert.ok(Number.isInteger(plant.look) && plant.look >= 0 && plant.look < looks);
        used.add(plant.look);
      }
      assert.equal(used.size, Math.min(looks, patch.plants.length), `${patch.species} uses all its looks`);
    }
    for (const c of p.clover) assert.equal(c.look, 0);
    for (const t of p.tufts) assert.ok(Number.isInteger(t.look) && t.look >= 0 && t.look < TUFT_LOOKS);
    for (const t of p.trees) assert.ok(Number.isInteger(t.look) && t.look >= 0 && t.look < TREE_LOOKS);
    for (const b of p.bushes) assert.ok(Number.isInteger(b.look) && b.look >= 0 && b.look < BUSH_LOOKS);
  }
});

test('the 13 species and their looks match section 6, v3-meta.json and the sheets', () => {
  const looks = {
    daisy: 3, tulip: 3, bluebell: 3, poppy: 3, sunflower: 1, lavender: 2, cosmos: 3,
    forgetmenot: 2, marigold: 2, hollyhock: 3, mushroom: 3, dandelion: 2, clover: 1,
  };
  const weights = {
    daisy: 3, tulip: 3, bluebell: 3, poppy: 3, cosmos: 2, marigold: 2, lavender: 2,
    forgetmenot: 2, dandelion: 2, hollyhock: 1.5, mushroom: 1.5, sunflower: 1, clover: 0,
  };
  assert.equal(FLOWER_SPECIES.length, 13);
  assert.equal(FLOWER_SPECIES.reduce((n, s) => n + s.looks, 0), 31);
  for (const species of FLOWER_SPECIES) {
    assert.equal(species.looks, looks[species.name], species.name);
    assert.equal(species.weight, weights[species.name], species.name);
    assert.equal(meta[`flower-${species.name}`].looks.length, species.looks);
    assert.equal(placeholderShape(`flower-${species.name}`).frames, species.looks);
  }
  for (const name of ['hollyhock', 'sunflower', 'lavender']) assert.equal(flowerSpecies(name).height, 'tall');
  for (const name of ['clover', 'forgetmenot', 'mushroom']) assert.equal(flowerSpecies(name).height, 'low');
});

test('plants keep a Poisson-disc spacing of at least 0.7 cell', () => {
  for (const seed of [MEADOW_SEED, ...OTHER_SEEDS]) {
    const p = planMeadow(seed);
    const flowers = flowerPoints(p);
    for (let i = 0; i < flowers.length; i++) {
      for (let j = i + 1; j < flowers.length; j++) {
        const d = Math.hypot(flowers[i].x - flowers[j].x, flowers[i].z - flowers[j].z);
        assert.ok(d >= MEADOW_SPACING - 1e-9, `seed ${seed}: plants ${d.toFixed(3)} apart`);
      }
    }
    // grass tufts never stand on a plant either
    for (const tuft of p.tufts) {
      for (const f of flowers) assert.ok(Math.hypot(tuft.x - f.x, tuft.z - f.z) >= MEADOW_SPACING - 1e-9);
    }
  }
});

test('tall flowers stay at the back and sides, low ones lean to the front', () => {
  for (const seed of [MEADOW_SEED, ...OTHER_SEEDS]) {
    const p = planMeadow(seed);
    const meanZ = (height) => {
      const zs = p.patches.filter((patch) => flowerSpecies(patch.species).height === height).map((patch) => patch.z);
      return zs.reduce((a, b) => a + b, 0) / zs.length;
    };
    for (const patch of p.patches) {
      if (flowerSpecies(patch.species).height !== 'tall') continue;
      // never in front of the field, where it could hide plots
      for (const plant of patch.plants) assert.ok(plant.z <= 5.5 + patch.radius, `seed ${seed}`);
      assert.ok(patch.z <= 5.5);
    }
    assert.ok(meanZ('low') > meanZ('mid'), `seed ${seed}: low flowers toward the front`);
  }
  const all = [MEADOW_SEED, ...OTHER_SEEDS].flatMap((seed) => planMeadow(seed).patches);
  const tall = all.filter((patch) => flowerSpecies(patch.species).height === 'tall');
  assert.ok(tall.length > 0);
});

test('no tall flower or tree shows behind the two HUD cards', () => {
  const screens = hudCardScreens();
  assert.equal(screens.length, 2);
  assert.ok(screens[0].maxX < -0.5 && screens[1].minX > 0.5); // left and right card
  for (const seed of [MEADOW_SEED, ...OTHER_SEEDS]) {
    const p = planMeadow(seed);
    for (const patch of p.patches) {
      if (flowerSpecies(patch.species).height !== 'tall') continue;
      const height = placeholderShape(`flower-${patch.species}`).height * PX_WORLD * SPRITE_STRETCH_Y;
      for (const plant of patch.plants) assert.ok(!showsBehindCalm(keepOut, plant.x, plant.z, height));
    }
    // The side trees; the back row is the horizon itself and runs on behind
    // the glass cards so it never shows a gap.
    for (const tree of p.trees.filter((t) => t.z > TREE_ROW_Z[1])) assert.ok(!showsBehindCalm(keepOut, tree.x, tree.z, 2.6 * tree.scale));
  }
  // and the calm test does see things behind a card
  assert.ok(showsBehindCalm(keepOut, -13, -4, 2.5));
  assert.ok(showsBehindCalm(keepOut, 13, -4, 2.5));
  assert.ok(!showsBehindCalm(keepOut, 0, -11, 2.5));
});

test('the scenery counts follow section 6', () => {
  const back = plan.trees.filter((t) => t.z <= TREE_ROW_Z[1]);
  const side = plan.trees.filter((t) => t.z > TREE_ROW_Z[1]);
  // 12 to 14 of the back row on the 16:9 screen; the row runs on past both edges.
  const camera = gameCamera(16 / 9);
  const onScreen = back.filter((t) => Math.abs(projectToNdc({ x: t.x, y: 0, z: t.z }, camera).x) <= 1);
  assert.ok(onScreen.length >= MEADOW_TREES_BACK[0] && onScreen.length <= MEADOW_TREES_BACK[1], `${onScreen.length} back trees on screen`);
  assert.ok(back.length <= MEADOW_TREES_BACK_MAX, `${back.length} back trees in all`);
  assert.ok(side.length >= MEADOW_TREES_SIDE[0] && side.length <= MEADOW_TREES_SIDE[1], `${side.length} side trees`);
  assert.ok(side.some((t) => t.x < 0) && side.some((t) => t.x > 0));
  // always scale 1 (sections 1 and 6: never a non-integer scale)
  for (const tree of plan.trees) assert.equal(tree.scale, 1);
  assert.equal(new Set(plan.trees.map((t) => t.look)).size, TREE_LOOKS);
  assert.ok(plan.bushes.length >= MEADOW_BUSHES[0] && plan.bushes.length <= MEADOW_BUSHES[1]);
  assert.ok(plan.bushes.some((b) => b.look === BUSH_FLOWERING));
  assert.equal(plan.bales.length, MEADOW_BALES);
  assert.ok(plan.tufts.length >= MEADOW_TUFTS[0] && plan.tufts.length <= MEADOW_TUFTS[1], `${plan.tufts.length} tufts`);
  assert.ok(plan.clover.length > 0);
});

test('projectToNdc is the inverse of cameraRay', () => {
  const setup = { position: cameraPosition(55, 30), target: { x: 0, y: 0, z: 0 }, fovDeg: 35, aspect: 16 / 9 };
  for (const [nx, ny] of [[0, 0], [-0.8, 0.5], [0.6, -0.9], [1, 1]]) {
    const ray = cameraRay(nx, ny, setup);
    const point = { x: ray.origin.x + ray.direction.x * 20, y: ray.origin.y + ray.direction.y * 20, z: ray.origin.z + ray.direction.z * 20 };
    const p = projectToNdc(point, setup);
    assert.ok(Math.abs(p.x - nx) < 1e-9 && Math.abs(p.y - ny) < 1e-9);
  }
  assert.equal(projectToNdc({ x: 0, y: 40, z: 40 }, setup), null);
});

test('the wind blows along (1, 0, 0.35) on the ground', () => {
  assert.ok(Math.abs(Math.hypot(WIND_GROUND.x, WIND_GROUND.z) - 1) < 1e-12);
  assert.ok(Math.abs(WIND_GROUND.z / WIND_GROUND.x - 0.35) < 1e-12);
});

test('gusts come every 7 to 11 seconds and last 1.2 seconds', () => {
  assert.deepEqual(GUST_EVERY_MS, [7000, 11000]);
  assert.equal(GUST_MS, 1200);
  assert.equal(gustEnvelope(0), 0);
  assert.equal(gustEnvelope(GUST_MS), 0);
  assert.ok(Math.abs(gustEnvelope(GUST_MS / 2) - 1) < 1e-12);
  const clock = createGustClock(seededRandom(9));
  const starts = [];
  let wasGusting = false;
  let gustStart = 0;
  for (let t = 0; t <= 120000; t += 10) {
    const g = clock.strength(t);
    assert.ok(g >= 0 && g <= 1);
    if (g > 0 && !wasGusting) {
      gustStart = t;
      starts.push(t);
    }
    if (g === 0 && wasGusting) assert.ok(t - gustStart <= GUST_MS + 10);
    wasGusting = g > 0;
  }
  assert.ok(starts.length >= 10);
  assert.ok(starts[0] >= 7000 - 10);
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i] - starts[i - 1];
    assert.ok(gap >= 7000 - 10 && gap <= 11000 + 10, `gap ${gap}`);
  }
});

test('sway leans whole art pixels, growing with the square of height, root fixed', () => {
  assert.equal(swayAmplitudePx(0), 1);
  assert.equal(swayAmplitudePx(1), 2);
  assert.equal(swayAmplitudePx(0.5), 1.5);
  for (let t = 0; t < 6000; t += 37) {
    for (const phase of [0, 1, 4]) {
      assert.equal(swayLeanPx(0, phase, t, 2), 0);
      for (const h of [0.25, 0.5, 1]) {
        const calm = swayLeanPx(h, phase, t, swayAmplitudePx(0));
        const gust = swayLeanPx(h, phase, t, swayAmplitudePx(1));
        assert.ok(Number.isInteger(calm) && calm >= 0 && calm <= 1);
        assert.ok(Number.isInteger(gust) && gust >= 0 && gust <= 2);
      }
      assert.ok(swayLeanPx(0.5, phase, t, 2) <= swayLeanPx(1, phase, t, 2));
    }
  }
  // the top reaches the full amplitude; half way up only a quarter of it
  const peak = (Math.PI / 2) / (2 * Math.PI) * 2600;
  assert.equal(swayLeanPx(1, 0, peak, 2), 2);
  assert.equal(swayLeanPx(1, 0, peak, 1), 1);
  assert.equal(swayLeanPx(0.5, 0, peak, 2), 1); // 2 * 0.25 = 0.5 rounds to 1
  assert.equal(swayLeanPx(0.3, 0, peak, 2), 0);
  // each art pixel row leans as one: h from the anchor row (root) to the top
  assert.equal(swayRowFraction(0, 30), 0);
  assert.equal(swayRowFraction(29, 30), 1);
  assert.equal(swayRowFraction(2, 46, 3), 0); // below the root
  assert.equal(swayRowFraction(3, 46, 3), 0);
  assert.equal(swayRowFraction(45, 46, 3), 1);
  assert.equal(swayRowFraction(0, 1), 0);
  for (const [name, entry] of Object.entries(meta)) {
    if (!name.startsWith('flower-') && name !== 'grass-tufts') continue;
    const { height } = placeholderShape(name);
    const root = height - 1 - entry.anchor[1];
    assert.equal(swayLeanPx(swayRowFraction(root, height, root), 0, peak, 2), 0, `${name} root fixed`);
    assert.equal(swayLeanPx(swayRowFraction(height - 1, height, root), 0, peak, 2), 2, `${name} top leans 2 px`);
    for (let row = 0; row < height; row++) {
      const lean = swayLeanPx(swayRowFraction(row, height, root), 0, peak, 2);
      assert.ok(Number.isInteger(lean), name);
    }
  }
  // per-plant phase
  assert.notEqual(swayPhase(1, 2), swayPhase(2, 1));
  assert.ok(swayPhase(3.5, -2) >= 0 && swayPhase(3.5, -2) < Math.PI * 2);
});

test('dandelion puffs let a seed fleck go every 6 to 10 seconds', () => {
  assert.deepEqual(DANDELION_RELEASE_MS, [6000, 10000]);
  const random = seededRandom(3);
  for (let i = 0; i < 200; i++) {
    const next = nextReleaseMs(5000, random);
    assert.ok(next >= 11000 && next <= 15000);
  }
  assert.ok(plan.patches.some((p) => p.species === 'dandelion' && p.plants.some((plant) => plant.look === 1)));
});

test('every meadow root and shadow sits on the flat ground', () => {
  const { minX, maxX, minZ, maxZ } = TERRAIN_GRID;
  for (const item of meadowItems(plan)) {
    assert.equal(groundMeshHeight(item.x, item.z), 0);
    assert.ok(item.x > minX && item.x < maxX && item.z >= minZ && item.z < maxZ, 'on the drawn ground');
  }
  const spots = meadowShadowSpots(plan);
  assert.equal(spots.scenery.length, plan.trees.length + plan.bushes.length + plan.bales.length);
  assert.equal(spots.patches.length, plan.patches.length);
  // Flat shadows lie on the ground and are drawn over it by polygon offset, not lifted.
  assert.equal(MEADOW_SHADOW_LIFT, 0, 'flat shadows lie on the ground');
});

test('the sway lean is whole art pixels, downwind along the plane', () => {
  for (let deg = -180; deg < 180; deg += 7) {
    const yaw = (deg * Math.PI) / 180;
    const side = swayLeanSide(Math.cos(yaw), Math.sin(yaw));
    assert.ok(side === 1 || side === -1);
    // the plane's width axis after the turn is (cos, 0, -sin)
    const along = WIND_GROUND.x * Math.cos(yaw) - WIND_GROUND.z * Math.sin(yaw);
    if (Math.abs(along) > 1e-9) assert.equal(side, Math.sign(along));
    for (const px of [0, 1, 2]) assert.ok(Number.isInteger(px * side));
  }
  // facing the fixed camera (yaw near 0) the plants lean to the right
  assert.equal(swayLeanSide(1, 0), 1);
});
