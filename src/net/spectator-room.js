// The spectator's side of a room (Watch a match, docs/flow-design.md
// sections 3.8 and 3.9). Pure of the DOM, like room.js. A spectator only
// listens: it never calls transport.send, has no seat, no presence, no
// heartbeat and no leave countdown, and every action it is asked for is
// refused without a message. The host never learns it is there.
//
// Through the relay (src/net/ws-transport.js, role spectator) it hears the
// host's messages only: the replay of the last seats, state, start,
// new-game and rematch-status when it connects, then every live host
// message (welcome, seats, start, state, ping, new-game, rematch-status).
// A masked host message (the guest's copy, with hidden cells covered) is
// read without its state: the full one follows marked spectatorsOnly.
// It builds the room from them:
//   seats  from seats, welcome, start and the host's pings before the start
//   state  the newest game state: the host's seq only grows (start, every
//          state, new-game), so a message with an older seq (the replayed
//          start after the replayed state) is dropped
//   result the leave result of the round, from welcome or a host ping
//   guest  whether a guest sits in the room: the host pings only while a
//          guest is linked, welcomes one when it joins, and says it in
//          every seats message (guest false when the guest went before the
//          start, so its seat is shown empty again)
// When the host leaves (its leave message, or the relay's leave sent when
// the host's socket closed) the room is closed and reports roomClosed.
//
// Phases: waiting (no game yet), playing, over (a win, a draw or a
// forfeit), closed (the host left, or close() was called).
//
// Events, passed to handlers given to onEvent:
//   { type: 'seats', seats }           the seats changed
//   { type: 'start', round }           the first game state arrived
//   { type: 'state', state, events }   a move or skill was applied (live)
//   { type: 'newGame', round }         a rematch began with a fresh board
//   { type: 'result', result }         the leave result changed
//   { type: 'roomClosed' }             the host left; nothing more comes

import { isGameOver } from '../logic/game.js';
import { createSeats, isSeats } from '../logic/seats.js';
import { ROOM_PHASES } from './phase.js';
import { CLOSED, ROOM_SEATS } from './room.js';

export const SPECTATOR = 'spectator';
export const SPECTATOR_ERROR = 'Spectators only watch.';

// The host messages a spectator reads; only the host sends these.
const HOST_ONLY = Object.freeze(['welcome', 'seats', 'start', 'state', 'new-game', 'rematch-status']);

const refused = () => ({ ok: false, error: SPECTATOR_ERROR });

export function createSpectatorRoom({ transport, code }) {
  const handlers = new Set();
  const room = {
    phase: ROOM_PHASES.WAITING,
    seats: createSeats(ROOM_SEATS),
    state: null,
    seq: -1,
    round: 0,
    result: null,
    hostId: null, // the host's peer id, from its first message
    guestSeen: false, // a guest sits in the room: welcomed, pinged, picked or named by seats
  };
  let closed = false; // close() was called

  const emit = (event) => {
    for (const handler of [...handlers]) handler(event);
  };

  const updatePhase = () => {
    if (room.phase === CLOSED || room.state === null) return;
    room.phase = room.result || isGameOver(room.state) ? ROOM_PHASES.OVER : ROOM_PHASES.PLAYING;
  };

  // seats of a host message; guest (a seats message's flag) whether a
  // guest is seated, undefined when the message does not say.
  const takeSeats = (seats, guest) => {
    if (!isSeats(seats, ROOM_SEATS)) return;
    const present = typeof guest === 'boolean' ? guest : room.guestSeen || seats.picks[ROOM_SEATS[1]] !== null;
    if (present === room.guestSeen && JSON.stringify(seats) === JSON.stringify(room.seats)) return;
    room.seats = seats;
    room.guestSeen = present;
    emit({ type: 'seats', seats });
  };

  const takeResult = (result) => {
    const next = result ?? null;
    if (JSON.stringify(next) === JSON.stringify(room.result)) return;
    room.result = next;
    updatePhase();
    emit({ type: 'result', result: next });
  };

  // A game state with the host's seq; true when it is newer than the one
  // shown (and then taken).
  const takeState = (message) => {
    if (!message.state || typeof message.seq !== 'number' || message.seq <= room.seq) return false;
    const first = room.state === null;
    const newRound = typeof message.round === 'number' && message.round > room.round;
    room.state = message.state;
    room.seq = message.seq;
    if (typeof message.round === 'number') room.round = Math.max(room.round, message.round);
    if (newRound && room.result) {
      room.result = null; // the result of an older round
      emit({ type: 'result', result: null });
    }
    updatePhase();
    if (first) emit({ type: 'start', round: room.round });
    return true;
  };

  // The host left: nothing more comes. The transport stays for close().
  const hostLeft = () => {
    room.phase = CLOSED;
    emit({ type: 'roomClosed' });
    handlers.clear();
  };

  // The guest's copy of a host message with the cells under the host's
  // clouds covered (masked) carries no state for a spectator: the full
  // state follows in the same message marked spectatorsOnly.
  const handle = (heard) => {
    const message = heard.masked === true ? { ...heard, state: null } : heard;
    if (HOST_ONLY.includes(message.type) && room.hostId === null) room.hostId = message.from;
    if (room.hostId !== null && message.from !== room.hostId) return; // not the host (a guest heard on a shared channel)
    switch (message.type) {
      case 'welcome':
        takeSeats(isSeats(message.seats, ROOM_SEATS) ? message.seats : room.seats, true);
        if (takeState(message)) takeResult(message.result);
        break;
      case 'seats':
        takeSeats(message.seats, room.phase === ROOM_PHASES.WAITING ? message.guest : undefined);
        break;
      case 'start':
        takeSeats(message.seats);
        takeState(message);
        break;
      case 'state': {
        const first = room.state === null;
        if (takeState(message) && !first) emit({ type: 'state', state: room.state, events: Array.isArray(message.events) ? message.events : [] });
        break;
      }
      case 'new-game': {
        const first = room.state === null;
        if (takeState(message) && !first) emit({ type: 'newGame', round: room.round });
        break;
      }
      case 'ping': // the host pings only while a guest is linked
        if (room.phase === ROOM_PHASES.WAITING) takeSeats(isSeats(message.seats, ROOM_SEATS) ? message.seats : room.seats, true);
        else room.guestSeen = true;
        if (message.result && message.round === room.round) takeResult(message.result);
        break;
      case 'leave':
        hostLeft();
        break;
    }
  };

  const unsubscribe = transport.onMessage((message) => {
    if (room.phase === CLOSED) return;
    if (!message || typeof message.type !== 'string' || typeof message.from !== 'string') return;
    handle(message);
  });

  return {
    role: SPECTATOR,
    code,
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

    // Every action of a player is refused, and nothing is sent.
    pick: refused,
    ready: refused,
    act: refused,
    place: refused,
    useSkill: refused,
    requestRematch: () => false,

    // The same shape as a player's room view (room.js getView), with no
    // seat, no stone and no presence: a spectator is never in the
    // countdown and it is never its turn.
    getView() {
      return {
        role: SPECTATOR,
        code,
        phase: room.phase,
        round: room.round,
        seats: room.seats,
        seat: null,
        character: null,
        hostCharacter: room.seats.picks[ROOM_SEATS[0]] ?? null,
        you: null,
        state: room.state,
        peer: null,
        result: room.result,
        yourTurn: false,
        waiting: false,
        guestPresent: room.guestSeen || room.state !== null,
      };
    },

    // Stops listening and closes the transport. Sends nothing: the relay
    // tells nobody when a spectator goes.
    close() {
      if (closed) return;
      closed = true;
      room.phase = CLOSED;
      handlers.clear();
      unsubscribe();
      transport.close();
    },
  };
}
