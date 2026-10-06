// Screen transitions (docs/flow-design.md section 3.11). Entrances are
// CSS only: a block that stops being display none plays its fade and rise
// again (menu.css, screens.css, room.css). Leaving needs a moment more,
// as hidden would cut the fade off: the fader keeps a node shown with the
// class is-leaving for LEAVE_MS, then hides it. Showing it again first
// cancels the leave. Under reduced motion it hides at once, as the shots
// and the end to end check do.

import { LEAVE_MS } from '../config.js';

// True when the window asks for reduced motion.
export function prefersReducedMotion(win = globalThis) {
  return win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

// options: reduced() is true for reduced motion; setTimer and clearTimer
// default to the window's; beforeLeave(node) runs as a leave starts (the
// screens pin a leaving card where it stood, see screens.js).
export function createFader({
  reduced = prefersReducedMotion, setTimer = setTimeout, clearTimer = clearTimeout, ms = LEAVE_MS,
  beforeLeave = null, afterLeave = null,
} = {}) {
  const timers = new Map();
  const finish = (node) => {
    timers.delete(node);
    node.classList.remove('is-leaving');
    node.hidden = true;
    afterLeave?.(node);
  };
  const cancel = (node) => {
    if (!timers.has(node)) return false;
    clearTimer(timers.get(node));
    timers.delete(node);
    node.classList.remove('is-leaving');
    afterLeave?.(node);
    return true;
  };
  return {
    // Shows node, or keeps it shown when it was leaving.
    show(node) {
      cancel(node);
      node.hidden = false;
    },

    // Hides node after its leave (or at once under reduced motion).
    hide(node) {
      if (node.hidden || timers.has(node)) return;
      if (reduced()) {
        node.hidden = true;
        return;
      }
      beforeLeave?.(node);
      node.classList.add('is-leaving');
      timers.set(node, setTimer(() => finish(node), ms));
    },

    // show or hide by a flag.
    set(node, visible) {
      if (visible) this.show(node);
      else this.hide(node);
    },

    // True while node plays its leave.
    leaving(node) {
      return timers.has(node);
    },
  };
}
