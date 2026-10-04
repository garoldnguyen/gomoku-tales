// Offline controller for ?local=1 dev mode: one window plays both sides.
// Pure (no DOM); input handlers call it and the renderer reads getView().

import { X, O, isEmptyCell } from '../logic/board.js';
import { characterForStone } from '../logic/characters.js';
import { canUseSkill, characterOf, isGameOver, newGame, placeStone, skillCooldown, useSkill } from '../logic/game.js';
import { getSkill } from '../logic/skills.js';
import { isSkillLocked } from '../logic/jade-serpent-skills.js';
import { needsTarget, startTargeting, targetClick, targetPreview, targetPrompt } from './targeting.js';

// takeEvents' answer when nothing happened, shared so the render loop makes
// no new list on an ordinary frame.
const NO_EVENTS = Object.freeze([]);
// The outcomes getOutcome returns (the frame loop reads it every frame).
const X_WON = Object.freeze({ winner: X, reason: 'five' });
const O_WON = Object.freeze({ winner: O, reason: 'five' });
const DRAWN = Object.freeze({ winner: null, reason: 'draw' });

// options.random is passed to placeStone for the Tornado Zone throw;
// options.onApplied() is called after every applied action (the app checks
// whether the game ended); options.characters are the sides of the
// character select ({ X, O }, the first pick plays X; default DEFAULT_SIDES).
export function createLocalGame(options = {}) {
  const { random = Math.random, onApplied = () => {}, characters } = options;
  let state = newGame(characters ? { characters } : {});
  let hover = null; // board cell under the pointer
  let hoverSkill = null; // { player, skillId } of the button under the pointer
  let targeting = null; // skill target flow in progress, see targeting.js
  let message = null;
  let pendingEvents = []; // events of applied actions not yet taken for effects
  // The pending events, with a new list for the next ones (only on a frame
  // with events).
  const handOverEvents = () => {
    const events = pendingEvents;
    pendingEvents = [];
    return events;
  };

  // Takes the result of a rules action. Returns true if it was applied.
  const apply = (result) => {
    if (!result.ok) {
      message = result.error;
      return false;
    }
    state = result.state;
    targeting = null;
    message = describeEvents(result.events);
    pendingEvents.push(...result.events);
    onApplied();
    return true;
  };

  // A rematch in one window: a new game at once with the same characters on
  // the same sides, no messages and nobody to wait for.
  const rematchLocal = () => {
    state = newGame({ characters: state.characters });
    targeting = null;
    message = null;
    pendingEvents = [];
  };

  return {
    getState() {
      return state;
    },

    getTargeting() {
      return targeting;
    },

    // Events of the actions applied since the last call, oldest first, for
    // the effects (render/effects.js).
    takeEvents() {
      if (pendingEvents.length === 0) return NO_EVENTS; // most frames: nothing new, nothing made
      return handOverEvents();
    },

    setHover(cell) {
      hover = cell;
    },

    setHoverSkill(skill) {
      hoverSkill = skill;
    },

    // A board click: continues the skill target flow if one is running,
    // otherwise places a stone for whoever is to move. Returns true if an
    // action was applied to the game.
    click(cell) {
      if (!cell) return false;
      const player = state.currentPlayer;
      if (!targeting) return apply(placeStone(state, { player, x: cell.x, y: cell.y }, { random }));

      const step = targetClick(state, player, targeting, cell);
      if (step.error) {
        message = step.error;
        return false;
      }
      if (step.targeting) {
        targeting = step.targeting;
        message = null;
        return false;
      }
      return apply(useSkill(state, { player, skill: targeting.skill, target: step.target }));
    },

    // A skill button click: starts that skill's target flow, or cancels it
    // if it is already running. A skill with no target (Hiss) is used at
    // once. Returns true if a flow started or the skill was used.
    clickSkill(player, skillId) {
      if (targeting && targeting.skill === skillId) {
        targeting = null;
        message = null;
        return false;
      }
      const reason = skillLockReason(state, player, skillId);
      if (reason) {
        message = reason;
        return false;
      }
      if (!needsTarget(skillId)) return apply(useSkill(state, { player, skill: skillId }));
      targeting = startTargeting(skillId);
      message = null;
      return true;
    },

    // Stops the skill target flow. Returns true if one was running.
    cancel() {
      if (!targeting) return false;
      targeting = null;
      message = null;
      return true;
    },

    rematchLocal,
    restart: rematchLocal,

    // How the game ended ({ winner, reason } with reason 'five' or 'draw'),
    // or null while it goes on.
    getOutcome() {
      if (state.winner) return state.winner === X ? X_WON : O_WON;
      if (state.draw) return DRAWN;
      return null;
    },

    getView() {
      const player = state.currentPlayer;
      const canPlace = !targeting && hover && !isGameOver(state) && isEmptyCell(state.board, hover.x, hover.y);
      const preview = targeting ? targetPreview(state, player, targeting, hover) : null;
      const panels = [X, O].map((p) => panelView(state, p, { you: !isGameOver(state) && p === player, targeting, hoverSkill }));
      const buttonReady = panels.some((panel) => panel.skills.some((skill) => skill.hovered && skill.usable));
      return {
        state,
        hover: canPlace ? hover : null,
        preview,
        panels,
        pointer: Boolean(canPlace || (preview && preview.type !== 'dash') || preview?.to || buttonReady),
        status: targeting ? targetPrompt(targeting) : statusText(state),
        message,
      };
    },
  };
}

// Why the player cannot start the skill now, or null if they can.
export function skillLockReason(state, player, skillId) {
  if (isGameOver(state)) return 'The game is over.';
  if (player !== state.currentPlayer) return `It is ${playerLabel(state.currentPlayer, state)}'s turn.`;
  if (canUseSkill(state, player, skillId)) return null;
  const skill = getSkill(skillId);
  const left = skillCooldown(state, player, skillId);
  if (skill && left > 0) return `${skill.name} is locked for ${left} more ${left === 1 ? 'turn' : 'turns'}.`;
  if (isSkillLocked(state, player)) return 'Hiss: you cannot use a skill this turn.';
  return 'That skill cannot be used now.';
}

// Everything a player panel shows (docs/design.md section 3.1).
export function panelView(state, player, { you = false, targeting = null, hoverSkill = null } = {}) {
  const character = characterOf(state, player);
  const active = !isGameOver(state) && state.currentPlayer === player;
  return {
    player,
    name: character.name,
    stone: player,
    active,
    you,
    winner: state.winner === player,
    skills: character.skills.map((skillId) => {
      const cooldown = skillCooldown(state, player, skillId);
      return {
        id: skillId,
        name: getSkill(skillId).name,
        cooldown,
        locked: cooldown > 0,
        usable: canUseSkill(state, player, skillId),
        selected: active && targeting?.skill === skillId,
        hovered: hoverSkill?.player === player && hoverSkill?.skillId === skillId,
      };
    }),
  };
}

// The name of the character playing player (in state's sides when given).
export function playerLabel(player, state = null) {
  return (state ? characterOf(state, player) : characterForStone(player)).name;
}

export function statusText(state) {
  if (state.winner) return `${playerLabel(state.winner, state)} wins! Press R to restart.`;
  if (state.draw) return 'Draw! Press R to restart.';
  return `${playerLabel(state.currentPlayer, state)} to move`;
}

// Short messages for the events of one action, joined into one line, or
// null if nothing worth telling happened (a plain placement).
export function describeEvents(events) {
  const lines = events.map(describeEvent).filter(Boolean);
  return lines.length > 0 ? lines.join(' ') : null;
}

function describeEvent(event) {
  switch (event.type) {
    case 'dashAnnounced':
      return 'Wind Dash! The stone dashes after the next turn.';
    case 'dashResolved':
      return 'Wind Dash landed.';
    case 'dashFailed':
      return event.reason === 'targetTaken' ? 'Wind Dash failed: the target cell is taken.' : 'Wind Dash failed: the stone is gone.';
    case 'tornadoAnnounced':
      return 'Tornado Zone! It lasts through the next turn.';
    case 'stoneThrown':
      return 'The tornado threw the stone!';
    case 'throwBlocked':
      return 'The tornado had nowhere to throw the stone.';
    case 'rockPlaced':
      return 'Terrain Creation! A rock fell.';
    case 'rockBroken':
      return 'A rock crumbled.';
    case 'stoneConverted':
      return 'Stone Conversion! The stone changed sides.';
    case 'hissCast':
      return 'Hiss! No skills on the next turn.';
    case 'plantRemoved':
      return 'Venom! The plant withered.';
    default:
      return null;
  }
}
