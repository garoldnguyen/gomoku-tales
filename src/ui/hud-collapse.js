// Collapsible HUD cards (docs/art-direction-v3-1.md section 4.1). Pure (no
// DOM): the collapsed flag of each team as { X, O }, its storage in
// localStorage, the C key and the shot mode override. Every card starts
// expanded; the game works without storage.

import { X, O } from '../logic/board.js';
import { isTextEntry } from './input.js';

export const COLLAPSE_STORAGE_KEYS = Object.freeze({ [X]: 'gomoku.hud.collapsed.x', [O]: 'gomoku.hud.collapsed.o' });

// The key that collapses or expands both cards. C was free: the game's
// other keys are R (restart), Q (quality) and Escape (cancel).
export const COLLAPSE_KEY = 'c';

export const ALL_EXPANDED = Object.freeze({ [X]: false, [O]: false });
export const ALL_COLLAPSED = Object.freeze({ [X]: true, [O]: true });

// The saved flags: '1' is collapsed, anything else (missing, garbage, or a
// storage that throws) is expanded.
export function readCollapsed(storage) {
  const read = (player) => {
    try {
      return storage?.getItem(COLLAPSE_STORAGE_KEYS[player]) === '1';
    } catch {
      return false;
    }
  };
  return Object.freeze({ [X]: read(X), [O]: read(O) });
}

// Saves one team's flag as '1' or '0'. Returns false when storage failed.
export function writeCollapsed(storage, player, collapsed) {
  if (!storage || !Object.hasOwn(COLLAPSE_STORAGE_KEYS, player)) return false;
  try {
    storage.setItem(COLLAPSE_STORAGE_KEYS[player], collapsed ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

// The flags with one team's flag changed (the same object when nothing
// changes, so the HUD knows there is nothing to redraw).
export function withCollapsed(collapsed, player, value) {
  const flag = Boolean(value);
  if (collapsed[player] === flag) return collapsed;
  return Object.freeze({ ...collapsed, [player]: flag });
}

// The C key: collapses both cards unless both are collapsed already, then
// it expands both.
export function toggleAll(collapsed) {
  return collapsed[X] && collapsed[O] ? ALL_EXPANDED : ALL_COLLAPSED;
}

// True for a plain C press: not with Ctrl, Cmd, Alt or Shift, not a held
// key's repeat, and not while typing (a room code has C in it).
export function isCollapseKey(event) {
  return typeof event?.key === 'string' && event.key.toLowerCase() === COLLAPSE_KEY
    && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.repeat
    && !isTextEntry(event.target);
}

// The hud shot parameter (docs/shots.md section 4): 'expanded' or
// 'collapsed' sets both cards, anything else is null (no override).
export function parseHudParam(value) {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return name === 'expanded' || name === 'collapsed' ? name : null;
}

// The flags at startup: the shot override, else the saved choice.
export function startCollapsed(storage, hudParam = null) {
  if (hudParam === 'collapsed') return ALL_COLLAPSED;
  if (hudParam === 'expanded') return ALL_EXPANDED;
  return readCollapsed(storage);
}
