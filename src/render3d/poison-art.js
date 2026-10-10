// A poisoned plot of Jade Serpent's Venom zone as a flat cell decal (a pure
// pixel tile, no art file): the whole plot tinted withered purple, with
// darker blotches and a few pale spore dots. The real Venom effects (fog,
// bubbles, the red crossed-out hover border) are a later task. Pure: no DOM
// or Three.js, so it runs under node --test.

import { createGrid, fillEllipse, fillRect, setPixel } from './pixel-art.js';

export const POISON_TILE_PX = 32; // one cell, like the v3 decals
export const POISON_COLOURS = Object.freeze({ base: '#6a4a86', dark: '#4a2f63', light: '#8d6aa8', spore: '#c9a9dc' });

export function poisonTileGrid() {
  const n = POISON_TILE_PX;
  const grid = createGrid(n, n);
  fillRect(grid, 1, 1, n - 2, n - 2, POISON_COLOURS.base);
  fillEllipse(grid, 9, 22, 7, 5, POISON_COLOURS.dark);
  fillEllipse(grid, 23, 9, 6, 4, POISON_COLOURS.dark);
  fillEllipse(grid, 21, 23, 5, 3, POISON_COLOURS.light);
  fillEllipse(grid, 10, 8, 4, 3, POISON_COLOURS.light);
  for (const [x, y] of [[6, 14], [7, 14], [16, 16], [17, 16], [26, 19], [13, 27], [14, 27], [27, 5]]) setPixel(grid, x, y, POISON_COLOURS.spore);
  return grid;
}
