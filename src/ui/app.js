// Screen flow for online play (docs/design.md section 3): Lobby, Join Room
// (enter a code), the room (Waiting, with the character select), Game and
// Game over. Pure (no DOM): the page gives it a way to open a transport for
// a room code and a clock, the DOM screens call its actions and read
// getView(), and the canvas draws the game screen from getGame(). Which
// screen is shown is decided by flowReducer (flow.js); Join Room is a panel
// of its lobby screen, and Create Room opens the room at once. The app
// starts on the main menu (menu.js); the lobby's Back and the room's Leave
// return to it.
//
// The host owns the start (net/room.js): in the room each player picks a
// character and presses Ready (pick, ready); the guest's go to the host,
// which decides. When both are Ready the host starts the game and both
// windows get the start event at the same moment.
//
// Play on this computer (and the ?local=1 page) opens the game screen on
// the character select of Player 1 and Player 2 (flow.js PICK and READY);
// when both are Ready a local game (local-game.js) of those sides runs
// through the same Game and Game over screens. The game
// over card (game-over.js, docs/flow-design.md section 3.7) offers Rematch
// (online the host decides, net/room.js; local at once) and Back to Menu.
//
// Rooms use the transport of chooseTransport(config) (net/transport.js).
// A WebSocket transport has an opened promise: the host enters its room
// and the guest sends its join only once the relay connection is open. A
// guest the relay refuses gets No room found at once; a host whose
// connection cannot open stays on the lobby with a connection error. A
// relay connection lost after it opened closes the room: a pending join
// shows the connection error on Join Room; the waiting room (host or
// seated guest), a game in play and the game over card go to the lobby
// with it.

import * as CONFIG from '../config.js';
import { GAME_OVER_DELAY_MS } from '../config.js';
import { bothReady, seatSides } from '../logic/seats.js';
import { systemClock } from '../net/clock.js';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../net/room-code.js';
import { FULL, GUEST, HOST, NO_ROOM, OVER, PLAYING, STARTING, createGuestRoom, createHostRoom } from '../net/room.js';
import { TRANSPORT_WEBSOCKET, chooseTransport, createBroadcastTransport } from '../net/transport.js';
import { ROLE_GUEST, ROLE_HOST, createWebSocketTransport } from '../net/ws-transport.js';
import { FLOW_EVENTS, LOCAL_SEATS, MODES, NOTICE_HOST_LEFT, ROLES, SCREENS, flowReducer, initialFlow, isSelecting } from './flow.js';
import { gameOverViewModel, rematchViewModel } from './game-over.js';
import { createLocalGame } from './local-game.js';
import { MENU_EVENTS } from './menu.js';
import { characterName, createOnlineGame } from './online-game.js';
import { lobbyViewModel, localSelectViewModel, waitingViewModel } from './room-screens.js';
import { STRINGS, withCode } from './strings.js';

// Screens.
export const MENU = 'menu';
export const LOBBY = 'lobby';
export const JOIN = 'join';
export const WAITING_SCREEN = 'waiting';
export const SELECT = 'select'; // the local character select on the game screen
export const GAME = 'game';
export const GAME_OVER = 'gameOver';

export const BAD_CODE_ERROR = STRINGS.joinErrorBadCode;

// The transport opener of config: openTransport(code, role) returns a
// BroadcastChannel transport, or a WebSocket transport to the relay for
// role (ROLE_HOST or ROLE_GUEST). options go to the transport (tests give
// BroadcastChannelImpl, or WebSocketImpl and location).
export function transportOpener(config = CONFIG, options = {}) {
  if (chooseTransport(config) === TRANSPORT_WEBSOCKET) {
    return (code, role) => createWebSocketTransport(code, role, options);
  }
  return (code) => createBroadcastTransport(code, options);
}

// options:
//   config              the config whose transport rooms use (src/config.js)
//   transportOptions    options for the transports of transportOpener
//   openTransport(code, role) returns a transport for the room; defaults
//                       to transportOpener(config, transportOptions)
//   clock               time and timers (net/clock.js)
//   random              the host's Tornado Zone random function
//   makeCode()          a new room code
//   local               true: start on the game in local mode (?local=1), on the character select
//   localRandom         the local game's Tornado Zone random function
export function createApp(options) {
  const {
    config = CONFIG,
    transportOptions = {},
    openTransport = transportOpener(config, transportOptions),
    clock = systemClock,
    random = Math.random,
    makeCode = () => generateRoomCode(),
    local = false,
    localRandom = Math.random,
  } = options;

  let flow = initialFlow({ local });
  let lobbyPanel = LOBBY; // LOBBY or JOIN while the flow is on the lobby
  let room = null;
  let game = null; // online game controller while a game runs
  let joinError = null;
  let joiningCode = null; // code of the room being joined, while waiting for an answer
  let opening = null; // a transport whose relay connection is still opening
  let lostUnsubscribe = null; // stops watching the open room's relay connection
  let connecting = false; // the host's new room waits for its connection to open
  let lobbyError = null; // the host's connection error on the lobby
  let gameOverTimer = null;
  let localSeat = null; // the local seat that acts on the character select (chooseSeat)
  // The rematch state of the game over card: mine (this window asked),
  // theirs (the other player asked) and gone (the other player left, or
  // the game ended by forfeit), from onRematchStatus and onPeerGone.
  let rematch = { mine: false, theirs: false, gone: false };
  // Counts the games shown (a start, a rematch, a local restart), so the
  // page clears the old game's visuals (src/main.js).
  let gameNumber = 0;
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
  // and main.js know. starting shows the waiting room to both players
  // until the host starts the game.
  const screenNow = () => {
    switch (flow.screen) {
      case SCREENS.MENU: return MENU;
      case SCREENS.LOBBY: return lobbyPanel;
      case SCREENS.WAITING: return WAITING_SCREEN;
      case SCREENS.STARTING: return WAITING_SCREEN;
      case SCREENS.GAME: return isSelecting(flow) ? SELECT : GAME;
      case SCREENS.GAMEOVER: return GAME_OVER;
      default: return LOBBY;
    }
  };

  const clearGameOverTimer = () => {
    if (gameOverTimer !== null) clock.clearTimeout(gameOverTimer);
    gameOverTimer = null;
  };

  // The relay connection of the open room was lost (not closed by us). A
  // join still pending on Join Room shows the error there; a seated guest
  // (which keeps its joining code until the start), the host, a game in
  // play and the game over card go to the lobby with it. A game in play is
  // not left to the presence countdown, which would tell this window that
  // the opponent left and it won.
  const connectionLost = () => {
    lostUnsubscribe = null;
    if (!room) return;
    const joining = screenNow() === JOIN;
    closeRoom();
    if (joining) {
      joinError = STRINGS.connectionError;
    } else {
      localSeat = null;
      joinError = null;
      lobbyPanel = LOBBY;
      // A game in play ends first (flow.js leaves only from game over).
      const ended = flow.screen === SCREENS.GAME ? flowReducer(flow, FLOW_EVENTS.GAME_OVER) : flow;
      flow = flowReducer(flowReducer(ended, FLOW_EVENTS.LEAVE), FLOW_EVENTS.PLAY_ONLINE);
      lobbyError = STRINGS.connectionError;
    }
    changed();
  };

  // Runs onOpen once transport is ready to carry the room: at once for a
  // transport without opened (BroadcastChannel), when opened resolves for
  // the relay, which is then watched for a lost connection. onFail runs
  // when it is refused or cannot open. Either is skipped if the opening was
  // cancelled meanwhile (closeRoom).
  const whenOpen = (transport, onOpen, onFail) => {
    if (!transport.opened) {
      onOpen();
      return;
    }
    opening = transport;
    transport.opened.then(() => {
      if (opening !== transport) return;
      opening = null;
      onOpen();
      if (room) lostUnsubscribe = transport.onClose?.(connectionLost) ?? null;
    }, () => {
      if (opening !== transport) return;
      opening = null;
      transport.close();
      onFail();
    });
  };

  const closeRoom = () => {
    opening?.close();
    opening = null;
    connecting = false;
    lostUnsubscribe?.();
    lostUnsubscribe = null;
    clearGameOverTimer();
    game?.dispose?.();
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

  // The host was waiting and the guest was joining: both are now starting
  // and see the waiting room. The guest keeps its joining code until the
  // start.
  const seated = () => {
    joinError = null;
    send(flow.screen === SCREENS.WAITING ? FLOW_EVENTS.OPPONENT_JOINED : FLOW_EVENTS.JOINED);
  };

  // A new game is shown: no rematch asked yet, and the page clears the
  // old game's visuals.
  const freshGame = () => {
    clearGameOverTimer();
    rematch = { mine: false, theirs: false, gone: false };
    gameNumber += 1;
  };

  // The rematch flags of a status from the room ({ host, guest, gone }),
  // seen from this window's side.
  const takeRematchStatus = (status) => {
    if (!room || !status) return;
    const mySide = room.role === HOST ? HOST : GUEST;
    const theirSide = mySide === HOST ? GUEST : HOST;
    rematch = {
      mine: rematch.mine || status[mySide] === true,
      theirs: status[theirSide] === true,
      gone: rematch.gone || status.gone === true,
    };
  };

  // The host started a rematch (new-game): back to the game with a fresh
  // board. The game controller keeps following the same room.
  const rematchStarted = () => {
    freshGame();
    send(FLOW_EVENTS.REMATCH_STARTED);
  };

  // Play on this computer, once both seats are Ready: a local game of the
  // sides of the pick order, checked for its end after every applied
  // action.
  const startLocal = () => {
    localSeat = null;
    game = createLocalGame({ random: localRandom, characters: seatSides(flow.seats), onApplied: () => checkGameOver() });
    freshGame();
  };

  // A local pick or Ready (flow.js PICK and READY). When it made both
  // seats Ready the local game starts.
  const localSeatEvent = (event) => {
    const before = flow;
    flow = flowReducer(flow, event);
    if (flow === before) return false;
    localSeat = event.seat;
    if (flow.seats && bothReady(flow.seats)) startLocal();
    changed();
    return true;
  };

  // The host started the game: both windows enter it.
  const startGame = () => {
    if (flow.screen !== SCREENS.STARTING) return;
    joiningCode = null;
    game = createOnlineGame(room);
    freshGame();
    lobbyPanel = LOBBY;
    send(FLOW_EVENTS.START);
    checkGameOver(); // a guest's start recovered late may come after the game ended
  };

  // The opponent went missing before the game started: the host waits
  // again (its room is back in waiting), the guest leaves for the lobby.
  const peerGone = (event) => {
    if (event.phase !== STARTING || flow.screen !== SCREENS.STARTING) return;
    if (flow.role === ROLES.GUEST) closeRoom();
    flow = flowReducer(flow, FLOW_EVENTS.OPPONENT_LEFT);
    // The guest is back on Join Room with the notice as its inline error.
    if (flow.notice === NOTICE_HOST_LEFT) joinError = STRINGS.noticeHostLeft;
    changed();
  };

  const onRoomEvent = (event) => {
    switch (event.type) {
      case 'joined':
        seated();
        break;
      case 'seats':
        changed();
        break;
      case 'start':
        startGame();
        break;
      case 'peerGone':
        peerGone(event);
        break;
      case 'full':
        joinError = withCode(STRINGS.joinErrorFull, joiningCode);
        closeRoom();
        changed();
        break;
      case 'noRoom':
        joinError = withCode(STRINGS.joinErrorNotFound, joiningCode);
        closeRoom();
        changed();
        break;
      case 'newGame':
        rematchStarted();
        break;
      case 'state':
      case 'result':
      case 'peer':
        checkGameOver();
        break;
    }
  };

  // The rematch status changed (phase over), or the peer went missing:
  // in phase over that is gone for good (docs/flow-design.md section 6),
  // with no countdown.
  const onRematchStatus = (status) => {
    takeRematchStatus(status);
    if (flow.screen === SCREENS.GAMEOVER) changed();
  };
  const onPeerGone = (event) => {
    if (event.phase !== OVER) return;
    rematch = { ...rematch, gone: true };
    if (flow.screen === SCREENS.GAMEOVER) changed();
  };

  // Starts listening to a new room. A transport may answer before the
  // room is returned (the fake one delivers at once), so a phase reached
  // meanwhile is handled as if its event had just arrived.
  const openRoom = (made) => {
    room = made;
    const unsubscribers = [room.onEvent(onRoomEvent), room.onRematchStatus(onRematchStatus), room.onPeerGone(onPeerGone)];
    roomUnsubscribe = () => unsubscribers.forEach((off) => off());
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

  // The game over card for the outcome of the game shown, or null.
  const gameOverView = () => {
    const outcome = game?.getOutcome() ?? null;
    if (!outcome) return null;
    const mode = flow.mode === MODES.LOCAL ? MODES.LOCAL : MODES.ONLINE;
    const you = mode === MODES.ONLINE ? room?.getView().you ?? null : null;
    return {
      ...gameOverViewModel({ mode, winner: outcome.winner, reason: outcome.reason, you, sides: game.getView().state.characters }),
      rematch: rematchViewModel({ mode, ...rematch }),
      backToMenu: STRINGS.gameOverBackToMenu,
    };
  };

  const pressRematch = () => {
    if (flow.screen !== SCREENS.GAMEOVER || !game) return false;
    if (flow.mode === MODES.LOCAL) {
      game.rematchLocal();
      rematchStarted();
      return true;
    }
    if (rematchViewModel({ mode: MODES.ONLINE, ...rematch }).disabled) return false;
    rematch = { ...rematch, mine: true };
    const before = gameNumber;
    const taken = room?.requestRematch() ?? false;
    if (gameNumber !== before) return taken; // both asked: the new game began
    if (!taken) rematch = { ...rematch, mine: false };
    changed();
    return taken;
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
        flow,
        // The waiting room (room-screens.js) in phases waiting and starting.
        waiting: roomView ? waitingViewModel(flow, roomView, { config }) : null,
        // The lobby panel (room-screens.js): its hint, Create while the
        // relay connection opens, and the connection error.
        lobby: lobbyViewModel({ config, connecting, error: lobbyError }),
        // The local character select (room-screens.js) on the game screen
        // of Play on this computer until both seats are Ready.
        select: localSelectViewModel(flow, { seat: localSeat }),
        code: roomView?.code ?? null,
        character: roomView?.character ?? null,
        characterName: roomView?.character ? characterName(roomView.character) : null,
        joining: joiningCode !== null,
        joiningCode,
        joinError,
        outcome: screen === GAME_OVER && game ? game.getOutcome() : null,
        // The game over card (game-over.js) on the Game over screen only,
        // so it never shows during a new game.
        gameOver: screen === GAME_OVER ? gameOverView() : null,
      };
    },

    // Counts the games shown; it changes on every start, rematch and
    // local restart (the page then clears the old board's visuals).
    getGameNumber() {
      return gameNumber;
    },

    // Rematch on the game over card: online it asks the room (the host
    // decides, and a rematch starts when both asked); local starts the new
    // game at once. Returns true if the press was taken.
    rematch: pressRematch,

    // R in local mode: a new game at once, from the game or the game over
    // card.
    restartLocal() {
      if (flow.mode !== MODES.LOCAL || !game) return false;
      if (flow.screen === SCREENS.GAMEOVER) return pressRematch();
      game.rematchLocal();
      freshGame();
      changed();
      return true;
    },

    // Back to Menu on the game over card (the event LEAVE): online it
    // closes the room, which sends leave, stops the heartbeat, the
    // countdown and every other timer, and closes the transport; local it
    // drops the local game. Then the menu.
    backToMenu() {
      if (flow.screen !== SCREENS.GAMEOVER) return false;
      closeRoom();
      joinError = null;
      lobbyPanel = LOBBY;
      send(FLOW_EVENTS.LEAVE);
      return true;
    },

    // A menu button, or Close and Escape on a menu overlay: one of
    // MENU_EVENTS (menu.js), sent to the flow. Returns true when the flow
    // changed. PLAY_LOCAL opens the game screen in local mode on the
    // character select, like ?local=1.
    menuEvent,

    // The character select: seat picks character. Online it is this
    // window's seat in the room (the host decides; seat is not used);
    // local it is one of LOCAL_SEATS (flow.js). Returns true when it was
    // taken (online: sent).
    pick(character, seat) {
      if (screenNow() === SELECT) return localSeatEvent({ type: FLOW_EVENTS.PICK, seat, character });
      if (screenNow() !== WAITING_SCREEN || !room) return false;
      return room.pick(character).ok;
    },

    // Ready on the character select, for seat (local) or this window's
    // seat (online). Local: the game starts when both seats are Ready.
    // Online: the host starts it when both are Ready.
    ready(seat) {
      if (screenNow() === SELECT) return localSeatEvent({ type: FLOW_EVENTS.READY, seat });
      if (screenNow() !== WAITING_SCREEN || !room) return false;
      return room.ready().ok;
    },

    // A press on a local seat card of the character select: that seat
    // (one of LOCAL_SEATS) now picks with the character cards and Ready,
    // so either seat may pick first. Returns true when it was taken.
    chooseSeat(seat) {
      if (screenNow() !== SELECT || !LOCAL_SEATS.includes(seat) || flow.seats?.ready[seat]) return false;
      localSeat = seat;
      changed();
      return true;
    },

    // Play Online on the menu: the lobby.
    playOnline() {
      return menuEvent(FLOW_EVENTS.PLAY_ONLINE);
    },

    openJoin() {
      if (screenNow() !== LOBBY || connecting) return;
      joinError = null;
      lobbyError = null;
      lobbyPanel = JOIN;
      changed();
    },

    // Create Room on the lobby: creates a room as its host, with two empty
    // seats, and opens it (the character select) while it waits for the
    // opponent.
    createRoom() {
      if (screenNow() !== LOBBY || connecting) return false;
      const code = makeCode();
      const transport = openTransport(code, ROLE_HOST);
      lobbyPanel = LOBBY;
      lobbyError = null;
      connecting = true;
      whenOpen(transport, () => {
        connecting = false;
        flow = flowReducer(flow, FLOW_EVENTS.ROOM_CREATED);
        openRoom(createHostRoom({ transport, code, clock, random }));
        changed();
      }, () => {
        connecting = false;
        lobbyError = STRINGS.connectionError;
        changed();
      });
      if (connecting) changed(); // still opening: the lobby reads Connecting
      return true;
    },

    // Joins the room with the typed code. Returns false and shows an error
    // if the code is not a valid room code.
    joinRoom(input) {
      if (screenNow() !== JOIN || joiningCode !== null) return false;
      const code = normalizeRoomCode(input);
      if (!isValidRoomCode(code)) {
        joinError = code.length === 0 ? STRINGS.joinErrorEmpty : BAD_CODE_ERROR;
        changed();
        return false;
      }
      joinError = null;
      joiningCode = code;
      changed();
      const transport = openTransport(code, ROLE_GUEST);
      whenOpen(transport, () => openRoom(createGuestRoom({ transport, code, clock })), () => {
        // The relay refused the guest: no room with this code.
        joinError = withCode(STRINGS.joinErrorNotFound, joiningCode);
        joiningCode = null;
        changed();
      });
      return true;
    },

    // The player typed in the code box: the inline error goes away.
    clearJoinError() {
      if (joinError === null) return;
      joinError = null;
      changed();
    },

    // Back on the lobby (the button or Escape): the menu, dropping a relay
    // connection still opening. On Join Room (when no join is pending) it
    // is the lobby's own panel.
    back() {
      const screen = screenNow();
      if (screen === LOBBY) {
        closeRoom();
        lobbyError = null;
        send(FLOW_EVENTS.BACK);
      }
      else if (screen === JOIN && joiningCode === null) {
        joinError = null;
        lobbyPanel = LOBBY;
        changed();
      }
    },

    // Leave in the room (phases waiting and starting, before the game) or
    // Back on the local character select: closes the room, which tells the
    // other player and stops its timers and its transport, so the code can
    // no longer be joined, then the menu.
    leaveRoom() {
      if (flow.screen !== SCREENS.WAITING && flow.screen !== SCREENS.STARTING && !isSelecting(flow)) return false;
      closeRoom();
      localSeat = null;
      joinError = null;
      lobbyPanel = LOBBY;
      send(FLOW_EVENTS.LEAVE);
      return true;
    },

    // Back from Join to the Lobby. Leaves the room if there is one. The
    // room has Leave (leaveRoom) and Game over Back to Menu (backToMenu)
    // instead.
    backToLobby() {
      const screen = screenNow();
      if (screen !== JOIN) return;
      closeRoom();
      joinError = null;
      lobbyPanel = LOBBY;
      changed();
    },

    // Leaves the room without changing screens. Call it when the page closes.
    close() {
      closeRoom();
    },
  };
}

