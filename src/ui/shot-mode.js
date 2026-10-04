// Shot mode for the screenshot self-check (docs/shots.md section 4). Pure
// (no DOM): the URL parser and the scene set up on a local game. src/main.js
// runs shot mode only when the page URL has the shot parameter; without it
// none of this runs. Shot mode never changes the rules, the networking or
// the cell numbering: the scene is played through the local game's own
// clicks.

import { WIND_RABBIT } from '../logic/characters.js';
import { normalizeQuality } from '../render3d/quality.js';
import { LOBBY, WAITING_SCREEN } from './app.js';
import { FLOW_EVENTS, SCREENS, flowReducer, initialFlow } from './flow.js';
import { parseHudParam } from './hud-collapse.js';
import { waitingViewModel } from './room-screens.js';
import { SHOT_FIELD } from './shot-position.js';

export const SHOT_SCENES = Object.freeze(['field', 'empty', 'menu', 'howto', 'settings', 'lobby', 'waiting', 'starting']);

// The room of the waiting and starting scenes: a fixed code, this window
// the host playing Wind Rabbit.
export const SHOT_ROOM = Object.freeze({ code: 'ABCD5', character: WIND_RABBIT });

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
});

// The flow state (flow.js) a shot scene shows, or null for a game scene.
export function shotFlow(scene) {
  if (!Object.hasOwn(FLOW_SCENES, scene)) return null;
  return FLOW_SCENES[scene].reduce(flowReducer, initialFlow());
}

// What the lobby and room screens (screens.js) show in the lobby, waiting
// and starting scenes, in the shape of the app's getView() (app.js): the
// lobby panel, or the waiting room of SHOT_ROOM. null for other scenes.
export function shotRoomView(scene) {
  const flow = shotFlow(scene);
  if (!flow || flow.screen === SCREENS.MENU) return null;
  const inRoom = flow.screen === SCREENS.WAITING || flow.screen === SCREENS.STARTING;
  return {
    screen: inRoom ? WAITING_SCREEN : LOBBY,
    flow,
    waiting: inRoom ? waitingViewModel(flow, SHOT_ROOM) : null,
    code: inRoom ? SHOT_ROOM.code : null,
    character: inRoom ? SHOT_ROOM.character : null,
    joining: false,
    joiningCode: null,
    joinError: null,
    outcome: null,
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

// The shot and quality parameters of a URL search string (or
// URLSearchParams): null without the shot parameter, else { scene,
// quality, hud }. An unknown or empty scene is `field`; quality is low, medium
// or high (missing or unknown values are medium, as for ?quality=); hud is
// 'expanded' or 'collapsed' (both HUD cards, over any stored choice) or null.
export function parseShotParams(search) {
  const params = typeof search === 'string' || search == null ? new URLSearchParams(search ?? '') : search;
  const shot = params.get('shot');
  if (shot === null) return null;
  const name = shot.trim().toLowerCase();
  return {
    scene: SHOT_SCENES.includes(name) ? name : DEFAULT_SCENE,
    quality: normalizeQuality(params.get('quality')),
    hud: parseHudParam(params.get('hud')),
  };
}

// Plays the scene on a fresh local game (src/ui/local-game.js) through its
// clicks. Returns the growth to show: { growing: [{ x, y, player, ageMs }],
// last: { x, y, player, ageMs } or null }. Throws if a click is refused,
// so a position that breaks the rules can never be shown.
export function setUpShotScene(game, scene) {
  if (scene !== 'field') return { growing: [], last: null };
  const { actions, growing, lastMoveAgeMs, selectedSkill } = SHOT_FIELD;
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
  if (!game.clickSkill(toMove, selectedSkill)) throw new Error(`Shot scene: ${selectedSkill} cannot be selected`);
  return { growing: grown, last };
}
