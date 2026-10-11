// Decides which animation frames of the page do the work, so a phone does not
// draw a still scene 60 or 120 times a second (docs/performance.md). Pure: no
// DOM or Three.js, so it runs under node --test, and it allocates nothing per
// frame.
//
//   active   the player did something (poke) within holdMs: the active rate
//   idle     nothing happened for holdMs: the idle rate
//   always   a level with background motion (wind, clouds) stays active
//
// shouldRun(now) is asked on every requestAnimationFrame tick and says whether
// this tick draws. A tick may come toleranceMs early, and each frame is due one
// interval after the one before was due, so the rates hold on screens of 60, 90, 120
// and 144 Hz (a 90 Hz screen alternates 11 and 22 ms to keep 60). `idle` and `intervalMs` describe the tick
// that last ran, for the slow-frame watch of the quality levels: a frame the
// pace asked for is not a slow frame.

export function createFrameGovernor({ activeFps, idleFps, holdMs, toleranceMs = 0 }) {
  const intervalOf = (fps) => (Number.isFinite(fps) && fps > 0 ? 1000 / fps : 0);
  let activeMs = intervalOf(activeFps);
  let idleMs = intervalOf(idleFps);
  let lastActivity = -Infinity;
  let lastRun = -Infinity;
  let always = false;
  const governor = {
    // The player did something, an event or a change happened: draw at the
    // active rate from now on, for holdMs.
    poke(now) {
      if (now > lastActivity) lastActivity = now;
    },

    // true: stay at the active rate whatever happens (background motion).
    setAlways(value) {
      always = Boolean(value);
    },

    // The idle rate, for example a lower one behind a blurred menu.
    setIdleFps(fps) {
      idleMs = intervalOf(fps);
    },

    // True when the tick at `now` (a requestAnimationFrame timestamp) draws.
    shouldRun(now) {
      const idle = !always && now - lastActivity >= holdMs;
      const interval = idle ? idleMs : activeMs;
      if (now - lastRun < interval - toleranceMs) return false;
      // The next frame is due one interval after the last one was due, not after it was drawn,
      // so the rate holds on any screen; after a long gap (idle, hidden) it starts again from now.
      lastRun = now - lastRun > 2 * interval ? now : lastRun + interval;
      governor.idle = idle;
      governor.intervalMs = interval;
      return true;
    },

    // Milliseconds until the next draw is due at the current rate (0: now). A page that has
    // to wait sleeps that long with a timer instead of waking on every screen refresh, which
    // keeps the browser's frame pipeline off (the battery and the heat).
    dueIn(now) {
      const idle = !always && now - lastActivity >= holdMs;
      return Math.max(0, lastRun + (idle ? idleMs : activeMs) - toleranceMs - now);
    },

    // True when the last drawn tick was at the idle rate.
    idle: false,
    // The time the last drawn tick's rate asks between frames (0: every tick).
    intervalMs: activeMs,
  };
  return governor;
}

// True on devices whose main pointer is a finger (phones, tablets): the
// (pointer: coarse) media query. matchMedia is window.matchMedia or missing.
export function isCoarsePointer(matchMedia) {
  try {
    return Boolean(matchMedia?.('(pointer: coarse)').matches);
  } catch {
    return false;
  }
}

// A signature of the game state a frame loop can compare with the last one
// to see that the game moved on: the turn counter, whether a skill was used
// this turn and whether somebody won. Numbers only, so a check allocates
// nothing; every change of the board, the traps and the cooldowns comes with
// one of these (a seed or a skill is one action).
export function stateSignature(state) {
  if (!state) return -1;
  return (state.turn | 0) * 8 + (state.skillUsed ? 1 : 0) + (state.winner ? 2 : 0);
}
