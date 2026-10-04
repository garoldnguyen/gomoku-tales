// The textures and sprite sheets of the 3D world: the Farmland v3 pack
// (docs/art-direction-v3.md section 2) and the world character sheets
// (docs/art-direction-hd2d.md section H), their names in
// assets/manifest.json and the placeholder that is generated while a file
// is missing. src/render3d/art.js turns these into canvases.
// Pure: no DOM or Three.js, so it runs under node --test.

import { CHARACTER_ANIMS } from './character-poses.js';
import { bearFrames, rabbitFrames } from './placeholder-art.js';
import { blockSheetPainter, farmBoardPainter, ringPainter, stripPainter } from './v3-placeholder-art.js';

// Pose names in character sheet order (see CHARACTER_ANIMS).
const POSES = Object.keys(CHARACTER_ANIMS).sort((a, b) => CHARACTER_ANIMS[a].start - CHARACTER_ANIMS[b].start);
const poseNames = (prefix) => Object.fromEntries(POSES.map((pose) => [pose, `${prefix}-${pose}`]));

// Manifest names of everything the 3D world draws from an art file. Each
// character pose is its own sheet; art.js puts them side by side into the
// one sheet the character sprite plays (shown when SHOW_WORLD_CHARACTERS).
export const ART = {
  character: { X: poseNames('wind-rabbit'), O: poseNames('earth-bear') },
  // Farmland v3 pack in assets/3d/v3/ (docs/art-direction-v3.md section 2).
  // Tuning data for these names is in assets/v3-meta.json (v3-meta.js).
  v3: {
    board: { field: 'farm-board', low: 'farm-board-low' },
    plant: { X: 'plant-x', O: 'plant-o' },
    rock: 'rock-v3',
    pebble: 'rock-small',
    trees: 'trees',
    // The forest behind the far edge (docs/art-direction-v3-1.md section
    // 6.1); its anchors are in assets/forest-meta.json (forest-meta.js).
    forest: {
      pine: 'tree-pine',
      oak: 'tree-oak',
      birch: 'tree-birch',
      poplar: 'tree-poplar',
      wallRound: 'forest-wall-round',
      wallPine: 'forest-wall-pine',
      undergrowth: 'undergrowth',
    },
    bushes: 'bushes',
    hayBale: 'hay-bale',
    grassTufts: 'grass-tufts',
    fencePost: 'fence-post',
    fenceRail: 'fence-rail',
    curb: 'curb-wood',
    path: 'path-tile',
    flower: Object.fromEntries([
      'daisy', 'tulip', 'bluebell', 'poppy', 'sunflower', 'lavender', 'cosmos',
      'forgetmenot', 'marigold', 'hollyhock', 'mushroom', 'dandelion', 'clover',
    ].map((species) => [species, `flower-${species}`])),
    clouds: 'clouds',
    windBits: 'wind-bits',
    decal: {
      hover: 'decal-hover-v3',
      select: 'decal-select-v3',
      lastX: 'decal-last-x',
      lastO: 'decal-last-o',
      win: 'decal-win-v3',
      dashTarget: 'decal-dash-target-v3',
      zone: 'decal-zone-v3',
    },
    portrait: { X: 'portrait-wind-rabbit-v3', O: 'portrait-earth-bear-v3' },
  },
};

// Frame width, height and count of every v3 sheet, as the pack ships them
// (the manifest must agree, see artProblem).
const V3_SHAPES = {
  'farm-board': [480, 480, 1],
  'farm-board-low': [480, 480, 1],
  'plant-x': [36, 40, 5],
  'plant-o': [36, 40, 5],
  'rock-v3': [32, 32, 1],
  'rock-small': [16, 12, 1],
  trees: [34, 48, 3],
  'tree-pine': [32, 64, 3],
  'tree-oak': [56, 58, 2],
  'tree-birch': [30, 58, 2],
  'tree-poplar': [22, 70, 2],
  'forest-wall-round': [192, 56, 1],
  'forest-wall-pine': [192, 64, 1],
  undergrowth: [28, 22, 9],
  bushes: [22, 15, 3],
  'hay-bale': [24, 16, 1],
  'grass-tufts': [12, 9, 3],
  'fence-post': [6, 26, 1],
  'fence-rail': [16, 6, 1],
  'curb-wood': [32, 8, 1],
  'path-tile': [40, 32, 1],
  'flower-daisy': [28, 30, 3],
  'flower-tulip': [28, 32, 3],
  'flower-bluebell': [30, 34, 3],
  'flower-poppy': [28, 28, 3],
  'flower-sunflower': [30, 44, 1],
  'flower-lavender': [23, 38, 2],
  'flower-cosmos': [30, 32, 3],
  'flower-forgetmenot': [27, 16, 2],
  'flower-marigold': [27, 26, 2],
  'flower-hollyhock': [30, 46, 3],
  'flower-mushroom': [24, 20, 3],
  'flower-dandelion': [21, 26, 2],
  'flower-clover': [18, 14, 1],
  clouds: [148, 56, 6],
  'wind-bits': [7, 5, 6],
  'decal-hover-v3': [32, 32, 1],
  'decal-select-v3': [32, 32, 1],
  'decal-last-x': [32, 32, 1],
  'decal-last-o': [32, 32, 1],
  'decal-win-v3': [32, 32, 1],
  'decal-dash-target-v3': [32, 32, 1],
  'decal-zone-v3': [96, 96, 1],
  'portrait-wind-rabbit-v3': [32, 32, 1],
  'portrait-earth-bear-v3': [32, 32, 1],
};

// Placeholder colours of the v3 upright sprites and strips, one per frame
// (cycled). Plants keep the team colours of section 2.
const V3_COLORS = {
  'plant-x': ['#9ccaff', '#8a5a3c', '#6cc04a', '#3b8cff', '#3b8cff'],
  'plant-o': ['#ffa8b4', '#8a5a3c', '#6cc04a', '#ff4b5c', '#ff4b5c'],
  'rock-v3': ['#8c8c96'],
  'rock-small': ['#8c8c96'],
  trees: ['#4fa044', '#2f7a3c', '#6cc04a'],
  'tree-pine': ['#2f6b3c', '#357a42', '#3c8848'],
  'tree-oak': ['#4a9a40', '#3f8a3a'],
  'tree-birch': ['#7cc05a', '#6cb04e'],
  'tree-poplar': ['#3f8f44', '#4a9a48'],
  undergrowth: ['#3f8a3a', '#4a9a40', '#357a42', '#357a42', '#357a42', '#58aa45', '#4a9a40', '#8a5a3c', '#8a5a3c'],
  bushes: ['#4fa044', '#ff8fb8', '#6cc04a'],
  'hay-bale': ['#e8c35a'],
  'grass-tufts': ['#66b94b', '#58aa45', '#4a9a40'],
  'fence-post': ['#8a5a3c'],
  clouds: ['#ffffff', '#f4f8ff'],
  'wind-bits': ['#ffa8d0', '#ffffff', '#ffe14d', '#c8a8ff', '#6cc04a', '#f4ecd8'],
  'portrait-wind-rabbit-v3': ['#3b8cff'],
  'portrait-earth-bear-v3': ['#ff4b5c'],
  flower: ['#ffffff', '#ff8fb8', '#ffe14d'],
};
const V3_STRIPS = {
  'fence-rail': ['#8a5a3c', '#6b4430'],
  'curb-wood': ['#a8703c', '#6b4430'],
  'path-tile': ['#b08a5c', '#8a6a44'],
  'forest-wall-round': ['#357a42', '#2f6b3c'],
  'forest-wall-pine': ['#2f6b3c', '#285c34'],
};
const V3_RINGS = {
  'decal-hover-v3': '#ffe14d',
  'decal-select-v3': '#ffffff',
  'decal-last-x': '#3b8cff',
  'decal-last-o': '#ff4b5c',
  'decal-win-v3': '#ffe14d',
  'decal-dash-target-v3': '#ff4b5c',
  'decal-zone-v3': '#3b8cff',
};

function v3Placeholder(name) {
  const [width, height, frames] = V3_SHAPES[name];
  let paint;
  if (name === ART.v3.board.field || name === ART.v3.board.low) {
    paint = farmBoardPainter({ size: width, cell: 32, plot: 30, low: name === ART.v3.board.low });
  } else if (V3_RINGS[name]) {
    paint = ringPainter({ size: width, color: V3_RINGS[name] });
  } else if (V3_STRIPS[name]) {
    paint = stripPainter({ width, height, color: V3_STRIPS[name][0], band: V3_STRIPS[name][1] });
  } else {
    const colors = V3_COLORS[name] ?? V3_COLORS.flower;
    paint = blockSheetPainter({ width, height, frames, colors, outline: name !== ART.v3.clouds });
  }
  return { width, height, frames, paint };
}

// Every name in a name table like ART (strings in nested objects).
export function artNames(node = ART) {
  return typeof node === 'string' ? [node] : Object.values(node).flatMap((child) => artNames(child));
}

const pixelArt = (frames) => ({ frames });
const painted = (size, paint) => ({ width: size, height: size, frames: 1, paint });

// The generated placeholder of every asset in ART, used while its file is
// missing or does not fit (see artProblem). Either
//   { frames: () => pixel grids }  pixel art (pixel-art.js), one grid per frame
//   { width, height, frames: n, paint(ctx) }  drawn on a canvas of n frames
//                                             of that size side by side
export const PLACEHOLDERS_3D = {
  ...Object.fromEntries(POSES.flatMap((pose) => [
    [ART.character.X[pose], pixelArt(() => rabbitFrames(pose))],
    [ART.character.O[pose], pixelArt(() => bearFrames(pose))],
  ])),
  ...Object.fromEntries(artNames(ART.v3).map((name) => [name, v3Placeholder(name)])),
};

// Placeholder for a name that has none: a small pink square.
const UNKNOWN_PX = 16;
export const UNKNOWN_PLACEHOLDER = painted(UNKNOWN_PX, (ctx) => {
  ctx.fillStyle = '#2b1d3a';
  ctx.fillRect(0, 0, UNKNOWN_PX, UNKNOWN_PX);
  ctx.fillStyle = '#ff6ad5';
  ctx.fillRect(1, 1, UNKNOWN_PX - 2, UNKNOWN_PX - 2);
});

// { width, height, frames } of the placeholder of `name`: the size of one
// frame and the frame count the 3D code is written for.
const shapes = new Map();
export function placeholderShape(name) {
  if (!shapes.has(name)) {
    const placeholder = PLACEHOLDERS_3D[name] ?? UNKNOWN_PLACEHOLDER;
    if (placeholder.paint) {
      shapes.set(name, { width: placeholder.width, height: placeholder.height, frames: placeholder.frames });
    } else {
      const grids = placeholder.frames();
      shapes.set(name, { width: grids[0].width, height: grids[0].height, frames: grids.length });
    }
  }
  return shapes.get(name);
}

// Why the loaded manifest `entry` of `name` cannot stand in for its
// placeholder, or null if it can: the 3D code relies on the frame size and
// frame count of the placeholder (sprite sizes follow the pixel density
// rule, character sheets follow CHARACTER_ANIMS).
export function artProblem(name, entry) {
  const want = placeholderShape(name);
  if (entry.width === want.width && entry.height === want.height && entry.frames === want.frames) return null;
  return `"${name}" must be ${want.frames} frame(s) of ${want.width}x${want.height}, `
    + `the manifest says ${entry.frames} of ${entry.width}x${entry.height}`;
}
