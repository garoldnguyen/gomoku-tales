// Pure frames-per-second meter for the on-screen counter. Feed it the
// requestAnimationFrame timestamp every frame; it averages over windowMs.
// A frame longer than stallMs (a hidden tab or minimised window, where
// requestAnimationFrame stops) is not counted: the window starts over from
// it and the last reading stays until the new window is done.

export function createFpsMeter(windowMs, stallMs = Infinity) {
  let start = null;
  let last = null;
  let frames = 0;
  let fps = 0;
  return {
    tick(nowMs) {
      const stalled = last !== null && nowMs - last > stallMs;
      last = nowMs;
      if (start === null || stalled) {
        start = nowMs;
        frames = 0;
        return fps;
      }
      frames++;
      const elapsed = nowMs - start;
      if (elapsed >= windowMs) {
        fps = (frames * 1000) / elapsed;
        frames = 0;
        start = nowMs;
      }
      return fps;
    },
    get fps() {
      return fps;
    },
  };
}
