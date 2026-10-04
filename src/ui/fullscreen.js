// The Fullscreen button and key (docs/art-direction-v3-1.md section 3.5).
// fullscreenViewModel and isFullscreenKey are pure. The browser glue below
// takes the document as an argument, so tests can hand it a plain object;
// it uses the standard Fullscreen API with the webkit prefixed names as a
// fallback. Entering or leaving needs no scene code: the resize path
// handles the new window size.

import { isTypingTarget } from './input.js';

// The key that toggles full screen. F was free: the game's other keys are
// R (restart), Q (quality), C (fold the HUD cards) and Escape (cancel).
export const FULLSCREEN_KEY = 'f';

export const ENTER_LABEL = 'Enter full screen';
export const EXIT_LABEL = 'Exit full screen';

// supported: the browser has the Fullscreen API; active: the page is in
// full screen now. Returns { visible, ariaLabel, pressed }.
export function fullscreenViewModel({ supported, active }) {
  const on = Boolean(supported && active);
  return {
    visible: Boolean(supported),
    ariaLabel: on ? EXIT_LABEL : ENTER_LABEL,
    pressed: on,
  };
}

// True for a plain F press: not with Ctrl, Cmd, Alt or Shift, not a held
// key's repeat, and not while typing (a room code has F in it).
export function isFullscreenKey(event) {
  return typeof event?.key === 'string' && event.key.toLowerCase() === FULLSCREEN_KEY
    && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.repeat
    && !isTypingTarget(event.target);
}

// True when the document can go full screen (false on iPhone Safari).
export function fullscreenSupported(doc) {
  const root = doc?.documentElement;
  if (!root) return false;
  if (doc.fullscreenEnabled && typeof root.requestFullscreen === 'function') return true;
  return Boolean(doc.webkitFullscreenEnabled && typeof root.webkitRequestFullscreen === 'function');
}

// True while some element of the document is in full screen.
export function fullscreenActive(doc) {
  return Boolean(doc?.fullscreenElement ?? doc?.webkitFullscreenElement);
}

// Enters or leaves full screen for the whole page. Call it straight from
// the click or key handler: browsers allow it only from a user action. A
// refusal (a rejected promise or a throw) is ignored; the label follows
// the fullscreenchange event, so it stays right.
export function toggleFullscreen(doc) {
  if (!fullscreenSupported(doc)) return;
  const root = doc.documentElement;
  try {
    const result = fullscreenActive(doc)
      ? (doc.exitFullscreen ?? doc.webkitExitFullscreen).call(doc)
      : (root.requestFullscreen ?? root.webkitRequestFullscreen).call(root);
    result?.catch?.(() => {});
  } catch {
    // Not allowed now (no user action, or a policy): nothing changes.
  }
}

// Calls listener on every change of the full screen state, with either
// event name. Returns the function that removes it.
export function onFullscreenChange(doc, listener) {
  doc.addEventListener('fullscreenchange', listener);
  doc.addEventListener('webkitfullscreenchange', listener);
  return () => {
    doc.removeEventListener('fullscreenchange', listener);
    doc.removeEventListener('webkitfullscreenchange', listener);
  };
}
