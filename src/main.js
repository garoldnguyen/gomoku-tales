import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from './config.js';
import { drawGameScreen, drawTitleScreen } from './render/game-renderer.js';
import { attachBoardInput } from './ui/input.js';
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

// Dev mode: one window plays both sides with the plain core rules.
function startLocalMode() {
  const game = createLocalGame();

  attachBoardInput(canvas, {
    onHover: (cell) => game.setHover(cell),
    onClick: (cell) => game.click(cell),
    onRestart: () => game.restart(),
  });

  const frame = () => {
    const view = game.getView();
    canvas.style.cursor = view.hover ? 'pointer' : 'default';
    drawGameScreen(ctx, { ...view, hint: 'LOCAL MODE: one window plays both sides. Press R to restart.' });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
