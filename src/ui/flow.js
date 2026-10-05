// Which screen is shown (docs/flow-design.md section 4): the ONE place that
// decides it. A pure reducer over a small frozen state; no screen switches
// itself. Pure (no DOM), so it runs under node --test.
//
// State: { screen, overlay, mode, role, notice, seats }
//   screen   menu, lobby, waiting, starting, game, gameover, and for a
//            spectator (Watch a match): spectate (the room code screen),
//            spectate-waiting (the room has no game yet), spectate-game
//            (the live game, input locked) and room-closed
//   overlay  none, howto, settings (only on top of the menu)
//   mode     null, online, local
//   role     null, host, guest, spectator
//   notice   null, host-left or room-closed
//   seats    local mode: the two seats of the character select
//            (logic/seats.js, LOCAL_SEATS), else null. The game screen
//            shows the character select until both seats are Ready
//            (isSelecting); the events PICK and READY fill the seats. A
//            rematch keeps them (same characters, same sides). Online the
//            seats live in the room, where the host decides (net/room.js).

import { bothReady, createSeats, pickCharacter, setReady } from '../logic/seats.js';

export const SCREENS = Object.freeze({
  MENU: 'menu',
  LOBBY: 'lobby',
  WAITING: 'waiting',
  STARTING: 'starting',
  GAME: 'game',
  GAMEOVER: 'gameover',
  SPECTATE: 'spectate',
  SPECTATE_WAITING: 'spectate-waiting',
  SPECTATE_GAME: 'spectate-game',
  ROOM_CLOSED: 'room-closed',
});

export const OVERLAYS = Object.freeze({ NONE: 'none', HOWTO: 'howto', SETTINGS: 'settings' });
export const MODES = Object.freeze({ ONLINE: 'online', LOCAL: 'local' });
export const ROLES = Object.freeze({ HOST: 'host', GUEST: 'guest', SPECTATOR: 'spectator' });
export const NOTICE_HOST_LEFT = 'host-left';
export const NOTICE_ROOM_CLOSED = 'room-closed';

// The seats of the local character select: Player 1 and Player 2.
export const LOCAL_SEATS = Object.freeze(['player1', 'player2']);

export const FLOW_EVENTS = Object.freeze({
  PLAY_ONLINE: 'PLAY_ONLINE',
  PLAY_LOCAL: 'PLAY_LOCAL',
  OPEN_HOWTO: 'OPEN_HOWTO',
  OPEN_SETTINGS: 'OPEN_SETTINGS',
  CLOSE_OVERLAY: 'CLOSE_OVERLAY',
  BACK: 'BACK',
  ROOM_CREATED: 'ROOM_CREATED',
  JOINED: 'JOINED',
  OPPONENT_JOINED: 'OPPONENT_JOINED',
  START: 'START',
  OPPONENT_LEFT: 'OPPONENT_LEFT',
  LEAVE: 'LEAVE',
  GAME_OVER: 'GAME_OVER',
  REMATCH_STARTED: 'REMATCH_STARTED',
  PICK: 'PICK', // { type, seat, character }: a local seat picks a character
  READY: 'READY', // { type, seat }: a local seat presses Ready
  WATCH: 'WATCH', // Watch a match on the menu: the spectator's room code screen
  SPECTATOR_JOINED: 'SPECTATOR_JOINED', // the relay let the spectator into the room
  ROOM_CLOSED: 'ROOM_CLOSED', // the host left or the spectator's connection closed
});

// The first state: the menu, or with options.local true the game in local
// mode (the ?local=1 page), which opens on the character select.
export function initialFlow(options = {}) {
  if (options.local) {
    return Object.freeze({ screen: SCREENS.GAME, overlay: OVERLAYS.NONE, mode: MODES.LOCAL, role: null, notice: null, seats: createSeats(LOCAL_SEATS) });
  }
  return Object.freeze({ screen: SCREENS.MENU, overlay: OVERLAYS.NONE, mode: null, role: null, notice: null, seats: null });
}

// True while the local game screen shows the character select: the seats
// are there and not both Ready.
export function isSelecting(flow) {
  return flow.screen === SCREENS.GAME && flow.mode === MODES.LOCAL && flow.seats !== null && !bothReady(flow.seats);
}

// True on the screens of a spectator inside a room: it only listens, so no
// screen of these takes a pick, a Ready, a cell or a skill.
export function isSpectating(flow) {
  return flow.screen === SCREENS.SPECTATE_WAITING || flow.screen === SCREENS.SPECTATE_GAME;
}

// The next state for an event (a type string or { type }). Returns a new
// frozen object for an allowed transition, and the same object otherwise.
export function flowReducer(flow, event) {
  const type = typeof event === 'string' ? event : event?.type;
  const next = (changes) => Object.freeze({ ...flow, ...changes });
  const { screen, overlay, role } = flow;
  const onMenu = screen === SCREENS.MENU && overlay === OVERLAYS.NONE;
  const menuOverlay = screen === SCREENS.MENU && overlay !== OVERLAYS.NONE;

  switch (type) {
    case FLOW_EVENTS.PLAY_ONLINE:
      if (onMenu) return next({ screen: SCREENS.LOBBY, mode: MODES.ONLINE, role: null, notice: null });
      break;
    case FLOW_EVENTS.WATCH:
      if (onMenu) return next({ screen: SCREENS.SPECTATE, mode: MODES.ONLINE, role: ROLES.SPECTATOR, notice: null });
      break;
    case FLOW_EVENTS.SPECTATOR_JOINED:
      if (screen === SCREENS.SPECTATE) return next({ screen: SCREENS.SPECTATE_WAITING });
      break;
    case FLOW_EVENTS.ROOM_CLOSED:
      if (isSpectating(flow)) return next({ screen: SCREENS.ROOM_CLOSED, notice: NOTICE_ROOM_CLOSED });
      break;
    case FLOW_EVENTS.PLAY_LOCAL:
      if (onMenu) return next({ screen: SCREENS.GAME, mode: MODES.LOCAL, seats: createSeats(LOCAL_SEATS) });
      break;
    case FLOW_EVENTS.OPEN_HOWTO:
      if (onMenu) return next({ overlay: OVERLAYS.HOWTO });
      break;
    case FLOW_EVENTS.OPEN_SETTINGS:
      if (onMenu) return next({ overlay: OVERLAYS.SETTINGS });
      break;
    case FLOW_EVENTS.CLOSE_OVERLAY:
      if (menuOverlay) return next({ overlay: OVERLAYS.NONE });
      break;
    case FLOW_EVENTS.BACK:
      if (screen === SCREENS.LOBBY) return next({ screen: SCREENS.MENU, mode: null, notice: null });
      if (screen === SCREENS.SPECTATE) return next({ screen: SCREENS.MENU, mode: null, role: null, notice: null });
      if (menuOverlay) return next({ overlay: OVERLAYS.NONE });
      break;
    case FLOW_EVENTS.ROOM_CREATED:
      if (screen === SCREENS.LOBBY) return next({ screen: SCREENS.WAITING, role: ROLES.HOST, notice: null });
      break;
    case FLOW_EVENTS.JOINED:
      if (screen === SCREENS.LOBBY) return next({ screen: SCREENS.STARTING, role: ROLES.GUEST, notice: null });
      break;
    case FLOW_EVENTS.OPPONENT_JOINED:
      if (screen === SCREENS.WAITING) return next({ screen: SCREENS.STARTING });
      break;
    case FLOW_EVENTS.START:
      if (screen === SCREENS.STARTING) return next({ screen: SCREENS.GAME });
      if (screen === SCREENS.SPECTATE_WAITING) return next({ screen: SCREENS.SPECTATE_GAME });
      break;
    case FLOW_EVENTS.OPPONENT_LEFT:
      if (screen === SCREENS.STARTING && role === ROLES.HOST) return next({ screen: SCREENS.WAITING });
      if (screen === SCREENS.STARTING && role === ROLES.GUEST) {
        return next({ screen: SCREENS.LOBBY, role: null, notice: NOTICE_HOST_LEFT });
      }
      break;
    case FLOW_EVENTS.LEAVE:
      if (screen === SCREENS.WAITING || screen === SCREENS.STARTING || screen === SCREENS.GAMEOVER || isSelecting(flow)) {
        return next({ screen: SCREENS.MENU, mode: null, role: null, seats: null });
      }
      if (isSpectating(flow) || screen === SCREENS.ROOM_CLOSED) {
        return next({ screen: SCREENS.MENU, mode: null, role: null, notice: null });
      }
      break;
    case FLOW_EVENTS.GAME_OVER:
      if (screen === SCREENS.GAME && !isSelecting(flow)) return next({ screen: SCREENS.GAMEOVER });
      break;
    case FLOW_EVENTS.REMATCH_STARTED:
      if (screen === SCREENS.GAMEOVER) return next({ screen: SCREENS.GAME });
      break;
    case FLOW_EVENTS.PICK:
      if (isSelecting(flow)) return seatsResult(flow, pickCharacter(flow.seats, event.seat, event.character));
      break;
    case FLOW_EVENTS.READY:
      if (isSelecting(flow)) return seatsResult(flow, setReady(flow.seats, event.seat));
      break;
  }
  return flow;
}

// The flow with the seats of an accepted pick or Ready; the same flow when
// the seats refused it or nothing changed.
function seatsResult(flow, result) {
  if (!result.ok || result.seats === flow.seats) return flow;
  return Object.freeze({ ...flow, seats: result.seats });
}

// The screen a flow shows.
export function screenOf(flow) {
  return flow.screen;
}
