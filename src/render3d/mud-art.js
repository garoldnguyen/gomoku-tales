// The mud puddle of Earth Bear's Mud Trap as a flat cell decal (a pure
// pixel tile, no art file): a rough brown patch on the plot with a few
// lighter bubbles. Pure: no DOM or Three.js, so it runs under node --test.

import { createGrid, fillEllipse, setPixel } from './pixel-art.js';

export const MUD_TILE_PX = 32; // one cell, like the v3 decals
export const MUD_COLOURS = Object.freeze({ dark: '#523720', base: '#6b4a2b', light: '#8a6338', bubble: '#b08a58' });

export function mudTileGrid() {
  const n = MUD_TILE_PX;
  const grid = createGrid(n, n);
  fillEllipse(grid, 16, 17, 14, 11, MUD_COLOURS.dark);
  fillEllipse(grid, 16, 16, 13, 10, MUD_COLOURS.base);
  fillEllipse(grid, 11, 13, 6, 3, MUD_COLOURS.light);
  fillEllipse(grid, 21, 20, 5, 3, MUD_COLOURS.light);
  for (const [x, y] of [[9, 19], [10, 19], [19, 12], [20, 12], [24, 15], [14, 21], [15, 21], [15, 20]]) setPixel(grid, x, y, MUD_COLOURS.bubble);
  return grid;
}
