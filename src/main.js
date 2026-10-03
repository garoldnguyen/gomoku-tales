import { INTERNAL_WIDTH, INTERNAL_HEIGHT, RESUME_GAP_MS, SHOT_EFFECTS_SEED, SHOT_READY_FRAMES, SHOT_SEED, SHOT_TIME_MS } from './config.js';
import { O, X } from './logic/board.js';
import { CHARACTERS } from './logic/characters.js';
import { createBroadcastTransport } from './net/transport.js';
import { loadAssets, USES_3D } from './render/assets.js';
import { createEffects } from './render/effects.js';
import { drawGameScreen, drawMenuScreen, setAssets } from './render/game-renderer.js';
import { createResumeWatch } from './render3d/frame-gap.js';
import { blursMenus, browserStorage, cycleQuality, startQuality } from './render3d/quality.js';
import { seededRandom } from './render3d/seeded-random.js';
import { loadV3Meta } from './render3d/v3-meta.js';
import { GAME, GAME_OVER, createApp } from './ui/app.js';
import { createHud } from './ui/hud.js';
import { hudViewModel } from './ui/hud-view.js';
import { attachGameInput, hitTest, isQualityKey } from './ui/input.js';
import { createLocalGame } from './ui/local-game.js';
import { attachScreens } from './ui/screens.js';
import { parseShotParams, setUpShotScene } from './ui/shot-mode.js';

const canvas = document.getElementById('game');
canvas.width = INTERNAL_WIDTH;
canvas.height = INTERNAL_HEIGHT;

const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const params = new URLSearchParams(window.location.search);
const wants2d = params.get('render') === '2d';

// Shot mode (?shot=<scene>&quality=<level>, docs/shots.md section 4) is
// for the screenshot self-check (tools/shots.sh): a fixed scene of a local
// game, frozen at SHOT_TIME_MS, with no input, storage, network or FPS
// line. Without the shot parameter it is null and none of it runs.
const shot = parseShotParams(params);
if (shot) {
  window.__SHOT__ = { scene: shot.scene, quality: shot.quality, renderer: wants2d ? '2d' : '3d', ready: false, info: {} };
}

// The 2D renderer and HUD draw placeholders until the art from
// assets/manifest.json has loaded, and for good for any file that is
// missing. The 3D world waits for the art before it is built. The 3D game
// loads only the art it draws (USES_3D), so the 2D art that is still a
// placeholder is never requested; load3dRenderer loads the rest if it has
// to fall back to the 2D renderer.
const warn = (message) => console.warn(message);
const assetsLoaded = loadAssets({ warn, uses: wants2d ? null : USES_3D });
assetsLoaded.then(setAssets);
const metaLoaded = loadV3Meta({ warn });

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
// changes only the window it is pressed in. ?quality=low|medium|high picks
// the level (unknown values are medium) and saves it; otherwise the saved
// choice is used, else medium. The game works without storage.
// Shot mode neither reads nor saves the stored choice.
const storage = shot ? null : browserStorage();
const quality = startQuality(shot ? shot.quality : params.get('quality'), storage);
const renderer = wants2d ? RENDERER_2D : await load3dRenderer();
if (shot) window.__SHOT__.renderer = renderer === RENDERER_2D ? '2d' : '3d';
// The element that takes the pointer: the 2D canvas, or the full window
// WebGL canvas, whose drawing buffer pixels renderer.hitTest reads.
const pointerCanvas = renderer === RENDERER_2D ? canvas : worldCanvas;

// The 3D game's HUD is the DOM glass overlay (src/ui/hud.js); the 2D
// renderer draws its own panels on the canvas. The game modes set the
// handlers below.
const hudHandlers = { onSkill: () => {}, onCancel: () => {} };
const hud = renderer === RENDERER_2D ? null : createHud(document.getElementById('hud'), {
  onSkill: (player, skillId) => hudHandlers.onSkill(player, skillId),
  onQuality: (level) => setQuality(level),
  onCancel: () => hudHandlers.onCancel(),
});
assetsLoaded.then((store) => hud?.setAssets(store));

if (shot) {
  startShotMode(shot);
} else if (params.get('local') === '1') {
  startLocalMode();
} else {
  startOnlineMode();
}

// The 3D renderer, or the 2D one if WebGL or the 3D code fails to load.
// Three.js loads only when the 3D renderer is used.
async function load3dRenderer() {
  try {
    // The 3D game fills the whole window (index.html body.world-3d). The
    // canvas must be laid out before the renderer sizes it.
    document.body.classList.add('world-3d');
    worldCanvas.hidden = false;
    const [{ createWorldRenderer }, assets, meta] = await Promise.all([
      import('./render3d/world-renderer.js'), assetsLoaded, metaLoaded,
    ]);
    const world = createWorldRenderer(worldCanvas, { assets, meta, warn, storage, quality: quality.level, showQualityLine: !shot });
    if (quality.fromUrl) world.setQuality(quality.level);
    return world;
  } catch (err) {
    console.warn('The 3D renderer is not available, using the 2D one.', err);
    worldCanvas.hidden = true;
    document.body.classList.remove('world-3d'); // back to the 16:9 stage of the 2D renderer
    await assetsLoaded; // so the full store below is the one the 2D renderer keeps
    loadAssets({ warn }).then(setAssets);
    return RENDERER_2D;
  }
}

// A quality level chosen by hand (the Q key or the HUD switch): the
// renderer's setQuality, and the HUD glass follows it.
function setQuality(level) {
  if (!renderer.setQuality) return;
  renderer.setQuality(level);
  hud?.setQuality(renderer.quality);
}

// The Q key steps this window's 3D quality level (high, medium, low and
// round again) through setQuality.
function attachQualityKey() {
  if (!renderer.setQuality) return;
  window.addEventListener('keydown', (event) => {
    if (!event.repeat && isQualityKey(event)) setQuality(cycleQuality(renderer.quality));
  });
}

// Shows a game on the HUD. localPlayer is this window's stone online, or
// null in local mode. The automatic step down changes the level without
// setQuality, so the level is checked every frame. hud.render depends only
// on the model, so the model is rebuilt only when something in it changed:
// hudInputs is the last one, rewritten in place, so a frame with nothing new
// makes nothing.
const hudInputs = {
  state: null, targeting: null, status: null, message: null, peerCountdown: null, winner: null, quality: null, hint: null,
};
let hudPlayer = null;
let hudShown = false;
function showHud(game, view, localPlayer, winner, hint) {
  const targeting = game.getTargeting();
  const peerCountdown = view.peerCountdown ?? null;
  const quality = renderer.quality;
  if (hudShown && hudInputs.state === view.state && hudInputs.targeting === targeting && hudInputs.status === view.status
    && hudInputs.message === view.message && hudInputs.peerCountdown === peerCountdown && hudInputs.winner === winner
    && hudInputs.quality === quality && hudInputs.hint === hint && hudPlayer === localPlayer) return;
  hudShown = true;
  hudPlayer = localPlayer;
  hudInputs.state = view.state;
  hudInputs.targeting = targeting;
  hudInputs.status = view.status;
  hudInputs.message = view.message;
  hudInputs.peerCountdown = peerCountdown;
  hudInputs.winner = winner;
  hudInputs.quality = quality;
  hudInputs.hint = hint;
  hud.render(hudViewModel(view.state, hudInputs, localPlayer));
}

// The game view with this frame's time, effects and hint, for the
// renderer: one object, rewritten every frame (a mode's views always have
// the same keys), so the render loop does not copy the view into a new one.
const frameView = {};
function frameViewOf(view, time, effects, hint) {
  for (const key in view) frameView[key] = view[key];
  frameView.time = time;
  frameView.effects = effects;
  frameView.hint = hint;
  return frameView;
}

// The online game's hint line, e.g. "Room ABCD  |  You play Wind Rabbit (X)".
function roomHint(code, name, stone) {
  return `Room ${code}  |  You play ${name} (${stone})`;
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
// lobby and room screens when this window's quality level has frosted
// HUD glass (hudFrost in src/render3d/quality.js).
function startOnlineMode() {
  const app = createApp({ openTransport: (code) => createBroadcastTransport(code) });
  attachScreens(document.getElementById('screens'), app);
  // Tell the opponent at once when this window closes or reloads.
  window.addEventListener('pagehide', () => app.close());

  const playing = () => (app.getScreen() === GAME ? app.getGame() : null);

  attachGameInput(pointerCanvas, {
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
  hudHandlers.onSkill = (player, skillId) => playing()?.clickSkill(player, skillId);
  hudHandlers.onCancel = () => playing()?.cancel();
  attachQualityKey();

  const effects = renderer === RENDERER_2D ? createEffects() : null;
  let shownGame = null; // the game the effects and the 3D world belong to
  let blurred = false;
  // The hint line, made again only when the room or seat changes.
  let hint = '';
  let hintCode = null;
  let hintStone = null;

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
        hintCode = null; // a new game may be a new character
      }
      showEvents(game.takeEvents(), effects, time, resumed);
      const view = game.getView();
      pointerCanvas.style.cursor = screen === GAME && view.pointer ? 'pointer' : 'default';
      if (view.code !== hintCode || view.you !== hintStone) {
        hintCode = view.code;
        hintStone = view.you;
        hint = roomHint(view.code, CHARACTERS[app.getView().character]?.name, view.you);
      }
      renderer.drawGameScreen(ctx, frameViewOf(view, time, effects, hint));
      if (hud) {
        showHud(game, view, view.you, game.getOutcome()?.winner ?? null, hint);
        hud.show(true);
      }
    } else {
      if (shownGame) {
        forgetGame();
        shownGame = null;
      }
      pointerCanvas.style.cursor = 'default';
      renderer.drawMenuScreen(ctx, time);
      hud?.show(false);
    }
    // The Game over screen keeps the final board and the poses in view.
    const blur = screen !== GAME && screen !== GAME_OVER && blursMenus(renderer.features);
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

  attachGameInput(pointerCanvas, {
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
  hudHandlers.onSkill = (player, skillId) => game.clickSkill(player, skillId);
  hudHandlers.onCancel = () => game.cancel();
  hud?.show(true);
  attachQualityKey();

  const frame = (time) => {
    showEvents(game.takeEvents(), effects, time, resumeWatch.tick(time));
    const view = game.getView();
    pointerCanvas.style.cursor = view.pointer ? 'pointer' : 'default';
    renderer.drawGameScreen(ctx, frameViewOf(view, time, effects, hint));
    if (hud) showHud(game, view, null, null, hint);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Shot mode (docs/shots.md section 4): the scene is played on a local game
// with a seeded random source (the 2D sparkles and dust are seeded too),
// the growing plants and the last move are staged as planted at fixed
// times before SHOT_TIME_MS, and every frame is drawn at SHOT_TIME_MS, so
// two pictures are the same. No input is attached, so there is no hover.
// window.__SHOT__.ready turns true once the art and the HUD images are
// loaded and SHOT_READY_FRAMES frames were drawn at the current window size.
async function startShotMode({ scene }) {
  const game = createLocalGame({ random: seededRandom(SHOT_SEED) });
  const staged = setUpShotScene(game, scene);
  const effects = renderer === RENDERER_2D ? createEffects({ random: seededRandom(SHOT_EFFECTS_SEED) }) : null;
  const planted = ({ x, y, player }) => [{ type: 'stonePlaced', player, x, y }];
  for (const plant of staged.growing) showEvents(planted(plant), effects, SHOT_TIME_MS - plant.ageMs, false);
  if (staged.last) showEvents(planted(staged.last), effects, SHOT_TIME_MS - staged.last.ageMs, false);
  hud?.show(true);

  await assetsLoaded;
  await Promise.all(Array.from(document.images, (img) => (img.src ? img.decode().catch(() => {}) : null)));

  const state = window.__SHOT__;
  const { board, rocks, turn } = game.getState();
  state.info.stones = board.flat().filter((cell) => cell === X || cell === O).length;
  state.info.rocks = rocks.length;
  state.info.turn = turn;
  state.info.timeMs = SHOT_TIME_MS;
  let width = -1;
  let height = -1;
  let drawn = 0;
  const frame = () => {
    if (window.innerWidth !== width || window.innerHeight !== height) {
      width = window.innerWidth;
      height = window.innerHeight;
      drawn = 0;
    }
    const view = game.getView();
    renderer.drawGameScreen(ctx, frameViewOf(view, SHOT_TIME_MS, effects, null));
    if (hud) showHud(game, view, null, null, null);
    drawn++;
    state.ready = drawn >= SHOT_READY_FRAMES;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
