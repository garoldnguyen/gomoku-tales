// Size of the WebGL drawing buffer (docs/art-direction-hd2d.md section E).
// The world checks it every frame instead of waiting for a window resize
// event, because a window moved to a screen with another devicePixelRatio,
// a browser zoom, or a canvas that was hidden when the world was built
// change the right size without a resize event in every browser. Each
// window checks its own, so two game windows on two screens each stay
// sharp. Pure: no DOM or Three.js, so it runs under node --test.

import { fitView } from './framing.js';
import { cappedPixelRatio, qualityFeatures } from './quality.js';

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

// The full window view (docs/art-direction-v3-1.md section 3.1): what a
// window `windowWidth` x `windowHeight` CSS px big needs at quality
// `quality` (a level name or its row of the quality table): { width,
// height } the renderer size in CSS px (whole pixels, at least 1 each),
// pixelRatio (the screen's, capped by the level's pixelRatioCap), aspect
// (width over height) and fovDeg (the camera's vertical field of view,
// fitView). The renderer, the camera and the picking all take their
// numbers from it, so they always agree.
export function windowView(windowWidth, windowHeight, quality, devicePixelRatio = 1) {
  return windowViewInto(windowWidth, windowHeight, quality, devicePixelRatio,
    { width: 0, height: 0, pixelRatio: 0, aspect: 0, fovDeg: 0 });
}

// windowView written into `out` (no allocation, for the render loop): returns `out`.
export function windowViewInto(windowWidth, windowHeight, quality, devicePixelRatio, out) {
  const row = typeof quality === 'string' ? qualityFeatures(quality) : quality;
  const width = wholePixels(windowWidth);
  const height = wholePixels(windowHeight);
  out.width = width;
  out.height = height;
  out.pixelRatio = cappedPixelRatio(devicePixelRatio, row.pixelRatioCap);
  out.aspect = width / height;
  out.fovDeg = fitView(out.aspect);
  return out;
}

// A size in whole CSS pixels, never under 1 (a hidden or collapsed window
// must not give the renderer or the camera a zero size).
function wholePixels(size) {
  return Number.isFinite(size) ? Math.max(1, Math.round(size)) : 1;
}
