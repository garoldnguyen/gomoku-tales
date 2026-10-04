// Design v4 part 1: Nunito is the one font of the DOM text and the canvas
// labels, served from assets/fonts with its licence, with no network request.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { CANVAS_FONT_FAMILY, canvasFont, loadCanvasFont } from '../src/render/canvas-font.js';

const url = (path) => new URL(`../${path}`, import.meta.url);
const read = (path) => readFileSync(url(path), 'utf8');

test('the Nunito variable font and its licence are in assets/fonts', () => {
  assert.ok(existsSync(url('assets/fonts/Nunito-VariableFont_wght.ttf')));
  const licence = read('assets/fonts/Nunito-OFL.txt');
  assert.match(licence, /SIL OPEN FONT LICENSE/i);
  assert.match(licence, /Nunito/);
  const names = readdirSync(url('assets/fonts/'));
  assert.ok(!names.some((name) => name.includes('Zone.Identifier')), 'no Zone.Identifier files');
  assert.ok(!existsSync(url('Nunito')), 'the root Nunito folder is gone');
});

test('hud.css declares Nunito once, weights 200 to 900, swap, from assets/fonts', () => {
  const css = read('src/ui/hud.css');
  const faces = [...css.matchAll(/@font-face \{[^}]*font-family: "Nunito";[^}]*\}/g)].map((m) => m[0]);
  assert.equal(faces.length, 1);
  const [face] = faces;
  assert.match(face, /font-weight: 200 900;/);
  assert.match(face, /font-display: swap;/);
  const src = face.match(/url\("([^"]+)"\)/)[1];
  assert.match(src, /assets\/fonts\/Nunito-VariableFont_wght\.ttf$/);
  assert.ok(!/^https?:|^\/\//.test(src), 'a local file, no network');
  assert.ok(existsSync(new URL(src, url('src/ui/hud.css'))));
  assert.match(read('index.html'), /href="src\/ui\/hud\.css"/, 'the game loads hud.css');
});

test('Nunito is the first font of every DOM font token', () => {
  for (const path of ['src/ui/hud.css', 'src/ui/menu.css']) {
    assert.match(read(path), /--font: "Nunito", /, path);
  }
  assert.match(read('src/ui/screens.css'), /font: 500 [^;]*\/ 1\.35 "Nunito", /);
});

test('no canvas text uses monospace; the canvas font is bold Nunito', () => {
  for (const path of ['src/render/game-renderer.js', 'src/render/effects.js', 'src/render/canvas-font.js', 'src/render3d/world-renderer.js']) {
    assert.doesNotMatch(read(path), /monospace/, path);
  }
  assert.equal(canvasFont(22), 'bold 22px "Nunito", sans-serif');
  assert.match(CANVAS_FONT_FAMILY, /^"Nunito"/);
});

test('loadCanvasFont waits on document.fonts.load and never throws', async () => {
  const asked = [];
  const warnings = [];
  const ok = { load: (font) => { asked.push(font); return Promise.resolve([{}]); } };
  await loadCanvasFont(ok, (m) => warnings.push(m));
  assert.deepEqual(asked, [canvasFont(16)]);
  assert.equal(warnings.length, 0);
  await loadCanvasFont({ load: () => Promise.resolve([]) }, (m) => warnings.push(m));
  await loadCanvasFont({ load: () => Promise.reject(new Error('x')) }, (m) => warnings.push(m));
  assert.equal(warnings.length, 2);
  await loadCanvasFont(undefined); // no Font Loading API (Node)
});
