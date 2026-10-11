// Keeps the phone's screen on while a game or a room is open (docs/mobile.md). A phone that
// dims and locks during a slow turn closes the page's connection (the opponent sees the room
// empty and the game ends in a forfeit), and a player thinking about a move has not touched the
// screen for a while. The Screen Wake Lock API holds the screen on; it is not available
// everywhere, so every call is safe without it and the game works the same.
//
// The browser drops the lock whenever the page is hidden (another app, the lock button), so the
// lock is asked for again when the page shows again while it is still wanted.
//
// navigator and document are the page's (or a test's fakes).

export function createWakeLock({ navigator, document }) {
  const supported = typeof navigator?.wakeLock?.request === 'function';
  let wanted = false;
  let sentinel = null; // the lock the browser gave
  let asking = false;

  const visible = () => document.visibilityState !== 'hidden';

  async function acquire() {
    if (!supported || !wanted || sentinel !== null || asking || !visible()) return;
    asking = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      asking = false;
      if (!wanted) {
        lock.release?.().catch?.(() => {}); // no longer wanted while it was being given
        return;
      }
      sentinel = lock;
      lock.addEventListener?.('release', () => {
        if (sentinel === lock) sentinel = null; // the browser took it back (the page was hidden)
      });
    } catch {
      asking = false; // refused (battery saver, no permission): the screen may dim, nothing else
    }
  }

  function release() {
    const lock = sentinel;
    sentinel = null;
    lock?.release?.().catch?.(() => {});
  }

  document.addEventListener('visibilitychange', () => {
    if (visible()) acquire();
  });

  return {
    supported,

    // true while a game or a room is open, false on the menu.
    setWanted(value) {
      const next = Boolean(value);
      if (next === wanted) return;
      wanted = next;
      if (wanted) acquire();
      else release();
    },

    // A touch is a user gesture, which some browsers ask for: try again if the lock is wanted
    // and not held.
    nudge() {
      if (wanted && sentinel === null) acquire();
    },

    get wanted() {
      return wanted;
    },

    // True while the browser holds the lock for this page.
    get active() {
      return sentinel !== null;
    },
  };
}
