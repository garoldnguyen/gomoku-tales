// The Fullscreen button (docs/art-direction-v3-1.md section 3.5): the view
// model, the F key, the browser glue with fake documents, and the top bar
// rectangles of hud-layout.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ENTER_LABEL, EXIT_LABEL, FULLSCREEN_KEY,
  fullscreenActive, fullscreenSupported, fullscreenViewModel, isFullscreenKey, toggleFullscreen,
} from '../src/ui/fullscreen.js';
import { COLLAPSE_KEY } from '../src/ui/hud-collapse.js';
import {
  FULLSCREEN_SIZE, QUALITY_HEIGHT, TOOL_GAP, TURN_COMPACT_MIN, hudBoxes, hudLayout, topBarLayout,
} from '../src/ui/hud-layout.js';

// ---------------------------------------------------------------- view model

test('fullscreenViewModel: no Fullscreen API hides the button', () => {
  for (const active of [false, true]) {
    assert.equal(fullscreenViewModel({ supported: false, active }).visible, false);
  }
});

test('fullscreenViewModel: labels and pressed states', () => {
  assert.deepEqual(fullscreenViewModel({ supported: true, active: false }),
    { visible: true, ariaLabel: 'Enter full screen', pressed: false });
  assert.deepEqual(fullscreenViewModel({ supported: true, active: true }),
    { visible: true, ariaLabel: 'Exit full screen', pressed: true });
  assert.equal(ENTER_LABEL, 'Enter full screen');
  assert.equal(EXIT_LABEL, 'Exit full screen');
});

// ---------------------------------------------------------------- key

const key = (k, extra = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, target: null, ...extra });

test('isFullscreenKey: F toggles, F is not the C key', () => {
  assert.equal(FULLSCREEN_KEY, 'f');
  assert.notEqual(FULLSCREEN_KEY, COLLAPSE_KEY);
  assert.equal(isFullscreenKey(key('f')), true);
  assert.equal(isFullscreenKey(key('F')), true, 'caps lock');
  for (const other of ['z', 'q', 'r', 'c', 'Escape', 'F11']) assert.equal(isFullscreenKey(key(other)), false, other);
  assert.equal(isFullscreenKey(null), false);
});

test('isFullscreenKey: ignored with modifiers, in text fields and on repeat', () => {
  for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) assert.equal(isFullscreenKey(key('f', { [mod]: true })), false, mod);
  assert.equal(isFullscreenKey(key('f', { repeat: true })), false);
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(isFullscreenKey(key('f', { target: { tagName } })), false, tagName);
  assert.equal(isFullscreenKey(key('f', { target: { tagName: 'DIV', isContentEditable: true } })), false);
  assert.equal(isFullscreenKey(key('f', { target: { tagName: 'BUTTON' } })), true);
});

// ---------------------------------------------------------------- browser glue

function fakeDocument({ enabled = true, prefixed = false, reject = false, throws = false } = {}) {
  const calls = [];
  const doc = { calls };
  const root = {};
  const enter = function enter() {
    calls.push('enter');
    if (throws) throw new Error('denied');
    if (reject) return Promise.reject(new Error('denied'));
    doc[prefixed ? 'webkitFullscreenElement' : 'fullscreenElement'] = this;
    return Promise.resolve();
  };
  const exit = function exit() {
    calls.push('exit');
    doc[prefixed ? 'webkitFullscreenElement' : 'fullscreenElement'] = null;
    return Promise.resolve();
  };
  if (prefixed) {
    doc.webkitFullscreenEnabled = enabled;
    root.webkitRequestFullscreen = enter;
    doc.webkitExitFullscreen = exit;
  } else {
    doc.fullscreenEnabled = enabled;
    root.requestFullscreen = enter;
    doc.exitFullscreen = exit;
  }
  doc.documentElement = root;
  return doc;
}

test('fullscreen glue: support, toggling and the webkit fallback', () => {
  assert.equal(fullscreenSupported(fakeDocument({ enabled: false })), false, 'iPhone Safari');
  assert.equal(fullscreenSupported({ documentElement: {} }), false);
  assert.equal(fullscreenSupported(undefined), false);
  for (const prefixed of [false, true]) {
    const doc = fakeDocument({ prefixed });
    assert.equal(fullscreenSupported(doc), true);
    assert.equal(fullscreenActive(doc), false);
    toggleFullscreen(doc);
    assert.equal(fullscreenActive(doc), true);
    toggleFullscreen(doc);
    assert.equal(fullscreenActive(doc), false);
    assert.deepEqual(doc.calls, ['enter', 'exit']);
  }
  const off = fakeDocument({ enabled: false });
  toggleFullscreen(off);
  assert.deepEqual(off.calls, [], 'no call without the API');
});

test('fullscreen glue: a refused request is caught and ignored', async () => {
  const rejected = fakeDocument({ reject: true });
  assert.doesNotThrow(() => toggleFullscreen(rejected));
  const thrown = fakeDocument({ throws: true });
  assert.doesNotThrow(() => toggleFullscreen(thrown));
  await new Promise((resolve) => setImmediate(resolve)); // no unhandled rejection
  assert.equal(fullscreenActive(rejected), false);
  assert.equal(fullscreenActive(thrown), false);
});

// ---------------------------------------------------------------- top bar

const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0
  && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0;
const inside = (box, w, h) => box.x >= 0 && box.y >= 0 && box.x + box.w <= w && box.y + box.h <= h;

test('topBarLayout: turn pill, quality switch and Fullscreen button at 1920x1080, 1280x720, 800x600 and 390x844', () => {
  for (const [w, h] of [[1920, 1080], [1280, 720], [800, 600], [390, 844]]) {
    const top = topBarLayout(w, h);
    const boxes = [top.turn, top.quality, top.fullscreen];
    assert.deepEqual(boxes.map((b) => b.name), ['turn', 'quality', 'fullscreen']);
    for (const box of boxes) assert.ok(inside(box, w, h), `${w}x${h} ${box.name} inside`);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i], boxes[j]), `${w}x${h} ${boxes[i].name} and ${boxes[j].name}`);
    }
    assert.equal(top.fullscreen.w, 44);
    assert.equal(top.fullscreen.h, 44);
    assert.equal(FULLSCREEN_SIZE, 44);
    // Next to the quality switch: TOOL_GAP left of it, or under its right end.
    if (top.fullscreenBelow) {
      assert.equal(top.fullscreen.y, top.quality.y + top.quality.h + TOOL_GAP);
      assert.equal(top.fullscreen.x + top.fullscreen.w, top.quality.x + top.quality.w);
    } else {
      assert.equal(top.fullscreen.x + top.fullscreen.w + TOOL_GAP, top.quality.x);
      assert.equal(top.fullscreen.y + top.fullscreen.h / 2, top.quality.y + top.quality.h / 2, 'centred on the switch');
    }
  }
  // Full cards at the large sizes; the narrow phone puts the button under the switch.
  assert.equal(topBarLayout(1920, 1080).fullscreenBelow, false);
  assert.equal(topBarLayout(1920, 1080).fullscreen.y, 28 + (QUALITY_HEIGHT - 44) / 2);
  assert.equal(topBarLayout(800, 600).fullscreenBelow, false, 'beside the rail cards it stays in the row');
  assert.equal(topBarLayout(390, 844).fullscreenBelow, true);
  assert.ok(topBarLayout(390, 844).turn.w >= TURN_COMPACT_MIN);
});

test('topBarLayout: without the Fullscreen API there is no button and the turn pill keeps its old room', () => {
  for (const [w, h] of [[1920, 1080], [1280, 720], [800, 600], [390, 844]]) {
    const top = topBarLayout(w, h, hudLayout(w, h), { fullscreen: false });
    assert.equal(top.fullscreen, null);
    assert.equal(top.fullscreenBelow, false);
    assert.ok(top.turn.w >= topBarLayout(w, h).turn.w, `${w}x${h}`);
    assert.deepEqual(hudBoxes(w, h, { fullscreen: false }).map((b) => b.name).includes('fullscreen'), false);
  }
  // 1000x560: small full cards; the turn pill loses only the button's room.
  assert.equal(topBarLayout(1000, 560, hudLayout(1000, 560), { fullscreen: false }).turn.w - topBarLayout(1000, 560).turn.w,
    2 * (FULLSCREEN_SIZE + TOOL_GAP));
});

test('hudBoxes: the Fullscreen button never overlaps the other HUD boxes and stays inside', () => {
  for (let w = 360; w <= 2560; w += 40) {
    for (let h = 480; h <= 1600; h += 40) {
      const boxes = hudBoxes(w, h);
      const button = boxes.find((b) => b.name === 'fullscreen');
      assert.ok(button, `${w}x${h}`);
      assert.ok(inside(button, w, h), `${w}x${h} inside`);
      for (const other of boxes) {
        if (other !== button) assert.ok(!overlap(button, other), `${w}x${h} fullscreen and ${other.name}`);
      }
    }
  }
});

test('hud.css: the turn pill room and the button size match hud-layout.js', async () => {
  const { readFileSync } = await import('node:fs');
  const { TURN_SIDE_ROOM, TURN_COMPACT_RIGHT, TURN_COMPACT_RIGHT_FS, TURN_COMPACT_RIGHT_LEAVE } = await import('../src/ui/hud-layout.js');
  const css = readFileSync(new URL('../src/ui/hud.css', import.meta.url), 'utf8');
  assert.ok(css.includes(`.hud:not(.is-compact) .turn { max-width: calc(100vw - ${2 * TURN_SIDE_ROOM}px);`));
  assert.ok(css.includes(`.hud.is-compact .topbar { max-width: calc(100% - ${TURN_COMPACT_RIGHT_FS}px); }`));
  assert.ok(css.includes(`.hud.is-compact.no-fullscreen .topbar { max-width: calc(100% - ${TURN_COMPACT_RIGHT_LEAVE}px); }`));
  assert.ok(css.includes(`.hud.is-compact.tools-below .topbar { max-width: calc(100% - ${TURN_COMPACT_RIGHT}px); }`));
  assert.match(css, new RegExp(`\\.hud \\.fullscreen \\{ width: ${FULLSCREEN_SIZE}px; height: ${FULLSCREEN_SIZE}px;`));
  assert.match(css, new RegExp(`\\.hud \\.top-tools \\{[^}]*gap: ${TOOL_GAP}px;`));
});

test('hudBoxes: the Leave match button never overlaps the other HUD boxes and stays inside, with or without the Fullscreen button', () => {
  for (const fullscreen of [true, false]) {
    for (let w = 360; w <= 2560; w += 40) {
      for (let h = 480; h <= 1600; h += 40) {
        for (const collapsed of [{}, { X: true, O: true }]) {
          const boxes = hudBoxes(w, h, { fullscreen, collapsed });
          const button = boxes.find((b) => b.name === 'leave-match');
          assert.ok(button, `${w}x${h}`);
          assert.ok(inside(button, w, h), `${w}x${h} inside`);
          for (const other of boxes) {
            if (other !== button) assert.ok(!overlap(button, other), `${w}x${h} fs ${fullscreen} leave and ${other.name}`);
          }
        }
      }
    }
  }
  assert.equal(hudBoxes(1920, 1080, { leave: false }).some((b) => b.name === 'leave-match'), false, 'none for a spectator');
});
