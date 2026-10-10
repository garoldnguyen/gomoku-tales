// What the glass HUD over the 3D world shows (docs/art-direction-v3.md
// section 8). Pure (no DOM): hudViewModel() turns the game state and the
// screen controller's view into every string and state the DOM needs, and
// src/ui/hud.js only renders it.

import { X, O } from '../logic/board.js';
import { CLOUD_EAGLE, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT, characterForStone } from '../logic/characters.js';
import { characterOf, isGameOver, skillCooldown } from '../logic/game.js';
import { isSkillLocked } from '../logic/jade-serpent-skills.js';
import { cooldownTurns, getSkill, isPassiveSkill } from '../logic/skills.js';
import { ART } from '../render3d/art-assets.js';
import { ALL_EXPANDED } from './hud-collapse.js';
import { skillInfo } from './skill-info.js';
import { STRINGS } from './strings.js';
import { targetPrompt } from './targeting.js';

export const QUALITY_CHOICES = Object.freeze([
  Object.freeze({ level: 'low', label: 'Low' }),
  Object.freeze({ level: 'medium', label: 'Medium' }),
  Object.freeze({ level: 'high', label: 'High' }),
]);

// Portrait and skill icon names in assets/manifest.json. The portrait
// belongs to the character, whichever side it plays.
export const PORTRAIT_ART = Object.freeze({
  [WIND_RABBIT]: ART.windRabbit.hud,
  [EARTH_BEAR]: ART.earthBear.hud,
  [JADE_SERPENT]: ART.jadeSerpent.hud,
  [CLOUD_EAGLE]: ART.cloudEagle.hud,
});

export const SKILL_ICON_ART = Object.freeze({
  windDash: ART.windRabbit.windDashIcon,
  tornadoZone: ART.windRabbit.tornadoZoneIcon,
  mudTrap: ART.earthBear.mudTrapIcon,
  petrification: ART.earthBear.petrificationIcon,
  hiss: ART.jadeSerpent.hissIcon,
  venom: ART.jadeSerpent.venomIcon,
  skyWatch: ART.cloudEagle.skyWatchIcon,
  cloud: ART.cloudEagle.cloudIcon,
});

// Skill row looks, matching the classes of src/ui/hud.css.
export const READY = 'ready';
export const SELECTED = 'selected';
export const COOLING = 'cooling';
export const OFF = 'off';

// Skill states of docs/art-direction-v3-1.md section 4.2 (the collapsed
// pill and the tooltip): `waiting` is every skill that cannot be used now
// and is not cooling down.
export const STATE_READY = 'ready';
export const STATE_SELECTED = 'selected';
export const STATE_COOLING = 'cooling';
export const STATE_WAITING = 'waiting';

export const PLANT_HINT = 'Plant a seed';
// The localPlayer of a spectator (Watch a match): no card is its own, so
// every skill row is disabled and the turn pill never asks it to plant.
export const SPECTATOR_VIEW = 'spectator';

// gameState: the rules state (src/logic/game.js).
// uiState, all optional:
//   targeting      the skill target flow in progress (targeting.js) or null
//   status         the existing status line, kept as the hint while it
//                  says something more than whose turn it is
//   message        the existing message line, shown as a toast
//   peerCountdown  seconds left of the opponent-left countdown, or null
//   winner         the winner when the room settled it (a leave), else the board's
//   quality        'low', 'medium' or 'high'
//   hint           the page hint (room code, keys), as a tooltip
//   collapsed      { X, O }: which cards are folded into pills (hud-collapse.js)
// localPlayer: this window's stone online, or null when one window plays
// both sides (?local=1), where the player to move is always "you", or
// SPECTATOR_VIEW for a spectator, who is never "you".
//
// Each card speaks to its own character: "Your turn" on the card of the
// player to move, "Waiting" on the other.
export function hudViewModel(gameState, uiState = {}, localPlayer = null) {
  const {
    targeting = null, status = null, message = null, peerCountdown = null, quality = 'medium', hint = null,
    collapsed = ALL_EXPANDED, players = null,
  } = uiState;
  const winner = uiState.winner !== undefined && uiState.winner !== null ? uiState.winner : gameState.winner;
  const over = Boolean(winner) || isGameOver(gameState);
  const toMove = over ? null : gameState.currentPlayer;
  const leaving = !over && peerCountdown !== null && peerCountdown !== undefined;

  const cards = [X, O].map((player) => cardView(gameState, player, {
    over, winner, toMove, localPlayer, collapsed: Boolean(collapsed?.[player]), playerName: players?.[player] ?? null,
    targeting: player === toMove && (localPlayer === null || localPlayer === player) ? targeting : null,
  }));

  return {
    quality,
    qualityChoices: QUALITY_CHOICES.map(({ level, label }) => ({ level, label, pressed: level === quality })),
    turn: turnView(gameState, { over, winner, toMove, leaving, peerCountdown, targeting, status, localPlayer }),
    toast: message || null,
    hint,
    cards,
  };
}

// The pill at the top: the colour dot, whose turn it is and the hint.
function turnView(state, { over, winner, toMove, leaving, peerCountdown, targeting, status, localPlayer }) {
  if (over) {
    return {
      player: winner ?? null,
      team: winner ? 'gold' : 'none',
      who: 'Round over',
      hint: status ?? (winner ? `${nameOf(state, winner)} wins!` : 'Draw!'),
      countdown: null,
    };
  }
  if (leaving) {
    return {
      player: localPlayer ?? toMove,
      team: teamOf(localPlayer ?? toMove),
      who: 'Opponent left',
      hint: `You win in ${peerCountdown}`,
      countdown: peerCountdown,
    };
  }
  const mine = localPlayer === null || localPlayer === toMove;
  let hint;
  if (localPlayer === SPECTATOR_VIEW) hint = STRINGS.watchingHint;
  else if (targeting && mine) hint = targetPrompt(targeting);
  else if (mine) hint = state.skillUsed ? STRINGS.plantToEndTurn : PLANT_HINT; // after a skill the turn is not over yet
  else hint = status ?? "Opponent's turn";
  return { player: toMove, team: teamOf(toMove), who: `${nameOf(state, toMove)}'s turn`, hint, countdown: null };
}

function cardView(state, player, { over, winner, toMove, localPlayer, targeting, collapsed, playerName = null }) {
  const character = characterOf(state, player);
  const isWinner = winner === player;
  const active = player === toMove;
  const yours = localPlayer === null || localPlayer === player;
  let chip;
  if (isWinner) chip = 'Winner';
  else if (over) chip = 'Round over';
  else chip = active ? 'Your turn' : 'Waiting';
  return {
    player,
    side: player === X ? 'left' : 'right',
    name: character.name,
    portrait: PORTRAIT_ART[character.id],
    // Online the player's name leads the line (players of uiState).
    meta: `${playerName ? `${playerName} · ` : ''}Plays ${player}, ${countStones(state.board, player)} planted`,
    chip,
    waiting: !isWinner && !active,
    winner: isWinner,
    you: localPlayer === player,
    // The turn ring and dot of the collapsed pill.
    active,
    collapsed,
    chevronLabel: `${collapsed ? 'Expand' : 'Collapse'} ${character.name} panel`,
    skills: character.skills.map((skillId) => skillView(state, player, skillId, { over, active, yours, targeting, usedSkill: active && !over && Boolean(state.skillUsed) })),
  };
}

// A skill row. Rows that cannot be used now are `disabled`; the DOM keeps
// them focusable and clickable (aria-disabled) so a click still explains
// why, with the game's existing messages. A passive skill (Sky Watch) has
// no timer: it reads Always on while the round goes on, and is never used.
// usedSkill (Free Action): the player to move already used a skill this
// turn, so every other skill is off until the next turn; the skill used keeps
// the cooldown it started at once.
function skillView(state, player, skillId, { over, active, yours, targeting, usedSkill }) {
  const info = skillInfo(skillId);
  const title = info?.title ?? getSkill(skillId).name;
  const passive = isPassiveSkill(skillId);
  const total = cooldownTurns(skillId);
  const remaining = over || passive ? 0 : skillCooldown(state, player, skillId);
  let look;
  let skillState;
  let text;
  if (over) {
    look = OFF;
    skillState = STATE_WAITING;
    text = 'Round over';
  } else if (passive) {
    look = READY;
    skillState = STATE_READY;
    text = STRINGS.skillAlwaysOn;
  } else if (remaining > 0) {
    look = COOLING;
    skillState = STATE_COOLING;
    text = `Ready in ${remaining} ${remaining === 1 ? 'turn' : 'turns'}`;
  } else if (isSkillLocked(state, player)) {
    // Jade Serpent's Hiss: no skill this turn (the player can still plant).
    look = OFF;
    skillState = STATE_WAITING;
    text = STRINGS.skillSilenced;
  } else if (usedSkill) {
    look = OFF;
    skillState = STATE_WAITING;
    text = STRINGS.skillUsedState;
  } else if (targeting?.skill === skillId) {
    look = SELECTED;
    skillState = STATE_SELECTED;
    text = 'Selected';
  } else if (active) {
    look = READY;
    skillState = STATE_READY;
    text = 'Ready';
  } else {
    look = OFF;
    skillState = STATE_WAITING;
    text = 'Wait for your turn';
  }
  const progress = remaining > 0 && total > 0 ? Math.min(1, Math.max(0, (total - remaining) / total)) : 0;
  return {
    id: skillId,
    player,
    title,
    icon: SKILL_ICON_ART[skillId],
    state: skillState,
    stateText: text,
    look,
    cooldownTurns: remaining,
    cooldownProgress: progress,
    passive,
    selected: look === SELECTED,
    disabled: passive || look === OFF || look === COOLING || !yours,
    ariaLabel: `${title}: ${text}`,
    description: info?.description ?? '',
    hint: usedSkill && !passive ? STRINGS.skillUsedHint : info?.hint ?? '',
  };
}

// The skill detail popup (Design v4): what a click on a skill button opens
// next to its card, read from a view model of hudViewModel(). Returns
// { player, id, title, state, stateText, description, hint } or null when
// the card has no such skill. The text comes from SKILL_INFO through the
// skill row, never typed again.
export function skillPopupViewModel(vm, player, skillId) {
  const row = vm.cards.find((c) => c.player === player)?.skills.find((s) => s.id === skillId);
  if (!row) return null;
  return {
    player,
    id: skillId,
    title: row.title,
    state: row.state,
    stateText: row.stateText,
    description: row.description,
    hint: row.hint,
  };
}

function countStones(board, player) {
  let count = 0;
  for (const row of board) for (const cell of row) if (cell === player) count++;
  return count;
}

// The name of the character playing player in this game (the sides come
// from the pick order).
function nameOf(state, player) {
  return characterForStone(player, state?.characters ?? undefined)?.name ?? String(player);
}

function teamOf(player) {
  if (player === X) return 'blue';
  if (player === O) return 'red';
  return 'none';
}
