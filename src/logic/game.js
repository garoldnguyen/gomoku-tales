// Pure core rules (docs/design.md sections 4 and 5). Actions never mutate
// the state they are given; they return { ok: true, state, events } with a
// new state and the list of things that happened (for rendering and
// effects), or { ok: false, error, events: [] } when the action is not
// allowed.

import { BOARD_SIZE } from '../config.js';
import { X, O, cloneBoard, createBoard, inBounds, isBoardFull, isEmptyCell, findWinLineAt } from './board.js';
import { DEFAULT_SIDES, FIRST_PLAYER, assignSides, characterForStone } from './characters.js';
import { cooldownTurns, getSkill, isPassiveSkill, TERRAIN_CREATION, STONE_CONVERSION, WIND_DASH, TORNADO_ZONE, HISS, VENOM, CLOUD } from './skills.js';
import { breakRocks, stoneConversion, terrainCreation } from './earth-bear-skills.js';
import { blowZone, inTornado, resolveDash, tornadoZone, windDash } from './wind-rabbit-skills.js';
import { hiss, isSkillLocked, venom } from './jade-serpent-skills.js';
import { cloud, tickClouds } from './cloud.js';

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
// Dash, no Tornado Zone, no Hiss lock, every cooldown 0, X (the first
// pick) to move, no winner. options.size is the board size;
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

// Places a stone for the acting player. A Tornado Zone of the opponent's
// that ends with this turn then blows away every plant inside it, this one
// too if it lies there; options.random (default Math.random) picks where
// they land, so only the host runs it and tests can inject it.
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
  return finishTurn({ ...state, board }, player, events, { x, y }, null, random);
}

// Uses one of the acting player's skills. Using a skill uses the whole
// turn. action = { player, skill, target } where target is whatever the
// skill needs: { from: { x, y }, to: { x, y } } for Wind Dash and a cell
// { x, y } for the other skills (Hiss needs none). options.random is as for
// placeStone (a Tornado Zone ending with this turn).
export function useSkill(state, action, options = {}) {
  const { random = Math.random } = options;
  const { player, skill: skillId, target = null } = action;
  if (isGameOver(state)) return fail('The game is over.');
  if (player !== state.currentPlayer) return fail('It is not your turn.');
  const error = checkSkill(state, player, skillId);
  if (error) return fail(error);

  const { error: effectError, events: effectEvents, changed, ...updates } = SKILL_EFFECTS[skillId](state, player, target);
  if (effectError) return fail(effectError);
  const events = [{ type: 'skillUsed', player, skill: skillId, target }, ...effectEvents];
  return finishTurn({ ...state, ...updates }, player, events, changed, skillId, random);
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
  return null;
}

// Runs the win check for the acting player on the cell whose stone
// changed and, if the game goes on, ends their turn: a Wind Dash waiting
// for this turn to end resolves (with a win check for the dashing player),
// a Tornado Zone lasting through this turn disappears, a Hiss lock lasting
// through this turn ends, the acting player's clouds lose a turn (and
// disappear when none is left), rocks whose
// lifetime ends with this turn break, the draw check runs, their cooldowns
// count down (a skill used this turn starts its full cooldown) and the
// other player is to move. If the acting player wins, nothing else happens:
// a pending dash never resolves and is dropped, and so is a Tornado Zone
// (it only lasts through this turn), so neither is still shown as coming;
// a Hiss lock is dropped too.
function finishTurn(state, player, events, changed, usedSkillId = null, random = Math.random) {
  const { tornado } = state;
  if (tornado && tornado.endsAfterTurn <= state.turn) {
    // The storm first: every plant in the zone flies, then the win check
    // runs on the acting player's cell (where it landed, if it flew) and on
    // every landing plot. A five made by the storm counts for whoever owns
    // it; fives for both players at once are a draw.
    const storm = blowZone(state.board, tornado, random);
    state = { ...state, board: storm.board, tornado: null };
    events = [...events, ...storm.events, { type: 'tornadoEnded', player: tornado.player, x: tornado.x, y: tornado.y }];
    const cells = storm.moves.map((move) => move.to);
    if (changed) {
      const moved = storm.moves.find((move) => move.from.x === changed.x && move.from.y === changed.y);
      if (!moved || !inTornado(tornado, changed.x, changed.y)) cells.unshift(moved ? moved.to : changed);
    }
    const lines = {};
    for (const cell of cells) {
      const owner = state.board[cell.y][cell.x];
      if (lines[owner]) continue;
      const line = findWinLineAt(state.board, cell.x, cell.y);
      if (line) lines[owner] = line;
    }
    if (lines[X] && lines[O]) {
      return done({ ...state, draw: true, pendingDash: null, skillLock: null }, [...events, { type: 'draw' }]);
    }
    const stormWinner = lines[X] ? X : lines[O] ? O : null;
    if (stormWinner) {
      const ended = { ...state, winner: stormWinner, winLine: lines[stormWinner], pendingDash: null, skillLock: null };
      return done(ended, [...events, { type: 'win', player: stormWinner, line: lines[stormWinner] }]);
    }
    changed = null; // checked above
  }

  const winLine = changed ? findWinLineAt(state.board, changed.x, changed.y) : null;
  if (winLine) {
    const ended = { ...state, winner: player, winLine, pendingDash: null, tornado: null, skillLock: null };
    return done(ended, [...events, { type: 'win', player, line: winLine }]);
  }

  const dash = state.pendingDash;
  if (dash && dash.resolvesAfterTurn <= state.turn) {
    const resolved = resolveDash(state.board, dash);
    state = { ...state, board: resolved.board, pendingDash: null };
    events = [...events, ...resolved.events];
    const dashLine = resolved.changed ? findWinLineAt(state.board, resolved.changed.x, resolved.changed.y) : null;
    if (dashLine) {
      return done({ ...state, winner: dash.player, winLine: dashLine, skillLock: null }, [...events, { type: 'win', player: dash.player, line: dashLine }]);
    }
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
