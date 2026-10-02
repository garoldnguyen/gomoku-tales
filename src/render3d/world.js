// The HD-2D world (docs/art-direction-hd2d.md sections B to F), shared by
// the game (src/render3d/world-renderer.js) and the look lab (lab.js): a
// WebGL renderer, the fixed camera, a warm sun and a cool hemisphere fill,
// Windy Spring Breeze Hill, the farmland board (farm-field.js,
// docs/art-direction-v3.md section 3), Wind Rabbit and Earth Bear beside
// it, the gold hover decal, post-processing, the quality levels of
// src/render3d/quality.js with automatic step down, and an FPS meter.
// Pieces are added as sprites.

import * as THREE from 'three';
import {
  CAMERA_DISTANCE, CAMERA_FOV, CELL_SIZE,
  FPS_SAMPLE_MS, QUALITY_STALL_MS, QUALITY_STEP_DOWN_MS, TARGET_FRAME_MS,
} from '../config.js';
import { createAssetStore } from '../render/assets.js';
import { artMeta, artSource, setArtAssets } from './art.js';
import { ART, placeholderShape } from './art-assets.js';
import { buildBreezeHill } from './breeze-hill.js';
import { cameraRay, createGameCamera, gameCamera } from './camera.js';
import { createCharacters } from './characters3d.js';
import { createFarmField } from './farm-field.js';
import { zonePieceUv } from './farm-layout.js';
import { snapToStep, worldUnitsPerPixel } from './effect-plans.js';
import { createFpsMeter } from './fps.js';
import { STAGE_REST } from './growth.js';
import { cellToWorld, pickCell } from './picking.js';
import { createPostProcessing } from './post-processing.js';
import {
  browserStorage, changedFeatures, createSlowFrameWatch, cycleQuality, loadSavedQuality, lowerQuality,
  normalizeQuality, QUALITY_FALLBACK, QUALITY_LEVELS, saveQuality,
} from './quality.js';
import { PixelSprite, pixelTexture } from './sprites.js';
import { metaAnchor } from './v3-meta.js';
import { sameViewSize, viewSize } from './view-size.js';

export const WORLD_ASPECT = 16 / 9;
export const DECAL_LIFT = 0.01; // keeps flat decals just above the board
const SHADOW_EXTENT = 20; // the sun's shadow map covers the board, characters and trees
const PIECE_SHADOW_RADIUS = 0.36;
const ROCK_SHADOW_RADIUS = PIECE_SHADOW_RADIUS * 1.2;

// The switches the scenery around the board reads (breeze-hill.js and
// the meadow, meadow-scene.js).
const SCENERY_FEATURES = new Set(['ground', 'scenery', 'meadowFlowers', 'farHills', 'shadows', 'sky', 'wind', 'backgroundMotion']);
// The switches the farmland board reads (farm-field.js).
const FARM_FEATURES = new Set(['boardTexture', 'scenery']);

const COLORS = {
  sun: 0xffe0b0,
  hemiSky: 0xcfe8ff,
  hemiGround: 0x6f8f4a,
};

// Builds the world on `canvas` (it fills its CSS box at 16:9). Throws if
// WebGL is not available. Returns the world; call render(now) every frame.
// `assets` is the store from loadAssets (src/render/assets.js); textures
// whose file is missing are generated placeholders (src/render3d/art.js).
// `meta` is the v3 tuning data from loadV3Meta (src/render3d/v3-meta.js).
// `quality` is the level to start with (default: the one saved in
// `storage`, else medium); `storage` is localStorage or null.
export function createWorld(canvas, {
  storage = browserStorage(),
  quality: startLevel = loadSavedQuality(storage) ?? QUALITY_FALLBACK,
  assets = createAssetStore(),
  meta,
  warn = () => {},
} = {}) {
  setArtAssets(assets, { warn, meta });
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true; // the sun casts shadows only with the 'sun' shadow mode (see applyQuality)
  // PCFShadowMap with a radius gives soft edges (this release removed PCFSoftShadowMap).
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();

  // Fixed camera: no rotation or zoom (section B).
  const cameraSetup = gameCamera(WORLD_ASPECT);
  const cameraPos = cameraSetup.position;
  const camera = createGameCamera(THREE, WORLD_ASPECT);
  // The camera's own right and up directions, for the screen shake.
  camera.updateMatrixWorld();
  const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const cameraUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);

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
  const scenery = buildBreezeHill(scene, cameraPos, camera);

  // Hover highlight: the gold decal on the plot under the pointer, always
  // fully visible (docs/art-direction-v3.md section 3).
  const hoverMaterial = decalMaterial(artSource(ART.v3.decal.hover));
  const hover = createCellDecal(hoverMaterial);
  scene.add(hover);
  let hoveredCell = null;

  // Pixel sprites (section D). Wind Rabbit (X) stands on the left of the
  // board and Earth Bear (O) on the right, with idle, cast, win and lose
  // poses and a glow for the player to move (src/render3d/characters3d.js).
  const sprites = new Set();
  let blobShadows = true; // false when the quality level has no shadows
  // A sprite with noBlobShadow set (the see-through ghosts) never shows one.
  const showBlobShadow = (sprite) => {
    sprite.shadow.visible = blobShadows && !sprite.noBlobShadow;
  };
  const addSprite = (sprite) => {
    sprites.add(sprite);
    showBlobShadow(sprite);
    scene.add(sprite.object);
    return sprite;
  };
  const characters = createCharacters(addSprite);

  // The farmland board: field, curb, and with scenery the fence and path.
  const farm = createFarmField(scene, addSprite);

  // Post-processing focused on the board centre.
  const postProcessing = createPostProcessing(renderer, scene, camera, CAMERA_DISTANCE);
  const slowFrames = createSlowFrameWatch({
    targetFrameMs: TARGET_FRAME_MS,
    holdMs: QUALITY_STEP_DOWN_MS,
    stallMs: QUALITY_STALL_MS,
  });
  let quality = null;
  let features = null; // the quality table row of `quality`
  let autoStepped = false; // true after the last change was an automatic step down

  // The drawing buffer follows the canvas's CSS box and this window's
  // devicePixelRatio (capped by the level's pixelRatioCap). It is checked
  // every frame (see view-size.js): a window moved to another screen or
  // zoomed does not always get a resize event, and a canvas laid out after
  // the world was built has no size at first. clientWidth ignores CSS
  // transforms, so the blurred backdrop behind the menus (index.html) does
  // not resize it.
  let viewSizeNow = null;
  function resize() {
    const next = viewSize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio, features.pixelRatioCap);
    if (next === null || sameViewSize(viewSizeNow, next)) return;
    viewSizeNow = next;
    renderer.setPixelRatio(next.pixelRatio);
    renderer.setSize(next.width, next.height, false);
    postProcessing.resize();
  }

  // Switches to a level (unknown values are medium) and rebuilds only the
  // parts whose switches changed; pieces, effects and the game are left
  // alone. `auto` marks an automatic step down.
  function applyQuality(level, auto) {
    const next = normalizeQuality(level);
    const nextFeatures = QUALITY_LEVELS[next];
    const changed = changedFeatures(features, nextFeatures);
    quality = next;
    features = nextFeatures;
    autoStepped = auto;
    slowFrames.reset();
    if (changed.includes('shadows')) {
      // Real shadow maps only with the sun mode. Changing castShadow makes
      // Three.js rebuild the lit materials once.
      sun.castShadow = features.shadows === 'sun';
      blobShadows = features.shadows !== 'none';
      for (const sprite of sprites) showBlobShadow(sprite);
    }
    if (changed.includes('postEffects')) postProcessing.setEffects(features.postEffects);
    if (changed.some((key) => SCENERY_FEATURES.has(key))) scenery.setFeatures(features);
    if (changed.some((key) => FARM_FEATURES.has(key))) farm.setFeatures(features);
    if (changed.includes('pixelRatioCap')) {
      viewSizeNow = null;
      resize();
    }
  }
  applyQuality(startLevel, false);

  // A choice made by hand (the Q key, ?quality=): applied and saved.
  function setQuality(level) {
    applyQuality(level, false);
    saveQuality(storage, quality);
  }

  // A hidden page stops requestAnimationFrame; that gap is not a slow frame.
  const fpsMeter = createFpsMeter(FPS_SAMPLE_MS, QUALITY_STALL_MS);
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

    // Moves the camera offset.x and offset.y world units along its right
    // and up directions for the screen shake (section B), snapped to whole
    // screen pixels at the board so sprite pixels never shimmer. { x: 0,
    // y: 0 } puts it back. Picking keeps using the unshaken camera.
    setCameraShake(offset) {
      const step = worldUnitsPerPixel(CAMERA_DISTANCE, CAMERA_FOV, canvas.height);
      camera.position.set(cameraPos.x, cameraPos.y, cameraPos.z)
        .addScaledVector(cameraRight, snapToStep(offset.x, step))
        .addScaledVector(cameraUp, snapToStep(offset.y, step));
    },

    // Height of the drawing buffer in device pixels.
    get drawingHeight() {
      return canvas.height;
    },

    // This window's quality level: 'low', 'medium' or 'high'.
    get quality() {
      return quality;
    },

    // The quality table row of the current level (src/render3d/quality.js).
    get features() {
      return features;
    },

    // True when the current level was chosen by the automatic step down.
    get autoStepped() {
      return autoStepped;
    },

    get fps() {
      return fpsMeter.fps;
    },

    setQuality,

    // The Q key: the next quality level, through setQuality.
    cycleQuality() {
      setQuality(cycleQuality(quality));
    },

    // Advances the scene to `now` (a requestAnimationFrame timestamp) and
    // draws it. Steps the quality down when frames stay slow.
    render(now) {
      resize();
      fpsMeter.tick(now);
      if (slowFrames.tick(now) && quality !== lowerQuality(quality)) applyQuality(lowerQuality(quality), true);
      // Clamp the step so a hidden tab does not make everything jump on return.
      const dtMs = lastNow === null ? 0 : Math.min(now - lastNow, 100);
      lastNow = now;
      scenery.update(now, dtMs);
      characters.update(now, dtMs);
      for (const sprite of sprites) sprite.update(now, camera.position);
      postProcessing.render(dtMs / 1000);
    },
  };
}

// A board piece sprite (docs/art-direction-v3.md section 4): 'X' or 'O'
// is the plant (plant-x, a blue cross bloom, or plant-o, a red round
// bloom) with its anchor pixel on the plot centre, showing the Rest stage
// until its owner steps the growth with setFrame; 'rock' is the mossy
// rock-v3 boulder on its bottom centre (the manifest key "rock" is the 2D
// sprite). Sprites of a kind share one texture.
export function createPieceSprite(kind) {
  if (kind === 'rock') {
    return new PixelSprite({ sheet: artSource(ART.v3.rock), shadowRadius: ROCK_SHADOW_RADIUS });
  }
  const name = ART.v3.plant[kind];
  const sprite = new PixelSprite({
    sheet: artSource(name),
    frameCount: placeholderShape(name).frames,
    shadowRadius: PIECE_SHADOW_RADIUS,
    anchor: metaAnchor(artMeta(), name),
    swayFrame: STAGE_REST, // resting plants sway on High (PLANT_SWAY)
  });
  sprite.setFrame(STAGE_REST);
  return sprite;
}

// Puts a sprite or decal on the centre of board cell (x, y), keeping its height.
export function placeOnCell(object, x, y) {
  const world = cellToWorld(x, y);
  const target = object.object ?? object;
  target.position.x = world.x;
  target.position.z = world.z;
}

// Unlit see-through material for flat decals drawn from a canvas or image.
// Tone mapped like everything else, so decals look the same without post
// effects (tone mapped by the renderer) as with them (by OutputPass). Fog
// and shadows never dim them.
export function decalMaterial(source) {
  return new THREE.MeshBasicMaterial({
    map: pixelTexture(source),
    transparent: true,
    depthWrite: false,
    fog: false,
  });
}

// A flat one-cell decal lying just above the plot, hidden until placed.
// `geometry` defaults to the whole texture on one cell.
let cellDecalGeometry = null;
export function createCellDecal(material, geometry = null) {
  cellDecalGeometry ??= new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE).rotateX(-Math.PI / 2);
  const decal = new THREE.Mesh(geometry ?? cellDecalGeometry, material);
  decal.position.y = DECAL_LIFT;
  decal.visible = false;
  return decal;
}

// One-cell geometry showing the part of a 3x3-cell zone decal (decal-zone-v3)
// that lies on the cell (dx, dy) from the zone centre, so a zone clipped at
// the board edge shows only its part on the field.
const zonePieces = new Map();
export function zonePieceGeometry(dx, dy) {
  const key = `${dx},${dy}`;
  if (!zonePieces.has(key)) {
    const { u0, u1, v0, v1 } = zonePieceUv(dx, dy);
    const geometry = new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE);
    // PlaneGeometry corners: top left, top right, bottom left, bottom right.
    geometry.attributes.uv.set([u0, v1, u1, v1, u0, v0, u1, v0]);
    zonePieces.set(key, geometry.rotateX(-Math.PI / 2));
  }
  return zonePieces.get(key);
}
