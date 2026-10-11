// Battery and heat (docs/performance.md): a still scene is not drawn 60 or 120
// times a second, a phone draws less often and at a lower pixel ratio, and the
// slow-frame watch of the quality levels does not mistake the pace for load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import {
  FRAME_ACTIVE_FPS, FRAME_ACTIVE_MS, FRAME_FROSTED_FPS, FRAME_IDLE_FPS, FRAME_SLEEP_EARLY_MS, FRAME_SLEEP_MIN_MS, FRAME_SLOW_FACTOR, FRAME_TOLERANCE_MS,
  QUALITY_STEP_DOWN_MS, QUALITY_STALL_MS, TARGET_FRAME_MS,
} from '../src/config.js';
import { createInitialState } from '../src/logic/game.js';
import { createFrameGovernor, isCoarsePointer, stateSignature } from '../src/render3d/frame-governor.js';
import { QUALITY_LEVELS, QUALITY_ORDER, createSlowFrameWatch } from '../src/render3d/quality.js';
import { windowView } from '../src/render3d/view-size.js';
import { fakeCanvas, fakeRenderer, installFakeDocument } from './fake-browser.js';

// The world imports 'three' by its import-map name: the same hook as the other world tests.
register(`data:text/javascript,${encodeURIComponent(`
const root = ${JSON.stringify(new URL('../', import.meta.url).href)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: root + 'vendor/three/build/three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: root + 'vendor/three/examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`)}`);

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

// Ticks of a screen of `hz` Hz from `from` to `to` ms; counts the ones that run.
function runs(governor, hz, from, to, poke = null) {
  const step = 1000 / hz;
  let count = 0;
  for (let t = from; t < to; t += step) {
    if (poke && poke(t)) governor.poke(t);
    if (governor.shouldRun(t)) count++;
  }
  return count;
}

const touch = () => createFrameGovernor({ activeFps: FRAME_ACTIVE_FPS.touch, idleFps: FRAME_IDLE_FPS.touch, holdMs: FRAME_ACTIVE_MS, toleranceMs: FRAME_TOLERANCE_MS });
const desktop = () => createFrameGovernor({ activeFps: FRAME_ACTIVE_FPS.desktop, idleFps: FRAME_IDLE_FPS.desktop, holdMs: FRAME_ACTIVE_MS, toleranceMs: FRAME_TOLERANCE_MS });

test('the rates are in config and a phone draws less than a computer', () => {
  assert.ok(FRAME_ACTIVE_FPS.touch < FRAME_ACTIVE_FPS.desktop);
  assert.ok(FRAME_IDLE_FPS.touch < FRAME_IDLE_FPS.desktop);
  assert.ok(FRAME_FROSTED_FPS < FRAME_IDLE_FPS.touch, 'the scene behind a blurred menu is drawn the least');
  for (const fps of [...Object.values(FRAME_ACTIVE_FPS), ...Object.values(FRAME_IDLE_FPS)]) assert.ok(fps < 100);
  assert.ok(FRAME_IDLE_FPS.touch >= 4, 'an idle page is still alive (a pulse, a late event)');
});

test('active: a touch device draws 30 of 60, 90, 120 and 144 ticks a second, a computer 60', () => {
  for (const hz of [60, 90, 120, 144]) {
    const phone = touch();
    phone.poke(0);
    const drawn = runs(phone, hz, 0, 1000, (t) => t < 3000); // always something going on
    assert.ok(drawn >= 28 && drawn <= 31, `${hz} Hz: ${drawn} frames on a phone`);
    const pc = desktop();
    pc.poke(0);
    const drawnPc = runs(pc, hz, 0, 1000, (t) => t < 3000);
    assert.ok(drawnPc >= 58 && drawnPc <= 61, `${hz} Hz: ${drawnPc} frames on a computer`);
  }
});

test('idle: nothing for FRAME_ACTIVE_MS and the page slows to the idle rate, a poke wakes it at once', () => {
  const phone = touch();
  phone.poke(0);
  assert.equal(phone.shouldRun(10), true);
  assert.equal(phone.idle, false);
  // Quiet for 6 seconds on a 60 Hz screen: after the active window, about FRAME_IDLE_FPS a second.
  runs(phone, 60, 20, FRAME_ACTIVE_MS + 100);
  const idleFrames = runs(phone, 60, FRAME_ACTIVE_MS + 100, FRAME_ACTIVE_MS + 2100);
  assert.ok(Math.abs(idleFrames - 2 * FRAME_IDLE_FPS.touch) <= 3, `${idleFrames} frames in 2 s`);
  assert.equal(phone.idle, true);
  assert.ok(Math.abs(phone.intervalMs - 1000 / FRAME_IDLE_FPS.touch) < 1e-9);
  // A touch: the very next tick draws and the pace is the active one again.
  const now = FRAME_ACTIVE_MS + 2200;
  phone.poke(now);
  assert.equal(phone.shouldRun(now + 1), true);
  assert.equal(phone.idle, false);
  assert.ok(Math.abs(phone.intervalMs - 1000 / FRAME_ACTIVE_FPS.touch) < 1e-9);
});

test('dueIn: how long the page may sleep before the next draw, so it need not wake on every refresh', () => {
  const phone = touch();
  phone.poke(0);
  assert.equal(phone.dueIn(5), 0, 'nothing has been drawn yet');
  assert.equal(phone.shouldRun(10), true);
  const paced = 1000 / FRAME_ACTIVE_FPS.touch;
  // Just after a draw on the 30 fps pace the next one is a whole frame away (less the early tolerance).
  assert.ok(Math.abs(phone.dueIn(10) - (paced - FRAME_TOLERANCE_MS)) < 1e-9);
  assert.ok(phone.dueIn(10) > FRAME_SLEEP_MIN_MS, 'worth a timer');
  assert.equal(phone.dueIn(10 + paced), 0, 'due');
  // Idle: the wait is the idle frame time.
  const quiet = touch();
  quiet.shouldRun(0);
  quiet.poke(-FRAME_ACTIVE_MS - 1);
  assert.equal(quiet.shouldRun(130), true);
  assert.ok(quiet.idle);
  assert.ok(Math.abs(quiet.dueIn(1000 / FRAME_IDLE_FPS.touch) - (1000 / FRAME_IDLE_FPS.touch - FRAME_TOLERANCE_MS)) < 1e-9);
  // Following the timer: wait, fire early, and the next animation frame draws.
  const g = touch();
  g.poke(0);
  let t = 0;
  let drawn = 0;
  for (let i = 0; i < 40; i++) {
    const wait = g.dueIn(t);
    if (wait > FRAME_SLEEP_MIN_MS) t += wait - FRAME_SLEEP_EARLY_MS; // the timer
    t = Math.ceil(t / (1000 / 60)) * (1000 / 60); // the next 60 Hz animation frame
    if (g.shouldRun(t)) drawn++;
  }
  assert.ok(drawn >= 38, `the sleep never loses a frame: ${drawn} of 40`);
  assert.ok(t / 40 > paced - 3 && t / 40 < paced + 3, `and keeps the 30 fps pace: ${(t / 40).toFixed(1)} ms a frame`);
});

test('a page that did nothing yet is idle at once, and the first tick always draws', () => {
  const phone = touch();
  assert.equal(phone.shouldRun(5), true);
  assert.equal(phone.idle, true);
});

test('always (a level with wind and clouds) never drops to the idle rate; the idle rate can change', () => {
  const phone = touch();
  phone.setAlways(true);
  const drawn = runs(phone, 60, 0, 10000);
  assert.ok(drawn >= 28 * 10 && drawn <= 31 * 10, `${drawn} frames in 10 s`);
  assert.equal(phone.idle, false);
  phone.setAlways(false);
  phone.setIdleFps(FRAME_FROSTED_FPS);
  runs(phone, 60, 10000, 20000); // well past the active window
  const frosted = runs(phone, 60, 20000, 22000);
  assert.ok(Math.abs(frosted - 2 * FRAME_FROSTED_FPS) <= 2, `${frosted} frames in 2 s behind a blurred menu`);
});

test('a rate of 0 or Infinity draws every tick', () => {
  const g = createFrameGovernor({ activeFps: Infinity, idleFps: 0, holdMs: 1000 });
  g.poke(0);
  assert.equal(runs(g, 60, 0, 500), 30);
});

test('the pointer test: matchMedia (pointer: coarse), and a missing or throwing matchMedia is not touch', () => {
  assert.equal(isCoarsePointer((query) => ({ matches: query === '(pointer: coarse)' })), true);
  assert.equal(isCoarsePointer(() => ({ matches: false })), false);
  assert.equal(isCoarsePointer(undefined), false);
  assert.equal(isCoarsePointer(() => { throw new Error('no'); }), false);
});

test('the state signature changes with the turn, a skill used and the end, and with nothing else', () => {
  const state = createInitialState(15);
  const base = stateSignature(state);
  assert.equal(stateSignature(state), base, 'the same state, the same number');
  assert.notEqual(stateSignature({ ...state, turn: state.turn + 1 }), base);
  assert.notEqual(stateSignature({ ...state, skillUsed: 'mudTrap' }), base);
  assert.notEqual(stateSignature({ ...state, winner: 'X' }), base);
  assert.equal(stateSignature({ ...state, board: state.board.map((row) => [...row]) }), base, 'a copy of the board is not a change');
  assert.equal(stateSignature(null), -1);
  assert.equal(typeof stateSignature(state), 'number');
});

test('the slow-frame watch takes the target of the pace: 30 fps frames are fine, slower ones are not', () => {
  const watch = () => createSlowFrameWatch({ targetFrameMs: TARGET_FRAME_MS, holdMs: QUALITY_STEP_DOWN_MS, stallMs: QUALITY_STALL_MS });
  const paced = 1000 / FRAME_ACTIVE_FPS.touch;
  const target = Math.max(TARGET_FRAME_MS, paced * FRAME_SLOW_FACTOR);
  const feed = (w, dt, targetMs) => {
    for (let t = 0, i = 0; i < 400; i++, t += dt) if (w.tick(t, targetMs)) return true;
    return false;
  };
  assert.equal(feed(watch(), paced, undefined), true, 'without the target of the pace a 30 fps loop looks slow');
  assert.equal(feed(watch(), paced, target), false, 'with it, a 30 fps loop is on pace');
  assert.equal(feed(watch(), 70, target), true, 'frames far slower than the pace still step down');
  // forget() starts over like reset().
  const w = watch();
  for (let i = 0; i < 20; i++) w.tick(i * 40, target);
  assert.ok(w.averageMs > 0);
  w.forget();
  assert.equal(w.averageMs, 0);
});

test('the world: a paced loop and an idle page do not step the level down, slow frames still do', async () => {
  installFakeDocument();
  const { createWorldRenderer } = await import('../src/render3d/world-renderer.js');
  const build = () => {
    const gl = fakeRenderer();
    const renderer = createWorldRenderer(fakeCanvas(), { storage: null, quality: 'medium', createRenderer: () => gl });
    const ctx = fakeCanvas().getContext('2d');
    const state = createInitialState(15);
    return { renderer, ctx, state };
  };
  const play = ({ renderer, ctx, state }, dt, frameMs, idle) => {
    let time = 1000;
    for (let i = 0; i < Math.ceil((QUALITY_STEP_DOWN_MS + 1500) / dt); i++) {
      time += dt;
      renderer.drawGameScreen(ctx, { state, hover: null, preview: null, time, frameMs, idle });
    }
    return renderer.features.name;
  };
  const paced = 1000 / FRAME_ACTIVE_FPS.touch;
  assert.equal(play(build(), paced, paced, false), 'medium', 'on a 30 fps pace');
  assert.equal(play(build(), 1000 / FRAME_IDLE_FPS.touch, 1000 / FRAME_IDLE_FPS.touch, true), 'medium', 'idle');
  assert.equal(play(build(), paced, 0, false), 'low', 'the same frames with no pace are slow');
  assert.equal(play(build(), 70, paced, false), 'low', 'frames slower than the pace');
});

test('a phone: a lower pixel ratio at every level, and no level asks for more than the screen cap', () => {
  assert.ok(QUALITY_ORDER.every((level) => QUALITY_LEVELS[level].touchPixelRatioCap <= QUALITY_LEVELS[level].pixelRatioCap));
  const caps = ['low', 'medium', 'high'].map((level) => QUALITY_LEVELS[level].touchPixelRatioCap);
  assert.deepEqual(caps, [1, 1.25, 1.5]);
  for (const level of QUALITY_ORDER) {
    const row = QUALITY_LEVELS[level];
    assert.equal(windowView(390, 844, level, 3, true).pixelRatio, row.touchPixelRatioCap, level);
    assert.equal(windowView(390, 844, level, 3, false).pixelRatio, row.pixelRatioCap, level);
    assert.equal(windowView(390, 844, level, 1, true).pixelRatio, 1, 'a low density screen is not scaled up');
  }
  // 585 x 1266 at 1.5 became 488 x 1055 at 1.25: a third fewer pixels on Medium.
  const medium = windowView(390, 844, 'medium', 3, true);
  const before = windowView(390, 844, 'medium', 3, false);
  assert.ok((medium.pixelRatio / before.pixelRatio) ** 2 < 0.7);
});

test('main.js wakes the page on input and changes, and skips the other ticks', () => {
  assert.match(mainSource, /if \(!governor\.shouldRun\(time\)\) \{\s*next\(\);[^\n]*\n\s*return;/);
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'resize']) assert.match(mainSource, new RegExp(`'${type}'`), type);
  assert.match(mainSource, /governor\.poke\(time\); \/\/ something happened/);
  assert.match(mainSource, /stateSignature\(view\.state\)/);
  assert.match(mainSource, /if \(wait > FRAME_SLEEP_MIN_MS\) \{\s*sleepTimer = setTimeout/);
  assert.match(mainSource, /clearTimeout\(sleepTimer\);\s*sleepTimer = 0;\s*wakeFrame\(\);/, 'an input wakes a sleeping loop at once');
  assert.match(mainSource, /governor\.setAlways\(Boolean\(renderer\.features\?\.backgroundMotion\)\)/);
  assert.match(mainSource, /governor\.setIdleFps\(blur \? FRAME_FROSTED_FPS : idleFps\)/);
});
