// Canvas pointer and keyboard input. Converts window coordinates to the
// 960x540 internal resolution and forwards internal points to the handlers.

import { characterForStone } from '../logic/characters.js';
import { cellAtPoint, skillButtonAt } from '../render/layout.js';

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

export function isCancelKey(event) {
  return event.key === 'Escape';
}

// What is under an internal point: { cell: { x, y } } for a board cell,
// { skill: { player, skillId } } for a skill button, or null.
export function hitTest(px, py) {
  const cell = cellAtPoint(px, py);
  if (cell) return { cell };
  const button = skillButtonAt(px, py);
  if (button) {
    const skillId = characterForStone(button.player)?.skills[button.index];
    if (skillId) return { skill: { player: button.player, skillId } };
  }
  return null;
}

// Handlers get internal points { px, py } (onHover gets null when the
// pointer leaves the canvas). A right click or Escape calls onCancel. R
// calls onRestart; leave it out where there is no restart, so R still
// types into text boxes.
export function attachGameInput(canvas, { onHover, onClick, onCancel, onRestart }) {
  const pointFromEvent = (event) => {
    const rect = canvas.getBoundingClientRect();
    return toInternalPoint(rect, canvas.width, canvas.height, event.clientX, event.clientY);
  };

  const handlePointerMove = (event) => onHover(pointFromEvent(event));
  const handlePointerLeave = () => onHover(null);
  const handleClick = (event) => {
    if (event.button !== 0) return;
    onClick(pointFromEvent(event));
  };
  const handleContextMenu = (event) => {
    event.preventDefault();
    onCancel();
  };
  const handleKeyDown = (event) => {
    if (event.repeat) return;
    if (isCancelKey(event)) {
      onCancel();
    } else if (onRestart && isRestartKey(event)) {
      event.preventDefault();
      onRestart();
    }
  };

  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerleave', handlePointerLeave);
  canvas.addEventListener('click', handleClick);
  canvas.addEventListener('contextmenu', handleContextMenu);
  window.addEventListener('keydown', handleKeyDown);

  return () => {
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerleave', handlePointerLeave);
    canvas.removeEventListener('click', handleClick);
    canvas.removeEventListener('contextmenu', handleContextMenu);
    window.removeEventListener('keydown', handleKeyDown);
  };
}
