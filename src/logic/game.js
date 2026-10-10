// Pure core rules (docs/design.md sections 4 and 5, docs/free-action-design.md
// section 1: Free Action). Actions never mutate
// the state they are given; they return { ok: true, state, events } with a
// new state and the list of things that happened (for rendering and
// effects), or { ok: false, error, events: [] } when the action is not
// allowed.

import { BOARD_SIZE } from '../config.js';
import { X, O, cloneBoard, createBoard, inBounds, isBoardFull, isEmptyCell, findWinLineAt } from './board.js';
import { DEFAULT_SIDES, FIRST_PLAYER, assignSides, characterForStone } from './characters.js';
import { cooldownTurns, getSkill, isPassiveSkill, MUD_TRAP, PETRIFICATION, WIND_DASH, TORNADO_ZONE, HISS, VENOM, CLOUD } from './skills.js';
import { dryMud, mudTrap, petrification, sinkSeed, surfacingSeeds } from './earth-bear-skills.js';
import { scoringBoard } from './scoring-board.js';
import { resolveDash, throwStone, tornadoFires, tornadoZone, windDash } from './wind-rabbit-skills.js';
import { POISONED_ERROR, hasPlantableCell, hiss, isPoisoned, isSkillLocked, venom } from './jade-serpent-skills.js';
import { cloud, tickClouds } from './cloud.js';

// The refusal of a second skill in one turn (Free Action). The UI shows the
// same sentence through STRINGS.skillAlreadyUsedError (src/ui/strings.js).
export const SKILL_ALREADY_USED_ERROR = 'You already used a skill this turn.';

// Skill effects by skill id.
const SKILL_EFFECTS = {
  [WIND_DASH]: windDash,
  [TORNADO_ZONE]: tornadoZone,
  [MUD_TRAP]: mudTrap,
  [PETRIFICATION]: petrification,
  [HISS]: hiss,
  [VENOM]: venom,
  [CLOUD]: cloud,
};

// A fresh game (docs/flow-design.md section 5), shared by the online host,
// local mode and every rematch: empty board, no rocks, no mud, no sunk
// seed, no pending Wind Dash, no Tornado Zone, no Venom zone, no Hiss lock, no skill used yet, every cooldown 0,
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
    rocks: [], // [{ x, y }] permanent rocks (petrified plants), also marked ROCK on the board
    mud: [], // [{ x, y, player, driesAfterTurn }] Mud Trap puddles on empty plots
    sunk: [], // [{ x, y, player, surfacesAfterTurn }] seeds sunk in mud: on the board, but they count for no line
    pendingDash: null, // { player, from, to, resolvesAfterTurn } while a Wind Dash is announced
    tornado: null, // { player, x, y, cells, armedAfterTurn, endsAfterTurn } while a Tornado Zone trap waits (secret cross)
    poison: null, // { player, x, y, cells, endsAfterTurn } while a Venom zone lasts: nobody plants on its empty cells
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
// ends a turn (Free Action). A seed planted on a cell of an armed Tornado
// Zone cross (by either player, the caster too) fires the trap: it is used
// up at once and the seed is thrown to a random free neighbour plot, or
// stays when there is none. options.random (default Math.random) picks the
// plot, so only the host runs it and tests can inject it.
export function placeStone(state, action, options = {}) {
  const { random = Math.random } = options;
  const { player, x, y } = action;
  if (isGameOver(state)) return fail('The game is over.');
  if (player !== state.currentPlayer) return fail('It is not your turn.');
  if (!inBounds(state.board, x, y)) return fail('That cell is off the board.');
  if (!isEmptyCell(state.board, x, y)) return fail('That cell is not empty.');
  if (isPoisoned(state, x, y)) return fail(POISONED_ERROR);

  const board = cloneBoard(state.board);
  board[y][x] = player;
  let events = [{ type: 'stonePlaced', player, x, y }];
  let planted = { x, y }; // where the seed ends up
  state = { ...state, board };
  if (tornadoFires(state, x, y)) {
    const thrown = throwStone(state, x, y, random);
    state = { ...state, board: thrown.board, tornado: null };
    events = [...events, ...thrown.events];
    planted = thrown.changed;
  }
  // A seed that ends on a mud puddle sinks: it holds the plot but counts for
  // no line until it surfaces (the win check below reads the scoring board).
  const sunk = sinkSeed(state, player, planted.x, planted.y);
  if (sunk) {
    state = { ...state, mud: sunk.mud, sunk: sunk.sunk };
    events = [...events, ...sunk.events];
  }
  return finishTurn(state, player, events, planted);
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
  const winLine = changed ? findWinLineAt(scoringBoard(used), changed.x, changed.y) : null;
  if (winLine) return win(used, player, winLine, events);
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
// for the dashing player), a Tornado Zone trap that nobody fired and whose
// time ends with this turn is over (tornadoEnded, nothing revealed), a Hiss
// lock lasting through this turn ends, a Venom zone whose time ends with this
// turn ends (poisonEnded; also early when it would leave the next player no
// plot to plant on), the acting player's clouds lose a turn (and disappear when none is left), the mud
// puddles whose time ends with this turn dry, the draw check runs, their
// cooldowns count down (all but the skill used this turn, whose full
// cooldown started when it was used), skillUsed is cleared and the other
// player is to move. Every win check reads the scoring board, where a seed
// sunk in mud counts for nobody. A sunk seed whose time ends with this turn
// surfaces after the dash, with a win check for its owner (the acting
// player's own planting was checked first). The draw check waits for sunk
// seeds: when the board is full nobody can plant any more, so they all
// surface at once and the draw is decided after them.
// If the acting player wins, nothing else happens: a pending dash never
// resolves and is dropped, and so is a waiting Tornado Zone trap, so neither
// is still shown as coming; a Hiss lock is dropped too.
function finishTurn(state, player, events, changed) {
  const winLine = changed ? findWinLineAt(scoringBoard(state), changed.x, changed.y) : null;
  if (winLine) return win(state, player, winLine, events);

  const dash = state.pendingDash;
  if (dash && dash.resolvesAfterTurn <= state.turn) {
    const resolved = resolveDash(state, dash);
    state = { ...state, board: resolved.board, pendingDash: null };
    events = [...events, ...resolved.events];
    const dashLine = resolved.changed ? findWinLineAt(scoringBoard(state), resolved.changed.x, resolved.changed.y) : null;
    if (dashLine) {
      return done({ ...state, winner: dash.player, winLine: dashLine, skillLock: null, skillUsed: null }, [...events, { type: 'win', player: dash.player, line: dashLine }]);
    }
  }

  let surfaced = surfaceSeeds(state, player, events, false);
  if (surfaced.won) return surfaced.won;
  ({ state, events } = surfaced);

  const { tornado } = state;
  if (tornado && tornado.endsAfterTurn <= state.turn) {
    state = { ...state, tornado: null };
    events = [...events, { type: 'tornadoEnded', player: tornado.player }];
  }

  const { poison } = state;
  if (poison && poison.endsAfterTurn <= state.turn) {
    state = { ...state, poison: null };
    events = [...events, { type: 'poisonEnded', player: poison.player }];
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

  if (state.mud?.length) {
    const dried = dryMud(state.mud, state.turn);
    state = { ...state, mud: dried.mud };
    events = [...events, ...dried.events];
  }

  if (isBoardFull(state.board)) {
    surfaced = surfaceSeeds(state, player, events, true);
    if (surfaced.won) return surfaced.won;
    ({ state, events } = surfaced);
    return done({ ...state, draw: true, skillUsed: null }, [...events, { type: 'draw' }]);
  }

  // The player to move can always plant: if a Venom zone (still lasting)
  // has left no empty plot outside itself, it ends now instead of on time.
  if (state.poison && !hasPlantableCell(state)) {
    events = [...events, { type: 'poisonEnded', player: state.poison.player }];
    state = { ...state, poison: null };
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

// Surfaces the sunk seeds whose time ends with the state's turn (all of them
// with `all`): each leaves state.sunk, tells stoneSurfaced and counts for its
// owner from now on, with a win check at its plot. Returns { state, events }
// or, when a seed made five, { won } with the finished game.
function surfaceSeeds(state, actor, events, all) {
  const { surfacing: due, sunk } = surfacingSeeds(state.sunk ?? [], state.turn, actor, all);
  if (due.length === 0) return { state, events };
  state = { ...state, sunk };
  // A seed whose plot no longer holds its plant has nothing to surface and
  // can win for nobody (a stale entry must never credit the wrong side).
  const surfacing = due.filter((seed) => state.board[seed.y][seed.x] === seed.player);
  if (surfacing.length === 0) return { state, events };
  events = [...events, ...surfacing.map(({ player, x, y }) => ({ type: 'stoneSurfaced', player, x, y }))];
  for (const seed of surfacing) {
    const line = findWinLineAt(scoringBoard(state), seed.x, seed.y);
    if (line) return { won: win(state, seed.player, line, events) };
  }
  return { state, events };
}

// A player made five: the game is over (see finishTurn).
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
