// The 3D game renderer (docs/art-direction-hd2d.md sections B, C, D and F).
// It has the same interface as the 2D renderer that src/main.js uses:
//   drawGameScreen(ctx, view)  draws the game view (see ui/local-game.js
//                              and ui/online-game.js)
//   drawMenuScreen(ctx, time)  the world with an empty board behind the
//                              DOM lobby and room screens, and the title
//   hitTest(px, py)            the board cell under an internal point
// The WebGL canvas shows the world (src/render3d/world.js) with the board's
// stones and rocks as sprites on the farmland board, and the v3 flat
// decals (docs/art-direction-v3.md section 3) for hover, skill targeting,
// announced skills, the last move and the winning line. ctx is the
// transparent 2D canvas stacked above it, which only shows the skill
// banners, the quality and FPS line and the menu title: the player cards,
// skill buttons, turn and messages are the DOM glass HUD (src/ui/hud.js,
// docs/art-direction-v3.md section 8). Board picking is a ray from the
// camera (src/render3d/hit-test.js). The Q key calls
// setQuality(cycleQuality(quality)) through cycleQuality().
//
// The world also comes alive from the logic events (sections D and G):
//   trigger(events, time)  planted seeds grow into plants (growth.js), a character casts when its
//                          player uses a skill, win and lose poses at the
//                          end, and the skill visuals, sparkles, dust,
//                          camera shake and HUD banners (effects3d.js)
//   catchUp(events, time)  events that piled up while the page was
//                          hidden: the poses and lingering skill marks are
//                          brought up to date without replaying the rest
//   reset()                a new game: no growth or effects, both characters idle
// The player to move has a gentle glow. None of this changes the rules.

import { BOARD_SIZE, INTERNAL_HEIGHT, INTERNAL_WIDTH, PX_WORLD, SPRITE_STRETCH_Y } from '../config.js';
import { O, ROCK, X } from '../logic/board.js';
import { createInitialState, isGameOver } from '../logic/game.js';
import { drawText } from '../render/game-renderer.js';
import { artMeta, artSource } from './art.js';
import { ART } from './art-assets.js';
import { boardMarks, lastMoveOpacity, lastPlanted, winPulseOpacity } from './board-marks.js';
import { createEffects3d } from './effects3d.js';
import { enteredStage, plantedCells, plantPoseInto, STAGE_LAND, STAGE_OPEN, STAGE_REST } from './growth.js';
import { createWorldHitTest } from './hit-test.js';
import { fadedAlphaTest } from './sprite-frames.js';
import { metaAnchor, stageStartMs } from './v3-meta.js';
import { createCellDecal, createPieceSprite, createWorld, decalMaterial, placeOnCell, zonePieceGeometry } from './world.js';

const GHOST_OPACITY = 0.45; // see-through stone or rock where it would go
const EMPTY_BOARD = createInitialState().board; // the menus show the board bare
const NO_DECALS = [];

// Throws if WebGL is not available. `options.assets` is the loaded art
// (see createWorld in world.js); missing files show placeholders.
export function createWorldRenderer(worldCanvas, options = {}) {
  const world = createWorld(worldCanvas, options);
  const pieces = createPieceLayer(world);
  const decals = createDecalLayer(world);
  const ghosts = createGhosts(world);
  const lastMove = createLastMoveMark(world);
  const effects = createEffects3d(world);

  // The level and FPS of this window, top left on the HUD.
  const drawQuality = (ctx) => {
    const autoText = world.autoStepped ? ' (auto)' : '';
    drawText(ctx, `Quality ${world.quality}${autoText} [Q]  FPS ${Math.round(world.fps)}`, 8, 12, { size: 11, align: 'left' });
  };

  return {
    drawGameScreen(ctx, view) {
      const time = view.time ?? performance.now();
      pieces.sync(view.state.board, time, effects);
      world.characters.setActive(isGameOver(view.state) ? null : view.state.currentPlayer);
      const marks = boardMarks(view);
      decals.show(marks.decals, time);
      lastMove.show(view.state.board, time);
      ghosts.show(marks.ghost);
      world.setHoveredCell(view.hover ?? null);
      effects.update(time);
      world.render(time);

      ctx.clearRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
      effects.drawBanner(ctx, time);
      drawQuality(ctx);
    },

    drawMenuScreen(ctx, time = performance.now()) {
      pieces.sync(EMPTY_BOARD, time, effects);
      world.characters.setActive(null);
      decals.show(NO_DECALS, time);
      lastMove.hide();
      ghosts.show(null);
      world.setHoveredCell(null);
      effects.update(time);
      world.render(time);

      ctx.clearRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
      drawText(ctx, 'Gomoku Tales', INTERNAL_WIDTH / 2, 90, { size: 48 });
      drawQuality(ctx);
    },

    hitTest: createWorldHitTest(world.cameraSetup),

    // Switches this window's quality level ('low', 'medium' or 'high';
    // unknown values are medium), saves it and keeps the game as it is.
    setQuality(level) {
      world.setQuality(level);
    },

    cycleQuality() {
      world.cycleQuality();
    },

    // This window's quality level ('low', 'medium' or 'high').
    get quality() {
      return world.quality;
    },

    // Its row of the quality table (src/render3d/quality.js).
    get features() {
      return world.features;
    },

    trigger(events, time) {
      if (events.length === 0) return;
      pieces.grow(plantedCells(events), time);
      lastMove.trigger(events, time);
      world.characters.trigger(events, time);
      effects.trigger(events, time);
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
// effects (shown on the levels that have them). Every other plant, one
// that already stood there when the game started or loaded, or one a skill
// moved, shows Rest at once. Growth only animates: the board is always the
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
  const looks = {}; // per player: { stages, anchorY }
  const look = (player) => {
    if (!looks[player]) {
      const name = ART.v3.plant[player];
      const meta = artMeta();
      looks[player] = { stages: stageStartMs(meta, name), anchorY: metaAnchor(meta, name)?.y ?? 0 };
    }
    return looks[player];
  };

  const rest = (sprite, kind) => {
    if (kind === 'rock') return;
    sprite.setFrame(STAGE_REST);
    sprite.plane.position.y = 0;
    sprite.object.scale.set(1, 1, 1);
  };

  // The plant on cell i stops growing and shows Rest.
  const settle = (i) => {
    growStart[i] = NaN;
    lastStage[i] = UNPLANTED;
    if (shownSprite[i]) rest(shownSprite[i], shownKind[i]);
  };

  return {
    // Cells { x, y, player } whose seed was planted at `time`.
    grow(cells, time) {
      for (const { x, y, player } of cells) {
        const i = y * BOARD_SIZE + x;
        growStart[i] = time;
        growKind[i] = player;
        lastStage[i] = UNPLANTED;
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
            old.object.visible = false;
            free[current].push(old);
          }
          shownKind[i] = kind;
          shownSprite[i] = null;
          if (kind) {
            const sprite = free[kind].pop() ?? world.addSprite(createPieceSprite(kind));
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
        if (Number.isNaN(growStart[i])) continue;
        const player = shownKind[i];
        const { stages, anchorY } = look(player);
        plantPoseInto(time - growStart[i], stages, pose);
        sprite.setFrame(pose.frame);
        sprite.plane.position.y = pose.dropPx * PX_WORLD * SPRITE_STRETCH_Y;
        sprite.object.scale.set(pose.scale, pose.scale, pose.scale);
        const x = i % BOARD_SIZE;
        const y = (i - x) / BOARD_SIZE;
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
};

// Pools of flat cell decals; show() places this frame's decals and hides
// the rest. A zone decal shows its own part of the 3x3 zone art.
function createDecalLayer(world) {
  const pools = {};
  for (const [kind, look] of Object.entries(DECALS)) {
    const material = decalMaterial(artSource(look.art));
    pools[kind] = { material, order: look.order, meshes: [], used: 0 };
  }
  return {
    show(decals, time) {
      pools.win.material.opacity = winPulseOpacity(time);
      for (const pool of Object.values(pools)) pool.used = 0;
      for (const decal of decals) {
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
      for (const pool of Object.values(pools)) {
        for (let i = pool.used; i < pool.meshes.length; i++) pool.meshes[i].visible = false;
      }
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
  for (const kind of [X, O, 'rock']) {
    const sprite = world.addSprite(createPieceSprite(kind));
    const material = sprite.plane.material;
    material.transparent = true;
    material.opacity = GHOST_OPACITY;
    // Opacity scales the texel alpha before the cutout test, so the default
    // threshold (0.5) would discard every pixel of a 0.45 ghost.
    material.alphaTest = fadedAlphaTest(GHOST_OPACITY);
    material.depthWrite = false;
    sprite.noBlobShadow = true;
    sprite.shadow.visible = false;
    sprite.object.visible = false;
    ghosts[kind] = sprite;
  }
  return {
    show(ghost) {
      for (const [kind, sprite] of Object.entries(ghosts)) {
        const visible = ghost !== null && ghost.kind === kind;
        sprite.object.visible = visible;
        if (visible) placeOnCell(sprite, ghost.x, ghost.y);
      }
    },
  };
}
