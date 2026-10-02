// Pure layout of the farmland board (docs/art-direction-v3.md section 3):
// where the field, the wooden curb, the fence and the dirt path go, and how
// the field and zone textures map onto the cells. src/render3d/farm-field.js
// builds the meshes from it. The field covers exactly the cells that
// src/render3d/picking.js picks, at the same height. No Three.js imports,
// so it runs under node --test.

import {
  BOARD_SIZE, CELL_SIZE, CURB_HEIGHT, CURB_PX, FENCE_OFFSET_CELLS,
  FENCE_POST_EVERY, FENCE_RAIL_PX, PATH_LENGTH_CELLS, PATH_STONES, PATH_WIDTH_CELLS, PX_WORLD, SPRITE_STRETCH_Y,
} from '../config.js';
import { GROUND_Y } from './terrain.js';

const HALF = (BOARD_SIZE * CELL_SIZE) / 2;
const CURB_WIDTH = CURB_PX * PX_WORLD;
const FENCE_LINE = HALF + CURB_WIDTH + FENCE_OFFSET_CELLS * CELL_SIZE;
const PATH_START = HALF + CURB_WIDTH;

// The field plane: centred on the origin at y = 0 (the picking plane),
// `size` world units square. Its texture's top row lies at -z, row 0.
export const FIELD = { size: BOARD_SIZE * CELL_SIZE, y: 0 };

// The curb around the field: a raised wooden frame CURB_HEIGHT tall
// standing on the flat meadow, its top face and its outer face (the darker
// camera-side face) running from the ground up to the top. The plots inside
// stay at y = 0. Heights are world y.
export const CURB = {
  inner: HALF, // distance from the centre to the field edge
  width: CURB_WIDTH,
  top: GROUND_Y + CURB_HEIGHT,
  faceHeight: CURB_HEIGHT, // the outer face, from the ground to the top
  ground: GROUND_Y, // the flat meadow, level with the plots
};

// The heights farm-field.js builds the curb's faces with, as [bottom, top]
// world y: its top face, its outer (camera-side) face standing on the
// meadow and its inner face standing on the plots.
export const CURB_FACES = Object.freeze({
  top: CURB.top,
  outer: Object.freeze([CURB.ground, CURB.top]),
  inner: Object.freeze([FIELD.y, CURB.top]),
});

// Texel { u, v } (in pixels, from the top left) of a field texture
// `texturePx` wide under world point (wx, wz), or null off the field.
export function fieldTexel(wx, wz, texturePx) {
  const u = ((wx + HALF) / FIELD.size) * texturePx;
  const v = ((wz + HALF) / FIELD.size) * texturePx;
  if (u < 0 || v < 0 || u >= texturePx || v >= texturePx) return null;
  return { u, v };
}

// One side of the curb, as a map from (along, across) to world (x, z):
// `along` runs the length of the side, `across` from the field edge (0)
// outward (CURB.width). The camera looks from the +z side ('front').
export const CURB_SIDES = [
  { name: 'back', toWorld: (along, across) => ({ x: along, z: -(HALF + across) }), outward: { x: 0, z: -1 } },
  { name: 'front', toWorld: (along, across) => ({ x: along, z: HALF + across }), outward: { x: 0, z: 1 } },
  { name: 'left', toWorld: (along, across) => ({ x: -(HALF + across), z: along }), outward: { x: -1, z: 0 } },
  { name: 'right', toWorld: (along, across) => ({ x: HALF + across, z: along }), outward: { x: 1, z: 0 } },
];

// The mitred top of a curb side: its four corners [inner start, inner end,
// outer end, outer start] as { along, across }. Neighbouring sides meet on
// the diagonals, so the corners close without overlap.
export function curbTopCorners() {
  const outer = HALF + CURB_WIDTH;
  return [
    { along: -HALF, across: 0 },
    { along: HALF, across: 0 },
    { along: outer, across: CURB_WIDTH },
    { along: -outer, across: CURB_WIDTH },
  ];
}

// Fence posts { x, z } on the ground: along the back, left and right sides
// on the fence line, one every FENCE_POST_EVERY cells in step with the cell
// edges, plus the two back corners. The front stays open for the path.
export function fencePosts() {
  const posts = [];
  const step = FENCE_POST_EVERY * CELL_SIZE;
  const ticks = [];
  for (let t = -HALF; t <= HALF + 1e-9; t += step) ticks.push(t);
  posts.push({ x: -FENCE_LINE, z: -FENCE_LINE }, { x: FENCE_LINE, z: -FENCE_LINE });
  for (const t of ticks) {
    posts.push({ x: t, z: -FENCE_LINE });
    posts.push({ x: -FENCE_LINE, z: t });
    posts.push({ x: FENCE_LINE, z: t });
  }
  return posts;
}

// The straight runs of rail between the end posts: { from, to } world
// points on the ground, and the rail heights (world y above the ground).
export function fenceRails() {
  const front = HALF;
  return [
    { side: 'back', from: { x: -FENCE_LINE, z: -FENCE_LINE }, to: { x: FENCE_LINE, z: -FENCE_LINE } },
    { side: 'left', from: { x: -FENCE_LINE, z: -FENCE_LINE }, to: { x: -FENCE_LINE, z: front } },
    { side: 'right', from: { x: FENCE_LINE, z: -FENCE_LINE }, to: { x: FENCE_LINE, z: front } },
  ];
}

export const FENCE_RAIL_HEIGHTS = FENCE_RAIL_PX.map((px) => px * PX_WORLD * SPRITE_STRETCH_Y);

// The dirt path from the middle of the front curb toward the camera, and
// its stepping stones { x, z }.
export const PATH = {
  x: 0,
  width: PATH_WIDTH_CELLS * CELL_SIZE,
  startZ: PATH_START,
  endZ: PATH_START + PATH_LENGTH_CELLS * CELL_SIZE,
};

export function pathStones() {
  return PATH_STONES.map((cells, i) => ({ x: (i % 2 ? 0.15 : -0.15) * CELL_SIZE, z: PATH_START + cells * CELL_SIZE }));
}

// The texture rectangle { u0, u1, v0, v1 } (0 to 1, v up as in WebGL) of
// the part of a 3x3-cell zone decal that lies on the cell (dx, dy) cells
// from the zone centre (-1, 0 or 1 each). Row dy = -1 is the far row, the
// top of the image.
export function zonePieceUv(dx, dy) {
  return {
    u0: (dx + 1) / 3,
    u1: (dx + 2) / 3,
    v0: 1 - (dy + 2) / 3,
    v1: 1 - (dy + 1) / 3,
  };
}
