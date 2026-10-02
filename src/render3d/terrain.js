// Pure height field for Map 1, Windy Spring Breeze Hill
// (docs/art-direction-hd2d.md section C). No Three.js imports, so it runs
// under node --test.
//
// The board and both characters sit on a flat plateau at the bottom of the
// board slab. Around it the grass rolls gently and the hill falls away: a
// little towards the camera (+z), more to the sides and most behind the
// board, so the fixed camera sees the far hills and the sky above the crest.

import { BOARD_THICKNESS } from '../config.js';

export const GROUND_Y = -BOARD_THICKNESS;
export const PLATEAU_HALF_X = 12.5; // covers the board and the characters
export const PLATEAU_HALF_Z = 9.5;
const PLATEAU_CORNER = 2.5; // rounded corners
const ROLL_RAMP = 4; // the rolling bumps fade in over this distance from the plateau
const DROP_BACK = 0.2; // how fast the hill falls away behind the board (-z)
const DROP_SIDE = 0.12;
const DROP_FRONT = 0.04;
const LOWEST_Y = -50;

// Distance from (x, z) to the plateau, 0 inside it.
export function plateauDistance(x, z) {
  const inner = PLATEAU_CORNER;
  const qx = Math.max(Math.abs(x) - (PLATEAU_HALF_X - inner), 0);
  const qz = Math.max(Math.abs(z) - (PLATEAU_HALF_Z - inner), 0);
  return Math.max(Math.hypot(qx, qz) - inner, 0);
}

// Ground height at (x, z).
export function terrainHeight(x, z) {
  const d = plateauDistance(x, z);
  if (d === 0) return GROUND_Y;
  const ramp = Math.min(d / ROLL_RAMP, 1);
  const rolling =
    0.55 * Math.sin(x * 0.45 + 1.3) * Math.sin(z * 0.38 + 0.4) +
    0.3 * Math.sin(x * 0.9 - z * 0.6 + 2.1);
  // Blend the fall-off rate by direction: behind, beside or in front.
  const len = Math.hypot(x, z) || 1;
  const back = Math.max(-z / len, 0);
  const front = Math.max(z / len, 0);
  const side = Math.abs(x) / len;
  const rate = (DROP_BACK * back + DROP_FRONT * front + DROP_SIDE * side) / (back + front + side);
  return Math.max(GROUND_Y + rolling * ramp * ramp - rate * d * d, LOWEST_Y);
}

// The drawn ground: a PlaneGeometry grid over this area with `cell`-sized
// squares, its vertices at terrainHeight (meadow-scene.js builds it).
export const TERRAIN_GRID = Object.freeze({ minX: -48, maxX: 48, minZ: -36, maxZ: 26, cell: 1 });

// Height at (x, z) of the drawn ground of `grid`: terrainHeight at the grid
// vertices and flat across each triangle in between, split along the same
// diagonal as Three.js's PlaneGeometry laid flat. Things stood on this
// height sit exactly on the ground mesh, never above or inside it.
// Outside the grid the nearest edge is used.
export function groundMeshHeight(x, z, grid = TERRAIN_GRID) {
  const { minX, maxX, minZ, maxZ, cell } = grid;
  const columns = Math.round((maxX - minX) / cell);
  const rows = Math.round((maxZ - minZ) / cell);
  const gx = Math.min(Math.max((x - minX) / cell, 0), columns);
  const gz = Math.min(Math.max((z - minZ) / cell, 0), rows);
  const ix = Math.min(Math.floor(gx), columns - 1);
  const iz = Math.min(Math.floor(gz), rows - 1);
  const fx = gx - ix;
  const fz = gz - iz;
  const at = (i, j) => terrainHeight(minX + i * cell, minZ + j * cell);
  // Each square is two triangles split on the diagonal from (ix, iz + 1)
  // to (ix + 1, iz).
  if (fx + fz <= 1) {
    const h = at(ix, iz);
    return h + (at(ix + 1, iz) - h) * fx + (at(ix, iz + 1) - h) * fz;
  }
  const h = at(ix + 1, iz + 1);
  return h + (at(ix, iz + 1) - h) * (1 - fx) + (at(ix + 1, iz) - h) * (1 - fz);
}

// A grid draped on the ground, for a blob shadow `halfX` by `halfZ` world
// units around (x, z): vertices every `step` units (at most), each `lift`
// above heightAt(x, z), with uv 0 to 1 across. Returns { positions, uvs,
// indices } as plain arrays to append to a bigger geometry.
export function drapedGrid(x, z, halfX, halfZ, step, heightAt, lift) {
  const nx = Math.max(1, Math.ceil((2 * halfX) / step));
  const nz = Math.max(1, Math.ceil((2 * halfZ) / step));
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const v = j / nz;
      const px = x - halfX + 2 * halfX * u;
      const pz = z - halfZ + 2 * halfZ * v;
      positions.push(px, heightAt(px, pz) + lift, pz);
      uvs.push(u, 1 - v);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + nx + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { positions, uvs, indices };
}
