import { INTERNAL_WIDTH, INTERNAL_HEIGHT, RESUME_GAP_MS } from './config.js';
import { CHARACTERS } from './logic/characters.js';
import { createBroadcastTransport } from './net/transport.js';
import { loadAssets } from './render/assets.js';
import { createEffects } from './render/effects.js';
import { drawGameScreen, drawMenuScreen, setAssets } from './render/game-renderer.js';
import { createResumeWatch } from './render3d/frame-gap.js';
import { QUALITY_LEVELS } from './render3d/quality.js';
import { loadV3Meta } from './render3d/v3-meta.js';
import { GAME, GAME_OVER, createApp } from './ui/app.js';
import { attachGameInput, hitTest, isQualityKey } from './ui/input.js';
import { createLocalGame } from './ui/local-game.js';
import { attachScreens } from './ui/screens.js';

const canvas = document.getElementById('game');
canvas.width = INTERNAL_WIDTH;
canvas.height = INTERNAL_HEIGHT;

const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// The 2D renderer and HUD draw placeholders until the art from
// assets/manifest.json has loaded, and for good for any file that is
// missing. The 3D world waits for the art before it is built.
const warn = (message) => console.warn(message);
const assetsLoaded = loadAssets({ warn });
assetsLoaded.then(setAssets);
const metaLoaded = loadV3Meta({ warn });

const params = new URLSearchParams(window.location.search);

// The 2D renderer. The 3D one (src/render3d/world-renderer.js) has the same
// interface and draws the world on the WebGL canvas under this one.
const RENDERER_2D = { drawGameScreen, drawMenuScreen, hitTest };
const stage = document.getElementById('stage');
const worldCanvas = document.getElementById('world');

// Hidden pages get no animation frames, so events from an online opponent
// pile up meanwhile; this tells the first frame back (see showEvents).
const resumeWatch = createResumeWatch(RESUME_GAP_MS);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) resumeWatch.markHidden();
});

// Each window has its own renderer, WebGL context and quality level; Q
// changes only the window it is pressed in.
const renderer = params.get('render') === '2d' ? RENDERER_2D : await load3dRenderer();

if (params.get('local') === '1') {
  startLocalMode();
} else {
  startOnlineMode();
}

// The 3D renderer, or the 2D one if WebGL or the 3D code fails to load.
// Three.js loads only when the 3D renderer is used.
async function load3dRenderer() {
  try {
    worldCanvas.hidden = false; // it must be laid out before the renderer sizes it
    const [{ createWorldRenderer }, assets, meta] = await Promise.all([
      import('./render3d/world-renderer.js'), assetsLoaded, metaLoaded,
    ]);
    return createWorldRenderer(worldCanvas, { assets, meta, warn });
  } catch (err) {
    console.warn('The 3D renderer is not available, using the 2D one.', err);
    worldCanvas.hidden = true;
    return RENDERER_2D;
  }
}

// The Q key cycles this window's 3D quality level.
function attachQualityKey() {
  if (!renderer.cycleQuality) return;
  window.addEventListener('keydown', (event) => {
    if (!event.repeat && isQualityKey(event)) renderer.cycleQuality();
  });
}

// Hands the events of applied actions to the effects. On the first frame
// after the page was hidden they are shown settled (renderer.catchUp)
// rather than replaying every effect and banner at once. effects is the 2D
// placeholder effects, or null for the 3D renderer, which takes the events
// itself.
function showEvents(events, effects, time, resumed) {
  if (resumed) {
    renderer.catchUp?.(events, time);
    return;
  }
  effects?.trigger(events, time);
  renderer.trigger?.(events, time); // the 3D world: pop-ins, character poses and skill visuals
}

// Online rooms over a BroadcastChannel: the lobby and room screens are DOM
// overlays above the canvases, the game is drawn on them. With the 3D
// renderer the world stays on behind the overlays, blurred behind the
// lobby and room screens when this window's quality level allows it.
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
      const hit = point ? renderer.hitTest(point.px, point.py) : null;
      game.setHover(hit?.cell ?? null);
      game.setHoverSkill(hit?.skill ?? null);
    },
    onClick: ({ px, py }) => {
      const game = playing();
      if (!game) return;
      const hit = renderer.hitTest(px, py);
      if (hit?.skill) game.clickSkill(hit.skill.player, hit.skill.skillId);
      else if (hit?.cell) game.click(hit.cell);
    },
    onCancel: () => playing()?.cancel(),
  });
  attachQualityKey();

  const effects = renderer === RENDERER_2D ? createEffects() : null;
  let shownGame = null; // the game the effects and the 3D world belong to
  let blurred = false;

  const forgetGame = () => {
    effects?.clear();
    renderer.reset?.();
  };

  const frame = (time) => {
    const resumed = resumeWatch.tick(time);
    const screen = app.getScreen();
    const game = app.getGame();
    if ((screen === GAME || screen === GAME_OVER) && game) {
      if (game !== shownGame) {
        forgetGame();
        shownGame = game;
      }
      showEvents(game.takeEvents(), effects, time, resumed);
      const view = game.getView();
      canvas.style.cursor = screen === GAME && view.pointer ? 'pointer' : 'default';
      const you = CHARACTERS[app.getView().character]?.name;
      renderer.drawGameScreen(ctx, { ...view, time, effects, hint: `Room ${view.code}  |  You play ${you} (${view.you})` });
    } else {
      if (shownGame) {
        forgetGame();
        shownGame = null;
      }
      canvas.style.cursor = 'default';
      renderer.drawMenuScreen(ctx, time);
    }
    // The Game over screen keeps the final board and the poses in view.
    const blur = screen !== GAME && screen !== GAME_OVER && QUALITY_LEVELS[renderer.quality]?.menuBlur === true;
    if (blur !== blurred) {
      blurred = blur;
      stage.classList.toggle('backdrop-blur', blur);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Dev mode: one window plays both sides, skills included. The 2D
// placeholder effects belong to the 2D renderer only, and the 3D renderer
// takes the events itself.
function startLocalMode() {
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
      renderer.reset?.();
    },
  });
  attachQualityKey();

  const frame = (time) => {
    showEvents(game.takeEvents(), effects, time, resumeWatch.tick(time));
    const view = game.getView();
    canvas.style.cursor = view.pointer ? 'pointer' : 'default';
    renderer.drawGameScreen(ctx, { ...view, time, effects, hint });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
