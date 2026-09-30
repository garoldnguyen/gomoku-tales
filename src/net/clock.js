// Clocks give the room controller the time and its timers, so tests can
// drive time by hand. A clock has now(), setTimeout, clearTimeout,
// setInterval and clearInterval.

export const systemClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (id) => globalThis.clearInterval(id),
};

// A clock that only moves when advance(ms) is called. Timers fire in time
// order (ties in the order they were set), each seeing now() equal to its
// due time.
export function createFakeClock(start = 0) {
  let time = start;
  let nextId = 1;
  let sequence = 0; // breaks ties between timers due at the same time
  const timers = new Map(); // id -> { due, every, fn, order }

  const add = (fn, ms, every) => {
    const id = nextId++;
    timers.set(id, { due: time + Math.max(0, ms), every, fn, order: sequence++ });
    return id;
  };

  const nextDue = (until) => {
    let best = null;
    for (const [id, timer] of timers) {
      if (timer.due > until) continue;
      if (!best || timer.due < best.timer.due || (timer.due === best.timer.due && timer.order < best.timer.order)) {
        best = { id, timer };
      }
    }
    return best;
  };

  const clock = {
    now: () => time,
    setTimeout: (fn, ms) => add(fn, ms, null),
    setInterval: (fn, ms) => add(fn, ms, Math.max(1, ms)),
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),

    advance(ms) {
      const until = time + ms;
      for (let next = nextDue(until); next; next = nextDue(until)) {
        const { id, timer } = next;
        time = timer.due;
        if (timer.every === null) {
          timers.delete(id);
        } else {
          timer.due += timer.every;
          timer.order = sequence++;
        }
        timer.fn();
      }
      time = until;
    },

    // Number of timers still set.
    get pending() {
      return timers.size;
    },
  };
  return clock;
}
