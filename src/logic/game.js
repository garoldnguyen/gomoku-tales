// Pure core rules (docs/design.md sections 4 and 5). Actions never mutate
// the state they are given; they return { ok: true, state, events } with a
// new state and the list of things that happened (for rendering and
// effects), or { ok: false, error, events: [] } when the action is not
// allowed.

import { BOARD_SIZE } from '../config.js';
import { X, O, cloneBoard, createBoard, inBounds, isBoardFull, isEmptyCell, findWinLineAt } from './board.js';
import { characterForStone } from './characters.js';
import { cooldownTurns, getSkill, TERRAIN_CREATION, STONE_CONVERSION, WIND_DASH, TORNADO_ZONE } from './skills.js';
import { breakRocks, stoneConversion, terrainCreation } from './earth-bear-skills.js';
import { inTornado, resolveDash, throwStone, tornadoZone, windDash } from './wind-rabbit-skills.js';

// Skill effects by skill id.
const SKILL_EFFECTS = {
  [WIND_DASH]: windDash,
  [TORNADO_ZONE]: tornadoZone,
  [TERRAIN_CREATION]: terrainCreation,
  [STONE_CONVERSION]: stoneConversion,
};

// A fresh game (docs/flow-design.md section 5), shared by the online host,
// local mode and every rematch: empty board, no rocks, no pending Wind
// Dash, no Tornado Zone, every cooldown 0, Wind Rabbit (X) to move, no
// winner. Characters are tied to their stones, so they keep their sides.
// options.size is the board size; random choices are not made here, the
// actions keep taking the injected random function.
export function newGame(options = {}) {
  const { size = BOARD_SIZE } = options;
  return createInitialState(size);
}

export function createInitialState(size = BOARD_SIZE) {
  return {
    board: createBoard(size),
    currentPlayer: X, // Wind Rabbit (X) always moves first
    turn: 1, // number of the turn being played, counting both players
    rocks: [], // [{ x, y, breaksAfterTurn }], also marked ROCK on the board
    pendingDash: null, // { player, from, to, resolvesAfterTurn } while a Wind Dash is announced
    tornado: null, // { player, x, y, cells, endsAfterTurn } while a Tornado Zone is active
    cooldowns: { [X]: initialCooldowns(X), [O]: initialCooldowns(O) },
    winner: null,
    winLine: null,
    draw: false,
  };
}

// Every skill of the player's character starts ready (0 turns left).
function initialCooldowns(player) {
  return Object.fromEntries(characterForStone(player).skills.map((skillId) => [skillId, 0]));
}

export function isGameOver(state) {
  return state.winner !== null || state.draw;
}

export function otherPlayer(player) {
  return player === X ? O : X;
}

// Own turns left during which the player cannot use the skill.
export function skillCooldown(state, player, skillId) {
  return state.cooldowns[player]?.[skillId] ?? 0;
}

export function canUseSkill(state, player, skillId) {
  return !isGameOver(state) && player === state.currentPlayer && checkSkill(state, player, skillId) === null;
}

// Places a stone for the acting player. A stone placed inside the
// opponent's active Tornado Zone is thrown to a random empty neighbour;
// options.random (default Math.random) picks it, so only the host runs it
// and tests can inject it.
export function placeStone(state, action, options = {}) {
  const { random = Math.random } = options;
  const { player, x, y } = action;
  if (isGameOver(state)) return fail('The game is over.');
  if (player !== state.currentPlayer) return fail('It is not your turn.');
  if (!inBounds(state.board, x, y)) return fail('That cell is off the board.');
  if (!isEmptyCell(state.board, x, y)) return fail('That cell is not empty.');

  const board = cloneBoard(state.board);
  board[y][x] = player;
  const events = [{ type: 'stonePlaced', player, x, y }];
  const { tornado } = state;
  if (tornado && tornado.player !== player && inTornado(tornado, x, y)) {
    const thrown = throwStone(board, x, y, random);
    return finishTurn({ ...state, board: thrown.board }, player, [...events, ...thrown.events], thrown.changed);
  }
  return finishTurn({ ...state, board }, player, events, { x, y });
}

// Uses one of the acting player's skills. Using a skill uses the whole
// turn. action = { player, skill, target } where target is whatever the
// skill needs: { from: { x, y }, to: { x, y } } for Wind Dash and a cell
// { x, y } for the other skills.
export function useSkill(state, action) {
  const { player, skill: skillId, target = null } = action;
  if (isGameOver(state)) return fail('The game is over.');
  if (player !== state.currentPlayer) return fail('It is not your turn.');
  const error = checkSkill(state, player, skillId);
  if (error) return fail(error);

  const { error: effectError, events: effectEvents, changed, ...updates } = SKILL_EFFECTS[skillId](state, player, target);
  if (effectError) return fail(effectError);
  const events = [{ type: 'skillUsed', player, skill: skillId, target }, ...effectEvents];
  return finishTurn({ ...state, ...updates }, player, events, changed, skillId);
}

function checkSkill(state, player, skillId) {
  const skill = getSkill(skillId);
  if (!skill) return 'Unknown skill.';
  const character = characterForStone(player);
  if (!character || !character.skills.includes(skillId)) return 'That is not your skill.';
  const left = skillCooldown(state, player, skillId);
  if (left > 0) return `${skill.name} is on cooldown for ${left} more ${left === 1 ? 'turn' : 'turns'}.`;
  return null;
}

// Runs the win check for the acting player on the cell whose stone
// changed and, if the game goes on, ends their turn: a Wind Dash waiting
// for this turn to end resolves (with a win check for the dashing player),
// a Tornado Zone lasting through this turn disappears, rocks whose
// lifetime ends with this turn break, the draw check runs, their cooldowns
// count down (a skill used this turn starts its full cooldown) and the
// other player is to move. If the acting player wins, nothing else happens:
// a pending dash never resolves and is dropped, and so is a Tornado Zone
// (it only lasts through this turn), so neither is still shown as coming.
function finishTurn(state, player, events, changed, usedSkillId = null) {
  const winLine = changed ? findWinLineAt(state.board, changed.x, changed.y) : null;
  if (winLine) {
    const ended = { ...state, winner: player, winLine, pendingDash: null, tornado: null };
    return done(ended, [...events, { type: 'win', player, line: winLine }]);
  }

  const dash = state.pendingDash;
  if (dash && dash.resolvesAfterTurn <= state.turn) {
    const resolved = resolveDash(state.board, dash);
    state = { ...state, board: resolved.board, pendingDash: null };
    events = [...events, ...resolved.events];
    const dashLine = resolved.changed ? findWinLineAt(state.board, resolved.changed.x, resolved.changed.y) : null;
    if (dashLine) {
      return done({ ...state, winner: dash.player, winLine: dashLine }, [...events, { type: 'win', player: dash.player, line: dashLine }]);
    }
  }

  const { tornado } = state;
  if (tornado && tornado.endsAfterTurn <= state.turn) {
    state = { ...state, tornado: null };
    events = [...events, { type: 'tornadoEnded', player: tornado.player, x: tornado.x, y: tornado.y }];
  }

  const rocks = breakRocks(state.board, state.rocks, state.turn);
  state = { ...state, board: rocks.board, rocks: rocks.rocks };
  events = [...events, ...rocks.events];
  if (isBoardFull(state.board)) {
    return done({ ...state, draw: true }, [...events, { type: 'draw' }]);
  }

  const own = {};
  for (const [skillId, left] of Object.entries(state.cooldowns[player])) {
    own[skillId] = Math.max(0, left - 1);
  }
  if (usedSkillId) own[usedSkillId] = cooldownTurns(usedSkillId);

  const next = {
    ...state,
    cooldowns: { ...state.cooldowns, [player]: own },
    currentPlayer: otherPlayer(player),
    turn: state.turn + 1,
  };
  return done(next, [...events, { type: 'turnEnded', player, turn: state.turn }]);
}

function done(state, events) {
  return { ok: true, state, events };
}

function fail(error) {
  return { ok: false, error, events: [] };
}
