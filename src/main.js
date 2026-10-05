import { INTERNAL_WIDTH, INTERNAL_HEIGHT, RESUME_GAP_MS, SHOT_EFFECTS_SEED, SHOT_READY_FRAMES, SHOT_SEED, SHOT_TIME_MS } from './config.js';
import { O, X } from './logic/board.js';
import { CHARACTERS } from './logic/characters.js';
import { loadAssets, USES_3D } from './render/assets.js';
import { loadCanvasFont } from './render/canvas-font.js';
import { createEffects } from './render/effects.js';
import { drawGameScreen, drawMenuScreen, setAssets } from './render/game-renderer.js';
import { createResumeWatch } from './render3d/frame-gap.js';
import { blursMenus, browserStorage, cycleQuality, startQuality } from './render3d/quality.js';
import { seededRandom } from './render3d/seeded-random.js';
import { loadForestMeta, withForestMeta } from './render3d/forest-meta.js';
import { loadV3Meta } from './render3d/v3-meta.js';
import { GAME, GAME_OVER, MENU, SELECT, WAITING_SCREEN, WATCH, createApp } from './ui/app.js';
import { MODES, SCREENS } from './ui/flow.js';
import {
  fullscreenActive, fullscreenSupported, fullscreenViewModel, isFullscreenKey, onFullscreenChange, toggleFullscreen,
} from './ui/fullscreen.js';
import { createHud } from './ui/hud.js';
import { isCollapseKey, startCollapsed, toggleAll, withCollapsed, writeCollapsed } from './ui/hud-collapse.js';
import { SPECTATOR_VIEW, hudViewModel } from './ui/hud-view.js';
import { attachGameInput, hitTest, isQualityKey, shortcutKeyHandler } from './ui/input.js';
import { createLocalGame } from './ui/local-game.js';
import { watchNewGame } from './ui/new-game-watch.js';
import { menuViewModel } from './ui/menu.js';
import { createMenu } from './ui/menu-dom.js';
import { attachScreens } from './ui/screens.js';
import {
  parseShotParams, setUpShotScene, SHOT_GAME_OVER, shotFlow, shotGameOverView, shotRoomView, shotWatchView, stillRoomApp,
} from './ui/shot-mode.js';

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
// Canvas text (the Quality and FPS labels, the banners) waits for Nunito.
const canvasFontLoaded = loadCanvasFont();
// The v3 tuning data with the forest's (assets/forest-meta.json) added.
const metaLoaded = Promise.all([loadV3Meta({ warn }), loadForestMeta({ warn })])
  .then(([v3Meta, forestMeta]) => withForestMeta(v3Meta, forestMeta));

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
await canvasFontLoaded;
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
  onCollapse: (player) => setCollapsed(withCollapsed(hudCollapsed, player, !hudCollapsed[player])),
  onFullscreen: () => toggleFullscreen(document),
});
assetsLoaded.then((store) => hud?.setAssets(store));

// Which HUD cards are folded into pills (docs/art-direction-v3-1.md section
// 4.1): saved per team, all expanded at first. Shot mode takes ?hud= and
// neither reads nor saves the stored choice (storage is null there).
let hudCollapsed = startCollapsed(storage, shot?.hud ?? null);
function setCollapsed(next) {
  for (const player of [X, O]) {
    if (next[player] !== hudCollapsed[player]) writeCollapsed(storage, player, next[player]);
  }
  hudCollapsed = next;
}
// The C key folds or unfolds both cards; not in the slim layouts, where
// the cards never fold, and not in shot mode (no input there).
if (hud && !shot) {
  window.addEventListener('keydown', shortcutKeyHandler((event) => {
    if (isCollapseKey(event) && hud.canCollapse()) setCollapsed(toggleAll(hudCollapsed));
  }));
}

// The Fullscreen button (docs/art-direction-v3-1.md section 3.5): hidden
// without the Fullscreen API; its label follows the real state, so it is
// right after Escape or F11. The F key toggles it (not in shot mode).
if (hud) {
  const supported = fullscreenSupported(document);
  const showFullscreen = () => hud.setFullscreen(fullscreenViewModel({ supported, active: fullscreenActive(document) }));
  showFullscreen();
  if (supported) {
    onFullscreenChange(document, showFullscreen);
    if (!shot) {
      window.addEventListener('keydown', shortcutKeyHandler((event) => {
        if (!isFullscreenKey(event)) return;
        event.preventDefault();
        toggleFullscreen(document);
      }));
    }
  }
}

// The menu layer (see showMenu below). menuFlow is the flow state last
// drawn, menuQuality the level it was drawn with (the automatic step down
// changes the level without setQuality, so the frame loop checks it).
let menu = null;
let menuFlow = null;
let menuQuality = null;
const canFullscreen = fullscreenSupported(document);
let qualityKeyAttached = false;

if (shot) {
  startShotMode(shot);
} else {
  startAppMode({ local: params.get('local') === '1' });
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

// A quality level chosen by hand (the Q key, the HUD switch or Settings):
// the renderer's setQuality (which applies it at once and saves it), and
// the HUD glass and the menu follow it.
function setQuality(level) {
  if (!renderer.setQuality) return;
  renderer.setQuality(level);
  hud?.setQuality(renderer.quality);
  if (menuFlow) showMenu(menuFlow);
}

// The main menu, How to Play and Settings (src/ui/menu-dom.js), drawn from
// menuViewModel for a flow state (src/ui/flow.js). There is none on the
// ?local=1 page (the state is declared above the mode start).
function showMenu(flow) {
  menuFlow = flow;
  menuQuality = renderer.quality ?? null;
  menu.setFrost(renderer.features?.hudFrost ?? null);
  menu.render(menuViewModel(flow, {
    quality: renderer.setQuality ? renderer.quality : null,
    fullscreen: { supported: canFullscreen, active: fullscreenActive(document) },
  }));
}
function createMenuLayer(onEvent) {
  menu = createMenu(document.getElementById('flow'), {
    onEvent,
    onQuality: (level) => setQuality(level),
    onFullscreen: () => toggleFullscreen(document),
  });
  assetsLoaded.then((store) => menu.setAssets(store));
  if (canFullscreen) onFullscreenChange(document, () => menuFlow && showMenu(menuFlow));
}
// True while the menu screen is shown; redraws it when the level changed.
// The character select screens (the room's and the local one) fill the
// window with their own title, so the canvas title stays off under them.
const PICKING_SCREENS = Object.freeze([WAITING_SCREEN, SELECT]);

function menuShown() {
  if (menuFlow?.screen !== SCREENS.MENU) return false;
  if ((renderer.quality ?? null) !== menuQuality) showMenu(menuFlow);
  return true;
}

// The Q key steps this window's 3D quality level (high, medium, low and
// round again) through setQuality. Attached once per page
// (qualityKeyAttached is declared above the mode start).
function attachQualityKey() {
  if (!renderer.setQuality || qualityKeyAttached) return;
  qualityKeyAttached = true;
  window.addEventListener('keydown', shortcutKeyHandler((event) => {
    if (!event.repeat && isQualityKey(event)) setQuality(cycleQuality(renderer.quality));
  }));
}

// Shows a game on the HUD. localPlayer is this window's stone online, or
// null in local mode. The automatic step down changes the level without
// setQuality, so the level is checked every frame. hud.render depends only
// on the model, so the model is rebuilt only when something in it changed:
// hudInputs is the last one, rewritten in place, so a frame with nothing new
// makes nothing.
const hudInputs = {
  state: null, targeting: null, status: null, message: null, peerCountdown: null, winner: null, quality: null, hint: null,
  collapsed: null,
};
let hudPlayer = null;
let hudShown = false;
function showHud(game, view, localPlayer, winner, hint) {
  const targeting = game.getTargeting();
  const peerCountdown = view.peerCountdown ?? null;
  const quality = renderer.quality;
  if (hudShown && hudInputs.state === view.state && hudInputs.targeting === targeting && hudInputs.status === view.status
    && hudInputs.message === view.message && hudInputs.peerCountdown === peerCountdown && hudInputs.winner === winner
    && hudInputs.quality === quality && hudInputs.hint === hint && hudInputs.collapsed === hudCollapsed
    && hudPlayer === localPlayer) return;
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
  hudInputs.collapsed = hudCollapsed;
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

// The online game's hint line, e.g. "Room ABCD  |  You play Wind Rabbit (X)",
// or "Room ABCD  |  Watching" for a spectator.
function roomHint(code, name, stone) {
  return stone ? `Room ${code}  |  You play ${name} (${stone})` : `Room ${code}  |  Watching`;
}

// Hands the events of applied actions to the effects. On the first frame
// after the page was hidden they are shown settled (renderer.catchUp)
// rather than replaying every effect and banner at once. effects is the 2D
// placeholder effects, or null for the 3D renderer, which takes the events
// itself.
// characters are the sides of the game the events come from, for the
// placement effect of each seed.
function showEvents(events, effects, time, resumed, characters) {
  if (resumed) {
    renderer.catchUp?.(events, time);
    return;
  }
  effects?.trigger(events, time);
  renderer.trigger?.(events, time, characters); // the 3D world: pop-ins, character poses and skill visuals
}

// The app (src/ui/app.js): online rooms over the transport of
// chooseTransport (a BroadcastChannel or the relay server) and the
// local game (Play on this computer, or the ?local=1 page, which starts on
// it). The lobby, room and game over screens are DOM overlays above the
// canvases, the game is drawn on them. With the 3D renderer the world stays
// on behind the overlays, blurred behind the lobby and room screens when
// this window's quality level has frosted HUD glass (hudFrost in
// src/render3d/quality.js). Every new game (a start, a rematch, a local
// restart) clears the old game's visuals (watchNewGame).
function startAppMode({ local = false } = {}) {
  const app = createApp({ local });
  const screens = attachScreens(document.getElementById('screens'), app);
  assetsLoaded.then((store) => screens.setAssets(store));
  createMenuLayer((type) => app.menuEvent(type));
  // data-screen on the body names the flow screen (menu, lobby, waiting,
  // starting, game, gameover) for the end to end check (tools/flow_e2e.py).
  const showFlow = () => {
    document.body.dataset.screen = app.getFlow().screen;
    showMenu(app.getFlow());
  };
  app.onChange(showFlow);
  showFlow();
  // Tell the opponent at once when this window closes or reloads.
  window.addEventListener('pagehide', () => app.close());

  // Only the Game screen takes input: a spectator's game (WATCH) is drawn
  // the same way but never gets a hover, a click or a skill.
  const playing = () => (app.getScreen() === GAME ? app.getGame() : null);

  attachGameInput(pointerCanvas, {
    onHover: (point) => {
      const game = playing();
      if (!game) return;
      const hit = point ? renderer.hitTest(point.px, point.py, game.getView().state.characters) : null;
      game.setHover(hit?.cell ?? null);
      game.setHoverSkill(hit?.skill ?? null);
    },
    onClick: ({ px, py }) => {
      const game = playing();
      if (!game) return;
      const hit = renderer.hitTest(px, py, game.getView().state.characters);
      if (hit?.skill) game.clickSkill(hit.skill.player, hit.skill.skillId);
      else if (hit?.cell) game.click(hit.cell);
    },
    onCancel: () => playing()?.cancel(),
    onRestart: () => app.restartLocal(), // local mode only
  });
  hudHandlers.onSkill = (player, skillId) => playing()?.clickSkill(player, skillId);
  hudHandlers.onCancel = () => playing()?.cancel();
  attachQualityKey();

  const effects = renderer === RENDERER_2D ? createEffects() : null;
  const newGame = watchNewGame(() => {
    effects?.clear();
    renderer.reset?.();
  });
  let blurred = false;
  // The hint line, made again only when the room or seat changes.
  let hint = '';
  let hintCode = null;
  let hintStone = null;
  const localHint = renderer === RENDERER_2D
    ? 'LOCAL MODE: one window plays both sides. Esc or right click cancels a skill. R restarts.'
    : 'LOCAL MODE: one window plays both sides. Esc or right click cancels a skill. R restarts. Q quality.';

  const frame = (time) => {
    const resumed = resumeWatch.tick(time);
    const screen = app.getScreen();
    const game = app.getGame();
    const inGame = (screen === GAME || screen === GAME_OVER || screen === WATCH) && game !== null;
    if (newGame.check(inGame ? game : null, app.getGameNumber())) hintCode = null; // a new game may be a new character
    if (inGame) {
      const view = game.getView();
      showEvents(game.takeEvents(), effects, time, resumed, view.state.characters);
      pointerCanvas.style.cursor = screen === GAME && view.pointer ? 'pointer' : 'default';
      const local = app.getFlow().mode === MODES.LOCAL;
      const you = local ? null : view.you ?? SPECTATOR_VIEW;
      if (local) {
        hint = localHint;
      } else if (view.code !== hintCode || view.you !== hintStone) {
        hintCode = view.code;
        hintStone = view.you;
        hint = roomHint(view.code, CHARACTERS[app.getView().character]?.name, view.you);
      }
      renderer.drawGameScreen(ctx, frameViewOf(view, time, effects, hint));
      if (hud) {
        showHud(game, view, you, game.getOutcome()?.winner ?? null, hint);
        hud.show(true);
      }
    } else {
      pointerCanvas.style.cursor = 'default';
      // The DOM menu and the character select have their own title.
      renderer.drawMenuScreen(ctx, time, !menuShown() && !PICKING_SCREENS.includes(screen));
      hud?.show(false);
    }
    // The Game over screen keeps the final board and the poses in view,
    // and the menu the empty farm. The character select keeps the map
    // sharp around its see-through panel, which frosts what is behind it
    // itself (screens.setFrosted, room.css).
    const frosted = blursMenus(renderer.features);
    const blur = screen !== GAME && screen !== GAME_OVER && screen !== WATCH && screen !== MENU && !PICKING_SCREENS.includes(screen) && frosted;
    if (blur !== blurred) {
      blurred = blur;
      stage.classList.toggle('backdrop-blur', blur);
    }
    screens.setFrosted(frosted);
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
  // The menu, howto and settings scenes show the menu layer over the empty
  // farm, with no HUD, like the menu screen of the game; the lobby, waiting
  // and starting scenes show the lobby and room screens from a still view
  // (no network). The farm stays sharp: the game's backdrop blur zooms the
  // canvas past the window edges, which the window check counts as a gap.
  // The gameover scenes show the game over card from a still view over the
  // field scene, with the HUD of the online viewer whose Wind Rabbit won
  // (no skill selected: the game is over). The spectate-game scene shows
  // the watch card over the field scene, with the HUD of a spectator (no
  // skill selected: a spectator has no input).
  const flow = shotFlow(scene);
  const roomView = shotRoomView(scene);
  const overView = shotGameOverView(scene);
  const watchView = shotWatchView(scene, game.getState());
  if (overView || watchView) game.cancel();
  const hudPlayer = overView ? SHOT_GAME_OVER.you : watchView ? SPECTATOR_VIEW : null;
  const hudWinner = overView ? SHOT_GAME_OVER.winner : null;
  let shotScreens = null;
  if (roomView || overView || watchView) {
    shotScreens = attachScreens(document.getElementById('screens'), stillRoomApp(roomView ?? overView ?? watchView));
    assetsLoaded.then((store) => shotScreens.setAssets(store));
  } else if (flow) {
    createMenuLayer(() => {});
    showMenu(flow);
  }
  const effects = renderer === RENDERER_2D ? createEffects({ random: seededRandom(SHOT_EFFECTS_SEED) }) : null;
  const planted = ({ x, y, player }) => [{ type: 'stonePlaced', player, x, y }];
  const shotSides = game.getView().state.characters;
  for (const plant of staged.growing) showEvents(planted(plant), effects, SHOT_TIME_MS - plant.ageMs, false, shotSides);
  if (staged.last) showEvents(planted(staged.last), effects, SHOT_TIME_MS - staged.last.ageMs, false, shotSides);
  hud?.show(!flow);

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
    if (flow) {
      renderer.drawMenuScreen(ctx, SHOT_TIME_MS, roomView !== null && !PICKING_SCREENS.includes(roomView.screen));
    } else {
      const view = game.getView();
      renderer.drawGameScreen(ctx, frameViewOf(view, SHOT_TIME_MS, effects, null));
      if (overView) view.status = null; // the turn pill reads the winner, as at the end of a game
      if (hud) showHud(game, view, hudPlayer, hudWinner, null);
    }
    shotScreens?.setFrosted(blursMenus(renderer.features));
    drawn++;
    state.ready = drawn >= SHOT_READY_FRAMES;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
