// Asset loading (docs/design.md section 7 and docs/art-direction-hd2d.md
// section H). assets/manifest.json lists every texture and sprite sheet by
// name with its pixel size and frame data; docs/art-spec.md lists the same
// files for the artist. An asset whose file is missing, fails to load or
// does not have the size the manifest gives stays unloaded, and the game
// draws a generated placeholder instead, so it runs with no art files and
// real art is added by replacing files.
//
// No browser globals are touched at import time, so this runs under Node with
// injected loaders.

export const MANIFEST_URL = 'assets/manifest.json';

// Checks the manifest shape and returns a list of
//   { name, file, use, width, height, frames, frameMs }
// width and height are the size of one frame in pixels. frames > 1 means
// the file is a sprite sheet with all frames in one row, so the whole file
// is width * frames by height. frameMs is the time per frame of an
// animation; 0 means the frames are still (variants, not an animation).
// use says what draws it: '2d' (the 2D renderer, its canvas panels and
// portraits included), 'hud' (the skill icons and v3 portraits of either
// renderer's HUD) or '3d' (the 3D world).
export function parseManifest(data) {
  if (!data || typeof data !== 'object' || !data.assets || typeof data.assets !== 'object') {
    throw new Error('Asset manifest needs an "assets" object');
  }
  return Object.entries(data.assets).map(([name, entry]) => {
    if (!entry || typeof entry.file !== 'string' || entry.file === '') {
      throw new Error(`Asset "${name}" needs a "file" string`);
    }
    for (const key of ['width', 'height', 'frames']) {
      if (!Number.isInteger(entry[key]) || entry[key] < 1) {
        throw new Error(`Asset "${name}" needs a whole "${key}" of 1 or more`);
      }
    }
    if (typeof entry.frameMs !== 'number' || !(entry.frameMs >= 0)) {
      throw new Error(`Asset "${name}" needs a "frameMs" of 0 or more`);
    }
    const { file, width, height, frames, frameMs, use = '' } = entry;
    return { name, file, use, width, height, frames, frameMs };
  });
}

// Why `image` cannot be used for manifest `entry`, or null if it fits: the
// file must be exactly `frames` frames of width x height side by side.
export function sizeProblem(entry, image) {
  const width = entry.width * entry.frames;
  if (image.width === width && image.height === entry.height) return null;
  const frames = entry.frames > 1 ? ` (${entry.frames} frames of ${entry.width}x${entry.height})` : '';
  return `${entry.file} is ${image.width}x${image.height}, the manifest says ${width}x${entry.height}${frames}`;
}

// images: { [name]: { image, ...manifest entry } } for the assets that loaded.
export function createAssetStore(images = {}) {
  return {
    has: (name) => Boolean(images[name]),
    get: (name) => images[name]?.image ?? null,
    // The manifest entry of a loaded asset, or null.
    entry: (name) => images[name] ?? null,

    // Draws the asset into the rect (x, y, w, h), or calls placeholder() if
    // it has no image. Animated assets pick their frame from `time` in ms.
    // Returns true if the real image was drawn.
    draw(ctx, name, x, y, w, h, placeholder, { time = 0, alpha = 1 } = {}) {
      const loaded = images[name];
      if (!loaded) {
        placeholder?.();
        return false;
      }
      const { image, frames = 1, frameMs = 0 } = loaded;
      const frameW = image.width / frames;
      const frame = frames > 1 && frameMs > 0 ? Math.floor(Math.max(0, time) / frameMs) % frames : 0;
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.drawImage(image, frame * frameW, 0, frameW, image.height, x, y, w, h);
      ctx.restore();
      return true;
    },
  };
}

// The uses the 3D game draws (see parseManifest). It never requests the 2D
// renderer's art, so the 2D files that are still placeholders do not show
// up as failed requests in the console.
export const USES_3D = Object.freeze(['3d', 'hud']);

// Loads the manifest and every image in it, or with `uses` only the images
// of those uses. Never rejects: a missing or bad manifest gives an empty
// store, a missing image leaves that asset unloaded, and an image of the
// wrong size is left unloaded with a warning.
//   fetchJson(url) -> Promise of parsed JSON
//   loadImage(url) -> Promise of an image with width and height
export async function loadAssets({
  manifestUrl = MANIFEST_URL,
  fetchJson = fetchJsonFile,
  loadImage = loadImageFile,
  warn = () => {},
  uses = null,
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
  const wanted = uses ? entries.filter((entry) => uses.includes(entry.use)) : entries;
  await Promise.all(wanted.map(async (entry) => {
    let image;
    try {
      image = await loadImage(base + entry.file);
    } catch {
      return; // Missing art: the placeholder is drawn instead.
    }
    const problem = sizeProblem(entry, image);
    if (problem) {
      warn(`${problem}; using the placeholder for "${entry.name}"`);
      return;
    }
    images[entry.name] = { image, ...entry };
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
