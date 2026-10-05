// The 3D game renderer (docs/art-direction-hd2d.md sections B, C, D and F).
// It has the same interface as the 2D renderer that src/main.js uses:
//   drawGameScreen(ctx, view)  draws the game view (see ui/local-game.js
//                              and ui/online-game.js)
//   drawMenuScreen(ctx, time, title)  the world with an empty board
//                              behind the DOM screens, and the title unless
//                              title is false (the DOM menu has its own)
//   hitTest(px, py)            the board cell under a point of the WebGL
//                              canvas (its drawing buffer pixels)
// The WebGL canvas shows the world (src/render3d/world.js) with the board's
// stones and rocks as sprites on the farmland board, and the v3 flat
// decals (docs/art-direction-v3.md section 3) for hover, skill targeting,
// announced skills, the last move and the winning line. ctx is the
// transparent 2D canvas stacked above it (a 16:9 box in the middle of the
// window that takes no pointer events), which only shows the skill
// banners, the quality and FPS line and the menu title: the player cards,
// skill buttons, turn and messages are the DOM glass HUD (src/ui/hud.js,
// docs/art-direction-v3.md section 8). Board picking is a ray from the
// camera (src/render3d/hit-test.js). The WebGL canvas fills the whole
// window (docs/art-direction-v3-1.md section 3). The Q key calls
// setQuality(cycleQuality(quality)) through cycleQuality().
//
// The world also comes alive from the logic events (sections D and G):
//   trigger(events, time, characters)  planted seeds grow into plants (growth.js), a character casts when its
//                          player uses a skill, win and lose poses at the
//                          end, and the skill visuals, sparkles, dust,
//                          camera shake and HUD banners (effects3d.js)
//   catchUp(events, time)  events that piled up while the page was
//                          hidden: the poses and lingering skill marks are
//                          brought up to date without replaying the rest
//   reset()                a new game: no growth or effects, both characters idle
// The player to move has a gentle glow. None of this changes the rules.
//
// The marks are in the colours of the characters (character-look.js,
// mark-tints.js): the plants, the last-move ring, and for the player to
// move the hover ring and the selection decal take the colour of the
// character that plays that side (view.state.characters, the seats by
// pick order). They are tinted once when a match starts (the sides
// change) and again on a quality change, the old textures disposed. Every
// planted seed also plays the placement effect of its side's character.
//
// Cloud Eagle (cloud-overlay.js): each cloud shows over its cells,
// translucent with the plants inside visible for its owner and
// spectators, opaque for the other seat (whose state has nothing under it,
// maskForViewer). The Sky Watch cells show as soft yellow outlines to the
// Cloud Eagle side and to spectators. Both are worked out again only when
// the drawn state or its viewer changes.

import {
  BOARD_SIZE, CLOUD_PREVIEW_OPACITY, CLOUD_SEE_THROUGH_OPACITY, INTERNAL_HEIGHT, INTERNAL_WIDTH, PX_WORLD, SKY_WATCH_OPACITY,
  SPRITE_STRETCH_Y,
} from '../config.js';
import { O, ROCK, X } from '../logic/board.js';
import { DEFAULT_SIDES } from '../logic/characters.js';
import { createInitialState, isGameOver } from '../logic/game.js';
import { drawText } from '../render/game-renderer.js';
import { artMeta, artSource } from './art.js';
import { ART, placeholderShape } from './art-assets.js';
import { boardMarksInto, createBoardMarks, lastMoveOpacity, lastPlanted, winPulseOpacity } from './board-marks.js';
import { placementCues } from './character-look.js';
import { COVER, cloudTileGrid, createCloudOverlay, skyWatchOutlineGrid, viewerOf } from './cloud-overlay.js';
import { createEffects3d } from './effects3d.js';
import { enteredStage, plantedCells, plantPoseInto, STAGE_LAND, STAGE_OPEN, STAGE_REST } from './growth.js';
import { createWorldHitTest } from './hit-test.js';
import { parseFpsSwitch } from './fps.js';
import { plantFrameIndex, plantFrames } from './plant-frames.js';
import { QUALITY_ORDER } from './quality.js';
import { buildMarkTints, disposeMarkTints } from './mark-tints.js';
import { fadedAlphaTest } from './sprite-frames.js';
import { sheetCanvas, sheetTopRow } from './sprites.js';
import { metaAnchor, stageStartMs } from './v3-meta.js';
import { createCellDecal, createPieceSprite, createWorld, decalMaterial, placeOnCell, zonePieceGeometry } from './world.js';

const GHOST_OPACITY = 0.45; // see-through stone or rock where it would go
const EMPTY_BOARD = createInitialState().board; // the menus show the board bare
const NO_DECALS = [];
const TITLE_STYLE = { size: 48 };
const QUALITY_TEXT_STYLE = { size: 11, align: 'left' };
const FPS_TEXT_MAX = 1000; // FPS readings above this are drawn as this

const NO_LOWEST_TEXT = 'Lowest FPS -';

// The quality and FPS line, e.g. "Quality high [Q]  FPS 60".
function qualityText(quality, auto, fps) {
  return `Quality ${quality}${auto ? ' (auto)' : ''} [Q]  FPS ${fps}`;
}

// The ?fps=1 line under it, e.g. "Lowest FPS 52".
function lowestText(fps) {
  return `Lowest FPS ${fps}`;
}

// Throws if WebGL is not available. `options.assets` is the loaded art
// (see createWorld in world.js); missing files show placeholders.
// `options.showFps` adds the lowest FPS reading of the current level under
// the FPS line (default: ?fps=1 in the page's URL), on every level, for the
// owner's FPS measurement (docs/art-direction-v3.md, Performance results).
// `options.showQualityLine` false hides the quality and FPS line (shot
// mode, docs/shots.md section 4).
export function createWorldRenderer(worldCanvas, options = {}) {
  const { showFps = parseFpsSwitch(globalThis.location?.search ?? ''), showQualityLine = true, warn = () => {} } = options;
  const world = createWorld(worldCanvas, options);
  const pieces = createPieceLayer(world);
  const decals = createDecalLayer(world);
  const ghosts = createGhosts(world);
  const lastMove = createLastMoveMark(world);
  const clouds = createCloudLayer(world);
  // A plant that a skill moves or converts regrows from Land (effects3d.js).
  const effects = createEffects3d(world, { regrow: (x, y, player, plantedAt) => pieces.growOne(x, y, player, plantedAt) });

  const marks = createBoardMarks(); // reused every frame

  // The marks tinted for the match (mark-tints.js): built for these sides
  // at this quality level, null before the first game frame.
  let tints = null;
  let tintedX = null;
  let tintedO = null;
  let tintedQuality = null;
  const applyMarkTints = (next) => {
    const old = tints;
    // The decals' first textures (the art's own colours) are freed with
    // the first tint, the tints after that with the next one.
    const firstMaps = old ? null : [world.hoverMap, decals.selectMap, ...lastMove.maps()];
    tints = buildMarkTints(next, warn);
    tintedX = next[X];
    tintedO = next[O];
    tintedQuality = world.quality;
    pieces.retint(tints.plant);
    ghosts.retint(tints.plant);
    effects.setPlantSheets(tints.plant);
    lastMove.retint(tints.last);
    world.setHoverMap(tints.hover[X]);
    decals.useSelectMap(tints.select[X]);
    if (old) disposeMarkTints(old);
    else for (const map of firstMaps) map.dispose();
  };

  // The level and FPS of this window, top left on the HUD (shown on every
  // level, the FPS counter of docs/art-direction-v3.md section 10). Each
  // line is built once, the first time it shows, and kept: per level and
  // auto flag, one string per whole FPS value. So the render loop
  // allocates no string for it.
  const qualityLines = [];
  for (let i = 0; i < QUALITY_ORDER.length * 2; i++) qualityLines.push([]);
  const lowestLines = [];
  const drawQuality = (ctx) => {
    if (!showQualityLine) return;
    const fps = Math.min(Math.max(Math.round(world.fps), 0), FPS_TEXT_MAX);
    const level = Math.max(0, QUALITY_ORDER.indexOf(world.quality));
    const lines = qualityLines[level * 2 + (world.autoStepped ? 1 : 0)];
    lines[fps] ??= qualityText(world.quality, world.autoStepped, fps);
    drawText(ctx, lines[fps], 8, 12, QUALITY_TEXT_STYLE);
    if (!showFps) return;
    const lowest = world.fpsLowest;
    if (lowest === Infinity) {
      drawText(ctx, NO_LOWEST_TEXT, 8, 26, QUALITY_TEXT_STYLE);
      return;
    }
    const low = Math.min(Math.max(Math.round(lowest), 0), FPS_TEXT_MAX);
    lowestLines[low] ??= lowestText(low);
    drawText(ctx, lowestLines[low], 8, 26, QUALITY_TEXT_STYLE);
  };

  return {
    drawGameScreen(ctx, view) {
      const time = view.time ?? performance.now();
      const sides = view.state.characters ?? DEFAULT_SIDES;
      if (tints === null || sides[X] !== tintedX || sides[O] !== tintedO || world.quality !== tintedQuality) applyMarkTints(sides);
      const toMove = view.state.currentPlayer === O ? O : X;
      world.setHoverMap(tints.hover[toMove]);
      decals.useSelectMap(tints.select[toMove]);
      pieces.sync(view.state.board, time, effects);
      world.characters.setActive(isGameOver(view.state) ? null : view.state.currentPlayer);
      boardMarksInto(view, marks);
      decals.show(marks.decals, marks.count, time);
      lastMove.show(view.state.board, time);
      clouds.show(view);
      ghosts.show(marks.ghost);
      world.setHoveredCell(view.hover ?? null);
      effects.update(time);
      world.render(time);

      ctx.clearRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
      effects.drawBanner(ctx, time);
      drawQuality(ctx);
    },

    drawMenuScreen(ctx, time = performance.now(), title = true) {
      pieces.sync(EMPTY_BOARD, time, effects);
      world.characters.setActive(null);
      decals.show(NO_DECALS, 0, time);
      lastMove.hide();
      clouds.hide();
      ghosts.show(null);
      world.setHoveredCell(null);
      effects.update(time);
      world.render(time);

      ctx.clearRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
      if (title) drawText(ctx, 'Gomoku Tales', INTERNAL_WIDTH / 2, 90, TITLE_STYLE);
      drawQuality(ctx);
    },

    // The board cell under a point in the WebGL canvas's drawing buffer
    // pixels (src/main.js attaches the pointer to that canvas), through the
    // live camera: right at every window shape.
    hitTest: createWorldHitTest(world.cameraSetup, worldCanvas),

    // Switches this window's quality level ('low', 'medium' or 'high';
    // unknown values are medium), saves it and keeps the game as it is.
    setQuality(level) {
      world.setQuality(level);
    },

    cycleQuality() {
      world.cycleQuality();
    },

    // The marks tinted for the match (buildMarkTints in mark-tints.js:
    // colour, plant, last, hover and select by player), null before the
    // first game frame.
    get markTints() {
      return tints;
    },

    // This window's quality level ('low', 'medium' or 'high').
    get quality() {
      return world.quality;
    },

    // Its row of the quality table (src/render3d/quality.js).
    get features() {
      return world.features;
    },

    // characters are the sides of the game the events come from
    // (state.characters): the events of a frame are shown before it is
    // drawn, so the first seed of a new match must not use the old sides.
    trigger(events, time, characters) {
      if (events.length === 0) return;
      pieces.grow(plantedCells(events), time);
      lastMove.trigger(events, time);
      world.characters.trigger(events, time);
      effects.trigger(events, time);
      // The placement effect of the character of each planted seed's side.
      for (const cue of placementCues(events, characters ?? DEFAULT_SIDES)) effects.placement(cue.x, cue.y, cue.effect, time);
    },

    catchUp(events, time) {
      if (events.length === 0) return;
      lastMove.catchUp(events);
      world.characters.trigger(events, time);
      effects.catchUp(events, time);
    },

    reset() {
      pieces.settleAll();
      lastMove.reset();
      world.characters.reset();
      effects.reset();
    },
  };
}

// The growth look of a player's plant: its stage start times, anchor row,
// the top visible row of each stage frame (for the in-between nudges) and
// its in-between frames (plant-frames.js), built for `inBetween` and again
// whenever that changes (a quality switch), never per frame.
function plantLook(player) {
  const name = ART.v3.plant[player];
  const meta = artMeta();
  const sheet = artSource(name);
  const count = placeholderShape(name).frames;
  const topRows = [];
  for (let f = 0; f < count; f++) topRows.push(sheetTopRow(sheet, sheet.width / count, f));
  return {
    stages: stageStartMs(meta, name), anchorY: metaAnchor(meta, name)?.y ?? 0, topRows, inBetween: -1, frames: null,
  };
}

function plantFramesOf(look, inBetween) {
  if (look.inBetween !== inBetween) {
    look.frames = plantFrames(look.topRows.length, inBetween, look.topRows);
    look.inBetween = inBetween;
  }
  return look.frames;
}

function pieceKind(cell) {
  if (cell === X || cell === O) return cell;
  if (cell === ROCK) return 'rock';
  return null;
}

const UNPLANTED = -1; // growth stage of a cell before its seed drops

// Plant and rock sprites that follow the board (docs/art-direction-v3.md
// section 4). Sprites are reused: a removed piece goes back to its kind's
// pool, hidden. A plant whose seed was planted by an event given to grow()
// grows through Drop, Land, Sprout, Open and Rest at the stage start times
// of v3-meta.json, with the Land soil puff and the Open sparkles of the
// effects (shown on the levels that have them). A plant that a skill
// moved or converted regrows from Land once its flying seed arrives (the
// effects call growOne with a planting time in the past or future). Every
// other plant, one that already stood there when the game started or
// loaded, shows Rest at once. Plants inside a Tornado Zone bend towards it
// on the levels that have it (effects.bendAt). Growth only animates: the board is always the
// logic's. A piece stays hidden while the effects show a flying copy
// arriving on its cell.
function createPieceLayer(world) {
  const cellCount = BOARD_SIZE * BOARD_SIZE;
  const shownKind = []; // per cell index: 'X', 'O', 'rock' or null
  const shownSprite = [];
  const free = { [X]: [], [O]: [], rock: [] };
  const growStart = new Float64Array(cellCount).fill(NaN); // when the seed was planted, NaN: not growing
  const growKind = []; // the player whose seed it is
  const lastStage = new Int8Array(cellCount).fill(UNPLANTED);
  const pose = { frame: 0, progress: 0, dropPx: 0, scale: 1 }; // written by plantPoseInto
  const looks = {}; // per player: plantLook, made the first time
  const look = (player) => (looks[player] ??= plantLook(player));
  let plantSheets = { [X]: null, [O]: null }; // the tinted plant sheets (retint), null: the art's own

  const rest = (sprite, kind) => {
    if (kind === 'rock') return;
    sprite.setBlend(STAGE_REST, STAGE_REST, 0);
    sprite.plane.position.y = 0;
    sprite.object.scale.set(1, 1, 1);
  };

  // The plant on cell i stops growing and shows Rest.
  const settle = (i) => {
    growStart[i] = NaN;
    lastStage[i] = UNPLANTED;
    if (shownSprite[i]) rest(shownSprite[i], shownKind[i]);
  };

  const growOne = (x, y, player, time) => {
    const i = y * BOARD_SIZE + x;
    growStart[i] = time;
    growKind[i] = player;
    lastStage[i] = UNPLANTED;
  };

  return {
    // Cells { x, y, player } whose seed was planted at `time`.
    grow(cells, time) {
      for (const { x, y, player } of cells) growOne(x, y, player, time);
    },

    // The plant of `player` on cell (x, y) grows as if its seed was planted
    // at `time` (which may lie ahead: it shows its first stage until then).
    growOne,

    // Plants from now on use the tinted sheets `sheets` (by player): every
    // plant sprite made from the old ones leaves the world and is freed,
    // and the next sync makes new ones. Growth goes on where it was.
    retint(sheets) {
      plantSheets = sheets;
      for (let i = 0; i < cellCount; i++) {
        const kind = shownKind[i];
        if (kind !== X && kind !== O) continue;
        dropSprite(world, shownSprite[i]);
        shownKind[i] = null;
        shownSprite[i] = null;
      }
      for (const kind of [X, O]) {
        for (const sprite of free[kind]) dropSprite(world, sprite);
        free[kind].length = 0;
      }
    },

    // Every plant shows Rest (a new game).
    settleAll() {
      for (let i = 0; i < cellCount; i++) if (!Number.isNaN(growStart[i])) settle(i);
    },

    sync(board, time, effects) {
      const size = board.length;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          const kind = pieceKind(board[y][x]);
          const current = shownKind[i] ?? null;
          if (current === kind) continue;
          if (current) {
            const old = shownSprite[i];
            rest(old, current);
            old.setBend(0, 0, 0);
            old.object.visible = false;
            free[current].push(old);
          }
          shownKind[i] = kind;
          shownSprite[i] = null;
          if (kind) {
            const sprite = free[kind].pop() ?? world.addSprite(createPieceSprite(kind, kind === 'rock' ? null : plantSheets[kind]));
            sprite.object.visible = true;
            placeOnCell(sprite, x, y);
            shownSprite[i] = sprite;
            // Only a seed planted by an event grows; anything else rests.
            if (growKind[i] !== kind) growStart[i] = NaN;
            if (Number.isNaN(growStart[i])) settle(i);
          }
        }
      }
      for (let i = 0; i < cellCount; i++) {
        const sprite = shownSprite[i];
        if (!sprite) {
          growStart[i] = NaN; // the seed's cell is empty again (a skill took it)
          continue;
        }
        sprite.object.visible = !effects.holds(i, time);
        const x = i % BOARD_SIZE;
        const y = (i - x) / BOARD_SIZE;
        sprite.setBend(effects.bendAt(x, y), effects.bendCentre.x, effects.bendCentre.z);
        if (Number.isNaN(growStart[i])) continue;
        const player = shownKind[i];
        const plant = look(player);
        const { stages, anchorY } = plant;
        plantPoseInto(time - growStart[i], stages, pose);
        // The in-between frames of the quality level (plantInBetween).
        const inBetween = world.features?.plantInBetween ?? 0;
        const frames = plantFramesOf(plant, inBetween);
        const shown = frames[plantFrameIndex(pose.frame, pose.progress, plant.topRows.length, inBetween)];
        sprite.setBlend(shown.from, shown.to, shown.mix);
        sprite.plane.position.y = (pose.dropPx + shown.liftPx) * PX_WORLD * SPRITE_STRETCH_Y;
        sprite.object.scale.set(pose.scale, pose.scale, pose.scale);
        if (enteredStage(lastStage[i], pose.frame, STAGE_LAND)) effects.soilPuff(x, y);
        if (enteredStage(lastStage[i], pose.frame, STAGE_OPEN)) effects.openSparkles(x, y, player, anchorY);
        lastStage[i] = pose.frame;
        if (pose.frame === STAGE_REST && pose.scale === 1) settle(i);
      }
    },
  };
}

// Decal art per kind (see board-marks.js): the v3 decals from
// assets/manifest.json, or placeholders (art.js). All show at full
// opacity; the winner marks pulse. renderOrder keeps overlapping decals in
// a fixed order (the last-move mark is 3, see createLastMoveMark).
const DECALS = {
  zonePreview: { order: 1, art: ART.v3.decal.zone },
  win: { order: 2, art: ART.v3.decal.win },
  dashTarget: { order: 4, art: ART.v3.decal.dashTarget },
  select: { order: 5, art: ART.v3.decal.select },
  cloudPreview: { order: 1, grid: cloudTileGrid, opacity: CLOUD_PREVIEW_OPACITY },
};

// Pools of flat cell decals; show(decals, count, time) places the first
// `count` decals and hides the rest. A zone decal shows its own part of the 3x3 zone art.
function createDecalLayer(world) {
  const pools = {};
  for (const [kind, look] of Object.entries(DECALS)) {
    const material = decalMaterial(look.grid ? sheetCanvas([look.grid()]) : artSource(look.art));
    if (look.opacity !== undefined) material.opacity = look.opacity;
    pools[kind] = { material, order: look.order, meshes: [], used: 0 };
  }
  const poolList = Object.values(pools);
  return {
    // The texture of the selection decals (tinted for the player to move,
    // mark-tints.js). Called every frame: it only assigns.
    useSelectMap(map) {
      if (pools.select.material.map !== map) pools.select.material.map = map;
    },

    get selectMap() {
      return pools.select.material.map;
    },

    show(decals, count, time) {
      pools.win.material.opacity = winPulseOpacity(time);
      for (let p = 0; p < poolList.length; p++) poolList[p].used = 0;
      for (let d = 0; d < count; d++) {
        const decal = decals[d];
        const pool = pools[decal.kind];
        if (!pool) continue;
        let mesh = pool.meshes[pool.used];
        if (!mesh) {
          mesh = createCellDecal(pool.material);
          mesh.renderOrder = pool.order;
          world.scene.add(mesh);
          pool.meshes.push(mesh);
        }
        pool.used++;
        if (decal.kind === 'zonePreview') mesh.geometry = zonePieceGeometry(decal.dx, decal.dy);
        mesh.visible = true;
        placeOnCell(mesh, decal.x, decal.y);
      }
      for (let p = 0; p < poolList.length; p++) {
        const pool = poolList[p];
        for (let i = pool.used; i < pool.meshes.length; i++) pool.meshes[i].visible = false;
      }
    },
  };
}

// Cloud Eagle's clouds and Sky Watch outlines (cloud-overlay.js) as flat
// cell decals from pure pixel tiles (no art file). Pools of meshes, made
// the first time that many show; the decals are placed again only when
// the overlay changes.
const CLOUD_ORDER = { seeThrough: 1, cover: 6, outline: 7 };
function createCloudLayer(world) {
  const overlayFor = createCloudOverlay();
  const cloudTile = sheetCanvas([cloudTileGrid()]);
  const looks = {
    seeThrough: decalMaterial(cloudTile),
    cover: decalMaterial(cloudTile),
    outline: decalMaterial(sheetCanvas([skyWatchOutlineGrid()])),
  };
  looks.seeThrough.opacity = CLOUD_SEE_THROUGH_OPACITY;
  looks.outline.opacity = SKY_WATCH_OPACITY;
  const pools = { seeThrough: [], cover: [], outline: [] };
  const used = { seeThrough: 0, cover: 0, outline: 0 };
  const kinds = Object.keys(pools);
  let shownVersion = -1;
  const placeDecal = (kind, x, y) => {
    let mesh = pools[kind][used[kind]];
    if (!mesh) {
      mesh = createCellDecal(looks[kind]);
      mesh.renderOrder = CLOUD_ORDER[kind];
      world.scene.add(mesh);
      pools[kind].push(mesh);
    }
    used[kind]++;
    mesh.visible = true;
    placeOnCell(mesh, x, y);
  };
  const hideFrom = (kind, first) => {
    const meshes = pools[kind];
    for (let i = first; i < meshes.length; i++) meshes[i].visible = false;
  };
  // Only when the overlay changed (a new state or viewer).
  const placeOverlay = (overlay) => {
    for (const kind of kinds) used[kind] = 0;
    for (const cell of overlay.clouds) placeDecal(cell.look === COVER ? 'cover' : 'seeThrough', cell.x, cell.y);
    for (const cell of overlay.skyWatch) placeDecal('outline', cell.x, cell.y);
    for (const kind of kinds) hideFrom(kind, used[kind]);
  };
  return {
    hide() {
      if (shownVersion === -1) return;
      for (let k = 0; k < kinds.length; k++) hideFrom(kinds[k], 0);
      shownVersion = -1;
    },
    show(view) {
      const overlay = overlayFor(view.state, viewerOf(view));
      if (overlay.version === shownVersion) return;
      shownVersion = overlay.version;
      placeOverlay(overlay);
    },
  };
}

// The last-move mark: decal-last-x or decal-last-o on the newest plant,
// fading in with its Open stage and staying until the next move. It hides
// once that plant is gone from its plot (thrown, converted, a new game).
function createLastMoveMark(world) {
  const marks = {};
  for (const [player, art] of [[X, ART.v3.decal.lastX], [O, ART.v3.decal.lastO]]) {
    const mesh = createCellDecal(decalMaterial(artSource(art)));
    mesh.renderOrder = 3;
    world.scene.add(mesh);
    marks[player] = mesh;
  }
  let last = null; // { x, y, player }
  let start = -Infinity; // when its seed was planted
  const hide = () => {
    marks[X].visible = false;
    marks[O].visible = false;
  };
  return {
    trigger(events, time) {
      const next = lastPlanted(events, last);
      if (next === last) return;
      last = next;
      start = time;
    },

    // Events that piled up while hidden: the mark shows at once.
    catchUp(events) {
      last = lastPlanted(events, last);
      start = -Infinity;
    },

    reset() {
      last = null;
    },

    // The textures the two rings show now.
    maps() {
      return [marks[X].material.map, marks[O].material.map];
    },

    // New ring textures by player (tinted, mark-tints.js); the old ones are
    // the caller's to dispose.
    retint(maps) {
      marks[X].material.map = maps[X];
      marks[O].material.map = maps[O];
    },

    hide,

    show(board, time) {
      hide();
      if (!last || board[last.y]?.[last.x] !== last.player) return;
      const mesh = marks[last.player];
      const plant = last.player === X ? ART.v3.plant.X : ART.v3.plant.O;
      mesh.material.opacity = lastMoveOpacity(time - start, stageStartMs(artMeta(), plant));
      mesh.visible = true;
      placeOnCell(mesh, last.x, last.y);
    },
  };
}

// See-through pieces: the stone the current player would place on the
// hovered cell, or the rock Terrain Creation would drop.
function createGhosts(world) {
  const ghosts = {};
  const makeGhost = (kind, sheet) => {
    const sprite = world.addSprite(createPieceSprite(kind, sheet));
    const material = sprite.plane.material;
    material.transparent = true;
    material.opacity = GHOST_OPACITY;
    // Opacity scales the texel alpha before the cutout test, so the default
    // threshold (0.5) would discard every pixel of a 0.45 ghost.
    material.alphaTest = fadedAlphaTest(GHOST_OPACITY);
    material.depthWrite = false;
    sprite.noBlobShadow = true;
    sprite.shadow.visible = false;
    sprite.sunShadow.visible = false;
    sprite.object.visible = false;
    ghosts[kind] = sprite;
  };
  for (const kind of [X, O, 'rock']) makeGhost(kind, null);
  const kinds = Object.keys(ghosts);
  return {
    // The plant ghosts from the tinted sheets `sheets` (by player); the old
    // ones leave the world and are freed.
    retint(sheets) {
      for (const player of [X, O]) {
        dropSprite(world, ghosts[player]);
        makeGhost(player, sheets[player]);
      }
    },

    show(ghost) {
      for (let i = 0; i < kinds.length; i++) {
        const kind = kinds[i];
        const sprite = ghosts[kind];
        const visible = ghost !== null && ghost.kind === kind;
        sprite.object.visible = visible;
        if (visible) placeOnCell(sprite, ghost.x, ghost.y);
      }
    },
  };
}

// A plant sprite of an old tint: out of the world, its own GPU resources freed.
function dropSprite(world, sprite) {
  world.removeSprite(sprite);
  sprite.dispose();
}
