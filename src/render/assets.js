// Asset loading (docs/design.md section 7). assets/manifest.json lists every
// asset by name. An asset whose file is missing or fails to load stays
// unloaded, and drawing it calls a placeholder function instead, so the game
// runs with no art files and real art is added by replacing files.
//
// No browser globals are touched at import time, so this runs under Node with
// injected loaders.

import { ANIMATION_FRAME_MS } from '../config.js';

export const MANIFEST_URL = 'assets/manifest.json';

// Checks the manifest shape and returns a list of { name, file, frames }.
// frames > 1 means the file is a horizontal strip of equal-width frames.
export function parseManifest(data) {
  if (!data || typeof data !== 'object' || !data.assets || typeof data.assets !== 'object') {
    throw new Error('Asset manifest needs an "assets" object');
  }
  return Object.entries(data.assets).map(([name, entry]) => {
    if (!entry || typeof entry.file !== 'string' || entry.file === '') {
      throw new Error(`Asset "${name}" needs a "file" string`);
    }
    const frames = entry.frames ?? 1;
    if (!Number.isInteger(frames) || frames < 1) {
      throw new Error(`Asset "${name}" has a bad "frames" value`);
    }
    return { name, file: entry.file, frames };
  });
}

// images: { [name]: { image, frames } } for the assets that loaded.
export function createAssetStore(images = {}) {
  return {
    has: (name) => Boolean(images[name]),
    get: (name) => images[name]?.image ?? null,

    // Draws the asset into the rect (x, y, w, h), or calls placeholder() if
    // it has no image. Animated assets pick their frame from `time` in ms.
    // Returns true if the real image was drawn.
    draw(ctx, name, x, y, w, h, placeholder, { time = 0, alpha = 1 } = {}) {
      const loaded = images[name];
      if (!loaded) {
        placeholder?.();
        return false;
      }
      const { image, frames } = loaded;
      const frameW = image.width / frames;
      const frame = Math.floor(time / ANIMATION_FRAME_MS) % frames;
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.drawImage(image, frame * frameW, 0, frameW, image.height, x, y, w, h);
      ctx.restore();
      return true;
    },
  };
}

// Loads the manifest and every image in it. Never rejects: a missing or bad
// manifest gives an empty store, a missing image leaves that asset unloaded.
//   fetchJson(url) -> Promise of parsed JSON
//   loadImage(url) -> Promise of an image with width and height
export async function loadAssets({
  manifestUrl = MANIFEST_URL,
  fetchJson = fetchJsonFile,
  loadImage = loadImageFile,
  warn = () => {},
} = {}) {
  let entries;
  try {
    entries = parseManifest(await fetchJson(manifestUrl));
  } catch (error) {
    warn(`Asset manifest not loaded, using placeholders: ${error.message}`);
    return createAssetStore();
  }

  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  const images = {};
  await Promise.all(entries.map(async ({ name, file, frames }) => {
    try {
      images[name] = { image: await loadImage(base + file), frames };
    } catch {
      // Missing art: the placeholder is drawn instead.
    }
  }));
  return createAssetStore(images);
}

// Browser defaults.

export async function fetchJsonFile(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

export function loadImageFile(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`${url} not found`));
    image.src = url;
  });
}
