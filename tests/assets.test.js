import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANIMATION_FRAME_MS } from '../src/config.js';
import { X, O, ROCK } from '../src/logic/board.js';
import { createInitialState } from '../src/logic/game.js';
import { WIND_DASH, TORNADO_ZONE, TERRAIN_CREATION, STONE_CONVERSION } from '../src/logic/skills.js';
import { createAssetStore, loadAssets, parseManifest } from '../src/render/assets.js';
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

// --- Manifest ---

test('the manifest parses and lists every sprite the renderer draws', () => {
  const names = parseManifest(manifest).map((entry) => entry.name);
  for (const name of spriteNames()) assert.ok(names.includes(name), `manifest is missing "${name}"`);
});

test('the manifest names each asset once and gives the tornado several frames', () => {
  const entries = parseManifest(manifest);
  const files = entries.map((entry) => entry.file);
  assert.equal(new Set(files).size, files.length);
  assert.ok(entries.find((entry) => entry.name === 'tornado').frames > 1);
});

test('parseManifest rejects a bad shape', () => {
  assert.throws(() => parseManifest(null));
  assert.throws(() => parseManifest({}));
  assert.throws(() => parseManifest({ assets: { a: {} } }));
  assert.throws(() => parseManifest({ assets: { a: { file: 'a.png', frames: 0 } } }));
  assert.deepEqual(parseManifest({ assets: { a: { file: 'a.png' } } }), [{ name: 'a', file: 'a.png', frames: 1 }]);
});

// --- Loading ---

test('loadAssets loads the files that exist and leaves missing ones unloaded', async () => {
  const requested = [];
  const store = await loadAssets({
    manifestUrl: 'assets/manifest.json',
    fetchJson: async () => ({ assets: { here: { file: 'here.png' }, gone: { file: 'gone.png' } } }),
    loadImage: async (url) => {
      requested.push(url);
      if (url.endsWith('gone.png')) throw new Error('404');
      return fakeImage(url);
    },
  });
  assert.deepEqual(requested.sort(), ['assets/gone.png', 'assets/here.png']);
  assert.equal(store.has('here'), true);
  assert.equal(store.get('here').name, 'assets/here.png');
  assert.equal(store.has('gone'), false);
  assert.equal(store.get('gone'), null);
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
  const store = createAssetStore({ spin: { image: fakeImage('spin', 72 * 4, 72), frames: 4 } });
  const ctx = fakeContext();
  store.draw(ctx, 'spin', 0, 0, 72, 72, null, { time: 0 });
  store.draw(ctx, 'spin', 0, 0, 72, 72, null, { time: ANIMATION_FRAME_MS * 2 + 1 });
  store.draw(ctx, 'spin', 0, 0, 72, 72, null, { time: ANIMATION_FRAME_MS * 5 });
  assert.deepEqual(ctx.images.map((args) => args[1]), [0, 144, 72]);
  assert.ok(ctx.images.every((args) => args[3] === 72));
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

test('dropped-in art replaces every placeholder without code changes', async () => {
  const store = await loadAssets({
    fetchJson: async () => manifest,
    loadImage: async (url) => fakeImage(url, 96, 96),
  });
  setAssets(store);
  try {
    const ctx = fakeContext();
    drawGameScreen(ctx, busyView());
    const drawn = new Set(ctx.images.map(([image]) => image.name));
    for (const entry of parseManifest(manifest)) {
      assert.ok(drawn.has(`assets/${entry.file}`), `${entry.name} was not drawn`);
    }
  } finally {
    setAssets(createAssetStore());
  }
});
