// Which screen is shown (docs/flow-design.md section 4): the ONE place that
// decides it. A pure reducer over a small frozen state; no screen switches
// itself. Pure (no DOM), so it runs under node --test.
//
// State: { screen, overlay, mode, role, notice }
//   screen   menu, lobby, waiting, starting, game, gameover
//   overlay  none, howto, settings (only on top of the menu)
//   mode     null, online, local
//   role     null, host, guest
//   notice   null or host-left

export const SCREENS = Object.freeze({
  MENU: 'menu',
  LOBBY: 'lobby',
  WAITING: 'waiting',
  STARTING: 'starting',
  GAME: 'game',
  GAMEOVER: 'gameover',
});

export const OVERLAYS = Object.freeze({ NONE: 'none', HOWTO: 'howto', SETTINGS: 'settings' });
export const MODES = Object.freeze({ ONLINE: 'online', LOCAL: 'local' });
export const ROLES = Object.freeze({ HOST: 'host', GUEST: 'guest' });
export const NOTICE_HOST_LEFT = 'host-left';

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
});

const SCREEN_NAMES = Object.values(SCREENS);
const ONLINE_SCREENS = [SCREENS.LOBBY, SCREENS.WAITING, SCREENS.STARTING];

// The first state. options.local true starts on the game in local mode (the
// ?local=1 page); otherwise options.startScreen picks the screen (the menu
// when it is missing or unknown). The online screens start in online mode.
export function initialFlow(options = {}) {
  if (options.local) {
    return Object.freeze({ screen: SCREENS.GAME, overlay: OVERLAYS.NONE, mode: MODES.LOCAL, role: null, notice: null });
  }
  const screen = SCREEN_NAMES.includes(options.startScreen) ? options.startScreen : SCREENS.MENU;
  const mode = ONLINE_SCREENS.includes(screen) ? MODES.ONLINE : null;
  return Object.freeze({ screen, overlay: OVERLAYS.NONE, mode, role: null, notice: null });
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
    case FLOW_EVENTS.PLAY_LOCAL:
      if (onMenu) return next({ screen: SCREENS.GAME, mode: MODES.LOCAL });
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
      break;
    case FLOW_EVENTS.OPPONENT_LEFT:
      if (screen === SCREENS.STARTING && role === ROLES.HOST) return next({ screen: SCREENS.WAITING });
      if (screen === SCREENS.STARTING && role === ROLES.GUEST) {
        return next({ screen: SCREENS.LOBBY, role: null, notice: NOTICE_HOST_LEFT });
      }
      break;
    case FLOW_EVENTS.LEAVE:
      if (screen === SCREENS.WAITING || screen === SCREENS.GAMEOVER) {
        return next({ screen: SCREENS.MENU, mode: null, role: null });
      }
      break;
    case FLOW_EVENTS.GAME_OVER:
      if (screen === SCREENS.GAME) return next({ screen: SCREENS.GAMEOVER });
      break;
    case FLOW_EVENTS.REMATCH_STARTED:
      if (screen === SCREENS.GAMEOVER) return next({ screen: SCREENS.GAME });
      break;
  }
  return flow;
}

// The screen a flow shows.
export function screenOf(flow) {
  return flow.screen;
}
