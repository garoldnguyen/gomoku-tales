// Pure core rules (docs/design.md sections 4 and 5, docs/free-action-design.md
// section 1: Free Action). Actions never mutate
// the state they are given; they return { ok: true, state, events } with a
// new state and the list of things that happened (for rendering and
// effects), or { ok: false, error, events: [] } when the action is not
// allowed.

import { BOARD_SIZE } from '../config.js';
import { X, O, cloneBoard, createBoard, inBounds, isBoardFull, isEmptyCell, findWinLineAt } from './board.js';
import { DEFAULT_SIDES, FIRST_PLAYER, assignSides, characterForStone } from './characters.js';
import { cooldownTurns, getSkill, isPassiveSkill, TERRAIN_CREATION, STONE_CONVERSION, WIND_DASH, TORNADO_ZONE, HISS, VENOM, CLOUD } from './skills.js';
import { breakRocks, stoneConversion, terrainCreation } from './earth-bear-skills.js';
import { inTornado, resolveDash, throwStone, tornadoZone, windDash } from './wind-rabbit-skills.js';
import { hiss, isSkillLocked, venom } from './jade-serpent-skills.js';
import { cloud, tickClouds } from './cloud.js';

// The refusal of a second skill in one turn (Free Action). The UI shows the
// same sentence through STRINGS.skillAlreadyUsedError (src/ui/strings.js).
export const SKILL_ALREADY_USED_ERROR = 'You already used a skill this turn.';

// Skill effects by skill id.
const SKILL_EFFECTS = {
  [WIND_DASH]: windDash,
  [TORNADO_ZONE]: tornadoZone,
  [TERRAIN_CREATION]: terrainCreation,
  [STONE_CONVERSION]: stoneConversion,
  [HISS]: hiss,
  [VENOM]: venom,
  [CLOUD]: cloud,
};

// A fresh game (docs/flow-design.md section 5), shared by the online host,
// local mode and every rematch: empty board, no rocks, no pending Wind
// Dash, no Tornado Zone, no Hiss lock, no skill used yet, every cooldown 0,
// X (the first pick) to move, no winner. options.size is the board size;
// options.characters the sides from assignSides (default DEFAULT_SIDES:
// Wind Rabbit X, Earth Bear O), kept across a rematch by passing them
// again. Random choices are not made here, the actions keep taking the
// injected random function.
export function newGame(options = {}) {
  const { size = BOARD_SIZE, characters = DEFAULT_SIDES } = options;
  return createInitialState(size, characters);
}

export function createInitialState(size = BOARD_SIZE, characters = DEFAULT_SIDES) {
  const sides = assignSides([characters[X], characters[O]]); // checks the two picks
  return {
    board: createBoard(size),
    characters: sides, // { X: characterId, O: characterId } by pick order
    currentPlayer: FIRST_PLAYER, // the first pick (X) always moves first
    turn: 1, // number of the turn being played, counting both players
    rocks: [], // [{ x, y, breaksAfterTurn }], also marked ROCK on the board
    pendingDash: null, // { player, from, to, resolvesAfterTurn } while a Wind Dash is announced
    tornado: null, // { player, x, y, cells, endsAfterTurn } while a Tornado Zone is active
    skillLock: null, // { player, endsAfterTurn } while a Hiss keeps that player from using skills
    skillUsed: null, // id of the skill the player to move used this turn, or null (Free Action)
    cooldowns: { [X]: initialCooldowns(sides, X), [O]: initialCooldowns(sides, O) },
    winner: null,
    winLine: null,
    draw: false,
  };
}

// Every skill of the player's character starts ready (0 turns left).
function initialCooldowns(sides, player) {
  return Object.fromEntries(characterForStone(player, sides).skills.map((skillId) => [skillId, 0]));
}

// The character the player plays in this game.
export function characterOf(state, player) {
  return characterForStone(player, state.characters ?? DEFAULT_SIDES);
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

// Places a stone for the acting player. Planting is the only action that
// ends a turn (Free Action). A stone placed inside the
// opponent's active Tornado Zone is thrown by a dandelion storm to a random
// empty plot anywhere outside the zone; options.random (default
// Math.random) picks it, so only the host runs it and tests can inject it.
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
    const thrown = throwStone(board, x, y, tornado, random);
    return finishTurn({ ...state, board: thrown.board }, player, [...events, ...thrown.events], thrown.changed);
  }
  return finishTurn({ ...state, board }, player, events, { x, y });
}

// Uses one of the acting player's skills (Free Action): at most one per
// turn, and it does not end the turn. The skill is applied, its full
// cooldown starts at once and state.skillUsed names it; the same player is
// still to move, state.turn is unchanged and no turnEnded event is made. The
// player must still plant a seed (placeStone) to end the turn. A skill that
// changes a plant (a changed cell) runs the win check at once.
// action = { player, skill, target } where target is whatever the skill
// needs: { from: { x, y }, to: { x, y } } for Wind Dash and a cell
// { x, y } for the other skills (Hiss needs none).
export function useSkill(state, action) {
  const { player, skill: skillId, target = null } = action;
  if (isGameOver(state)) return fail('The game is over.');
  if (player !== state.currentPlayer) return fail('It is not your turn.');
  const error = checkSkill(state, player, skillId);
  if (error) return fail(error);

  const { error: effectError, events: effectEvents, changed, ...updates } = SKILL_EFFECTS[skillId](state, player, target);
  if (effectError) return fail(effectError);
  const events = [{ type: 'skillUsed', player, skill: skillId, target }, ...effectEvents];
  const used = {
    ...state,
    ...updates,
    skillUsed: skillId,
    cooldowns: { ...state.cooldowns, [player]: { ...state.cooldowns[player], [skillId]: cooldownTurns(skillId) } },
  };
  const winLine = changed ? findWinLineAt(used.board, changed.x, changed.y) : null;
  if (winLine) return win(used, player, winLine, events);
  // A rock on the last empty plot leaves nowhere to plant: the draw check
  // that a turn end used to make (the turn has to end with a planting now).
  if (isBoardFull(used.board)) return done({ ...used, draw: true, skillUsed: null }, [...events, { type: 'draw' }]);
  return done(used, events);
}

function checkSkill(state, player, skillId) {
  const skill = getSkill(skillId);
  if (!skill) return 'Unknown skill.';
  const character = characterOf(state, player);
  if (!character || !character.skills.includes(skillId)) return 'That is not your skill.';
  if (isPassiveSkill(skillId)) return `${skill.name} is always on.`;
  const left = skillCooldown(state, player, skillId);
  if (left > 0) return `${skill.name} is on cooldown for ${left} more ${left === 1 ? 'turn' : 'turns'}.`;
  if (isSkillLocked(state, player)) return 'Hiss: you cannot use a skill this turn.';
  if (state.skillUsed) return SKILL_ALREADY_USED_ERROR;
  return null;
}

// Runs the win check for the acting player on the cell whose stone
// changed and, if the game goes on, ends their turn (only a planting gets
// here): a Wind Dash waiting for this turn to end resolves (with a win check
// for the dashing player), a Tornado Zone lasting through this turn
// disappears, a Hiss lock lasting through this turn ends, the acting
// player's clouds lose a turn (and disappear when none is left), rocks whose
// lifetime ends with this turn break, the draw check runs, their cooldowns
// count down (all but the skill used this turn, whose full cooldown started
// when it was used), skillUsed is cleared and the other player is to move.
// If the acting player wins, nothing else happens: a pending dash never
// resolves and is dropped, and so is a Tornado Zone (it only lasts through
// this turn), so neither is still shown as coming; a Hiss lock is dropped
// too.
function finishTurn(state, player, events, changed) {
  const winLine = changed ? findWinLineAt(state.board, changed.x, changed.y) : null;
  if (winLine) return win(state, player, winLine, events);

  const dash = state.pendingDash;
  if (dash && dash.resolvesAfterTurn <= state.turn) {
    const resolved = resolveDash(state.board, dash);
    state = { ...state, board: resolved.board, pendingDash: null };
    events = [...events, ...resolved.events];
    const dashLine = resolved.changed ? findWinLineAt(state.board, resolved.changed.x, resolved.changed.y) : null;
    if (dashLine) {
      return done({ ...state, winner: dash.player, winLine: dashLine, skillLock: null, skillUsed: null }, [...events, { type: 'win', player: dash.player, line: dashLine }]);
    }
  }

  const { tornado } = state;
  if (tornado && tornado.endsAfterTurn <= state.turn) {
    state = { ...state, tornado: null };
    events = [...events, { type: 'tornadoEnded', player: tornado.player }];
  }

  const { skillLock } = state;
  if (skillLock && skillLock.endsAfterTurn <= state.turn) {
    state = { ...state, skillLock: null };
    events = [...events, { type: 'hissEnded', player: skillLock.player }];
  }

  if (state.clouds) {
    const clouds = tickClouds(state.clouds, player, state.turn);
    state = { ...state, clouds: clouds.clouds };
    events = [...events, ...clouds.events];
  }

  const rocks = breakRocks(state.board, state.rocks, state.turn);
  state = { ...state, board: rocks.board, rocks: rocks.rocks };
  events = [...events, ...rocks.events];
  if (isBoardFull(state.board)) {
    return done({ ...state, draw: true, skillUsed: null }, [...events, { type: 'draw' }]);
  }

  const own = {};
  for (const [skillId, left] of Object.entries(state.cooldowns[player])) {
    own[skillId] = skillId === state.skillUsed ? left : Math.max(0, left - 1);
  }

  const next = {
    ...state,
    cooldowns: { ...state.cooldowns, [player]: own },
    currentPlayer: otherPlayer(player),
    turn: state.turn + 1,
    skillUsed: null,
  };
  return done(next, [...events, { type: 'turnEnded', player, turn: state.turn }]);
}

// The acting player made five: the game is over (see finishTurn).
function win(state, player, winLine, events) {
  const ended = { ...state, winner: player, winLine, pendingDash: null, tornado: null, skillLock: null, skillUsed: null };
  return done(ended, [...events, { type: 'win', player, line: winLine }]);
}

function done(state, events) {
  return { ok: true, state, events };
}

function fail(error) {
  return { ok: false, error, events: [] };
}
