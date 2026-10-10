// Rematch protocol and newGame (docs/flow-design.md section 5): two rooms
// over the fake transport with a fake clock, and the pure newGame.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE, LEAVE_COUNTDOWN_S, PEER_TIMEOUT_MS } from '../src/config.js';
import { X, O, EMPTY, ROCK } from '../src/logic/board.js';
import { EARTH_BEAR, JADE_SERPENT, WIND_RABBIT } from '../src/logic/characters.js';
import { createInitialState, newGame } from '../src/logic/game.js';
import { PETRIFICATION, MUD_TRAP, TORNADO_ZONE, WIND_DASH } from '../src/logic/skills.js';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { COUNTDOWN, CONNECTED } from '../src/net/presence.js';
import { OVER, PLAYING, createGuestRoom, createHostRoom } from '../src/net/room.js';
import { createLocalGame } from '../src/ui/local-game.js';
import { pickAndReady } from './room-start.js';

// Host (Wind Rabbit, X, by default) and guest on one fake network and one
// fake clock, with the game already started.
function setup({ character = WIND_RABBIT, random } = {}) {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const hostTransport = network.connect();
  const host = createHostRoom({ transport: hostTransport, code: 'AB2C9', clock, random, id: 'host' });
  const guestTransport = network.connect();
  const guest = createGuestRoom({ transport: guestTransport, code: 'AB2C9', clock, id: 'guest' });
  const ctx = { clock, host, guest, hostTransport, guestTransport, hostEvents: [], guestEvents: [], hostStatus: [], guestStatus: [] };
  host.onEvent((e) => ctx.hostEvents.push(e));
  guest.onEvent((e) => ctx.guestEvents.push(e));
  host.onRematchStatus((s) => ctx.hostStatus.push(s));
  guest.onRematchStatus((s) => ctx.guestStatus.push(s));
  pickAndReady(host, guest, character); // both Ready: the host starts the game
  return ctx;
}

const ofType = (events, type) => events.filter((e) => e.type === type);
const sentOfType = (transport, type) => transport.sent.filter((m) => m.type === type);

// The host (X) wins with five in row 0; the guest (O) plays row 1.
function hostWins({ host, guest }) {
  for (let i = 0; i < 4; i++) {
    host.place(i, 0);
    guest.place(i, 1);
  }
  host.place(4, 0);
}

function finishedGame() {
  const ctx = setup();
  hostWins(ctx);
  assert.equal(ctx.host.phase, OVER);
  assert.equal(ctx.guest.phase, OVER);
  return ctx;
}

// Both ask, the host first.
function rematch({ host, guest }) {
  assert.equal(host.requestRematch(), true);
  assert.equal(guest.requestRematch(), true);
}

test('newGame equals the documented fresh state', () => {
  const empty = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
  assert.deepEqual(newGame(), {
    board: empty,
    characters: { [X]: 'windRabbit', [O]: 'earthBear' },
    currentPlayer: X,
    turn: 1,
    rocks: [],
    mud: [],
    sunk: [],
    pendingDash: null,
    tornado: null,
    skillLock: null,
    skillUsed: null,
    cooldowns: { [X]: { [WIND_DASH]: 0, [TORNADO_ZONE]: 0 }, [O]: { [MUD_TRAP]: 0, [PETRIFICATION]: 0 } },
    winner: null,
    winLine: null,
    draw: false,
  });
  assert.deepEqual(newGame(), createInitialState());
  assert.notEqual(newGame().board, newGame().board, 'every game gets its own board');
});

test('a rematch keeps the same characters and the same sides (sides by pick order)', () => {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const host = createHostRoom({ transport: network.connect(), code: 'AB2C9', clock, id: 'host' });
  const guest = createGuestRoom({ transport: network.connect(), code: 'AB2C9', clock, id: 'guest' });
  guest.pick(JADE_SERPENT); // the guest picks first: X
  host.pick(EARTH_BEAR);
  guest.ready();
  host.ready();
  const sides = { [X]: JADE_SERPENT, [O]: EARTH_BEAR };
  assert.deepEqual(host.state.characters, sides);
  assert.equal(guest.getView().you, X);
  // The guest (X) wins with five in row 0.
  for (let i = 0; i < 4; i++) {
    guest.place(i, 0);
    host.place(i, 1);
  }
  guest.place(4, 0);
  assert.equal(host.phase, OVER);
  rematch({ host, guest });
  assert.equal(host.round, 2);
  assert.deepEqual(host.state, newGame({ characters: sides }));
  assert.deepEqual(guest.state, host.state);
  assert.equal(guest.getView().you, X, 'the guest keeps X');
  assert.equal(host.getView().you, O, 'the host keeps O');
  assert.equal(guest.getView().character, JADE_SERPENT);
  assert.equal(host.getView().character, EARTH_BEAR);
  assert.equal(guest.getView().yourTurn, true, 'X moves first again');
});

test('the guest asks first: the host sees guest true and host false, no new game', () => {
  const ctx = finishedGame();
  const { host, guest, hostTransport } = ctx;
  assert.equal(guest.requestRematch(), true);
  assert.deepEqual(host.rematchStatus, { round: 1, host: false, guest: true, gone: false });
  assert.deepEqual(ctx.hostStatus, [{ round: 1, host: false, guest: true, gone: false }]);
  assert.deepEqual(ctx.guestStatus, [{ round: 1, host: false, guest: true, gone: false }]);
  assert.equal(sentOfType(hostTransport, 'new-game').length, 0);
  assert.equal(host.phase, OVER);
  assert.equal(guest.phase, OVER);
  assert.equal(host.round, 1);
});

test('the host asks first, then the guest: both get new-game with round 2 and a fresh state', () => {
  const ctx = finishedGame();
  const { host, guest, hostTransport } = ctx;
  assert.equal(host.requestRematch(), true);
  assert.deepEqual(ctx.guestStatus, [{ round: 1, host: true, guest: false, gone: false }]);
  assert.equal(host.phase, OVER);
  assert.equal(guest.requestRematch(), true);
  const sent = sentOfType(hostTransport, 'new-game');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].round, 2);
  assert.deepEqual(sent[0].state, newGame());
  assert.deepEqual(ofType(ctx.hostEvents, 'newGame'), [{ type: 'newGame', round: 2, state: newGame() }]);
  assert.deepEqual(ofType(ctx.guestEvents, 'newGame'), [{ type: 'newGame', round: 2, state: newGame() }]);
  for (const side of [host, guest]) {
    assert.equal(side.phase, PLAYING);
    assert.equal(side.round, 2);
    assert.deepEqual(side.state, newGame());
    assert.deepEqual(side.rematchStatus, { round: 2, host: false, guest: false, gone: false });
  }
  // Same sides, Wind Rabbit (X) moves first, and the game goes on.
  assert.equal(host.getView().you, X);
  assert.equal(guest.getView().you, O);
  assert.equal(host.getView().yourTurn, true);
  assert.equal(host.place(7, 7).ok, true);
  assert.equal(guest.place(8, 8).ok, true);
  assert.deepEqual(guest.state, host.state);
});

test('a rematch in phase playing is ignored', () => {
  const ctx = setup();
  const { host, guest, guestTransport, hostTransport } = ctx;
  assert.equal(host.requestRematch(), false);
  assert.equal(guest.requestRematch(), false);
  guestTransport.send({ type: 'rematch', to: 'host', from: 'guest', round: 1 });
  assert.deepEqual(host.rematchStatus, { round: 1, host: false, guest: false, gone: false });
  assert.equal(sentOfType(hostTransport, 'rematch-status').length, 0);
  assert.deepEqual(ctx.hostStatus, []);
  assert.equal(host.phase, PLAYING);
});

test('a rematch with a stale round is ignored', () => {
  const ctx = finishedGame();
  const { host, guestTransport, hostTransport } = ctx;
  for (const round of [0, 2, '1', undefined]) {
    guestTransport.send({ type: 'rematch', to: 'host', from: 'guest', round });
  }
  assert.deepEqual(host.rematchStatus, { round: 1, host: false, guest: false, gone: false });
  assert.equal(sentOfType(hostTransport, 'rematch-status').length, 0);
  assert.deepEqual(ctx.hostStatus, []);
});

test('duplicate rematch requests change nothing', () => {
  const ctx = finishedGame();
  const { host, guest, guestTransport, hostTransport } = ctx;
  guest.requestRematch();
  guest.requestRematch();
  guestTransport.send({ type: 'rematch', to: 'host', from: 'guest', round: 1 });
  assert.equal(sentOfType(hostTransport, 'rematch-status').length, 1);
  assert.deepEqual(ctx.hostStatus, [{ round: 1, host: false, guest: true, gone: false }]);
  assert.equal(host.phase, OVER);
  // A rematch from a new round needs both again: the host's second press is
  // a duplicate after the new game started.
  assert.equal(host.requestRematch(), true);
  assert.equal(host.requestRematch(), false);
  assert.equal(sentOfType(hostTransport, 'new-game').length, 1);
  assert.equal(host.round, 2);
});

test('after a forfeit a rematch request is ignored and the status shows gone', () => {
  const ctx = setup({ character: EARTH_BEAR });
  const { clock, host, guest, guestTransport, hostTransport } = ctx;
  guestTransport.setMuted(true);
  clock.advance(PEER_TIMEOUT_MS + LEAVE_COUNTDOWN_S * 1000);
  assert.equal(host.phase, OVER);
  assert.deepEqual(host.rematchStatus, { round: 1, host: false, guest: false, gone: true });
  assert.deepEqual(ctx.hostStatus, [{ round: 1, host: false, guest: false, gone: true }]);
  guestTransport.setMuted(false);
  guestTransport.send({ type: 'rematch', to: 'host', from: 'guest', round: 1 });
  assert.equal(host.requestRematch(), false);
  assert.equal(guest.requestRematch(), false, 'the guest took the forfeit result');
  assert.equal(guest.rematchStatus.gone, true);
  assert.deepEqual(host.rematchStatus, { round: 1, host: false, guest: false, gone: true });
  assert.equal(sentOfType(hostTransport, 'new-game').length, 0);
});

test('the guest leaves at over, then the host asks: nothing starts and gone is true', () => {
  const ctx = finishedGame();
  const { host, guest, hostTransport } = ctx;
  guest.requestRematch();
  guest.close();
  assert.deepEqual(host.rematchStatus, { round: 1, host: false, guest: false, gone: true }, 'flags cleared');
  assert.equal(host.requestRematch(), false);
  assert.equal(host.phase, OVER);
  assert.deepEqual(host.rematchStatus, { round: 1, host: false, guest: false, gone: true });
  assert.equal(sentOfType(hostTransport, 'new-game').length, 0);
  assert.deepEqual(ctx.hostStatus.at(-1), { round: 1, host: false, guest: false, gone: true });
});

test('a silent guest in over makes gone true for good', () => {
  const ctx = finishedGame();
  const { clock, host, guest, guestTransport } = ctx;
  guestTransport.setMuted(true);
  clock.advance(PEER_TIMEOUT_MS);
  assert.equal(host.rematchStatus.gone, true);
  guestTransport.setMuted(false);
  clock.advance(PEER_TIMEOUT_MS);
  guest.requestRematch();
  assert.equal(host.requestRematch(), false);
  assert.equal(host.rematchStatus.gone, true);
  assert.equal(host.phase, OVER);
});

test('after a rematch the heartbeat and the leave countdown work again', () => {
  const ctx = finishedGame();
  const { clock, host, guestTransport } = ctx;
  clock.advance(5000);
  rematch(ctx);
  const peersBefore = ofType(ctx.hostEvents, 'peer').length;
  guestTransport.setMuted(true);
  clock.advance(PEER_TIMEOUT_MS - 1);
  assert.equal(host.getView().peer.status, CONNECTED);
  clock.advance(1);
  assert.deepEqual(host.getView().peer, { status: COUNTDOWN, secondsLeft: LEAVE_COUNTDOWN_S });
  assert.equal(ofType(ctx.hostEvents, 'peer').length, peersBefore + 1);
  clock.advance(LEAVE_COUNTDOWN_S * 1000);
  assert.deepEqual(host.getView().result, { winner: X, reason: 'opponentLeft' });
  assert.equal(host.phase, OVER);
  assert.equal(host.rematchStatus.gone, true);
});

test('two rematches in a row give rounds 2 and 3', () => {
  const ctx = finishedGame();
  const { host, guest, hostTransport } = ctx;
  rematch(ctx);
  assert.equal(host.round, 2);
  hostWins(ctx);
  assert.equal(host.phase, OVER);
  assert.deepEqual(host.rematchStatus, { round: 2, host: false, guest: false, gone: false });
  ctx.guestTransport.send({ type: 'rematch', to: 'host', from: 'guest', round: 1 }); // the old round
  assert.equal(host.rematchStatus.guest, false);
  rematch(ctx);
  assert.equal(host.round, 3);
  assert.equal(guest.round, 3);
  assert.deepEqual(sentOfType(hostTransport, 'new-game').map((m) => m.round), [2, 3]);
  assert.deepEqual(guest.state, newGame());
});

test('a lost new-game is recovered through the host ping', () => {
  const ctx = finishedGame();
  const { clock, host, guest, hostTransport } = ctx;
  host.requestRematch();
  hostTransport.setMuted(true);
  guest.requestRematch();
  assert.equal(host.phase, PLAYING);
  assert.equal(guest.phase, OVER);
  hostTransport.setMuted(false);
  clock.advance(1000);
  assert.equal(guest.phase, PLAYING);
  assert.equal(guest.round, 2);
  assert.deepEqual(guest.state, host.state);
});

test('a lost new-game followed by a host move still brings the guest into the new round', () => {
  const ctx = finishedGame();
  const { clock, host, guest, hostTransport } = ctx;
  host.requestRematch();
  hostTransport.setMuted(true);
  guest.requestRematch();
  hostTransport.setMuted(false);
  assert.equal(host.place(7, 7).ok, true); // reaches the guest before any ping
  assert.equal(guest.phase, OVER);
  assert.equal(guest.round, 1);
  assert.notDeepEqual(guest.state, host.state, 'a board of the later round waits for new-game');
  clock.advance(1000);
  assert.equal(guest.phase, PLAYING);
  assert.equal(guest.round, 2);
  assert.deepEqual(guest.state, host.state);
  assert.equal(guest.place(8, 8).ok, true);
  assert.deepEqual(guest.state, host.state);
});

test('a lost new-game is recovered even when the welcome of the resync gets through alone', () => {
  const ctx = finishedGame();
  const { clock, host, guest, hostTransport } = ctx;
  host.requestRematch();
  hostTransport.setMuted(true);
  guest.requestRematch();
  host.place(7, 7);
  // The next resync: the welcome arrives, its new-game is lost.
  const send = hostTransport.send;
  let dropped = 0;
  hostTransport.send = (message) => {
    if (message.type === 'new-game' && dropped === 0) {
      dropped += 1;
      return;
    }
    send(message);
  };
  hostTransport.setMuted(false);
  clock.advance(1000);
  assert.equal(dropped, 1);
  assert.equal(guest.phase, OVER);
  assert.equal(guest.round, 1);
  clock.advance(1000);
  assert.equal(guest.phase, PLAYING);
  assert.equal(guest.round, 2);
  assert.deepEqual(guest.state, host.state);
});

test('a lost guest request is sent again with the host ping', () => {
  const ctx = finishedGame();
  const { clock, host, guest, guestTransport } = ctx;
  guestTransport.setMuted(true);
  guest.requestRematch();
  guestTransport.setMuted(false);
  assert.equal(host.rematchStatus.guest, false);
  clock.advance(1000);
  assert.equal(host.rematchStatus.guest, true);
  assert.equal(guest.rematchStatus.guest, true);
});

test('skills of game 1 leave nothing in game 2', () => {
  const ctx = setup({ character: WIND_RABBIT, random: () => 0 });
  const { host, guest } = ctx;
  const ok = (result) => assert.equal(result.ok, true, result.error);
  ok(host.place(12, 12)); // T1
  ok(guest.useSkill(PETRIFICATION, { x: 12, y: 12 })); // T2: a skill does not end the turn
  ok(guest.place(14, 10)); // the planting that ends T2
  ok(host.place(6, 2));
  ok(guest.place(0, 5));
  ok(host.useSkill(TORNADO_ZONE, { x: 7, y: 7 })); // T5
  ok(host.place(0, 0));
  assert.ok(host.state.tornado);
  ok(guest.place(0, 6));
  ok(host.place(1, 0));
  ok(guest.place(0, 7));
  ok(host.place(2, 0));
  ok(guest.place(14, 14));
  ok(host.place(3, 0));
  ok(guest.place(14, 12));
  ok(host.place(13, 13));
  ok(guest.useSkill(MUD_TRAP, { x: 10, y: 10 })); // T14
  ok(guest.place(14, 8));
  ok(host.useSkill(WIND_DASH, { from: { x: 6, y: 2 }, to: { x: 4, y: 0 } })); // T15
  assert.ok(host.state.pendingDash);
  ok(host.place(13, 11));
  ok(guest.place(13, 14)); // the dash resolves into five in a row
  const ended = host.state;
  assert.equal(ended.winner, X);
  assert.equal(host.phase, OVER);
  assert.equal(ended.board[12][12], ROCK);
  assert.deepEqual(ended.rocks, [{ x: 12, y: 12 }]);
  assert.equal(ended.mud.length, 1, 'the puddle is still wet when the game ends');
  assert.ok(ended.cooldowns[X][WIND_DASH] > 0);
  assert.ok(ended.cooldowns[O][MUD_TRAP] > 0);

  rematch(ctx);
  for (const side of [host, guest]) {
    const { state } = side;
    assert.deepEqual(state, newGame());
    assert.deepEqual(state.rocks, []);
    assert.deepEqual(state.mud, []);
    assert.deepEqual(state.sunk, []);
    assert.equal(state.pendingDash, null);
    assert.equal(state.tornado, null);
    assert.equal(state.board[12][12], EMPTY);
    for (const player of [X, O]) {
      assert.ok(Object.values(state.cooldowns[player]).every((left) => left === 0));
    }
  }
  ok(host.useSkill(TORNADO_ZONE, { x: 7, y: 7 }));
});

test('local mode: rematchLocal starts a new game at once', () => {
  const game = createLocalGame();
  for (let i = 0; i < 4; i++) {
    game.click({ x: i, y: 0 });
    game.click({ x: i, y: 1 });
  }
  game.click({ x: 4, y: 0 });
  assert.equal(game.getState().winner, X);
  game.rematchLocal();
  assert.deepEqual(game.getState(), newGame());
  assert.equal(game.getView().message, null);
});
