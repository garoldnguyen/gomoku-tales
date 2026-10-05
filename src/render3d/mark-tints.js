// The marks of a match in the colours of its characters (character-look.js):
// the plant sheets, the last-move rings, the hover ring and the selection
// decal, tinted with paletteSwap from the art's source colours to the
// colour of the character that plays each side. Built once when a match
// starts (the sides change) and again on a quality change; the renderer
// (world-renderer.js) swaps the new ones in and then disposes the old ones
// with disposeMarkTints. The shape stays with the side: only colours change.

import { O, X } from '../logic/board.js';
import { artSource } from './art.js';
import { ART } from './art-assets.js';
import { HOVER_SOURCE, MARK_SOURCE, SELECT_SOURCES, sideColour, tintPairs, tintPixels } from './character-look.js';
import { pixelTexture, releaseSheetTexture } from './sprites.js';

const LAST_MOVE_ART = { [X]: ART.v3.decal.lastX, [O]: ART.v3.decal.lastO };

// { colour, plant, last, hover, select }, each by player (X and O):
// colour the side's mark colour, plant a tinted copy of the plant sheet (a
// canvas, for createPieceSprite), and last, hover and select textures for
// the decals. A source whose pixels cannot be read stays untinted, with a
// warning.
export function buildMarkTints(sides, warn = () => {}) {
  const tints = { colour: {}, plant: {}, last: {}, hover: {}, select: {} };
  for (const player of [X, O]) {
    const colour = sideColour(sides, player);
    const source = MARK_SOURCE[player];
    const sidePairs = tintPairs(source.main, source.shades, colour);
    tints.colour[player] = colour;
    tints.plant[player] = tintedCanvas(artSource(ART.v3.plant[player]), sidePairs, warn);
    tints.last[player] = markTexture(artSource(LAST_MOVE_ART[player]), sidePairs, warn);
    tints.hover[player] = markTexture(artSource(ART.v3.decal.hover), tintPairs(HOVER_SOURCE, [], colour), warn);
    const selectPairs = SELECT_SOURCES.flatMap((hex) => tintPairs(hex, [], colour));
    tints.select[player] = markTexture(artSource(ART.v3.decal.select), selectPairs, warn);
  }
  return tints;
}

// Frees every GPU texture of `tints` (call it once nothing shows them).
export function disposeMarkTints(tints) {
  for (const player of [X, O]) {
    releaseSheetTexture(tints.plant[player]);
    tints.last[player].dispose();
    tints.hover[player].dispose();
    tints.select[player].dispose();
  }
}

function markTexture(source, pairs, warn) {
  const texture = pixelTexture(tintedCanvas(source, pairs, warn));
  texture.userData.markTint = true;
  return texture;
}

// A canvas copy of `source` with the swaps of `pairs` (tintPixels), marked
// markTint so the sprites built from it know their resources are rebuilt
// with the tint.
function tintedCanvas(source, pairs, warn) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.markTint = true;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0);
  if (pairs.length === 0) return canvas;
  try {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    image.data.set(tintPixels(image.data, pairs));
    ctx.putImageData(image, 0, 0);
  } catch (error) {
    warn(`Mark tint: cannot read the pixels of the mark art, keeping its colours (${error})`);
  }
  return canvas;
}
