// The textures and sprite sheets of the 3D world: the Farmland v3 pack
// (docs/art-direction-v3.md section 2) and the world character sheets
// (docs/art-direction-hd2d.md section H), their names in
// assets/manifest.json and the placeholder that is generated while a file
// is missing. src/render3d/art.js turns these into canvases.
// Pure: no DOM or Three.js, so it runs under node --test.

import { CLOUD_EAGLE, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT } from '../logic/characters.js';
import { CHARACTER_LOOK } from './character-look.js';
import { CHARACTER_ANIMS } from './character-poses.js';
import { mudTileGrid } from './mud-art.js';
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
  // The owner's pixel portraits in assets/3d/v5/, by character id, shown
  // on the character cards of the character select (src/ui/screens.js).
  avatar: {
    [WIND_RABBIT]: 'avatar-wind-rabbit',
    [EARTH_BEAR]: 'avatar-earth-bear',
    [JADE_SERPENT]: 'avatar-jade-serpent',
  },
  // Cloud Eagle's art slots (docs/design.md section 5.4): its portrait, its
  // HUD picture and its two skill icons. Until the owner sends the files
  // they show the generated placeholder with a warning (ART_SLOTS).
  cloudEagle: {
    avatar: 'cloud-eagle-avatar',
    hud: 'cloud-eagle-hud',
    skyWatchIcon: 'sky-watch-icon',
    cloudIcon: 'cloud-icon',
  },
  // Jade Serpent's HUD portrait and its two skill icons, drawn by the glass
  // HUD (src/ui/hud-view.js) like the Cloud Eagle ones.
  jadeSerpent: {
    hud: 'portrait-jade-serpent',
    hissIcon: 'icon-hiss',
    venomIcon: 'icon-venom',
  },
  // Wind Rabbit's and Earth Bear's HUD portraits and skill icons on the
  // same 64 px grid as the Jade Serpent ones (the 32 px icon-* and
  // portrait-*-v3 files stay for the 2D renderer).
  windRabbit: {
    hud: 'portrait-wind-rabbit-v5',
    windDashIcon: 'icon-wind-dash-v5',
    tornadoZoneIcon: 'icon-tornado-zone-v5',
  },
  earthBear: {
    hud: 'portrait-earth-bear-v5',
    mudTrapIcon: 'icon-mud-trap',
    petrificationIcon: 'icon-petrification',
  },
  // Farmland v3 pack in assets/3d/v3/ (docs/art-direction-v3.md section 2).
  // Tuning data for these names is in assets/v3-meta.json (v3-meta.js).
  v3: {
    board: { field: 'farm-board', low: 'farm-board-low' },
    plant: { X: 'plant-x', O: 'plant-o' },
    rock: 'rock-v3',
    pebble: 'rock-small',
    // The Mud Trap puddle decal; its placeholder is the generated tile of mud-art.js.
    mudPuddle: 'mud-puddle',
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
      // The Tornado cross on the 3 by 3 cells of 32 px: each cross cell shows its own cell of the file.
      zoneCross: 'decal-zone-cross',
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
  'decal-zone-cross': [96, 96, 1],
  'mud-puddle': [32, 32, 1],
  'portrait-wind-rabbit-v3': [32, 32, 1],
  'portrait-earth-bear-v3': [32, 32, 1],
};

// Frame size of the v5 avatars (one 128 by 128 frame) and the colour of
// the block that stands in for each while its file is missing.
export const AVATAR_PX = 128;
const AVATAR_COLORS = {
  [ART.avatar[WIND_RABBIT]]: '#3b8cff',
  [ART.avatar[EARTH_BEAR]]: '#ff4b5c',
  [ART.avatar[JADE_SERPENT]]: '#8fe3a8',
};

// Frame size of each Cloud Eagle slot (one square frame each); its
// placeholder is a block in Cloud Eagle's mark colour.
export const CLOUD_EAGLE_ART_PX = Object.freeze({
  [ART.cloudEagle.avatar]: 512,
  [ART.cloudEagle.hud]: 256,
  [ART.cloudEagle.skyWatchIcon]: 128,
  [ART.cloudEagle.cloudIcon]: 128,
});

// Frame size of each 64 px grid HUD file of Jade Serpent, Wind Rabbit
// and Earth Bear (one square frame each, stored at 2x); its placeholder is
// a block in that character's mark colour.
export const HUD_ART_PX = 128;
const HUD_ART_CHARACTERS = Object.freeze({ jadeSerpent: JADE_SERPENT, windRabbit: WIND_RABBIT, earthBear: EARTH_BEAR });
export const JADE_SERPENT_ART_PX = Object.freeze(Object.fromEntries(artNames(ART.jadeSerpent).map((name) => [name, HUD_ART_PX])));

// Manifest names whose files the owner has not sent yet. The game asks for
// them like any other art; a missing one only warns and draws its
// placeholder. Every slot has its file now.
export const ART_SLOTS = Object.freeze([]);

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
  'decal-zone-cross': '#3b8cff',
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
  [ART.v3.mudPuddle]: pixelArt(() => [mudTileGrid()]),
  ...Object.fromEntries(artNames(ART.avatar).map((name) => [name, {
    width: AVATAR_PX,
    height: AVATAR_PX,
    frames: 1,
    paint: blockSheetPainter({ width: AVATAR_PX, height: AVATAR_PX, frames: 1, colors: [AVATAR_COLORS[name]] }),
  }])),
  ...Object.fromEntries(artNames(ART.cloudEagle).map((name) => {
    const size = CLOUD_EAGLE_ART_PX[name];
    return [name, {
      width: size,
      height: size,
      frames: 1,
      paint: blockSheetPainter({ width: size, height: size, frames: 1, colors: [CHARACTER_LOOK[CLOUD_EAGLE].colour] }),
    }];
  })),
  ...Object.fromEntries(Object.entries(HUD_ART_CHARACTERS).flatMap(([group, id]) => artNames(ART[group]).map((name) => [name, {
    width: HUD_ART_PX,
    height: HUD_ART_PX,
    frames: 1,
    paint: blockSheetPainter({ width: HUD_ART_PX, height: HUD_ART_PX, frames: 1, colors: [CHARACTER_LOOK[id].colour] }),
  }]))),
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
