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
//   welcome   host -> guest   { character, hostCharacter, state, seq, handled, result }
//   start     host -> guest   { round } the start delay ended: the game begins
//   full      host -> other   the room already has two players
//   action    guest -> host   { action, requestId }; requestId counts up from 1
//   state     host -> guest   { state, events, seq, handled } after every applied action
//   rejected  host -> guest   { error, reason?, requestId, seq, handled } for an invalid
//                             action; reason is NOT_STARTED before phase playing
//   ping      both ways       heartbeat, every HEARTBEAT_INTERVAL_MS; the
//                             host's carries its seq so the guest notices a
//                             lost state message and asks for a resync, and
//                             handled so the guest notices a lost action
//                             request (or a lost answer to it), and round
//                             so a guest still in starting notices a lost
//                             start. Once
//                             a side has a result it adds { result }, and
//                             keeps pinging so a peer that is still there
//                             learns the outcome
//   leave     both ways       sent when the page closes
//
// Actions are { kind: 'place', x, y } or { kind: 'skill', skill, target };
// the host fills in the acting player from who sent it.
//
// Phases (docs/flow-design.md sections 5 and 6, ROOM_PHASES in phase.js) are
// owned by the host. The room starts in waiting; a join is accepted only
// then (any other window is told full) and the phase becomes starting. After
// startDelayMs (WAITING_START_DELAY_MS) the host enters playing and sends
// start with the round; the guest enters playing only when start arrives.
// If the guest goes missing during starting the host cancels the start and
// waits again. A win, a draw or a forfeit makes the phase over. Actions
// before playing are rejected with reason NOT_STARTED and change nothing.
//
// Presence by phase: the heartbeat runs in every phase and restarts when the
// game starts. The leave countdown and the forfeit run only in playing. In
// the other phases a missing peer (a leave message, or PEER_TIMEOUT_MS of
// silence) is reported once with a peerGone event.
//
// Lost actions: handled is the requestId of the last guest action the host
// applied or rejected. Until a host message shows the guest's request as
// handled and the guest has the state that followed it, the guest waits and
// sends the same request again with every host ping it hears. The host skips
// a request it has already handled, so a repeat is never applied twice.
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
//                                         (both are now in phase starting)
//   { type: 'start', round }              both: the host started the game (phase playing)
//   { type: 'peerGone', phase }           the peer went missing outside phase playing; phase
//                                         is where it happened. A host in starting is back in
//                                         waiting when this arrives
//   { type: 'full' }                      guest: the room already has two players
//   { type: 'noRoom' }                    guest: nobody answered the join
//   { type: 'state', state, events }      an action was applied
//   { type: 'rejected', error }           this window's action was not allowed
//   { type: 'peer', status, secondsLeft } the opponent's presence changed (presence.js)
//   { type: 'result', result }            the leave result changed: { winner, reason:
//                                         'opponentLeft' }, or null when a guest's claim
//                                         was dropped because the game ended by the rules

import { HEARTBEAT_INTERVAL_MS, JOIN_TIMEOUT_MS, PRESENCE_CHECK_INTERVAL_MS, WAITING_START_DELAY_MS } from '../config.js';
import { CHARACTERS, EARTH_BEAR, WIND_RABBIT } from '../logic/characters.js';
import { createInitialState, isGameOver, placeStone, useSkill } from '../logic/game.js';
import { systemClock } from './clock.js';
import { ROOM_PHASES } from './phase.js';
import { CONNECTED, GONE, checkPresence, countdownStart, createPresence, markHeard, markLeft } from './presence.js';

export const HOST = 'host';
export const GUEST = 'guest';

// Room phases: the four of ROOM_PHASES, and the guest's own before and after.
export const WAITING = ROOM_PHASES.WAITING; // host: no guest yet
export const STARTING = ROOM_PHASES.STARTING; // both seated, the host's start delay runs
export const PLAYING = ROOM_PHASES.PLAYING; // the game runs
export const OVER = ROOM_PHASES.OVER; // the game ended (win, draw or forfeit)
export const JOINING = 'joining'; // guest: join sent, no answer yet
export const FULL = 'full'; // guest: the room was full
export const NO_ROOM = 'noRoom'; // guest: nobody answered
export const CLOSED = 'closed'; // this window left

// Reason of a rejected action that came before phase playing.
export const NOT_STARTED = 'not-started';
export const NOT_STARTED_ERROR = 'The game has not started yet.';

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
  const {
    transport,
    code,
    character,
    clock = systemClock,
    random = Math.random,
    id = makePeerId(),
    startDelayMs = WAITING_START_DELAY_MS,
  } = options;
  if (!Object.hasOwn(CHARACTERS, character)) throw new Error(`Unknown character: ${character}`);
  const guestCharacter = otherCharacter(character);
  const guestStone = CHARACTERS[guestCharacter].stone;

  const room = createRoomCore({ role: HOST, transport, code, character, clock, id });
  room.phase = WAITING;
  room.state = createInitialState();
  let startTimer = null;

  const welcome = () => ({
    type: 'welcome',
    to: room.peerId,
    character: guestCharacter,
    hostCharacter: character,
    state: room.state,
    seq: room.seq,
    handled: room.handled,
    result: room.result,
  });

  // An accepted join: seat the guest and start the start delay.
  const seat = (peerId) => {
    room.peerId = peerId;
    room.phase = STARTING;
    room.send(welcome());
    room.startLink();
    startTimer = room.addTimer(clock.setTimeout(start, startDelayMs), 'timeout');
    room.emit({ type: 'joined', character: guestCharacter });
  };

  // The start delay ended: the game begins on both sides at once.
  const start = () => {
    room.removeTimer(startTimer);
    startTimer = null;
    room.round = 1;
    room.phase = PLAYING;
    room.restartLink();
    room.send({ type: 'start', to: room.peerId, round: room.round });
    room.emit({ type: 'start', round: room.round });
  };

  // The guest went missing during starting: cancel the start and wait for
  // a new guest.
  room.lostPeer = (phase) => {
    if (phase !== STARTING) return;
    clock.clearTimeout(startTimer);
    room.removeTimer(startTimer);
    startTimer = null;
    room.stopLink();
    room.peerId = null;
    room.phase = WAITING;
  };

  // Applies an action for player. Returns { ok: true } or { ok: false, error, reason? }.
  const apply = (player, action) => {
    const blocker = actionBlocker(room);
    if (blocker) return { ok: false, ...blocker };
    const result = runAction(room.state, player, action, random);
    if (!result.ok) return { ok: false, error: result.error };
    room.state = result.state;
    room.seq += 1;
    room.updateOver();
    room.send({ type: 'state', to: room.peerId, state: room.state, events: result.events, seq: room.seq, handled: room.handled });
    room.emit({ type: 'state', state: room.state, events: result.events });
    return { ok: true };
  };

  room.handle = (message) => {
    if (message.type === 'join') {
      if (message.from === room.peerId) {
        room.heard();
        room.send(welcome()); // the guest asked again; seat it again
        if (room.round > 0) room.send({ type: 'start', to: room.peerId, round: room.round }); // and the start it missed
      } else if (room.phase === WAITING) {
        seat(message.from);
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
      const requestId = Number.isInteger(message.requestId) ? message.requestId : null;
      if (room.phase === STARTING) {
        // Too early: answered, but not counted as handled, and nothing changes.
        room.send({ type: 'rejected', to: room.peerId, error: NOT_STARTED_ERROR, reason: NOT_STARTED, requestId, seq: room.seq, handled: room.handled });
        return;
      }
      if (requestId !== null) {
        if (requestId <= room.handled) return; // a repeat of a request already answered
        room.handled = requestId;
      }
      const result = apply(guestStone, message.action);
      if (!result.ok) {
        const { error, reason } = result;
        room.send({ type: 'rejected', to: room.peerId, error, ...(reason ? { reason } : {}), requestId, seq: room.seq, handled: room.handled });
      }
    }
  };

  room.act = (action) => {
    const result = apply(room.stone, action);
    if (!result.ok) room.emit({ type: 'rejected', ...withoutOk(result) });
    return result;
  };

  return room.api;
}

// Creates this window's side of an existing room as the guest and sends
// the join request, repeating it until the room answers with welcome or
// full (a lost welcome is simply sent again); if nobody answers within
// JOIN_TIMEOUT_MS the phase becomes NO_ROOM. After welcome the guest is in
// phase starting until the host's start arrives.
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
        room.phase = STARTING;
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
    if (message.type === 'start') {
      if (room.phase !== STARTING || !Number.isInteger(message.round)) return;
      room.round = message.round;
      room.phase = PLAYING;
      room.updateOver(); // a start recovered late: the game may have ended meanwhile (a forfeit)
      room.restartLink();
      room.emit({ type: 'start', round: room.round });
      return;
    }
    let stateEvent = null;
    if ((message.type === 'state' || message.type === 'welcome') && message.seq > room.seq) {
      room.state = message.state;
      room.seq = message.seq;
      room.updateOver();
      stateEvent = { type: 'state', state: room.state, events: message.events ?? [] };
    }
    // The request is settled once the host has handled it and this side
    // has caught up with the state that followed.
    if (room.pending && message.handled >= room.pending.requestId && !(message.seq > room.seq)) room.pending = null;
    if (stateEvent) {
      room.emit(stateEvent);
    } else if (message.type === 'rejected') {
      room.emit({ type: 'rejected', error: message.error, ...(message.reason ? { reason: message.reason } : {}) });
    } else if (message.type === 'ping' && (message.seq > room.seq || (room.phase === STARTING && message.round > 0))) {
      room.send({ type: 'join' }); // a state or start message was lost; the host answers with a fresh welcome (and start)
    } else if (message.type === 'ping' && room.pending && !(message.handled >= room.pending.requestId)) {
      room.send({ type: 'action', to: room.peerId, ...room.pending }); // the request or its answer was lost
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
    const blocker = actionBlocker(room) ?? (room.pending ? { error: 'Waiting for the host...' } : null);
    if (blocker) {
      room.emit({ type: 'rejected', ...blocker });
      return { ok: false, ...blocker };
    }
    requestId += 1;
    room.pending = { action, requestId };
    room.send({ type: 'action', to: room.peerId, action, requestId });
    return { ok: true, requestId };
  };

  room.send({ type: 'join' });
  return room.api;
}

// Why no action can be taken in the room now ({ error, reason? }), or null.
function actionBlocker(room) {
  if (room.phase === WAITING) return { error: 'Waiting for opponent.' };
  if (room.phase === STARTING) return { error: NOT_STARTED_ERROR, reason: NOT_STARTED };
  if (room.phase === OVER) return { error: 'The game is over.' };
  if (room.phase !== PLAYING) return { error: 'You are not in a game.' };
  if (room.result || isGameOver(room.state)) return { error: 'The game is over.' };
  return null;
}

function withoutOk({ ok, ...rest }) {
  return rest;
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
  let pingTimer = null;
  let checkTimer = null;
  let lastPeer = null; // last { status, secondsLeft } sent in a 'peer' event
  let peerGoneReported = false; // the peer was reported gone (or forfeited) on this link
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
    round: 0, // the game of this room: 1 for the first, 0 before the start
    handled: 0, // host: requestId of the last guest action applied or rejected
    pending: null, // guest: { action, requestId } sent and not yet settled by the host
    result: null, // { winner, reason: 'opponentLeft' } when a player left mid-game
    handle: () => {},
    act: () => ({ ok: false, error: 'You are not in a game.' }),
    lostPeer: () => {}, // (phase) the peer went missing outside phase playing

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
      room.updateOver();
      room.emit({ type: 'result', result });
    },

    // A running game that has ended (win, draw or forfeit) is over.
    updateOver() {
      if (room.phase === PLAYING && (room.result || isGameOver(room.state))) room.phase = OVER;
    },

    addTimer(timerId, kind) {
      timers.push({ id: timerId, kind });
      return timerId;
    },

    // Forgets a timer that fired or was cleared.
    removeTimer(timerId) {
      const index = timers.findIndex((timer) => timer.id === timerId);
      if (index >= 0) timers.splice(index, 1);
    },

    // Starts the heartbeat and leave detection once both players are in.
    startLink() {
      presence = createPresence(clock.now());
      lastPeer = { status: CONNECTED, secondsLeft: null };
      peerGoneReported = false;
      pingTimer = room.addTimer(clock.setInterval(ping, HEARTBEAT_INTERVAL_MS), 'interval');
      checkTimer = room.addTimer(clock.setInterval(check, PRESENCE_CHECK_INTERVAL_MS), 'interval');
    },

    // Stops the heartbeat and leave detection and forgets the peer's presence.
    stopLink() {
      for (const timerId of [pingTimer, checkTimer]) {
        clock.clearInterval(timerId);
        room.removeTimer(timerId);
      }
      pingTimer = null;
      checkTimer = null;
      presence = null;
    },

    // A fresh link when the game starts: the heartbeat and the silence
    // timing count from now.
    restartLink() {
      room.stopLink();
      room.startLink();
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
      ...(role === HOST ? { seq: room.seq, handled: room.handled } : {}),
      ...(role === HOST && room.round > 0 ? { round: room.round } : {}),
      ...(room.result ? { result: room.result } : {}),
    });
  };

  // Re-checks the opponent's presence; emits when it changed. When the
  // countdown runs out mid-game this side wins and pings the result at once;
  // the heartbeat keeps going so a peer that is still there hears it.
  // Outside phase playing there is no countdown: a missing peer is
  // reported once with peerGone.
  const check = () => {
    if (!presence) return;
    if (room.phase !== PLAYING) {
      checkMissing();
      return;
    }
    const { presence: next, status, secondsLeft } = checkPresence(presence, clock.now());
    presence = next;
    if (status === lastPeer.status && secondsLeft === lastPeer.secondsLeft) return;
    lastPeer = { status, secondsLeft };
    room.emit({ type: 'peer', status, secondsLeft });
    if (status !== GONE) return;
    peerGoneReported = true;
    clock.clearInterval(checkTimer);
    if (room.result || isGameOver(room.state)) return;
    room.setResult({ winner: room.stone, reason: 'opponentLeft' });
    ping();
  };

  const checkMissing = () => {
    if (peerGoneReported) return;
    const now = clock.now();
    if (presence.goneAt === null && countdownStart(presence, now) === null) return;
    peerGoneReported = true;
    if (presence.goneAt === null) presence = { ...presence, goneAt: now };
    const phase = room.phase;
    room.lostPeer(phase);
    room.emit({ type: 'peerGone', phase });
  };

  // The opponent's presence for the view: the countdown only in playing.
  const peerView = () => {
    if (!presence) return null;
    if (room.phase === PLAYING) {
      const { status, secondsLeft } = checkPresence(presence, clock.now());
      return { status, secondsLeft };
    }
    return presence.goneAt === null ? { status: CONNECTED, secondsLeft: null } : { status: GONE, secondsLeft: 0 };
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
    get round() {
      return room.round;
    },

    onEvent(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },

    // Calls handler({ type: 'peerGone', phase }) once when the peer goes
    // missing outside phase playing; returns a function that removes it.
    onPeerGone(handler) {
      return room.api.onEvent((event) => {
        if (event.type === 'peerGone') handler(event);
      });
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
    // then { status, secondsLeft } as in presence.js, computed for now (a
    // countdown only in phase playing). waiting is true while a guest's
    // action request is not yet settled.
    getView() {
      const peer = peerView();
      const canAct = actionBlocker(room) === null && room.state.currentPlayer === room.stone;
      return {
        role: room.role,
        code: room.code,
        phase: room.phase,
        round: room.round,
        character: room.character,
        hostCharacter: room.hostCharacter,
        you: room.stone,
        state: room.state,
        peer,
        result: room.result,
        yourTurn: canAct,
        waiting: room.pending !== null,
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
