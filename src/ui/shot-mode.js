// Shot mode for the screenshot self-check (docs/shots.md section 4). Pure
// (no DOM): the URL parser and the scene set up on a local game. src/main.js
// runs shot mode only when the page URL has the shot parameter; without it
// none of this runs. Shot mode never changes the rules, the networking or
// the cell numbering: the scene is played through the local game's own
// clicks.

import { BOARD_SIZE } from '../config.js';
import { X } from '../logic/board.js';
import { WIND_RABBIT } from '../logic/characters.js';
import { createSeats, pickCharacter } from '../logic/seats.js';
import { SKILLS } from '../logic/skills.js';
import { HOST, ROOM_SEATS } from '../net/room.js';
import { normalizeQuality } from '../render3d/quality.js';
import { GAME_OVER, LOBBY, ROOM_CLOSED_SCREEN, SELECT, SPECTATE_SCREEN, WAITING_SCREEN, WATCH } from './app.js';
import { FLOW_EVENTS, LOCAL_SEATS, MODES, SCREENS, flowReducer, initialFlow, isSelecting } from './flow.js';
import { gameOverViewModel, rematchViewModel } from './game-over.js';
import { parseHudParam } from './hud-collapse.js';
import { localSelectViewModel, roomClosedViewModel, spectateViewModel, waitingViewModel, watchViewModel } from './room-screens.js';
import { SHOT_FIELD, SHOT_FREE_ACTION, SHOT_VENOM_CLOUD } from './shot-position.js';
import { STRINGS } from './strings.js';

// The name the empty name boxes suggest in the pictures (a random one in play).
export const SHOT_NAME = 'Sweet Ant';

export const SHOT_SCENES = Object.freeze([
  'field', 'empty', 'menu', 'howto', 'settings', 'lobby', 'waiting', 'starting', 'select', 'gameover', 'gameover-pending',
  'spectate', 'spectate-game', 'room-closed', 'freeaction', 'venomcloud',
]);

// The Free Action scene (docs/free-action-design.md section 8): the field
// position after a Mud Trap was used and before the planting (SHOT_FREE_ACTION).
export const SHOT_FREE_ACTION_SCENE = 'freeaction';

// The Venom and Cloud scene (docs/free-action-design.md section 8): Jade
// Serpent against Cloud Eagle, a poison zone half under a dense cloud, seen by
// the player who does not own the cloud (SHOT_VENOM_CLOUD).
export const SHOT_VENOM_CLOUD_SCENE = 'venomcloud';

// The sides a scene is played with (undefined: the game's own default sides).
export function shotCharacters(scene) {
  return scene === SHOT_VENOM_CLOUD_SCENE ? SHOT_VENOM_CLOUD.characters : undefined;
}

// The spectator's live game scene (docs/flow-design.md section 3.9): the
// field scene watched by a spectator of SHOT_ROOM, with the watch card on
// top and the HUD of nobody's side.
export const SHOT_WATCH_SCENE = 'spectate-game';

// The game over scenes (docs/flow-design.md section 7): the field scene
// with the game over card on top, Wind Rabbit (X) wins and this window is
// the online viewer playing it. The value is the Rematch state: mine is
// true once this window asked.
const GAME_OVER_SCENES = Object.freeze({
  gameover: { mine: false, theirs: false, gone: false },
  'gameover-pending': { mine: true, theirs: false, gone: false },
});
export const SHOT_GAME_OVER = Object.freeze({ winner: X, you: X, reason: 'five' });

// The room of the waiting and starting scenes: a fixed code, this window
// the host, who picked Wind Rabbit (the other seat has no pick yet).
export const SHOT_ROOM = Object.freeze({
  code: 'ABCD5',
  character: WIND_RABBIT,
  seat: HOST,
  seats: pickCharacter(createSeats(ROOM_SEATS), HOST, WIND_RABBIT).seats,
});

// The local character select of the select scene: Player 1 picked Wind
// Rabbit and is Ready, so the cards pick for Player 2 and Wind Rabbit is
// Taken.
const SHOT_SELECT_EVENTS = Object.freeze([
  FLOW_EVENTS.PLAY_LOCAL,
  { type: FLOW_EVENTS.PICK, seat: LOCAL_SEATS[0], character: WIND_RABBIT },
  { type: FLOW_EVENTS.READY, seat: LOCAL_SEATS[0] },
]);

// The flow screens of shot mode (docs/flow-design.md section 7): the scene
// name and the flow events that lead to it from the first state. They show
// their own screen over the empty scene, with no HUD.
const FLOW_SCENES = Object.freeze({
  menu: [],
  howto: [FLOW_EVENTS.OPEN_HOWTO],
  settings: [FLOW_EVENTS.OPEN_SETTINGS],
  lobby: [FLOW_EVENTS.PLAY_ONLINE],
  waiting: [FLOW_EVENTS.PLAY_ONLINE, FLOW_EVENTS.ROOM_CREATED],
  starting: [FLOW_EVENTS.PLAY_ONLINE, FLOW_EVENTS.ROOM_CREATED, FLOW_EVENTS.OPPONENT_JOINED],
  select: SHOT_SELECT_EVENTS,
  spectate: [FLOW_EVENTS.WATCH],
  'room-closed': [FLOW_EVENTS.WATCH, FLOW_EVENTS.SPECTATOR_JOINED, FLOW_EVENTS.ROOM_CLOSED],
});

// The flow state (flow.js) a shot scene shows, or null for a game scene.
export function shotFlow(scene) {
  if (!Object.hasOwn(FLOW_SCENES, scene)) return null;
  return FLOW_SCENES[scene].reduce(flowReducer, initialFlow());
}

// What the lobby and room screens (screens.js) show in the lobby, waiting,
// starting, select, spectate and room-closed scenes, in the shape of the
// app's getView() (app.js): the lobby panel, the waiting room of SHOT_ROOM,
// the local character select, the spectator's empty code box or the Room
// closed notice. null for other scenes.
export function shotRoomView(scene) {
  const flow = shotFlow(scene);
  if (!flow || flow.screen === SCREENS.MENU) return null;
  const inRoom = flow.screen === SCREENS.WAITING || flow.screen === SCREENS.STARTING;
  const selecting = isSelecting(flow);
  const spectate = flow.screen === SCREENS.SPECTATE;
  const closed = flow.screen === SCREENS.ROOM_CLOSED;
  return {
    screen: inRoom ? WAITING_SCREEN : selecting ? SELECT : spectate ? SPECTATE_SCREEN : closed ? ROOM_CLOSED_SCREEN : LOBBY,
    spectate: spectate ? spectateViewModel() : null,
    roomClosed: closed ? roomClosedViewModel() : null,
    flow,
    waiting: inRoom ? waitingViewModel(flow, SHOT_ROOM) : null,
    select: selecting ? localSelectViewModel(flow) : null,
    code: inRoom ? SHOT_ROOM.code : null,
    character: inRoom ? SHOT_ROOM.character : null,
    joining: false,
    joiningCode: null,
    joinError: null,
    outcome: null,
  };
}

// What the game over card (screens.js) shows in the gameover and
// gameover-pending scenes, in the shape of the app's getView() (app.js).
// null for other scenes.
export function shotGameOverView(scene) {
  if (!Object.hasOwn(GAME_OVER_SCENES, scene)) return null;
  const flow = [FLOW_EVENTS.PLAY_ONLINE, FLOW_EVENTS.ROOM_CREATED, FLOW_EVENTS.OPPONENT_JOINED, FLOW_EVENTS.START,
    FLOW_EVENTS.GAME_OVER].reduce(flowReducer, initialFlow());
  return {
    screen: GAME_OVER,
    flow,
    waiting: null,
    code: SHOT_ROOM.code,
    character: SHOT_ROOM.character,
    joining: false,
    joiningCode: null,
    joinError: null,
    outcome: null,
    gameOver: {
      ...gameOverViewModel({ mode: MODES.ONLINE, ...SHOT_GAME_OVER }),
      rematch: rematchViewModel({ mode: MODES.ONLINE, ...GAME_OVER_SCENES[scene] }),
      backToMenu: STRINGS.gameOverBackToMenu,
    },
  };
}

// What the watch card (screens.js) shows in the spectate-game scene, in
// the shape of the app's getView() (app.js), for the field scene's game
// state. null for other scenes.
export function shotWatchView(scene, state) {
  if (scene !== SHOT_WATCH_SCENE) return null;
  const flow = [FLOW_EVENTS.WATCH, FLOW_EVENTS.SPECTATOR_JOINED, FLOW_EVENTS.START].reduce(flowReducer, initialFlow());
  return {
    screen: WATCH,
    flow,
    waiting: null,
    code: SHOT_ROOM.code,
    character: null,
    joining: false,
    joiningCode: null,
    joinError: null,
    outcome: null,
    watch: watchViewModel({ code: SHOT_ROOM.code, state }),
  };
}

// A still stand-in for the app (app.js) that the lobby and room screens
// (screens.js) draw from in shot mode: always the same view, never a change,
// and no actions.
export function stillRoomApp(view) {
  return {
    getView: () => view,
    getScreen: () => view.screen,
    onChange: () => () => {},
  };
}

const DEFAULT_SCENE = 'field';

// The popup parameter (popup=venom, popup=tornadozone): the skill whose popup
// opens in the first HUD card (docs/skill-popup-design.md section 1). The
// value is a skill id in any case, with or without separators; anything else
// is null (no popup).
export function parsePopupParam(value) {
  const name = String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return Object.keys(SKILLS).find((id) => id.toLowerCase() === name) ?? null;
}

// The hover parameter (hover=7,9): the plot (x,y) the pointer stands on, so a
// picture shows the glowing hover plot (no mouse exists in shot mode). The field
// scene's selected skill is cancelled then, because a skill target flow shows
// its own marks instead. Anything but two numbers inside the board is null.
export function parseHoverParam(value) {
  const match = /^\s*(\d{1,2})\s*,\s*(\d{1,2})\s*$/.exec(String(value ?? ''));
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  return x < BOARD_SIZE && y < BOARD_SIZE ? { x, y } : null;
}

// The shot and quality parameters of a URL search string (or
// URLSearchParams): null without the shot parameter, else { scene,
// quality, hud, popup, hover }. An unknown or empty scene is `field`; quality is low,
// medium or high (missing or unknown values are medium, as for ?quality=); hud
// is 'expanded' or 'collapsed' (both HUD cards, over any stored choice) or
// null; popup is a skill id (parsePopupParam) or null; hover is { x, y }
// (parseHoverParam) or null.
export function parseShotParams(search) {
  const params = typeof search === 'string' || search == null ? new URLSearchParams(search ?? '') : search;
  const shot = params.get('shot');
  if (shot === null) return null;
  const name = shot.trim().toLowerCase();
  return {
    scene: SHOT_SCENES.includes(name) ? name : DEFAULT_SCENE,
    quality: normalizeQuality(params.get('quality')),
    hud: parseHudParam(params.get('hud')),
    popup: parsePopupParam(params.get('popup')),
    hover: parseHoverParam(params.get('hover')),
  };
}

// Plays the scene on a fresh local game (src/ui/local-game.js) through its
// clicks (the game over and spectate-game scenes play the field scene). Returns the growth to show: { growing: [{ x, y, player, ageMs }],
// last: { x, y, player, ageMs } or null }. Throws if a click is refused,
// so a position that breaks the rules can never be shown.
export function setUpShotScene(game, scene) {
  const freeAction = scene === SHOT_FREE_ACTION_SCENE;
  const venomCloud = scene === SHOT_VENOM_CLOUD_SCENE;
  if (scene !== 'field' && !freeAction && !venomCloud && scene !== SHOT_WATCH_SCENE && !Object.hasOwn(GAME_OVER_SCENES, scene)) return { growing: [], last: null };
  // The free action scene is the first part of the field scene, with no skill selected.
  const { actions: allActions, growing, lastMoveAgeMs, selectedSkill } = freeAction
    ? { ...SHOT_FIELD, ...SHOT_FREE_ACTION, selectedSkill: null }
    : venomCloud ? { ...SHOT_VENOM_CLOUD, selectedSkill: null } : SHOT_FIELD;
  const actions = freeAction ? allActions.slice(0, SHOT_FREE_ACTION.actionCount) : allActions;
  let last = null;
  for (const action of actions) {
    const player = game.getState().currentPlayer;
    if (action.skill && !game.clickSkill(player, action.skill)) throw new Error(`Shot scene: ${action.skill} cannot start`);
    if (!game.click({ x: action.x, y: action.y })) throw new Error(`Shot scene: the move at ${action.x},${action.y} was refused`);
    if (!action.skill) last = { x: action.x, y: action.y, player, ageMs: lastMoveAgeMs };
  }
  game.takeEvents(); // the scene's own events are not replayed
  const board = game.getState().board;
  const grown = growing.map(({ x, y, ageMs }) => ({ x, y, player: board[y][x], ageMs }));
  const toMove = game.getState().currentPlayer;
  if (selectedSkill && !game.clickSkill(toMove, selectedSkill)) throw new Error(`Shot scene: ${selectedSkill} cannot be selected`);
  return { growing: grown, last };
}
