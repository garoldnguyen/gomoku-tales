// The forest behind the far edge of the meadow (docs/art-direction-v3-1.md
// section 6): the far canopy wall, up to three rows of trees and the
// undergrowth, planned by the pure, seeded planForest so the forest looks
// the same every game and can be unit tested; forest-scene.js draws it.
// Also the forest zone (section 6.7): the meadow items it keeps out. Every
// number of section 6 lives in one named constant below, shared by the
// scene code and the tests. Pure: no Three.js imports, so it runs under
// node --test.
//
// Distances are world units, x to the right, z toward the camera. Depths
// are the world z of section 5.2 (haze.js), worked out once at the 16:9
// reference view, so the forest stays put at every window shape.

import { FOREST_SEED, PX_WORLD } from '../config.js';
import { ART, placeholderShape } from './art-assets.js';
import { FOREST_ROW_Z, FOREST_ZONE_Z, groundZAtScreenY, hazeAmount, WALL_BASE_Z } from './haze.js';
import { SHADOW_RADIUS } from './meadow.js';
import { seededRandom } from './seeded-random.js';

const F = ART.v3.forest;

// --- 6.3 Tree rows ---

// Every row runs along x from FOREST_X[0] to FOREST_X[1].
export const FOREST_X = Object.freeze([-44, 44]);
export const FOREST_SPAN = FOREST_X[1] - FOREST_X[0]; // 88
// The rows a level draws, by its treeRows (quality.js): [row index into
// FOREST_ROW_Z (0 back, 2 front), step along x in world units].
export const FOREST_ROWS = Object.freeze({
  0: Object.freeze([]),
  2: Object.freeze([Object.freeze([0, 1.54]), Object.freeze([2, 2.32])]),
  3: Object.freeze([Object.freeze([0, 1.03]), Object.freeze([1, 1.21]), Object.freeze([2, 1.54])]),
});
// After each tree the walk advances by its step times a random factor
// between these, so gaps vary.
export const FOREST_STEP_FACTOR = Object.freeze([0.55, 1.45]);
export const FOREST_X_JITTER = 0.15; // plus or minus, world units
export const FOREST_Z_JITTER = 0.09; // plus or minus, world units
export const FOREST_BRIGHTNESS = Object.freeze([0.94, 1.06]);
// Kind weights; the old round trees of the meadow are one more kind.
export const FOREST_KINDS = Object.freeze([
  Object.freeze({ sheet: F.pine, weight: 3 }),
  Object.freeze({ sheet: F.oak, weight: 2 }),
  Object.freeze({ sheet: F.birch, weight: 1 }),
  Object.freeze({ sheet: F.poplar, weight: 2 }),
  Object.freeze({ sheet: ART.v3.trees, weight: 1 }),
]);

// --- 6.2 The far canopy wall ---

// 15 seamless strips of 192 art pixels (6 world units) side by side, their
// centres from -42 to 42, so the outer ends sit at -45 and 45, outside
// every view. Every third strip is the pine strip.
export const FOREST_WALL_STRIPS = 15;
export const FOREST_WALL_WIDTH = placeholderShape(F.wallRound).width * PX_WORLD; // 6
export const FOREST_WALL_FIRST_X = -42;
export const FOREST_WALL_PINE_EVERY = 3;

// --- 6.4 Undergrowth ---

// Base depths in percent of the screen height below the far edge.
export const UNDERGROWTH_DEPTH_PERCENT = Object.freeze([1.6, 6.6]);
export const LOG_DEPTH_PERCENT = Object.freeze([4.0, 7.0]);
export const UNDERGROWTH_Z = Object.freeze(UNDERGROWTH_DEPTH_PERCENT.map(groundZAtScreenY));
export const LOG_Z = Object.freeze(LOG_DEPTH_PERCENT.map(groundZAtScreenY));
// Frames of the undergrowth sheet (forest-meta.js UNDERGROWTH_LOOKS).
export const UNDERGROWTH = Object.freeze({
  fern: 0, fernSmall: 1, shrub: 2, shrubBerries: 3, shrubFlowers: 4, tallGrass: 5, sapling: 6, log: 7, stump: 8,
});
// Weights of the regular looks 0 to 6, in frame order.
export const UNDERGROWTH_WEIGHTS = Object.freeze([2, 1, 3, 1.5, 1.5, 2, 1]);
// Logs and stumps take turns, a log first.
export const LOG_LOOKS = Object.freeze([UNDERGROWTH.log, UNDERGROWTH.stump]);

// --- 6.5 Shadows ---

// Looks that cast a shadow (not ferns or tall grass).
export const SHADOWED_LOOKS = Object.freeze([
  UNDERGROWTH.shrub, UNDERGROWTH.shrubBerries, UNDERGROWTH.shrubFlowers, UNDERGROWTH.sapling, UNDERGROWTH.log, UNDERGROWTH.stump,
]);
// Blob shadow radius of a tree and of a shadowed undergrowth item: the
// meadow's tree and bush radii.
export const FOREST_SHADOW_RADIUS = Object.freeze({ tree: SHADOW_RADIUS.tree, undergrowth: SHADOW_RADIUS.bush });

// The forest switches of a quality row (quality.js): true when any of the
// forest is drawn.
export function drawsForest(features) {
  return Boolean(features.forestWall || features.treeRows > 0 || features.undergrowth > 0);
}

function pickWeighted(weights, total, r) {
  let t = r * total;
  for (let i = 0; i < weights.length; i++) {
    t -= weights[i];
    if (t < 0) return i;
  }
  return weights.length - 1;
}

const KIND_WEIGHTS = FOREST_KINDS.map((k) => k.weight);
const KIND_TOTAL = KIND_WEIGHTS.reduce((a, b) => a + b, 0);
const LOOK_TOTAL = UNDERGROWTH_WEIGHTS.reduce((a, b) => a + b, 0);

// Plans the forest for the switches of a quality row: { treeRows,
// undergrowth (per world unit), forestWall, forestLogs }. Pure: the same
// arguments always give the same plan.
// Returns {
//   trees:       [{ sheet, frame, x, z, row, mirror, brightness, scale, hazeAmount }]
//   wall:        [{ sheet, frame, x, z, mirror, brightness, scale, hazeAmount }]
//   undergrowth: [{ sheet, frame, x, z, mirror, brightness, scale, hazeAmount }]
// }
// scale is always exactly 1: variety comes from the sprite sizes, the
// frames, the mirroring and the brightness. hazeAmount is haze.js
// hazeAmount(z) of the base.
export function planForest(features, seed = FOREST_SEED) {
  const trees = [];
  const wall = [];
  const undergrowth = [];

  // Trees: one generator, rows walked back to front.
  const random = seededRandom(seed);
  const treeBetween = (lo, hi) => lo + random() * (hi - lo);
  for (const [row, step] of FOREST_ROWS[features.treeRows] ?? []) {
    for (let walk = FOREST_X[0]; walk <= FOREST_X[1]; walk += step * treeBetween(...FOREST_STEP_FACTOR)) {
      const { sheet } = FOREST_KINDS[pickWeighted(KIND_WEIGHTS, KIND_TOTAL, random())];
      const frame = Math.floor(random() * placeholderShape(sheet).frames);
      const x = walk + treeBetween(-FOREST_X_JITTER, FOREST_X_JITTER);
      const z = FOREST_ROW_Z[row] + treeBetween(-FOREST_Z_JITTER, FOREST_Z_JITTER);
      const mirror = random() < 0.5;
      const brightness = treeBetween(...FOREST_BRIGHTNESS);
      trees.push({ sheet, frame, x, z, row, mirror, brightness, scale: 1, hazeAmount: hazeAmount(z) });
    }
  }

  // The far canopy wall: fixed strips, no randomness.
  if (features.forestWall) {
    for (let i = 0; i < FOREST_WALL_STRIPS; i++) {
      const sheet = i % FOREST_WALL_PINE_EVERY === FOREST_WALL_PINE_EVERY - 1 ? F.wallPine : F.wallRound;
      wall.push({
        sheet, frame: 0, x: FOREST_WALL_FIRST_X + i * FOREST_WALL_WIDTH, z: WALL_BASE_Z,
        mirror: false, brightness: 1, scale: 1, hazeAmount: hazeAmount(WALL_BASE_Z),
      });
    }
  }

  // Undergrowth: its own generator, so it does not depend on the trees.
  const under = seededRandom(seed + 1);
  const underBetween = (lo, hi) => lo + under() * (hi - lo);
  const count = Math.round((features.undergrowth ?? 0) * FOREST_SPAN);
  const plantUndergrowth = (frame, zMin, zMax) => {
    const x = underBetween(FOREST_X[0], FOREST_X[1]);
    const z = underBetween(zMin, zMax);
    const mirror = under() < 0.5;
    const brightness = underBetween(...FOREST_BRIGHTNESS);
    undergrowth.push({ sheet: F.undergrowth, frame, x, z, mirror, brightness, scale: 1, hazeAmount: hazeAmount(z) });
  };
  for (let n = 0; n < count; n++) plantUndergrowth(pickWeighted(UNDERGROWTH_WEIGHTS, LOOK_TOTAL, under()), UNDERGROWTH_Z[0], UNDERGROWTH_Z[1]);
  for (let n = 0; n < (features.forestLogs ?? 0); n++) plantUndergrowth(LOG_LOOKS[n % LOG_LOOKS.length], LOG_Z[0], LOG_Z[1]);

  return { trees, wall, undergrowth };
}

// The plan grouped for drawing: one group per sheet that has any items,
// { sheet, items, wall }, each drawn as one instanced mesh (8 at most: the
// 2 wall strips, the 5 tree sheets and the undergrowth).
export function forestInstanceGroups(plan) {
  const groups = [];
  const bySheet = (items, wall) => {
    const sheets = [];
    for (const item of items) if (!sheets.includes(item.sheet)) sheets.push(item.sheet);
    for (const sheet of sheets) groups.push({ sheet, items: items.filter((item) => item.sheet === sheet), wall });
  };
  bySheet(plan.wall, true);
  bySheet(plan.trees, false);
  bySheet(plan.undergrowth, false);
  return groups;
}

// True for the items that cast a shadow: every tree, and the shrubs,
// saplings, logs and stumps of the undergrowth.
export function castsShadow(item) {
  return item.sheet !== F.undergrowth || SHADOWED_LOOKS.includes(item.frame);
}

// The soft blob shadows (Medium) as { x, z, r } spots: under every tree
// and every shadowed undergrowth item, none under the wall.
export function forestShadowSpots(plan) {
  return [
    ...plan.trees.map((t) => ({ x: t.x, z: t.z, r: FOREST_SHADOW_RADIUS.tree })),
    ...plan.undergrowth.filter(castsShadow).map((u) => ({ x: u.x, z: u.z, r: FOREST_SHADOW_RADIUS.undergrowth })),
  ];
}

// --- 6.7 The forest zone and the meadow ---

// True when a thing whose base stands at world depth `z` is inside the
// forest zone: less than 7.2 percent below the far edge.
export function inForestZone(z) {
  return z < FOREST_ZONE_Z;
}

// A copy of a meadow plan (planMeadow's shape) without the items whose
// base is inside the forest zone, on levels that draw the forest; on
// levels without it (Low) the plan comes back unchanged. A flower patch
// keeps only its plants outside the zone, and goes when none is left.
// planMeadow itself is not changed.
export function skipForestZone(plan, features) {
  if (!drawsForest(features)) return plan;
  const outsideZone = (item) => !inForestZone(item.z);
  const result = {};
  for (const [key, items] of Object.entries(plan)) {
    result[key] = key === 'patches'
      ? items.map((p) => ({ ...p, plants: p.plants.filter(outsideZone) })).filter((p) => p.plants.length > 0)
      : items.filter(outsideZone);
  }
  return result;
}
