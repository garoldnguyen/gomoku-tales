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
  CAMERA_DISTANCE, CELL_SIZE,
  FPS_SAMPLE_MS, QUALITY_STALL_MS, QUALITY_STEP_DOWN_MS, TARGET_FRAME_MS,
} from '../config.js';
import { createAssetStore } from '../render/assets.js';
import { artMeta, artSource, setArtAssets } from './art.js';
import { ART, placeholderShape } from './art-assets.js';
import { buildBreezeHill } from './breeze-hill.js';
import { cameraRay, createGameCamera, gameCamera } from './camera.js';
import { createCharacters } from './characters3d.js';
import { clipPlanes } from './depth-of-field.js';
import { createFarmField } from './farm-field.js';
import { zonePieceUv } from './farm-layout.js';
import { snapToStep, worldUnitsPerPixel } from './effect-plans.js';
import { createFpsMeter } from './fps.js';
import { STAGE_REST } from './growth.js';
import { cellToWorldInto, pickCell } from './picking.js';
import { createPostProcessing } from './post-processing.js';
import {
  browserStorage, changedFeatures, createSlowFrameWatch, cycleQuality, fxFeatures, loadSavedQuality, lowerQuality,
  normalizeQuality, parseFxSwitches, QUALITY_FALLBACK, QUALITY_LEVELS, saveQuality,
} from './quality.js';
import { ON_SURFACE, PixelSprite, pixelTexture } from './sprites.js';
import { metaAnchor } from './v3-meta.js';
import { sameViewSize, windowViewInto } from './view-size.js';

// The camera aspect until the first resize() measures the canvas.
export const WORLD_ASPECT = 16 / 9;
const PIECE_SHADOW_RADIUS = 0.36;
const ROCK_SHADOW_RADIUS = PIECE_SHADOW_RADIUS * 1.2;

// The switches the scenery around the board reads (breeze-hill.js and
// the meadow, meadow-scene.js).
const SCENERY_FEATURES = new Set([
  'ground', 'scenery', 'meadowFlowers', 'skyHaze', 'groundFog', 'ridges', 'floorShade', 'shadows', 'sky', 'wind', 'backgroundMotion',
  'forestWall', 'treeRows', 'undergrowth', 'forestLogs',
]);
// The switches the farmland board reads (farm-field.js).
const FARM_FEATURES = new Set(['boardTexture', 'scenery']);

const COLORS = {
  sun: 0xffe0b0,
  hemiSky: 0xcfe8ff,
  hemiGround: 0x6f8f4a,
};

// Builds the world on `canvas` (it fills the whole window at any shape,
// docs/art-direction-v3-1.md section 3; the camera's aspect and field of
// view follow the canvas, see resize below). Throws if
// WebGL is not available. Returns the world; call render(now) every frame.
// `assets` is the store from loadAssets (src/render/assets.js); textures
// whose file is missing are generated placeholders (src/render3d/art.js).
// `meta` is the v3 tuning data from loadV3Meta (src/render3d/v3-meta.js).
// `quality` is the level to start with (default: the one saved in
// `storage`, else medium); `storage` is localStorage or null. `fx` are the
// URL switches for the High-only effects (parseFxSwitches in quality.js),
// read from the page's URL by default. `createRenderer(canvas)` makes the
// WebGL renderer (tests pass a stand-in, as Node has no WebGL).
export function createWorld(canvas, {
  storage = browserStorage(),
  quality: startLevel = loadSavedQuality(storage) ?? QUALITY_FALLBACK,
  assets = createAssetStore(),
  meta,
  warn = () => {},
  fx = parseFxSwitches(globalThis.location?.search ?? ''),
  createRenderer = (target) => new THREE.WebGLRenderer({ canvas: target, antialias: true }),
} = {}) {
  setArtAssets(assets, { warn, meta });
  const renderer = createRenderer(canvas);
  // No shadow maps: shadows are flat decals on the ground (blob shadows on
  // Medium, the sheared silhouettes of the long sun shadows on High), which
  // fall the documented way (toward the lower right) and cost no extra
  // render of the scene.
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();

  // Fixed camera: no rotation or zoom (section B). Its position and aim
  // never change; resize() sets its aspect and its field of view
  // (fitView, framing.js) from the canvas, in cameraSetup too, so picking
  // always uses the camera that is drawn.
  const cameraSetup = gameCamera(WORLD_ASPECT);
  const cameraPos = cameraSetup.position;
  // Its near and far planes hug what it can show, for depth precision.
  const camera = createGameCamera(THREE, WORLD_ASPECT, clipPlanes(cameraSetup));
  // The camera's own right and up directions, for the screen shake.
  camera.updateMatrixWorld();
  const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const cameraUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);

  // Lights: a warm sun and a cool hemisphere fill (section D).
  const sun = new THREE.DirectionalLight(COLORS.sun, 2.6);
  sun.position.set(-12, 20, 10);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, 1.2));

  // Windy Spring Breeze Hill around the board (section C).
  const scenery = buildBreezeHill(scene, cameraPos, camera, { sunRays: fx.rays });

  // Hover highlight: the gold decal on the plot under the pointer, always
  // fully visible (docs/art-direction-v3.md section 3).
  const hoverMaterial = decalMaterial(artSource(ART.v3.decal.hover));
  const hover = createCellDecal(hoverMaterial);
  scene.add(hover);
  let hoveredCell = null;

  // Pixel sprites (section D). Wind Rabbit (X) stands on the left of the
  // board and Earth Bear (O) on the right, with idle, cast, win and lose
  // poses and a glow for the player to move (src/render3d/characters3d.js),
  // when SHOW_WORLD_CHARACTERS is on; for now the HUD cards carry them.
  const sprites = []; // an array, so the render loop walks it without an iterator
  let blobShadows = true; // the 'blob' shadow mode (Medium)
  let sunShadows = false; // the 'sun' shadow mode (High): long sun shadows instead of blobs
  // A sprite with noBlobShadow set (the see-through ghosts) never shows either.
  const showShadow = (sprite) => {
    sprite.shadow.visible = blobShadows && !sprite.noBlobShadow;
    sprite.sunShadow.visible = sunShadows && !sprite.noBlobShadow;
  };
  const addSprite = (sprite) => {
    if (!sprites.includes(sprite)) sprites.push(sprite);
    showShadow(sprite);
    scene.add(sprite.object);
    return sprite;
  };
  const characters = createCharacters(addSprite);

  // The farmland board: field, curb, and with scenery the fence and path.
  const farm = createFarmField(scene, addSprite);

  // Post-processing; the depth of field follows the live camera.
  const postProcessing = createPostProcessing(renderer, scene, camera);
  const slowFrames = createSlowFrameWatch({
    targetFrameMs: TARGET_FRAME_MS,
    holdMs: QUALITY_STEP_DOWN_MS,
    stallMs: QUALITY_STALL_MS,
  });
  // A hidden page stops requestAnimationFrame; that gap is not a slow frame.
  const fpsMeter = createFpsMeter(FPS_SAMPLE_MS, QUALITY_STALL_MS);
  let quality = null;
  let features = null; // the quality table row of `quality`, with the URL switches (fxFeatures)
  let autoStepped = false; // true after the last change was an automatic step down

  // The drawing buffer follows the canvas's CSS box and this window's
  // devicePixelRatio (capped by the level's pixelRatioCap), and the camera
  // its shape (windowView in view-size.js). It is checked every frame: a
  // window moved to another screen or zoomed does not always get a resize
  // event, a canvas laid out after the world was built has no size at
  // first, and a resize or an orientation change lands in the next frame
  // with the renderer size, the pixel ratio and the camera together.
  // clientWidth ignores CSS transforms, so the blurred backdrop behind the
  // menus (index.html) does not resize it.
  // Both sizes are made once and rewritten, so the check allocates nothing
  // unless the size really changed.
  const viewSizeNow = { width: 0, height: 0, pixelRatio: 0 };
  const viewSizeNext = { width: 0, height: 0, pixelRatio: 0, aspect: 0, fovDeg: 0 };
  let sized = false; // false until viewSizeNow holds the buffer's size
  function resize() {
    if (!(canvas.clientWidth > 0 && canvas.clientHeight > 0)) return; // hidden or not laid out yet: keep the last size
    const next = windowViewInto(canvas.clientWidth, canvas.clientHeight, features, globalThis.devicePixelRatio, viewSizeNext);
    if (sized && sameViewSize(viewSizeNow, next)) return;
    applyViewSize(next);
  }

  // A new size: the renderer, the pixel ratio and the camera change
  // together (only when the size changed, never on a steady frame).
  function applyViewSize(next) {
    sized = true;
    viewSizeNow.width = next.width;
    viewSizeNow.height = next.height;
    viewSizeNow.pixelRatio = next.pixelRatio;
    renderer.setPixelRatio(next.pixelRatio);
    renderer.setSize(next.width, next.height, false);
    cameraSetup.aspect = next.aspect;
    cameraSetup.fovDeg = next.fovDeg;
    const clip = clipPlanes(cameraSetup); // a wider view sees nearer ground
    camera.aspect = next.aspect;
    camera.fov = next.fovDeg;
    camera.near = clip.near;
    camera.far = clip.far;
    camera.updateProjectionMatrix();
    // The horizon and the ridges follow the shape; the buffer height as
    // renderer.setSize just set it.
    scenery.setView(next.aspect, Math.max(1, Math.floor(next.height * next.pixelRatio)));
    postProcessing.resize();
  }

  // Switches to a level (unknown values are medium) and rebuilds only the
  // parts whose switches changed; pieces, effects and the game are left
  // alone. `auto` marks an automatic step down.
  function applyQuality(level, auto) {
    const next = normalizeQuality(level);
    const nextFeatures = fxFeatures(QUALITY_LEVELS[next], fx);
    const changed = changedFeatures(features, nextFeatures);
    quality = next;
    features = nextFeatures;
    autoStepped = auto;
    slowFrames.reset();
    fpsMeter.resetLowest(); // the lowest FPS reading is per level
    if (changed.includes('shadows')) {
      blobShadows = features.shadows === 'blob';
      sunShadows = features.shadows === 'sun';
      for (let i = 0; i < sprites.length; i++) showShadow(sprites[i]);
    }
    if (changed.includes('postEffects')) postProcessing.setEffects(features.postEffects);
    if (changed.some((key) => SCENERY_FEATURES.has(key))) scenery.setFeatures(features);
    if (changed.some((key) => FARM_FEATURES.has(key))) farm.setFeatures(features);
    if (changed.includes('pixelRatioCap')) {
      sized = false;
      resize();
    }
  }
  applyQuality(startLevel, false);

  // A choice made by hand (the Q key, ?quality=): applied and saved.
  function setQuality(level) {
    applyQuality(level, false);
    saveQuality(storage, quality);
  }

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
      const i = sprites.indexOf(sprite);
      if (i >= 0) sprites.splice(i, 1);
      scene.remove(sprite.object);
    },

    // Shows the hover decal on a cell { x, y }, or hides it for null.
    setHoveredCell(cell) {
      hoveredCell = cell;
      hover.visible = cell !== null;
      if (cell) placeOnCell(hover, cell.x, cell.y);
    },

    // The texture of the hover decal (the ring tinted for the player to
    // move, mark-tints.js). Called every frame: it only assigns.
    setHoverMap(map) {
      if (hoverMaterial.map !== map) hoverMaterial.map = map;
    },

    // The texture the hover decal shows now.
    get hoverMap() {
      return hoverMaterial.map;
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
      const step = worldUnitsPerPixel(CAMERA_DISTANCE, cameraSetup.fovDeg, canvas.height);
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

    // The lowest FPS reading since this level was set (Infinity before the first).
    get fpsLowest() {
      return fpsMeter.lowest;
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
      for (let i = 0; i < sprites.length; i++) sprites[i].update(now, camera.position);
      postProcessing.render(dtMs / 1000);
    },
  };
}

// A board piece sprite (docs/art-direction-v3.md section 4): 'X' or 'O'
// is the plant (plant-x, a four-petal cross bloom, or plant-o, a round
// bloom) with its anchor pixel on the plot centre, showing the Rest stage
// until its owner steps the growth with setFrame; 'rock' is the mossy
// rock-v3 boulder on its bottom centre (the manifest key "rock" is the 2D
// sprite). Sprites of a kind share one texture. `sheet` replaces a
// plant's art with a sheet of the same size: the plant tinted to the
// colour of its side's character (mark-tints.js).
export function createPieceSprite(kind, sheet = null) {
  if (kind === 'rock') {
    return new PixelSprite({ sheet: artSource(ART.v3.rock), shadowRadius: ROCK_SHADOW_RADIUS });
  }
  const name = ART.v3.plant[kind];
  const sprite = new PixelSprite({
    sheet: sheet ?? artSource(name),
    frameCount: placeholderShape(name).frames,
    shadowRadius: PIECE_SHADOW_RADIUS,
    anchor: metaAnchor(artMeta(), name),
    swayFrame: STAGE_REST, // resting plants sway on High (PLANT_SWAY)
  });
  sprite.setFrame(STAGE_REST);
  return sprite;
}

// Puts a sprite or decal on the centre of board cell (x, y), keeping its
// height. Called in the render loop, so it allocates nothing.
const cellCentre = { x: 0, z: 0 };
export function placeOnCell(object, x, y) {
  cellToWorldInto(x, y, cellCentre);
  const target = object.object ?? object;
  target.position.x = cellCentre.x;
  target.position.z = cellCentre.z;
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
    ...ON_SURFACE,
  });
}

// A flat one-cell decal lying on the plot, drawn over it by polygon
// offset (ON_SURFACE), hidden until placed.
// `geometry` defaults to the whole texture on one cell.
let cellDecalGeometry = null;
export function createCellDecal(material, geometry = null) {
  cellDecalGeometry ??= new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE).rotateX(-Math.PI / 2);
  const decal = new THREE.Mesh(geometry ?? cellDecalGeometry, material);
  decal.visible = false;
  return decal;
}

// One-cell geometry showing the part of a 3x3-cell zone decal (decal-zone-v3)
// that lies on the cell (dx, dy) from the zone centre, so a zone clipped at
// the board edge shows only its part on the field.
// Keyed by a number, not a string, so a lookup in the render loop (the zone
// preview) makes nothing; a piece is built once, on its first use.
const zonePieces = new Map();
export function zonePieceGeometry(dx, dy) {
  const key = (dy + 64) * 128 + (dx + 64);
  return zonePieces.get(key) ?? newZonePiece(key, dx, dy);
}

function newZonePiece(key, dx, dy) {
  const { u0, u1, v0, v1 } = zonePieceUv(dx, dy);
  const geometry = new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE);
  // PlaneGeometry corners: top left, top right, bottom left, bottom right.
  geometry.attributes.uv.set([u0, v1, u1, v1, u0, v0, u1, v0]);
  zonePieces.set(key, geometry.rotateX(-Math.PI / 2));
  return zonePieces.get(key);
}
