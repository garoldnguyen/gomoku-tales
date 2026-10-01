// HD-2D look lab (docs/art-direction-hd2d.md sections A to F): a test
// scene for the 3D look, separate from the game. Open /hd2d-lab.html.
// It shows the wooden board on Windy Spring Breeze Hill under a fixed camera
// with a warm sun, soft shadows, pixel sprites (Wind Rabbit, Earth Bear, a
// few stones and a rock), post-processing with quality levels (the Q key
// cycles them), an FPS counter and a hover highlight found by raycast
// picking. See docs/lab.md.

import * as THREE from 'three';
import {
  BOARD_SIZE, BOARD_THICKNESS, CAMERA_DISTANCE, CAMERA_FOV, CAMERA_PITCH_DEG, CELL_SIZE,
  CHARACTER_IDLE_FRAME_MS, CHARACTER_X, FPS_SAMPLE_MS, QUALITY_DEFAULT, QUALITY_STALL_MS, QUALITY_STEP_DOWN_MS,
  RENDER_SCALE, TARGET_FRAME_MS,
} from '../config.js';
import { buildBreezeHill } from './breeze-hill.js';
import { cameraPosition, cameraRay } from './camera.js';
import { createFpsMeter } from './fps.js';
import { cellToWorld, pickCell, pointerToNdc } from './picking.js';
import { bearFrames, IDLE_BOB, rabbitFrames, rockGrid, stoneGrid } from './placeholder-art.js';
import { createPostProcessing } from './post-processing.js';
import { cappedPixelRatio, createSlowFrameWatch, cycleQuality, lowerQuality, QUALITY_LEVELS } from './quality.js';
import { seededRandom } from './seeded-random.js';
import { PixelSprite, pixelTexture, sheetCanvas } from './sprites.js';
import { GROUND_Y } from './terrain.js';

const ASPECT = 16 / 9;
const BOARD_TEXTURE_PX = 480; // section D: 480x480, so one cell is 32 px
const HOVER_LIFT = 0.01; // keeps the highlight decal just above the board
const SHADOW_EXTENT = 20; // the sun's shadow map covers the board, characters and trees
const CHARACTER_SHADOW_RADIUS = 0.95;
const PIECE_SHADOW_RADIUS = 0.36;

// Sample pieces on the board: { x, y } are logic cells (src/logic).
const LAB_STONES = [
  { x: 7, y: 7, player: 'X' }, { x: 8, y: 7, player: 'O' }, { x: 6, y: 8, player: 'X' },
  { x: 8, y: 6, player: 'O' }, { x: 6, y: 6, player: 'X' }, { x: 9, y: 8, player: 'O' },
];
const LAB_ROCK = { x: 5, y: 7 };

const COLORS = {
  boardSide: 0x8a5a2b,
  sun: 0xffe0b0,
  hemiSky: 0xcfe8ff,
  hemiGround: 0x6f8f4a,
};

const canvas = document.getElementById('scene');
const hud = document.getElementById('hud');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (err) {
  hud.textContent = 'WebGL is not available in this browser.';
  throw err;
}
renderer.setPixelRatio(cappedPixelRatio(window.devicePixelRatio, RENDER_SCALE));
renderer.shadowMap.enabled = true; // the sun casts shadows only on HIGH (see setQuality)
// PCFShadowMap with a radius gives soft edges (this release removed PCFSoftShadowMap).
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();

// Fixed camera: no rotation or zoom (section B).
const cameraTarget = { x: 0, y: 0, z: 0 };
const cameraPos = cameraPosition(CAMERA_PITCH_DEG, CAMERA_DISTANCE, cameraTarget);
const camera = new THREE.PerspectiveCamera(CAMERA_FOV, ASPECT, 0.5, 200);
camera.position.set(cameraPos.x, cameraPos.y, cameraPos.z);
camera.lookAt(cameraTarget.x, cameraTarget.y, cameraTarget.z);
const cameraSetup = { position: cameraPos, target: cameraTarget, fovDeg: CAMERA_FOV, aspect: ASPECT };

// Lights: a warm sun with soft shadows and a cool hemisphere fill (section D).
const sun = new THREE.DirectionalLight(COLORS.sun, 2.6);
sun.position.set(-12, 20, 10);
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 4;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -SHADOW_EXTENT, right: SHADOW_EXTENT, top: SHADOW_EXTENT, bottom: -SHADOW_EXTENT, near: 1, far: 70 });
scene.add(sun);
scene.add(new THREE.HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, 1.2));

// Windy Spring Breeze Hill around the board (section C).
const scenery = buildBreezeHill(scene, cameraPos);

// The board: a wooden slab whose top face carries the grid texture. On a
// BoxGeometry top face the texture's top row lies at -z, so row 0 is the far
// edge, matching src/render3d/picking.js.
const boardWidth = BOARD_SIZE * CELL_SIZE;
const sideMaterial = new THREE.MeshStandardMaterial({ color: COLORS.boardSide, roughness: 0.9 });
const topMaterial = new THREE.MeshStandardMaterial({ map: pixelTexture(drawBoardTexture()), roughness: 0.85 });
const board = new THREE.Mesh(
  new THREE.BoxGeometry(boardWidth, BOARD_THICKNESS, boardWidth),
  // Face order: +x, -x, +y (top), -y, +z, -z.
  [sideMaterial, sideMaterial, topMaterial, sideMaterial, sideMaterial, sideMaterial],
);
board.position.y = -BOARD_THICKNESS / 2;
board.castShadow = true;
board.receiveShadow = true;
scene.add(board);

// Hover highlight: a flat glowing decal on the cell under the pointer (section F).
const hoverMaterial = new THREE.MeshBasicMaterial({
  map: pixelTexture(drawHoverTexture()),
  transparent: true,
  depthWrite: false,
  toneMapped: false,
});
const hover = new THREE.Mesh(new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE), hoverMaterial);
hover.rotation.x = -Math.PI / 2;
hover.position.y = HOVER_LIFT;
hover.visible = false;
scene.add(hover);

// Pixel sprites (section D): the two characters beside the board, with a
// 4 frame idle bob, and some stones and a rock on it.
const sprites = [];
const rabbit = new PixelSprite({
  sheet: sheetCanvas(rabbitFrames()),
  frameCount: IDLE_BOB.length,
  frameMs: CHARACTER_IDLE_FRAME_MS,
  shadowRadius: CHARACTER_SHADOW_RADIUS,
}).placeAt(-CHARACTER_X, GROUND_Y, 0);
const bear = new PixelSprite({
  sheet: sheetCanvas(bearFrames()),
  frameCount: IDLE_BOB.length,
  frameMs: CHARACTER_IDLE_FRAME_MS,
  shadowRadius: CHARACTER_SHADOW_RADIUS,
  phaseMs: CHARACTER_IDLE_FRAME_MS * 2, // so the two do not bob in step
}).placeAt(CHARACTER_X, GROUND_Y, 0);
sprites.push(rabbit, bear);

const stoneSheets = { X: sheetCanvas([stoneGrid('X')]), O: sheetCanvas([stoneGrid('O')]) };
for (const stone of LAB_STONES) {
  const { x, z } = cellToWorld(stone.x, stone.y);
  sprites.push(new PixelSprite({ sheet: stoneSheets[stone.player], shadowRadius: PIECE_SHADOW_RADIUS }).placeAt(x, 0, z));
}
{
  const { x, z } = cellToWorld(LAB_ROCK.x, LAB_ROCK.y);
  sprites.push(new PixelSprite({ sheet: sheetCanvas([rockGrid()]), shadowRadius: PIECE_SHADOW_RADIUS * 1.2 }).placeAt(x, 0, z));
}
for (const sprite of sprites) scene.add(sprite.object);

let hoveredCell = null;

function setHoveredCell(cell) {
  hoveredCell = cell;
  hover.visible = cell !== null;
  if (cell) {
    const { x, z } = cellToWorld(cell.x, cell.y);
    hover.position.x = x;
    hover.position.z = z;
  }
}

canvas.addEventListener('pointermove', (event) => {
  const ndc = pointerToNdc(event.clientX, event.clientY, canvas.getBoundingClientRect());
  const ray = cameraRay(ndc.x, ndc.y, cameraSetup);
  setHoveredCell(pickCell(ray.origin, ray.direction));
});
canvas.addEventListener('pointerleave', () => setHoveredCell(null));

// Post-processing focused on the board centre, with quality levels (section E).
const postProcessing = createPostProcessing(renderer, scene, camera, CAMERA_DISTANCE);
const slowFrames = createSlowFrameWatch({
  targetFrameMs: TARGET_FRAME_MS,
  holdMs: QUALITY_STEP_DOWN_MS,
  stallMs: QUALITY_STALL_MS,
});
let quality = null;
let autoStepped = false; // true after the last change was an automatic step down

function setQuality(level, auto = false) {
  quality = level;
  autoStepped = auto;
  // Real shadow maps only on HIGH; sprites always have their blob shadows.
  // Changing castShadow makes Three.js rebuild the lit materials once.
  sun.castShadow = QUALITY_LEVELS[level].shadowMaps;
  postProcessing.setLevel(level);
  slowFrames.reset();
}
setQuality(QUALITY_DEFAULT);

window.addEventListener('keydown', (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'q' || event.key === 'Q') setQuality(cycleQuality(quality));
});

function resize() {
  renderer.setPixelRatio(cappedPixelRatio(window.devicePixelRatio, RENDER_SCALE));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  postProcessing.resize();
}
window.addEventListener('resize', resize);
resize();

const fpsMeter = createFpsMeter(FPS_SAMPLE_MS);
let hudText = '';
let lastNow = null;

function frame(now) {
  const fps = fpsMeter.tick(now);
  if (slowFrames.tick(now) && quality !== lowerQuality(quality)) setQuality(lowerQuality(quality), true);
  // Clamp the step so a hidden tab does not make everything jump on return.
  const dtMs = lastNow === null ? 0 : Math.min(now - lastNow, 100);
  lastNow = now;
  scenery.update(now, dtMs);
  for (const sprite of sprites) sprite.update(now, camera.position);
  const cellText = hoveredCell ? `${hoveredCell.x}, ${hoveredCell.y}` : '-';
  const autoText = autoStepped ? ' (auto, slow frames)' : '';
  const text = `Quality ${quality}${autoText}  [Q]\nFPS ${Math.round(fps)}\nCell ${cellText}`;
  if (text !== hudText) {
    hudText = text;
    hud.textContent = text;
  }
  // A gentle glow pulse; only the opacity changes, so pixels never move.
  hoverMaterial.opacity = 0.75 + 0.25 * Math.sin(now / 250);
  postProcessing.render(dtMs / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Pixel-art wooden board: horizontal planks with grain, a dark grid line
// between cells and a darker outer border.
function drawBoardTexture() {
  const size = BOARD_TEXTURE_PX;
  const cell = size / BOARD_SIZE;
  const plank = cell * 1.5;
  const source = document.createElement('canvas');
  source.width = size;
  source.height = size;
  const ctx = source.getContext('2d');
  const random = seededRandom(7);

  for (let y = 0, i = 0; y < size; y += plank, i++) {
    ctx.fillStyle = i % 2 ? '#c48a52' : '#cf975c';
    ctx.fillRect(0, y, size, plank);
    ctx.fillStyle = '#a8713f';
    ctx.fillRect(0, y, size, 1);
    for (let n = 0; n < 40; n++) {
      ctx.fillStyle = random() < 0.6 ? '#b47b45' : '#dba86d';
      const gx = Math.floor(random() * size);
      const gy = y + 2 + Math.floor(random() * (plank - 4));
      ctx.fillRect(gx, gy, 4 + Math.floor(random() * 16), 1);
    }
  }

  ctx.fillStyle = '#6b3f1d';
  for (let i = 1; i < BOARD_SIZE; i++) {
    const p = Math.round(i * cell) - 1;
    ctx.fillRect(p, 0, 2, size);
    ctx.fillRect(0, p, size, 2);
  }
  ctx.fillStyle = '#4a2a14';
  ctx.fillRect(0, 0, size, 4);
  ctx.fillRect(0, size - 4, size, 4);
  ctx.fillRect(0, 0, 4, size);
  ctx.fillRect(size - 4, 0, 4, size);
  return source;
}

// Hover decal: a bright pixel frame around a soft warm fill.
function drawHoverTexture() {
  const size = 16;
  const source = document.createElement('canvas');
  source.width = size;
  source.height = size;
  const ctx = source.getContext('2d');
  ctx.fillStyle = 'rgba(255, 240, 160, 0.35)';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#fff6b0';
  ctx.fillRect(0, 0, size, 1);
  ctx.fillRect(0, size - 1, size, 1);
  ctx.fillRect(0, 0, 1, size);
  ctx.fillRect(size - 1, 0, 1, size);
  return source;
}
