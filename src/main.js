import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from './config.js';
import { CHARACTERS } from './logic/characters.js';
import { createBroadcastTransport } from './net/transport.js';
import { loadAssets } from './render/assets.js';
import { drawGameScreen, drawMenuScreen, setAssets } from './render/game-renderer.js';
import { GAME, GAME_OVER, createApp } from './ui/app.js';
import { attachGameInput, hitTest } from './ui/input.js';
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

if (params.get('local') === '1') {
  startLocalMode();
} else {
  startOnlineMode();
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

  const frame = () => {
    const screen = app.getScreen();
    const game = app.getGame();
    if ((screen === GAME || screen === GAME_OVER) && game) {
      const view = game.getView();
      canvas.style.cursor = screen === GAME && view.pointer ? 'pointer' : 'default';
      const you = CHARACTERS[app.getView().character]?.name;
      drawGameScreen(ctx, { ...view, hint: `Room ${view.code}  |  You play ${you} (${view.you})` });
    } else {
      canvas.style.cursor = 'default';
      drawMenuScreen(ctx);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Dev mode: one window plays both sides, skills included.
function startLocalMode() {
  const game = createLocalGame();

  attachGameInput(canvas, {
    onHover: (point) => {
      const hit = point ? hitTest(point.px, point.py) : null;
      game.setHover(hit?.cell ?? null);
      game.setHoverSkill(hit?.skill ?? null);
    },
    onClick: ({ px, py }) => {
      const hit = hitTest(px, py);
      if (hit?.skill) game.clickSkill(hit.skill.player, hit.skill.skillId);
      else if (hit?.cell) game.click(hit.cell);
    },
    onCancel: () => game.cancel(),
    onRestart: () => game.restart(),
  });

  const frame = () => {
    const view = game.getView();
    canvas.style.cursor = view.pointer ? 'pointer' : 'default';
    drawGameScreen(ctx, { ...view, hint: 'LOCAL MODE: one window plays both sides. Esc or right click cancels a skill. R restarts.' });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
