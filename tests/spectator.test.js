// Watch a match (docs/flow-design.md sections 3.8 and 3.9): a spectator
// joins a room through ws-transport as role spectator, sees the waiting
// room while the room has no game, then the live game with every input
// locked, never sends anything, is never in the presence countdown, and
// sees Room closed when the host leaves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as config from '../src/config.js';
import { O, X } from '../src/logic/board.js';
import { EARTH_BEAR, WIND_RABBIT } from '../src/logic/characters.js';
import { MUD_TRAP, WIND_DASH } from '../src/logic/skills.js';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { SPECTATOR_ERROR, createSpectatorRoom } from '../src/net/spectator-room.js';
import { createWebSocketTransport } from '../src/net/ws-transport.js';
import { SNAPSHOT_TYPES, snapshotFor, watchersOf } from '../worker/pairing.js';
import { UNWATCH as UNWATCH_TYPE, WATCH as WATCH_TYPE, audienceMessage } from '../src/net/audience.js';
import { GAME, MENU, ROOM_CLOSED_SCREEN, SPECTATE_SCREEN, WAITING_SCREEN, WATCH, createApp } from '../src/ui/app.js';
import { FLOW_EVENTS, NOTICE_ROOM_CLOSED, ROLES, SCREENS } from '../src/ui/flow.js';
import { SPECTATOR_VIEW, hudViewModel } from '../src/ui/hud-view.js';
import { BARS_HEIGHT, WATCH_SLIM_HEIGHT, boardScreenRect, hudLayout, watchCardBox } from '../src/ui/hud-layout.js';
import { MENU_BUTTONS } from '../src/ui/menu.js';
import { roomClosedViewModel, spectateViewModel, watchViewModel } from '../src/ui/room-screens.js';
import { spectatorOutcome, spectatorStatus } from '../src/ui/spectator-game.js';
import { STRINGS, withCode } from '../src/ui/strings.js';

const WEBSOCKET = { ...config, ONLINE_TRANSPORT: 'websocket' };
const LOCATION = { protocol: 'http:', host: 'localhost:8787' };
const CODE = 'AB2C9';

// A fake relay behind a fake WebSocketImpl, like worker/room.js: one host,
// one guest and any number of spectators per code. Host frames go to the
// guest and every spectator, guest frames to the host only; the last host
// frame of each SNAPSHOT_TYPES type is replayed to a new spectator; a
// spectator's watch or unwatch marks it and sends everyone the audience,
// its chat goes to everyone, and any other spectator frame closes that
// spectator (and is counted); when the host
// or guest socket closes, the other side (and, for the host, every
// spectator) gets a leave from the closed peer. Everything happens a
// microtask later, like a real socket.
function fakeRelay() {
  const rooms = new Map(); // code -> { host, guest, spectators: [], snapshot: {} }
  const sockets = [];
  const spectatorFrames = [];
  const watchFrames = []; // the watch and unwatch types the spectators sent
  const sendAudience = (room) => {
    const text = JSON.stringify(audienceMessage(watchersOf(room.spectators.map((s) => ({ watching: s.watching, peer: s.peer, name: s.name })))));
    for (const to of [room.host, room.guest, ...room.spectators]) if (to) deliver(to, text);
  };
  const deliver = (to, text) => queueMicrotask(() => {
    if (to.readyState !== 1) return;
    to.received.push(JSON.parse(text));
    to.onmessage?.({ data: text });
  });
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.received = [];
      this.sent = [];
      this.peer = null;
      const query = new URL(url).searchParams;
      this.code = query.get('room');
      this.role = query.get('role');
      sockets.push(this);
      queueMicrotask(() => this.connect());
    }
    connect() {
      if (this.readyState !== 0) return;
      const room = rooms.get(this.code) ?? { spectators: [], snapshot: {} };
      const refused = this.role === 'host' ? Boolean(room.host) : !room.host || (this.role === 'guest' && Boolean(room.guest));
      if (refused) {
        this.readyState = 3;
        this.onclose?.({ code: 1006 });
        return;
      }
      if (this.role === 'spectator') room.spectators.push(this);
      else room[this.role] = this;
      rooms.set(this.code, room);
      this.readyState = 1;
      this.onopen?.({});
      if (this.role === 'spectator') for (const text of snapshotFor(room.snapshot)) deliver(this, text);
      else if (room.spectators.some((s) => s.watching)) {
        deliver(this, JSON.stringify(audienceMessage(watchersOf(room.spectators.map((s) => ({ watching: s.watching, peer: s.peer, name: s.name }))))));
      }
    }
    send(text) {
      if (this.readyState !== 1) throw new Error('send before open');
      this.sent.push(text);
      const room = rooms.get(this.code);
      const message = JSON.parse(text);
      this.peer ??= message.from;
      if (this.role === 'spectator') {
        if (message.type === WATCH_TYPE || message.type === UNWATCH_TYPE) {
          this.watching = message.type === WATCH_TYPE;
          this.name = message.name ?? null;
          watchFrames.push(message.type);
          sendAudience(room);
          return;
        }
        if (message.type === 'chat') {
          for (const to of [room.host, room.guest, ...room.spectators]) if (to && to !== this) deliver(to, text);
          return;
        }
        spectatorFrames.push(text);
        this.drop();
        return;
      }
      if (this.role === 'guest') {
        if (room.host) deliver(room.host, text);
        return;
      }
      for (const to of [room.guest, ...room.spectators]) if (to) deliver(to, text);
      if (SNAPSHOT_TYPES.includes(message.type)) room.snapshot[message.type] = text;
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      const room = rooms.get(this.code);
      if (!room) return;
      if (this.role === 'spectator') {
        room.spectators = room.spectators.filter((s) => s !== this);
        if (this.watching) sendAudience(room);
        return;
      }
      if (room[this.role] === this) delete room[this.role];
      const others = this.role === 'host' ? [room.guest, ...room.spectators] : [room.host];
      for (const to of others) if (to) deliver(to, JSON.stringify({ type: 'leave', from: this.peer ?? 'relay', to: to.peer }));
    }
    // The server or the network drops this open socket.
    drop() {
      this.close();
      this.onclose?.({ code: 1006 });
    }
  }
  return { FakeWebSocket, rooms, sockets, spectatorFrames, watchFrames };
}

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function makeApp(relay, clock) {
  return createApp({
    config: WEBSOCKET,
    transportOptions: { WebSocketImpl: relay.FakeWebSocket, location: LOCATION },
    clock,
    makeCode: () => CODE,
  });
}

async function hostRoom(relay, clock) {
  const host = makeApp(relay, clock);
  host.playOnline();
  host.createRoom();
  await settle();
  return host;
}

async function joinGuest(relay, clock) {
  const guest = makeApp(relay, clock);
  guest.playOnline();
  guest.openJoin();
  guest.joinRoom(CODE);
  await settle();
  return guest;
}

async function startGame(host, guest) {
  host.pick(WIND_RABBIT);
  await settle();
  guest.pick(EARTH_BEAR);
  await settle();
  host.ready();
  await settle();
  guest.ready();
  await settle();
  assert.equal(host.getScreen(), GAME);
  assert.equal(guest.getScreen(), GAME);
}

async function watch(relay, clock) {
  const spectator = makeApp(relay, clock);
  assert.equal(spectator.menuEvent(FLOW_EVENTS.WATCH), true);
  assert.equal(spectator.watchRoom(CODE.toLowerCase()), true);
  await settle();
  return spectator;
}

const spectatorSockets = (relay) => relay.sockets.filter((s) => s.role === 'spectator');

test('the menu has Watch a match, which opens the spectate screen (text in strings.js)', () => {
  const watchButton = MENU_BUTTONS.find((button) => button.event === FLOW_EVENTS.WATCH);
  assert.equal(watchButton.label, STRINGS.menuWatch);
  assert.equal(watchButton.label, 'Watch a match');
  assert.equal(watchButton.box, 'menu-watch');
  const app = makeApp(fakeRelay(), createFakeClock());
  assert.equal(app.menuEvent(FLOW_EVENTS.WATCH), true);
  assert.equal(app.getScreen(), SPECTATE_SCREEN);
  assert.deepEqual(app.getFlow(), { screen: SCREENS.SPECTATE, overlay: 'none', mode: 'online', role: ROLES.SPECTATOR, notice: null, seats: null });
  assert.equal(app.getView().spectate.title, STRINGS.spectateTitle);
  app.back();
  assert.equal(app.getScreen(), MENU);
});

test('spectateViewModel: the code box, Watch until the code is whole, Connecting while the relay opens', () => {
  assert.equal(spectateViewModel({ text: 'ab' }).watch.disabled, true);
  const full = spectateViewModel({ text: 'ab-2c9' });
  assert.equal(full.value, CODE);
  assert.equal(full.watch.disabled, false);
  assert.equal(full.watch.label, STRINGS.spectateWatchButton);
  const busy = spectateViewModel({ text: CODE, connecting: true });
  assert.equal(busy.watch.label, STRINGS.spectateConnecting);
  assert.equal(busy.watch.disabled, true);
  assert.equal(busy.inputDisabled, true);
  assert.equal(full.back.box, 'spectate-back');
});

test('the spectate screen: a bad code and a room without a host give inline errors', async () => {
  const relay = fakeRelay();
  const app = makeApp(relay, createFakeClock());
  app.menuEvent(FLOW_EVENTS.WATCH);
  assert.equal(app.watchRoom(''), false);
  assert.equal(app.getView().spectate.error, STRINGS.joinErrorEmpty);
  app.clearSpectateError();
  assert.equal(app.getView().spectate.error, null);
  assert.equal(app.watchRoom('AB'), false);
  assert.equal(app.getView().spectate.error, STRINGS.joinErrorBadCode);
  assert.equal(app.watchRoom(CODE), true);
  assert.equal(relay.sockets[0].url, `ws://localhost:8787/ws?room=${CODE}&role=spectator`);
  await settle();
  assert.equal(app.getScreen(), SPECTATE_SCREEN);
  assert.equal(app.getView().spectate.error, withCode(STRINGS.joinErrorNotFound, CODE));
});

test('a spectator sees the waiting room with no Ready while the room has no game, then the live game', async () => {
  const relay = fakeRelay();
  const clock = createFakeClock();
  const host = await hostRoom(relay, clock);
  host.pick(WIND_RABBIT);
  await settle();
  const spectator = await watch(relay, clock);
  assert.equal(spectator.getFlow().screen, SCREENS.SPECTATE_WAITING);
  assert.equal(spectator.getScreen(), WAITING_SCREEN);
  let waiting = spectator.getView().waiting;
  assert.equal(waiting.title, STRINGS.spectateWaitingTitle);
  assert.equal(waiting.code, CODE);
  assert.equal(waiting.readyButton, null, 'no Ready');
  assert.ok(waiting.characters.every((card) => card.disabled), 'no pick');
  assert.equal(waiting.leave.label, STRINGS.spectateLeave);
  assert.deepEqual(waiting.cards.map((card) => card.label), [STRINGS.spectateHost, STRINGS.spectateGuest]);
  assert.equal(waiting.cards[0].character, WIND_RABBIT, 'the replayed seats');
  assert.equal(waiting.cards[1].placeholder, true, 'no guest yet');

  const guest = await joinGuest(relay, clock);
  waiting = spectator.getView().waiting;
  assert.equal(waiting.cards[1].placeholder, false, 'the guest was welcomed');
  await startGame(host, guest);

  assert.equal(spectator.getFlow().screen, SCREENS.SPECTATE_GAME);
  assert.equal(spectator.getScreen(), WATCH);
  const game = spectator.getGame();
  assert.deepEqual(game.getView().state, host.getGame().getView().state);
  const card = spectator.getView().watch;
  assert.equal(card.title, withCode(STRINGS.watchingRoom, CODE));
  assert.equal(card.players, 'Wind Rabbit (X) vs Earth Bear (O)');
  assert.equal(card.status, "Wind Rabbit's turn");

  // Moves of both players show live.
  assert.equal(host.getGame().click({ x: 7, y: 7 }), true);
  await settle();
  assert.equal(guest.getGame().click({ x: 8, y: 8 }), true);
  await settle();
  assert.deepEqual(game.getView().state, host.getGame().getView().state);
  assert.equal(game.getView().state.board[7][7], X);
  assert.equal(game.getView().state.board[8][8], O);
  assert.equal(spectator.getView().watch.status, "Wind Rabbit's turn");
  assert.ok(game.takeEvents().length > 0, 'the effects get the events');
  for (const app of [host, guest, spectator]) app.close();
});

test('a guest who goes before the start leaves the spectator\'s guest seat empty again', async () => {
  const relay = fakeRelay();
  const clock = createFakeClock();
  const host = await hostRoom(relay, clock);
  const spectator = await watch(relay, clock);
  const guest = await joinGuest(relay, clock);
  guest.pick(EARTH_BEAR);
  await settle();
  let waiting = spectator.getView().waiting;
  assert.equal(waiting.cards[1].placeholder, false);
  assert.equal(waiting.cards[1].character, EARTH_BEAR);

  guest.close();
  await settle();
  clock.advance(config.HEARTBEAT_INTERVAL_MS);
  await settle();
  waiting = spectator.getView().waiting;
  assert.equal(spectator.getScreen(), WAITING_SCREEN);
  assert.equal(waiting.cards[1].placeholder, true, 'no guest any more');
  assert.equal(waiting.cards[1].character, null, 'the old pick is gone');
  // A spectator who comes now is replayed the emptied seats.
  const late = await watch(relay, clock);
  assert.equal(late.getView().waiting.cards[1].placeholder, true);

  // A new guest fills the seat again for both.
  const next = await joinGuest(relay, clock);
  for (const app of [spectator, late]) assert.equal(app.getView().waiting.cards[1].placeholder, false);
  for (const app of [host, next, spectator, late]) app.close();
});

test('spectator input is ignored: no Ready, no pick, no cell clicks, no skills, and the game does not change', async () => {
  const relay = fakeRelay();
  const clock = createFakeClock();
  const host = await hostRoom(relay, clock);
  const spectator = await watch(relay, clock);
  // The waiting room: pick and Ready are refused.
  assert.equal(spectator.pick(WIND_RABBIT, 'host'), false);
  assert.equal(spectator.pick(EARTH_BEAR), false);
  assert.equal(spectator.ready('guest'), false);
  assert.equal(spectator.ready(), false);
  assert.equal(spectator.chooseSeat('host'), false);
  await settle();
  assert.deepEqual(host.getView().waiting.cards.map((c) => c.character), [null, null]);

  const guest = await joinGuest(relay, clock);
  await startGame(host, guest);
  const before = JSON.stringify(host.getGame().getView().state);
  const game = spectator.getGame();
  game.setHover({ x: 3, y: 3 });
  assert.equal(game.click({ x: 3, y: 3 }), false);
  assert.equal(game.clickSkill(X, WIND_DASH), false);
  assert.equal(game.clickSkill(O, MUD_TRAP), false);
  assert.equal(game.cancel(), false);
  assert.equal(game.getTargeting(), null);
  assert.equal(spectator.rematch(), false);
  assert.equal(spectator.restartLocal(), false);
  assert.equal(spectator.backToMenu(), false, 'no game over card for a spectator');
  const view = game.getView();
  assert.equal(view.hover, null);
  assert.equal(view.preview, null);
  assert.equal(view.pointer, false);
  assert.equal(view.you, null);
  assert.ok(view.panels.every((panel) => panel.skills.every((skill) => !skill.usable)));
  await settle();
  assert.equal(JSON.stringify(host.getGame().getView().state), before, 'the host game is unchanged');
  assert.equal(JSON.stringify(guest.getGame().getView().state), before);
  // The HUD of a spectator: every skill row is disabled, nobody is "you".
  const hud = hudViewModel(view.state, { status: view.status }, SPECTATOR_VIEW);
  assert.ok(hud.cards.every((card) => !card.you && card.skills.every((skill) => skill.disabled)));
  assert.equal(hud.turn.hint, STRINGS.watchingHint);
  for (const app of [host, guest, spectator]) app.close();
});

test('a spectator sends only watch and unwatch: nothing on input, rematch, leave or close', async () => {
  const relay = fakeRelay();
  const clock = createFakeClock();
  const host = await hostRoom(relay, clock);
  const spectator = await watch(relay, clock);
  spectator.pick(WIND_RABBIT);
  spectator.ready();
  const guest = await joinGuest(relay, clock);
  await startGame(host, guest);
  spectator.getGame().click({ x: 0, y: 0 });
  spectator.getGame().clickSkill(X, WIND_DASH);
  clock.advance(config.HEARTBEAT_INTERVAL_MS * 5);
  await settle();
  spectator.leaveRoom();
  await settle();
  const [socket] = spectatorSockets(relay);
  assert.deepEqual(socket.sent.map((text) => JSON.parse(text).type), ['watch', 'watch', 'unwatch'], 'watch on join, again when the guest is welcomed, unwatch on leave');
  assert.deepEqual(relay.spectatorFrames, []);
  assert.equal(spectator.getScreen(), MENU);
  // The spectator room itself refuses every action without a message.
  const transport = createFakeNetwork().connect();
  const room = createSpectatorRoom({ transport, code: CODE });
  for (const result of [room.pick(WIND_RABBIT), room.ready(), room.place(1, 1), room.useSkill(WIND_DASH, null), room.act({ kind: 'place', x: 0, y: 0 })]) {
    assert.deepEqual(result, { ok: false, error: SPECTATOR_ERROR });
  }
  assert.equal(room.requestRematch(), false);
  room.close();
  assert.deepEqual(transport.sent.map((m) => m.type), ['watch', 'unwatch']);
  // And its ws-transport drops anything sent.
  const ws = createWebSocketTransport(CODE, 'spectator', { WebSocketImpl: relay.FakeWebSocket, location: LOCATION });
  await ws.opened;
  assert.equal(ws.send({ type: 'join', from: 'x' }), false);
  ws.close();
  assert.deepEqual(relay.spectatorFrames, []);
  for (const app of [host, guest]) app.close();
});

test('a spectator is never in the presence countdown: the players go on, and its view has no countdown', async () => {
  const relay = fakeRelay();
  const clock = createFakeClock();
  const host = await hostRoom(relay, clock);
  const guest = await joinGuest(relay, clock);
  await startGame(host, guest);
  const spectator = await watch(relay, clock);
  for (let i = 0; i < 6; i += 1) {
    clock.advance(config.HEARTBEAT_INTERVAL_MS);
    await settle();
  }
  spectator.leaveRoom();
  for (let i = 0; i < 6; i += 1) {
    clock.advance(config.HEARTBEAT_INTERVAL_MS);
    await settle();
  }
  assert.equal(host.getGame().getView().peerCountdown, null, 'the host never counts a spectator');
  assert.equal(guest.getGame().getView().peerCountdown, null);
  assert.equal(host.getGame().getOutcome(), null);
  assert.equal(host.getGame().click({ x: 7, y: 7 }), true);
  for (const app of [host, guest]) app.close();
});

test('a spectator who comes during a game sees the current board at once (the replay keeps the newest state)', async () => {
  const relay = fakeRelay();
  const clock = createFakeClock();
  const host = await hostRoom(relay, clock);
  const guest = await joinGuest(relay, clock);
  await startGame(host, guest);
  host.getGame().click({ x: 7, y: 7 });
  await settle();
  guest.getGame().click({ x: 6, y: 6 });
  await settle();
  const spectator = await watch(relay, clock);
  assert.equal(spectator.getScreen(), WATCH);
  assert.deepEqual(spectator.getGame().getView().state, host.getGame().getView().state);
  assert.equal(spectator.getGame().getView().state.board[6][6], O);
  for (const app of [host, guest, spectator]) app.close();
});

test('Room closed: the host leaves, the spectator sees the notice and goes back to the menu', async () => {
  const relay = fakeRelay();
  const clock = createFakeClock();
  const host = await hostRoom(relay, clock);
  const guest = await joinGuest(relay, clock);
  await startGame(host, guest);
  const spectator = await watch(relay, clock);
  assert.equal(spectator.getScreen(), WATCH);
  host.close();
  await settle();
  assert.equal(spectator.getScreen(), ROOM_CLOSED_SCREEN);
  assert.equal(spectator.getFlow().notice, NOTICE_ROOM_CLOSED);
  assert.equal(spectator.getGame(), null);
  const notice = spectator.getView().roomClosed;
  assert.equal(notice.title, 'Room closed');
  assert.equal(notice.title, STRINGS.roomClosed);
  assert.equal(notice.back.label, STRINGS.gameOverBackToMenu);
  assert.equal(spectator.leaveRoom(), true);
  assert.equal(spectator.getScreen(), MENU);
  assert.equal(spectator.getFlow().notice, null);
  guest.close();
});

test('Room closed: also in the waiting room, and when the relay connection is lost', async () => {
  const relay = fakeRelay();
  const clock = createFakeClock();
  const host = await hostRoom(relay, clock);
  const spectator = await watch(relay, clock);
  assert.equal(spectator.getScreen(), WAITING_SCREEN);
  host.close();
  await settle();
  assert.equal(spectator.getScreen(), ROOM_CLOSED_SCREEN);

  const relay2 = fakeRelay();
  const host2 = await hostRoom(relay2, clock);
  const watcher = await watch(relay2, clock);
  spectatorSockets(relay2)[0].drop();
  assert.equal(watcher.getScreen(), ROOM_CLOSED_SCREEN);
  assert.equal(watcher.getView().roomClosed.title, STRINGS.roomClosed);
  host2.close();
});

test('the spectator room follows a rematch and a forfeit result', () => {
  const network = createFakeNetwork();
  const host = network.connect();
  const room = createSpectatorRoom({ transport: network.connect(), code: CODE });
  const events = [];
  room.onEvent((event) => events.push(event.type));
  const state = (winner = null) => ({ board: [[null]], currentPlayer: X, winner, draw: false, characters: { [X]: WIND_RABBIT, [O]: EARTH_BEAR } });
  host.send({ type: 'start', from: 'h', round: 1, seq: 1, state: state(), seats: room.getView().seats });
  assert.equal(room.phase, 'playing');
  host.send({ type: 'state', from: 'h', round: 1, seq: 2, state: state(X), events: [{ type: 'stonePlaced' }] });
  assert.equal(room.phase, 'over');
  host.send({ type: 'start', from: 'h', round: 1, seq: 1, state: state() }); // an older seq: dropped
  assert.equal(room.getView().state.winner, X);
  host.send({ type: 'new-game', from: 'h', round: 2, seq: 3, state: state() });
  assert.equal(room.phase, 'playing');
  assert.equal(room.round, 2);
  host.send({ type: 'ping', from: 'h', round: 2, seq: 3, result: { winner: O, reason: 'opponentLeft' } });
  assert.equal(room.phase, 'over');
  assert.deepEqual(room.getView().result, { winner: O, reason: 'opponentLeft' });
  host.send({ type: 'state', from: 'someone-else', round: 2, seq: 9, state: state(), events: [] }); // not the host
  assert.equal(room.getView().state.currentPlayer, X);
  assert.deepEqual(events, ['start', 'state', 'newGame', 'result']);
  assert.equal(room.getView().peer, null, 'no presence');
  assert.equal(room.getView().yourTurn, false);
});

test('the spectator texts: the phase line, the outcome, the watch card and the Room closed notice', () => {
  const sides = { [X]: WIND_RABBIT, [O]: EARTH_BEAR };
  const playing = { winner: null, draw: false, currentPlayer: O, characters: sides };
  assert.equal(spectatorStatus(null), STRINGS.spectateWaitingTitle);
  assert.equal(spectatorStatus(playing), "Earth Bear's turn");
  assert.equal(spectatorStatus({ ...playing, winner: X }), 'Wind Rabbit wins');
  assert.equal(spectatorStatus({ ...playing, draw: true }), STRINGS.watchingDraw);
  assert.equal(spectatorStatus(playing, { winner: O, reason: 'opponentLeft' }), 'Earth Bear wins, the opponent left');
  assert.equal(spectatorOutcome(playing), null);
  assert.equal(spectatorOutcome({ ...playing, winner: X }).youWin, false);
  const card = watchViewModel({ code: CODE, state: playing });
  assert.equal(card.title, 'Watching room AB2C9');
  assert.equal(card.leave.box, 'watch-leave');
  assert.deepEqual(roomClosedViewModel(), {
    title: 'Room closed',
    detail: STRINGS.roomClosedDetail,
    back: { label: STRINGS.gameOverBackToMenu, box: 'room-closed-menu' },
  });
});

test('the shot scenes spectate, spectate-game and room-closed draw the spectator screens from still views', async () => {
  const { SHOT_SCENES, shotFlow, shotRoomView, shotWatchView } = await import('../src/ui/shot-mode.js');
  for (const scene of ['spectate', 'spectate-game', 'room-closed']) assert.ok(SHOT_SCENES.includes(scene), scene);
  assert.equal(shotFlow('spectate').screen, SCREENS.SPECTATE);
  const spectate = shotRoomView('spectate');
  assert.equal(spectate.screen, SPECTATE_SCREEN);
  assert.equal(spectate.spectate.title, STRINGS.spectateTitle);
  const closed = shotRoomView('room-closed');
  assert.equal(closed.screen, ROOM_CLOSED_SCREEN);
  assert.equal(closed.roomClosed.title, STRINGS.roomClosed);
  assert.equal(shotWatchView('field', null), null);
  const state = { winner: null, draw: false, currentPlayer: X, characters: { [X]: WIND_RABBIT, [O]: EARTH_BEAR } };
  const watching = shotWatchView('spectate-game', state);
  assert.equal(watching.screen, WATCH);
  assert.equal(watching.flow.screen, SCREENS.SPECTATE_GAME);
  assert.equal(watching.watch.title, 'Watching room ABCD5');
  assert.equal(watching.watch.status, "Wind Rabbit's turn");
});

// The watch card never lies over the plots (review: it covered the board in
// smaller windows). Every window shape of tools/shots.py plus a few in
// between; 140 px is about the full card at 250 px, 230 px in a narrow strip.
test('the watch card stays off the board at every window size', () => {
  const sizes = [[1920, 1080], [1280, 720], [1680, 720], [1366, 768], [1024, 768], [1024, 600], [800, 600],
    [900, 500], [720, 1280], [390, 844], [360, 740]];
  for (const [w, h] of sizes) {
    const layout = hudLayout(w, h);
    const fullHeight = layout.rail ? 230 : 140;
    const box = watchCardBox(w, h, fullHeight, layout);
    const board = boardScreenRect(w, h);
    const apart = box.x + box.w <= board.left || box.x >= board.right
      || box.y + box.h <= board.top || box.y >= board.bottom;
    assert.ok(apart, `${w}x${h}: ${JSON.stringify(box)} over ${JSON.stringify(board)}`);
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= w && box.y + box.h <= h, `${w}x${h} inside the window`);
    assert.ok(box.w >= 100, `${w}x${h} wide enough for Stop watching`);
    assert.equal(box.h, box.slim ? WATCH_SLIM_HEIGHT : fullHeight);
  }
});

test('the watch card turns slim only where the full card does not fit', () => {
  assert.equal(watchCardBox(1280, 720, 140).slim, false);
  assert.equal(watchCardBox(1024, 768, 230).slim, false); // rail: under the upright bar
  // compact: the full card fits above the board, under the top bar
  const phone = watchCardBox(390, 844, 140);
  assert.equal(phone.slim, false);
  assert.ok(phone.y + phone.h <= boardScreenRect(390, 844).top - 12);
  // a card too tall for either room: the slim row between the board and the bars
  const tall = watchCardBox(390, 844, 300);
  assert.equal(tall.slim, true);
  assert.equal(tall.w, 390 - 24);
  assert.equal(tall.y + tall.h, 844 - BARS_HEIGHT - 12);
});

test('the players see who watches: names in the chat view, a quiet chat line as each comes and goes, a guest who came later too', async () => {
  const relay = fakeRelay();
  const clock = createFakeClock();
  const host = await hostRoom(relay, clock);
  const first = makeApp(relay, clock);
  first.setPlayerName('Calm Owl');
  first.menuEvent(FLOW_EVENTS.WATCH);
  first.watchRoom(CODE);
  await settle();
  assert.deepEqual(host.getView().chat.watchers, ['Calm Owl']);
  const line = host.getView().chat.messages.at(-1);
  assert.equal(line.system, true);
  assert.equal(line.text, STRINGS.audienceJoined.replace('{name}', 'Calm Owl'));
  const guest = await joinGuest(relay, clock);
  assert.deepEqual(guest.getView().chat.watchers, ['Calm Owl'], 'the relay tells a guest who joins later');
  const second = await watch(relay, clock);
  await startGame(host, guest);
  assert.deepEqual(host.getView().chat.watchers, ['Calm Owl', STRINGS.audienceSomeone]);
  assert.deepEqual(first.getView().chat.watchers, [STRINGS.audienceSomeone], 'a spectator sees the others, not itself');
  first.leaveRoom();
  await settle();
  assert.deepEqual(guest.getView().chat.watchers, [STRINGS.audienceSomeone]);
  assert.equal(guest.getView().chat.messages.at(-1).text, STRINGS.audienceLeft.replace('{name}', 'Calm Owl'));
  // A closed tab sends nothing: the relay tells the room.
  spectatorSockets(relay).at(-1).drop();
  await settle();
  assert.deepEqual(host.getView().chat.watchers, []);
  for (const app of [host, guest, second]) app.close();
});
