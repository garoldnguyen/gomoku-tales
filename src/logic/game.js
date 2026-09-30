// Pure core rules (docs/design.md sections 4 and 5). Actions never mutate
// the state they are given; they return { ok: true, state, events } with a
// new state and the list of things that happened (for rendering and
// effects), or { ok: false, error, events: [] } when the action is not
// allowed.

import { BOARD_SIZE } from '../config.js';
import { X, O, cloneBoard, createBoard, inBounds, isBoardFull, isEmptyCell, findWinLineAt } from './board.js';
import { characterForStone } from './characters.js';
import { cooldownTurns, getSkill } from './skills.js';

export function createInitialState(size = BOARD_SIZE) {
  return {
    board: createBoard(size),
    currentPlayer: X, // Wind Rabbit (X) always moves first
    turn: 1, // number of the turn being played, counting both players
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

export function placeStone(state, action) {
  const { player, x, y } = action;
  if (isGameOver(state)) return fail('The game is over.');
  if (player !== state.currentPlayer) return fail('It is not your turn.');
  if (!inBounds(state.board, x, y)) return fail('That cell is off the board.');
  if (!isEmptyCell(state.board, x, y)) return fail('That cell is not empty.');

  const board = cloneBoard(state.board);
  board[y][x] = player;
  const events = [{ type: 'stonePlaced', player, x, y }];
  return finishTurn({ ...state, board }, player, events, { x, y });
}

// Uses one of the acting player's skills. Using a skill uses the whole
// turn. action = { player, skill, target } where target is whatever the
// skill needs (checked by the skill effect once it exists).
export function useSkill(state, action) {
  const { player, skill: skillId, target = null } = action;
  if (isGameOver(state)) return fail('The game is over.');
  if (player !== state.currentPlayer) return fail('It is not your turn.');
  const error = checkSkill(state, player, skillId);
  if (error) return fail(error);

  // Skill effects are not implemented yet: the skill only uses the turn
  // and starts its cooldown.
  const events = [{ type: 'skillUsed', player, skill: skillId, target }];
  return finishTurn(state, player, events, null, skillId);
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

// Runs the win and draw checks for the acting player and, if the game goes
// on, ends their turn: their cooldowns count down (a skill used this turn
// starts its full cooldown) and the other player is to move.
function finishTurn(state, player, events, placed, usedSkillId = null) {
  const winLine = placed ? findWinLineAt(state.board, placed.x, placed.y) : null;
  if (winLine) {
    return done({ ...state, winner: player, winLine }, [...events, { type: 'win', player, line: winLine }]);
  }
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
