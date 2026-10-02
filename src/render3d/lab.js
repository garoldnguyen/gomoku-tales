// HD-2D look lab (docs/art-direction-hd2d.md sections A to F): a test
// scene for the 3D look, separate from the game. Open /hd2d-lab.html.
// It shows the shared world (src/render3d/world.js: the farmland board on
// Windy Spring Breeze Hill under a fixed camera with a warm sun, soft
// shadows, Wind Rabbit and Earth Bear, post-processing with quality levels)
// with a few sample stones and a rock, an FPS counter and a hover highlight
// found by raycast picking. The Q key cycles the quality; ?quality=low,
// medium or high picks one. See docs/lab.md.

import { loadAssets } from '../render/assets.js';
import { createPieceSprite, createWorld, placeOnCell } from './world.js';
import { pointerToNdc } from './picking.js';
import { loadV3Meta } from './v3-meta.js';

// Sample pieces on the board: { x, y } are logic cells (src/logic).
const LAB_PIECES = [
  { x: 7, y: 7, kind: 'X' }, { x: 8, y: 7, kind: 'O' }, { x: 6, y: 8, kind: 'X' },
  { x: 8, y: 6, kind: 'O' }, { x: 6, y: 6, kind: 'X' }, { x: 9, y: 8, kind: 'O' },
  { x: 5, y: 7, kind: 'rock' },
];

const canvas = document.getElementById('scene');
const hud = document.getElementById('hud');

// Art files from assets/manifest.json; missing ones are placeholders.
const warn = (message) => console.warn(message);
const [assets, meta] = await Promise.all([loadAssets({ warn }), loadV3Meta({ warn })]);

let world;
try {
  world = createWorld(canvas, { assets, meta, warn });
  const urlQuality = new URLSearchParams(window.location.search).get('quality');
  if (urlQuality !== null) world.setQuality(urlQuality);
} catch (err) {
  hud.textContent = 'WebGL is not available in this browser.';
  throw err;
}

for (const piece of LAB_PIECES) {
  const sprite = world.addSprite(createPieceSprite(piece.kind));
  placeOnCell(sprite, piece.x, piece.y);
}

canvas.addEventListener('pointermove', (event) => {
  const ndc = pointerToNdc(event.clientX, event.clientY, canvas.getBoundingClientRect());
  world.setHoveredCell(world.pickCellAtNdc(ndc.x, ndc.y));
});
canvas.addEventListener('pointerleave', () => world.setHoveredCell(null));

window.addEventListener('keydown', (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'q' || event.key === 'Q') world.cycleQuality();
});

let hudText = '';

function frame(now) {
  world.render(now);
  const cell = world.hoveredCell;
  const cellText = cell ? `${cell.x}, ${cell.y}` : '-';
  const autoText = world.autoStepped ? ' (auto, slow frames)' : '';
  const text = `Quality ${world.quality}${autoText}  [Q]\nFPS ${Math.round(world.fps)}\nCell ${cellText}`;
  if (text !== hudText) {
    hudText = text;
    hud.textContent = text;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
