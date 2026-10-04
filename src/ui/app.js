// Screen flow for online play (docs/design.md section 3): Lobby, Create
// Room (pick a character), Join Room (enter a code), Waiting, Game and
// Game over. Pure (no DOM): the page gives it a way to open a transport for
// a room code and a clock, the DOM screens call its actions and read
// getView(), and the canvas draws the game screen from getGame(). Which
// screen is shown is decided by flowReducer (flow.js); Create Room and Join
// Room are two panels of its lobby screen. The app starts on the main menu
// (menu.js); leaving a room still goes through the menu straight back to
// the lobby until the lobby gets its own Back button (Flow v1 step 5).
//
// The host owns the start (net/room.js): after a join both windows are in
// phase starting (the host still on the Waiting screen, the guest still on
// Join Room, looking for the room) until the host's start event, which both
// get at the same moment.

import { GAME_OVER_DELAY_MS } from '../config.js';
import { CHARACTERS, EARTH_BEAR, WIND_RABBIT } from '../logic/characters.js';
import { systemClock } from '../net/clock.js';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../net/room-code.js';
import { FULL, NO_ROOM, PLAYING, STARTING, createGuestRoom, createHostRoom } from '../net/room.js';
import { FLOW_EVENTS, ROLES, SCREENS, flowReducer, initialFlow } from './flow.js';
import { MENU_EVENTS } from './menu.js';
import { characterName, createOnlineGame } from './online-game.js';
import { STRINGS } from './strings.js';

// Screens.
export const MENU = 'menu';
export const LOBBY = 'lobby';
export const CREATE = 'create';
export const JOIN = 'join';
export const WAITING_SCREEN = 'waiting';
export const GAME = 'game';
export const GAME_OVER = 'gameOver';

export const BAD_CODE_ERROR = 'Room codes are 5 letters and digits (no 0, O, 1 or I).';

// options:
//   openTransport(code) returns a transport for the room (net/transport.js)
//   clock               time and timers (net/clock.js)
//   random              the host's Tornado Zone random function
//   makeCode()          a new room code
export function createApp(options) {
  const {
    openTransport,
    clock = systemClock,
    random = Math.random,
    makeCode = () => generateRoomCode(),
  } = options;

  let flow = initialFlow();
  let lobbyPanel = LOBBY; // LOBBY, CREATE or JOIN while the flow is on the lobby
  let room = null;
  let game = null; // online game controller while a game runs
  let joinError = null;
  let joiningCode = null; // code of the room being joined, while waiting for an answer
  let gameOverTimer = null;
  const listeners = new Set();
  let roomUnsubscribe = null;

  const changed = () => {
    for (const listener of [...listeners]) listener();
  };

  const send = (...events) => {
    for (const event of events) flow = flowReducer(flow, event);
    changed();
  };

  // The screen of the old flow (the constants above) that the DOM screens
  // and main.js know. starting shows the screen the player was on until
  // the host starts the game.
  const screenNow = () => {
    switch (flow.screen) {
      case SCREENS.MENU: return MENU;
      case SCREENS.LOBBY: return lobbyPanel;
      case SCREENS.WAITING: return WAITING_SCREEN;
      case SCREENS.STARTING: return flow.role === ROLES.HOST ? WAITING_SCREEN : JOIN;
      case SCREENS.GAME: return GAME;
      case SCREENS.GAMEOVER: return GAME_OVER;
      default: return LOBBY;
    }
  };

  const closeRoom = () => {
    if (gameOverTimer !== null) clock.clearTimeout(gameOverTimer);
    gameOverTimer = null;
    game?.dispose();
    game = null;
    roomUnsubscribe?.();
    roomUnsubscribe = null;
    room?.close();
    room = null;
    joiningCode = null;
  };

  // Moves to the Game over screen once the game has ended: at once when a
  // player left, after GAME_OVER_DELAY_MS when it ended on the board, so
  // the final move and the winning line can be seen first. On the Game over
  // screen the room may still settle who won (a guest's leave result can be
  // replaced by the host's, or dropped for a win on the board), so the
  // screen is told to show the outcome again.
  const checkGameOver = () => {
    if (!game) return;
    const screen = screenNow();
    if (screen === GAME_OVER) {
      changed();
      return;
    }
    if (screen !== GAME) return;
    const outcome = game.getOutcome();
    if (!outcome) return;
    if (outcome.reason === 'opponentLeft') {
      if (gameOverTimer !== null) clock.clearTimeout(gameOverTimer);
      gameOverTimer = null;
      send(FLOW_EVENTS.GAME_OVER);
    } else if (gameOverTimer === null) {
      gameOverTimer = clock.setTimeout(() => {
        gameOverTimer = null;
        if (flow.screen === SCREENS.GAME) send(FLOW_EVENTS.GAME_OVER);
      }, GAME_OVER_DELAY_MS);
    }
  };

  // The host was waiting and the guest was joining: both are now starting.
  // The guest keeps its joining code until the start, so Join Room keeps
  // showing that the room is being joined.
  const seated = () => {
    joinError = null;
    send(flow.screen === SCREENS.WAITING ? FLOW_EVENTS.OPPONENT_JOINED : FLOW_EVENTS.JOINED);
  };

  // The host started the game: both windows enter it.
  const startGame = () => {
    if (flow.screen !== SCREENS.STARTING) return;
    joiningCode = null;
    game = createOnlineGame(room);
    lobbyPanel = LOBBY;
    send(FLOW_EVENTS.START);
    checkGameOver(); // a guest's start recovered late may come after the game ended
  };

  // The opponent went missing before the game started: the host waits
  // again (its room is back in waiting), the guest leaves for the lobby.
  const peerGone = (event) => {
    if (event.phase !== STARTING || flow.screen !== SCREENS.STARTING) return;
    if (flow.role === ROLES.GUEST) {
      closeRoom();
      joinError = STRINGS.noticeHostLeft;
    }
    send(FLOW_EVENTS.OPPONENT_LEFT);
  };

  const onRoomEvent = (event) => {
    switch (event.type) {
      case 'joined':
        seated();
        break;
      case 'start':
        startGame();
        break;
      case 'peerGone':
        peerGone(event);
        break;
      case 'full':
        joinError = `Room ${joiningCode} is full.`;
        closeRoom();
        changed();
        break;
      case 'noRoom':
        joinError = `No room found with code ${joiningCode}.`;
        closeRoom();
        changed();
        break;
      case 'state':
      case 'result':
      case 'peer':
        checkGameOver();
        break;
    }
  };

  // Starts listening to a new room. A transport may answer before the
  // room is returned (the fake one delivers at once), so a phase reached
  // meanwhile is handled as if its event had just arrived.
  const openRoom = (made) => {
    room = made;
    roomUnsubscribe = room.onEvent(onRoomEvent);
    if (room.phase === STARTING || room.phase === PLAYING) onRoomEvent({ type: 'joined' });
    if (room.phase === PLAYING) onRoomEvent({ type: 'start', round: room.round });
    else if (room.phase === FULL) onRoomEvent({ type: 'full' });
    else if (room.phase === NO_ROOM) onRoomEvent({ type: 'noRoom' });
  };

  const menuEvent = (type) => {
    if (!MENU_EVENTS.includes(type)) return false;
    const before = flow;
    send(type);
    return flow !== before;
  };

  return {
    // Calls listener() whenever getView() changes (not on every game move;
    // the canvas redraws the game every frame).
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getScreen() {
      return screenNow();
    },

    // The flow state (flow.js) behind getScreen().
    getFlow() {
      return flow;
    },

    // The game screen controller (online-game.js) on the Game and Game over
    // screens, otherwise null.
    getGame() {
      return game;
    },

    // What the DOM screens show.
    getView() {
      const roomView = room?.getView() ?? null;
      const screen = screenNow();
      return {
        screen,
        code: roomView?.code ?? null,
        character: roomView?.character ?? null,
        characterName: roomView?.character ? characterName(roomView.character) : null,
        joining: joiningCode !== null,
        joiningCode,
        joinError,
        outcome: screen === GAME_OVER && game ? game.getOutcome() : null,
      };
    },

    // A menu button, or Close and Escape on a menu overlay: one of
    // MENU_EVENTS (menu.js), sent to the flow. Returns true when the flow
    // changed. PLAY_LOCAL ends in the game screen in local mode, which the
    // page runs itself (src/main.js), like ?local=1.
    menuEvent,

    // Play Online on the menu: the lobby.
    playOnline() {
      return menuEvent(FLOW_EVENTS.PLAY_ONLINE);
    },

    openCreate() {
      if (screenNow() !== LOBBY) return;
      lobbyPanel = CREATE;
      changed();
    },

    openJoin() {
      if (screenNow() !== LOBBY) return;
      joinError = null;
      lobbyPanel = JOIN;
      changed();
    },

    // Creates a room as its host playing `character`, then waits for the
    // opponent.
    createRoom(character) {
      if (screenNow() !== CREATE || !Object.hasOwn(CHARACTERS, character)) return false;
      const code = makeCode();
      lobbyPanel = LOBBY;
      flow = flowReducer(flow, FLOW_EVENTS.ROOM_CREATED);
      openRoom(createHostRoom({ transport: openTransport(code), code, character, clock, random }));
      changed();
      return true;
    },

    // Joins the room with the typed code. Returns false and shows an error
    // if the code is not a valid room code.
    joinRoom(input) {
      if (screenNow() !== JOIN || joiningCode !== null) return false;
      const code = normalizeRoomCode(input);
      if (!isValidRoomCode(code)) {
        joinError = code.length === 0 ? 'Enter a room code.' : BAD_CODE_ERROR;
        changed();
        return false;
      }
      joinError = null;
      joiningCode = code;
      changed();
      openRoom(createGuestRoom({ transport: openTransport(code), code, clock }));
      return true;
    },

    // Back from Create, Join, Waiting or Game over to the Lobby. Leaves
    // the room if there is one. Leave is off while the game is starting.
    backToLobby() {
      const screen = screenNow();
      if (screen === MENU || screen === LOBBY || screen === GAME || flow.screen === SCREENS.STARTING) return;
      closeRoom();
      joinError = null;
      lobbyPanel = LOBBY;
      if (flow.screen === SCREENS.LOBBY) changed();
      else send(FLOW_EVENTS.LEAVE, FLOW_EVENTS.PLAY_ONLINE);
    },

    // Leaves the room without changing screens. Call it when the page closes.
    close() {
      closeRoom();
    },
  };
}

export const CHARACTER_CHOICES = [WIND_RABBIT, EARTH_BEAR];
