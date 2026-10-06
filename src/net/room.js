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
//   welcome   host -> guest   { seats, state, seq, handled, result, round }; state is
//                             null until the game started
//   pick      guest -> host   { character, request } the guest's pick in the character
//                             select; request counts the guest's picks and Readys up from 1
//   ready     guest -> host   { character, request } the guest pressed Ready for the pick
//                             character (refused if that is no longer its pick)
//   seats     host -> guest   { seats, guest, error?, reason?, answer? } the seats (logic/seats.js);
//                             guest is false while no guest is seated (then
//                             the message goes to nobody, for spectators)
//                             after every change, and as the answer to every pick and
//                             ready (answer is its request, with the error when the host
//                             refused it; the guest drops an error of an older request)
//   start     host -> guest   { round, state, seq, seats } both seats are Ready: the game begins
//   full      host -> other   the room already has two players
//   action    guest -> host   { action, requestId }; requestId counts up from 1
//   state     host -> guest   { state, events, seq, handled, round } after every applied action
//   rejected  host -> guest   { error, reason?, requestId, seq, handled } for an invalid
//                             action; reason is NOT_STARTED before phase playing
//   ping      both ways       heartbeat, every HEARTBEAT_INTERVAL_MS; the
//                             host's carries its seq so the guest notices a
//                             lost state message and asks for a resync, and
//                             handled so the guest notices a lost action
//                             request (or a lost answer to it), and round
//                             so a guest still in starting notices a lost
//                             start and a guest still in over a lost
//                             new-game (it then ignores boards of the
//                             later round until new-game arrives). Once
//                             a side has a result it adds { result }, and
//                             keeps pinging so a peer that is still there
//                             learns the outcome. A side that lost
//                             the peer in over adds { gone }, so a
//                             peer heard again after the connection
//                             dropped learns that no rematch is left
//                             (the ping counts as a leave). The host's
//                             pings before the start carry { seats }, so
//                             a guest whose pick or ready was lost sends
//                             it again
//   leave     both ways       sent when the page closes
//   rematch   guest -> host   { round } asks for a rematch of the game of that round
//   rematch-status host -> guest { round, host, guest, gone } after every change in
//                             phase over; the host's pings in over carry it too as
//                             { rematch }, so a lost one is recovered
//   new-game  host -> guest   { round, state, seq, handled } both asked: the next game
//                             begins with a fresh state
//
// Hidden cloud contents (docs/design.md section 6): the guest never gets a
// stone or rock under a cloud of the host. Every host message (welcome,
// start, state with the win, new-game, and the ones with no cell) goes out
// through hostStateMessages (room.send does it for every host message):
// when maskForViewer covers cells for the guest, the guest's copy carries
// the masked state (and only the events it may see) with masked true, and
// over a transport that reaches spectators (reachesSpectators, the relay)
// the same message with the full state follows marked spectatorsOnly; the
// relay passes that one to the spectators only. The rooms of both players
// drop any spectatorsOnly message. The host keeps the true state and shows
// itself the state masked for its own stone. An action that names a cell
// covered for the acting seat is refused with COVERED_ERROR before the
// rules run (coveredActionError), whatever the cell holds, even an empty
// one, so whether it is taken never tells what the cloud hides (the Cloud
// skill itself excepted); skill targets are picked on the shown board.
// The other host messages (seats, ping with its result and rematch status,
// rematch-status, rejected, full, leave) carry no cell.
//
// Actions are { kind: 'place', x, y } or { kind: 'skill', skill, target };
// the host fills in the acting player from who sent it.
//
// Phases (docs/flow-design.md sections 5 and 6, ROOM_PHASES in phase.js) are
// owned by the host. The room starts in waiting with two empty seats (HOST
// and GUEST, logic/seats.js); a join is accepted only then (any other
// window is told full) and the phase becomes starting. Each player picks a
// character and presses Ready: the host through pick() and ready(), the
// guest by sending pick and ready, which the host checks with the seat
// rules (a character taken by the other seat is refused) and answers with
// seats. The first pick plays X. When both seats are Ready the host makes
// the game (newGame with the sides of the pick order), enters playing and
// sends start with round 1; the guest enters playing only when start
// arrives. If the guest goes missing during starting its seat is empty
// again and the host waits for a new guest. A win, a draw or a forfeit
// makes the phase over. Actions before playing are rejected with reason
// NOT_STARTED and change nothing.
//
// Rematch (docs/flow-design.md section 5), decided by the host only. The
// round is the game of the room: 1 for the first, plus 1 per rematch. A
// rematch counts only in phase over with the current round, and never after
// a forfeit or once the peer went missing in over (gone, for good in this
// room); a repeat changes nothing. The host's own press is requestRematch().
// When both asked, the host starts round plus 1 with newGame() for the same
// characters on the same sides, enters
// playing, sends new-game and restarts the heartbeat; the guest takes
// new-game as it is, unless it lost the host in over. A guest whose
// request is not yet shown in the host's status sends it again with every
// host ping it hears in over.
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
// game drops its claim. A guest in over ignores the result of a later round
// it has not taken.
//
// Room events, passed to handlers given to onEvent:
//   { type: 'joined' }                    host: the guest took a seat; guest: welcomed
//                                         (both are now in phase starting)
//   { type: 'seats', seats, error?, reason? }
//                                         the seats changed; error when this window's
//                                         pick or Ready was refused
//   { type: 'start', round }              both: the host started the game (phase playing)
//   { type: 'rematchStatus', round, host, guest, gone }
//                                         the rematch flags changed in phase over; gone is
//                                         true when no rematch is possible any more
//   { type: 'newGame', round, state }     both: a rematch began (phase playing)
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

import { CHAT_MIN_INTERVAL_MS, HEARTBEAT_INTERVAL_MS, JOIN_TIMEOUT_MS, PRESENCE_CHECK_INTERVAL_MS } from '../config.js';
import { isGameOver, newGame, placeStone, useSkill } from '../logic/game.js';
import { coveredActionError, maskErrorForViewer, maskEventsForViewer, maskForViewer } from '../logic/cloud.js';
import { bothReady, clearSeat, createSeats, isSeats, pickCharacter, seatSides, seatStone, setReady } from '../logic/seats.js';
import { CHAT, chatOf, cleanChatText, cleanName, namesOf } from './chat.js';
import { systemClock } from './clock.js';
import { ROOM_PHASES } from './phase.js';
import { CONNECTED, GONE, checkPresence, countdownStart, createPresence, markHeard, markLeft } from './presence.js';

export const HOST = 'host';
export const GUEST = 'guest';

// Room phases: the four of ROOM_PHASES, and the guest's own before and after.
export const WAITING = ROOM_PHASES.WAITING; // host: no guest yet
export const STARTING = ROOM_PHASES.STARTING; // both seated, picking characters until both are Ready
export const PLAYING = ROOM_PHASES.PLAYING; // the game runs
export const OVER = ROOM_PHASES.OVER; // the game ended (win, draw or forfeit)
export const JOINING = 'joining'; // guest: join sent, no answer yet
export const FULL = 'full'; // guest: the room was full
export const NO_ROOM = 'noRoom'; // guest: nobody answered
export const CLOSED = 'closed'; // this window left

// Reason of a rejected action that came before phase playing.
export const NOT_STARTED = 'not-started';
export const NOT_STARTED_ERROR = 'The game has not started yet.';

// The two seats of a room (logic/seats.js).
export const ROOM_SEATS = Object.freeze([HOST, GUEST]);

// Errors of a pick or Ready outside the character select.
const NOT_SELECTING_ERROR = 'The character select is over.';

export function makePeerId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Creates the room as its host, with two empty seats. options.random is
// used for the Tornado Zone throw; options.makeGame (newGame by default)
// makes the state of each game from { characters }, for tests.
export function createHostRoom(options) {
  const {
    transport,
    code,
    clock = systemClock,
    random = Math.random,
    makeGame = newGame,
    id = makePeerId(),
    name = null,
  } = options;

  const room = createRoomCore({ role: HOST, transport, code, clock, id, name });
  room.phase = WAITING;
  room.state = null; // made at the start from the picks

  const welcome = () => ({
    type: 'welcome',
    to: room.peerId,
    seats: room.seats,
    state: room.state,
    seq: room.seq,
    handled: room.handled,
    result: room.result,
    round: room.round,
  });

  // An accepted join: seat the guest. The character select begins.
  const seat = (peerId, guestName) => {
    room.peerId = peerId;
    room.setNames({ ...room.names, guest: guestName });
    room.phase = STARTING;
    room.send(welcome());
    room.startLink();
    room.emit({ type: 'joined' });
  };

  const startMessage = () => ({ type: 'start', to: room.peerId, round: room.round, state: room.state, seq: room.seq, seats: room.seats });

  // Both seats are Ready: the game of the picks begins on both sides at once.
  const start = () => {
    room.round = 1;
    room.state = makeGame({ characters: seatSides(room.seats) });
    room.seq += 1;
    room.takeSides();
    room.phase = PLAYING;
    room.resetRematch();
    room.restartLink();
    room.send(startMessage());
    room.emit({ type: 'start', round: room.round });
  };

  // The seats after a pick or Ready of side (HOST or GUEST): result is the
  // answer of the seat rules. The guest is answered with the seats (and the
  // error) even when nothing changed; every change is reported, and when
  // both seats are Ready the game starts.
  const takeSeats = (side, result, answer) => {
    const changed = result.ok && result.seats !== room.seats;
    if (changed) room.seats = result.seats;
    const error = result.ok ? {} : { error: result.error, reason: result.reason };
    const answered = side === GUEST ? { ...error, ...(Number.isInteger(answer) ? { answer } : {}) } : {};
    // Before a guest is in, a change still goes out (to nobody: no guest
    // takes it), so the relay's spectators see the host's pick.
    // guest says whether a guest is seated, so a spectator's waiting room
    // drops a guest that went (the relay passes it only host messages).
    if (changed || (room.peerId && side === GUEST)) room.send({ type: 'seats', to: room.peerId, seats: room.seats, guest: room.peerId !== null, ...answered });
    if (changed) room.emit({ type: 'seats', seats: room.seats });
    else if (!result.ok && side === HOST) room.emit({ type: 'seats', seats: room.seats, ...error });
    if (changed && room.phase === STARTING && bothReady(room.seats)) start();
    return result.ok ? { ok: true } : { ok: false, ...error };
  };

  // A pick or Ready of side, only before the game started. answer is the
  // request of the guest's message.
  const seatAction = (side, change, answer) => {
    if (room.phase !== WAITING && room.phase !== STARTING) return { ok: false, error: NOT_SELECTING_ERROR };
    return takeSeats(side, change(room.seats, side), answer);
  };

  // The guest went missing during starting: its seat is empty again and
  // the host waits for a new guest.
  // A guest missing in over: no rematch any more in this room.
  room.lostPeer = (phase) => {
    if (phase === OVER) room.loseRematch();
    if (phase !== STARTING) return;
    room.stopLink();
    room.peerId = null;
    room.phase = WAITING;
    room.setNames({ ...room.names, guest: null });
    const emptied = clearSeat(room.seats, GUEST);
    if (emptied !== room.seats) {
      room.seats = emptied;
      room.emit({ type: 'seats', seats: room.seats });
    }
    // To nobody (the guest is gone): the relay's spectators see the guest
    // seat empty again.
    room.send({ type: 'seats', to: null, seats: room.seats, guest: false });
  };

  // A rematch request of side (HOST or GUEST) for the game of round. Returns
  // true if it set that side's flag.
  const rematchFrom = (side, round) => {
    if (room.phase !== OVER || round !== room.round) return false;
    if (room.rematchStatus().gone || room.rematch[side]) return false;
    room.rematch = { ...room.rematch, [side]: true };
    room.refreshRematch();
    if (room.rematch.host && room.rematch.guest) startNewGame();
    return true;
  };

  // Both asked: the next round begins with a fresh game and a fresh link.
  const startNewGame = () => {
    room.round += 1;
    room.state = makeGame({ characters: room.state.characters }); // same characters, same sides
    room.seq += 1;
    room.phase = PLAYING;
    room.resetRematch();
    room.restartLink();
    room.send(newGameMessage());
    room.emit({ type: 'newGame', round: room.round, state: room.state });
  };

  const newGameMessage = () => ({ type: 'new-game', to: room.peerId, round: room.round, state: room.state, seq: room.seq, handled: room.handled });

  // Applies an action for player. Returns { ok: true } or { ok: false, error, reason? }.
  const apply = (player, action) => {
    const blocker = actionBlocker(room);
    if (blocker) return { ok: false, ...blocker };
    // An action on a cell under the other seat's cloud is refused whatever
    // the cell holds, so neither a refusal nor an accepted move tells what
    // the cloud hides.
    const covered = coveredActionError(room.state, player, action);
    if (covered) return { ok: false, error: covered };
    const result = runAction(room.state, player, action, random);
    // A refusal tells nothing about a cell under the other seat's cloud.
    if (!result.ok) return { ok: false, error: maskErrorForViewer(room.state, player, action, result.error) };
    room.state = result.state;
    room.seq += 1;
    room.updateOver();
    room.send({ type: 'state', to: room.peerId, state: room.state, events: result.events, seq: room.seq, handled: room.handled, round: room.round });
    room.emit({ type: 'state', state: room.state, events: maskEventsForViewer(maskForViewer(room.state, room.stone), result.events) });
    return { ok: true };
  };

  room.handle = (message) => {
    if (message.type === 'join') {
      if (message.from === room.peerId) {
        room.heard();
        room.setNames({ ...room.names, guest: cleanName(message.name) });
        room.send(welcome()); // the guest asked again; seat it again
        if (room.round > 1) room.send(newGameMessage()); // and the rematch it missed
        else if (room.round > 0) room.send(startMessage()); // or the start
      } else if (room.phase === WAITING) {
        seat(message.from, cleanName(message.name));
      } else {
        room.send({ type: 'full', to: message.from });
      }
      return;
    }
    if (message.from !== room.peerId) return;
    room.receiveCommon(message);
    if (message.type === 'ping' && isClaim(message.result, room.peerStone) && !room.result && !isGameOver(room.state)) {
      room.setResult({ winner: room.peerStone, reason: 'opponentLeft' });
    }
    if (message.type === 'pick') {
      seatAction(GUEST, (seats, side) => pickCharacter(seats, side, message.character), message.request);
      return;
    }
    if (message.type === 'ready') {
      // The Ready counts only for the pick it was pressed for.
      const character = typeof message.character === 'string' ? message.character : undefined;
      seatAction(GUEST, (seats, side) => setReady(seats, side, character), message.request);
      return;
    }
    if (message.type === 'rematch') {
      rematchFrom(GUEST, message.round);
      return;
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
      const result = apply(room.peerStone, message.action);
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

  room.requestRematch = () => rematchFrom(HOST, room.round);
  room.pick = (character) => seatAction(HOST, (seats, side) => pickCharacter(seats, side, character));
  room.ready = () => seatAction(HOST, setReady);

  return room.api;
}

// Creates this window's side of an existing room as the guest and sends
// the join request, repeating it until the room answers with welcome or
// full (a lost welcome is simply sent again); if nobody answers within
// JOIN_TIMEOUT_MS the phase becomes NO_ROOM. After welcome the guest is in
// phase starting (the character select) until the host's start arrives.
export function createGuestRoom(options) {
  const { transport, code, clock = systemClock, id = makePeerId(), joinTimeoutMs = JOIN_TIMEOUT_MS, name = null } = options;
  const room = createRoomCore({ role: GUEST, transport, code, clock, id, name });
  const joinMessage = () => (room.myName ? { type: 'join', name: room.myName } : { type: 'join' });
  room.phase = JOINING;
  let requestId = 0;
  let askedRematch = false; // this guest asked for a rematch of the current round
  // This guest's own pick and Ready, sent again with a host ping until the
  // host's seats show them (a refused pick is dropped).
  let wanted = { character: null, ready: false };
  let seatRequests = 0; // request of the last pick or Ready sent

  // Takes the host's seats (from seats, welcome or a ping) before the
  // start; reports them when they changed or carry an error. An error
  // answers an older request than the last one sent is dropped: a newer
  // pick or Ready is on its way, so wanted stays (else a host ping would
  // send the old pick again over the newer one).
  const takeSeats = (seats, error = null, answer = null) => {
    if (room.phase !== STARTING || !isSeats(seats, ROOM_SEATS)) return;
    if (error && Number.isInteger(answer) && answer !== seatRequests) error = null;
    const changed = JSON.stringify(seats) !== JSON.stringify(room.seats);
    if (changed) room.seats = seats;
    if (error) wanted = { character: room.seats.picks[GUEST], ready: room.seats.ready[GUEST] };
    if (changed || error) room.emit({ type: 'seats', seats: room.seats, ...(error ?? {}) });
  };
  // A pick or Ready sent again is a new request, so only its own answer
  // (not the refusal of the copy before it) can drop what is wanted.
  const sendWanted = () => {
    if (wanted.character !== null && room.seats.picks[GUEST] !== wanted.character) room.send({ type: 'pick', to: room.peerId, character: wanted.character, request: ++seatRequests });
    if (wanted.ready && !room.seats.ready[GUEST]) room.send({ type: 'ready', to: room.peerId, character: wanted.character, request: ++seatRequests });
  };

  // A host missing in over: no rematch any more in this room.
  room.lostPeer = (phase) => {
    if (phase === OVER) room.loseRematch();
  };

  // Takes the host's rematch status for the current round.
  const takeRematchStatus = (status) => {
    if (room.phase !== OVER || !status || status.round !== room.round) return;
    room.rematch = { host: status.host === true, guest: status.guest === true };
    if (status.gone === true) room.rematchGone = true;
    room.refreshRematch();
  };

  const joinRetry = room.addTimer(clock.setInterval(() => room.send(joinMessage()), HEARTBEAT_INTERVAL_MS), 'interval');
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
      if (message.type === 'welcome' && isSeats(message.seats, ROOM_SEATS)) {
        stopJoining();
        room.peerId = message.from;
        room.phase = STARTING;
        room.seats = message.seats;
        room.state = message.state ?? null;
        room.seq = Number.isInteger(message.seq) ? message.seq : 0;
        room.startLink();
        room.emit({ type: 'joined' });
      } else if (message.type === 'full') {
        stopJoining();
        room.phase = FULL;
        room.emit({ type: 'full' });
      }
      return;
    }
    if (message.from !== room.peerId) return;
    room.receiveCommon(message);
    if (message.type === 'seats') {
      const error = typeof message.error === 'string' ? { error: message.error, reason: message.reason ?? null } : null;
      takeSeats(message.seats, error, message.answer);
      return;
    }
    if (message.type === 'start') {
      if (room.phase !== STARTING || !Number.isInteger(message.round) || !message.state || !isSeats(message.seats, ROOM_SEATS)) return;
      room.round = message.round;
      room.seats = message.seats;
      room.state = message.state;
      if (Number.isInteger(message.seq)) room.seq = message.seq;
      room.takeSides();
      room.phase = PLAYING;
      room.resetRematch();
      room.updateOver(); // a start recovered late: the game may have ended meanwhile (a forfeit)
      room.restartLink();
      room.emit({ type: 'start', round: room.round });
      return;
    }
    if (message.type === 'rematch-status') {
      takeRematchStatus(message);
      return;
    }
    if (message.type === 'new-game') {
      if (room.phase !== OVER || room.rematchGone || !Number.isInteger(message.round) || message.round <= room.round || !message.state) return;
      room.round = message.round;
      room.state = message.state;
      if (Number.isInteger(message.seq)) room.seq = message.seq;
      room.pending = null;
      room.result = null;
      askedRematch = false;
      room.phase = PLAYING;
      room.resetRematch();
      room.restartLink();
      room.emit({ type: 'newGame', round: room.round, state: room.state });
      return;
    }
    if (message.type === 'ping' && room.phase === STARTING && message.seats) {
      takeSeats(message.seats);
      sendWanted(); // a pick or ready (or its answer) was lost
    }
    if (message.type === 'welcome' && room.phase === STARTING) takeSeats(message.seats);
    if (message.type === 'ping' && room.phase === OVER) {
      takeRematchStatus(message.rematch);
      if (askedRematch && !room.rematch.guest && !room.rematchStatus().gone) sendRematch(); // the request or its status was lost
    }
    // The host is already in a later round (its new-game was lost): only
    // new-game may end this round, so a board of that round is not taken.
    const laterRound = room.phase === OVER && message.round > room.round;
    let stateEvent = null;
    if ((message.type === 'state' || message.type === 'welcome') && message.seq > room.seq && !laterRound) {
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
    } else if (message.type === 'ping' && (message.seq > room.seq || (room.phase === STARTING && message.round > 0) || laterRound) && !(laterRound && room.rematchGone)) {
      // A state, start or new-game message was lost; the host answers with a fresh welcome (and start or new-game).
      // A guest that lost the host in over takes no later round, so it does not ask.
      room.send(joinMessage());
    } else if (message.type === 'ping' && room.pending && !(message.handled >= room.pending.requestId)) {
      room.send({ type: 'action', to: room.peerId, ...room.pending }); // the request or its answer was lost
    }
    // A result of a later round belongs to a game this side never took,
    // so it never replaces the outcome of this one.
    if ((message.type !== 'ping' && message.type !== 'welcome') || laterRound) return;
    // Before the start the host's stone is known from the seats.
    if (isClaim(message.result, room.peerStone ?? seatStone(room.seats, HOST))) {
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

  const sendRematch = () => room.send({ type: 'rematch', to: room.peerId, round: room.round });

  // The seats as they will be once the host took this guest's pick and
  // Ready that are sent but not yet shown in its seats.
  const wantedSeats = () => {
    const picked = wanted.character !== null ? pickCharacter(room.seats, GUEST, wanted.character) : { ok: false };
    const seats = picked.ok ? picked.seats : room.seats;
    const readied = wanted.ready ? setReady(seats, GUEST) : { ok: false };
    return readied.ok ? readied.seats : seats;
  };

  // The guest's pick and Ready go to the host, which decides; the seat
  // rules are checked here first (over the pick and Ready already sent)
  // only so that a request known to be refused, such as a new pick after
  // Ready, is not sent. Returns { ok: true } when sent, else { ok: false, error }.
  const seatRequest = (check, message, want) => {
    if (room.phase !== STARTING) return { ok: false, error: NOT_SELECTING_ERROR };
    const result = check(wantedSeats());
    if (!result.ok) {
      room.emit({ type: 'seats', seats: room.seats, error: result.error, reason: result.reason });
      return { ok: false, error: result.error, reason: result.reason };
    }
    wanted = { ...wanted, ...want };
    seatRequests += 1;
    room.send({ ...message, to: room.peerId, request: seatRequests });
    return { ok: true };
  };
  room.pick = (character) => seatRequest((seats) => pickCharacter(seats, GUEST, character), { type: 'pick', character }, { character });
  // Ready is for the pick as the guest sees it (its own last pick sent).
  room.ready = () => {
    const character = room.phase === STARTING ? wantedSeats().picks[GUEST] : null;
    return seatRequest((seats) => setReady(seats, GUEST), { type: 'ready', character }, { character, ready: true });
  };

  // Asks the host for a rematch; the host decides. Returns true if sent.
  room.requestRematch = () => {
    if (room.phase !== OVER || room.rematchStatus().gone) return false;
    askedRematch = true;
    sendRematch();
    return true;
  };

  room.send(joinMessage());
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

function withoutType({ type, ...rest }) {
  return rest;
}

// Whether a result sent by the peer says winner won because the other left.
function isClaim(result, winner) {
  return result?.reason === 'opponentLeft' && result.winner === winner;
}

// The messages the host sends for message (every host message goes
// through here): the message itself when nothing in it is hidden from the
// guest (guestStone); otherwise the guest's copy with the state masked by
// maskForViewer, the events it may see (maskEventsForViewer) and masked
// true, then, when withSpectators, the full message marked spectatorsOnly
// for the relay's spectators. The events of a message without a state are
// masked by current, the host's true state.
export function hostStateMessages(message, guestStone, withSpectators, current = null) {
  const hasState = message.state !== undefined;
  const state = maskForViewer(hasState ? message.state : current, guestStone);
  const events = Array.isArray(message.events) ? maskEventsForViewer(state, message.events) : message.events;
  if ((!hasState || state === message.state) && events === message.events) return [message];
  const guestCopy = { ...message, masked: true };
  if (hasState) guestCopy.state = state;
  if (Array.isArray(message.events)) guestCopy.events = events;
  return withSpectators ? [guestCopy, { ...message, spectatorsOnly: true }] : [guestCopy];
}

// Runs a room action through the game rules.
function runAction(state, player, action, random) {
  if (action?.kind === 'place') return placeStone(state, { player, x: action.x, y: action.y }, { random });
  if (action?.kind === 'skill') return useSkill(state, { player, skill: action.skill, target: action.target ?? null });
  return { ok: false, error: 'Unknown action.' };
}

// What host and guest share: sending, events, heartbeat and leave
// detection, the view and closing.
function createRoomCore({ role, transport, code, clock, id, name = null }) {
  const handlers = new Set();
  const timers = []; // [{ id, kind }]
  let presence = null;
  let pingTimer = null;
  let checkTimer = null;
  let lastPeer = null; // last { status, secondsLeft } sent in a 'peer' event
  let peerGoneReported = false; // the peer was reported gone (or forfeited) on this link
  let unsubscribe = null;

  let lastChatAt = -Infinity; // when this window last sent a chat message
  const room = {
    role,
    code,
    id,
    myName: cleanName(name), // this window's player name (null: none given)
    names: { host: role === HOST ? cleanName(name) : null, guest: role === GUEST ? cleanName(name) : null },
    phase: null,
    seats: createSeats(ROOM_SEATS), // the character select (host: its own; guest: as the host sent them)
    character: null, // this window's character, from the start
    stone: null, // this window's stone, from the start
    hostCharacter: null,
    peerStone: null, // the other window's stone, from the start
    peerId: null,
    state: null,
    seq: 0,
    round: 0, // the game of this room: 1 for the first, 0 before the start
    handled: 0, // host: requestId of the last guest action applied or rejected
    pending: null, // guest: { action, requestId } sent and not yet settled by the host
    result: null, // { winner, reason: 'opponentLeft' } when a player left mid-game
    rematch: { host: false, guest: false }, // rematch flags of the current round (guest: as the host sent them)
    rematchGone: false, // the peer went missing in over: no rematch in this room any more
    lastRematch: null, // the rematch status last reported
    handle: () => {},
    act: () => ({ ok: false, error: 'You are not in a game.' }),
    requestRematch: () => false,
    pick: () => ({ ok: false, error: NOT_SELECTING_ERROR }),
    ready: () => ({ ok: false, error: NOT_SELECTING_ERROR }),
    lostPeer: () => {}, // (phase) the peer went missing outside phase playing

    // The characters and stones of both windows from the seats, at the start.
    takeSides() {
      const other = role === HOST ? GUEST : HOST;
      room.character = room.seats.picks[role];
      room.stone = seatStone(room.seats, role);
      room.hostCharacter = room.seats.picks[HOST];
      room.peerStone = seatStone(room.seats, other);
    },

    // Every host message goes out as the guest may see it
    // (hostStateMessages), and over the relay in full for the spectators.
    // The host's messages carry the names of both seats (once one is known).
    send(message) {
      const all = role === HOST && message.masked !== true && message.spectatorsOnly !== true
        ? hostStateMessages(message, room.peerStone, transport.reachesSpectators === true, room.state)
        : [message];
      const named = role === HOST && (room.names.host || room.names.guest) ? { names: room.names } : {};
      for (const each of all) transport.send({ ...each, ...named, from: id });
    },

    // New names of the seats: reported when they changed.
    setNames(next) {
      if (next.host === room.names.host && next.guest === room.names.guest) return;
      room.names = { host: next.host ?? null, guest: next.guest ?? null };
      room.emit({ type: 'names', names: room.names });
    },

    emit(event) {
      for (const handler of [...handlers]) handler(event);
    },

    setResult(result) {
      if (room.result?.winner === result?.winner) return;
      room.result = result;
      room.updateOver();
      room.emit({ type: 'result', result });
      room.refreshRematch();
    },

    // A running game that has ended (win, draw or forfeit) is over, with
    // both rematch flags cleared.
    updateOver() {
      if (room.phase !== PLAYING || !(room.result || isGameOver(room.state))) return;
      room.phase = OVER;
      room.rematch = { host: false, guest: false };
      room.refreshRematch();
    },

    // The rematch status: a forfeit (a result) or a peer gone in over
    // means no rematch.
    rematchStatus() {
      const { host, guest } = room.rematch;
      return { round: room.round, host, guest, gone: room.rematchGone || room.result !== null };
    },

    // Reports the rematch status in phase over when it changed: an event,
    // and the host sends it to the guest.
    refreshRematch() {
      if (room.phase !== OVER) return;
      const status = room.rematchStatus();
      const last = room.lastRematch;
      if (last && last.round === status.round && last.host === status.host && last.guest === status.guest && last.gone === status.gone) return;
      room.lastRematch = status;
      if (role === HOST && room.peerId) room.send({ type: 'rematch-status', to: room.peerId, ...status });
      room.emit({ type: 'rematchStatus', ...status });
    },

    // A new round: both flags cleared, nothing reported.
    resetRematch() {
      room.rematch = { host: false, guest: false };
      room.lastRematch = room.rematchStatus();
    },

    // The peer went missing in over: the flags are cleared and rematch is
    // off for good in this room.
    loseRematch() {
      room.rematch = { host: false, guest: false };
      room.rematchGone = true;
      room.refreshRematch();
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
    // A ping with gone (the peer lost this side in over) counts as a leave.
    receiveCommon(message) {
      if (message.type === 'leave' || (message.type === 'ping' && message.gone === true)) {
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
      ...(room.rematchGone ? { gone: true } : {}),
      ...(role === HOST && room.phase === OVER ? { rematch: room.rematchStatus() } : {}),
      ...(role === HOST && room.phase === STARTING ? { seats: room.seats } : {}),
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

  // The state this window shows: masked for its own stone (the host keeps
  // the true state; the guest's is masked already). Kept while the state
  // does not change, so the view hands out the same object.
  let shownFrom = null;
  let shown = null;
  const shownState = () => {
    if (room.state !== shownFrom) {
      shownFrom = room.state;
      shown = maskForViewer(room.state, room.stone);
    }
    return shown;
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

  unsubscribe = transport.onMessage((message) => {
    if (room.phase === CLOSED) return;
    if (!message || typeof message.type !== 'string' || typeof message.from !== 'string' || message.from === id) return;
    if (message.type === CHAT) {
      // Chat from anyone in the room: the other player or a spectator.
      const chat = chatOf(message);
      if (chat) room.emit({ type: 'chat', ...chat, mine: false });
      return;
    }
    if (message.spectatorsOnly === true) return; // the full state is for the spectators only
    if (role === GUEST && message.to === id && (room.peerId === null || message.from === room.peerId)) {
      const names = namesOf(message);
      if (names) room.setNames({ host: names.host, guest: room.myName ?? names.guest });
    }
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

    // { round, host, guest, gone }: who asked for a rematch of this round,
    // and whether a rematch is no longer possible.
    get rematchStatus() {
      return room.rematchStatus();
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

    // Calls handler({ round, host, guest, gone }) whenever the rematch status
    // changes in phase over; returns a function that removes it.
    onRematchStatus(handler) {
      return room.api.onEvent((event) => {
        if (event.type === 'rematchStatus') handler(withoutType(event));
      });
    },

    // Asks for a rematch of the game that just ended: on the host it sets
    // the host's flag, on the guest it sends rematch. Returns true if the
    // request was taken (the guest's is only sent; the host decides).
    requestRematch() {
      return room.requestRematch();
    },

    // The character select: picks a character for this window's seat, or
    // presses Ready. On the host it applies at once; on the guest it is sent
    // to the host, which decides. Returns { ok: true } or { ok: false, error }.
    pick(character) {
      return room.pick(character);
    },

    ready() {
      return room.ready();
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

    // The names of both seats: { host, guest }, null for one not known.
    get names() {
      return room.names;
    },

    // Sends a chat message to everyone in the room (the other player and
    // the spectators) and reports it here too. At most one every
    // CHAT_MIN_INTERVAL_MS; returns false for an empty text or one too soon.
    sendChat(text) {
      return sendChatMessage({ transport, clock, id, name: room.myName, text, emit: room.emit, lastAt: lastChatAt, sent: (at) => { lastChatAt = at; } });
    },

    // Everything the screens need. seats is the character select and seat
    // this window's seat name (HOST or GUEST); character and you are known
    // from the start. peer is null until both players are in;
    // then { status, secondsLeft } as in presence.js, computed for now (a
    // countdown only in phase playing). waiting is true while a guest's
    // action request is not yet settled.
    getView() {
      const peer = peerView();
      const canAct = actionBlocker(room) === null && room.state?.currentPlayer === room.stone;
      return {
        role: room.role,
        code: room.code,
        phase: room.phase,
        round: room.round,
        seats: room.seats,
        seat: room.role,
        character: room.character ?? room.seats.picks[room.role] ?? null,
        hostCharacter: room.hostCharacter,
        you: room.stone,
        names: room.names,
        state: shownState(),
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

// Sends one chat message for a room or a spectator room: cleaned, not
// sooner than CHAT_MIN_INTERVAL_MS after the last one (lastAt), then
// emitted here as mine. sent(at) records the time. Returns true when sent.
export function sendChatMessage({ transport, clock, id, name, text, emit, lastAt, sent }) {
  const words = cleanChatText(text);
  const now = clock.now();
  if (words === null || now - lastAt < CHAT_MIN_INTERVAL_MS) return false;
  sent(now);
  transport.send({ type: CHAT, from: id, to: null, name, text: words });
  emit({ type: 'chat', from: id, name, text: words, mine: true });
  return true;
}
