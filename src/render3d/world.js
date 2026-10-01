// The HD-2D world (docs/art-direction-hd2d.md sections B to F), shared by
// the game (src/render3d/world-renderer.js) and the look lab (lab.js): a
// WebGL renderer, the fixed camera, a warm sun and a cool hemisphere fill,
// Windy Spring Breeze Hill, the wooden board, Wind Rabbit and Earth Bear
// beside it, a glowing hover decal, post-processing with quality levels and
// automatic step down, and an FPS meter. Pieces are added as sprites.

import * as THREE from 'three';
import {
  BOARD_SIZE, BOARD_THICKNESS, CAMERA_DISTANCE, CAMERA_FOV, CAMERA_PITCH_DEG, CELL_SIZE,
  FPS_SAMPLE_MS, QUALITY_DEFAULT, QUALITY_STALL_MS, QUALITY_STEP_DOWN_MS,
  RENDER_SCALE, TARGET_FRAME_MS,
} from '../config.js';
import { buildBreezeHill } from './breeze-hill.js';
import { cameraPosition, cameraRay } from './camera.js';
import { createCharacters } from './characters3d.js';
import { createFpsMeter } from './fps.js';
import { cellToWorld, pickCell } from './picking.js';
import { rockGrid, stoneGrid } from './placeholder-art.js';
import { createPostProcessing } from './post-processing.js';
import { cappedPixelRatio, createSlowFrameWatch, cycleQuality, lowerQuality, QUALITY_LEVELS } from './quality.js';
import { seededRandom } from './seeded-random.js';
import { PixelSprite, pixelTexture, sheetCanvas } from './sprites.js';

export const WORLD_ASPECT = 16 / 9;
const BOARD_TEXTURE_PX = 480; // section D: 480x480, so one cell is 32 px
export const DECAL_LIFT = 0.01; // keeps flat decals just above the board
const SHADOW_EXTENT = 20; // the sun's shadow map covers the board, characters and trees
const PIECE_SHADOW_RADIUS = 0.36;
const ROCK_SHADOW_RADIUS = PIECE_SHADOW_RADIUS * 1.2;

const COLORS = {
  boardSide: 0x8a5a2b,
  sun: 0xffe0b0,
  hemiSky: 0xcfe8ff,
  hemiGround: 0x6f8f4a,
};

// Builds the world on `canvas` (it fills its CSS box at 16:9). Throws if
// WebGL is not available. Returns the world; call render(now) every frame.
export function createWorld(canvas, { quality: startQuality = QUALITY_DEFAULT } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(cappedPixelRatio(window.devicePixelRatio, RENDER_SCALE));
  renderer.shadowMap.enabled = true; // the sun casts shadows only on HIGH (see setQuality)
  // PCFShadowMap with a radius gives soft edges (this release removed PCFSoftShadowMap).
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();

  // Fixed camera: no rotation or zoom (section B).
  const cameraTarget = { x: 0, y: 0, z: 0 };
  const cameraPos = cameraPosition(CAMERA_PITCH_DEG, CAMERA_DISTANCE, cameraTarget);
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, WORLD_ASPECT, 0.5, 200);
  camera.position.set(cameraPos.x, cameraPos.y, cameraPos.z);
  camera.lookAt(cameraTarget.x, cameraTarget.y, cameraTarget.z);
  const cameraSetup = { position: cameraPos, target: cameraTarget, fovDeg: CAMERA_FOV, aspect: WORLD_ASPECT };

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
  scene.add(createBoard());

  // Hover highlight: a flat glowing decal on the cell under the pointer (section F).
  const hoverMaterial = decalMaterial(drawHoverTexture());
  const hover = createCellDecal(hoverMaterial);
  scene.add(hover);
  let hoveredCell = null;

  // Pixel sprites (section D). Wind Rabbit (X) stands on the left of the
  // board and Earth Bear (O) on the right, with idle, cast, win and lose
  // poses and a glow for the player to move (src/render3d/characters3d.js).
  const sprites = new Set();
  const addSprite = (sprite) => {
    sprites.add(sprite);
    scene.add(sprite.object);
    return sprite;
  };
  const characters = createCharacters(addSprite);

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
  setQuality(startQuality);

  function resize() {
    renderer.setPixelRatio(cappedPixelRatio(window.devicePixelRatio, RENDER_SCALE));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    postProcessing.resize();
  }
  window.addEventListener('resize', resize);
  resize();

  const fpsMeter = createFpsMeter(FPS_SAMPLE_MS);
  let lastNow = null;

  return {
    scene,
    camera,
    cameraSetup,
    // The character controller: trigger(events, now), reset(), setActive(player).
    characters,

    // Adds a PixelSprite: it turns to the camera and animates every frame.
    addSprite,

    removeSprite(sprite) {
      sprites.delete(sprite);
      scene.remove(sprite.object);
    },

    // Shows the hover decal on a cell { x, y }, or hides it for null.
    setHoveredCell(cell) {
      hoveredCell = cell;
      hover.visible = cell !== null;
      if (cell) placeOnCell(hover, cell.x, cell.y);
    },

    get hoveredCell() {
      return hoveredCell;
    },

    // The board cell under a point in normalized device coordinates, by a
    // ray from the camera onto the board plane (section F), or null.
    pickCellAtNdc(ndcX, ndcY) {
      const ray = cameraRay(ndcX, ndcY, cameraSetup);
      return pickCell(ray.origin, ray.direction);
    },

    get quality() {
      return quality;
    },

    // True when the current level was chosen by the automatic step down.
    get autoStepped() {
      return autoStepped;
    },

    get fps() {
      return fpsMeter.fps;
    },

    setQuality,

    // The Q key: the next quality level.
    cycleQuality() {
      setQuality(cycleQuality(quality));
    },

    // Advances the scene to `now` (a requestAnimationFrame timestamp) and
    // draws it. Steps the quality down when frames stay slow.
    render(now) {
      fpsMeter.tick(now);
      if (slowFrames.tick(now) && quality !== lowerQuality(quality)) setQuality(lowerQuality(quality), true);
      // Clamp the step so a hidden tab does not make everything jump on return.
      const dtMs = lastNow === null ? 0 : Math.min(now - lastNow, 100);
      lastNow = now;
      scenery.update(now, dtMs);
      characters.update(now, dtMs);
      for (const sprite of sprites) sprite.update(now, camera.position);
      // A gentle glow pulse; only the opacity changes, so pixels never move.
      hoverMaterial.opacity = 0.75 + 0.25 * Math.sin(now / 250);
      postProcessing.render(dtMs / 1000);
    },
  };
}

// A board piece sprite: 'X' (a sprout) or 'O' (a flower bud) for a stone,
// 'rock' for a rock. Sprites of a kind share one texture.
const pieceSheets = {};
export function createPieceSprite(kind) {
  pieceSheets[kind] ??= sheetCanvas([kind === 'rock' ? rockGrid() : stoneGrid(kind)]);
  return new PixelSprite({
    sheet: pieceSheets[kind],
    shadowRadius: kind === 'rock' ? ROCK_SHADOW_RADIUS : PIECE_SHADOW_RADIUS,
  });
}

// Puts a sprite or decal on the centre of board cell (x, y), keeping its height.
export function placeOnCell(object, x, y) {
  const world = cellToWorld(x, y);
  const target = object.object ?? object;
  target.position.x = world.x;
  target.position.z = world.z;
}

// Unlit see-through material for flat decals drawn from a canvas.
export function decalMaterial(source) {
  return new THREE.MeshBasicMaterial({
    map: pixelTexture(source),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

// A flat one-cell decal lying on the board, hidden until placed.
let cellDecalGeometry = null;
export function createCellDecal(material) {
  cellDecalGeometry ??= new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE).rotateX(-Math.PI / 2);
  const decal = new THREE.Mesh(cellDecalGeometry, material);
  decal.position.y = DECAL_LIFT;
  decal.visible = false;
  return decal;
}

// A small canvas to draw a decal texture on.
export function decalCanvas(size = 16) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

// The board: a wooden slab whose top face carries the grid texture. On a
// BoxGeometry top face the texture's top row lies at -z, so row 0 is the far
// edge, matching src/render3d/picking.js.
function createBoard() {
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
  return board;
}

// Pixel-art wooden board: horizontal planks with grain, a dark grid line
// between cells and a darker outer border.
function drawBoardTexture() {
  const size = BOARD_TEXTURE_PX;
  const cell = size / BOARD_SIZE;
  const plank = cell * 1.5;
  const source = decalCanvas(size);
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
  const source = decalCanvas(size);
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
