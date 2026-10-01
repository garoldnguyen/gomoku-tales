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
