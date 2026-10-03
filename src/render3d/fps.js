// Pure frames-per-second meter for the on-screen counter. Feed it the
// requestAnimationFrame timestamp every frame; it averages over windowMs.
// A frame longer than stallMs (a hidden tab or minimised window, where
// requestAnimationFrame stops) is not counted: the window starts over from
// it and the last reading stays until the new window is done. `lowest` is
// the lowest reading since the start or the last resetLowest() (Infinity
// before the first reading), for the owner's FPS measurement (?fps=1).
// resetLowest() (a new quality level) also starts a new window, so no frame
// of the old level is counted, and like the start the first full window
// after it is a warm-up that updates `fps` but not `lowest` (the switch
// frame rebuilds parts and compiles shaders once).

export function createFpsMeter(windowMs, stallMs = Infinity) {
  let start = null;
  let last = null;
  let frames = 0;
  let fps = 0;
  let lowest = Infinity;
  let warmingUp = true; // the first full window since the start or resetLowest()
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
        if (!warmingUp && fps < lowest) lowest = fps;
        warmingUp = false;
        frames = 0;
        start = nowMs;
      }
      return fps;
    },
    get fps() {
      return fps;
    },
    get lowest() {
      return lowest;
    },
    // Starts the lowest reading over (a new quality level): a new window
    // from the next frame, and a warm-up window before any lowest reading.
    resetLowest() {
      lowest = Infinity;
      start = null;
      frames = 0;
      warmingUp = true;
    },
  };
}

// True when the page's URL query (a string such as '?quality=high&fps=1')
// asks for the FPS readout with its lowest reading: fps=1 (or on).
export function parseFpsSwitch(search) {
  const value = new URLSearchParams(search ?? '').get('fps');
  return value !== null && ['1', 'on', 'true'].includes(value.trim().toLowerCase());
}
