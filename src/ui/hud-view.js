// What the glass HUD over the 3D world shows (docs/art-direction-v3.md
// section 8). Pure (no DOM): hudViewModel() turns the game state and the
// screen controller's view into every string and state the DOM needs, and
// src/ui/hud.js only renders it.

import { X, O } from '../logic/board.js';
import { characterForStone } from '../logic/characters.js';
import { isGameOver, skillCooldown } from '../logic/game.js';
import { cooldownTurns, getSkill } from '../logic/skills.js';
import { targetPrompt } from './targeting.js';

export const QUALITY_CHOICES = Object.freeze([
  Object.freeze({ level: 'low', label: 'Low' }),
  Object.freeze({ level: 'medium', label: 'Medium' }),
  Object.freeze({ level: 'high', label: 'High' }),
]);

// Portrait and skill icon names in assets/manifest.json.
export const PORTRAIT_ART = Object.freeze({ [X]: 'portrait-wind-rabbit-v3', [O]: 'portrait-earth-bear-v3' });

export const SKILL_ICON_ART = Object.freeze({
  windDash: 'icon-wind-dash',
  tornadoZone: 'icon-tornado-zone',
  terrainCreation: 'icon-terrain-creation',
  stoneConversion: 'icon-stone-conversion',
});

// Skill row looks, matching the classes of src/ui/hud.css.
export const READY = 'ready';
export const SELECTED = 'selected';
export const COOLING = 'cooling';
export const OFF = 'off';

export const PLANT_HINT = 'Plant a seed';

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
// localPlayer: this window's stone online, or null when one window plays
// both sides (?local=1), where the player to move is always "you".
//
// Each card speaks to its own character: "Your turn" on the card of the
// player to move, "Waiting" on the other.
export function hudViewModel(gameState, uiState = {}, localPlayer = null) {
  const {
    targeting = null, status = null, message = null, peerCountdown = null, quality = 'medium', hint = null,
  } = uiState;
  const winner = uiState.winner !== undefined && uiState.winner !== null ? uiState.winner : gameState.winner;
  const over = Boolean(winner) || isGameOver(gameState);
  const toMove = over ? null : gameState.currentPlayer;
  const leaving = !over && peerCountdown !== null && peerCountdown !== undefined;

  const cards = [X, O].map((player) => cardView(gameState, player, {
    over, winner, toMove, localPlayer,
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
      hint: status ?? (winner ? `${nameOf(winner)} wins!` : 'Draw!'),
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
  if (targeting && mine) hint = targetPrompt(targeting);
  else if (mine) hint = PLANT_HINT;
  else hint = status ?? "Opponent's turn";
  return { player: toMove, team: teamOf(toMove), who: `${nameOf(toMove)}'s turn`, hint, countdown: null };
}

function cardView(state, player, { over, winner, toMove, localPlayer, targeting }) {
  const character = characterForStone(player);
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
    portrait: PORTRAIT_ART[player],
    meta: `Plays ${player}, ${countStones(state.board, player)} planted`,
    chip,
    waiting: !isWinner && !active,
    winner: isWinner,
    you: localPlayer === player,
    skills: character.skills.map((skillId) => skillView(state, player, skillId, { over, active, yours, targeting })),
  };
}

// A skill row. Rows that cannot be used now are `disabled`; the DOM keeps
// them focusable and clickable (aria-disabled) so a click still explains
// why, with the game's existing messages.
function skillView(state, player, skillId, { over, active, yours, targeting }) {
  const title = getSkill(skillId).name;
  const total = cooldownTurns(skillId);
  const remaining = over ? 0 : skillCooldown(state, player, skillId);
  let look;
  let text;
  if (over) {
    look = OFF;
    text = 'Round over';
  } else if (remaining > 0) {
    look = COOLING;
    text = `Ready in ${remaining} ${remaining === 1 ? 'turn' : 'turns'}`;
  } else if (targeting?.skill === skillId) {
    look = SELECTED;
    text = 'Selected';
  } else if (active) {
    look = READY;
    text = 'Ready';
  } else {
    look = OFF;
    text = 'Wait for your turn';
  }
  const progress = remaining > 0 && total > 0 ? Math.min(1, Math.max(0, (total - remaining) / total)) : 0;
  return {
    id: skillId,
    player,
    title,
    icon: SKILL_ICON_ART[skillId],
    state: text,
    look,
    cooldown: remaining,
    progress,
    selected: look === SELECTED,
    disabled: look === OFF || look === COOLING || !yours,
    label: `${title}: ${text}`,
  };
}

function countStones(board, player) {
  let count = 0;
  for (const row of board) for (const cell of row) if (cell === player) count++;
  return count;
}

function nameOf(player) {
  return characterForStone(player)?.name ?? String(player);
}

function teamOf(player) {
  if (player === X) return 'blue';
  if (player === O) return 'red';
  return 'none';
}
