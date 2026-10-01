// The textures and sprite sheets of the 3D world (docs/art-direction-hd2d.md
// section H): their names in assets/manifest.json and the placeholder that
// is generated while a file is missing. docs/art-spec.md lists the same
// files for the artist. src/render3d/art.js turns these into canvases.
// Pure: no DOM or Three.js, so it runs under node --test.

import { BOARD_TEXTURE_PX, CLOUD_VARIANTS, DECAL_PX } from '../config.js';
import { CHARACTER_ANIMS } from './character-poses.js';
import {
  drawBoardTop, drawDashTarget, drawHover, drawSelectFrame, drawWhirl, drawWinFrame, drawZone,
} from './decal-art.js';
import { bearFrames, cloudGrid, flowerGrid, rabbitFrames, rockGrid, stoneGrid } from './placeholder-art.js';

// Pose names in character sheet order (see CHARACTER_ANIMS).
const POSES = Object.keys(CHARACTER_ANIMS).sort((a, b) => CHARACTER_ANIMS[a].start - CHARACTER_ANIMS[b].start);
const poseNames = (prefix) => Object.fromEntries(POSES.map((pose) => [pose, `${prefix}-${pose}`]));

// Manifest names of everything the 3D world draws from an art file. Each
// character pose is its own sheet; art.js puts them side by side into the
// one sheet the character sprite plays.
export const ART = {
  board: 'board-top',
  piece: { X: 'piece-x', O: 'piece-o', rock: 'piece-rock' },
  character: { X: poseNames('wind-rabbit'), O: poseNames('earth-bear') },
  flower: { pink: 'flower-pink', yellow: 'flower-yellow', white: 'flower-white', blue: 'flower-blue', tuft: 'grass-tuft' },
  cloud: 'cloud', // CLOUD_VARIANTS still frames, one cloud shape each
  decal: {
    hover: 'decal-hover',
    select: 'decal-select',
    win: 'decal-win',
    dashTarget: 'decal-dash-target',
    whirl: 'decal-whirl',
    zone: 'decal-zone',
  },
};

// Every name in a name table like ART (strings in nested objects).
export function artNames(node = ART) {
  return typeof node === 'string' ? [node] : Object.values(node).flatMap((child) => artNames(child));
}

const pixelArt = (frames) => ({ frames });
const painted = (size, paint) => ({ width: size, height: size, frames: 1, paint });

// The generated placeholder of every asset in ART, used while its file is
// missing or does not fit (see artProblem). Either
//   { frames: () => pixel grids }  pixel art (pixel-art.js), one grid per frame
//   { width, height, frames: 1, paint(ctx) }  drawn on a canvas of that size
export const PLACEHOLDERS_3D = {
  [ART.board]: painted(BOARD_TEXTURE_PX, drawBoardTop),
  [ART.piece.X]: pixelArt(() => [stoneGrid('X')]),
  [ART.piece.O]: pixelArt(() => [stoneGrid('O')]),
  [ART.piece.rock]: pixelArt(() => [rockGrid()]),
  ...Object.fromEntries(POSES.flatMap((pose) => [
    [ART.character.X[pose], pixelArt(() => rabbitFrames(pose))],
    [ART.character.O[pose], pixelArt(() => bearFrames(pose))],
  ])),
  ...Object.fromEntries(Object.entries(ART.flower).map(([variant, name]) => [name, pixelArt(() => [flowerGrid(variant)])])),
  [ART.cloud]: pixelArt(() => Array.from({ length: CLOUD_VARIANTS }, (_, i) => cloudGrid(100 + i))),
  [ART.decal.hover]: painted(DECAL_PX, drawHover),
  [ART.decal.select]: painted(DECAL_PX, drawSelectFrame),
  [ART.decal.win]: painted(DECAL_PX, drawWinFrame),
  [ART.decal.dashTarget]: painted(DECAL_PX, drawDashTarget),
  [ART.decal.whirl]: painted(DECAL_PX, drawWhirl),
  [ART.decal.zone]: painted(DECAL_PX, drawZone),
};

// Placeholder for a name that has none: a small pink square.
export const UNKNOWN_PLACEHOLDER = painted(DECAL_PX, (ctx) => {
  ctx.fillStyle = '#2b1d3a';
  ctx.fillRect(0, 0, DECAL_PX, DECAL_PX);
  ctx.fillStyle = '#ff6ad5';
  ctx.fillRect(1, 1, DECAL_PX - 2, DECAL_PX - 2);
});

// { width, height, frames } of the placeholder of `name`: the size of one
// frame and the frame count the 3D code is written for.
const shapes = new Map();
export function placeholderShape(name) {
  if (!shapes.has(name)) {
    const placeholder = PLACEHOLDERS_3D[name] ?? UNKNOWN_PLACEHOLDER;
    if (placeholder.paint) {
      shapes.set(name, { width: placeholder.width, height: placeholder.height, frames: 1 });
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
