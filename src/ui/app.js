// Screen flow for online play (docs/design.md section 3): Lobby, Create
// Room (pick a character), Join Room (enter a code), Waiting, Game and
// Game over. Pure (no DOM): the page gives it a way to open a transport for
// a room code and a clock, the DOM screens call its actions and read
// getView(), and the canvas draws the game screen from getGame(). Which
// screen is shown is decided by flowReducer (flow.js); Create Room and Join
// Room are two panels of its lobby screen. Until the menu exists (Flow v1
// step 4) the app starts on the lobby, and leaving a room goes through the
// menu straight back to the lobby.

import { GAME_OVER_DELAY_MS } from '../config.js';
import { CHARACTERS, EARTH_BEAR, WIND_RABBIT } from '../logic/characters.js';
import { systemClock } from '../net/clock.js';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../net/room-code.js';
import { FULL, NO_ROOM, PLAYING, createGuestRoom, createHostRoom } from '../net/room.js';
import { FLOW_EVENTS, ROLES, SCREENS, flowReducer, initialFlow } from './flow.js';
import { characterName, createOnlineGame } from './online-game.js';

// Screens.
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

  let flow = initialFlow({ startScreen: SCREENS.LOBBY });
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
  // and main.js know. starting is passed through at once today, so it shows
  // the screen the player was on.
  const screenNow = () => {
    switch (flow.screen) {
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

  // The host was waiting and the guest was joining: both pass the starting
  // screen at once (the host's start delay comes in Flow v1 step 2).
  const startGame = () => {
    game = createOnlineGame(room);
    lobbyPanel = LOBBY;
    send(flow.screen === SCREENS.WAITING ? FLOW_EVENTS.OPPONENT_JOINED : FLOW_EVENTS.JOINED, FLOW_EVENTS.START);
    checkGameOver(); // a guest may join a room whose game has already ended
  };

  const onRoomEvent = (event) => {
    switch (event.type) {
      case 'joined':
        joiningCode = null;
        joinError = null;
        startGame();
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
    if (room.phase === PLAYING) onRoomEvent({ type: 'joined' });
    else if (room.phase === FULL) onRoomEvent({ type: 'full' });
    else if (room.phase === NO_ROOM) onRoomEvent({ type: 'noRoom' });
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
    // the room if there is one.
    backToLobby() {
      const screen = screenNow();
      if (screen === LOBBY || screen === GAME) return;
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
