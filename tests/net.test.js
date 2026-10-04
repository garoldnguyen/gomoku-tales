import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEARTBEAT_INTERVAL_MS, JOIN_TIMEOUT_MS, LEAVE_COUNTDOWN_S, PEER_TIMEOUT_MS, ROOM_CODE_LENGTH, WAITING_START_DELAY_MS } from '../src/config.js';
import { X, O, EMPTY } from '../src/logic/board.js';
import { EARTH_BEAR, WIND_RABBIT } from '../src/logic/characters.js';
import { TORNADO_ZONE } from '../src/logic/skills.js';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { COUNTDOWN, CONNECTED, GONE, checkPresence, createPresence, markHeard, markLeft } from '../src/net/presence.js';
import { ROOM_CODE_ALPHABET, generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../src/net/room-code.js';
import { CLOSED, FULL, JOINING, NOT_STARTED, NO_ROOM, OVER, PLAYING, STARTING, WAITING, createGuestRoom, createHostRoom } from '../src/net/room.js';
import { channelName, createBroadcastTransport } from '../src/net/transport.js';

// --- Room codes ---

test('room codes are 5 characters without 0, O, 1 or I', () => {
  assert.equal(ROOM_CODE_LENGTH, 5);
  for (const char of '0O1I') assert.equal(ROOM_CODE_ALPHABET.includes(char), false);
  assert.match(ROOM_CODE_ALPHABET, /^[A-Z2-9]+$/);
  for (let i = 0; i < 200; i++) {
    const code = generateRoomCode();
    assert.equal(code.length, ROOM_CODE_LENGTH);
    assert.equal(isValidRoomCode(code), true, code);
  }
});

test('generateRoomCode uses the injected random function, including its extremes', () => {
  assert.equal(generateRoomCode(() => 0), 'AAAAA');
  assert.equal(generateRoomCode(() => 0.9999999), '99999');
  const values = [0, 1 / 32, 2 / 32, 3 / 32, 31 / 32];
  assert.equal(generateRoomCode(() => values.shift()), 'ABCD9');
});

test('isValidRoomCode and normalizeRoomCode', () => {
  assert.equal(isValidRoomCode('AB2C9'), true);
  assert.equal(isValidRoomCode('ab2c9'), false);
  assert.equal(isValidRoomCode('AB2C'), false);
  assert.equal(isValidRoomCode('AB2C9Z'), false);
  assert.equal(isValidRoomCode('AB0C9'), false);
  assert.equal(isValidRoomCode('ABOC9'), false);
  assert.equal(isValidRoomCode('AB1C9'), false);
  assert.equal(isValidRoomCode('ABIC9'), false);
  assert.equal(isValidRoomCode(null), false);
  assert.equal(normalizeRoomCode(' ab 2c9 '), 'AB2C9');
  assert.equal(normalizeRoomCode(undefined), '');
});

// --- Transports ---

test('the BroadcastChannel is named gomoku-tales- plus the room code', () => {
  assert.equal(channelName('AB2C9'), 'gomoku-tales-AB2C9');
});

test('BroadcastChannel transport links two ends of the same room only', async () => {
  const a = createBroadcastTransport('TEST2');
  const b = createBroadcastTransport('TEST2');
  const other = createBroadcastTransport('TEST3');
  const gotA = [];
  const gotOther = [];
  a.onMessage((m) => gotA.push(m));
  other.onMessage((m) => gotOther.push(m));
  const received = new Promise((resolve) => b.onMessage(resolve));
  a.send({ type: 'ping', n: 1 });
  assert.deepEqual(await received, { type: 'ping', n: 1 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(gotA, [], 'the sender does not hear itself');
  assert.deepEqual(gotOther, [], 'another room hears nothing');
  a.close();
  b.close();
  other.close();
  a.send({ type: 'ping' }); // sending after close is a no-op
});

test('fake transport delivers to every other end, in order, as copies', () => {
  const network = createFakeNetwork();
  const a = network.connect();
  const b = network.connect();
  const c = network.connect();
  const got = { a: [], b: [], c: [] };
  a.onMessage((m) => got.a.push(m));
  b.onMessage((m) => {
    got.b.push(m);
    if (m.n === 1) b.send({ n: 'reply' }); // sent from a handler: delivered after the current message
  });
  c.onMessage((m) => got.c.push(m));

  const message = { n: 1 };
  a.send(message);
  a.send({ n: 2 });
  assert.deepEqual(got.a, [{ n: 'reply' }]);
  assert.deepEqual(got.b, [{ n: 1 }, { n: 2 }]);
  assert.deepEqual(got.c, [{ n: 1 }, { n: 'reply' }, { n: 2 }]);
  assert.notEqual(got.b[0], message);
});

test('fake transport: muted ends lose their messages, closed ends leave the room', () => {
  const network = createFakeNetwork();
  const a = network.connect();
  const b = network.connect();
  const got = [];
  b.onMessage((m) => got.push(m));
  a.setMuted(true);
  a.send({ n: 1 });
  a.setMuted(false);
  a.send({ n: 2 });
  assert.deepEqual(got, [{ n: 2 }]);
  assert.deepEqual(a.sent, [{ n: 1 }, { n: 2 }]);
  b.close();
  assert.equal(network.size, 1);
  a.send({ n: 3 });
  assert.deepEqual(got, [{ n: 2 }]);
});

// --- Fake clock ---

test('fake clock runs timeouts and intervals in time order as time advances', () => {
  const clock = createFakeClock(1000);
  const log = [];
  const every = clock.setInterval(() => log.push(`tick@${clock.now()}`), 400);
  clock.setTimeout(() => log.push(`once@${clock.now()}`), 800);
  const cancelled = clock.setTimeout(() => log.push('never'), 500);
  clock.clearTimeout(cancelled);
  clock.advance(1000);
  // At 1800 the timeout goes first: it was set before the interval re-armed.
  assert.deepEqual(log, ['tick@1400', 'once@1800', 'tick@1800']);
  assert.equal(clock.now(), 2000);
  clock.clearInterval(every);
  assert.equal(clock.pending, 0);
});

// --- Presence (leave detection timing) ---

test('presence: connected until PEER_TIMEOUT_MS of silence, then a 10 second countdown', () => {
  assert.equal(PEER_TIMEOUT_MS, 3000);
  assert.equal(LEAVE_COUNTDOWN_S, 10);
  const p = createPresence(0);
  assert.equal(checkPresence(p, 2999).status, CONNECTED);
  assert.deepEqual(pick(checkPresence(p, 3000)), { status: COUNTDOWN, secondsLeft: 10 });
  assert.deepEqual(pick(checkPresence(p, 3001)), { status: COUNTDOWN, secondsLeft: 10 });
  assert.deepEqual(pick(checkPresence(p, 4000)), { status: COUNTDOWN, secondsLeft: 9 });
  assert.deepEqual(pick(checkPresence(p, 12999)), { status: COUNTDOWN, secondsLeft: 1 });
  const gone = checkPresence(p, 13000);
  assert.deepEqual(pick(gone), { status: GONE, secondsLeft: 0 });
  assert.equal(gone.presence.goneAt, 13000);
});

test('presence: hearing from the peer again cancels the countdown', () => {
  let p = createPresence(0);
  assert.equal(checkPresence(p, 8000).status, COUNTDOWN);
  p = markHeard(p, 8000);
  assert.equal(checkPresence(p, 8000).status, CONNECTED);
  assert.equal(checkPresence(p, 10999).status, CONNECTED);
  assert.deepEqual(pick(checkPresence(p, 11000)), { status: COUNTDOWN, secondsLeft: 10 });
});

test('presence: a leave message starts the countdown at once, later messages cancel it', () => {
  let p = markLeft(createPresence(0), 500);
  assert.deepEqual(pick(checkPresence(p, 500)), { status: COUNTDOWN, secondsLeft: 10 });
  assert.deepEqual(pick(checkPresence(p, 5500)), { status: COUNTDOWN, secondsLeft: 5 });
  assert.equal(markLeft(p, 2000), p, 'a second leave does not restart the countdown');
  assert.equal(checkPresence(markHeard(p, 6000), 6000).status, CONNECTED);
  assert.equal(checkPresence(p, 10500).status, GONE);
});

test('presence: once gone, the peer stays gone', () => {
  const { presence } = checkPresence(createPresence(0), 20000);
  assert.equal(checkPresence(markHeard(presence, 20001), 20001).status, GONE);
  assert.equal(markLeft(presence, 20001), presence);
});

function pick({ status, secondsLeft }) {
  return { status, secondsLeft };
}

// --- Room controller ---

// Host and guest on one fake network and one fake clock. Events of each
// side are collected in hostEvents and guestEvents. With start (the
// default) the clock runs through the host's start delay, so the game is
// playing; the heartbeat and silence timing then count from that moment.
function setup({ character = WIND_RABBIT, random, join = true, start = true } = {}) {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const hostTransport = network.connect();
  const host = createHostRoom({ transport: hostTransport, code: 'AB2C9', character, clock, random, id: 'host' });
  const hostEvents = [];
  host.onEvent((e) => hostEvents.push(e));
  const ctx = { network, clock, host, hostTransport, hostEvents, guest: null, guestTransport: null, guestEvents: [] };
  if (join) {
    ctx.guestTransport = network.connect();
    ctx.guest = createGuestRoom({ transport: ctx.guestTransport, code: 'AB2C9', clock, id: 'guest' });
    ctx.guest.onEvent((e) => ctx.guestEvents.push(e));
    if (start) clock.advance(WAITING_START_DELAY_MS);
  }
  return ctx;
}

const ofType = (events, type) => events.filter((e) => e.type === type);

test('join handshake: the guest is welcomed with the other character and the current state', () => {
  const { host, guest, hostEvents, guestTransport } = setup({ character: EARTH_BEAR });
  assert.deepEqual(guestTransport.sent[0], { type: 'join', from: 'guest' });
  assert.equal(host.phase, PLAYING);
  assert.equal(guest.phase, PLAYING);
  assert.deepEqual(hostEvents, [{ type: 'joined', character: WIND_RABBIT }, { type: 'start', round: 1 }]);
  const hostView = host.getView();
  const guestView = guest.getView();
  assert.equal(hostView.character, EARTH_BEAR);
  assert.equal(hostView.you, O);
  assert.equal(guestView.character, WIND_RABBIT);
  assert.equal(guestView.hostCharacter, EARTH_BEAR);
  assert.equal(guestView.you, X);
  assert.deepEqual(guest.state, host.state);
  assert.equal(guestView.yourTurn, true, 'Wind Rabbit (X) moves first');
  assert.equal(hostView.yourTurn, false);
  assert.deepEqual(guestView.peer, { status: CONNECTED, secondsLeft: null });
});

test('the host waits for a guest and rejects actions until one joins', () => {
  const { host, hostEvents } = setup({ join: false });
  assert.equal(host.phase, WAITING);
  assert.equal(host.getView().peer, null);
  assert.deepEqual(host.place(7, 7), { ok: false, error: 'Waiting for opponent.' });
  assert.deepEqual(hostEvents, [{ type: 'rejected', error: 'Waiting for opponent.' }]);
});

test('a third window is told the room is full', () => {
  const { network, clock, host, guest } = setup();
  const third = createGuestRoom({ transport: network.connect(), code: 'AB2C9', clock, id: 'third' });
  const events = [];
  third.onEvent((e) => events.push(e));
  assert.equal(third.phase, FULL);
  clock.advance(JOIN_TIMEOUT_MS * 2);
  assert.equal(third.phase, FULL, 'the join timeout was cancelled');
  assert.equal(host.phase, PLAYING);
  assert.equal(guest.phase, PLAYING);
  assert.equal(ofType(events, 'noRoom').length, 0);
});

test('joining a room nobody hosts ends in NO_ROOM after the join timeout', () => {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const guest = createGuestRoom({ transport: network.connect(), code: 'ZZZZZ', clock, id: 'guest' });
  const events = [];
  guest.onEvent((e) => events.push(e));
  assert.equal(guest.phase, JOINING);
  clock.advance(JOIN_TIMEOUT_MS - 1);
  assert.equal(guest.phase, JOINING);
  clock.advance(1);
  assert.equal(guest.phase, NO_ROOM);
  assert.deepEqual(events, [{ type: 'noRoom' }]);
  assert.equal(guest.place(0, 0).ok, false);
  assert.equal(clock.pending, 0, 'the join is no longer repeated');
});

test('a lost welcome is recovered: the guest repeats its join until answered', () => {
  const { network, clock, host, hostTransport, hostEvents } = setup({ join: false, character: EARTH_BEAR });
  hostTransport.setMuted(true); // the host drops while the guest joins, so its welcome is lost
  const guestTransport = network.connect();
  const guest = createGuestRoom({ transport: guestTransport, code: 'AB2C9', clock, id: 'guest' });
  const guestEvents = [];
  guest.onEvent((e) => guestEvents.push(e));
  assert.equal(host.phase, STARTING);
  assert.equal(guest.phase, JOINING);
  clock.advance(500);
  hostTransport.setMuted(false);
  clock.advance(HEARTBEAT_INTERVAL_MS - 500); // the repeated join is answered
  assert.equal(guest.phase, STARTING);
  assert.deepEqual(ofType(guestEvents, 'joined'), [{ type: 'joined', character: WIND_RABBIT }]);
  clock.advance(WAITING_START_DELAY_MS - HEARTBEAT_INTERVAL_MS);
  assert.equal(host.phase, PLAYING);
  assert.equal(guest.phase, PLAYING);
  assert.equal(ofType(guestEvents, 'noRoom').length, 0);
  const joinsSent = guestTransport.sent.filter((m) => m.type === 'join').length;
  clock.advance(60000);
  assert.equal(guestTransport.sent.filter((m) => m.type === 'join').length, joinsSent, 'no more joins once seated');
  assert.equal(host.getView().result, null);
  assert.equal(ofType(hostEvents, 'result').length, 0);
  assert.equal(guest.place(7, 7).ok, true);
  assert.equal(host.state.board[7][7], X);
});

test('a lost state message is recovered: the guest resyncs when the host ping shows a newer seq', () => {
  const { clock, host, guest, hostTransport, guestEvents } = setup({ character: WIND_RABBIT });
  hostTransport.setMuted(true);
  assert.equal(host.place(7, 7).ok, true); // this state message never reaches the guest
  hostTransport.setMuted(false);
  assert.equal(guest.state.currentPlayer, X);
  assert.equal(guest.getView().yourTurn, false);
  clock.advance(HEARTBEAT_INTERVAL_MS);
  assert.deepEqual(guest.state, host.state);
  assert.equal(guest.getView().yourTurn, true);
  assert.equal(ofType(guestEvents, 'state').length, 1);
  assert.equal(guest.place(7, 8).ok, true);
  assert.equal(host.state.board[8][7], O);
});

test('a lost action request is sent again with the next host ping and applied once', () => {
  const { clock, host, guest, guestTransport } = setup({ character: EARTH_BEAR });
  guestTransport.setMuted(true);
  assert.equal(guest.place(7, 7).ok, true); // this request never reaches the host
  guestTransport.setMuted(false);
  assert.equal(guest.getView().waiting, true);
  assert.deepEqual(guest.place(8, 8), { ok: false, error: 'Waiting for the host...' }, 'one request at a time');
  clock.advance(HEARTBEAT_INTERVAL_MS);
  assert.equal(host.state.board[7][7], X);
  assert.deepEqual(guest.state, host.state);
  assert.equal(guest.getView().waiting, false);
  const actions = guestTransport.sent.filter((m) => m.type === 'action');
  assert.deepEqual(actions.map((m) => m.requestId), [1, 1]);
  // A late copy of an answered request is skipped.
  guestTransport.send(actions[0]);
  assert.equal(host.state.currentPlayer, O);
  assert.equal(host.state.board[7][7], X);
});

test("a lost answer is recovered: the host ping shows the request was handled, and a repeat is not applied again", () => {
  const { clock, host, guest, hostTransport, guestTransport, guestEvents } = setup({ character: WIND_RABBIT });
  host.place(7, 7);
  hostTransport.setMuted(true);
  guest.place(7, 7); // taken: the rejection is lost
  guest.place(0, 0); // still waiting, so not sent
  hostTransport.setMuted(false);
  assert.equal(guest.getView().waiting, true);
  clock.advance(HEARTBEAT_INTERVAL_MS);
  assert.equal(guest.getView().waiting, false);
  assert.equal(guest.getView().yourTurn, true);
  assert.equal(hostTransport.sent.filter((m) => m.type === 'rejected').length, 1, 'the request was handled once');
  assert.equal(ofType(guestEvents, 'rejected').at(-1).error, 'Waiting for the host...');
  assert.equal(guest.place(8, 8).ok, true);
  assert.equal(host.state.board[8][8], O);

  // The state that answers an applied request is lost, and so is the next
  // ping: the guest waits until it has resynced, and does not send it again.
  host.place(1, 1);
  hostTransport.setMuted(true);
  assert.equal(guest.place(2, 2).ok, true);
  clock.advance(HEARTBEAT_INTERVAL_MS);
  hostTransport.setMuted(false);
  assert.equal(guest.getView().waiting, true);
  clock.advance(HEARTBEAT_INTERVAL_MS);
  assert.equal(host.state.board[2][2], O);
  assert.deepEqual(guest.state, host.state);
  assert.equal(guest.getView().waiting, false);
  assert.equal(guest.getView().yourTurn, false);
  assert.equal(guestTransport.sent.filter((m) => m.type === 'action' && m.requestId === 3).length, 1);
});

test("the guest's action request is applied by the host and the new state is sent back", () => {
  const { host, guest, hostEvents, guestEvents } = setup({ character: EARTH_BEAR });
  assert.equal(guest.place(7, 7).ok, true);
  assert.equal(host.state.board[7][7], X);
  assert.deepEqual(guest.state, host.state);
  const [hostState] = ofType(hostEvents, 'state');
  const [guestState] = ofType(guestEvents, 'state');
  assert.deepEqual(guestState.events, hostState.events);
  assert.equal(guestState.events[0].type, 'stonePlaced');
  assert.equal(host.getView().yourTurn, true);
});

test("the host's own action is sent to the guest", () => {
  const { host, guest, guestEvents } = setup({ character: WIND_RABBIT });
  assert.deepEqual(host.place(3, 4), { ok: true });
  assert.equal(guest.state.board[4][3], X);
  assert.deepEqual(guest.state, host.state);
  assert.equal(ofType(guestEvents, 'state').length, 1);
});

test('invalid guest actions are rejected with a message and change nothing', () => {
  const { host, guest, guestEvents, hostTransport } = setup({ character: WIND_RABBIT });
  const before = host.state;
  guest.place(0, 0); // not the guest's turn
  host.place(7, 7);
  guest.place(7, 7); // taken
  guest.act({ kind: 'dance' });
  guest.useSkill(TORNADO_ZONE, { x: 1, y: 1 }); // not Earth Bear's skill
  assert.deepEqual(ofType(guestEvents, 'rejected').map((e) => e.error), [
    'It is not your turn.',
    'That cell is not empty.',
    'Unknown action.',
    'That is not your skill.',
  ]);
  const rejected = hostTransport.sent.filter((m) => m.type === 'rejected');
  assert.deepEqual(rejected.map((m) => m.requestId), [1, 2, 3, 4]);
  assert.notEqual(host.state, before);
  assert.equal(host.state.board[0][0], EMPTY);
  assert.equal(host.state.currentPlayer, O);
  assert.deepEqual(guest.state, host.state);
});

test('invalid host actions are rejected locally', () => {
  const { host, hostEvents, guestTransport } = setup({ character: EARTH_BEAR });
  assert.deepEqual(host.place(7, 7), { ok: false, error: 'It is not your turn.' });
  assert.deepEqual(ofType(hostEvents, 'rejected'), [{ type: 'rejected', error: 'It is not your turn.' }]);
  assert.equal(guestTransport.sent.filter((m) => m.type === 'action').length, 0);
});

test('the host decides who acts: a guest cannot play the host stone or be spoofed by a stranger', () => {
  const { network, host, guest } = setup({ character: WIND_RABBIT });
  const stranger = network.connect();
  stranger.send({ type: 'action', from: 'stranger', to: 'host', action: { kind: 'place', x: 1, y: 1 } });
  stranger.send({ type: 'action', from: 'host', to: 'host', action: { kind: 'place', x: 2, y: 2 } });
  assert.equal(host.state.board[1][1], EMPTY);
  assert.equal(host.state.board[2][2], EMPTY);
  host.place(7, 7);
  // A forged player field is ignored; the host uses the sender's stone.
  guest.act({ kind: 'place', x: 8, y: 8, player: X });
  assert.equal(host.state.board[8][8], O);
});

test('the host makes the Tornado Zone random choice and the guest gets the result', () => {
  let calls = 0;
  const random = () => {
    calls += 1;
    return 0;
  };
  const { host, guest, guestEvents } = setup({ character: WIND_RABBIT, random });
  assert.equal(host.useSkill(TORNADO_ZONE, { x: 7, y: 7 }).ok, true);
  guest.place(7, 7);
  assert.equal(calls, 1);
  assert.equal(host.state.board[7][7], EMPTY, 'the stone was thrown');
  assert.deepEqual(guest.state, host.state);
  const thrown = ofType(guestEvents, 'state').at(-1).events.find((e) => e.type === 'stoneThrown');
  assert.ok(thrown);
  assert.equal(guest.state.board[thrown.to.y][thrown.to.x], O);
});

test('both sides send a ping every second and stay connected', () => {
  const { clock, host, guest, hostTransport, guestTransport, hostEvents, guestEvents } = setup();
  const pings = (transport) => transport.sent.filter((m) => m.type === 'ping').length;
  const before = { host: pings(hostTransport), guest: pings(guestTransport) }; // sent during the start delay
  clock.advance(HEARTBEAT_INTERVAL_MS * 30);
  assert.equal(pings(hostTransport) - before.host, 30);
  assert.equal(pings(guestTransport) - before.guest, 30);
  assert.deepEqual(hostTransport.sent.find((m) => m.type === 'ping'), { type: 'ping', to: 'guest', seq: 0, handled: 0, from: 'host' });
  assert.deepEqual(guestTransport.sent.find((m) => m.type === 'ping'), { type: 'ping', to: 'host', from: 'guest' });
  assert.equal(ofType([...hostEvents, ...guestEvents], 'peer').length, 0);
  assert.equal(host.getView().peer.status, CONNECTED);
  assert.equal(guest.getView().peer.status, CONNECTED);
});

test('silence starts the 10 second countdown; at 0 the remaining player wins', () => {
  const { clock, host, guestTransport, hostEvents } = setup({ character: EARTH_BEAR });
  clock.advance(500);
  guestTransport.setMuted(true); // the host last heard the guest at 0 ms (its join)
  clock.advance(PEER_TIMEOUT_MS - 500 - 1);
  assert.equal(host.getView().peer.status, CONNECTED);
  clock.advance(1);
  assert.deepEqual(host.getView().peer, { status: COUNTDOWN, secondsLeft: 10 });
  clock.advance(4000);
  assert.deepEqual(host.getView().peer, { status: COUNTDOWN, secondsLeft: 6 });
  clock.advance(6000);
  assert.deepEqual(host.getView().peer, { status: GONE, secondsLeft: 0 });
  assert.deepEqual(host.getView().result, { winner: O, reason: 'opponentLeft' });
  const peers = ofType(hostEvents, 'peer');
  assert.deepEqual(peers.map((e) => e.secondsLeft), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.deepEqual(ofType(hostEvents, 'result'), [{ type: 'result', result: { winner: O, reason: 'opponentLeft' } }]);
  assert.deepEqual(host.place(7, 7), { ok: false, error: 'The game is over.' });
  assert.equal(host.getView().yourTurn, false);
});

test('the countdown is cancelled when messages resume', () => {
  const { clock, host, guestTransport, hostEvents } = setup();
  guestTransport.setMuted(true);
  clock.advance(PEER_TIMEOUT_MS + 5000);
  assert.deepEqual(host.getView().peer, { status: COUNTDOWN, secondsLeft: 5 });
  guestTransport.setMuted(false);
  clock.advance(HEARTBEAT_INTERVAL_MS);
  assert.deepEqual(host.getView().peer, { status: CONNECTED, secondsLeft: null });
  assert.deepEqual(ofType(hostEvents, 'peer').at(-1), { type: 'peer', status: CONNECTED, secondsLeft: null });
  clock.advance(60000);
  assert.equal(host.getView().result, null);
  assert.equal(ofType(hostEvents, 'result').length, 0);
});

test('a leave message starts the countdown at once and the host wins after 10 seconds', () => {
  const { clock, host, guest, guestTransport, hostEvents } = setup({ character: WIND_RABBIT });
  clock.advance(2500);
  guest.close();
  assert.equal(guest.phase, CLOSED);
  assert.equal(guestTransport.closed, true);
  assert.deepEqual(guestTransport.sent.at(-1), { type: 'leave', to: 'host', from: 'guest' });
  assert.deepEqual(host.getView().peer, { status: COUNTDOWN, secondsLeft: 10 });
  clock.advance(LEAVE_COUNTDOWN_S * 1000 - 1);
  assert.equal(host.getView().result, null);
  clock.advance(1);
  assert.deepEqual(host.getView().result, { winner: X, reason: 'opponentLeft' });
  assert.deepEqual(ofType(hostEvents, 'result'), [{ type: 'result', result: { winner: X, reason: 'opponentLeft' } }]);
});

test('when the host leaves, the guest wins after the countdown', () => {
  const { clock, host, guest, guestEvents } = setup({ character: WIND_RABBIT });
  host.close();
  assert.deepEqual(guest.getView().peer, { status: COUNTDOWN, secondsLeft: 10 });
  clock.advance(LEAVE_COUNTDOWN_S * 1000);
  assert.deepEqual(guest.getView().result, { winner: O, reason: 'opponentLeft' });
  assert.deepEqual(ofType(guestEvents, 'result'), [{ type: 'result', result: { winner: O, reason: 'opponentLeft' } }]);
  assert.equal(guest.place(7, 7).ok, false);
});

const leftResult = (winner) => ({ winner, reason: 'opponentLeft' });

test('only the guest is cut off: the host wins and the guest, still there, takes that result', () => {
  const { clock, host, guest, guestTransport, hostTransport, hostEvents, guestEvents } = setup({ character: WIND_RABBIT });
  guestTransport.setMuted(true);
  clock.advance(PEER_TIMEOUT_MS + LEAVE_COUNTDOWN_S * 1000);
  assert.deepEqual(host.getView().result, leftResult(X));
  assert.deepEqual(guest.getView().result, leftResult(X), 'the guest hears the result at once');
  assert.deepEqual(ofType(guestEvents, 'result'), [{ type: 'result', result: leftResult(X) }]);
  guestTransport.setMuted(false);
  clock.advance(60000);
  assert.deepEqual(host.getView().result, leftResult(X));
  assert.deepEqual(guest.getView().result, leftResult(X));
  assert.equal(guest.getView().peer.status, CONNECTED, 'the host kept pinging');
  assert.equal(ofType([...hostEvents, ...guestEvents], 'result').length, 2);
  assert.deepEqual(hostTransport.sent.filter((m) => m.type === 'ping').at(-1).result, leftResult(X));
  assert.deepEqual(guest.place(7, 7), { ok: false, error: 'The game is over.' });
});

test('only the host is cut off: the guest wins and the host takes its claim', () => {
  const { clock, host, guest, hostTransport, hostEvents, guestEvents } = setup({ character: WIND_RABBIT });
  hostTransport.setMuted(true);
  clock.advance(PEER_TIMEOUT_MS + LEAVE_COUNTDOWN_S * 1000);
  assert.deepEqual(guest.getView().result, leftResult(O));
  assert.deepEqual(host.getView().result, leftResult(O));
  assert.deepEqual(ofType(hostEvents, 'result'), [{ type: 'result', result: leftResult(O) }]);
  hostTransport.setMuted(false);
  clock.advance(60000);
  assert.deepEqual(host.getView().result, leftResult(O));
  assert.deepEqual(guest.getView().result, leftResult(O));
  assert.equal(ofType(guestEvents, 'result').length, 1);
  assert.deepEqual(host.place(7, 7), { ok: false, error: 'The game is over.' });
});

test('both sides cut off at once: each counts down, then the host result wins when the link returns', () => {
  const { clock, host, guest, hostTransport, guestTransport, hostEvents, guestEvents } = setup({ character: EARTH_BEAR });
  hostTransport.setMuted(true);
  guestTransport.setMuted(true);
  clock.advance(PEER_TIMEOUT_MS + LEAVE_COUNTDOWN_S * 1000);
  assert.deepEqual(host.getView().result, leftResult(O));
  assert.deepEqual(guest.getView().result, leftResult(X));
  hostTransport.setMuted(false);
  guestTransport.setMuted(false);
  clock.advance(HEARTBEAT_INTERVAL_MS);
  assert.deepEqual(host.getView().result, leftResult(O));
  assert.deepEqual(guest.getView().result, leftResult(O));
  assert.deepEqual(ofType(guestEvents, 'result').map((e) => e.result), [leftResult(X), leftResult(O)]);
  assert.deepEqual(ofType(hostEvents, 'result').map((e) => e.result), [leftResult(O)]);
  clock.advance(60000);
  assert.deepEqual(guest.getView().result, leftResult(O));
});

test('a guest claim over a stale state is dropped when the game had ended by the rules', () => {
  const { clock, host, guest, hostTransport, hostEvents, guestEvents } = setup({ character: WIND_RABBIT });
  for (let i = 0; i < 4; i++) {
    host.place(i, 0);
    guest.place(i, 1);
  }
  hostTransport.setMuted(true);
  host.place(4, 0); // the winning move never reaches the guest
  assert.equal(host.state.winner, X);
  clock.advance(PEER_TIMEOUT_MS + LEAVE_COUNTDOWN_S * 1000);
  assert.deepEqual(guest.getView().result, leftResult(O));
  assert.equal(host.getView().result, null, 'the host ignores a claim after a rules win');
  hostTransport.setMuted(false);
  clock.advance(HEARTBEAT_INTERVAL_MS);
  assert.equal(guest.state.winner, X);
  assert.equal(guest.getView().result, null);
  assert.deepEqual(ofType(guestEvents, 'result').map((e) => e.result), [leftResult(O), null]);
  assert.equal(ofType(hostEvents, 'result').length, 0);
});

test('leaving after the game is over does not change the winner', () => {
  const { clock, host, guest, hostEvents } = setup({ character: WIND_RABBIT });
  for (let i = 0; i < 4; i++) {
    host.place(i, 0);
    guest.place(i, 1);
  }
  host.place(4, 0);
  assert.equal(host.state.winner, X);
  assert.equal(guest.state.winner, X);
  assert.deepEqual(host.place(5, 5), { ok: false, error: 'The game is over.' });
  guest.close();
  clock.advance(LEAVE_COUNTDOWN_S * 1000);
  assert.equal(host.getView().peer.status, GONE);
  assert.equal(host.getView().result, null);
  assert.equal(ofType(hostEvents, 'result').length, 0);
});

test('closing both sides stops every timer', () => {
  const { clock, host, guest } = setup();
  clock.advance(5000);
  guest.close();
  host.close();
  assert.equal(clock.pending, 0);
  host.close(); // closing twice is harmless
});

// --- Room phases: the host owns the start (docs/flow-design.md sections 5 and 6) ---

const sentOfType = (transport, type) => transport.sent.filter((m) => m.type === type);

test('the host sends start with round 1 after WAITING_START_DELAY_MS, not before', () => {
  assert.equal(WAITING_START_DELAY_MS, 1500);
  const { clock, host, guest, hostTransport, hostEvents, guestEvents } = setup({ start: false });
  assert.equal(host.phase, STARTING);
  assert.equal(guest.phase, STARTING);
  assert.equal(sentOfType(hostTransport, 'welcome').length, 1, 'welcome as before');
  clock.advance(WAITING_START_DELAY_MS - 1);
  assert.equal(sentOfType(hostTransport, 'start').length, 0);
  assert.equal(host.phase, STARTING);
  assert.equal(guest.phase, STARTING);
  clock.advance(1);
  assert.deepEqual(sentOfType(hostTransport, 'start'), [{ type: 'start', to: 'guest', round: 1, from: 'host' }]);
  assert.equal(host.phase, PLAYING);
  assert.equal(guest.phase, PLAYING);
  assert.equal(host.round, 1);
  assert.equal(guest.round, 1);
  assert.deepEqual(ofType(hostEvents, 'start'), [{ type: 'start', round: 1 }]);
  assert.deepEqual(ofType(guestEvents, 'start'), [{ type: 'start', round: 1 }], 'both windows get the same event');
  clock.advance(60000);
  assert.equal(sentOfType(hostTransport, 'start').length, 1, 'start is sent once');
});

test('the guest stays in starting until start arrives, with no timer of its own', () => {
  const { clock, host, guest, hostTransport, guestEvents } = setup({ start: false });
  hostTransport.setMuted(true); // the start never reaches the guest
  clock.advance(WAITING_START_DELAY_MS * 10);
  assert.equal(host.phase, PLAYING);
  assert.equal(guest.phase, STARTING);
  assert.equal(ofType(guestEvents, 'start').length, 0);
  assert.equal(guest.getView().yourTurn, false);
  // A start from someone who is not the host, or with no round, is ignored.
  hostTransport.setMuted(false);
  hostTransport.send({ type: 'start', from: 'host', to: 'guest' });
  hostTransport.send({ type: 'start', from: 'stranger', to: 'guest', round: 1 });
  assert.equal(guest.phase, STARTING);
});

test('a lost start is sent again: the host ping carries the round and the guest asks again', () => {
  const { clock, host, guest, hostTransport, guestEvents } = setup({ start: false });
  clock.advance(WAITING_START_DELAY_MS - 1);
  hostTransport.setMuted(true); // the start message is lost
  clock.advance(1);
  hostTransport.setMuted(false);
  assert.equal(host.phase, PLAYING);
  assert.equal(guest.phase, STARTING, 'the guest never starts on its own');
  clock.advance(HEARTBEAT_INTERVAL_MS);
  assert.equal(guest.phase, PLAYING);
  assert.equal(guest.round, 1);
  assert.deepEqual(ofType(guestEvents, 'start'), [{ type: 'start', round: 1 }]);
});

test('a guest leave at 700 ms cancels the start; a second guest can join and is welcomed', () => {
  const { network, clock, host, guest, hostTransport, hostEvents } = setup({ start: false });
  clock.advance(700);
  guest.close();
  assert.equal(host.phase, WAITING);
  assert.deepEqual(ofType(hostEvents, 'peerGone'), [{ type: 'peerGone', phase: STARTING }]);
  assert.equal(host.getView().peer, null);
  const sentBefore = hostTransport.sent.length;
  clock.advance(WAITING_START_DELAY_MS - 700);
  assert.equal(hostTransport.sent.length, sentBefore, 'nothing is sent at 1500 ms');
  clock.advance(10000);
  assert.equal(hostTransport.sent.length, sentBefore, 'no heartbeat to a guest who left');
  assert.equal(ofType(hostEvents, 'peer').length, 0);
  assert.equal(host.getView().result, null);

  const second = createGuestRoom({ transport: network.connect(), code: 'AB2C9', clock, id: 'second' });
  assert.equal(second.phase, STARTING);
  assert.equal(host.phase, STARTING);
  assert.deepEqual(sentOfType(hostTransport, 'welcome').map((m) => m.to), ['guest', 'second']);
  clock.advance(WAITING_START_DELAY_MS);
  assert.deepEqual(sentOfType(hostTransport, 'start').map((m) => m.to), ['second']);
  assert.equal(second.phase, PLAYING);
  assert.equal(host.phase, PLAYING);
});

test('a silent guest during a long start delay sends the host back to waiting', () => {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const hostTransport = network.connect();
  const host = createHostRoom({ transport: hostTransport, code: 'AB2C9', character: WIND_RABBIT, clock, id: 'host', startDelayMs: PEER_TIMEOUT_MS * 2 });
  const events = [];
  host.onEvent((e) => events.push(e));
  const guestTransport = network.connect();
  createGuestRoom({ transport: guestTransport, code: 'AB2C9', clock, id: 'guest' });
  guestTransport.setMuted(true);
  clock.advance(PEER_TIMEOUT_MS - 1);
  assert.equal(host.phase, STARTING);
  clock.advance(1);
  assert.equal(host.phase, WAITING);
  assert.deepEqual(ofType(events, 'peerGone'), [{ type: 'peerGone', phase: STARTING }]);
  clock.advance(PEER_TIMEOUT_MS * 2);
  assert.equal(sentOfType(hostTransport, 'start').length, 0);
});

test('when the host leaves during starting the guest is told once, with no countdown', () => {
  const { clock, host, guest, guestEvents } = setup({ start: false });
  clock.advance(500);
  host.close();
  assert.deepEqual(ofType(guestEvents, 'peerGone'), [{ type: 'peerGone', phase: STARTING }]);
  assert.equal(guest.phase, STARTING, 'the guest does not change phase on its own');
  clock.advance(LEAVE_COUNTDOWN_S * 1000 * 2);
  assert.equal(ofType(guestEvents, 'peerGone').length, 1);
  assert.equal(ofType(guestEvents, 'peer').length, 0);
  assert.equal(guest.getView().result, null);
  assert.deepEqual(guest.getView().peer, { status: GONE, secondsLeft: 0 });
});

test('a third window joining during starting or playing is told full', () => {
  const { network, clock, host, guest } = setup({ start: false });
  const join = (id) => createGuestRoom({ transport: network.connect(), code: 'AB2C9', clock, id });
  assert.equal(join('third').phase, FULL);
  assert.equal(host.phase, STARTING);
  clock.advance(WAITING_START_DELAY_MS);
  assert.equal(join('fourth').phase, FULL);
  assert.equal(host.phase, PLAYING);
  assert.equal(guest.phase, PLAYING);
});

test('a start recovered after a forfeit leaves the guest in phase over', () => {
  const { clock, host, guest, hostTransport, guestTransport, guestEvents } = setup({ start: false });
  clock.advance(WAITING_START_DELAY_MS - 1);
  hostTransport.setMuted(true); // the start is lost
  guestTransport.setMuted(true); // and the guest's messages too, until the host wins by forfeit
  clock.advance(1);
  hostTransport.setMuted(false);
  clock.advance(PEER_TIMEOUT_MS + LEAVE_COUNTDOWN_S * 1000);
  assert.equal(host.phase, OVER);
  assert.equal(guest.phase, STARTING);
  assert.deepEqual(guest.getView().result, leftResult(X), 'the guest heard the result while starting');
  guestTransport.setMuted(false);
  clock.advance(HEARTBEAT_INTERVAL_MS);
  assert.deepEqual(ofType(guestEvents, 'start'), [{ type: 'start', round: 1 }]);
  assert.equal(guest.phase, OVER, 'the recovered start does not reopen a finished game');
  assert.equal(guest.getView().yourTurn, false);
});

test('an action in starting is rejected with not-started and changes nothing', () => {
  const { host, guest, hostTransport, guestTransport, hostEvents, guestEvents } = setup({ start: false });
  const before = host.state;
  assert.deepEqual(host.place(7, 7), { ok: false, error: 'The game has not started yet.', reason: NOT_STARTED });
  assert.deepEqual(ofType(hostEvents, 'rejected'), [{ type: 'rejected', error: 'The game has not started yet.', reason: NOT_STARTED }]);
  assert.deepEqual(guest.place(7, 7), { ok: false, error: 'The game has not started yet.', reason: NOT_STARTED });
  assert.equal(sentOfType(guestTransport, 'action').length, 0, 'the guest does not send it');
  assert.equal(guest.getView().waiting, false);
  // An action message that reaches the host anyway is rejected too.
  guestTransport.send({ type: 'action', from: 'guest', to: 'host', action: { kind: 'place', x: 7, y: 7 }, requestId: 1 });
  assert.deepEqual(sentOfType(hostTransport, 'rejected'), [
    { type: 'rejected', to: 'guest', error: 'The game has not started yet.', reason: NOT_STARTED, requestId: 1, seq: 0, handled: 0, from: 'host' },
  ]);
  assert.deepEqual(ofType(guestEvents, 'rejected').at(-1), { type: 'rejected', error: 'The game has not started yet.', reason: NOT_STARTED });
  assert.equal(host.state, before, 'the state is unchanged');
  assert.equal(host.state.board[7][7], EMPTY);
  assert.equal(sentOfType(hostTransport, 'state').length, 0);
  assert.equal(ofType([...hostEvents, ...guestEvents], 'state').length, 0);
  assert.equal(host.getView().yourTurn, false);
  assert.equal(guest.getView().yourTurn, false);
});

test('no countdown in waiting: a host alone for a long time sees nothing', () => {
  const { clock, host, hostEvents } = setup({ join: false });
  clock.advance(PEER_TIMEOUT_MS + LEAVE_COUNTDOWN_S * 1000);
  assert.equal(host.phase, WAITING);
  assert.equal(host.getView().peer, null);
  assert.equal(host.getView().result, null);
  assert.deepEqual(hostEvents, []);
});

test('no countdown in starting: a silent host is reported gone once, no forfeit', () => {
  const { clock, guest, hostTransport, guestEvents } = setup({ start: false });
  hostTransport.setMuted(true);
  clock.advance(LEAVE_COUNTDOWN_S * 1000);
  assert.equal(guest.phase, STARTING);
  assert.equal(ofType(guestEvents, 'peer').length, 0);
  assert.equal(ofType(guestEvents, 'result').length, 0);
  assert.deepEqual(ofType(guestEvents, 'peerGone'), [{ type: 'peerGone', phase: STARTING }]);
});

// Plays a quick win for the host (Wind Rabbit, X) over the guest.
function hostWins({ host, guest }) {
  for (let i = 0; i < 4; i++) {
    host.place(i, 0);
    guest.place(i, 1);
  }
  host.place(4, 0);
}

test('a win makes the phase over on both sides', () => {
  const ctx = setup({ character: WIND_RABBIT });
  hostWins(ctx);
  assert.equal(ctx.host.state.winner, X);
  assert.equal(ctx.host.phase, OVER);
  assert.equal(ctx.guest.phase, OVER);
  assert.deepEqual(ctx.host.place(9, 9), { ok: false, error: 'The game is over.' });
});

test('no countdown in over: a silent peer is reported gone once, the winner stays', () => {
  const ctx = setup({ character: WIND_RABBIT });
  const { clock, host, guestTransport, hostEvents } = ctx;
  hostWins(ctx);
  const peersBefore = ofType(hostEvents, 'peer').length;
  guestTransport.setMuted(true);
  clock.advance(LEAVE_COUNTDOWN_S * 1000);
  assert.equal(ofType(hostEvents, 'peer').length, peersBefore, 'no countdown');
  assert.deepEqual(ofType(hostEvents, 'peerGone'), [{ type: 'peerGone', phase: OVER }]);
  assert.equal(host.getView().result, null);
  assert.equal(host.state.winner, X);
  assert.equal(host.phase, OVER);
  assert.deepEqual(host.getView().peer, { status: GONE, secondsLeft: 0 });
  guestTransport.setMuted(false);
  clock.advance(LEAVE_COUNTDOWN_S * 1000);
  assert.equal(ofType(hostEvents, 'peerGone').length, 1, 'reported once');
});

test('a forfeit makes the phase over', () => {
  const { clock, host, guest, guestTransport } = setup({ character: EARTH_BEAR });
  guestTransport.setMuted(true);
  clock.advance(PEER_TIMEOUT_MS + LEAVE_COUNTDOWN_S * 1000 - 1);
  assert.equal(host.phase, PLAYING);
  clock.advance(1);
  assert.deepEqual(host.getView().result, { winner: O, reason: 'opponentLeft' });
  assert.equal(host.phase, OVER);
  assert.equal(guest.phase, OVER, 'the guest takes the host result');
});
