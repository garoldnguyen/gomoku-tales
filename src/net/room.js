// Host-authoritative room controllers (docs/design.md section 6). Pure of
// the DOM: they talk through a transport (see transport.js) and take their
// time and timers from a clock (see clock.js), so tests can run two rooms
// over the fake transport with a fake clock.
//
// The host is the window that created the room. It owns the game state,
// checks and applies every action (its own and the guest's), makes the
// random choices and sends the new state and events to the guest. The guest
// only sends action requests and shows what the host sends.
//
// Messages are plain objects { type, from, to?, ... }. from is the sender's
// peer id; to is the peer the message is meant for, since other windows on
// the same channel may hear it too.
//   join      guest -> host   ask for a seat; repeated every HEARTBEAT_INTERVAL_MS
//                             until answered, and sent again later to resync
//   welcome   host -> guest   { character, hostCharacter, state, seq, result }
//   full      host -> other   the room already has two players
//   action    guest -> host   { action, requestId }
//   state     host -> guest   { state, events, seq } after every applied action
//   rejected  host -> guest   { error, requestId } for an invalid action
//   ping      both ways       heartbeat, every HEARTBEAT_INTERVAL_MS; the
//                             host's carries its seq so the guest notices a
//                             lost state message and asks for a resync. Once
//                             a side has a result it adds { result }, and
//                             keeps pinging so a peer that is still there
//                             learns the outcome
//   leave     both ways       sent when the page closes
//
// Actions are { kind: 'place', x, y } or { kind: 'skill', skill, target };
// the host fills in the acting player from who sent it.
//
// Leave results: when the countdown runs out mid-game, that side takes the
// win and tells the other side through its pings, so both agree even when
// only one direction was cut. A guest that learns the host's result takes
// it, even over its own (the host decides when both counted down at once).
// The host takes the guest's claim unless it already has a result or the
// game already ended by the rules; a guest that resyncs to such a finished
// game drops its claim.
//
// Room events, passed to handlers given to onEvent:
//   { type: 'joined', character }         host: the guest took a seat; guest: welcomed
//   { type: 'full' }                      guest: the room already has two players
//   { type: 'noRoom' }                    guest: nobody answered the join
//   { type: 'state', state, events }      an action was applied
//   { type: 'rejected', error }           this window's action was not allowed
//   { type: 'peer', status, secondsLeft } the opponent's presence changed (presence.js)
//   { type: 'result', result }            the leave result changed: { winner, reason:
//                                         'opponentLeft' }, or null when a guest's claim
//                                         was dropped because the game ended by the rules

import { HEARTBEAT_INTERVAL_MS, JOIN_TIMEOUT_MS, PRESENCE_CHECK_INTERVAL_MS } from '../config.js';
import { CHARACTERS, EARTH_BEAR, WIND_RABBIT } from '../logic/characters.js';
import { createInitialState, isGameOver, placeStone, useSkill } from '../logic/game.js';
import { systemClock } from './clock.js';
import { CONNECTED, GONE, checkPresence, createPresence, markHeard, markLeft } from './presence.js';

export const HOST = 'host';
export const GUEST = 'guest';

// Room phases.
export const WAITING = 'waiting'; // host: no guest yet
export const JOINING = 'joining'; // guest: join sent, no answer yet
export const PLAYING = 'playing'; // both players seated
export const FULL = 'full'; // guest: the room was full
export const NO_ROOM = 'noRoom'; // guest: nobody answered
export const CLOSED = 'closed'; // this window left

export function otherCharacter(character) {
  return character === WIND_RABBIT ? EARTH_BEAR : WIND_RABBIT;
}

export function makePeerId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Creates the room as its host. options.character is the character the
// host picked; options.random is used for the Tornado Zone throw.
export function createHostRoom(options) {
  const { transport, code, character, clock = systemClock, random = Math.random, id = makePeerId() } = options;
  if (!Object.hasOwn(CHARACTERS, character)) throw new Error(`Unknown character: ${character}`);
  const guestCharacter = otherCharacter(character);
  const guestStone = CHARACTERS[guestCharacter].stone;

  const room = createRoomCore({ role: HOST, transport, code, character, clock, id });
  room.phase = WAITING;
  room.state = createInitialState();

  const welcome = () => ({
    type: 'welcome',
    to: room.peerId,
    character: guestCharacter,
    hostCharacter: character,
    state: room.state,
    seq: room.seq,
    result: room.result,
  });

  // Applies an action for player. Returns { ok: true } or { ok: false, error }.
  const apply = (player, action) => {
    const error = actionBlocker(room);
    if (error) return { ok: false, error };
    const result = runAction(room.state, player, action, random);
    if (!result.ok) return { ok: false, error: result.error };
    room.state = result.state;
    room.seq += 1;
    room.send({ type: 'state', to: room.peerId, state: room.state, events: result.events, seq: room.seq });
    room.emit({ type: 'state', state: room.state, events: result.events });
    return { ok: true };
  };

  room.handle = (message) => {
    if (message.type === 'join') {
      if (room.phase === WAITING) {
        room.peerId = message.from;
        room.phase = PLAYING;
        room.send(welcome());
        room.startLink();
        room.emit({ type: 'joined', character: guestCharacter });
      } else if (message.from === room.peerId) {
        room.heard();
        room.send(welcome()); // the guest asked again; seat it again
      } else {
        room.send({ type: 'full', to: message.from });
      }
      return;
    }
    if (message.from !== room.peerId) return;
    room.receiveCommon(message);
    if (message.type === 'ping' && isClaim(message.result, guestStone) && !room.result && !isGameOver(room.state)) {
      room.setResult({ winner: guestStone, reason: 'opponentLeft' });
    }
    if (message.type === 'action') {
      const result = apply(guestStone, message.action);
      if (!result.ok) room.send({ type: 'rejected', to: room.peerId, error: result.error, requestId: message.requestId ?? null });
    }
  };

  room.act = (action) => {
    const result = apply(room.stone, action);
    if (!result.ok) room.emit({ type: 'rejected', error: result.error });
    return result;
  };

  return room.api;
}

// Creates this window's side of an existing room as the guest and sends
// the join request, repeating it until the room answers with welcome or
// full (a lost welcome is simply sent again); if nobody answers within
// JOIN_TIMEOUT_MS the phase becomes NO_ROOM.
export function createGuestRoom(options) {
  const { transport, code, clock = systemClock, id = makePeerId(), joinTimeoutMs = JOIN_TIMEOUT_MS } = options;
  const room = createRoomCore({ role: GUEST, transport, code, character: null, clock, id });
  room.phase = JOINING;
  let requestId = 0;

  const joinRetry = room.addTimer(clock.setInterval(() => room.send({ type: 'join' }), HEARTBEAT_INTERVAL_MS), 'interval');
  const joinTimer = room.addTimer(clock.setTimeout(() => {
    if (room.phase !== JOINING) return;
    clock.clearInterval(joinRetry);
    room.phase = NO_ROOM;
    room.emit({ type: 'noRoom' });
  }, joinTimeoutMs), 'timeout');
  const stopJoining = () => {
    clock.clearTimeout(joinTimer);
    clock.clearInterval(joinRetry);
  };

  room.handle = (message) => {
    if (message.to !== id) return;
    if (room.phase === JOINING) {
      if (message.type === 'welcome' && Object.hasOwn(CHARACTERS, message.character)) {
        stopJoining();
        room.peerId = message.from;
        room.phase = PLAYING;
        room.setCharacter(message.character);
        room.hostCharacter = otherCharacter(message.character);
        room.state = message.state;
        room.seq = message.seq;
        room.startLink();
        room.emit({ type: 'joined', character: message.character });
      } else if (message.type === 'full') {
        stopJoining();
        room.phase = FULL;
        room.emit({ type: 'full' });
      }
      return;
    }
    if (message.from !== room.peerId) return;
    room.receiveCommon(message);
    if ((message.type === 'state' || message.type === 'welcome') && message.seq > room.seq) {
      room.state = message.state;
      room.seq = message.seq;
      room.emit({ type: 'state', state: room.state, events: message.events ?? [] });
    } else if (message.type === 'rejected') {
      room.emit({ type: 'rejected', error: message.error });
    } else if (message.type === 'ping' && message.seq > room.seq) {
      room.send({ type: 'join' }); // a state message was lost; the host answers with a fresh welcome
    }
    if (message.type !== 'ping' && message.type !== 'welcome') return;
    if (isClaim(message.result, CHARACTERS[room.hostCharacter].stone)) {
      room.setResult({ winner: message.result.winner, reason: 'opponentLeft' }); // the host decides
    } else if (room.result && isGameOver(room.state)) {
      room.setResult(null); // the game had already ended by the rules before this side counted down
    }
  };

  // Sends the action to the host. Returns { ok: true, requestId } when it
  // was sent (the host may still reject it) or { ok: false, error } when it
  // cannot be sent now.
  room.act = (action) => {
    const error = actionBlocker(room);
    if (error) {
      room.emit({ type: 'rejected', error });
      return { ok: false, error };
    }
    requestId += 1;
    room.send({ type: 'action', to: room.peerId, action, requestId });
    return { ok: true, requestId };
  };

  room.send({ type: 'join' });
  return room.api;
}

// Why no action can be taken in the room now, or null.
function actionBlocker(room) {
  if (room.phase === WAITING) return 'Waiting for opponent.';
  if (room.phase !== PLAYING) return 'You are not in a game.';
  if (room.result || isGameOver(room.state)) return 'The game is over.';
  return null;
}

// Whether a result sent by the peer says winner won because the other left.
function isClaim(result, winner) {
  return result?.reason === 'opponentLeft' && result.winner === winner;
}

// Runs a room action through the game rules.
function runAction(state, player, action, random) {
  if (action?.kind === 'place') return placeStone(state, { player, x: action.x, y: action.y }, { random });
  if (action?.kind === 'skill') return useSkill(state, { player, skill: action.skill, target: action.target ?? null });
  return { ok: false, error: 'Unknown action.' };
}

// What host and guest share: sending, events, heartbeat and leave
// detection, the view and closing.
function createRoomCore({ role, transport, code, character, clock, id }) {
  const handlers = new Set();
  const timers = []; // [{ id, kind }]
  let presence = null;
  let checkTimer = null;
  let lastPeer = null; // last { status, secondsLeft } sent in a 'peer' event
  let unsubscribe = null;

  const room = {
    role,
    code,
    id,
    phase: null,
    character: null,
    stone: null,
    hostCharacter: role === HOST ? character : null,
    peerId: null,
    state: null,
    seq: 0,
    result: null, // { winner, reason: 'opponentLeft' } when a player left mid-game
    handle: () => {},
    act: () => ({ ok: false, error: 'You are not in a game.' }),

    setCharacter(value) {
      room.character = value;
      room.stone = CHARACTERS[value].stone;
    },

    send(message) {
      transport.send({ ...message, from: id });
    },

    emit(event) {
      for (const handler of [...handlers]) handler(event);
    },

    setResult(result) {
      if (room.result?.winner === result?.winner) return;
      room.result = result;
      room.emit({ type: 'result', result });
    },

    addTimer(timerId, kind) {
      timers.push({ id: timerId, kind });
      return timerId;
    },

    // Starts the heartbeat and leave detection once both players are in.
    startLink() {
      presence = createPresence(clock.now());
      lastPeer = { status: CONNECTED, secondsLeft: null };
      room.addTimer(clock.setInterval(ping, HEARTBEAT_INTERVAL_MS), 'interval');
      checkTimer = room.addTimer(clock.setInterval(check, PRESENCE_CHECK_INTERVAL_MS), 'interval');
    },

    heard() {
      if (!presence) return;
      presence = markHeard(presence, clock.now());
      check();
    },

    // Handles what every message from the seated peer means for presence.
    receiveCommon(message) {
      if (message.type === 'leave') {
        presence = markLeft(presence, clock.now());
        check();
      } else {
        room.heard();
      }
    },

    api: null,
  };

  const ping = () => {
    room.send({
      type: 'ping',
      to: room.peerId,
      ...(role === HOST ? { seq: room.seq } : {}),
      ...(room.result ? { result: room.result } : {}),
    });
  };

  // Re-checks the opponent's presence; emits when it changed. When the
  // countdown runs out mid-game this side wins and pings the result at once;
  // the heartbeat keeps going so a peer that is still there hears it.
  const check = () => {
    if (!presence) return;
    const { presence: next, status, secondsLeft } = checkPresence(presence, clock.now());
    presence = next;
    if (status === lastPeer.status && secondsLeft === lastPeer.secondsLeft) return;
    lastPeer = { status, secondsLeft };
    room.emit({ type: 'peer', status, secondsLeft });
    if (status !== GONE) return;
    clock.clearInterval(checkTimer);
    if (room.result || isGameOver(room.state)) return;
    room.setResult({ winner: room.stone, reason: 'opponentLeft' });
    ping();
  };

  const stopTimers = () => {
    for (const timer of timers.splice(0)) {
      if (timer.kind === 'timeout') clock.clearTimeout(timer.id);
      else clock.clearInterval(timer.id);
    }
  };

  if (character) room.setCharacter(character);

  unsubscribe = transport.onMessage((message) => {
    if (room.phase === CLOSED) return;
    if (!message || typeof message.type !== 'string' || typeof message.from !== 'string' || message.from === id) return;
    room.handle(message);
  });

  room.api = {
    get role() {
      return room.role;
    },
    get code() {
      return room.code;
    },
    get id() {
      return room.id;
    },
    get phase() {
      return room.phase;
    },
    get state() {
      return room.state;
    },

    onEvent(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },

    // Requests an action for this window's player (see the actions above).
    act(action) {
      return room.act(action);
    },

    place(x, y) {
      return room.act({ kind: 'place', x, y });
    },

    useSkill(skill, target) {
      return room.act({ kind: 'skill', skill, target });
    },

    // Everything the screens need. peer is null until both players are in;
    // then { status, secondsLeft } as in presence.js, computed for now.
    getView() {
      const peer = presence ? checkPresence(presence, clock.now()) : null;
      const canAct = actionBlocker(room) === null && room.state.currentPlayer === room.stone;
      return {
        role: room.role,
        code: room.code,
        phase: room.phase,
        character: room.character,
        hostCharacter: room.hostCharacter,
        you: room.stone,
        state: room.state,
        peer: peer && { status: peer.status, secondsLeft: peer.secondsLeft },
        result: room.result,
        yourTurn: canAct,
      };
    },

    // Leaves the room: tells a seated opponent (unless they are already
    // gone), stops all timers and closes the transport. Call it when the
    // page closes.
    close() {
      if (room.phase === CLOSED) return;
      if (presence && presence.goneAt === null) room.send({ type: 'leave', to: room.peerId });
      room.phase = CLOSED;
      stopTimers();
      handlers.clear();
      unsubscribe?.();
      transport.close();
    },
  };

  return room;
}
