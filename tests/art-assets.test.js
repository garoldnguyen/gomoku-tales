import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  BOARD_TEXTURE_PX, CHARACTER_SPRITE_PX, CLOUD_VARIANTS, DECAL_PX, INTERNAL_HEIGHT, INTERNAL_WIDTH,
  PIECE_SPRITE_PX, PORTRAIT_PX, ROCK_PX, SKILL_ICON_PX, STONE_PX, TORNADO_PX,
} from '../src/config.js';
import { parseManifest } from '../src/render/assets.js';
import { SPRITES } from '../src/render/game-renderer.js';
import { BOARD_FRAME_PX, BOARD_PX, PANEL_H, PANEL_W } from '../src/render/layout.js';
import {
  ART, artNames, artProblem, PLACEHOLDERS_3D, placeholderShape, UNKNOWN_PLACEHOLDER,
} from '../src/render3d/art-assets.js';
import { CHARACTER_ANIMS, CHARACTER_FRAME_COUNT } from '../src/render3d/character-poses.js';

const raw = JSON.parse(readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
const entries = parseManifest(raw);
const byName = Object.fromEntries(entries.map((e) => [e.name, e]));

function spriteNames(node = SPRITES) {
  return typeof node === 'string' ? [node] : Object.values(node).flatMap(spriteNames);
}

// Every .js file under src/, as [path, text].
function sourceFiles(dir = new URL('../src/', import.meta.url)) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const url = new URL(item.name + (item.isDirectory() ? '/' : ''), dir);
    if (item.isDirectory()) return sourceFiles(url);
    return item.name.endsWith('.js') ? [[url.pathname, readFileSync(url, 'utf8')]] : [];
  });
}

// A 2D context stand-in on a canvas of the given size that counts fills.
function fakeContext(width, height) {
  const ctx = { canvas: { width, height }, fills: 0 };
  return new Proxy(ctx, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'fillRect') return () => { target.fills++; };
      return () => {};
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
}

// --- The manifest ---

test('every manifest entry spells out its use, size, frame count and frame time', () => {
  for (const [name, entry] of Object.entries(raw.assets)) {
    for (const key of ['file', 'use', 'width', 'height', 'frames', 'frameMs']) {
      assert.ok(key in entry, `"${name}" has no "${key}"`);
    }
    assert.ok(['2d', 'hud', '3d'].includes(entry.use), `"${name}" has an unknown use "${entry.use}"`);
    assert.ok(entry.file.endsWith('.png'), `"${name}" is not a PNG file`);
    // Animations need a frame time; a still is one frame or still variants.
    if (entry.frameMs > 0) assert.ok(entry.frames > 1, `"${name}" has a frame time but one frame`);
  }
});

test('every asset name used in the code exists in the manifest', () => {
  // The name tables of the 2D renderer and HUD, and of the 3D world.
  for (const name of spriteNames()) assert.ok(byName[name], `the 2D renderer uses "${name}", the manifest lacks it`);
  for (const name of artNames()) assert.ok(byName[name], `the 3D world uses "${name}", the manifest lacks it`);
  for (const name of Object.keys(PLACEHOLDERS_3D)) assert.ok(byName[name], `placeholder "${name}" is not in the manifest`);

  // The tables are the only way names reach the code: no call that looks
  // an asset up has a name written into it, and no file name appears.
  const literalCall = /\b(?:artSource|artFrame|combinedSheet|assets\.(?:get|has|entry)|\.draw\(\s*ctx\s*,)\s*\(?\s*\[?\s*['"`]([^'"`]+)['"`]/g;
  assert.equal([..."artSource('piece-x') assets.draw(ctx, 'rock', 0)".matchAll(literalCall)].length, 2, 'the scan finds literal names');
  for (const [path, text] of sourceFiles()) {
    for (const match of text.matchAll(literalCall)) {
      assert.fail(`${path} looks up "${match[1]}" by a literal name; add it to SPRITES or ART instead`);
    }
    for (const match of text.matchAll(/['"`]([\w./-]+\.png)['"`]/g)) {
      assert.fail(`${path} names the file "${match[1]}"; art files are named only in the manifest`);
    }
  }
});

test('the manifest lists only assets the code uses, each tagged with what draws it', () => {
  const used2d = new Set(spriteNames());
  const used3d = new Set(artNames());
  // The v3 pack (HUD portraits included) is loaded through ART.v3; the v3
  // HUD is a DOM overlay, not the 2D renderer.
  const v3 = new Set(artNames(ART.v3));
  for (const entry of entries) {
    if (entry.use === '3d' || v3.has(entry.name)) assert.ok(used3d.has(entry.name), `"${entry.name}" is not drawn by the 3D world`);
    else assert.ok(used2d.has(entry.name), `"${entry.name}" is not drawn by the 2D renderer or HUD`);
  }
  const hud = [...spriteNames(SPRITES.panel), ...spriteNames(SPRITES.portrait), ...spriteNames(SPRITES.icon)];
  for (const name of hud) assert.equal(byName[name].use, 'hud', `"${name}" is HUD art, drawn by both renderers`);
});

test('2D and HUD art sizes match the sizes they are drawn at', () => {
  const size = (name) => [byName[name].width, byName[name].height];
  assert.deepEqual(size('background'), [INTERNAL_WIDTH, INTERNAL_HEIGHT]);
  assert.deepEqual(size('board'), [BOARD_PX + BOARD_FRAME_PX * 2, BOARD_PX + BOARD_FRAME_PX * 2]);
  for (const name of spriteNames(SPRITES.stone)) assert.deepEqual(size(name), [STONE_PX, STONE_PX]);
  assert.deepEqual(size('rock'), [ROCK_PX, ROCK_PX]);
  assert.deepEqual(size('tornado'), [TORNADO_PX, TORNADO_PX]);
  for (const name of spriteNames(SPRITES.panel)) assert.deepEqual(size(name), [PANEL_W, PANEL_H]);
  for (const name of spriteNames(SPRITES.portrait)) assert.deepEqual(size(name), [PORTRAIT_PX, PORTRAIT_PX]);
  for (const name of spriteNames(SPRITES.icon)) assert.deepEqual(size(name), [SKILL_ICON_PX, SKILL_ICON_PX]);
});

// --- 3D art and its placeholders ---

test('every 3D manifest entry has the frame size and count its placeholder has', () => {
  for (const name of artNames()) assert.equal(artProblem(name, byName[name]), null);
  const size = (name) => [byName[name].width, byName[name].height, byName[name].frames];
  assert.deepEqual(size(ART.board), [BOARD_TEXTURE_PX, BOARD_TEXTURE_PX, 1]);
  for (const name of artNames(ART.piece)) assert.deepEqual(size(name), [PIECE_SPRITE_PX, PIECE_SPRITE_PX, 1]);
  for (const name of artNames(ART.decal)) assert.deepEqual(size(name), [DECAL_PX, DECAL_PX, 1]);
  assert.equal(byName[ART.cloud].frames, CLOUD_VARIANTS);
  assert.equal(byName[ART.cloud].frameMs, 0, 'cloud frames are shapes, not an animation');
});

test('character sheets follow the poses: one file per pose with its frame count and frame time', () => {
  for (const player of ['X', 'O']) {
    const poses = Object.keys(ART.character[player]);
    // Sheet order, as art.js puts the files side by side.
    assert.deepEqual(poses.map((pose) => CHARACTER_ANIMS[pose].start), [...poses.map((pose) => CHARACTER_ANIMS[pose].start)].sort((a, b) => a - b));
    let frames = 0;
    for (const pose of poses) {
      const entry = byName[ART.character[player][pose]];
      assert.equal(entry.width, CHARACTER_SPRITE_PX);
      assert.equal(entry.height, CHARACTER_SPRITE_PX);
      assert.equal(entry.frames, CHARACTER_ANIMS[pose].count, `${entry.name} frames`);
      assert.equal(entry.frameMs, CHARACTER_ANIMS[pose].frameMs, `${entry.name} frame time`);
      assert.equal(CHARACTER_ANIMS[pose].start, frames);
      frames += entry.frames;
    }
    assert.equal(frames, CHARACTER_FRAME_COUNT);
  }
});

test('every missing 3D file falls back to a generated placeholder of the right size', () => {
  for (const name of artNames()) {
    const placeholder = PLACEHOLDERS_3D[name];
    assert.ok(placeholder, `"${name}" has no placeholder`);
    const { width, height, frames } = byName[name];
    if (placeholder.paint) {
      const ctx = fakeContext(width, height);
      placeholder.paint(ctx);
      assert.ok(ctx.fills > 0, `"${name}" placeholder paints nothing`);
    } else {
      const grids = placeholder.frames();
      assert.equal(grids.length, frames, `"${name}" placeholder frames`);
      for (const grid of grids) {
        assert.equal(grid.width, width);
        assert.equal(grid.height, height);
        assert.ok(grid.pixels.some(Boolean), `"${name}" placeholder is empty`);
      }
    }
  }
  assert.deepEqual(placeholderShape('no-such-art'), { width: UNKNOWN_PLACEHOLDER.width, height: UNKNOWN_PLACEHOLDER.height, frames: 1 });
});

test('artProblem refuses loaded art whose frames do not fit the 3D code', () => {
  const idle = byName[ART.character.X.idle];
  assert.equal(artProblem(idle.name, idle), null);
  assert.match(artProblem(idle.name, { ...idle, frames: 3 }), /must be 4 frame\(s\) of 96x96, the manifest says 3 of 96x96/);
  assert.match(artProblem(ART.piece.X, { ...byName[ART.piece.X], width: 64, height: 64 }), /32x32.*64x64/);
});
