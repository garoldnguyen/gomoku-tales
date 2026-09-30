// Canvas pointer and keyboard input. Converts window coordinates to the
// 960x540 internal resolution and forwards board cells to the handlers.

import { cellAtPoint } from '../render/layout.js';

// Maps a client (window) point to internal canvas pixels, given the canvas
// bounding rect and its internal size.
export function toInternalPoint(rect, internalWidth, internalHeight, clientX, clientY) {
  return {
    px: ((clientX - rect.left) * internalWidth) / rect.width,
    py: ((clientY - rect.top) * internalHeight) / rect.height,
  };
}

// True for a plain R press (not Ctrl/Cmd+R, which reloads the page).
export function isRestartKey(event) {
  return (event.key === 'r' || event.key === 'R') && !event.ctrlKey && !event.metaKey && !event.altKey;
}

export function attachBoardInput(canvas, { onHover, onClick, onRestart }) {
  const cellFromEvent = (event) => {
    const rect = canvas.getBoundingClientRect();
    const { px, py } = toInternalPoint(rect, canvas.width, canvas.height, event.clientX, event.clientY);
    return cellAtPoint(px, py);
  };

  const handlePointerMove = (event) => onHover(cellFromEvent(event));
  const handlePointerLeave = () => onHover(null);
  const handleClick = (event) => {
    if (event.button !== 0) return;
    onClick(cellFromEvent(event));
  };
  const handleKeyDown = (event) => {
    if (event.repeat || !isRestartKey(event)) return;
    event.preventDefault();
    onRestart();
  };

  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerleave', handlePointerLeave);
  canvas.addEventListener('click', handleClick);
  window.addEventListener('keydown', handleKeyDown);

  return () => {
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerleave', handlePointerLeave);
    canvas.removeEventListener('click', handleClick);
    window.removeEventListener('keydown', handleKeyDown);
  };
}
