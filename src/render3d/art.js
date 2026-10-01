// Art for the 3D world (docs/art-direction-hd2d.md section H). Every texture
// and sprite sheet is the file listed in assets/manifest.json when it has
// loaded (src/render/assets.js) and fits, or else the generated placeholder
// from art-assets.js, so the world always draws. Sources are canvases or
// images with all frames in one row, and the same object is returned for
// every call, so sprites of one asset share one texture.

import { createAssetStore } from '../render/assets.js';
import { artProblem, PLACEHOLDERS_3D, placeholderShape, UNKNOWN_PLACEHOLDER } from './art-assets.js';
import { sheetCanvas } from './sprites.js';

let store = createAssetStore();
let warn = () => {};
const sources = new Map(); // name -> canvas or image

// Uses the loaded `assets` from now on. Call it before building the world;
// sources handed out before stay as they were.
export function setArtAssets(assets = createAssetStore(), { warn: warnFn = () => {} } = {}) {
  store = assets;
  warn = warnFn;
  sources.clear();
}

// The image of asset `name`, all frames in one row.
export function artSource(name) {
  let source = sources.get(name);
  if (!source) {
    source = loadedArt(name) ?? placeholderCanvas(name);
    sources.set(name, source);
  }
  return source;
}

// Frame `index` of asset `name` on a canvas of its own.
export function artFrame(name, index) {
  const { width, height, frames } = placeholderShape(name);
  const canvas = newCanvas(width, height);
  canvas.getContext('2d').drawImage(artSource(name), (index % frames) * width, 0, width, height, 0, 0, width, height);
  return canvas;
}

// Several assets of the same frame height side by side in one sheet, in
// the order given: the poses of a character.
export function combinedSheet(names) {
  const parts = names.map((name) => ({ source: artSource(name), ...placeholderShape(name) }));
  const canvas = newCanvas(parts.reduce((w, part) => w + part.width * part.frames, 0), parts[0].height);
  const ctx = canvas.getContext('2d');
  let x = 0;
  for (const part of parts) {
    ctx.drawImage(part.source, x, 0);
    x += part.width * part.frames;
  }
  return canvas;
}

function loadedArt(name) {
  const entry = store.entry(name);
  if (!entry) return null;
  const problem = artProblem(name, entry);
  if (problem) {
    warn(`${problem}; using the placeholder`);
    return null;
  }
  return entry.image;
}

function placeholderCanvas(name) {
  const placeholder = PLACEHOLDERS_3D[name] ?? UNKNOWN_PLACEHOLDER;
  if (!placeholder.paint) return sheetCanvas(placeholder.frames());
  const canvas = newCanvas(placeholder.width, placeholder.height);
  placeholder.paint(canvas.getContext('2d'));
  return canvas;
}

function newCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
