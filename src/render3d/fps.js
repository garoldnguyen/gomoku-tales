// Pure frames-per-second meter for the on-screen counter. Feed it the
// requestAnimationFrame timestamp every frame; it averages over windowMs.

export function createFpsMeter(windowMs) {
  let start = null;
  let frames = 0;
  let fps = 0;
  return {
    tick(nowMs) {
      if (start === null) {
        start = nowMs;
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
