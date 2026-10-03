// The meadow plan (docs/art-direction-v3.md section 6): where the flower
// patches, grass tufts, clover, trees, bushes and hay bales stand around the
// farm field. planMeadow is pure and seeded, so the meadow looks the same
// every game and can be unit tested; meadow-scene.js draws it. No Three.js
// imports, so it runs under node --test.
//
// Distances are world units (one cell is one unit). x runs to the right, z
// toward the camera, so the back of the meadow is -z.

import {
  CHARACTER_X, HUD_CARD_HEIGHT_PX, HUD_CARD_SIDE_PX,
  HUD_CARD_TOP_PX, HUD_CARD_WIDTH_PX, HUD_SCREEN_PX, MEADOW_BALES, MEADOW_BUSHES, MEADOW_MARGIN,
  MEADOW_PATCH_PLANTS, MEADOW_PATCHES, MEADOW_SPACING, MEADOW_TREE_BRIGHTNESS, MEADOW_TREE_SCALE,
  MEADOW_TREES_SIDE, MEADOW_TUFTS, PX_WORLD, SPRITE_STRETCH_Y,
} from '../config.js';
import { placeholderShape } from './art-assets.js';
import { gameCamera, projectToNdc } from './camera.js';
import { CURB, fenceRails, PATH } from './farm-layout.js';
import {
  depressionAtScreenY, GROUND_HALF_WIDTH, MEADOW_PLANT_BOUNDS, SIDE_TREE_MAX_Z, screenEdgeX, TREE_ROW_HALF_WIDTH,
  TREE_ROW_SPACING, TREE_ROW_Z,
} from './horizon.js';
import { seededRandom } from './seeded-random.js';
import { terrainHeight } from './terrain.js';

// The 13 kinds with their looks (frames of flower-NAME.png), patch weight
// and height class. Clover has no weight: it only fills patch edges, with
// the grass tufts. Tall kinds go toward the back and sides and never behind
// a HUD card; low kinds go toward the front.
export const FLOWER_SPECIES = Object.freeze([
  { name: 'daisy', looks: 3, weight: 3, height: 'mid' },
  { name: 'tulip', looks: 3, weight: 3, height: 'mid' },
  { name: 'bluebell', looks: 3, weight: 3, height: 'mid' },
  { name: 'poppy', looks: 3, weight: 3, height: 'mid' },
  { name: 'sunflower', looks: 1, weight: 1, height: 'tall' },
  { name: 'lavender', looks: 2, weight: 2, height: 'tall' },
  { name: 'cosmos', looks: 3, weight: 2, height: 'mid' },
  { name: 'forgetmenot', looks: 2, weight: 2, height: 'low' },
  { name: 'marigold', looks: 2, weight: 2, height: 'mid' },
  { name: 'hollyhock', looks: 3, weight: 1.5, height: 'tall' },
  { name: 'mushroom', looks: 3, weight: 1.5, height: 'low' },
  { name: 'dandelion', looks: 2, weight: 2, height: 'mid' }, // looks: bloom, seed puff
  { name: 'clover', looks: 1, weight: 0, height: 'low' },
].map(Object.freeze));
const SPECIES = Object.fromEntries(FLOWER_SPECIES.map((s) => [s.name, s]));
const PATCH_SPECIES = FLOWER_SPECIES.filter((s) => s.weight > 0);

export const TREE_LOOKS = 3; // round, wide, tall
export const BUSH_LOOKS = 3; // plain, flowering, small
export const BUSH_FLOWERING = 1;
export const TUFT_LOOKS = 3;

// Where the meadow is planted: the flat ground the camera sees, from the
// far edge (the horizon, about z = -11) to just past the bottom of the
// screen, as wide as the back row of trees (horizon.js).
export const MEADOW_BOUNDS = MEADOW_PLANT_BOUNDS;

// Tall flowers stay behind this z, so they never stand in front of the
// field (the front of the meadow is for low ones).
export const TALL_MAX_Z = 5.5;
// Low flower patches grow only in front of this z (the front half of the
// meadow), where they never hide the field.
export const LOW_FRONT_Z = 1;
// No patch grows behind the back row of trees, at the very far edge.
const PATCH_MIN_Z = TREE_ROW_Z[1];
const PATCH_GAP = 2.1; // between patch centres
// Clover and edge tufts stand this far (min, max) outside a patch's radius.
export const EDGE_GAP = [0.1, 1.0];
// Personal space of each kind of thing: two things stand at least the
// larger of their two values apart.
const SPACE = { flower: MEADOW_SPACING, tree: 1.0, bush: 0.6, bale: 0.75, tuft: 0.35 };

// Height in world units of an upright sprite frame of `name`.
function spriteHeight(name) {
  return placeholderShape(name).height * PX_WORLD * SPRITE_STRETCH_Y;
}

// The world height of the tallest look of a flower kind.
export function flowerHeight(species) {
  return spriteHeight(`flower-${species}`);
}

const TREE_HEIGHT = spriteHeight('trees');

// How many patches of each kind (by name) the meadow gets: `count` shared
// out by the section 6 weights (largest remainder first), at least one of
// each, so all 13 kinds grow (clover only at patch edges).
export function patchQuota(count = MEADOW_PATCHES) {
  const total = PATCH_SPECIES.reduce((n, s) => n + s.weight, 0);
  const exact = PATCH_SPECIES.map((s) => (count * s.weight) / total);
  const quota = exact.map((e) => Math.max(1, Math.floor(e)));
  let left = count - quota.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((e, i) => i).sort((a, b) => (exact[b] - Math.floor(exact[b])) - (exact[a] - Math.floor(exact[a])) || a - b);
  for (const i of byRemainder) {
    if (left <= 0) break;
    quota[i]++;
    left--;
  }
  return Object.fromEntries(PATCH_SPECIES.map((s, i) => [s.name, quota[i]]));
}

// The HUD cards as rectangles in normalized device coordinates (x and y
// from -1 to 1, y up) of the HUD_SCREEN_PX screen.
export function hudCardScreens() {
  const [w, h] = HUD_SCREEN_PX;
  const toNdcX = (px) => (px / w) * 2 - 1;
  const toNdcY = (px) => 1 - (px / h) * 2;
  const top = toNdcY(HUD_CARD_TOP_PX);
  const bottom = toNdcY(HUD_CARD_TOP_PX + HUD_CARD_HEIGHT_PX);
  const inner = toNdcX(HUD_CARD_SIDE_PX + HUD_CARD_WIDTH_PX);
  const outer = toNdcX(HUD_CARD_SIDE_PX);
  return [
    { minX: outer, maxX: inner, minY: bottom, maxY: top },
    { minX: -inner, maxX: -outer, minY: bottom, maxY: top },
  ];
}

// The game's keep-out area: the field and curb, the fence line, the path
// and the spots where Wind Rabbit and Earth Bear stand, each grown by
// MEADOW_MARGIN, plus the calm screen areas behind the two HUD cards seen
// from the fixed camera. See planMeadow for the shape.
export function meadowKeepOut(margin = MEADOW_MARGIN) {
  const grow = (minX, maxX, minZ, maxZ) => ({ minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin });
  const edge = CURB.inner + CURB.width;
  const rects = [grow(-edge, edge, -edge, edge)];
  for (const run of fenceRails()) {
    rects.push(grow(Math.min(run.from.x, run.to.x), Math.max(run.from.x, run.to.x),
      Math.min(run.from.z, run.to.z), Math.max(run.from.z, run.to.z)));
  }
  rects.push(grow(PATH.x - PATH.width / 2, PATH.x + PATH.width / 2, PATH.startZ, PATH.endZ));
  const circles = [-CHARACTER_X, CHARACTER_X].map((x) => ({ x, z: 0, r: 1.5 + margin / 2 }));
  const camera = gameCamera(HUD_SCREEN_PX[0] / HUD_SCREEN_PX[1]);
  return { rects, circles, calm: { camera, screens: hudCardScreens(), groundAt: terrainHeight } };
}

// True when nothing may stand on ground point (x, z): inside a keep-out
// rectangle or circle.
export function isKeptOut(keepOut, x, z) {
  for (const r of keepOut.rects ?? []) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return true;
  }
  for (const c of keepOut.circles ?? []) {
    if (Math.hypot(x - c.x, z - c.z) <= c.r) return true;
  }
  return false;
}

// True when an upright thing `height` tall standing on (x, z) would show
// behind one of the calm screen areas (the HUD cards).
const CALM_SAMPLES = 6;
export function showsBehindCalm(keepOut, x, z, height) {
  const calm = keepOut.calm;
  if (!calm || !calm.screens?.length) return false;
  const ground = calm.groundAt ? calm.groundAt(x, z) : 0;
  for (let i = 0; i <= CALM_SAMPLES; i++) {
    const p = projectToNdc({ x, y: ground + (height * i) / CALM_SAMPLES, z }, calm.camera);
    if (!p) continue;
    for (const s of calm.screens) {
      if (p.x >= s.minX && p.x <= s.maxX && p.y >= s.minY && p.y <= s.maxY) return true;
    }
  }
  return false;
}

// Where the right edge of the 16:9 screen meets the ground line at depth z.
function sideEdge(z) {
  return screenEdgeX(gameCamera(), HUD_SCREEN_PX[0] / HUD_SCREEN_PX[1], z, 1);
}

// Plans the meadow. Pure: the same arguments always give the same plan.
//   seed     the seeded generator's seed (the game uses MEADOW_SEED)
//   bounds   { minX, maxX, minZ, maxZ }: everything stands inside it
//   keepOut  { rects: [{ minX, maxX, minZ, maxZ }], circles: [{ x, z, r }],
//              calm: { camera, screens, groundAt } or null }: nothing stands
//              in a rect or circle; no tall flower or tree shows behind a
//              calm screen rectangle (normalized device coordinates, seen
//              from `camera` as in camera.js, with the ground at
//              groundAt(x, z))
// Returns {
//   patches: [{ species, x, z, radius, plants: [{ x, z, look }] }]
//            about MEADOW_PATCHES drifts of 5 to 14 plants of ONE kind,
//            its looks mixed, as many of each kind as patchQuota gives
//            where there is room
//   clover:  [{ x, z, look }]  edge fill of the patches
//   tufts:   [{ x, z, look }]  grass tufts, at patch edges and scattered
//   trees:   [{ x, z, look, scale, mirror, brightness }]  the back row
//            along the far edge, then 4 to 6 at the sides in the back
//            third of the visible ground; scale is always 1, mirror a boolean,
//            brightness 1 plus or minus MEADOW_TREE_BRIGHTNESS
//   bushes:  [{ x, z, look }]  near trees, the fence and patches
//   bales:   [{ x, z }]  two near the fence, one beside a patch
// }
// Every plant, clover and tuft is at least MEADOW_SPACING from every other
// plant (Poisson-disc spacing).
export function planMeadow(seed, bounds = MEADOW_BOUNDS, keepOut = meadowKeepOut()) {
  const random = seededRandom(seed);
  const between = (lo, hi) => lo + random() * (hi - lo);
  const intBetween = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  const taken = []; // { x, z, space }

  const inside = (x, z) => x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
  const isFree = (x, z, space) => {
    for (const t of taken) {
      const need = Math.max(space, t.space);
      const dx = x - t.x;
      const dz = z - t.z;
      if (dx * dx + dz * dz < need * need) return false;
    }
    return true;
  };
  // A spot where something with personal space `space` (and `height`, if
  // it must stay out of the calm areas) may stand.
  const canStand = (x, z, space, height = 0) => inside(x, z) && !isKeptOut(keepOut, x, z)
    && isFree(x, z, space) && !(height > 0 && showsBehindCalm(keepOut, x, z, height));
  const take = (x, z, space) => taken.push({ x, z, space });

  // The back row of trees stands just in front of the far edge, where the
  // meadow meets the hills: TREE_ROW_SPACING apart on average at irregular
  // spacing along the whole row (horizon.js, wider than the widest screen,
  // so no gap ever shows), its trunk bases between TREE_ROW_Z[0] and [1].
  // Being the horizon, it may stand behind the HUD cards. Then a few side
  // trees on the left and right, only in the back third of the visible
  // ground, so the sides and the front stay open.
  const trees = [];
  const scale = MEADOW_TREE_SCALE;
  const rowMinX = Math.max(bounds.minX, -TREE_ROW_HALF_WIDTH);
  const rowMaxX = Math.min(bounds.maxX, TREE_ROW_HALF_WIDTH);
  const rowMinZ = Math.max(bounds.minZ, TREE_ROW_Z[0]);
  const rowMaxZ = Math.min(bounds.maxZ, TREE_ROW_Z[1]);
  const rowCount = Math.round((rowMaxX - rowMinX) / TREE_ROW_SPACING);
  for (let n = 0; n < rowCount && rowMaxZ >= rowMinZ; n++) {
    const slot = (rowMaxX - rowMinX) / rowCount;
    for (let i = 0; i < 40; i++) {
      const x = rowMinX + slot * (n + 0.5 + (random() - 0.5) * 0.6);
      const z = between(rowMinZ, rowMaxZ);
      if (!inside(x, z) || isKeptOut(keepOut, x, z) || !isFree(x, z, SPACE.tree)) continue;
      take(x, z, SPACE.tree);
      trees.push({ x, z, look: intBetween(0, TREE_LOOKS - 1), scale });
      break;
    }
  }
  const sideTrees = intBetween(MEADOW_TREES_SIDE[0], MEADOW_TREES_SIDE[1]);
  const sideMinZ = Math.max(bounds.minZ, TREE_ROW_Z[1] + 0.8);
  const sideMaxZ = Math.min(bounds.maxZ, SIDE_TREE_MAX_Z);
  for (let n = 0; n < sideTrees; n++) {
    const sign = n % 2 ? 1 : -1;
    for (let i = 0; i < 400; i++) {
      const z = between(sideMinZ, sideMaxZ);
      // Out to the edge of the 16:9 screen at this depth.
      const edge = Math.min(bounds.maxX, sideEdge(z) - 0.5);
      const x = sign * between(edge - 6, edge);
      if (!canStand(x, z, SPACE.tree, TREE_HEIGHT * scale)) continue;
      take(x, z, SPACE.tree);
      trees.push({ x, z, look: intBetween(0, TREE_LOOKS - 1), scale });
      break;
    }
  }

  // Trees vary by mirroring and brightness, never by scale. Their own
  // generator, so the rest of the plan does not depend on it.
  const treeLooks = seededRandom(seed + 3);
  for (const tree of trees) {
    tree.mirror = treeLooks() < 0.5;
    tree.brightness = 1 + (treeLooks() * 2 - 1) * MEADOW_TREE_BRIGHTNESS;
  }

  // Two hay bales near the fence, just outside its margin.
  const bales = [];
  const fence = keepOut.rects?.length ? Math.max(...keepOut.rects.map((r) => r.maxX)) : 0;
  for (let n = 0; n < MEADOW_BALES - 1; n++) {
    const sign = n % 2 ? 1 : -1;
    for (let i = 0; i < 200; i++) {
      const x = sign * (fence + between(0.6, 1.6));
      const z = between(bounds.minZ + 1, bounds.maxZ - 3);
      if (!canStand(x, z, SPACE.bale)) continue;
      take(x, z, SPACE.bale);
      bales.push({ x, z });
      break;
    }
  }

  // Clover and grass tufts fill the edge of a patch. fillEdge plants one
  // (clover or a tuft) just outside its radius and says whether it could.
  const clover = [];
  const tufts = [];
  const tuftTarget = intBetween(MEADOW_TUFTS[0], MEADOW_TUFTS[1]);
  const fillEdge = (patch, isClover) => {
    const space = isClover ? SPACE.flower : SPACE.tuft;
    for (let i = 0; i < 120; i++) {
      const angle = random() * Math.PI * 2;
      const dist = patch.radius + between(EDGE_GAP[0], EDGE_GAP[1]);
      const x = patch.x + Math.cos(angle) * dist * 1.25;
      const z = patch.z + Math.sin(angle) * dist * 0.85;
      if (!canStand(x, z, space)) continue;
      take(x, z, space);
      if (isClover) clover.push({ x, z, look: 0 });
      else tufts.push({ x, z, look: intBetween(0, TUFT_LOOKS - 1) });
      return true;
    }
    return false;
  };

  // Flower patches: the kinds shared out by weight (patchQuota), the most
  // particular kinds planted first, each on a Poisson-spaced centre where it
  // may grow, as a drift of plants around the centre.
  const patches = [];
  const centres = [];
  const quota = patchQuota();
  const order = { tall: 0, low: 1, mid: 2 };
  const queue = [];
  for (const species of PATCH_SPECIES) for (let n = 0; n < quota[species.name]; n++) queue.push(species);
  for (let i = queue.length - 1; i > 0; i--) { // seeded shuffle
    const j = Math.floor(random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  queue.sort((a, b) => order[a.height] - order[b.height]); // stable: shuffled within a height
  const mayGrow = (species, x, z) => {
    if (species.height === 'tall') return z <= TALL_MAX_Z && !showsBehindCalm(keepOut, x, z, flowerHeight(species.name));
    if (z < PATCH_MIN_Z) return false;
    return species.height !== 'low' || z > LOW_FRONT_Z;
  };
  for (const species of queue) {
    for (let tries = 0; tries < 400; tries++) {
      const cx = between(bounds.minX, bounds.maxX);
      const cz = between(bounds.minZ, bounds.maxZ);
      if (isKeptOut(keepOut, cx, cz)) continue;
      if (centres.some((c) => Math.hypot(c.x - cx, c.z - cz) < PATCH_GAP)) continue;
      if (!mayGrow(species, cx, cz)) continue;
      const height = species.height === 'tall' ? flowerHeight(species.name) : 0;
      const want = intBetween(MEADOW_PATCH_PLANTS[0], MEADOW_PATCH_PLANTS[1]);
      const radius = 0.35 + 0.42 * Math.sqrt(want);
      const plants = [];
      for (let i = 0; i < want * 30 && plants.length < want; i++) {
        // A slightly wide drift, denser in the middle.
        const angle = random() * Math.PI * 2;
        const dist = radius * Math.sqrt(random());
        const x = cx + Math.cos(angle) * dist * 1.25;
        const z = cz + Math.sin(angle) * dist * 0.85;
        if (!canStand(x, z, SPACE.flower, height)) continue;
        take(x, z, SPACE.flower);
        plants.push({ x, z, look: 0 });
      }
      const patch = { species: species.name, x: cx, z: cz, radius, plants };
      // Every patch gets clover and a grass tuft at its edge, at once,
      // before its neighbours take the room.
      const cloverBefore = clover.length;
      const tuftsBefore = tufts.length;
      if (plants.length < MEADOW_PATCH_PLANTS[0] || !fillEdge(patch, true) || !fillEdge(patch, false)) {
        // too cramped here: give the spots back
        taken.length -= plants.length + (clover.length - cloverBefore) + (tufts.length - tuftsBefore);
        clover.length = cloverBefore;
        tufts.length = tuftsBefore;
        continue;
      }
      // Looks mix: they take turns in planting order, which is random in space.
      const first = intBetween(0, species.looks - 1);
      plants.forEach((plant, i) => { plant.look = (first + i) % species.looks; });
      centres.push({ x: cx, z: cz });
      patches.push(patch);
      break;
    }
  }

  // A few more clover and tufts at the patch edges, up to two each.
  for (const patch of patches) {
    const extra = intBetween(0, 2);
    for (let n = 0; n < extra; n++) fillEdge(patch, random() < 0.5);
  }

  // The third bale stands on its own beside a patch.
  for (let i = 0; i < 400 && bales.length < MEADOW_BALES && patches.length; i++) {
    const patch = patches[intBetween(0, patches.length - 1)];
    const angle = random() * Math.PI * 2;
    const dist = patch.radius * 1.25 + between(0.6, 1.2);
    const x = patch.x + Math.cos(angle) * dist;
    const z = patch.z + Math.sin(angle) * dist;
    if (!canStand(x, z, SPACE.bale)) continue;
    take(x, z, SPACE.bale);
    bales.push({ x, z });
  }

  // Bushes near trees and the fence; the flowering one near the patches.
  const bushes = [];
  const bushCount = intBetween(MEADOW_BUSHES[0], MEADOW_BUSHES[1]);
  for (let n = 0, i = 0; n < bushCount && i < 8000; i++) {
    const near = n % 3; // 0: a tree, 1: the fence, 2: a patch
    let x;
    let z;
    if (near === 0 && trees.length) {
      const tree = trees[intBetween(0, trees.length - 1)];
      const angle = random() * Math.PI * 2;
      x = tree.x + Math.cos(angle) * between(0.8, 1.6);
      z = tree.z + Math.sin(angle) * between(0.8, 1.6);
    } else if (near === 2 && patches.length) {
      const patch = patches[intBetween(0, patches.length - 1)];
      const angle = random() * Math.PI * 2;
      const dist = patch.radius * 1.25 + between(0.4, 1.0);
      x = patch.x + Math.cos(angle) * dist;
      z = patch.z + Math.sin(angle) * dist;
    } else {
      const sign = random() < 0.5 ? -1 : 1;
      x = sign * (fence + between(0.4, 1.4));
      z = between(bounds.minZ + 1, bounds.maxZ - 2);
    }
    if (!canStand(x, z, SPACE.bush)) continue;
    take(x, z, SPACE.bush);
    const plain = random() < 0.5 ? 0 : 2;
    bushes.push({ x, z, look: near === 2 ? BUSH_FLOWERING : plain });
    n++;
  }

  // Grass tufts scattered over the rest of the meadow.
  for (let i = 0; i < 30000 && tufts.length < tuftTarget; i++) {
    const x = between(bounds.minX, bounds.maxX);
    const z = between(bounds.minZ, bounds.maxZ);
    if (!canStand(x, z, SPACE.tuft)) continue;
    take(x, z, SPACE.tuft);
    tufts.push({ x, z, look: intBetween(0, TUFT_LOOKS - 1) });
  }

  return { patches, clover, tufts, trees, bushes, bales };
}

// The two side strips of the meadow that a window wider than 21:9 shows
// (docs/art-direction-v3-1.md section 3.3): from MEADOW_STRIP_INNER_X (or
// the edge of MEADOW_BOUNDS, if that is further out, so the strips never
// overlap the central meadow) out to the ground's GROUND_HALF_WIDTH on each
// side, as deep as MEADOW_BOUNDS.
export const MEADOW_STRIP_INNER_X = 27;
const STRIP_INNER_X = Math.max(MEADOW_STRIP_INNER_X, MEADOW_BOUNDS.maxX);
export const MEADOW_STRIPS = Object.freeze([
  Object.freeze({ side: 'left', seedOffset: 1, bounds: Object.freeze({ ...MEADOW_BOUNDS, minX: -GROUND_HALF_WIDTH, maxX: -STRIP_INNER_X }) }),
  Object.freeze({ side: 'right', seedOffset: 2, bounds: Object.freeze({ ...MEADOW_BOUNDS, minX: STRIP_INNER_X, maxX: GROUND_HALF_WIDTH }) }),
]);

// The side strips planned by planMeadow itself (unchanged, with the same
// species and spacing rules), a second deterministic call per strip with a
// derived seed: `seed` plus 1 for the left strip, plus 2 for the right one.
// planMeadow(seed) still gives the central meadow exactly as before.
// Returns one plan of the same shape as planMeadow's with both strips.
export function planMeadowStrips(seed) {
  return mergeMeadowPlans(...MEADOW_STRIPS.map((strip) => planMeadow(seed + strip.seedOffset, strip.bounds)));
}

// One plan with everything of `plans` (each shaped like planMeadow's), in order.
export function mergeMeadowPlans(...plans) {
  const merged = { patches: [], clover: [], tufts: [], trees: [], bushes: [], bales: [] };
  for (const plan of plans) for (const key of Object.keys(merged)) merged[key].push(...plan[key]);
  return merged;
}

// Everything in a plan that stands on the ground, as [{ kind, x, z }], for
// checks: kind is a flower species, 'tuft', 'tree', 'bush' or 'bale'.
export function meadowItems(plan) {
  return [
    ...plan.patches.flatMap((p) => p.plants.map((plant) => ({ kind: p.species, ...plant }))),
    ...plan.clover.map((c) => ({ kind: 'clover', ...c })),
    ...plan.tufts.map((t) => ({ kind: 'tuft', ...t })),
    ...plan.trees.map((t) => ({ kind: 'tree', ...t })),
    ...plan.bushes.map((b) => ({ kind: 'bush', ...b })),
    ...plan.bales.map((b) => ({ kind: 'bale', ...b })),
  ];
}

// Blob shadow radius (world units) of each kind of scenery.
const SHADOW_RADIUS = { tree: 0.6, bush: 0.38, bale: 0.42 };
const PATCH_SHADOW_REACH = 1.1; // a patch shadow reaches a little past its plants

// Where the soft blob shadows of a plan lie, as { x, z, r } spots: one
// under every tree, bush and hay bale (`scenery`) and one under every
// flower patch (`patches`).
export function meadowShadowSpots(plan) {
  return {
    scenery: [
      ...plan.trees.map((t) => ({ x: t.x, z: t.z, r: SHADOW_RADIUS.tree * t.scale })),
      ...plan.bushes.map((b) => ({ x: b.x, z: b.z, r: SHADOW_RADIUS.bush })),
      ...plan.bales.map((b) => ({ x: b.x, z: b.z, r: SHADOW_RADIUS.bale })),
    ],
    patches: plan.patches.map((p) => ({ x: p.x, z: p.z, r: p.radius * PATCH_SHADOW_REACH })),
  };
}

export function flowerSpecies(name) {
  return SPECIES[name] ?? null;
}

// The flowers of a plan grouped for drawing: one group per species that
// has any plants, { species, items: [{ x, z, look }] }, each drawn as one
// instanced mesh (one draw call per species at most). Clover is the patch
// edge fill.
export function meadowInstanceGroups(plan) {
  const groups = [];
  for (const species of FLOWER_SPECIES) {
    const items = species.name === 'clover'
      ? plan.clover
      : plan.patches.filter((p) => p.species === species.name).flatMap((p) => p.plants);
    if (items.length) groups.push({ species: species.name, items });
  }
  return groups;
}

// The dandelion seed puffs of a plan (dandelion plants showing look 1):
// each lets a seed fleck go every 6 to 10 seconds on High.
export const DANDELION_PUFF_LOOK = 1;
export function dandelionPuffs(plan) {
  return plan.patches.filter((p) => p.species === 'dandelion')
    .flatMap((p) => p.plants.filter((plant) => plant.look === DANDELION_PUFF_LOOK));
}

// The two far hill silhouettes behind the far edge of the meadow, far then
// near. Each top edge is a sum of sines (`waves`: [frequency per world unit,
// degrees, phase]) added to the angle below the horizon it stands at,
// `depressionDeg`: the screen row `crestY` percent down from the top
// (depressionAtScreenY in horizon.js), so the crests stay between 15 and 19
// percent down. Their feet reach far below the far edge, where the meadow
// covers them, so no gap shows. `haze` is how much of the sky colour is
// mixed in; the far hill is hazier. High adds HILL_FOOT_HAZE more toward
// their foot.
export const FAR_HILLS = Object.freeze([
  { z: -80, crestY: 16.4, color: '#8fcf8a', haze: 0.3, waves: [[0.045, 0.1, 0.4], [0.11, 0.04, 2.1], [0.023, 0.06, 4.0]] },
  { z: -64, crestY: 17.6, color: '#6fba6a', haze: 0.12, waves: [[0.06, 0.1, 1.3], [0.14, 0.04, 0.2], [0.03, 0.06, 5.2]] },
].map((hill) => Object.freeze({ ...hill, depressionDeg: depressionAtScreenY(hill.crestY) })));
// World units each hill silhouette reaches down below its top.
export const HILL_DEPTH = 40;
export const HILL_FOOT_HAZE = 0.6;

// Degrees the top of `hill` rises at world x: its sum of sines.
export function hillLift(hill, x) {
  let lift = 0;
  for (const [frequency, amplitude, phase] of hill.waves) lift += amplitude * Math.sin(x * frequency + phase);
  return lift;
}

// `color` mixed `amount` (0 to 1) of the way toward `sky` (both '#rrggbb'),
// as [r, g, b] from 0 to 1.
export function hazeMix(color, sky, amount) {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const a = rgb(color);
  const b = rgb(sky);
  return a.map((v, i) => v + (b[i] - v) * amount);
}
