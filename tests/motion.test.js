// The fader of src/ui/motion.js (docs/flow-design.md section 3.11): a node
// that leaves keeps showing with is-leaving for LEAVE_MS, showing it again
// cancels the leave, and reduced motion hides at once. And the CSS: only
// opacity and transforms animate, every animation is off for reduced
// motion, and the leave animations fit in LEAVE_MS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEAVE_MS } from '../src/config.js';
import { createFader } from '../src/ui/motion.js';

function fakeNode() {
  const classes = new Set();
  return { hidden: false, classes, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
}

function setup(reduced = false) {
  const timers = [];
  const pinned = [];
  const fader = createFader({
    reduced: () => reduced,
    setTimer: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1; },
    clearTimer: (id) => { timers[id].live = false; },
    beforeLeave: (node) => pinned.push(node),
    afterLeave: (node) => pinned.splice(pinned.indexOf(node), 1),
  });
  const run = () => { for (const t of timers.splice(0)) if (t.live) t.fn(); };
  return { fader, timers, pinned, run };
}

test('a leaving node shows with is-leaving for LEAVE_MS, then hides and is unpinned', () => {
  const { fader, timers, pinned, run } = setup();
  const node = fakeNode();
  fader.set(node, false);
  assert.equal(node.hidden, false);
  assert.ok(node.classes.has('is-leaving'));
  assert.equal(timers[0].ms, LEAVE_MS);
  assert.deepEqual(pinned, [node]);
  assert.equal(fader.leaving(node), true);
  fader.hide(node); // a second hide waits for the first
  assert.equal(timers.length, 1);
  run();
  assert.equal(node.hidden, true);
  assert.equal(node.classes.has('is-leaving'), false);
  assert.deepEqual(pinned, []);
});

test('showing a leaving node cancels its leave; reduced motion hides at once', () => {
  const { fader, pinned, run } = setup();
  const node = fakeNode();
  fader.hide(node);
  fader.show(node);
  run();
  assert.equal(node.hidden, false, 'the cancelled leave never hides it');
  assert.equal(node.classes.has('is-leaving'), false);
  assert.deepEqual(pinned, []);

  const still = setup(true);
  const other = fakeNode();
  still.fader.hide(other);
  assert.equal(other.hidden, true);
  assert.equal(still.timers.length, 0);
});

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the screen CSS animates only opacity and transforms, stops for reduced motion, and leaves within LEAVE_MS', () => {
  for (const path of ['src/ui/menu.css', 'src/ui/screens.css', 'src/ui/announce.css']) {
    const css = read(path);
    for (const [, body] of css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n\}/g)) {
      for (const [, property] of body.matchAll(/([\w-]+):/g)) {
        assert.ok(['opacity', 'translate', 'scale', 'transform', 'content', 'animation-timing-function'].includes(property), `${path}: ${property} in a keyframe`);
      }
    }
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^@]*animation: none/, `${path}: off for reduced motion`);
  }
  for (const path of ['src/ui/menu.css', 'src/ui/screens.css']) {
    assert.match(read(path), /@media \(prefers-reduced-motion: reduce\)[^@]*animation: none !important/, `${path}: every animation off`);
    for (const [, ms] of read(path).matchAll(/\.is-leaving[^{]*\{[^}]*animation: [\w-]+ (\d+)ms/g)) {
      assert.ok(Number(ms) <= LEAVE_MS, `${path}: a leave of ${ms} ms fits in LEAVE_MS`);
    }
  }
});
