// Notices when frames start again after the page was hidden. Browsers stop
// requestAnimationFrame in hidden tabs and minimised windows, but an online
// room keeps running on timers, so the opponent's moves pile up as logic
// events until the page shows again. Those events are then shown settled
// (the board, the lingering skill marks and the character poses) instead of
// replaying every sparkle, banner and camera shake at once. Pure: no DOM
// or Three.js, so it runs under node --test.

// gapMs: a frame later than this after the one before counts as a resume,
// even if the page never said it was hidden (a covered window).
export function createResumeWatch(gapMs) {
  let last = null;
  let hidden = false;
  return {
    // The page was hidden (document visibilitychange).
    markHidden() {
      hidden = true;
    },

    // Feed it the requestAnimationFrame timestamp every frame. True for the
    // first frame after the page was hidden or after a gap longer than gapMs.
    tick(nowMs) {
      const resumed = hidden || (last !== null && nowMs - last > gapMs);
      hidden = false;
      last = nowMs;
      return resumed;
    },
  };
}
