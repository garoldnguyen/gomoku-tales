// Game screen controller for an online room (docs/design.md sections 3
// and 6). Pure (no DOM): it wraps a room from net/room.js, input handlers
// call it and the renderer reads getView(), like local-game.js does for
// ?local=1 mode. Only the local player's stones and skills can be used.

import { X, O, isEmptyCell } from '../logic/board.js';
import { CHARACTERS, characterForStone } from '../logic/characters.js';
import { isGameOver } from '../logic/game.js';
import { seatStone } from '../logic/seats.js';
import { COUNTDOWN } from '../net/presence.js';
import { describeEvents, panelView, skillLockReason } from './local-game.js';
import { createPlayersByStone } from './player-names.js';
import { STRINGS } from './strings.js';
import { needsTarget, startTargeting, targetClick, targetPreview, targetPrompt } from './targeting.js';

// takeEvents' answer when nothing happened, shared so the render loop makes
// no new list on an ordinary frame.
const NO_EVENTS = Object.freeze([]);

export function createOnlineGame(room) {
  const playersOf = createPlayersByStone(seatStone); // the players' names by stone (HUD)
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

  const unsubscribe = room.onEvent((event) => {
    if (event.type === 'state') {
      targeting = null;
      message = describeEvents(event.events);
      pendingEvents.push(...event.events);
    } else if (event.type === 'rejected') {
      message = event.error;
    } else if (event.type === 'newGame') {
      // A rematch: nothing of the old game is kept.
      targeting = null;
      message = null;
      pendingEvents = [];
    }
  });

  const you = () => room.getView().you;

  // Why this window cannot act now, or null.
  const blocker = () => {
    const view = room.getView();
    if (view.result || isGameOver(view.state)) return 'The game is over.';
    if (view.waiting) return 'Waiting for the host...'; // a guest's action is not settled yet
    if (!view.yourTurn) return "It is your opponent's turn.";
    return null;
  };

  // Sends an action through the room: act() calls it. Returns true if it
  // was sent. A guest then waits until the room settles it with the host.
  const send = (act) => {
    const result = act();
    if (!result.ok) {
      message = result.error;
      return false;
    }
    targeting = null;
    return true;
  };

  return {
    getTargeting() {
      return targeting;
    },

    // Events the room applied since the last call, oldest first, for the
    // effects (render/effects.js). Both windows get the same events.
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
    // otherwise places a stone. Returns true if an action was sent.
    click(cell) {
      if (!cell) return false;
      const error = blocker();
      if (error) {
        message = error;
        return false;
      }
      const player = you();
      if (!targeting) return send(() => room.place(cell.x, cell.y));

      // Targets are picked on the shown board (masked for this seat): a
      // cell under the other seat's cloud shows nothing. The host still
      // checks the action on the true state.
      const step = targetClick(room.getView().state, player, targeting, cell);
      if (step.error) {
        message = step.error;
        return false;
      }
      if (step.targeting) {
        targeting = step.targeting;
        message = null;
        return false;
      }
      return send(() => room.useSkill(targeting.skill, step.target));
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
      if (player !== you()) {
        message = "That is your opponent's skill.";
        return false;
      }
      const reason = blocker() ?? skillLockReason(room.getView().state, player, skillId);
      if (reason) {
        message = reason;
        return false;
      }
      if (!needsTarget(skillId)) return send(() => room.useSkill(skillId, null));
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

    // The end of the game from this window's side, or null while it goes
    // on. See gameOutcome.
    getOutcome() {
      const view = room.getView();
      return gameOutcome(view.state, view.you, view.result);
    },

    getView() {
      const view = room.getView();
      const { state } = view;
      const player = view.you;
      const outcome = gameOutcome(state, player, view.result);
      const canAct = blocker() === null;
      const canPlace = canAct && !targeting && hover && isEmptyCell(state.board, hover.x, hover.y);
      const preview = canAct && targeting ? targetPreview(state, player, targeting, hover) : null;
      const panels = [X, O].map((p) => panelView(state, p, {
        you: p === player,
        targeting: p === player ? targeting : null,
        hoverSkill: p === player && canAct ? hoverSkill : null,
      }));
      const buttonReady = panels.some((panel) => panel.skills.some((skill) => skill.hovered && skill.usable));
      const peerCountdown = !outcome && view.peer?.status === COUNTDOWN ? view.peer.secondsLeft : null;
      return {
        state,
        you: player,
        viewer: player,
        code: view.code,
        hover: canPlace ? hover : null,
        preview,
        panels,
        pointer: Boolean(canPlace || (preview && preview.type !== 'dash') || preview?.to || buttonReady),
        marker: outcome ? outcome.winner : state.currentPlayer,
        status: statusLine({ state, you: player, result: view.result, targeting: canAct ? targeting : null, yourTurn: view.yourTurn, peerCountdown }),
        message: peerCountdown !== null && targeting ? targetPrompt(targeting) : message,
        peerCountdown,
        players: playersOf(view),
      };
    },

    // Stops listening to the room (the room itself is closed by its owner).
    dispose() {
      unsubscribe();
    },
  };
}

// Status line under the board (docs/design.md section 3.1). The leave
// countdown comes first so it is always seen.
export function statusLine({ state, you, result = null, targeting = null, yourTurn = false, peerCountdown = null }) {
  const outcome = gameOutcome(state, you, result);
  if (outcome) return outcome.title;
  if (peerCountdown !== null) return `Opponent left. You win in ${peerCountdown}`;
  if (targeting) return targetPrompt(targeting);
  if (yourTurn && state.skillUsed) return STRINGS.plantToEndTurn; // a skill does not end the turn
  return yourTurn ? 'Your turn' : "Opponent's turn";
}

// How the game ended for the player `you`, or null if it goes on:
// { winner, reason, youWin, title, detail } where reason is 'opponentLeft',
// 'five' or 'draw'. A leave result from the room comes before the board.
export function gameOutcome(state, you, result = null) {
  if (result?.reason === 'opponentLeft') {
    const youWin = result.winner === you;
    return {
      winner: result.winner,
      reason: 'opponentLeft',
      youWin,
      title: youWin ? 'Opponent left, you win!' : 'You left, you lose.',
      detail: youWin
        ? 'Your opponent left the game.'
        : `You lost the link to the room, so ${nameOf(result.winner, state)} wins.`,
    };
  }
  if (state.winner) {
    const youWin = state.winner === you;
    return {
      winner: state.winner,
      reason: 'five',
      youWin,
      title: youWin ? 'You win!' : 'You lose.',
      detail: `${nameOf(state.winner, state)} made five in a row.`,
    };
  }
  if (state.draw) {
    return { winner: null, reason: 'draw', youWin: false, title: 'Draw!', detail: 'The board is full and nobody made five in a row.' };
  }
  return null;
}

// The name of the character playing stone in this game.
function nameOf(stone, state) {
  return characterForStone(stone, state?.characters ?? undefined)?.name ?? stone;
}

export function characterName(characterId) {
  return CHARACTERS[characterId]?.name ?? characterId;
}
