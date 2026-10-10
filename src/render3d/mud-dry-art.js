// The dried, cracked crust of a Mud Trap puddle as a flat cell decal (a pure
// pixel tile, no art file): the shape of the puddle (mud-puddle.png) in pale
// dry earth with dark cracks running out from the middle. It shows over a
// puddle that dried by itself (event mudDried) or whose seed has surfaced
// (stoneSurfaced) and fades away, so the mud is seen to dry and crack.
// Pure: no DOM or Three.js, so it runs under node --test.

import { createGrid, fillEllipse, line, setPixel } from './pixel-art.js';

export const DRY_TILE_PX = 32; // one cell, like the v3 decals
export const DRY_COLOURS = Object.freeze({ rim: '#7a5a34', base: '#b8935a', light: '#d2b07a', crack: '#5d3a2a' });

// The cracks: from the middle out to the rim, each with a short branch.
const CRACKS = Object.freeze([
  [16, 16, 8, 8], [8, 8, 5, 10],
  [16, 16, 25, 9], [25, 9, 27, 12],
  [16, 16, 24, 24], [24, 24, 21, 26],
  [16, 16, 9, 24], [9, 24, 6, 21],
  [16, 16, 16, 5], [16, 11, 20, 8],
  [16, 16, 4, 17],
]);

export function dryMudTileGrid() {
  const n = DRY_TILE_PX;
  const grid = createGrid(n, n);
  fillEllipse(grid, 16, 16, 14, 12, DRY_COLOURS.rim);
  fillEllipse(grid, 16, 16, 13, 11, DRY_COLOURS.base);
  fillEllipse(grid, 11, 12, 5, 3, DRY_COLOURS.light);
  fillEllipse(grid, 21, 20, 4, 3, DRY_COLOURS.light);
  for (const [x0, y0, x1, y1] of CRACKS) line(grid, x0, y0, x1, y1, DRY_COLOURS.crack);
  for (const [x, y] of [[12, 19], [13, 19], [20, 13], [19, 13]]) setPixel(grid, x, y, DRY_COLOURS.light);
  return grid;
}
