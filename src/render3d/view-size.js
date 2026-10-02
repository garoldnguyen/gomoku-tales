// Size of the WebGL drawing buffer (docs/art-direction-hd2d.md section E).
// The world checks it every frame instead of waiting for a window resize
// event, because a window moved to a screen with another devicePixelRatio,
// a browser zoom, or a canvas that was hidden when the world was built
// change the right size without a resize event in every browser. Each
// window checks its own, so two game windows on two screens each stay
// sharp. Pure: no DOM or Three.js, so it runs under node --test.

import { cappedPixelRatio } from './quality.js';

// { width, height, pixelRatio } for a canvas whose CSS box is cssWidth x
// cssHeight, or null while it has no size (hidden, or not laid out yet),
// when the buffer should keep its last size.
export function viewSize(cssWidth, cssHeight, devicePixelRatio, pixelRatioCap) {
  if (!(cssWidth > 0 && cssHeight > 0)) return null;
  return { width: cssWidth, height: cssHeight, pixelRatio: cappedPixelRatio(devicePixelRatio, pixelRatioCap) };
}

// True when two view sizes (or nulls) are the same, so nothing needs resizing.
export function sameViewSize(a, b) {
  if (a === null || b === null) return a === b;
  return a.width === b.width && a.height === b.height && a.pixelRatio === b.pixelRatio;
}
