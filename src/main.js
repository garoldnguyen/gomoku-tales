import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from './config.js';
import { drawGameScreen, drawTitleScreen } from './render/game-renderer.js';
import { attachGameInput, hitTest } from './ui/input.js';
import { createLocalGame } from './ui/local-game.js';

const canvas = document.getElementById('game');
canvas.width = INTERNAL_WIDTH;
canvas.height = INTERNAL_HEIGHT;

const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const params = new URLSearchParams(window.location.search);

if (params.get('local') === '1') {
  startLocalMode();
} else {
  // Online rooms and the lobby come in a later version of this page.
  drawTitleScreen(ctx, ['Online rooms are not ready yet.', 'Open this page with ?local=1 to play both sides in one window.']);
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
