// Offline controller for ?local=1 dev mode: one window plays both sides.
// Pure (no DOM); input handlers call it and the renderer reads getView().

import { X, isEmptyCell } from '../logic/board.js';
import { createInitialState, isGameOver, placeStone } from '../logic/game.js';

export function createLocalGame() {
  let state = createInitialState();
  let hover = null;
  let message = null;

  return {
    getState() {
      return state;
    },

    setHover(cell) {
      hover = cell;
    },

    // Places a stone for whoever is to move. Returns true if it was placed.
    click(cell) {
      if (!cell) return false;
      const result = placeStone(state, { player: state.currentPlayer, x: cell.x, y: cell.y });
      if (!result.ok) {
        message = result.error;
        return false;
      }
      state = result.state;
      message = null;
      return true;
    },

    restart() {
      state = createInitialState();
      message = null;
    },

    getView() {
      const canPlace = hover && !isGameOver(state) && isEmptyCell(state.board, hover.x, hover.y);
      return {
        state,
        hover: canPlace ? hover : null,
        status: statusText(state),
        message,
      };
    },
  };
}

export function playerLabel(player) {
  return player === X ? 'Blue X' : 'Red O';
}

export function statusText(state) {
  if (state.winner) return `${playerLabel(state.winner)} wins! Press R to restart.`;
  if (state.draw) return 'Draw! Press R to restart.';
  return `${playerLabel(state.currentPlayer)} to move`;
}
