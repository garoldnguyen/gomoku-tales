// Cloud Eagle part 2: hidden cloud contents (docs/design.md section 6). A
// stone or rock under a cloud is seen only by the seat that owns the
// cloud: maskForViewer, the host's messages (a masked copy for the guest,
// the full state marked spectatorsOnly for the spectators), the relay's
// routing, the spectator room, the rooms of both players and local mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY, HIDDEN as TAKEN, ROCK, X, O } from '../src/logic/board.js';
import { CLOUD_EAGLE, EARTH_BEAR, assignSides } from '../src/logic/characters.js';
import { newGame, placeStone, useSkill } from '../src/logic/game.js';
import { CLOUD } from '../src/logic/skills.js';
import { COVERED_ERROR, cloudCells, coveredActionError, isCovered, localViewEvents, localViewState, maskErrorForViewer, maskEventsForViewer, maskForViewer } from '../src/logic/cloud.js';
import { LEAVE_COUNTDOWN_S, PEER_TIMEOUT_MS } from '../src/config.js';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { OVER, PLAYING, createGuestRoom, createHostRoom, hostStateMessages } from '../src/net/room.js';
import { createOnlineGame } from '../src/ui/online-game.js';
import { pickAndReady } from './room-start.js';
import { createSpectatorRoom } from '../src/net/spectator-room.js';
import { createWebSocketTransport } from '../src/net/ws-transport.js';
import { createBroadcastTransport } from '../src/net/transport.js';
import { createLocalGame } from '../src/ui/local-game.js';
import { startTargeting, targetClick, targetPreview } from '../src/ui/targeting.js';
import { PETRIFICATION, MUD_TRAP } from '../src/logic/skills.js';
import { SNAPSHOT_TYPES, forwardFrame, keepsSnapshot, routeFor, snapshotFor } from '../worker/pairing.js';

function ok(result) {
  assert.equal(result.ok, true, result.error);
  return result;
}

// Cloud Eagle picked first (X, the host) against Earth Bear (O, the guest).
function eagleGame() {
  return newGame({ characters: assignSides([CLOUD_EAGLE, EARTH_BEAR]) });
}

// player puts a cloud on target (default (7, 7)) and plants a seed far away
// to end the turn: a skill does not end it any more (Free Action). Returns
// { state, events } of both steps.
function cloudThenPlant(state, player, plant = { x: 14, y: 14 }, target = { x: 7, y: 7 }) {
  const used = ok(useSkill(state, { player, skill: CLOUD, target }));
  const planted = ok(placeStone(used.state, { player, x: plant.x, y: plant.y }));
  return { state: planted.state, events: [...used.events, ...planted.events] };
}

// X puts a cloud on (7, 7) and plants far away, O plays far away, X plays
// (7, 7) under its cloud.
function hiddenStoneGame() {
  let state = cloudThenPlant(eagleGame(), X).state;
  state = ok(placeStone(state, { player: O, x: 0, y: 0 })).state;
  return ok(placeStone(state, { player: X, x: 7, y: 7 }));
}

// The plants and rocks a board shows under the cells: a covered plot that
// is taken reads TAKEN (HIDDEN) (taken, not by what), which is no stone.
function stonesUnder(state, cells) {
  return cells.filter(({ x, y }) => [X, O, ROCK].includes(state.board[y][x]));
}

test('maskForViewer: the owner of the cloud sees everything', () => {
  const { state } = hiddenStoneGame();
  assert.equal(maskForViewer(state, X), state);
  assert.equal(maskForViewer(state, X).board[7][7], X);
});

test('maskForViewer: the other seat sees the cloud cells covered, with no stone', () => {
  const { state } = hiddenStoneGame();
  const masked = maskForViewer(state, O);
  const cells = cloudCells(state.board, state.clouds[0]);
  assert.notEqual(masked, state);
  assert.equal(masked.board[7][7], TAKEN, 'taken, not by what or whose');
  assert.deepEqual(masked.covered, cells);
  assert.equal(isCovered(masked, 7, 7), true);
  assert.equal(isCovered(masked, 0, 0), false);
  assert.equal(masked.board[0][0], O, 'cells outside the cloud are shown');
  assert.deepEqual(stonesUnder(masked, cells), []);
  // The true state is not changed, and the cloud itself is no secret.
  assert.equal(state.board[7][7], X);
  assert.equal(state.covered, undefined);
  assert.deepEqual(masked.clouds, state.clouds);
});

test('maskForViewer: a rock under the cloud is covered too', () => {
  const { state } = hiddenStoneGame();
  const board = state.board.map((row) => row.slice());
  board[6][8] = ROCK;
  const withRock = { ...state, board, rocks: [{ x: 8, y: 6 }, { x: 0, y: 14 }] };
  withRock.board[14][0] = ROCK;
  const masked = maskForViewer(withRock, O);
  assert.equal(masked.board[6][8], TAKEN, 'a rock reads taken too');
  assert.deepEqual(masked.rocks, [{ x: 0, y: 14 }]);
  assert.equal(masked.board[14][0], ROCK);
});

test('maskForViewer: a spectator, or no seat, sees the full state', () => {
  const { state } = hiddenStoneGame();
  assert.equal(maskForViewer(state, null), state);
  assert.equal(maskForViewer(state, 'spectator'), state);
  assert.equal(maskForViewer(state, undefined), state);
});

test('maskForViewer: without a cloud nothing is covered; a game over is no exception', () => {
  const plain = eagleGame();
  assert.equal(maskForViewer(plain, O), plain);
  const { state } = hiddenStoneGame();
  // The cells stay hidden until the cloud ends, also after the game ended.
  assert.equal(maskForViewer({ ...state, winner: X }, O).board[7][7], TAKEN);
  assert.equal(maskForViewer({ ...state, draw: true }, O).board[7][7], TAKEN);
  assert.equal(maskForViewer({ ...state, winner: X }, X).board[7][7], X);
  assert.equal(maskForViewer(null, O), null);
});

test('maskEventsForViewer leaves out the move under the cloud, never the cloud itself', () => {
  const placed = ok(useSkill(eagleGame(), { player: X, skill: CLOUD, target: { x: 7, y: 7 } }));
  assert.equal(maskEventsForViewer(maskForViewer(placed.state, O), placed.events), placed.events);
  const { state, events } = hiddenStoneGame();
  const seen = maskEventsForViewer(maskForViewer(state, O), events);
  assert.ok(events.some((e) => e.type === 'stonePlaced' && e.x === 7 && e.y === 7));
  assert.equal(seen.some((e) => e.type === 'stonePlaced'), false);
  assert.ok(seen.some((e) => e.type === 'turnEnded'));
  assert.equal(maskEventsForViewer(state, events), events, 'an unmasked state leaves every event');
});

// X wins with a line of five whose cells (5, 7) and (6, 7) lie under X's
// cloud on (7, 7): the win does not tell O where the hidden stones are.
function hiddenWinGame() {
  let state = cloudThenPlant(eagleGame(), X).state;
  for (const [ox, x] of [[0, 2], [2, 3], [4, 5], [6, 6]]) {
    state = ok(placeStone(state, { player: O, x: ox, y: 0 })).state;
    state = ok(placeStone(state, { player: X, x, y: 7 })).state;
  }
  return state;
}

test('a winning line under the other seat\'s cloud does not tell the hidden stones', () => {
  let state = hiddenWinGame();
  // Two turns of X ticked the cloud away; put it back for the winning move.
  state = { ...state, clouds: [{ x: 7, y: 7, owner: X, turnsLeft: 2, placedTurn: state.turn }] };
  state = ok(placeStone(state, { player: O, x: 8, y: 0 })).state;
  const won = ok(placeStone(state, { player: X, x: 4, y: 7 }));
  assert.equal(won.state.winner, X);
  assert.equal(won.state.winLine.length, 5);
  const hidden = (cell) => cell.x >= 5 && cell.x <= 9 && cell.y >= 5 && cell.y <= 9;
  assert.ok(won.state.winLine.some(hidden), 'the true line runs under the cloud');

  const forO = maskForViewer(won.state, O);
  assert.equal(forO.board[7][5], TAKEN);
  assert.equal(forO.board[7][6], TAKEN);
  assert.equal(forO.winLine.some(hidden), false);
  assert.equal(forO.winLine.length, 3);
  const winEvent = maskEventsForViewer(forO, won.events).find((e) => e.type === 'win');
  assert.equal(winEvent.player, X);
  assert.equal(winEvent.line.some(hidden), false);

  // The owner sees the whole line.
  assert.equal(maskForViewer(won.state, X), won.state);

  // The guest copy carries neither; the spectators get the full line.
  const message = { type: 'state', to: 'guest', state: won.state, events: won.events, seq: 9 };
  const [guestCopy, spectators] = hostStateMessages(message, O, true);
  // covered names every cloud cell (the cloud is no secret); nothing else
  // may name a hidden stone.
  const sent = JSON.stringify({ ...guestCopy, state: { ...guestCopy.state, covered: null } });
  assert.equal(guestCopy.state.winLine.some(hidden), false);
  assert.equal(guestCopy.events.find((e) => e.type === 'win').line.some(hidden), false);
  assert.ok(!sent.includes('"x":5,"y":7') && !sent.includes('"x":6,"y":7'), 'no hidden cell is named anywhere');
  assert.equal(spectators.state.winLine.length, 5);
});

test('hostStateMessages: one unchanged message when nothing is hidden', () => {
  const message = { type: 'state', to: 'guest', state: eagleGame(), events: [], seq: 1 };
  assert.deepEqual(hostStateMessages(message, O, true), [message]);
  assert.equal(hostStateMessages(message, O, true)[0], message);
});

test('hostStateMessages: a masked copy for the guest, the full state for the spectators only', () => {
  const { state, events } = hiddenStoneGame();
  const message = { type: 'state', to: 'guest', state, events, seq: 4, handled: 0, round: 1 };
  const [guestCopy, spectators, ...rest] = hostStateMessages(message, O, true);
  assert.deepEqual(rest, []);
  assert.equal(guestCopy.masked, true);
  assert.equal(guestCopy.spectatorsOnly, undefined);
  assert.equal(guestCopy.state.board[7][7], TAKEN);
  assert.equal(guestCopy.events.some((e) => e.type === 'stonePlaced'), false);
  assert.equal(guestCopy.seq, 4);
  assert.equal(spectators.spectatorsOnly, true);
  assert.equal(spectators.masked, undefined);
  assert.equal(spectators.state, state);
  assert.equal(spectators.events, events);
  // Without a relay (broadcast) there are no spectators: only the guest copy.
  assert.deepEqual(hostStateMessages(message, O, false), [guestCopy]);
});

test('relay routing: spectatorsOnly host messages go to the spectators only', () => {
  assert.deepEqual(routeFor('host', { type: 'state' }), ['guest', 'spectator']);
  assert.deepEqual(routeFor('host', { type: 'state', spectatorsOnly: true }), ['spectator']);
  assert.deepEqual(routeFor('host', { type: 'state', spectatorsOnly: 'yes' }), ['guest', 'spectator']);
  assert.deepEqual(routeFor('guest', { type: 'action', spectatorsOnly: true }), ['host']);
  assert.deepEqual(routeFor('spectator', { type: 'state' }), []);
  assert.equal(keepsSnapshot('host', { type: 'state' }), true);
  assert.equal(keepsSnapshot('host', { type: 'state', spectatorsOnly: true }), true);
  assert.equal(keepsSnapshot('host', { type: 'state', masked: true }), false);
  assert.equal(keepsSnapshot('host', { type: 'ping' }), false);
  assert.equal(keepsSnapshot('guest', { type: 'state' }), false);
});

// Fake sockets of one room, like worker/room.js uses them.
function fakeSockets() {
  const socket = () => ({ frames: [], send(raw) { this.frames.push(raw); } });
  const sockets = { host: [socket()], guest: [socket()], spectator: [socket(), socket()] };
  const snapshot = {};
  const relay = (role, message) => {
    const raw = JSON.stringify(message);
    if (forwardFrame(role, raw, message, (to) => sockets[to])) snapshot[message.type] = raw;
  };
  return { sockets, snapshot, relay };
}

test('forwardFrame passes frames to fake sockets by role', () => {
  const { sockets, snapshot, relay } = fakeSockets();
  relay('host', { type: 'state', seq: 1, from: 'h' });
  relay('host', { type: 'state', seq: 1, spectatorsOnly: true, from: 'h' });
  relay('guest', { type: 'action', from: 'g' });
  assert.deepEqual(sockets.guest[0].frames.map((f) => JSON.parse(f).spectatorsOnly ?? false), [false]);
  for (const spectator of sockets.spectator) assert.equal(spectator.frames.length, 2);
  assert.deepEqual(sockets.host[0].frames.map((f) => JSON.parse(f).type), ['action']);
  assert.equal(JSON.parse(snapshot.state).spectatorsOnly, true);
});

test('through the relay the guest never receives a hidden stone, and gets the reveal after the cloud ends', () => {
  const { sockets, snapshot, relay } = fakeSockets();
  let seq = 0;
  let state = eagleGame();
  const shown = []; // the cells each cloud covered for the guest
  const send = (result) => {
    state = result.state;
    seq += 1;
    for (const message of hostStateMessages({ type: 'state', to: 'guest', state, events: result.events, seq, from: 'h' }, O, true)) relay('host', message);
    for (const c of state.clouds ?? []) shown.push(...cloudCells(state.board, c));
  };
  send(ok(useSkill(state, { player: X, skill: CLOUD, target: { x: 7, y: 7 } }))); // turn 1, X: the cloud
  send(ok(placeStone(state, { player: X, x: 13, y: 13 }))); // 1, X plants, which ends the turn
  send(ok(placeStone(state, { player: O, x: 0, y: 0 }))); // 2, O
  send(ok(placeStone(state, { player: X, x: 7, y: 7 }))); // 3, X under its cloud
  send(ok(placeStone(state, { player: O, x: 1, y: 0 }))); // 4, O
  assert.equal(state.clouds.length, 1, 'the cloud is still up');
  // The guest got every state, none with a stone under the cloud.
  const guestFrames = sockets.guest[0].frames.map((f) => JSON.parse(f));
  assert.equal(guestFrames.length, 5);
  for (const frame of guestFrames) {
    assert.notEqual(frame.spectatorsOnly, true);
    assert.notEqual(frame.state.board[7][7], X, 'never the hidden stone itself');
    assert.equal(sockets.guest[0].frames.some((f) => JSON.parse(f).events.some((e) => e.type === 'stonePlaced' && e.x === 7)), false);
  }
  // The spectators have the full state, live and in the replay.
  const last = JSON.parse(sockets.spectator[0].frames.at(-1));
  assert.equal(last.spectatorsOnly, true);
  assert.equal(last.state.board[7][7], X);
  const replay = snapshotFor(snapshot).map((t) => JSON.parse(t)).find((m) => m.type === 'state');
  assert.equal(replay.state.board[7][7], X);
  assert.ok(SNAPSHOT_TYPES.includes('state'));

  send(ok(placeStone(state, { player: X, x: 14, y: 14 }))); // 5, X: the cloud ends
  assert.deepEqual(state.clouds, []);
  const reveal = JSON.parse(sockets.guest[0].frames.at(-1));
  assert.equal(reveal.masked, undefined);
  assert.equal(reveal.state.board[7][7], X, 'the guest sees the revealed stone');
  assert.ok(reveal.events.some((e) => e.type === 'cloudEnded'));
});

test('the rooms of the players drop spectatorsOnly messages', () => {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const host = network.connect();
  const guest = createGuestRoom({ transport: network.connect(), code: 'AB2C9', clock, id: 'guest' });
  const events = [];
  guest.onEvent((event) => events.push(event.type));
  const welcome = { type: 'welcome', to: 'guest', from: 'host', seats: guest.getView().seats, state: null, seq: 0, handled: 0, result: null, round: 0 };
  host.send({ ...welcome, spectatorsOnly: true });
  assert.equal(events.includes('joined'), false);
  host.send(welcome);
  assert.equal(events.includes('joined'), true);
  guest.close();
});

test('a spectator reads the full state, never the masked copy', () => {
  const network = createFakeNetwork();
  const host = network.connect();
  const spectator = createSpectatorRoom({ transport: network.connect(), code: 'AB2C9' });
  const { state, events } = hiddenStoneGame();
  const messages = hostStateMessages({ type: 'state', to: 'guest', state, events, seq: 3, round: 1, from: 'host' }, O, true);
  host.send(messages[0]); // the guest's masked copy
  assert.equal(spectator.state, null);
  host.send(messages[1]); // the full state, spectatorsOnly
  assert.equal(spectator.state.board[7][7], X);
  host.send({ ...messages[0], seq: 4 });
  assert.equal(spectator.state.board[7][7], X, 'a later masked copy does not replace it');
  spectator.close();
});

test('the relay transport reaches spectators, the broadcast transport does not', () => {
  class FakeSocket {
    send() {}
    close() {}
  }
  const ws = createWebSocketTransport('AB2C9', 'host', { WebSocketImpl: FakeSocket, location: { protocol: 'http:', host: 'x' } });
  assert.equal(ws.reachesSpectators, true);
  class FakeChannel {
    postMessage() {}
    close() {}
  }
  const bc = createBroadcastTransport('AB2C9', { BroadcastChannelImpl: FakeChannel });
  assert.notEqual(bc.reachesSpectators, true);
  ws.close();
  bc.close();
});

test('local mode: the cloud cells are covered while the other seat moves, the owner turn shows everything', () => {
  const { state } = hiddenStoneGame();
  assert.equal(state.currentPlayer, O);
  const seenByO = localViewState(state);
  assert.equal(seenByO.board[7][7], TAKEN);
  assert.equal(isCovered(seenByO, 7, 7), true);
  const xTurn = ok(placeStone(state, { player: O, x: 3, y: 0 })).state;
  assert.equal(xTurn.currentPlayer, X);
  assert.equal(localViewState(xTurn), xTurn);
  assert.equal(localViewState(xTurn).board[7][7], X);
});

// The skill buttons and targeting of the screens do not know Cloud yet
// (part 3), so this checks the wiring: getView draws localViewState.
test('local game: getView draws localViewState of the true state', () => {
  const game = createLocalGame({ characters: assignSides([CLOUD_EAGLE, EARTH_BEAR]) });
  game.click({ x: 7, y: 7 });
  const view = game.getView();
  assert.equal(view.state, localViewState(game.getState()));
  assert.equal(game.getView().state, view.state, 'the same object while nothing changes');
  assert.equal(view.state.board[7][7], X);
});

test('local mode: a move under the cloud plays no effect for the other seat', () => {
  const { state, events } = hiddenStoneGame();
  const seen = localViewEvents(state, events);
  assert.equal(seen.some((e) => e.type === 'stonePlaced'), false);
  assert.ok(seen.some((e) => e.type === 'turnEnded'));
  // On the owner's turn every event is shown.
  const placed = ok(placeStone(state, { player: O, x: 3, y: 0 }));
  assert.equal(localViewEvents(placed.state, placed.events), placed.events);
});

test('local mode: the target preview and click read the drawn board, not the hidden stone', () => {
  const { state } = hiddenStoneGame();
  const shown = localViewState(state);
  const petrify = startTargeting(PETRIFICATION);
  assert.deepEqual(targetPreview(state, O, petrify, { x: 7, y: 7 }), { type: 'select', x: 7, y: 7 }, 'the true state would tell');
  assert.equal(targetPreview(shown, O, petrify, { x: 7, y: 7 }), null);
  assert.ok(targetClick(shown, O, petrify, { x: 7, y: 7 }).error);
  const mud = startTargeting(MUD_TRAP);
  assert.equal(targetPreview(shown, O, mud, { x: 7, y: 7 }), null, 'a taken covered plot takes no mud');
  assert.ok(targetClick(shown, O, mud, { x: 7, y: 7 }).error);
  assert.deepEqual(targetPreview(shown, O, mud, { x: 6, y: 6 }), { type: 'select', x: 6, y: 6 }, 'an empty covered plot reads empty');
});

// EVERY HOST MESSAGE TO THE GUEST is masked: a real host room (Cloud Eagle,
// X) and guest room (Earth Bear, O) on the fake network. The host's cloud
// on (7, 7) hides the X stone it plays on (8, 8); each kind of message the
// host sends the guest is checked: start, state, rejected, ping, the win,
// welcome with the result, rematch-status, new-game and the forfeit result.
const HIDDEN = { x: 8, y: 8 };
const PUBLIC_KEYS = new Set(['clouds', 'covered', 'cells']);

// Every cell under a cloud of X is empty or TAKEN in the message's state
// (never a plant or rock of a side), and no
// part of the message (outside the clouds themselves) names the hidden cell.
function assertNothingHidden(message) {
  const what = `${message.type} ${JSON.stringify(message).slice(0, 120)}`;
  const state = message.state;
  if (state?.board) {
    for (const c of (state.clouds ?? []).filter((each) => each.owner === X)) {
      for (const { x, y } of cloudCells(state.board, c)) assert.ok(state.board[y][x] === EMPTY || state.board[y][x] === TAKEN, `${what}: (${x}, ${y}) shown`);
    }
    for (const rock of state.rocks ?? []) assert.equal((state.clouds ?? []).some((c) => c.owner === X && Math.abs(rock.x - c.x) <= 2 && Math.abs(rock.y - c.y) <= 2), false, `${what}: a rock shown`);
  }
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value)) assert.equal(value.x === HIDDEN.x && value.y === HIDDEN.y && (state?.clouds ?? []).length > 0, false, `${what}: names the hidden cell`);
    for (const [key, each] of Object.entries(value)) if (!PUBLIC_KEYS.has(key)) walk(each);
  };
  walk(message);
}

function eagleRooms({ relay = false } = {}) {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const hostTransport = network.connect();
  if (relay) hostTransport.reachesSpectators = true;
  const makeGame = () => newGame({ characters: assignSides([CLOUD_EAGLE, EARTH_BEAR]) });
  const host = createHostRoom({ transport: hostTransport, code: 'AB2C9', clock, id: 'host', makeGame });
  const guestTransport = network.connect();
  const guest = createGuestRoom({ transport: guestTransport, code: 'AB2C9', clock, id: 'guest' });
  pickAndReady(host, guest);
  assert.equal(host.phase, PLAYING);
  assert.equal(host.state.characters[X], CLOUD_EAGLE);
  const guestBound = () => hostTransport.sent.filter((m) => m.spectatorsOnly !== true);
  const sentOfType = (type) => guestBound().filter((m) => m.type === type);
  return { clock, host, guest, hostTransport, guestTransport, guestBound, sentOfType };
}

// X lines up (6, 8), (7, 8), (9, 8), (10, 8), puts the cloud on (7, 7) and
// plays the hidden (8, 8): five in row 8, four of them under the cloud.
function playHiddenWin({ host, guest }, { win = true } = {}) {
  const moves = [[6, 8], [0, 0], [7, 8], [2, 0], [9, 8], [4, 0], [10, 8], [6, 0]];
  for (let i = 0; i < moves.length; i++) ok((i % 2 === 0 ? host : guest).place(...moves[i]));
  ok(host.useSkill(CLOUD, { x: 7, y: 7 }));
  ok(host.place(12, 12)); // the planting that ends the turn of the cloud
  ok(guest.place(8, 0));
  if (win) ok(host.place(HIDDEN.x, HIDDEN.y));
}

for (const relay of [false, true]) {
  const over = relay ? ' (relay)' : '';

  test(`host messages${over}: start and every state message carry no hidden stone`, () => {
    const ctx = eagleRooms({ relay });
    assert.equal(ctx.sentOfType('start').length, 1);
    playHiddenWin(ctx, { win: false });
    ok(ctx.host.place(13, 13)); // not under the cloud: the game goes on
    ok(ctx.guest.place(10, 0));
    ok(ctx.host.place(HIDDEN.x, HIDDEN.y)); // the win
    for (const message of ctx.guestBound()) assertNothingHidden(message);
    assert.ok(ctx.sentOfType('state').length >= 12);
    assert.equal(ctx.guest.state.board[HIDDEN.y][HIDDEN.x], TAKEN);
    assert.equal(ctx.host.state.board[HIDDEN.y][HIDDEN.x], X, 'the host keeps the true state');
    if (relay) assert.ok(ctx.hostTransport.sent.some((m) => m.spectatorsOnly === true && m.state.board[HIDDEN.y][HIDDEN.x] === X));
    else assert.equal(ctx.hostTransport.sent.some((m) => m.spectatorsOnly === true), false);
  });

  test(`host messages${over}: the win under the cloud tells only the uncovered cells`, () => {
    const ctx = eagleRooms({ relay });
    playHiddenWin(ctx);
    assert.equal(ctx.host.phase, OVER);
    assert.equal(ctx.guest.phase, OVER);
    const last = ctx.sentOfType('state').at(-1);
    assert.equal(last.masked, true);
    assert.equal(last.state.winner, X);
    assert.deepEqual(last.state.winLine, [{ x: 10, y: 8 }]);
    assert.deepEqual(last.events.find((e) => e.type === 'win').line, [{ x: 10, y: 8 }]);
    assert.equal(last.events.some((e) => e.type === 'stonePlaced'), false);
    for (const message of ctx.guestBound()) assertNothingHidden(message);
  });

  test(`host messages${over}: a plant refused on a taken covered plot is told only that it is taken`, () => {
    const ctx = eagleRooms({ relay });
    playHiddenWin(ctx, { win: false });
    ok(ctx.host.place(HIDDEN.x, HIDDEN.y - 4)); // (8, 4): outside, the game goes on
    const rejected = [];
    ctx.guest.onEvent((e) => e.type === 'rejected' && rejected.push(e.error));
    ok(ctx.guest.place(7, 8)); // a hidden X stone: sent, refused by the host
    const answer = ctx.sentOfType('rejected').at(-1);
    assert.equal(answer.error, 'That cell is not empty.');
    assert.deepEqual(rejected, ['That cell is not empty.']);
    for (const message of ctx.guestBound()) assertNothingHidden(message);
  });

  test(`host messages${over}: pings, welcome with the result, rematch-status and new-game carry no hidden stone`, () => {
    const ctx = eagleRooms({ relay });
    playHiddenWin(ctx);
    ctx.clock.advance(PEER_TIMEOUT_MS / 2); // heartbeat pings in over
    ctx.guestTransport.send({ type: 'join', from: 'guest' }); // the guest asks again: welcome (with result) and start
    const welcome = ctx.sentOfType('welcome').at(-1);
    assert.ok('result' in welcome);
    assert.equal(welcome.masked, true);
    assert.equal(welcome.state.board[HIDDEN.y][HIDDEN.x], TAKEN);
    assert.equal(ctx.sentOfType('start').at(-1).masked, true);
    assert.ok(ctx.sentOfType('ping').length > 0);
    ok({ ok: ctx.guest.requestRematch() });
    assert.ok(ctx.sentOfType('rematch-status').length > 0);
    ok({ ok: ctx.host.requestRematch() });
    const newGameMessage = ctx.sentOfType('new-game').at(-1);
    assert.ok(newGameMessage, 'the rematch started');
    assert.equal(newGameMessage.state.board[HIDDEN.y][HIDDEN.x], EMPTY);
    for (const message of ctx.guestBound()) assertNothingHidden(message);
  });

  test(`host messages${over}: the forfeit result in the pings carries no hidden stone`, () => {
    const ctx = eagleRooms({ relay });
    playHiddenWin(ctx, { win: false });
    ok(ctx.host.place(13, 13));
    ctx.guestTransport.setMuted(true);
    ctx.clock.advance(PEER_TIMEOUT_MS + LEAVE_COUNTDOWN_S * 1000);
    assert.equal(ctx.host.phase, OVER);
    const withResult = ctx.sentOfType('ping').filter((m) => m.result);
    assert.ok(withResult.length > 0);
    assert.equal(withResult[0].result.reason, 'opponentLeft');
    for (const message of ctx.guestBound()) assertNothingHidden(message);
  });
}

test('maskErrorForViewer: a refusal on a covered cell does not tell what it holds', () => {
  const { state } = hiddenStoneGame(); // X stone on (7, 7) under X's cloud
  const place = (x, y) => ({ kind: 'place', x, y });
  assert.equal(maskErrorForViewer(state, O, place(7, 7), 'That cell is taken.'), 'That cell is taken.', 'a plant: the plot shows taken anyway');
  assert.equal(maskErrorForViewer(state, O, { kind: 'skill', target: { x: 6, y: 6 } }, 'x'), COVERED_ERROR);
  assert.equal(maskErrorForViewer(state, O, { kind: 'skill', target: { from: { x: 0, y: 0 }, to: { x: 8, y: 8 } } }, 'x'), COVERED_ERROR);
  assert.equal(maskErrorForViewer(state, O, place(0, 0), 'That cell is taken.'), 'That cell is taken.');
  assert.equal(maskErrorForViewer(state, X, place(7, 7), 'That cell is taken.'), 'That cell is taken.', 'the owner hears the true error');
  assert.equal(maskErrorForViewer(state, null, place(7, 7), 'e'), 'e');
});

// The host's own skill clicks read the shown (masked) board too: Earth Bear
// hosts (X) against a Cloud Eagle guest (O) whose cloud hides an O stone.
test('online game: the host picks skill targets on the shown board, not the hidden stone', () => {
  let state = newGame({ characters: assignSides([EARTH_BEAR, CLOUD_EAGLE]) });
  state = ok(placeStone(state, { player: X, x: 0, y: 0 })).state;
  state = ok(placeStone(state, { player: O, x: 7, y: 7 })).state;
  state = ok(placeStone(state, { player: X, x: 1, y: 0 })).state;
  state = cloudThenPlant(state, O, { x: 14, y: 14 }).state; // an O stone in the open, after the cloud
  const used = [];
  const room = {
    state, // the true state, as the host room keeps it
    onEvent: () => () => {},
    getView: () => ({ state: maskForViewer(state, X), you: X, yourTurn: true, waiting: false, result: null }),
    useSkill: (skill, target) => {
      used.push(target);
      return { ok: true };
    },
  };
  const game = createOnlineGame(room);
  assert.equal(game.clickSkill(X, PETRIFICATION), true);
  assert.equal(game.click({ x: 7, y: 7 }), false, 'the hidden O stone cannot be picked');
  const hidden = game.getView().message;
  assert.equal(game.click({ x: 6, y: 6 }), false);
  assert.equal(game.getView().message, hidden, 'a hidden stone and an empty covered cell answer the same');
  game.setHover({ x: 7, y: 7 });
  assert.equal(game.getView().preview, null);
  assert.equal(game.click({ x: 14, y: 14 }), true, 'a stone in the open can be picked');
  assert.deepEqual(used, [{ x: 14, y: 14 }]);
});

// EVERY host message to the guest goes through hostStateMessages (and so
// through maskForViewer and maskEventsForViewer): one test per message
// type, over the broadcast transport and over the relay. Each scenario
// leaves X's hidden stones under the cloud on (7, 7) (playHiddenWin) and
// returns the guest-bound messages of its type.
const MESSAGE_SCENARIOS = {
  // The guest asks again mid-game: the host seats it again with the state.
  welcome: (ctx) => {
    playHiddenWin(ctx, { win: false });
    ctx.guestTransport.send({ type: 'join', from: 'guest' });
  },
  // The start resent with the welcome carries the current state.
  start: (ctx) => {
    playHiddenWin(ctx, { win: false });
    ctx.guestTransport.send({ type: 'join', from: 'guest' });
  },
  state: (ctx) => {
    playHiddenWin(ctx, { win: false });
    ok(ctx.host.place(13, 13));
  },
  // The win is a state message whose events hold the win.
  win: (ctx) => playHiddenWin(ctx),
  // The forfeit result goes out in the host's pings.
  result: (ctx) => {
    playHiddenWin(ctx, { win: false });
    ctx.guestTransport.setMuted(true);
    ctx.clock.advance(PEER_TIMEOUT_MS + LEAVE_COUNTDOWN_S * 1000);
  },
  ping: (ctx) => {
    playHiddenWin(ctx, { win: false });
    ctx.clock.advance(PEER_TIMEOUT_MS / 2);
  },
  rejected: (ctx) => {
    playHiddenWin(ctx, { win: false });
    ok(ctx.host.place(13, 13));
    ctx.guest.place(7, 8); // a hidden X stone
  },
  'rematch-status': (ctx) => {
    playHiddenWin(ctx);
    ok({ ok: ctx.guest.requestRematch() });
  },
  'new-game': (ctx) => {
    playHiddenWin(ctx);
    ok({ ok: ctx.guest.requestRematch() });
    ok({ ok: ctx.host.requestRematch() });
    ctx.guestTransport.send({ type: 'join', from: 'guest' }); // and the resend of the rematch
  },
};

const STATE_TYPES = new Set(['welcome', 'start', 'state', 'win']);

for (const relay of [false, true]) {
  const over = relay ? ' (relay)' : '';
  for (const [name, play] of Object.entries(MESSAGE_SCENARIOS)) {
    test(`every host message${over}: ${name} passes through the mask`, () => {
      const ctx = eagleRooms({ relay });
      play(ctx);
      const type = name === 'win' ? 'state' : name === 'result' ? 'ping' : name;
      let messages = ctx.sentOfType(type);
      if (name === 'win') messages = messages.filter((m) => m.events?.some((e) => e.type === 'win'));
      if (name === 'result') messages = messages.filter((m) => m.result);
      assert.ok(messages.length > 0, `a ${name} message was sent`);
      for (const message of messages) assertNothingHidden(message);
      const last = messages.at(-1);
      if (STATE_TYPES.has(name)) {
        // The mask covered the cloud: the guest's copy is the masked one.
        assert.equal(last.masked, true);
        assert.equal(last.state.board[8][7], TAKEN, 'taken, not by what');
        assert.equal(isCovered(last.state, 7, 8), true);
      }
      if (name === 'win') assert.deepEqual(last.events.find((e) => e.type === 'win').line, [{ x: 10, y: 8 }]);
      if (name === 'result') assert.deepEqual(Object.keys(last.result).sort(), ['reason', 'winner']);
      if (name === 'rejected') assert.equal(last.error, 'That cell is not empty.', 'a taken covered plot is refused like any taken plot');
      if (name === 'new-game') {
        assert.equal(last.round, 2);
        assert.deepEqual(last.state.clouds ?? [], []);
        for (const row of last.state.board) assert.ok(row.every((cell) => cell === EMPTY));
      }
      // The guest's room holds no hidden stone either.
      if (ctx.guest.state) assertNothingHidden({ type: 'guest view', state: ctx.guest.state });
      // Over the relay, only the spectatorsOnly copy carries the full state.
      if (!relay) assert.equal(ctx.hostTransport.sent.some((m) => m.spectatorsOnly === true), false);
    });
  }
}

test('hostStateMessages: events sent without a state are masked by the host\'s true state', () => {
  const { state, events } = hiddenStoneGame();
  const message = { type: 'state', to: 'guest', events, seq: 4 };
  const [guestCopy, spectators] = hostStateMessages(message, O, true, state);
  assert.equal(guestCopy.masked, true);
  assert.equal('state' in guestCopy, false);
  assert.equal(guestCopy.events.some((e) => e.type === 'stonePlaced'), false);
  assert.equal(spectators.spectatorsOnly, true);
  assert.equal(spectators.events, events);
  const plain = { type: 'ping', to: 'guest', seq: 4, result: { winner: X, reason: 'opponentLeft' } };
  assert.deepEqual(hostStateMessages(plain, O, true, state), [plain], 'a message with no cell goes out as it is');
});

test('coveredActionError: a plant may go into the other seat\'s cloud; a skill on a covered cell is refused whatever it holds', () => {
  const { state } = hiddenStoneGame(); // X stone on (7, 7) under X's cloud, (8, 8) empty under it
  assert.equal(coveredActionError(state, O, { kind: 'place', x: 7, y: 7 }), null, 'the rules answer: taken');
  assert.equal(coveredActionError(state, O, { kind: 'place', x: 8, y: 8 }), null);
  assert.equal(coveredActionError(state, O, { kind: 'skill', skill: PETRIFICATION, target: { x: 6, y: 6 } }), COVERED_ERROR);
  assert.equal(coveredActionError(state, O, { kind: 'skill', skill: PETRIFICATION, target: { x: 7, y: 7 } }), COVERED_ERROR);
  assert.equal(coveredActionError(state, O, { kind: 'skill', skill: CLOUD, target: { x: 7, y: 7 } }), null);
  assert.equal(coveredActionError(state, X, { kind: 'place', x: 8, y: 8 }), null, 'the owner plays under its own cloud');
});

for (const relay of [false, true]) {
  test(`the guest plants into the host's cloud${relay ? ' (relay)' : ''}: an empty covered plot takes the plant, a taken one is refused as taken`, () => {
    const ctx = eagleRooms({ relay });
    playHiddenWin(ctx, { win: false });
    ok(ctx.host.place(13, 13));
    const rejected = [];
    ctx.guest.onEvent((e) => e.type === 'rejected' && rejected.push(e.error));
    ctx.guest.place(7, 8); // a hidden X stone: the guest's board shows it taken
    assert.deepEqual(rejected, ['That cell is not empty.']);
    assert.equal(ctx.host.state.currentPlayer, O, 'the guest is still to move');
    ok(ctx.guest.place(8, 7)); // an empty covered plot
    assert.equal(ctx.host.state.board[7][8], O, 'the plant grows under the cloud');
    assert.equal(ctx.guest.state.board[7][8], TAKEN, 'and the guest sees it only as taken');
    for (const message of ctx.guestBound()) assertNothingHidden(message);
  });
}

test('local mode: the player not owning the cloud plants into its empty plots; a taken one is refused as taken', () => {
  // X's cloud on (7, 7) with an X stone under it; O is to move.
  const game = createLocalGame({ makeGame: () => hiddenStoneGame().state });
  assert.equal(game.getState().currentPlayer, O);
  assert.equal(game.getView().state.board[7][7], TAKEN);
  assert.equal(game.click({ x: 7, y: 7 }), false); // a hidden X stone
  assert.equal(game.getView().message, 'That cell is not empty.');
  assert.equal(game.click({ x: 8, y: 8 }), true); // an empty covered plot
  assert.equal(game.getState().board[8][8], O);
});

// --- Mud Trap (Free Action part 2): a puddle or a sunk seed under the other seat's cloud ---

// Turn 1 X plants far away, turn 2 O floods (7, 8) and plants, turn 3 X puts a
// cloud on (7, 7) (which covers (7, 8)) and plants. A puddle lies under the cloud.
function puddleUnderCloudGame() {
  let state = ok(placeStone(eagleGame(), { player: X, x: 14, y: 14 })).state;
  state = ok(useSkill(state, { player: O, skill: MUD_TRAP, target: { x: 7, y: 8 } })).state;
  state = ok(placeStone(state, { player: O, x: 0, y: 0 })).state;
  return cloudThenPlant(state, X, { x: 13, y: 13 });
}

// The next two turns: O plants far away, X plants into the puddle under its
// own cloud, so a seed of X is sunk at (7, 8).
function sunkUnderCloudGame() {
  const base = puddleUnderCloudGame();
  let state = ok(placeStone(base.state, { player: O, x: 1, y: 0 })).state;
  const sunk = ok(placeStone(state, { player: X, x: 7, y: 8 }));
  return sunk;
}

// A state with a puddle and a sunk seed under the cloud, and one of each outside it.
function mudAndSunkState() {
  const { state } = sunkUnderCloudGame();
  return {
    ...state,
    mud: [{ x: 7, y: 9, player: O, driesAfterTurn: 9 }, { x: 2, y: 2, player: O, driesAfterTurn: 9 }],
    sunk: [...state.sunk, { x: 3, y: 3, player: O, surfacesAfterTurn: 9 }],
  };
}

const MUD_AT_COVERED = { x: 7, y: 9 };
const SUNK_AT_COVERED = { x: 7, y: 8 };

function namesCell(value, { x, y }) {
  return JSON.stringify(value).includes(`"x":${x},"y":${y}`);
}

test('the mud test setup: the puddle and the sunk seed lie under the cloud of X', () => {
  const { state } = puddleUnderCloudGame();
  assert.equal(isCovered(maskForViewer(state, O), 7, 8), true);
  assert.deepEqual(state.mud.map(({ x, y }) => ({ x, y })), [{ x: 7, y: 8 }]);
  const sunk = sunkUnderCloudGame().state;
  assert.deepEqual(sunk.sunk.map(({ x, y, player }) => ({ x, y, player })), [{ x: 7, y: 8, player: X }]);
  assert.deepEqual(sunk.mud, []);
});

test('maskForViewer: a puddle under the other seat\'s cloud is not sent; the owner and the rest stay', () => {
  const { state } = puddleUnderCloudGame();
  const masked = maskForViewer(state, O);
  assert.deepEqual(masked.mud, [], 'the puddle on the covered plot is left out');
  assert.equal(masked.board[8][7], EMPTY, 'an empty covered plot still reads empty');
  assert.equal(maskForViewer(state, X), state, 'the owner of the cloud sees the puddle');
  assert.equal(maskForViewer(state, X).mud.length, 1);
  const mixed = maskForViewer(mudAndSunkState(), O);
  assert.deepEqual(mixed.mud, [{ x: 2, y: 2, player: O, driesAfterTurn: 9 }], 'a puddle outside the cloud stays');
});

test('maskForViewer: a sunk seed under the other seat\'s cloud is not sent; it reads as a taken plot', () => {
  const { state } = sunkUnderCloudGame();
  const masked = maskForViewer(state, O);
  assert.deepEqual(masked.sunk, [], 'the sunk entry on the covered plot is left out');
  assert.equal(masked.board[8][7], TAKEN, 'taken, not by what or whose');
  assert.equal(namesCell(masked.sunk, SUNK_AT_COVERED), false);
  assert.equal(maskForViewer(state, X), state, 'the owner of the cloud sees the sunk seed');
  const mixed = maskForViewer(mudAndSunkState(), O);
  assert.deepEqual(mixed.sunk, [{ x: 3, y: 3, player: O, surfacesAfterTurn: 9 }], 'a sunk seed outside the cloud stays');
});

test('maskEventsForViewer: the events of a covered puddle, sunk seed and petrified plant stay hidden', () => {
  const masked = maskForViewer(mudAndSunkState(), O);
  const covered = (type) => ({ type, player: X, x: 7, y: 8 });
  const outside = (type) => ({ type, player: O, x: 2, y: 2 });
  const types = ['mudPlaced', 'mudDried', 'stoneSunk', 'stoneSurfaced', 'stonePetrified'];
  for (const type of types) {
    assert.deepEqual(maskEventsForViewer(masked, [covered(type)]), [], `${type} on a covered plot is left out`);
    const open = [outside(type)];
    assert.equal(maskEventsForViewer(masked, open), open, `${type} outside the cloud stays`);
  }
  const used = { type: 'skillUsed', player: O, skill: MUD_TRAP, target: { x: 7, y: 8 } };
  assert.deepEqual(maskEventsForViewer(masked, [used, { type: 'turnEnded', player: O, turn: 4 }]).map((e) => e.type), ['turnEnded']);
});

// One test per host message type that carries a state: the guest's copy of
// it names no covered puddle and no covered sunk seed, the spectators' copy
// keeps them.
for (const type of ['state', 'welcome', 'start', 'new-game']) {
  test(`a '${type}' message: the covered puddle and sunk seed do not reach the guest, the spectators get them`, () => {
    const state = mudAndSunkState();
    const message = { type, to: 'guest', state, events: [], seq: 6, round: 1, from: 'host' };
    const [guestCopy, spectators, ...rest] = hostStateMessages(message, O, true);
    assert.deepEqual(rest, []);
    assert.equal(guestCopy.masked, true);
    assert.equal(guestCopy.type, type);
    assert.equal(namesCell(guestCopy.state.mud, MUD_AT_COVERED), false, 'no covered puddle');
    assert.equal(namesCell(guestCopy.state.sunk, SUNK_AT_COVERED), false, 'no covered sunk seed');
    assert.equal(guestCopy.state.mud.length, 1, 'the open puddle goes on');
    assert.equal(guestCopy.state.sunk.length, 1, 'the open sunk seed goes on');
    assert.equal(spectators.spectatorsOnly, true);
    assert.equal(spectators.state, state);
    assert.equal(namesCell(spectators.state.mud, MUD_AT_COVERED), true);
    assert.equal(namesCell(spectators.state.sunk, SUNK_AT_COVERED), true);
  });
}

test('a \'state\' message: the events of a covered puddle and sunk seed do not reach the guest either', () => {
  const state = mudAndSunkState();
  const events = [
    { type: 'mudPlaced', player: O, x: 7, y: 9, driesAfterTurn: 9 },
    { type: 'stoneSunk', player: X, x: 7, y: 8, surfacesAfterTurn: 6 },
    { type: 'stoneSurfaced', player: X, x: 7, y: 8 },
    { type: 'mudDried', player: O, x: 7, y: 9 },
    { type: 'stonePetrified', player: O, x: 7, y: 6, from: X },
    { type: 'turnEnded', player: X, turn: 5 },
  ];
  const [guestCopy] = hostStateMessages({ type: 'state', to: 'guest', state, events, seq: 6, round: 1 }, O, true);
  assert.deepEqual(guestCopy.events.map((e) => e.type), ['turnEnded']);
  // The state's `covered` list names the cloud's cells (no secret); the lists of mud, sunk seeds and events must not.
  const told = { mud: guestCopy.state.mud, sunk: guestCopy.state.sunk, events: guestCopy.events };
  assert.equal(namesCell(told, MUD_AT_COVERED), false, 'no covered puddle in the guest copy');
  assert.equal(namesCell(told, SUNK_AT_COVERED), false, 'no covered sunk seed in the guest copy');
});

test('a \'rejected\' message: a skill on a covered puddle or sunk seed is refused as covered, whatever it holds', () => {
  const { state } = sunkUnderCloudGame();
  const covered = { kind: 'skill', skill: PETRIFICATION, target: { x: 7, y: 8 } };
  assert.equal(coveredActionError(state, O, covered), COVERED_ERROR, 'a sunk seed is not named as sunk');
  assert.equal(maskErrorForViewer(state, O, covered, 'That plant is sunk in mud.'), COVERED_ERROR);
  const puddle = puddleUnderCloudGame().state;
  const flood = { kind: 'skill', skill: MUD_TRAP, target: { x: 7, y: 8 } };
  assert.equal(coveredActionError(puddle, O, flood), COVERED_ERROR, 'a puddle is not named as mud');
  assert.equal(maskErrorForViewer(puddle, O, flood, 'That cell is already mud.'), COVERED_ERROR);
  assert.equal(maskErrorForViewer(puddle, X, flood, 'That cell is already mud.'), 'That cell is already mud.', 'the owner may hear it');
});
