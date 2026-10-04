// The one font of the canvas text (the Quality and FPS labels, the banners
// and the 2D renderer's panels): Nunito from assets/fonts, declared by the
// @font-face in src/ui/hud.css. Canvas text does not wait for a web font by
// itself, so main.js awaits loadCanvasFont before the first frame.

export const CANVAS_FONT_FAMILY = '"Nunito", sans-serif';

// A bold canvas font string of the given pixel size.
export function canvasFont(size) {
  return `bold ${size}px ${CANVAS_FONT_FAMILY}`;
}

// Resolves once Nunito is ready, or at once without the Font Loading API.
// A missing font file only warns: the text falls back to sans-serif.
export function loadCanvasFont(fontSet = globalThis.document?.fonts, warn = console.warn) {
  if (!fontSet?.load) return Promise.resolve();
  return fontSet.load(canvasFont(16)).then(
    (faces) => { if (faces.length === 0) warn('Nunito did not load; canvas text uses sans-serif'); },
    () => warn('Nunito did not load; canvas text uses sans-serif'),
  );
}
