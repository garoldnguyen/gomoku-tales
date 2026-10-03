// Shot mode for the screenshot self-check (docs/shots.md section 4). Pure
// (no DOM): the URL parser and the scene set up on a local game. src/main.js
// runs shot mode only when the page URL has the shot parameter; without it
// none of this runs. Shot mode never changes the rules, the networking or
// the cell numbering: the scene is played through the local game's own
// clicks.

import { normalizeQuality } from '../render3d/quality.js';
import { parseHudParam } from './hud-collapse.js';
import { SHOT_FIELD } from './shot-position.js';

export const SHOT_SCENES = Object.freeze(['field', 'empty']);
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
