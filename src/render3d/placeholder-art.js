// Placeholder pixel art for the HD-2D world, generated at runtime so no image
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

// The look of every frame of a character sheet, pose by pose, in the order
// of CHARACTER_ANIMS (src/render3d/character-poses.js):
//   b      whole pixels the body sinks (the feet stay put)
//   lift   whole pixels the whole character jumps
//   paws   'side', 'mid' (gathering power), 'up' (raised) or 'down'
//   eyes   'open', 'happy' (^ ^) or 'sad' (closed, worried brows)
//   mouth  'small', 'smile' or 'frown'
//   sad    drooping ears or a wilting head sprout
//   tear   a tear under one eye
//   magic  0, 1 or 2: how many sparkles of the character's magic
//   stars  golden celebration stars
const POSES = {
  idle: IDLE_BOB.map((b) => ({ b })),
  cast: [
    { b: 2, paws: 'mid' },
    { paws: 'up', magic: 1 },
    { paws: 'up', magic: 2, mouth: 'smile' },
    { paws: 'up', magic: 2, mouth: 'smile' },
  ],
  win: [
    { paws: 'up', eyes: 'happy', mouth: 'smile' },
    { lift: 6, paws: 'up', eyes: 'happy', mouth: 'smile', stars: true },
  ],
  lose: [
    { b: 3, paws: 'down', eyes: 'sad', mouth: 'frown', sad: true },
    { b: 4, paws: 'down', eyes: 'sad', mouth: 'frown', sad: true, tear: true },
  ],
};

// Pose names in sheet order.
export const CHARACTER_POSES = Object.keys(POSES);

const TEAR = '#7fc8ff';
const STAR = '#ffe14d';

// Frames of one pose (see POSES), or every frame of every pose in sheet
// order for pose 'all'.
function poseFrames(draw, pose) {
  if (pose === 'all') return CHARACTER_POSES.flatMap((name) => poseFrames(draw, name));
  const base = { b: 0, lift: 0, paws: 'side', eyes: 'open', mouth: 'small', magic: 0 };
  return POSES[pose].map((look, frame) => draw({ ...base, ...look }, frame));
}

// A small four-pointed sparkle centred on (x, y).
function sparkle(g, x, y, arm, color) {
  line(g, x - arm, y, x + arm, y, color);
  line(g, x, y - arm, x, y + arm, color);
  setPixel(g, x, y, WHITE);
}

// A thick limb: discs stamped along the line from (x0, y0) to (x1, y1).
function limb(g, x0, y0, x1, y1, r, color) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillEllipse(g, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), r, r, color);
  }
}

// ^ ^ eyes ('happy') or closed eyes with worried brows ('sad') around eye
// pixel (x, y). `inner` is the x of the nose, where a worried brow is higher.
function closedEye(g, x, y, eyes, inner) {
  if (eyes === 'happy') {
    line(g, x - 2, y + 2, x, y - 1, OUTLINE);
    line(g, x, y - 1, x + 2, y + 2, OUTLINE);
    return;
  }
  line(g, x - 2, y + 1, x + 2, y + 1, OUTLINE);
  const rise = inner > x ? 1 : -1;
  line(g, x - 2, y - 3 + rise, x + 2, y - 3 - rise, OUTLINE);
}

// Mouth centred between pixels 47 and 48 at row `y`.
function drawMouth(g, mouth, y, ink, inside) {
  if (mouth === 'smile') {
    fillRect(g, 45, y, 6, 1, ink);
    fillRect(g, 46, y + 1, 4, 1, ink);
    fillRect(g, 47, y + 1, 2, 1, inside);
  } else if (mouth === 'frown') {
    setPixel(g, 45, y + 1, ink);
    fillRect(g, 46, y, 4, 1, ink);
    setPixel(g, 50, y + 1, ink);
  } else {
    setPixel(g, 46, y, ink);
    setPixel(g, 49, y, ink);
    fillRect(g, 47, y + 1, 2, 1, ink);
  }
}

// Wind Rabbit: a white rabbit with a blue scarf that flutters in the wind.
// `pose` is 'idle' (the default), 'cast', 'win', 'lose' or 'all'.
export function rabbitFrames(pose = 'idle') {
  return poseFrames(drawRabbit, pose);
}

function drawRabbit(look, frame) {
  const g = createGrid(CHARACTER_SPRITE_PX, CHARACTER_SPRITE_PX);
  const { lift } = look;
  const y = (v) => v + look.b - lift;
  const shade = '#e2dbeb';
  const pink = '#ffb3c7';
  const scarf = '#3f7fd8';
  const scarfDark = '#2a5cae';
  const scarfLight = '#86b8f2';
  const wind = '#9fdcff';

  fillEllipse(g, 40, 91 - lift, 6, 3.5, WHITE);
  fillEllipse(g, 56, 91 - lift, 6, 3.5, WHITE);

  fillEllipse(g, 48, y(76), 14, 13, shade);
  shadeEllipse(g, 46, y(74), 12, 11, WHITE);
  if (look.paws === 'side') {
    fillEllipse(g, 35, y(75), 4, 6, shade);
    fillEllipse(g, 61, y(75), 4, 6, shade);
  } else if (look.paws === 'down') {
    fillEllipse(g, 37, y(82), 4, 5, shade);
    fillEllipse(g, 59, y(82), 4, 5, shade);
  }

  if (look.sad) {
    // Floppy ears hanging down beside the head.
    fillEllipse(g, 30, y(44), 10, 4, WHITE);
    fillEllipse(g, 66, y(44), 10, 4, WHITE);
    fillEllipse(g, 29, y(44), 6, 1.5, pink);
    fillEllipse(g, 67, y(44), 6, 1.5, pink);
  } else {
    fillEllipse(g, 41, y(26), 4.5, 13, WHITE);
    fillEllipse(g, 55, y(26), 4.5, 13, WHITE);
    fillEllipse(g, 41, y(27), 2, 9, pink);
    fillEllipse(g, 55, y(27), 2, 9, pink);
  }

  fillEllipse(g, 48, y(50), 16, 13, shade);
  shadeEllipse(g, 46, y(48), 15, 12, WHITE);
  if (look.eyes === 'open') {
    fillRect(g, 40, y(47), 3, 4, OUTLINE);
    fillRect(g, 53, y(47), 3, 4, OUTLINE);
    setPixel(g, 40, y(47), WHITE);
    setPixel(g, 53, y(47), WHITE);
  } else {
    closedEye(g, 41, y(48), look.eyes, 48);
    closedEye(g, 54, y(48), look.eyes, 48);
  }
  if (look.tear) fillRect(g, 40, y(51), 1, 3, TEAR);
  fillRect(g, 36, y(53), 3, 2, pink);
  fillRect(g, 57, y(53), 3, 2, pink);
  fillRect(g, 47, y(53), 2, 2, pink);
  drawMouth(g, look.mouth, y(56), OUTLINE, pink);

  fillEllipse(g, 48, y(63), 15, 2.5, scarf);
  shadeEllipse(g, 48, y(65), 15, 1, scarfDark);
  line(g, 38, y(61), 56, y(61), scarfLight);
  // The scarf's loose end trails to the right and flutters.
  const flutter = IDLE_BOB[(frame + 1) % IDLE_BOB.length];
  fillRect(g, 58, y(65), 5, 6, scarf);
  fillRect(g, 60 + flutter, y(71), 5, 5, scarf);
  fillRect(g, 60 + flutter, y(75), 5, 1, scarfDark);
  setPixel(g, 61 + flutter, y(76), scarfDark);
  setPixel(g, 63 + flutter, y(76), scarfDark);

  // Paws in front of the body and the scarf.
  if (look.paws === 'mid') {
    fillEllipse(g, 40, y(68), 4, 4, shade);
    fillEllipse(g, 56, y(68), 4, 4, shade);
  } else if (look.paws === 'up') {
    limb(g, 37, y(70), 27, y(45), 3, shade);
    limb(g, 59, y(70), 69, y(45), 3, shade);
    fillEllipse(g, 27, y(42), 4, 4, WHITE);
    fillEllipse(g, 69, y(42), 4, 4, WHITE);
  }
  // Wind magic: pale blue sparkles around the raised paws.
  if (look.magic >= 1) {
    sparkle(g, 21, y(34), 3, wind);
    sparkle(g, 75, y(34), 3, wind);
  }
  if (look.magic >= 2) {
    sparkle(g, 16, y(50), 2, '#c8ecff');
    sparkle(g, 80, y(50), 2, '#c8ecff');
    sparkle(g, 48, y(8), 4, wind);
  }
  if (look.stars) {
    sparkle(g, 18, 30, 3, STAR);
    sparkle(g, 78, 24, 3, STAR);
  }

  outline(g, OUTLINE);
  return g;
}

// Earth Bear: a sturdy brown bear with a little sprout on its head.
// `pose` is 'idle' (the default), 'cast', 'win', 'lose' or 'all'.
export function bearFrames(pose = 'idle') {
  return poseFrames(drawBear, pose);
}

function drawBear(look) {
  const g = createGrid(CHARACTER_SPRITE_PX, CHARACTER_SPRITE_PX);
  const { lift } = look;
  const y = (v) => v + look.b - lift;
  const brown = '#9b6235';
  const brownDark = '#764622';
  const brownLight = '#b97a45';
  const muzzle = '#ecc596';
  const nose = '#2b1a14';
  const earInner = '#d9966a';
  const blush = '#e88a7a';
  const leaf = look.sad ? '#a8b84a' : '#6cc04a';
  const stem = look.sad ? '#7f8f3a' : '#3f8f3a';

  fillEllipse(g, 37, 91 - lift, 8, 3.5, brownDark);
  fillEllipse(g, 59, 91 - lift, 8, 3.5, brownDark);

  fillEllipse(g, 48, y(74), 20, 16, brownDark);
  shadeEllipse(g, 46, y(72), 18, 14, brown);
  fillEllipse(g, 48, y(78), 11, 9, muzzle);
  if (look.paws === 'side' || look.paws === 'down') {
    const ay = look.paws === 'side' ? 73 : 80;
    fillEllipse(g, 28, y(ay), 6, 8, brownDark);
    fillEllipse(g, 68, y(ay), 6, 8, brownDark);
    shadeEllipse(g, 28, y(ay - 2), 4, 6, brown);
    shadeEllipse(g, 68, y(ay - 2), 4, 6, brown);
  }

  fillEllipse(g, 33, y(33), 7, 7, brownDark);
  fillEllipse(g, 63, y(33), 7, 7, brownDark);
  fillEllipse(g, 33, y(34), 3.5, 3.5, earInner);
  fillEllipse(g, 63, y(34), 3.5, 3.5, earInner);

  fillEllipse(g, 48, y(47), 19, 15, brownDark);
  shadeEllipse(g, 46, y(45), 17, 13, brown);
  shadeEllipse(g, 41, y(39), 6, 2.5, brownLight);
  fillEllipse(g, 48, y(53), 8, 5.5, muzzle);
  fillRect(g, 45, y(49), 6, 3, nose);
  fillRect(g, 46, y(52), 4, 1, nose);
  drawMouth(g, look.mouth, y(55), nose, blush);
  if (look.eyes === 'open') {
    fillRect(g, 38, y(42), 3, 4, nose);
    fillRect(g, 55, y(42), 3, 4, nose);
    setPixel(g, 38, y(42), WHITE);
    setPixel(g, 55, y(42), WHITE);
  } else {
    closedEye(g, 39, y(43), look.eyes, 48);
    closedEye(g, 56, y(43), look.eyes, 48);
  }
  if (look.tear) fillRect(g, 38, y(47), 1, 3, TEAR);
  fillRect(g, 33, y(50), 3, 2, blush);
  fillRect(g, 60, y(50), 3, 2, blush);

  // The head sprout stands up, or wilts when the bear loses.
  if (look.sad) {
    line(g, 48, y(29), 48, y(32), stem);
    line(g, 48, y(29), 51, y(28), stem);
    fillEllipse(g, 52, y(30), 1.5, 2.5, leaf);
    fillEllipse(g, 45, y(31), 1.5, 2, leaf);
  } else {
    line(g, 48, y(28), 48, y(32), stem);
    fillEllipse(g, 45, y(28), 2.5, 1.5, leaf);
    fillEllipse(g, 51, y(27), 2.5, 1.5, leaf);
  }

  // Paws in front of the body and the head.
  if (look.paws === 'mid') {
    fillEllipse(g, 37, y(66), 5, 5, brownDark);
    fillEllipse(g, 59, y(66), 5, 5, brownDark);
    shadeEllipse(g, 37, y(65), 3, 3, brown);
    shadeEllipse(g, 59, y(65), 3, 3, brown);
  } else if (look.paws === 'up') {
    limb(g, 32, y(68), 22, y(40), 4.5, brownDark);
    limb(g, 64, y(68), 74, y(40), 4.5, brownDark);
    fillEllipse(g, 22, y(38), 5, 5, brownDark);
    fillEllipse(g, 74, y(38), 5, 5, brownDark);
    fillEllipse(g, 22, y(38), 2.5, 2.5, muzzle);
    fillEllipse(g, 74, y(38), 2.5, 2.5, muzzle);
  }
  // Earth magic: golden sparkles and floating pebbles.
  if (look.magic >= 1) {
    sparkle(g, 14, y(28), 3, '#ffd166');
    sparkle(g, 82, y(28), 3, '#ffd166');
  }
  if (look.magic >= 2) {
    fillEllipse(g, 12, y(44), 2, 1.5, '#b08a5a');
    fillEllipse(g, 84, y(44), 2, 1.5, '#b08a5a');
    sparkle(g, 48, y(14), 4, '#9be06a');
  }
  if (look.stars) {
    sparkle(g, 12, 22, 3, STAR);
    sparkle(g, 84, 18, 3, STAR);
  }

  outline(g, OUTLINE);
  return g;
}

// Pieces stand in a little seed pot of their player's colour (blue for X,
// red for O), so the two read apart by colour as well as by shape.
const PIECE_POT = [
  '..........kkkkkkkkkkkk..........',
  '.......kkkbbbbbbbbbbbbkkk.......',
  '.....kkbbbhhhhbbbbbbbbbbbkk.....',
  '....kbbbhhhbbbbbbbbbbbbbbbbk....',
  '....kbbbbbbbbbbbbbbbbbbbbbbk....',
  '.....kkbbbbbbbbbbbbbbbbbbkk.....',
  '.......kkkbbbbbbbbbbbbkkk.......',
  '..........kkkkkkkkkkkk..........',
];

const POT_COLORS = {
  X: { k: '#2f63b0', b: '#4a8fe0', h: '#9ccaff' },
  O: { k: '#a8304a', b: '#e85a6e', h: '#ffa8b4' },
};

// X: a sprout with two round leaves.
const SPROUT = [
  '.....llll..............llll.....',
  '...llggggll..........llggggll...',
  '..lgggggggggl......lgggggggggl..',
  '..gggggggggggl....lggggggggggg..',
  '..dggggggggggglsslgggggggggggd..',
  '...dggggggggggdssdggggggggggd...',
  '....dddggggdddssssdddggggddd....',
  '.......dddd....ss....dddd.......',
  '...............ss...............',
  '...............ss...............',
  '...............ss...............',
  '...............ss...............',
  '...............ss...............',
  '...............ss...............',
];

// O: a closed flower bud on a leafy stem.
const BUD = [
  '...............pp...............',
  '..............pphp..............',
  '.............pphhpp.............',
  '............pphhpppp............',
  '...........pphhppppvp...........',
  '...........phhpppppvp...........',
  '...........phppppppvp...........',
  '...........pppppppvvp...........',
  '............vpppvvvv............',
  '...........ggvvvvvvgg...........',
  '...........gdggggggdg...........',
  '.............dggggd.............',
  '...............ss...............',
  '......lll......ss......lll......',
  '.....lgggg.....ss.....ggggl.....',
  '.....dggggg....ss....gggggd.....',
  '......ddgggg...ss...ggggdd......',
  '........dddgg..ss..ggddd........',
  '...........ddd.ss.ddd...........',
  '...............ss...............',
  '...............ss...............',
];

const PLANT_COLORS = {
  l: '#a8e070', g: '#6cc04a', d: '#3f8f3a', s: '#3f8f3a',
  p: '#ff8fb0', h: '#ffd0dc', v: '#d64a72',
};

// The pot sits on the bottom of the frame with one row left for the
// outline; the plant's stem goes STEM_DEPTH pixels into the pot.
const POT_TOP = PIECE_SPRITE_PX - 1 - PIECE_POT.length;
const STEM_DEPTH = 2;

// Board piece for player 'X' (a sprout) or 'O' (a flower bud), drawn from
// the pixel arrays above.
export function stoneGrid(player) {
  const g = createGrid(PIECE_SPRITE_PX, PIECE_SPRITE_PX);
  const plant = player === 'X' ? SPROUT : BUD;
  blit(g, gridFromRows(plant, PLANT_COLORS), 0, POT_TOP + STEM_DEPTH - plant.length);
  blit(g, gridFromRows(PIECE_POT, POT_COLORS[player] ?? POT_COLORS.X), 0, POT_TOP);
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
