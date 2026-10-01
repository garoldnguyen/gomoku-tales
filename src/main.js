import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from './config.js';
import { CHARACTERS } from './logic/characters.js';
import { createBroadcastTransport } from './net/transport.js';
import { loadAssets } from './render/assets.js';
import { createEffects } from './render/effects.js';
import { drawGameScreen, drawMenuScreen, setAssets } from './render/game-renderer.js';
import { GAME, GAME_OVER, createApp } from './ui/app.js';
import { attachGameInput, hitTest, isQualityKey } from './ui/input.js';
import { createLocalGame } from './ui/local-game.js';
import { attachScreens } from './ui/screens.js';

const canvas = document.getElementById('game');
canvas.width = INTERNAL_WIDTH;
canvas.height = INTERNAL_HEIGHT;

const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// Placeholders are drawn until the art from assets/manifest.json has loaded,
// and for good for any file that is missing.
loadAssets({ warn: (message) => console.warn(message) }).then(setAssets);

const params = new URLSearchParams(window.location.search);

// The 2D renderer. The 3D one (src/render3d/world-renderer.js) has the same
// interface and draws the world on the WebGL canvas under this one.
const RENDERER_2D = { drawGameScreen, hitTest };
const worldCanvas = document.getElementById('world');

if (params.get('local') === '1') {
  startLocalMode(params.get('render') === '2d' ? RENDERER_2D : await load3dRenderer());
} else {
  startOnlineMode();
}

// The 3D renderer, or the 2D one if WebGL or the 3D code fails to load.
// Three.js loads only when the 3D renderer is used.
async function load3dRenderer() {
  try {
    worldCanvas.hidden = false; // it must be laid out before the renderer sizes it
    const { createWorldRenderer } = await import('./render3d/world-renderer.js');
    return createWorldRenderer(worldCanvas);
  } catch (err) {
    console.warn('The 3D renderer is not available, using the 2D one.', err);
    worldCanvas.hidden = true;
    return RENDERER_2D;
  }
}

// Online rooms over a BroadcastChannel: the lobby and room screens are DOM
// over the canvas, the game is drawn on the canvas.
function startOnlineMode() {
  const app = createApp({ openTransport: (code) => createBroadcastTransport(code) });
  attachScreens(document.getElementById('screens'), app);
  // Tell the opponent at once when this window closes or reloads.
  window.addEventListener('pagehide', () => app.close());

  const playing = () => (app.getScreen() === GAME ? app.getGame() : null);

  attachGameInput(canvas, {
    onHover: (point) => {
      const game = playing();
      if (!game) return;
      const hit = point ? hitTest(point.px, point.py) : null;
      game.setHover(hit?.cell ?? null);
      game.setHoverSkill(hit?.skill ?? null);
    },
    onClick: ({ px, py }) => {
      const game = playing();
      if (!game) return;
      const hit = hitTest(px, py);
      if (hit?.skill) game.clickSkill(hit.skill.player, hit.skill.skillId);
      else if (hit?.cell) game.click(hit.cell);
    },
    onCancel: () => playing()?.cancel(),
  });

  const effects = createEffects();
  let effectsGame = null; // the game the effects belong to

  const frame = (time) => {
    const screen = app.getScreen();
    const game = app.getGame();
    if ((screen === GAME || screen === GAME_OVER) && game) {
      if (game !== effectsGame) {
        effects.clear();
        effectsGame = game;
      }
      effects.trigger(game.takeEvents(), time);
      const view = game.getView();
      canvas.style.cursor = screen === GAME && view.pointer ? 'pointer' : 'default';
      const you = CHARACTERS[app.getView().character]?.name;
      drawGameScreen(ctx, { ...view, time, effects, hint: `Room ${view.code}  |  You play ${you} (${view.you})` });
    } else {
      canvas.style.cursor = 'default';
      drawMenuScreen(ctx, time);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Dev mode: one window plays both sides, skills included. renderer is
// RENDERER_2D or the 3D renderer; the 2D placeholder effects belong to the
// 2D renderer only.
function startLocalMode(renderer) {
  const game = createLocalGame();
  const effects = renderer === RENDERER_2D ? createEffects() : null;
  const hint = renderer === RENDERER_2D
    ? 'LOCAL MODE: one window plays both sides. Esc or right click cancels a skill. R restarts.'
    : 'LOCAL MODE: one window plays both sides. Esc or right click cancels a skill. R restarts. Q quality.';

  attachGameInput(canvas, {
    onHover: (point) => {
      const hit = point ? renderer.hitTest(point.px, point.py) : null;
      game.setHover(hit?.cell ?? null);
      game.setHoverSkill(hit?.skill ?? null);
    },
    onClick: ({ px, py }) => {
      const hit = renderer.hitTest(px, py);
      if (hit?.skill) game.clickSkill(hit.skill.player, hit.skill.skillId);
      else if (hit?.cell) game.click(hit.cell);
    },
    onCancel: () => game.cancel(),
    onRestart: () => {
      game.restart();
      effects?.clear();
    },
  });

  if (renderer.cycleQuality) {
    window.addEventListener('keydown', (event) => {
      if (!event.repeat && isQualityKey(event)) renderer.cycleQuality();
    });
  }

  const frame = (time) => {
    const events = game.takeEvents();
    effects?.trigger(events, time);
    const view = game.getView();
    canvas.style.cursor = view.pointer ? 'pointer' : 'default';
    renderer.drawGameScreen(ctx, { ...view, time, effects, hint });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
