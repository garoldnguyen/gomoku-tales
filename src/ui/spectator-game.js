// Game screen controller for a spectator (Watch a match, docs/flow-design.md
// section 3.9). Pure (no DOM): it wraps a spectator room
// (net/spectator-room.js) with the same methods as online-game.js, so the
// page draws the live board and the HUD the same way, but every input is
// ignored: no hover, no cell click, no skill, no target flow. The status
// line names the player to move or the end of the game.

import { O, X } from '../logic/board.js';
import { characterForStone } from '../logic/characters.js';
import { panelView } from './local-game.js';
import { STRINGS, fillText } from './strings.js';

// takeEvents' answer when nothing happened, shared so the render loop makes
// no new list on an ordinary frame.
const NO_EVENTS = Object.freeze([]);

// The name of the character playing stone in state.
export function spectatorName(stone, state) {
  return characterForStone(stone, state?.characters ?? undefined)?.name ?? stone;
}

// How the watched game ended, or null while it goes on:
// { winner, reason, youWin: false, title, detail } where reason is
// 'opponentLeft', 'five' or 'draw'. A leave result comes before the board.
export function spectatorOutcome(state, result = null) {
  if (!state) return null;
  if (result?.reason === 'opponentLeft') {
    const title = fillText(STRINGS.watchingForfeit, { name: spectatorName(result.winner, state) });
    return { winner: result.winner, reason: 'opponentLeft', youWin: false, title, detail: title };
  }
  if (state.winner) {
    const title = fillText(STRINGS.watchingWins, { name: spectatorName(state.winner, state) });
    return { winner: state.winner, reason: 'five', youWin: false, title, detail: title };
  }
  if (state.draw) return { winner: null, reason: 'draw', youWin: false, title: STRINGS.watchingDraw, detail: STRINGS.watchingDraw };
  return null;
}

// The phase line of the watched game: whose turn it is, or how it ended.
export function spectatorStatus(state, result = null) {
  if (!state) return STRINGS.spectateWaitingTitle;
  return spectatorOutcome(state, result)?.title
    ?? fillText(STRINGS.watchingTurn, { name: spectatorName(state.currentPlayer, state) });
}

export function createSpectatorGame(room) {
  let pendingEvents = [];

  const unsubscribe = room.onEvent((event) => {
    if (event.type === 'state') pendingEvents.push(...event.events);
    else if (event.type === 'newGame') pendingEvents = [];
  });

  const ignored = () => false;

  return {
    spectator: true,

    getTargeting() {
      return null;
    },

    // Events the host applied since the last call, for the effects.
    takeEvents() {
      if (pendingEvents.length === 0) return NO_EVENTS;
      const events = pendingEvents;
      pendingEvents = [];
      return events;
    },

    // Input is locked: a spectator never hovers, plants or uses a skill.
    setHover: ignored,
    setHoverSkill: ignored,
    click: ignored,
    clickSkill: ignored,
    cancel: ignored,

    getOutcome() {
      const view = room.getView();
      return spectatorOutcome(view.state, view.result);
    },

    // The same keys as online-game.js getView: nobody is "you", nothing is
    // hovered or previewed, and no skill is usable.
    getView() {
      const view = room.getView();
      const { state } = view;
      const outcome = spectatorOutcome(state, view.result);
      const panels = [X, O].map((p) => {
        const panel = panelView(state, p);
        return { ...panel, skills: panel.skills.map((skill) => ({ ...skill, usable: false })) };
      });
      return {
        state,
        you: null,
        code: view.code,
        hover: null,
        preview: null,
        panels,
        pointer: false,
        marker: outcome ? outcome.winner : state.currentPlayer,
        status: spectatorStatus(state, view.result),
        message: null,
        peerCountdown: null,
      };
    },

    dispose() {
      unsubscribe();
    },
  };
}
