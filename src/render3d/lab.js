// HD-2D look lab (docs/art-direction-hd2d.md sections A, B and F): a test
// scene for the 3D look, separate from the game. Open /hd2d-lab.html.
// It shows the wooden board under a fixed camera with a warm sun, soft
// shadows, an FPS counter and a hover highlight found by raycast picking.

import * as THREE from 'three';
import { BOARD_SIZE, CAMERA_DISTANCE, CAMERA_FOV, CAMERA_PITCH_DEG, CELL_SIZE, FPS_SAMPLE_MS } from '../config.js';
import { cameraPosition, cameraRay } from './camera.js';
import { createFpsMeter } from './fps.js';
import { cellToWorld, pickCell, pointerToNdc } from './picking.js';

const ASPECT = 16 / 9;
const MAX_PIXEL_RATIO = 1.5; // keeps high-DPI screens affordable
const BOARD_TEXTURE_PX = 480; // section D: 480x480, so one cell is 32 px
const BOARD_THICKNESS = 0.4; // the slab's top face is the y = 0 picking plane
const HOVER_LIFT = 0.01; // keeps the highlight decal just above the board

const COLORS = {
  sky: 0xa8d8f0,
  grass: 0x7cbf5a,
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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
renderer.shadowMap.enabled = true;
// PCFShadowMap with a radius gives soft edges (this release removed PCFSoftShadowMap).
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.sky);

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
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 4;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
const shadowExtent = BOARD_SIZE * CELL_SIZE;
Object.assign(sun.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 1, far: 70 });
scene.add(sun);
scene.add(new THREE.HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, 1.2));

// Plain ground so the board's shadow has somewhere to fall.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: COLORS.grass, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -BOARD_THICKNESS;
ground.receiveShadow = true;
scene.add(ground);

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

function resize() {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
}
window.addEventListener('resize', resize);
resize();

const fpsMeter = createFpsMeter(FPS_SAMPLE_MS);
let hudText = '';

function frame(now) {
  const fps = fpsMeter.tick(now);
  const cellText = hoveredCell ? `${hoveredCell.x}, ${hoveredCell.y}` : '-';
  const text = `FPS ${Math.round(fps)}\nCell ${cellText}`;
  if (text !== hudText) {
    hudText = text;
    hud.textContent = text;
  }
  // A gentle glow pulse; only the opacity changes, so pixels never move.
  hoverMaterial.opacity = 0.75 + 0.25 * Math.sin(now / 250);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Canvas texture with crisp pixels: NearestFilter both ways, no mipmaps.
function pixelTexture(source) {
  const texture = new THREE.CanvasTexture(source);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Small seeded random so the wood grain is the same on every load.
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

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
