// Placeholder pixel art for the HD-2D lab, generated at runtime so no image
// files are needed (docs/art-direction-hd2d.md section D). Every function
// returns pixel grids from src/render3d/pixel-art.js; animated art returns
// one grid per frame. Sprites stand on the bottom row of their frame.
// Pure: no DOM or Three.js.

import { CHARACTER_SPRITE_PX, PIECE_SPRITE_PX } from '../config.js';
import {
  blit, createGrid, fillEllipse, fillRect, gridFromRows, line, outline, setPixel, shadeEllipse,
} from './pixel-art.js';
import { seededRandom } from './seeded-random.js';

const OUTLINE = '#2b1d3a';
const WHITE = '#ffffff';

// Whole-pixel offsets of the 4 frame idle bob: the body sinks and rises
// while the feet stay planted.
export const IDLE_BOB = [0, 1, 2, 1];

// Wind Rabbit: a white rabbit with a blue scarf that flutters in the wind.
export function rabbitFrames() {
  return IDLE_BOB.map((b, frame) => {
    const g = createGrid(CHARACTER_SPRITE_PX, CHARACTER_SPRITE_PX);
    const shade = '#e2dbeb';
    const pink = '#ffb3c7';
    const scarf = '#3f7fd8';
    const scarfDark = '#2a5cae';
    const scarfLight = '#86b8f2';

    fillEllipse(g, 40, 91, 6, 3.5, WHITE);
    fillEllipse(g, 56, 91, 6, 3.5, WHITE);

    fillEllipse(g, 48, 76 + b, 14, 13, shade);
    shadeEllipse(g, 46, 74 + b, 12, 11, WHITE);
    fillEllipse(g, 35, 75 + b, 4, 6, shade);
    fillEllipse(g, 61, 75 + b, 4, 6, shade);

    fillEllipse(g, 41, 26 + b, 4.5, 13, WHITE);
    fillEllipse(g, 55, 26 + b, 4.5, 13, WHITE);
    fillEllipse(g, 41, 27 + b, 2, 9, pink);
    fillEllipse(g, 55, 27 + b, 2, 9, pink);

    fillEllipse(g, 48, 50 + b, 16, 13, shade);
    shadeEllipse(g, 46, 48 + b, 15, 12, WHITE);
    fillRect(g, 40, 47 + b, 3, 4, OUTLINE);
    fillRect(g, 53, 47 + b, 3, 4, OUTLINE);
    setPixel(g, 40, 47 + b, WHITE);
    setPixel(g, 53, 47 + b, WHITE);
    fillRect(g, 36, 53 + b, 3, 2, pink);
    fillRect(g, 57, 53 + b, 3, 2, pink);
    fillRect(g, 47, 53 + b, 2, 2, pink);
    setPixel(g, 46, 56 + b, OUTLINE);
    setPixel(g, 49, 56 + b, OUTLINE);
    fillRect(g, 47, 57 + b, 2, 1, OUTLINE);

    fillEllipse(g, 48, 63 + b, 15, 2.5, scarf);
    shadeEllipse(g, 48, 65 + b, 15, 1, scarfDark);
    line(g, 38, 61 + b, 56, 61 + b, scarfLight);
    // The scarf's loose end trails to the right and flutters.
    const flutter = IDLE_BOB[(frame + 1) % IDLE_BOB.length];
    fillRect(g, 58, 65 + b, 5, 6, scarf);
    fillRect(g, 60 + flutter, 71 + b, 5, 5, scarf);
    fillRect(g, 60 + flutter, 75 + b, 5, 1, scarfDark);
    setPixel(g, 61 + flutter, 76 + b, scarfDark);
    setPixel(g, 63 + flutter, 76 + b, scarfDark);

    outline(g, OUTLINE);
    return g;
  });
}

// Earth Bear: a sturdy brown bear with a little sprout on its head.
export function bearFrames() {
  return IDLE_BOB.map((b) => {
    const g = createGrid(CHARACTER_SPRITE_PX, CHARACTER_SPRITE_PX);
    const brown = '#9b6235';
    const brownDark = '#764622';
    const brownLight = '#b97a45';
    const muzzle = '#ecc596';
    const nose = '#2b1a14';
    const earInner = '#d9966a';
    const leaf = '#6cc04a';
    const stem = '#3f8f3a';

    fillEllipse(g, 37, 91, 8, 3.5, brownDark);
    fillEllipse(g, 59, 91, 8, 3.5, brownDark);

    fillEllipse(g, 48, 74 + b, 20, 16, brownDark);
    shadeEllipse(g, 46, 72 + b, 18, 14, brown);
    fillEllipse(g, 48, 78 + b, 11, 9, muzzle);
    fillEllipse(g, 28, 73 + b, 6, 8, brownDark);
    fillEllipse(g, 68, 73 + b, 6, 8, brownDark);
    shadeEllipse(g, 28, 71 + b, 4, 6, brown);
    shadeEllipse(g, 68, 71 + b, 4, 6, brown);

    fillEllipse(g, 33, 33 + b, 7, 7, brownDark);
    fillEllipse(g, 63, 33 + b, 7, 7, brownDark);
    fillEllipse(g, 33, 34 + b, 3.5, 3.5, earInner);
    fillEllipse(g, 63, 34 + b, 3.5, 3.5, earInner);

    fillEllipse(g, 48, 47 + b, 19, 15, brownDark);
    shadeEllipse(g, 46, 45 + b, 17, 13, brown);
    shadeEllipse(g, 41, 39 + b, 6, 2.5, brownLight);
    fillEllipse(g, 48, 53 + b, 8, 5.5, muzzle);
    fillRect(g, 45, 49 + b, 6, 3, nose);
    fillRect(g, 46, 52 + b, 4, 1, nose);
    fillRect(g, 47, 56 + b, 2, 1, nose);
    fillRect(g, 38, 42 + b, 3, 4, nose);
    fillRect(g, 55, 42 + b, 3, 4, nose);
    setPixel(g, 38, 42 + b, WHITE);
    setPixel(g, 55, 42 + b, WHITE);
    fillRect(g, 33, 50 + b, 3, 2, '#e88a7a');
    fillRect(g, 60, 50 + b, 3, 2, '#e88a7a');

    line(g, 48, 28 + b, 48, 32 + b, stem);
    fillEllipse(g, 45, 28 + b, 2.5, 1.5, leaf);
    fillEllipse(g, 51, 27 + b, 2.5, 1.5, leaf);

    outline(g, OUTLINE);
    return g;
  });
}

const X_GLYPH = ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'];
const O_GLYPH = ['.###.', '#...#', '#...#', '#...#', '.###.'];

// Board stone for player 'X' (blue) or 'O' (red), with its letter on it.
export function stoneGrid(player) {
  const colors = player === 'X'
    ? { dark: '#2f63b0', body: '#4a8fe0', light: '#9ccaff' }
    : { dark: '#a8304a', body: '#e85a6e', light: '#ffa8b4' };
  const g = createGrid(PIECE_SPRITE_PX, PIECE_SPRITE_PX);
  fillEllipse(g, 16, 23, 11, 7, colors.dark);
  shadeEllipse(g, 15, 22, 10, 6, colors.body);
  shadeEllipse(g, 10, 19, 3, 1.5, colors.light);
  blit(g, gridFromRows(player === 'X' ? X_GLYPH : O_GLYPH, { '#': WHITE }), 14, 21);
  outline(g, OUTLINE);
  return g;
}

// A grey boulder with a crack and a bit of moss.
export function rockGrid() {
  const g = createGrid(PIECE_SPRITE_PX, PIECE_SPRITE_PX);
  const dark = '#6e6e80';
  fillEllipse(g, 16, 22, 12, 8.5, dark);
  fillEllipse(g, 11, 17, 7, 6, dark);
  fillEllipse(g, 20, 15, 6, 6, dark);
  shadeEllipse(g, 14, 18, 10, 8, '#9a9aaa');
  shadeEllipse(g, 17, 12, 3, 1.5, '#c8c8d4');
  shadeEllipse(g, 9, 14, 2, 1.5, '#c8c8d4');
  line(g, 18, 19, 21, 25, '#505064');
  line(g, 21, 25, 20, 28, '#505064');
  shadeEllipse(g, 25, 27, 3, 2, '#6fa04a');
  outline(g, OUTLINE);
  return g;
}

export const FLOWER_PX = 16;

const FLOWER_BLOOMS = [
  '................',
  '................',
  '...pp...........',
  '..pccp..........',
  '...pp.....pp....',
  '.........pccp...',
  '..........pp....',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const FLOWER_STEMS = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '...g............',
  '...g............',
  '...g.......g....',
  '...gl......g....',
  '..lg......lg....',
  '...g.......g....',
  '....g.....g.....',
  '....g....lg.....',
  '.....g...g......',
  '.....g..g.......',
  '......gg........',
];

const GRASS_TUFT = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.......d........',
  '..d....d....d...',
  '..d...dg...d....',
  '...d..dg..dg....',
  '...dg.dg..dg..d.',
  '.d.dg.dgg.dg.dg.',
  '.dgdgddggddgddg.',
  '..dgggdggdggdg..',
  '..gggggggggggg..',
  '...gggggggggg...',
];

const FLOWER_COLORS = {
  pink: { p: '#ff8fbf', c: '#ffe066' },
  yellow: { p: '#ffd23f', c: '#f08a24' },
  white: { p: '#ffffff', c: '#ffc83d' },
  blue: { p: '#8ab8ff', c: '#fff4b0' },
};

export const FLOWER_VARIANTS = [...Object.keys(FLOWER_COLORS), 'tuft'];

// A 16x16 clump of two wildflowers, or a grass tuft for variant 'tuft'.
export function flowerGrid(variant) {
  if (variant === 'tuft') return gridFromRows(GRASS_TUFT, { d: '#3f8f3a', g: '#6cc04a' });
  const g = gridFromRows(FLOWER_BLOOMS, FLOWER_COLORS[variant]);
  outline(g, '#5a2a4a');
  const stems = gridFromRows(FLOWER_STEMS, { g: '#3f8f3a', l: '#6cc04a' });
  // Stems go behind the blooms and their outlines.
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const i = y * g.width + x;
      if (!g.pixels[i] && stems.pixels[i]) g.pixels[i] = stems.pixels[i];
    }
  }
  return g;
}

export const CLOUD_WIDTH_PX = 48;
export const CLOUD_HEIGHT_PX = 20;

// A puffy white cloud; `seed` picks the shape of its bumps.
export function cloudGrid(seed) {
  const random = seededRandom(seed);
  const g = createGrid(CLOUD_WIDTH_PX, CLOUD_HEIGHT_PX);
  const shade = '#d6e4f2';
  fillEllipse(g, 24, 14, 21, 4.5, shade);
  const bumps = 3 + Math.floor(random() * 2);
  for (let i = 0; i < bumps; i++) {
    const cx = 10 + ((i + 0.5) / bumps) * 28 + (random() - 0.5) * 4;
    const r = 4 + random() * 4;
    fillEllipse(g, cx, 14 - r * 0.8, r + 1, r, shade);
  }
  // Light from above: everything but the bottom edge is white.
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const below = y + 2 < g.height ? g.pixels[(y + 2) * g.width + x] : null;
      if (g.pixels[y * g.width + x] && below) g.pixels[y * g.width + x] = WHITE;
    }
  }
  return g;
}
