// DOM side of the lobby, room, local character select and game over screens
// (docs/flow-design.md sections 3.4 to 3.7). The markup lives in index.html; this fills in its text from
// strings.js, draws the view models of room-screens.js, wires the buttons
// to the screen flow in app.js and shows the right screen whenever the app
// changes. The Game screen itself is drawn on the canvas, so the overlay
// hides for it. Which screen shows is the flow's decision (flow.js).
//
// app is the app of app.js, or in shot mode a still stand-in with the same
// getView, getScreen and onChange (its actions may be missing).

import { COPY_FEEDBACK_MS } from '../config.js';
import { AVATAR_PX } from '../render3d/art-assets.js';
import { GAME, GAME_OVER, JOIN, SELECT, WAITING_SCREEN } from './app.js';
import { characterStage, copyFeedbackText, portraitScale, copyRoomCode, joinViewModel, lobbyViewModel } from './room-screens.js';
import { STRINGS } from './strings.js';

export function attachScreens(root, app, { clipboard = globalThis.navigator?.clipboard } = {}) {
  const $ = (id) => root.querySelector(`#${id}`);
  const act = (name, ...args) => app[name]?.(...args);
  const sections = [...root.querySelectorAll('[data-screen]')];
  const joinForm = $('join-form');
  const joinInput = $('join-code');
  const joinSubmit = $('join-submit');
  const copyStatus = $('copy-status');
  const roomCode = $('room-code');
  const leave = $('waiting-leave');
  const overRematch = $('over-rematch');
  const overMenu = $('over-menu');
  let shown = null;
  let copyTimer = null;
  let assets = null; // the asset store (render/assets.js), see setAssets
  const warned = new Set(); // portrait keys already warned about

  // The fixed text.
  const lobby = lobbyViewModel();
  $('lobby-lead').textContent = lobby.lead;
  $('lobby-create').textContent = lobby.create.label;
  $('lobby-join').textContent = lobby.join.label;
  $('lobby-hint').textContent = lobby.hint ?? '';
  $('lobby-back').textContent = lobby.back.label;
  $('join-title').textContent = STRINGS.lobbyJoin;
  $('join-label').textContent = STRINGS.lobbyCodeLabel;
  for (const back of root.querySelectorAll('.back-button')) back.textContent = STRINGS.back;
  $('copy-code').textContent = STRINGS.waitingCopy;
  leave.textContent = STRINGS.waitingLeave;

  for (const button of root.querySelectorAll('[data-action]')) {
    button.addEventListener('click', () => act(button.dataset.action));
  }

  // The code box keeps only code characters, in upper case and at most
  // ROOM_CODE_LENGTH of them; typing clears the inline error. Enter
  // submits the form.
  const showJoin = (view) => {
    const vm = joinViewModel({ text: joinInput.value, joining: view.joining, error: view.joinError });
    if (joinInput.value !== vm.value) joinInput.value = vm.value;
    joinInput.disabled = vm.inputDisabled;
    joinSubmit.textContent = vm.joinLabel;
    joinSubmit.disabled = vm.joinDisabled;
    $('join-error').textContent = vm.error ?? '';
    joinInput.setAttribute('aria-invalid', String(vm.error !== null));
  };
  joinInput.addEventListener('input', () => {
    act('clearJoinError');
    showJoin(app.getView());
  });
  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!joinSubmit.disabled) act('joinRoom', joinInput.value);
  });

  const clearCopy = () => {
    clearTimeout(copyTimer);
    copyTimer = null;
    copyStatus.textContent = '';
  };
  $('copy-code').addEventListener('click', async () => {
    const result = await copyRoomCode(roomCode.textContent, clipboard);
    if (result !== 'copied') {
      // Select the code so Ctrl+C copies it.
      const range = document.createRange();
      range.selectNodeContents(roomCode);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    clearTimeout(copyTimer);
    copyStatus.textContent = copyFeedbackText(result);
    copyTimer = setTimeout(clearCopy, COPY_FEEDBACK_MS);
  });
  leave.addEventListener('click', () => act('leaveRoom'));

  // Escape: Back on the lobby and its panels, Leave in the waiting room
  // (only while Leave is enabled) and Back on the local character select.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || root.hidden) return;
    const screen = app.getScreen();
    if (screen === WAITING_SCREEN || screen === SELECT) {
      if (screen === SELECT || !leave.disabled) act('leaveRoom');
    } else if (screen !== GAME_OVER && screen !== GAME) {
      act('back');
    }
  });

  const el = (tag, className, parent) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    parent?.append(node);
    return node;
  };

  // The emblems of the character cards (room-screens.js CHARACTER_LOOKS),
  // drawn in a 100 by 100 box: the blue four-petal cross, the red round
  // bloom and the jade circle with a leaf. Their colours come from room.css.
  const SVG = 'http://www.w3.org/2000/svg';
  const EMBLEMS = {
    cross: [['circle', 'petal', { cx: 50, cy: 28, r: 16 }], ['circle', 'petal', { cx: 50, cy: 72, r: 16 }],
      ['circle', 'petal', { cx: 28, cy: 50, r: 16 }], ['circle', 'petal', { cx: 72, cy: 50, r: 16 }],
      ['circle', 'core', { cx: 50, cy: 50, r: 9 }]],
    bloom: [['circle', 'petal', { cx: 50, cy: 50, r: 34 }], ['circle', 'core', { cx: 50, cy: 50, r: 13 }]],
    leaf: [['circle', 'petal', { cx: 50, cy: 50, r: 36 }],
      ['path', 'core', { d: 'M50 22 C 70 34, 70 66, 50 78 C 34 66, 34 34, 50 22 Z' }]],
  };
  const emblem = (name, parent) => {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('emblem');
    for (const [tag, className, attrs] of EMBLEMS[name]) {
      const shape = document.createElementNS(SVG, tag);
      shape.classList.add(className);
      for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, String(value));
      svg.append(shape);
    }
    parent.append(svg);
  };

  // The stage of a character card (room-screens.js characterStage): the
  // owner's pixel portrait at the whole-number scale of portraitScale
  // (room.css keeps it pixelated), or the emblem while the portrait is
  // missing or fails to load. A missing portrait only warns, once per key.
  const sizePortraits = () => {
    const side = AVATAR_PX * portraitScale(window.innerWidth, window.innerHeight);
    root.style.setProperty('--portrait-px', `${side}px`);
  };
  sizePortraits();
  window.addEventListener('resize', sizePortraits);
  const warnPortrait = (key, why) => {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`Portrait "${key}" ${why}; the character card shows its emblem`);
  };
  const showStage = (card, tile) => {
    emblem(card.emblem, tile);
    const stage = characterStage(card, assets);
    if (stage.kind !== 'portrait') {
      if (assets && card.portrait) warnPortrait(card.portrait, 'is not loaded');
      return;
    }
    const img = el('img', 'portrait', tile);
    img.alt = '';
    img.draggable = false;
    img.addEventListener('error', () => {
      warnPortrait(card.portrait, 'failed to load');
      img.remove();
      tile.classList.remove('has-portrait');
    }, { once: true });
    img.src = stage.src;
    tile.classList.add('has-portrait');
  };

  // Rebuilds a container only when its list changed. The button that had
  // focus keeps it after the rebuild (or, now disabled, the container's
  // first enabled button).
  const built = new Map(); // container -> key
  const rebuild = (container, list, build) => {
    const key = JSON.stringify(list);
    if (built.get(container) === key) return;
    built.set(container, key);
    const focused = container.contains(document.activeElement) ? document.activeElement : null;
    const focusBox = focused?.dataset.hudBox ?? null;
    container.replaceChildren();
    for (const item of list) build(item, container);
    if (focusBox) {
      const again = container.querySelector(`[data-hud-box="${focusBox}"]`);
      (again && !again.disabled ? again : container.querySelector('button:not(:disabled)'))?.focus();
    }
  };

  // The two seats of a character select (room-screens.js
  // characterSelectViewModel seats): the seat's label, its pick with the
  // stone of the pick order and its state (Choosing or Ready), or the
  // dimmed Waiting placeholder of an empty seat. A choosable local seat is
  // a button that makes it the seat the character cards and Ready act for.
  const showSeats = (container, list) => rebuild(container, list, (card, parent) => {
    const node = el(card.choosable ? 'button' : 'div', `seat${card.team ? ` team-${card.team}` : ''}`, parent);
    if (card.choosable) {
      node.type = 'button';
      node.classList.add('is-choosable');
      node.addEventListener('click', () => act('chooseSeat', card.seat));
    }
    node.dataset.hudBox = card.box;
    node.dataset.seat = card.seat;
    if (card.character) node.dataset.character = card.character;
    node.classList.toggle('is-placeholder', card.placeholder);
    node.classList.toggle('is-ready', card.ready);
    node.classList.toggle('is-active', card.active);
    if (card.placeholder) {
      el('span', 'seat-waiting', node).textContent = card.placeholderText;
      return;
    }
    el('span', 'stone', node).textContent = card.stone ?? '';
    const text = el('span', 'seat-text', node);
    el('span', 'seat-label', text).textContent = card.label;
    el('span', 'seat-name', text).textContent = card.name ?? card.statusText;
    if (card.name) el('span', 'seat-status', node).textContent = card.statusText;
  });

  // The three character cards of the active seat (characterSelectViewModel
  // characters): portrait (or emblem) with the seal, name, tagline and one row per skill
  // with its rest turns. A card is a button that picks the character.
  const showCharacters = (container, list, seat) => rebuild(container, list, (card, parent) => {
    const button = el('button', `character colour-${card.colour}`, parent);
    button.type = 'button';
    button.dataset.hudBox = card.box;
    button.dataset.character = card.character;
    button.disabled = card.disabled;
    button.setAttribute('aria-pressed', String(card.selected));
    const tile = el('span', 'emblem-tile', button);
    showStage(card, tile);
    el('span', 'seal', tile).textContent = card.seal;
    const body = el('span', 'character-body', button);
    const head = el('span', 'character-head', body);
    el('span', 'character-name', head).textContent = card.name;
    if (card.takenText) el('span', 'taken', head).textContent = card.takenText;
    el('span', 'tagline', body).textContent = card.tagline;
    for (const skill of card.skills) {
      const row = el('span', 'skill-row', body);
      el('span', 'skill-name', row).textContent = skill.name;
      el('span', 'rest', row).textContent = skill.restText;
    }
    button.addEventListener('click', () => act('pick', card.character, seat));
  });

  // The Ready button of the active seat (characterSelectViewModel readyButton).
  const showReady = (button, ready) => {
    button.hidden = ready === null;
    if (!ready) return;
    button.textContent = ready.label;
    button.disabled = ready.disabled;
    button.dataset.hudBox = ready.box;
    button.dataset.seat = ready.seat;
  };
  const waitingReady = $('waiting-ready');
  const selectReady = $('select-ready');
  for (const button of [waitingReady, selectReady]) {
    button.addEventListener('click', () => act('ready', button.dataset.seat));
  }
  const waitingCards = $('waiting-cards');
  const selectCards = $('select-cards');
  const waitingCharacters = $('waiting-characters');
  const selectCharacters = $('select-characters');
  $('select-back').textContent = STRINGS.back;

  const update = () => {
    const view = app.getView();
    const entering = view.screen !== shown;
    shown = view.screen;

    root.hidden = view.screen === GAME;
    root.classList.toggle('over', view.screen === GAME_OVER);
    root.classList.toggle('picking', view.screen === WAITING_SCREEN || view.screen === SELECT);
    for (const section of sections) section.hidden = section.dataset.screen !== view.screen;

    if (view.screen === JOIN) {
      if (entering && !view.joining) joinInput.value = '';
      showJoin(view);
      if (!view.joining) joinInput.focus();
    } else if (view.screen === WAITING_SCREEN && view.waiting) {
      const vm = view.waiting;
      $('waiting-title').textContent = vm.title;
      roomCode.textContent = vm.code;
      roomCode.dataset.roomCode = vm.code;
      $('waiting-hint').textContent = vm.hint;
      $('waiting-lead').textContent = vm.lead;
      $('waiting-starting').textContent = vm.startingText ?? '';
      leave.disabled = !vm.leave.enabled;
      showSeats(waitingCards, vm.cards);
      showCharacters(waitingCharacters, vm.characters, vm.readyButton?.seat);
      showReady(waitingReady, vm.readyButton);
      if (entering) clearCopy();
    } else if (view.screen === SELECT && view.select) {
      const vm = view.select;
      $('select-title').textContent = vm.title;
      $('select-lead').textContent = vm.lead;
      showSeats(selectCards, vm.cards);
      showCharacters(selectCharacters, vm.characters, vm.readyButton?.seat);
      showReady(selectReady, vm.readyButton);
    } else if (view.screen === GAME_OVER && view.gameOver) {
      // The game over card (game-over.js): headline, subline, Rematch with
      // its state and hint, and Back to Menu (always enabled).
      const vm = view.gameOver;
      $('over-title').textContent = vm.headline;
      $('over-detail').textContent = vm.subline;
      overRematch.textContent = vm.rematch.label;
      overRematch.disabled = vm.rematch.disabled;
      $('over-hint').textContent = vm.rematch.hint ?? '';
      overMenu.textContent = vm.backToMenu;
    }
    if (view.screen !== WAITING_SCREEN) clearCopy();

    if (entering && view.screen !== JOIN && !root.hidden) {
      root.querySelector(`[data-screen="${view.screen}"] button:not(:disabled)`)?.focus();
    }
  };

  app.onChange(update);
  update();

  return {
    // The asset store (render/assets.js) of the portraits: the character
    // cards are built again with it.
    setAssets(store) {
      assets = store ?? null;
      built.clear();
      update();
    },
  };
}

