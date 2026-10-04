// Canvas pointer and keyboard input. Converts window coordinates to the
// canvas's own pixels (the 960x540 internal resolution of the 2D canvas, or
// the drawing buffer of the full window WebGL canvas) and forwards those
// points to the handlers.

import { characterForStone } from '../logic/characters.js';
import { HUD_2D, cellAtPoint, skillButtonAt } from '../render/layout.js';

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

// True for a plain Q press: cycles the 3D quality level. Not while typing
// in a text box, such as the room code on the Join Room screen.
export function isQualityKey(event) {
  return (event.key === 'q' || event.key === 'Q') && !event.ctrlKey && !event.metaKey && !event.altKey
    && !isTypingTarget(event.target);
}

// True for an element that takes typed text: input, textarea, select and
// contenteditable elements. Every global key shortcut returns early for an
// event from such an element, because room codes hold letters like C, F,
// Z, H and V (docs/flow-design.md section 8).
export function isTypingTarget(element) {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const contentEditable = typeof element.contentEditable === 'string' ? element.contentEditable.toLowerCase() : '';
  if (contentEditable === 'true' || contentEditable === 'plaintext-only') return true;
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

// The older name of isTypingTarget.
export const isTextEntry = isTypingTarget;

// Wraps a global key shortcut handler so that it returns early for a key
// typed into a text box.
export function shortcutKeyHandler(handler) {
  return (event) => {
    if (isTypingTarget(event?.target)) return;
    handler(event);
  };
}

// What is under an internal point: { cell: { x, y } } for a board cell,
// { skill: { player, skillId } } for a skill button, or null.
export function hitTest(px, py) {
  const cell = cellAtPoint(px, py);
  if (cell) return { cell };
  return skillHitTest(px, py, HUD_2D);
}

// The skill button of a HUD layout (render/layout.js) under an internal
// point as { skill: { player, skillId } }, or null.
export function skillHitTest(px, py, layout) {
  const button = skillButtonAt(px, py, 2, layout);
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
    } else if (onRestart && isRestartKey(event) && !isTypingTarget(event.target)) {
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
