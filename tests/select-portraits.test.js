import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { SELECT_PORTRAIT_SCALE } from '../src/config.js';
import { EARTH_BEAR, JADE_SERPENT, WIND_RABBIT } from '../src/logic/characters.js';
import { createSeats } from '../src/logic/seats.js';
import { GUEST, HOST, ROOM_SEATS } from '../src/net/room.js';
import { createAssetStore, loadAssets, parseManifest, USES_3D } from '../src/render/assets.js';
import { ART, artNames, artProblem, AVATAR_PX, PLACEHOLDERS_3D } from '../src/render3d/art-assets.js';
import {
  CHARACTER_LOOKS, PHONE_MAX_WIDTH, characterSelectViewModel, characterStage, portraitScale,
} from '../src/ui/room-screens.js';

const raw = JSON.parse(readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
const byName = Object.fromEntries(parseManifest(raw).map((e) => [e.name, e]));
const KEYS = { [WIND_RABBIT]: 'avatar-wind-rabbit', [EARTH_BEAR]: 'avatar-earth-bear', [JADE_SERPENT]: 'avatar-jade-serpent' };

const selectView = () => characterSelectViewModel({
  seats: createSeats(ROOM_SEATS), labels: { [HOST]: 'A', [GUEST]: 'B' }, editable: [HOST], you: HOST,
});

test('the three portraits are in the manifest: 3D use, 128 by 128, one frame, the file is there', () => {
  assert.equal(AVATAR_PX, 128);
  for (const key of Object.values(KEYS)) {
    const entry = byName[key];
    assert.ok(entry, `"${key}" is missing`);
    assert.deepEqual([entry.use, entry.width, entry.height, entry.frames, entry.frameMs], ['3d', 128, 128, 1, 0]);
    assert.equal(entry.file, `3d/v5/${key}-128.png`);
    assert.ok(existsSync(new URL(`../assets/${entry.file}`, import.meta.url)), `assets/${entry.file} is missing`);
    assert.ok(USES_3D.includes(entry.use), 'the 3D game loads it');
  }
});

test('the 3D loader table names the three portraits, each with a 128 px placeholder', () => {
  assert.deepEqual(ART.avatar, KEYS);
  const names = artNames();
  for (const key of Object.values(KEYS)) {
    assert.ok(names.includes(key), `ART lacks "${key}"`);
    assert.equal(artProblem(key, byName[key]), null);
    assert.ok(PLACEHOLDERS_3D[key]);
  }
});

test('the character data names each portrait once, and the select view model passes it on', () => {
  for (const [id, key] of Object.entries(KEYS)) assert.equal(CHARACTER_LOOKS[id].portrait, key);
  const cards = selectView().characters;
  assert.deepEqual(cards.map((card) => card.portrait), [KEYS[WIND_RABBIT], KEYS[EARTH_BEAR], KEYS[JADE_SERPENT], ART.cloudEagle.avatar]);
  // Screen code never names a portrait key itself.
  const screens = readFileSync(new URL('../src/ui/screens.js', import.meta.url), 'utf8');
  for (const key of Object.values(KEYS)) assert.ok(!screens.includes(key), `screens.js names "${key}"`);
});

test('characterStage: the loaded portrait, else the emblem (no store, missing image, image without src)', () => {
  const [card] = selectView().characters;
  const image = { width: 128, height: 128, src: 'assets/3d/v5/x.png' };
  const store = createAssetStore({ [card.portrait]: { image, ...byName[card.portrait] } });
  assert.deepEqual(characterStage(card, store), { kind: 'portrait', src: image.src });
  assert.deepEqual(characterStage(card, null), { kind: 'emblem', emblem: 'cross' });
  assert.deepEqual(characterStage(card, createAssetStore()), { kind: 'emblem', emblem: 'cross' });
  const noSrc = createAssetStore({ [card.portrait]: { image: { width: 128, height: 128 }, ...byName[card.portrait] } });
  assert.deepEqual(characterStage(card, noSrc), { kind: 'emblem', emblem: 'cross' });
  assert.deepEqual(characterStage({ ...card, portrait: null }, store), { kind: 'emblem', emblem: 'cross' });
});

test('a missing or wrong-size portrait file warns at most, and the card falls back to its emblem', async () => {
  const warnings = [];
  const store = await loadAssets({
    fetchJson: async () => raw,
    loadImage: async (url) => {
      if (url.endsWith(`${KEYS[WIND_RABBIT]}-128.png`)) throw new Error('404');
      if (url.endsWith(`${KEYS[EARTH_BEAR]}-128.png`)) return { width: 64, height: 64, src: url };
      return { width: 128, height: 128, src: url };
    },
    warn: (message) => warnings.push(message),
    uses: USES_3D,
  });
  const stages = selectView().characters.map((card) => characterStage(card, store));
  assert.deepEqual(stages.map((stage) => stage.kind), ['emblem', 'emblem', 'portrait', 'emblem']);
  assert.equal(stages[3].emblem, 'cloud', 'Cloud Eagle shows its emblem until the owner sends the portrait');
  assert.deepEqual(stages.slice(0, 2).map((stage) => stage.emblem), ['cross', 'bloom']);
  assert.ok(warnings.some((message) => message.includes(KEYS[EARTH_BEAR])), 'the wrong size warns');
});

test('portraitScale: whole numbers from 1 up to SELECT_PORTRAIT_SCALE, 2 wherever 256 px fit on one of the four cards, the flow shot shapes included', () => {
  assert.equal(SELECT_PORTRAIT_SCALE, 2);
  for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160], [390, 844], [800, 500], [1080, 1920]]) {
    const scale = portraitScale(w, h);
    assert.ok(Number.isInteger(scale) && scale >= 1 && scale <= SELECT_PORTRAIT_SCALE, `${w}x${h}: ${scale}`);
  }
  assert.equal(portraitScale(2560, 1440), 2);
  assert.equal(portraitScale(3840, 2160), 2);
  // The flow shot shapes: at 1920 by 1080 the portraits show at 256 px;
  // at 1280 by 720 a card of the four is too narrow for 256 px, so 128.
  assert.equal(portraitScale(1280, 720), 1);
  assert.equal(portraitScale(1920, 1080), 2);
  // Too low or too small for 256 px: scale 1, still a whole number.
  assert.equal(portraitScale(1280, 600), 1);
  assert.equal(portraitScale(800, 450), 1);
  assert.equal(portraitScale(PHONE_MAX_WIDTH, 2000), 1);
});
