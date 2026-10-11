// What a phone's browser does by itself and the game must not let it (docs/mobile.md). index.html
// and the style sheets stop most of it (touch-action, overscroll-behavior, user-select, the
// viewport); this is the rest, which no style can stop:
//
//   long press      the browser's context menu (copy, share, save image) on the board, a portrait
//                   or an icon: cancelled everywhere except in a text box, where it pastes
//
// Pinch zoom is left to the browser on purpose: the player may want a closer look at the board.
// Double tap zoom is off through touch-action, so a second tap on a plot plants.
//
// Pure of the game: it only needs a window and a document, so a test can give it fakes.

import { isTypingTarget } from './input.js';

// Installs the guards; returns a function that takes them off again.
export function installMobileGuards(win, doc = win.document) {
  const stopMenu = (event) => {
    if (!isTypingTarget(event.target)) event.preventDefault();
  };
  const options = { passive: false };
  doc.addEventListener('contextmenu', stopMenu, options);
  return () => {
    doc.removeEventListener('contextmenu', stopMenu, options);
  };
}
