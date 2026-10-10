// The secret cross Tornado trap (docs/free-action-design.md sections 4 and
// 7): until it fires, only the Wind Rabbit that cast it may know where the
// cross is. These tests follow the cross through the masking of the state
// and the events, and through every kind of message the host sends to the
// guest (one test per message type), over the real rooms on the fake
// transport. The spectators' copy keeps the full state, and the reveal
// (tornadoStorm) reaches everybody.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEAVE_COUNTDOWN_S, PEER_TIMEOUT_MS } from '../src/config.js';
import { O, X } from '../src/logic/board.js';
import { localViewEvents, localViewState, maskEventsForViewer, maskForViewer } from '../src/logic/cloud.js';
import { createInitialState, placeStone, useSkill } from '../src/logic/game.js';
import { TORNADO_ZONE } from '../src/logic/skills.js';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { OVER, PLAYING, createGuestRoom, createHostRoom, hostStateMessages } from '../src/net/room.js';
import { catchUpVisuals, visualsForEvents } from '../src/render3d/effect-plans.js';
import { pickAndReady } from './room-start.js';

// The cross of the trap: centre (4, 9). No other test move uses these cells.
const CENTRE = { x: 4, y: 9 };
const CROSS = [{ x: 4, y: 8 }, { x: 3, y: 9 }, { x: 4, y: 9 }, { x: 5, y: 9 }, { x: 4, y: 10 }];

function ok(result) {
  assert.equal(result.ok, true, result.error);
  return result;
}

// True when the message names any cell of the cross or carries its cells.
function leaksCross(message) {
  const text = JSON.stringify(message);
  if (CROSS.some(({ x, y }) => text.includes(`"x":${x},"y":${y}`))) return true;
  const zone = message?.state?.tornado;
  return Boolean(zone) && ('cells' in zone || 'x' in zone || 'y' in zone || 'armedAfterTurn' in zone);
}

// X (Wind Rabbit) casts at the centre and plants far away: O is to move,
// the cross is armed and unfired. Returns the state and the events.
function castAndPlant() {
  const used = ok(useSkill(createInitialState(), { player: X, skill: TORNADO_ZONE, target: CENTRE }));
  const planted = ok(placeStone(used.state, { player: X, x: 14, y: 14 }));
  return { state: planted.state, events: [...used.events, ...planted.events] };
}

// --- The state and the events ---

test('the other seat\'s state names the trap, never the cross; the caster and the spectators see it', () => {
  const { state } = castAndPlant();
  assert.equal(maskForViewer(state, X), state);
  assert.equal(maskForViewer(state, null), state);
  const theirs = maskForViewer(state, O);
  assert.deepEqual(theirs.tornado, { player: X, hidden: true, endsAfterTurn: state.tornado.endsAfterTurn });
  assert.equal(leaksCross({ state: theirs }), false);
  assert.deepEqual(theirs.board, state.board, 'a trap changes no plot');
});

test('the cast events keep the skillUsed of Tornado Zone with no target, and name no cell for the other seat', () => {
  const { state, events } = castAndPlant();
  const seen = maskEventsForViewer(maskForViewer(state, O), events);
  assert.deepEqual(seen.find((e) => e.type === 'skillUsed'), { type: 'skillUsed', player: X, skill: TORNADO_ZONE, target: null });
  assert.deepEqual(seen.find((e) => e.type === 'tornadoAnnounced'), { type: 'tornadoAnnounced', player: X, hidden: true });
  assert.equal(leaksCross({ events: seen }), false);
  assert.equal(maskEventsForViewer(maskForViewer(state, X), events), events, 'the caster keeps them');
});

test('the reveal: tornadoStorm and the throw reach the other seat with the whole cross', () => {
  const { state } = castAndPlant();
  const fired = ok(placeStone(state, { player: O, x: 4, y: 9 }, { random: () => 0 }));
  assert.equal(fired.state.tornado, null);
  const storm = fired.events.find((e) => e.type === 'tornadoStorm');
  assert.deepEqual(storm, { type: 'tornadoStorm', player: X, x: 4, y: 9, cells: CROSS });
  for (const viewer of [X, O, null]) {
    const seen = maskEventsForViewer(maskForViewer(fired.state, viewer), fired.events);
    assert.deepEqual(seen.find((e) => e.type === 'tornadoStorm'), storm, `viewer ${viewer} sees the reveal`);
  }
  // The viewer's effects: the storm bursts over the cross.
  const specs = visualsForEvents(maskEventsForViewer(maskForViewer(fired.state, O), fired.events));
  assert.deepEqual(specs.find((s) => s.kind === 'storm').cells, CROSS);
});

test('the reveal stays even when the planted cell lies under the other seat\'s cloud', () => {
  const { state } = castAndPlant();
  const fired = ok(placeStone(state, { player: O, x: 4, y: 9 }, { random: () => 0 }));
  const covered = { ...fired.state, covered: [{ x: 4, y: 9 }, { x: 3, y: 8 }] };
  const seen = maskEventsForViewer(covered, fired.events);
  assert.ok(seen.some((e) => e.type === 'tornadoStorm'), 'the storm is public');
  assert.equal(seen.some((e) => e.type === 'stonePlaced'), false, 'the planting under the cloud stays hidden');
});

test('an unfired trap that expires reveals nothing to the other seat', () => {
  const { state } = castAndPlant();
  const afterO = ok(placeStone(state, { player: O, x: 0, y: 0 }));
  const afterX = ok(placeStone(afterO.state, { player: X, x: 13, y: 13 }));
  const ended = afterX.events.find((e) => e.type === 'tornadoEnded');
  assert.deepEqual(ended, { type: 'tornadoEnded', player: X });
  assert.equal(leaksCross({ state: afterX.state, events: maskEventsForViewer(maskForViewer(afterX.state, O), afterX.events) }), false);
  assert.equal(JSON.stringify(afterX.events).includes('"cells"'), false);
});

test('one screen: the player to move sees the cross only if they cast it, and the reveal reaches both', () => {
  const { state, events } = castAndPlant();
  assert.equal(localViewState(state).tornado.hidden, true, 'O is to move');
  assert.equal(leaksCross({ state: localViewState(state), events: localViewEvents(state, events) }), false);
  const fired = ok(placeStone(state, { player: O, x: 3, y: 9 }, { random: () => 0 }));
  assert.ok(localViewEvents(fired.state, fired.events).some((e) => e.type === 'tornadoStorm' && e.cells.length === 5));
});

test('catching up after a trap that fired leaves no swirl, one that is still waiting keeps it', () => {
  const { state, events } = castAndPlant();
  assert.deepEqual(catchUpVisuals(events).map((spec) => spec.kind), ['tornado'], 'waiting: the caster still sees it');
  const fired = ok(placeStone(state, { player: O, x: 5, y: 9 }, { random: () => 0 }));
  assert.deepEqual(catchUpVisuals([...events, ...fired.events]).map((spec) => spec.kind), ['tornadoClear'], 'used up');
});

// --- Every host message to the guest, over the real rooms ---

function rooms() {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const hostTransport = network.connect();
  hostTransport.reachesSpectators = true; // the relay: the spectators get the full copy
  const host = createHostRoom({ transport: hostTransport, code: 'AB2C9', clock, id: 'host' });
  const guestTransport = network.connect();
  const guest = createGuestRoom({ transport: guestTransport, code: 'AB2C9', clock, id: 'guest' });
  pickAndReady(host, guest); // the host plays Wind Rabbit (X), the guest Earth Bear (O)
  assert.equal(host.phase, PLAYING);
  const toGuest = () => hostTransport.sent.filter((m) => m.spectatorsOnly !== true);
  const ofType = (type) => toGuest().filter((m) => m.type === type);
  // The host casts the trap and plants; O is to move and the cross is unfired.
  ok(host.useSkill(TORNADO_ZONE, CENTRE));
  ok(host.place(14, 14));
  assert.deepEqual(host.state.tornado.cells, CROSS);
  return { clock, host, guest, hostTransport, guestTransport, toGuest, ofType };
}

// The host's messages that carry the full state for the spectators only.
const spectatorCopies = (ctx, type) => ctx.hostTransport.sent.filter((m) => m.spectatorsOnly === true && m.type === type);

function assertNothingLeaks(ctx, type) {
  const messages = ctx.ofType(type);
  assert.ok(messages.length > 0, `a '${type}' message was sent`);
  for (const message of messages) assert.equal(leaksCross(message), false, `'${type}' tells the cross`);
  return messages;
}

test("a 'state' message: the guest's copy hides the cross, the spectators' copy keeps the full state", () => {
  const ctx = rooms();
  const [cast, planted] = ctx.ofType('state').slice(-2);
  assert.equal(cast.masked, true);
  assert.equal(planted.state.tornado.hidden, true);
  assertNothingLeaks(ctx, 'state');
  assert.deepEqual(ctx.guest.state.tornado, { player: X, hidden: true, endsAfterTurn: ctx.host.state.tornado.endsAfterTurn }, 'what the guest holds');
  const full = spectatorCopies(ctx, 'state');
  assert.deepEqual(full.at(-1).state.tornado.cells, CROSS, 'the spectators see the cross');
  assert.equal(full.at(-1).state.tornado.hidden, undefined);
  assert.ok(full.flatMap((m) => m.events).some((e) => e.type === 'tornadoAnnounced' && e.cells.length === 5), 'and its cast event');
  const guestEvents = ctx.ofType('state').flatMap((m) => m.events);
  assert.ok(guestEvents.some((e) => e.type === 'skillUsed' && e.skill === TORNADO_ZONE && e.target === null), 'the skillUsed stays, with no target');
});

test("a 'welcome' message: a guest that asks again gets the hidden copy", () => {
  const ctx = rooms();
  ctx.guestTransport.send({ type: 'join', from: 'guest' });
  const welcome = assertNothingLeaks(ctx, 'welcome').at(-1);
  assert.equal(welcome.masked, true);
  assert.equal(welcome.state.tornado.hidden, true);
  assert.deepEqual(spectatorCopies(ctx, 'welcome').at(-1).state.tornado.cells, CROSS);
});

test("a 'start' message: sent again with the hidden copy", () => {
  const ctx = rooms();
  ctx.guestTransport.send({ type: 'join', from: 'guest' });
  const start = assertNothingLeaks(ctx, 'start').at(-1);
  assert.equal(start.state.tornado.hidden, true);
});

test("a 'ping' message with a result: the forfeit result tells no cell", () => {
  const ctx = rooms();
  ctx.guestTransport.setMuted(true);
  ctx.clock.advance(PEER_TIMEOUT_MS + LEAVE_COUNTDOWN_S * 1000);
  assert.equal(ctx.host.phase, OVER);
  assert.notEqual(ctx.host.state.tornado, null, 'the trap was never fired');
  const withResult = assertNothingLeaks(ctx, 'ping').filter((m) => m.result);
  assert.ok(withResult.length > 0);
  assert.equal(withResult[0].result.reason, 'opponentLeft');
});

test("a 'rematch-status' message and the 'new-game' that follows tell no cell", () => {
  // A won game has no trap left (a win drops it), so this is the live path
  // of the two messages after a game in which a trap was cast; the table at
  // the end builds them with an unfired trap.
  const ctx = rooms();
  const guestMoves = [[0, 0], [2, 0], [4, 0], [6, 0]];
  const hostMoves = [[13, 14], [12, 14], [11, 14], [10, 14]];
  for (let i = 0; i < 4; i++) {
    ok(ctx.guest.place(...guestMoves[i]));
    ok(ctx.host.place(...hostMoves[i]));
  }
  assert.equal(ctx.host.phase, OVER);
  assert.equal(ctx.host.state.winner, X);
  ok({ ok: ctx.guest.requestRematch() });
  assertNothingLeaks(ctx, 'rematch-status');
  ok({ ok: ctx.host.requestRematch() });
  const fresh = assertNothingLeaks(ctx, 'new-game').at(-1);
  assert.equal(fresh.state.tornado, null, 'a rematch starts with no trap');
});

test("a 'rejected' message: the refusal of a guest action tells no cell", () => {
  const ctx = rooms();
  ctx.guest.place(14, 14); // a plant of the rabbit: sent, refused by the host
  const rejected = assertNothingLeaks(ctx, 'rejected').at(-1);
  assert.equal(rejected.error, 'That cell is not empty.');
  // The cross cells themselves are plain empty plots for the guest: planting there is no refusal.
  assert.equal(ctx.guest.place(4, 9).ok, true);
});

test("a 'leave' message tells no cell", () => {
  const ctx = rooms();
  ctx.host.close({ resign: true });
  const leave = assertNothingLeaks(ctx, 'leave').at(-1);
  assert.equal(leave.resign, true);
});

test("a 'seats' message sent while the trap waits tells no cell", () => {
  const ctx = rooms();
  ctx.guest.pick(ctx.guest.character); // a late request: the host answers with the seats
  const seats = ctx.ofType('seats');
  assert.ok(seats.length > 0);
  for (const message of seats) assert.equal(leaksCross(message), false);
});

// The messages that no live flow can send with an unfired trap (a new game
// starts with none; the seats are settled before the game) still go through
// the same filter of every host message: hostStateMessages with the host's
// true state.
for (const type of ['welcome', 'start', 'state', 'new-game']) {
  test(`hostStateMessages: a '${type}' message built with an unfired trap hides it from the guest only`, () => {
    const { state, events } = castAndPlant();
    const message = { type, to: 'guest', state, events, seq: 3, round: 1, from: 'host' };
    const [guestCopy, spectators, ...rest] = hostStateMessages(message, O, true, state);
    assert.deepEqual(rest, []);
    assert.equal(guestCopy.masked, true);
    assert.equal(leaksCross(guestCopy), false);
    assert.equal(spectators.spectatorsOnly, true);
    assert.deepEqual(spectators.state.tornado.cells, CROSS, 'the full state for the spectators');
    assert.equal(spectators.state, state);
  });
}

for (const [type, extra] of [['seats', { seats: { picks: {}, ready: {} }, guest: true }], ['ping', { seq: 4, handled: 2, result: { winner: X, reason: 'opponentLeft' } }], ['rematch-status', { round: 1, host: true, guest: false }], ['rejected', { error: 'That cell is not empty.', requestId: 2 }], ['leave', { resign: true }]]) {
  test(`hostStateMessages: a '${type}' message is sent as it is and carries no cell`, () => {
    const { state } = castAndPlant();
    const sent = hostStateMessages({ type, to: 'guest', from: 'host', ...extra }, O, true, state);
    assert.equal(sent.length, 1);
    assert.equal(leaksCross(sent[0]), false);
  });
}
