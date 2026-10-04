// The game over card (docs/flow-design.md section 3.7). Pure (no DOM): the
// view models below give src/ui/screens.js every string and state of the
// card, so node tests and shot mode see the same card. Text comes from
// strings.js, character names from the character table.

import { characterForStone } from '../logic/characters.js';
import { MODES } from './flow.js';
import { STRINGS } from './strings.js';

// The Rematch button. input: { mode, mine, theirs, gone } where mode is
// online or local, mine is true once this window asked, theirs once the
// other player asked (both from onRematchStatus), and gone once the other
// player left or the game ended by forfeit (the peer gone callback or the
// rematch status). Gone beats every other state; local mode is always idle.
// Returns { state, label, disabled, hint } (hint null when there is none).
export function rematchViewModel({ mode, mine = false, theirs = false, gone = false } = {}) {
  if (mode !== MODES.LOCAL) {
    if (gone) return rematchView('gone', STRINGS.gameOverRematch, true, STRINGS.rematchGoneHint);
    if (mine) return rematchView('mine', STRINGS.rematchWaiting, true, STRINGS.rematchSentHint);
    if (theirs) return rematchView('theirs', STRINGS.gameOverRematch, false, STRINGS.rematchTheirsHint);
  }
  return rematchView('idle', STRINGS.gameOverRematch, false, null);
}

function rematchView(state, label, disabled, hint) {
  return { state, label, disabled, hint };
}

// The headline and subline. input: { mode, winner, reason, you } where
// winner is the winning stone (null for a draw), reason is 'five', 'draw'
// or 'opponentLeft' (gameOutcome in online-game.js) and you is this
// window's stone online. Online: the winner reads You win with the winning
// character plus won, the loser You lose; a forfeit win reads You win with
// Opponent left. Local: the winning character plus wins. A draw: Draw, The
// board is full. sides are the game's { X, O } characters (the pick
// order; default Wind Rabbit X, Earth Bear O). Returns { headline, subline }.
export function gameOverViewModel({ mode, winner = null, reason = null, you = null, sides = undefined } = {}) {
  if (reason === 'draw' || !winner) return { headline: STRINGS.gameOverDraw, subline: STRINGS.gameOverBoardFull };
  const name = characterForStone(winner, sides ?? undefined)?.name ?? winner;
  if (mode === MODES.LOCAL) return { headline: `${name} ${STRINGS.gameOverWins}`, subline: '' };
  if (winner !== you) return { headline: STRINGS.gameOverYouLose, subline: `${name} ${STRINGS.gameOverWon}` };
  if (reason === 'opponentLeft') return { headline: STRINGS.gameOverYouWin, subline: STRINGS.gameOverOpponentLeft };
  return { headline: STRINGS.gameOverYouWin, subline: `${name} ${STRINGS.gameOverWon}` };
}
