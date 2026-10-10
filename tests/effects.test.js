import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANNER_MS, DUST_COUNT, DUST_MS, INTERNAL_WIDTH, SHAKE_MS, SHAKE_PX, SPARKLE_COUNT, SPARKLE_MS, WIND_STREAK_COUNT } from '../src/config.js';
import { X, O, ROCK } from '../src/logic/board.js';
import { WIND_RABBIT } from '../src/logic/characters.js';
import { createInitialState, placeStone, useSkill } from '../src/logic/game.js';
import { WIND_DASH, TORNADO_ZONE, MUD_TRAP, PETRIFICATION } from '../src/logic/skills.js';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { createEffects, effectsForEvents, shakeOffset, windStreaks } from '../src/render/effects.js';
import { drawGameScreen } from '../src/render/game-renderer.js';
import { createApp } from '../src/ui/app.js';
import { createLocalGame } from '../src/ui/local-game.js';
import { pickAndReady } from './room-start.js';
import { skillTurn } from './skill-turn.js';

// The app starts on the main menu; Play Online opens the lobby.
const onLobby = (app) => {
  app.playOnline();
  return app;
};

// A 2D context stand-in that records fillText and translate calls.
function fakeContext() {
  const texts = [];
  const translations = [];
  const ctx = new Proxy({ globalAlpha: 1, texts, translations }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return () => ({ width: 40 });
      if (key === 'fillText') return (text) => texts.push(text);
      if (key === 'translate') return (dx, dy) => translations.push([dx, dy]);
      return () => {};
    },
  });
  return ctx;
}

const kinds = (specs) => specs.map((spec) => spec.kind);

function ok(result) {
  assert.equal(result.ok, true, result.error);
  return result;
}

// --- Event to effect mapping ---

test('a placement shows sparkles, a dust puff and a shake on its cell', () => {
  const { events } = ok(placeStone(createInitialState(), { player: X, x: 3, y: 4 }));
  const specs = effectsForEvents(events);
  assert.deepEqual(kinds(specs), ['sparkle', 'dust', 'shake']);
  assert.deepEqual(specs[0], { kind: 'sparkle', x: 3, y: 4, player: X });
  assert.deepEqual(specs[1], { kind: 'dust', x: 3, y: 4 });
});

test('every skill use shows a banner with its name', () => {
  const state = createInitialState();
  state.board[5][5] = X;
  state.board[6][6] = O;
  const dash = ok(useSkill(state, { player: X, skill: WIND_DASH, target: { from: { x: 5, y: 5 }, to: { x: 9, y: 9 } } }));
  const tornado = ok(useSkill(state, { player: X, skill: TORNADO_ZONE, target: { x: 7, y: 7 } }));
  const bearTurn = { ...state, currentPlayer: O };
  const mud = ok(useSkill(bearTurn, { player: O, skill: MUD_TRAP, target: { x: 1, y: 1 } }));
  const petrify = ok(useSkill(bearTurn, { player: O, skill: PETRIFICATION, target: { x: 5, y: 5 } }));

  const banners = (events) => effectsForEvents(events).filter((s) => s.kind === 'banner').map((s) => s.text);
  assert.deepEqual(banners(dash.events), ['Wind Dash!']);
  assert.deepEqual(banners(tornado.events), ['Tornado Zone!']);
  assert.deepEqual(banners(mud.events), ['Mud Trap!']);
  assert.deepEqual(banners(petrify.events), ['Petrification!']);

  // Announcing a dash or a zone hits no stone yet: no shake.
  assert.ok(!kinds(effectsForEvents(dash.events)).includes('shake'));
  assert.ok(!kinds(effectsForEvents(tornado.events)).includes('shake'));
  // A mud puddle gives dust; a petrified plant gives dust and a shake, no sparkles.
  assert.deepEqual(kinds(effectsForEvents(mud.events)), ['banner', 'dust']);
  assert.deepEqual(kinds(effectsForEvents(petrify.events)), ['banner', 'dust', 'shake']);
});

test('skill hits on stones: a dash landing and a tornado throw', () => {
  const landing = effectsForEvents([{ type: 'dashResolved', player: X, from: { x: 1, y: 1 }, to: { x: 4, y: 2 } }]);
  assert.deepEqual(landing.find((s) => s.kind === 'sparkle'), { kind: 'sparkle', x: 4, y: 2, player: X });
  assert.ok(kinds(landing).includes('shake'));
  assert.ok(landing.some((s) => s.kind === 'dust' && s.x === 1 && s.y === 1), 'dust where it left');

  const thrown = effectsForEvents([{ type: 'stoneThrown', player: O, from: { x: 7, y: 7 }, to: { x: 8, y: 6 } }]);
  assert.deepEqual(thrown.find((s) => s.kind === 'sparkle'), { kind: 'sparkle', x: 8, y: 6, player: O });

  const failed = effectsForEvents([{ type: 'dashFailed', player: X, from: { x: 1, y: 1 }, to: { x: 4, y: 2 }, reason: 'targetTaken' }]);
  assert.ok(!kinds(failed).includes('shake'));
  assert.ok(kinds(failed).includes('banner'));

  assert.deepEqual(effectsForEvents([{ type: 'mudDried', player: O, x: 2, y: 3 }]), [{ kind: 'dust', x: 2, y: 3 }]);
  assert.deepEqual(effectsForEvents([{ type: 'stoneSurfaced', player: X, x: 2, y: 3 }]).find((s) => s.kind === 'sparkle'), { kind: 'sparkle', x: 2, y: 3, player: X });
  assert.deepEqual(effectsForEvents([{ type: 'turnEnded', player: X, turn: 0 }, { type: 'win', player: X, line: [] }]), []);
});

// --- Live effects ---

test('particles, the shake and banners fade out on time', () => {
  const effects = createEffects({ random: () => 0.5 });
  effects.trigger([
    { type: 'skillUsed', player: O, skill: PETRIFICATION, target: { x: 2, y: 2 } },
    { type: 'stonePetrified', player: O, x: 2, y: 2, from: X },
  ], 1000);
  assert.deepEqual(effects.active(1000), { particles: DUST_COUNT, banners: ['Petrification!'], shaking: true });
  assert.equal(effects.active(1000 + SHAKE_MS).shaking, false);
  assert.equal(effects.active(1000 + DUST_MS).particles, 0);
  assert.deepEqual(effects.active(1000 + BANNER_MS).banners, []);

  effects.trigger([{ type: 'stonePlaced', player: X, x: 0, y: 0 }], 5000);
  assert.equal(effects.active(5000).particles, SPARKLE_COUNT + DUST_COUNT);
  assert.equal(effects.active(5000 + Math.max(SPARKLE_MS, DUST_MS)).particles, 0);

  effects.trigger([{ type: 'stonePlaced', player: X, x: 0, y: 0 }], 9000);
  effects.clear();
  assert.deepEqual(effects.active(9000), { particles: 0, banners: [], shaking: false });
});

test('banners from one action or fast actions queue up and each shows in full', () => {
  // X dashes; on O's next turn O uses a skill and the dash resolves, so one
  // action gives two banners.
  const start = createInitialState();
  start.board[5][5] = X;
  const dashed = skillTurn(start, X, WIND_DASH, { from: { x: 5, y: 5 }, to: { x: 9, y: 9 } }); // a skill, then a planting
  const events = [];
  skillTurn(dashed, O, MUD_TRAP, { x: 1, y: 1 }, null, events);
  assert.deepEqual(effectsForEvents(events).filter((s) => s.kind === 'banner').map((s) => s.text), ['Mud Trap!', 'Wind Dash landed!']);

  const effects = createEffects({ random: () => 0 });
  effects.trigger(events, 0);
  effects.trigger([{ type: 'skillUsed', player: X, skill: TORNADO_ZONE, target: { x: 7, y: 7 } }], 500);
  const shown = (time) => {
    const ctx = fakeContext();
    effects.drawBanner(ctx, time);
    return ctx.texts;
  };
  assert.deepEqual(effects.active(0).banners, ['Mud Trap!', 'Wind Dash landed!', 'Tornado Zone!']);
  assert.deepEqual(shown(0), ['Mud Trap!']);
  assert.deepEqual(shown(BANNER_MS - 1), ['Mud Trap!']);
  assert.deepEqual(shown(BANNER_MS), ['Wind Dash landed!']);
  assert.deepEqual(shown(2 * BANNER_MS - 1), ['Wind Dash landed!']);
  assert.deepEqual(shown(2 * BANNER_MS), ['Tornado Zone!']);
  assert.deepEqual(shown(3 * BANNER_MS), []);
  assert.deepEqual(effects.active(3 * BANNER_MS).banners, []);

  // With nothing queued, a new banner shows at once.
  effects.trigger([{ type: 'skillUsed', player: O, skill: PETRIFICATION, target: { x: 5, y: 5 } }], 10000);
  assert.deepEqual(shown(10000), ['Petrification!']);
});

test('the shake is light and stops after SHAKE_MS', () => {
  assert.deepEqual(shakeOffset(null, 100), { dx: 0, dy: 0 });
  for (let t = 0; t < SHAKE_MS; t += 7) {
    const { dx, dy } = shakeOffset(0, t);
    assert.ok(Math.abs(dx) <= SHAKE_PX && Math.abs(dy) <= SHAKE_PX);
  }
  assert.deepEqual(shakeOffset(0, SHAKE_MS), { dx: 0, dy: 0 });
});

test('wind streaks always drift to the right and stay on or near the screen', () => {
  const a = windStreaks(0);
  const b = windStreaks(100);
  assert.equal(a.length, WIND_STREAK_COUNT);
  assert.deepEqual(windStreaks(0), a, 'deterministic');
  let moved = 0;
  for (let i = 0; i < a.length; i++) if (b[i].x > a[i].x) moved++;
  assert.ok(moved > 0);
  for (const t of [0, 5000, 123456]) {
    for (const s of windStreaks(t)) assert.ok(s.x + s.length >= -200 && s.x <= INTERNAL_WIDTH + 200);
  }
});

test('drawGameScreen shakes the scene and draws the banner', () => {
  const effects = createEffects({ random: () => 0 });
  effects.trigger([
    { type: 'skillUsed', player: O, skill: PETRIFICATION, target: { x: 2, y: 2 } },
    { type: 'stonePetrified', player: O, x: 2, y: 2, from: X },
  ], 0);
  const ctx = fakeContext();
  const game = createLocalGame();
  drawGameScreen(ctx, { ...game.getView(), time: 30, effects });
  assert.ok(ctx.texts.includes('Petrification!'));
  assert.deepEqual(ctx.translations, [[shakeOffset(0, 30).dx, shakeOffset(0, 30).dy]]);
});

// --- Controllers hand over their events once ---

test('the local game hands over the events of applied actions once', () => {
  const game = createLocalGame({ random: () => 0 });
  assert.deepEqual(game.takeEvents(), []);
  game.click({ x: 7, y: 7 });
  game.click({ x: 7, y: 7 }); // rejected: no events
  const events = game.takeEvents();
  assert.deepEqual(events.map((e) => e.type), ['stonePlaced', 'turnEnded']);
  assert.deepEqual(game.takeEvents(), []);
  game.click({ x: 8, y: 8 });
  game.restart();
  assert.deepEqual(game.takeEvents(), [], 'restart drops old events');
});

test('effects do not change the game state', () => {
  const game = createLocalGame({ random: () => 0 });
  game.click({ x: 7, y: 7 });
  const before = JSON.stringify(game.getState());
  const effects = createEffects();
  effects.trigger(game.takeEvents(), 0);
  drawGameScreen(fakeContext(), { ...game.getView(), time: 10, effects });
  assert.equal(JSON.stringify(game.getState()), before);
  assert.equal(game.getState().board[7][7], X);
  assert.notEqual(game.getState().board[7][7], ROCK);
});

test('both online windows get the same events for effects', () => {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const open = () => onLobby(createApp({ openTransport: () => network.connect(), clock, random: () => 0, makeCode: () => 'AB2C9' }));
  const host = open();
  const guest = open();
  host.createRoom();
  guest.openJoin();
  guest.joinRoom('AB2C9');
  pickAndReady(host, guest, WIND_RABBIT); // both Ready: the host starts the game
  host.getGame().takeEvents();
  guest.getGame().takeEvents();

  assert.equal(host.getGame().click({ x: 7, y: 7 }), true);
  const hostEvents = host.getGame().takeEvents();
  assert.deepEqual(hostEvents.map((e) => e.type), ['stonePlaced', 'turnEnded']);
  assert.deepEqual(guest.getGame().takeEvents(), hostEvents);
  assert.deepEqual(host.getGame().takeEvents(), []);
});
