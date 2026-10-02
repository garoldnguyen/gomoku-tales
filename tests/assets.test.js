import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANIMATION_FRAME_MS } from '../src/config.js';
import { X, O, ROCK } from '../src/logic/board.js';
import { createInitialState } from '../src/logic/game.js';
import { WIND_DASH, TORNADO_ZONE, TERRAIN_CREATION, STONE_CONVERSION } from '../src/logic/skills.js';
import { createAssetStore, loadAssets, parseManifest, sizeProblem } from '../src/render/assets.js';
import { SPRITES, drawGameScreen, drawMenuScreen, setAssets } from '../src/render/game-renderer.js';

const manifest = JSON.parse(readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'));

function spriteNames(node = SPRITES) {
  return typeof node === 'string' ? [node] : Object.values(node).flatMap(spriteNames);
}

// A 2D context stand-in that records drawImage calls and ignores the rest.
function fakeContext() {
  const images = [];
  const ctx = new Proxy({ globalAlpha: 1, images }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return () => ({ width: 40 });
      if (key === 'drawImage') return (...args) => images.push(args);
      return () => {};
    },
  });
  return ctx;
}

function fakeImage(name, width = 24, height = 24) {
  return { name, width, height };
}

// A manifest entry with the given fields and the size of a 24x24 still.
function entry(fields) {
  return { width: 24, height: 24, frames: 1, frameMs: 0, ...fields };
}

// Loads an image of exactly the size the manifest gives for its file.
const manifestSized = (url) => {
  const found = parseManifest(manifest).find((e) => url === `assets/${e.file}`);
  return fakeImage(url, found.width * found.frames, found.height);
};

// --- Manifest ---

test('the manifest parses and lists every sprite the renderer draws', () => {
  const names = parseManifest(manifest).map((entry) => entry.name);
  for (const name of spriteNames()) assert.ok(names.includes(name), `manifest is missing "${name}"`);
});

test('the manifest names each asset once and gives the tornado several frames', () => {
  const entries = parseManifest(manifest);
  const files = entries.map((e) => e.file);
  assert.equal(new Set(files).size, files.length);
  const tornado = entries.find((e) => e.name === 'tornado');
  assert.ok(tornado.frames > 1);
  assert.equal(tornado.frameMs, ANIMATION_FRAME_MS);
});

test('parseManifest rejects a bad shape', () => {
  assert.throws(() => parseManifest(null));
  assert.throws(() => parseManifest({}));
  assert.throws(() => parseManifest({ assets: { a: {} } }));
  assert.throws(() => parseManifest({ assets: { a: { file: 'a.png' } } }), /width/);
  assert.throws(() => parseManifest({ assets: { a: entry({ file: 'a.png', frames: 0 }) } }), /frames/);
  assert.throws(() => parseManifest({ assets: { a: entry({ file: 'a.png', height: 2.5 }) } }), /height/);
  assert.throws(() => parseManifest({ assets: { a: entry({ file: 'a.png', frameMs: undefined }) } }), /frameMs/);
  assert.throws(() => parseManifest({ assets: { a: entry({ file: 'a.png', frameMs: -1 }) } }), /frameMs/);
  assert.deepEqual(
    parseManifest({ assets: { a: { file: 'a.png', use: '3d', width: 16, height: 8, frames: 3, frameMs: 90 } } }),
    [{ name: 'a', file: 'a.png', use: '3d', width: 16, height: 8, frames: 3, frameMs: 90 }],
  );
});

test('sizeProblem wants exactly the frames of the manifest side by side', () => {
  const sheet = { file: 'spin.png', width: 72, height: 72, frames: 4 };
  assert.equal(sizeProblem(sheet, fakeImage('ok', 288, 72)), null);
  assert.match(sizeProblem(sheet, fakeImage('one frame', 72, 72)), /spin\.png is 72x72, the manifest says 288x72 \(4 frames of 72x72\)/);
  assert.match(sizeProblem({ ...sheet, frames: 1 }, fakeImage('big', 144, 144)), /144x144, the manifest says 72x72$/);
});

// --- Loading ---

test('loadAssets loads the files that exist and leaves missing ones unloaded', async () => {
  const requested = [];
  const store = await loadAssets({
    manifestUrl: 'assets/manifest.json',
    fetchJson: async () => ({ assets: { here: entry({ file: 'here.png' }), gone: entry({ file: 'gone.png' }) } }),
    loadImage: async (url) => {
      requested.push(url);
      if (url.endsWith('gone.png')) throw new Error('404');
      return fakeImage(url);
    },
  });
  assert.deepEqual(requested.sort(), ['assets/gone.png', 'assets/here.png']);
  assert.equal(store.has('here'), true);
  assert.equal(store.get('here').name, 'assets/here.png');
  assert.equal(store.entry('here').width, 24);
  assert.equal(store.has('gone'), false);
  assert.equal(store.get('gone'), null);
  assert.equal(store.entry('gone'), null);
});

test('an image of the wrong size stays unloaded with a warning, so its placeholder is drawn', async () => {
  const warnings = [];
  const store = await loadAssets({
    fetchJson: async () => ({ assets: { spin: entry({ file: 'spin.png', frames: 4, frameMs: 100 }), still: entry({ file: 'still.png' }) } }),
    loadImage: async (url) => fakeImage(url, 24, 24), // right for still.png, one frame short for spin.png
    warn: (message) => warnings.push(message),
  });
  assert.equal(store.has('spin'), false);
  assert.equal(store.has('still'), true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /spin\.png is 24x24, the manifest says 96x24.*placeholder for "spin"/);
});

test('a missing or broken manifest gives an empty store instead of failing', async () => {
  const warnings = [];
  const missing = await loadAssets({
    fetchJson: async () => { throw new Error('HTTP 404'); },
    loadImage: async () => assert.fail('no images without a manifest'),
    warn: (message) => warnings.push(message),
  });
  assert.equal(missing.has('stone-x'), false);
  const broken = await loadAssets({ fetchJson: async () => ({ nope: true }), warn: (message) => warnings.push(message) });
  assert.equal(broken.has('stone-x'), false);
  assert.equal(warnings.length, 2);
});

// --- Drawing ---

test('draw uses the image when loaded and the placeholder when missing', () => {
  const store = createAssetStore({ here: { image: fakeImage('here', 24, 24), frames: 1 } });
  const ctx = fakeContext();
  let placeholders = 0;
  assert.equal(store.draw(ctx, 'here', 10, 20, 24, 24, () => placeholders++), true);
  assert.equal(store.draw(ctx, 'gone', 10, 20, 24, 24, () => placeholders++), false);
  assert.equal(placeholders, 1);
  assert.equal(ctx.images.length, 1);
  assert.deepEqual(ctx.images[0].slice(1), [0, 0, 24, 24, 10, 20, 24, 24]);
});

test('animated assets pick their frame from the time', () => {
  const store = createAssetStore({ spin: { image: fakeImage('spin', 72 * 4, 72), frames: 4, frameMs: ANIMATION_FRAME_MS } });
  const ctx = fakeContext();
  store.draw(ctx, 'spin', 0, 0, 72, 72, null, { time: 0 });
  store.draw(ctx, 'spin', 0, 0, 72, 72, null, { time: ANIMATION_FRAME_MS * 2 + 1 });
  store.draw(ctx, 'spin', 0, 0, 72, 72, null, { time: ANIMATION_FRAME_MS * 5 });
  assert.deepEqual(ctx.images.map((args) => args[1]), [0, 144, 72]);
  assert.ok(ctx.images.every((args) => args[3] === 72));
});

test('still frames (frameMs 0) never animate', () => {
  const store = createAssetStore({ shapes: { image: fakeImage('shapes', 48 * 4, 20), frames: 4, frameMs: 0 } });
  const ctx = fakeContext();
  store.draw(ctx, 'shapes', 0, 0, 48, 20, null, { time: 5000 });
  assert.equal(ctx.images[0][1], 0);
});

// A busy state that shows every kind of sprite.
function busyView() {
  const state = createInitialState();
  state.board[7][7] = X;
  state.board[7][8] = O;
  state.board[3][3] = ROCK;
  state.tornado = { player: X, x: 0, y: 0, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], endsAfterTurn: 1 };
  const panel = (player, name, skills) => ({
    player, name, stone: player, active: player === X, you: player === X,
    skills: skills.map((id) => ({ id, name: id, cooldown: 0, locked: false, usable: true })),
  });
  return {
    state,
    hover: { x: 1, y: 1 },
    panels: [panel(X, 'Wind Rabbit', [WIND_DASH, TORNADO_ZONE]), panel(O, 'Earth Bear', [TERRAIN_CREATION, STONE_CONVERSION])],
    status: 'Your turn',
    time: 0,
  };
}

test('the game screen draws with no art files, using placeholders only', () => {
  setAssets(createAssetStore());
  const ctx = fakeContext();
  drawGameScreen(ctx, busyView());
  drawMenuScreen(ctx);
  assert.equal(ctx.images.length, 0);
});

test('dropped-in art replaces every 2D and HUD placeholder without code changes', async () => {
  const store = await loadAssets({
    fetchJson: async () => manifest,
    loadImage: async (url) => manifestSized(url),
  });
  setAssets(store);
  try {
    const ctx = fakeContext();
    drawGameScreen(ctx, busyView());
    const drawn = new Set(ctx.images.map(([image]) => image.name));
    // v3 files (assets/3d/v3/) belong to the 3D world and the DOM HUD.
    for (const e of parseManifest(manifest).filter((e) => e.use !== '3d' && !e.file.startsWith('3d/v3/'))) {
      assert.ok(drawn.has(`assets/${e.file}`), `${e.name} was not drawn`);
    }
  } finally {
    setAssets(createAssetStore());
  }
});
