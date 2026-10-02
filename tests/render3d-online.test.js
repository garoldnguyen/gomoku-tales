import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CAMERA_DISTANCE, CAMERA_FOV, CAMERA_PITCH_DEG, FPS_SAMPLE_MS, INTERNAL_HEIGHT, INTERNAL_WIDTH,
  QUALITY_STALL_MS, RESUME_GAP_MS,
} from '../src/config.js';
import { X, O } from '../src/logic/board.js';
import { WIND_RABBIT } from '../src/logic/characters.js';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { HUD_3D, skillButtonRect } from '../src/render/layout.js';
import { boardMarks } from '../src/render3d/board-marks.js';
import { cameraPosition } from '../src/render3d/camera.js';
import { catchUpVisuals, visualsForEvents } from '../src/render3d/effect-plans.js';
import { createFpsMeter } from '../src/render3d/fps.js';
import { createResumeWatch } from '../src/render3d/frame-gap.js';
import { createWorldHitTest } from '../src/render3d/hit-test.js';
import { blursMenus, QUALITY_LEVELS } from '../src/render3d/quality.js';
import { sameViewSize, viewSize } from '../src/render3d/view-size.js';
import { GAME, createApp } from '../src/ui/app.js';
import { isQualityKey, isTextEntry } from '../src/ui/input.js';

const TARGET = { x: 0, y: 0, z: 0 };
const worldHitTest = createWorldHitTest({
  position: cameraPosition(CAMERA_PITCH_DEG, CAMERA_DISTANCE, TARGET),
  target: TARGET,
  fovDeg: CAMERA_FOV,
  aspect: 16 / 9,
});

// A HUD point for every board cell, found through the 3D hit test.
const cellPoints = new Map();
for (let py = 0; py < INTERNAL_HEIGHT; py += 3) {
  for (let px = 0; px < INTERNAL_WIDTH; px += 3) {
    const hit = worldHitTest(px, py);
    const key = hit?.cell && `${hit.cell.x},${hit.cell.y}`;
    if (key && !cellPoints.has(key)) cellPoints.set(key, { px, py });
  }
}

// Two windows of one profile: a host playing Wind Rabbit and a guest, on
// one fake network and clock, each with a pointer that goes through the
// 3D hit test like src/main.js online mode.
function twoWindows() {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const open = () => createApp({ openTransport: () => network.connect(), clock, random: () => 0, makeCode: () => 'AB2C9' });
  const host = open();
  const guest = open();
  host.openCreate();
  host.createRoom(WIND_RABBIT);
  guest.openJoin();
  guest.joinRoom('AB2C9');
  const pointer = (app) => ({
    click(px, py) {
      const hit = worldHitTest(px, py);
      const game = app.getGame();
      if (hit?.skill) return game.clickSkill(hit.skill.player, hit.skill.skillId);
      if (hit?.cell) return game.click(hit.cell);
      return false;
    },
    cell(x, y) {
      const { px, py } = cellPoints.get(`${x},${y}`);
      return this.click(px, py);
    },
    skill(player, index) {
      const r = skillButtonRect(player, index, HUD_3D);
      return this.click(r.x + r.w / 2, r.y + r.h / 2);
    },
    hover(x, y) {
      const { px, py } = cellPoints.get(`${x},${y}`);
      app.getGame().setHover(worldHitTest(px, py).cell);
    },
  });
  return { clock, host, guest, hostPointer: pointer(host), guestPointer: pointer(guest) };
}

// --- Online play through the 3D renderer's picking ---

test('the 3D hit test reaches every cell, so online clicks can use it', () => {
  assert.equal(cellPoints.size, 15 * 15);
});

test('two online windows play stones and skills through 3D picking and get the same events', () => {
  const { host, guest, hostPointer, guestPointer } = twoWindows();
  assert.equal(host.getScreen(), GAME);
  assert.equal(guest.getScreen(), GAME);
  const rabbit = host.getGame();
  const bear = guest.getGame();

  assert.equal(hostPointer.cell(7, 7), true);
  assert.equal(bear.getView().state.board[7][7], X);
  assert.equal(guestPointer.skill(X, 0), false, "the guest cannot use the host's skill");
  assert.equal(bear.getView().message, "That is your opponent's skill.");
  assert.equal(guestPointer.skill(O, 0), true); // Terrain Creation
  assert.equal(guestPointer.cell(9, 9), true);
  assert.equal(rabbit.getView().state.board[9][9], 'ROCK');

  // Wind Dash: choose the stone, then the target.
  assert.equal(hostPointer.skill(X, 0), true);
  assert.equal(hostPointer.cell(7, 7), false);
  assert.equal(hostPointer.cell(7, 10), true);
  assert.deepEqual(bear.getView().state.pendingDash.to, { x: 7, y: 10 });

  const hostEvents = rabbit.takeEvents();
  const guestEvents = bear.takeEvents();
  assert.deepEqual(hostEvents, guestEvents, 'both windows start the same 3D visuals');
  const kinds = visualsForEvents(guestEvents).map((spec) => spec.kind);
  for (const kind of ['place', 'rockFall', 'dashMark']) assert.ok(kinds.includes(kind), kind);
});

test('the ghost stone shows only in the window whose turn it is', () => {
  const { host, guest, hostPointer, guestPointer } = twoWindows();
  hostPointer.hover(3, 3);
  guestPointer.hover(3, 3);
  assert.deepEqual(boardMarks(host.getGame().getView()).ghost, { kind: X, x: 3, y: 3 });
  assert.equal(boardMarks(guest.getGame().getView()).ghost, null);
});

// --- Pages that were hidden ---

test('the resume watch spots the first frame after a hidden page or a long gap', () => {
  const watch = createResumeWatch(RESUME_GAP_MS);
  let now = 0;
  assert.equal(watch.tick(now), false, 'the first frame is not a resume');
  assert.equal(watch.tick((now += 16)), false);
  assert.equal(watch.tick((now += RESUME_GAP_MS)), false, 'a gap of exactly the limit is still a frame');
  assert.equal(watch.tick((now += RESUME_GAP_MS + 1)), true, 'a covered window');
  assert.equal(watch.tick((now += 16)), false);
  watch.markHidden();
  assert.equal(watch.tick((now += 16)), true, 'a hidden tab, even after a short gap');
  assert.equal(watch.tick((now += 16)), false);
  assert.ok(RESUME_GAP_MS > QUALITY_STALL_MS, 'a stall alone is not a resume');
});

test('catching up shows where the lingering marks end up and nothing else', () => {
  const from = { x: 2, y: 2 };
  const to = { x: 4, y: 4 };
  const place = { type: 'stonePlaced', x: 1, y: 1, player: O };
  const dashOn = { type: 'dashAnnounced', from, to, player: X };
  const zoneOn = { type: 'tornadoAnnounced', x: 5, y: 5, cells: [{ x: 5, y: 5 }] };

  assert.deepEqual(catchUpVisuals([]), []);
  assert.deepEqual(catchUpVisuals([place, { type: 'rockPlaced', x: 0, y: 0 }]), [], 'no sparkles, falls or banners');
  assert.deepEqual(catchUpVisuals([dashOn]), [{ kind: 'dashMark', from, to, player: X }]);
  assert.deepEqual(catchUpVisuals([dashOn, place, { type: 'dashResolved', from, to, player: X }]), [{ kind: 'dashClear' }]);
  assert.deepEqual(catchUpVisuals([{ type: 'dashFailed', from, to }]), [{ kind: 'dashClear' }]);
  assert.deepEqual(catchUpVisuals([zoneOn]), [{ kind: 'tornado', x: 5, y: 5, cells: zoneOn.cells }]);
  assert.deepEqual(catchUpVisuals([zoneOn, { type: 'tornadoEnded' }]), [{ kind: 'tornadoClear' }]);
  assert.deepEqual(
    catchUpVisuals([dashOn, zoneOn, { type: 'win', player: O }]),
    [{ kind: 'dashClear' }, { kind: 'tornadoClear' }],
    'a win clears both',
  );
});

test('an online game caught up after a hidden tab keeps the announced marks', () => {
  const { host, guestPointer, hostPointer } = twoWindows();
  hostPointer.cell(7, 7);
  guestPointer.cell(0, 0);
  hostPointer.skill(X, 1); // Tornado Zone
  hostPointer.cell(10, 10);
  // The host's tab was hidden for all of that.
  const specs = catchUpVisuals(host.getGame().takeEvents());
  assert.deepEqual(specs.map((spec) => spec.kind), ['tornado']);
  assert.equal(host.getGame().getView().state.tornado.x, 10);
});

test('the FPS meter does not count a hidden tab as a slow frame', () => {
  const meter = createFpsMeter(FPS_SAMPLE_MS, QUALITY_STALL_MS);
  let now = 0;
  meter.tick(now);
  for (let i = 0; i < 40; i++) meter.tick((now += 16));
  const before = meter.fps;
  assert.ok(before > 55, `steady 60 Hz reads about 62, got ${before}`);
  now += 10000; // hidden
  meter.tick(now);
  assert.equal(meter.fps, before, 'the gap gives no reading');
  for (let i = 0; i < 40; i++) meter.tick((now += 16));
  assert.ok(meter.fps > 55, `back to about 62 after the gap, got ${meter.fps}`);
});

// --- Sizes and per-window quality ---

test('viewSize follows the canvas box and this window\'s capped devicePixelRatio', () => {
  assert.deepEqual(viewSize(960, 540, 1, 1.5), { width: 960, height: 540, pixelRatio: 1 });
  assert.deepEqual(viewSize(960, 540, 2, 1.5), { width: 960, height: 540, pixelRatio: 1.5 });
  assert.deepEqual(viewSize(800, 450, 1.25, 1.5), { width: 800, height: 450, pixelRatio: 1.25 });
  assert.equal(viewSize(0, 0, 1, 1.5), null, 'a hidden canvas keeps its last size');
  assert.equal(viewSize(960, 0, 1, 1.5), null);

  const a = viewSize(960, 540, 1, 1.5);
  assert.equal(sameViewSize(a, viewSize(960, 540, 1, 1.5)), true);
  assert.equal(sameViewSize(a, viewSize(960, 540, 1.25, 1.5)), false, 'a window moved to another screen');
  assert.equal(sameViewSize(a, viewSize(961, 540, 1, 1.5)), false);
  assert.equal(sameViewSize(null, a), false);
  assert.equal(sameViewSize(null, null), true);
});

test('Q does not change the quality while typing a room code', () => {
  const input = { tagName: 'INPUT' };
  assert.equal(isQualityKey({ key: 'q', target: input }), false);
  assert.equal(isQualityKey({ key: 'Q', target: { tagName: 'TEXTAREA' } }), false);
  assert.equal(isQualityKey({ key: 'q', target: { tagName: 'DIV', isContentEditable: true } }), false);
  assert.equal(isQualityKey({ key: 'q', target: { tagName: 'BUTTON' } }), true);
  assert.equal(isQualityKey({ key: 'q', target: { tagName: 'BODY' } }), true);
  assert.equal(isTextEntry(null), false);
  assert.equal(isTextEntry(input), true);
});

test('the scene behind the menus is blurred where the HUD glass is frosted, not on low', () => {
  assert.equal(blursMenus(QUALITY_LEVELS.high), true);
  assert.equal(blursMenus(QUALITY_LEVELS.medium), true);
  assert.equal(blursMenus(QUALITY_LEVELS.low), false);
  assert.equal(blursMenus(undefined), false, 'the 2D renderer never blurs');
});

test('the new pure helpers do not import Three.js', () => {
  for (const file of ['view-size.js', 'frame-gap.js', 'fps.js', 'effect-plans.js', 'quality.js']) {
    const source = readFileSync(new URL(`../src/render3d/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]three/, file);
  }
});
