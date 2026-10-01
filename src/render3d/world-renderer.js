// The 3D game renderer (docs/art-direction-hd2d.md sections B, C, D and F).
// It has the same interface as the 2D renderer that src/main.js uses:
//   drawGameScreen(ctx, view)  draws the game view (see ui/local-game.js)
//   hitTest(px, py)            what is under an internal HUD point
// The WebGL canvas shows the world (src/render3d/world.js) with the board's
// stones and rocks as sprites and flat decals for hover, skill targeting,
// announced skills and the winning line. ctx is the transparent 2D canvas
// stacked above it, where the existing 2D HUD code draws the player panels,
// skill buttons, cooldowns, status line and winner text. Board picking is a
// ray from the camera (src/render3d/hit-test.js). The Q key calls
// cycleQuality().

import { INTERNAL_HEIGHT, INTERNAL_WIDTH } from '../config.js';
import { O, ROCK, X } from '../logic/board.js';
import { drawGameHud, drawText } from '../render/game-renderer.js';
import { HUD_3D } from '../render/layout.js';
import { boardMarks } from './board-marks.js';
import { createWorldHitTest } from './hit-test.js';
import { fadedAlphaTest } from './sprite-frames.js';
import { createCellDecal, createPieceSprite, createWorld, decalCanvas, decalMaterial, placeOnCell } from './world.js';

const GHOST_OPACITY = 0.45; // see-through stone or rock where it would go

// Throws if WebGL is not available.
export function createWorldRenderer(worldCanvas) {
  const world = createWorld(worldCanvas);
  const pieces = createPieceLayer(world);
  const decals = createDecalLayer(world);
  const ghosts = createGhosts(world);

  return {
    drawGameScreen(ctx, view) {
      const time = view.time ?? performance.now();
      pieces.sync(view.state.board);
      const marks = boardMarks(view);
      decals.show(marks.decals);
      ghosts.show(marks.ghost);
      world.setHoveredCell(view.hover ?? null);
      world.render(time);

      ctx.clearRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
      drawGameHud(ctx, view, HUD_3D);
      const autoText = world.autoStepped ? ' (auto)' : '';
      drawText(ctx, `Quality ${world.quality}${autoText} [Q]  FPS ${Math.round(world.fps)}`, 8, 12, { size: 11, align: 'left' });
    },

    hitTest: createWorldHitTest(world.cameraSetup, HUD_3D),

    cycleQuality() {
      world.cycleQuality();
    },
  };
}

function pieceKind(cell) {
  if (cell === X || cell === O) return cell;
  if (cell === ROCK) return 'rock';
  return null;
}

// Stone and rock sprites that follow the board. Sprites are reused: a
// removed piece goes back to its kind's pool, hidden.
function createPieceLayer(world) {
  const shownKind = []; // per cell index: 'X', 'O', 'rock' or null
  const shownSprite = [];
  const free = { [X]: [], [O]: [], rock: [] };
  return {
    sync(board) {
      const size = board.length;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          const kind = pieceKind(board[y][x]);
          const current = shownKind[i] ?? null;
          if (current === kind) continue;
          if (current) {
            shownSprite[i].object.visible = false;
            free[current].push(shownSprite[i]);
          }
          shownKind[i] = kind;
          shownSprite[i] = null;
          if (kind) {
            const sprite = free[kind].pop() ?? world.addSprite(createPieceSprite(kind));
            sprite.object.visible = true;
            placeOnCell(sprite, x, y);
            shownSprite[i] = sprite;
          }
        }
      }
    },
  };
}

// Decal looks per kind (see board-marks.js), drawn into 16x16 pixel
// textures like the 2D placeholders. renderOrder keeps overlapping decals
// in a fixed order.
const DECALS = {
  zone: { order: 1, opacity: 1, draw: drawZone },
  zonePreview: { order: 1, opacity: 0.6, draw: drawZone },
  win: { order: 2, opacity: 1, draw: (ctx) => frame(ctx, '#ffe14d', 'rgba(255, 225, 77, 0.25)') },
  dashTarget: { order: 3, opacity: 1, draw: (ctx) => frame(ctx, '#ff2a3a', 'rgba(255, 42, 58, 0.28)') },
  select: { order: 4, opacity: 1, draw: (ctx) => frame(ctx, '#fff27a', null) },
  whirl: { order: 5, opacity: 1, draw: drawWhirl },
};

// Pools of flat cell decals; show() places this frame's decals and hides
// the rest.
function createDecalLayer(world) {
  const pools = {};
  for (const [kind, look] of Object.entries(DECALS)) {
    const source = decalCanvas();
    look.draw(source.getContext('2d'));
    const material = decalMaterial(source);
    material.opacity = look.opacity;
    pools[kind] = { material, order: look.order, meshes: [], used: 0 };
  }
  return {
    show(decals) {
      for (const pool of Object.values(pools)) pool.used = 0;
      for (const { kind, x, y } of decals) {
        const pool = pools[kind];
        if (!pool) continue;
        let mesh = pool.meshes[pool.used];
        if (!mesh) {
          mesh = createCellDecal(pool.material);
          mesh.renderOrder = pool.order;
          world.scene.add(mesh);
          pool.meshes.push(mesh);
        }
        pool.used++;
        mesh.visible = true;
        placeOnCell(mesh, x, y);
      }
      for (const pool of Object.values(pools)) {
        for (let i = pool.used; i < pool.meshes.length; i++) pool.meshes[i].visible = false;
      }
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

// A 2 px frame around the cell, with an optional fill inside.
function frame(ctx, color, fill) {
  const size = ctx.canvas.width;
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, 2);
  ctx.fillRect(0, size - 2, size, 2);
  ctx.fillRect(0, 0, 2, size);
  ctx.fillRect(size - 2, 0, 2, size);
}

// Pale translucent wind over a Tornado Zone cell with a light edge.
function drawZone(ctx) {
  const size = ctx.canvas.width;
  ctx.fillStyle = 'rgba(200, 236, 255, 0.45)';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  for (let i = 0; i < size; i += 4) {
    // A dashed edge, so neighbouring zone cells read as one area.
    ctx.fillRect(i, 0, 2, 1);
    ctx.fillRect(i + 2, size - 1, 2, 1);
    ctx.fillRect(0, i + 2, 1, 2);
    ctx.fillRect(size - 1, i, 1, 2);
  }
}

// Three pale blue arcs around the cell centre, set pixel by pixel.
function drawWhirl(ctx) {
  const size = ctx.canvas.width;
  const c = (size - 1) / 2;
  ctx.fillStyle = '#bfe8ff';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c);
      const angle = (Math.atan2(y - c, x - c) + Math.PI * 2) % ((Math.PI * 2) / 3);
      if (r >= 6 && r < 7.6 && angle < Math.PI / 2) ctx.fillRect(x, y, 1, 1);
    }
  }
}
