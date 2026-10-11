// The phone's Back button (docs/mobile.md). On Android the system Back, and on iOS the swipe from
// the edge, leave the page; in a game or a waiting room that loses the match without a word. The
// guard keeps one extra entry in the browser's history while the player is past the menu. Back
// then only takes that entry away, and the page answers as if the player had pressed the Back or
// Leave button on the screen (which asks first where leaving cannot be undone). On the menu there
// is no guard, so Back leaves the page as it always did.
//
// history and the document are the page's (or a test's fakes). Nothing here knows the screens:
// BACK_TARGETS names the buttons, first one shown wins.

// The buttons Back presses, most specific first: the Stay button of an open Leave match card, the
// Close of a menu panel, the Back, Leave or Back to menu of a room screen, the Leave match door
// of the game screen.
export const BACK_TARGETS = Object.freeze([
  '.leave-confirm .leave-stay',
  '#howto-close',
  '#settings-close',
  '#screens [data-action="back"]',
  '#screens [data-action="leaveRoom"]',
  '#screens [data-action="backToLobby"]',
  '#screens [data-action="backToMenu"]',
  '.leave-button',
]);

// True when the element and everything above it is shown (no hidden attribute on the way up).
function isShown(element) {
  for (let node = element; node; node = node.parentElement ?? node.parent ?? null) {
    if (node.hidden) return false;
  }
  return true;
}

// The first button of `selectors` that is shown on the page, or null.
export function pickBackTarget(doc, selectors = BACK_TARGETS) {
  for (const selector of selectors) {
    for (const element of doc.querySelectorAll(selector)) {
      if (isShown(element)) return element;
    }
  }
  return null;
}

export function createBackGuard({ history, location, win, doc = win.document, selectors = BACK_TARGETS }) {
  let armed = false; // the extra history entry is there
  let skip = false; // the next popstate is our own history.back()

  const onPopState = () => {
    if (skip) {
      skip = false;
      return;
    }
    if (!armed) return; // an ordinary move of the browser's history
    armed = false; // the guard entry is gone; the next sync puts one back if the player is still past the menu
    pickBackTarget(doc, selectors)?.click();
  };
  win.addEventListener('popstate', onPopState);

  return {
    // shouldGuard: the player is past the menu (a game, a room, the lobby). Call it when the screen
    // changes, or on every frame: it only touches the history when the answer changes.
    sync(shouldGuard) {
      if (shouldGuard && !armed) {
        history.pushState({ gomokuGuard: true }, '', location.href);
        armed = true;
      } else if (!shouldGuard && armed) {
        armed = false;
        skip = true; // back to the menu: take the extra entry away without going anywhere
        history.back();
      }
    },

    get armed() {
      return armed;
    },

    close() {
      win.removeEventListener('popstate', onPopState);
    },
  };
}
