// The skill tooltip of the character select (Game v5 part 5): which skill
// row's description shows. Pure (no DOM): screens.js feeds it the row
// events and runs the timer it asks for, so node tests see the same
// behaviour. Keyboard focus shows the tooltip at once, a mouse hover after
// SELECT_TIP_HOVER_MS (the HUD tooltip's delay); pointer leave, blur and
// Escape close it. A key names one skill row (any string).

import { TOOLTIP_SHOW_MS } from './tooltip-position.js';

export const SELECT_TIP_HOVER_MS = TOOLTIP_SHOW_MS;

// open: the key whose tooltip shows, or null; pending: the hovered key
// waiting for its timer, or null.
export const TIP_CLOSED = Object.freeze({ open: null, pending: null });

// event: { type: 'hover' | 'hoverTimer' | 'focus' | 'leave' | 'blur', key }
// or { type: 'escape' }. Returns the next state (the same object when
// nothing changed).
export function selectTipReducer(state, event) {
  switch (event.type) {
    case 'hover':
      if (state.open === event.key) return state;
      return { open: null, pending: event.key };
    case 'hoverTimer':
      return state.pending === event.key ? { open: event.key, pending: null } : state;
    case 'focus':
      return state.open === event.key && state.pending === null ? state : { open: event.key, pending: null };
    case 'leave':
    case 'blur':
      return state.open === event.key || state.pending === event.key ? TIP_CLOSED : state;
    case 'escape':
      return state.open === null && state.pending === null ? state : TIP_CLOSED;
    default:
      return state;
  }
}

// How long to wait before the next hoverTimer event after event: the hover
// delay for a hover, else null (no timer).
export const tipDelay = (event) => (event.type === 'hover' ? SELECT_TIP_HOVER_MS : null);

// The tooltip text of a skill row of characterSelectViewModel: its name,
// its rest turns and its SKILL_INFO description.
export function selectTipViewModel(skill) {
  return { title: skill.name, restText: skill.restText, description: skill.description };
}
