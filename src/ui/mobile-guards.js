// What a phone's browser does by itself and the game must not let it (docs/mobile.md). index.html
// and the style sheets stop most of it (touch-action, overscroll-behavior, user-select, the
// viewport); this is the rest, which no style can stop:
//
//   iOS pinch       Safari ignores the viewport's user-scalable=no and sends gesturestart,
//                   gesturechange and gestureend for a pinch: cancelled, so the page never zooms
//   two finger move other browsers zoom through touchmove with two touches: cancelled
//   long press      the browser's context menu (copy, share, save image) on the board, a portrait
//                   or an icon: cancelled everywhere except in a text box, where it pastes
//
// Pure of the game: it only needs a window and a document, so a test can give it fakes.

import { isTypingTarget } from './input.js';

// Installs the guards; returns a function that takes them off again.
export function installMobileGuards(win, doc = win.document) {
  const stop = (event) => event.preventDefault();
  const stopPinch = (event) => {
    if ((event.touches?.length ?? 0) > 1) event.preventDefault();
  };
  const stopMenu = (event) => {
    if (!isTypingTarget(event.target)) event.preventDefault();
  };
  const options = { passive: false };
  const gestures = ['gesturestart', 'gesturechange', 'gestureend'];
  for (const type of gestures) doc.addEventListener(type, stop, options);
  doc.addEventListener('touchmove', stopPinch, options);
  doc.addEventListener('contextmenu', stopMenu, options);
  return () => {
    for (const type of gestures) doc.removeEventListener(type, stop, options);
    doc.removeEventListener('touchmove', stopPinch, options);
    doc.removeEventListener('contextmenu', stopMenu, options);
  };
}
