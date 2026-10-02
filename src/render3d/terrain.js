// The ground of Map 1, Windy Spring Breeze Hill (docs/art-direction-v3.md
// sections 6 and 7). No Three.js imports, so it runs under node --test.
//
// The meadow is perfectly flat: height 0 everywhere, no dome, no rim, no
// hills under it. It is one rectangle (TERRAIN_GRID, the GROUND_RECT of
// horizon.js) that reaches past the left, right and bottom of the screen
// and ends at the far edge that farEdgeZ places 21 percent down the screen,
// the horizon. The far hills stand behind that edge (meadow-scene.js).

import { GROUND_RECT } from './horizon.js';

export const GROUND_Y = 0;

// Ground height at (x, z): always GROUND_Y.
export function terrainHeight() {
  return GROUND_Y;
}

// The drawn ground: a flat rectangle over this area (meadow-scene.js
// builds it), `cell` world units between its columns.
export const TERRAIN_GRID = Object.freeze({ ...GROUND_RECT, cell: 1 });

// Height of the drawn ground at (x, z): the ground is flat, so GROUND_Y.
export function groundMeshHeight() {
  return GROUND_Y;
}
