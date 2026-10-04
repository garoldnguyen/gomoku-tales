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
import { GAME, GAME_OVER, JOIN, SELECT, WAITING_SCREEN } from './app.js';
import { copyFeedbackText, copyRoomCode, joinViewModel, lobbyViewModel } from './room-screens.js';
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
  let assets = null;
  const images = [];

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

  // An art image (asset store name) with a letter shown while it is missing.
  const showArt = () => {
    for (const { holder, img, name } of images) {
      const image = assets?.get(name) ?? null;
      if (image?.src && img.getAttribute('src') !== image.src) img.src = image.src;
      holder.classList.toggle('no-art', !image?.src);
    }
  };
  const el = (tag, className, parent) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    parent?.append(node);
    return node;
  };

  // The two seats of a character select (room-screens.js
  // characterSelectViewModel cards) in a container, rebuilt when they
  // change: the seat's label, its pick with the stone, its state, and for
  // the seats this window picks for one button per character and Ready.
  const seatViews = new Map(); // container -> { key, images }
  const showSeats = (container, list) => {
    const key = JSON.stringify(list);
    const shownSeats = seatViews.get(container);
    if (shownSeats?.key === key) return;
    if (shownSeats) for (const entry of shownSeats.images) images.splice(images.indexOf(entry), 1);
    const own = [];
    seatViews.set(container, { key, images: own });
    // The button that had focus keeps it after the rebuild (or, now
    // disabled, its seat's next enabled button).
    const focused = container.contains(document.activeElement) ? document.activeElement : null;
    const focusBox = focused?.dataset.hudBox ?? null;
    const focusSeat = focused?.closest('[data-seat]')?.dataset.seat ?? null;
    container.replaceChildren();
    for (const card of list) {
      const node = el('div', `seat${card.team ? ` team-${card.team}` : ''}`, container);
      node.dataset.hudBox = card.box;
      node.dataset.seat = card.seat;
      if (card.character) node.dataset.character = card.character;
      node.classList.toggle('is-placeholder', card.placeholder);
      node.classList.toggle('is-ready', card.ready);
      if (card.placeholder) {
        el('span', 'seat-waiting', node).textContent = card.placeholderText;
        continue;
      }
      const top = el('div', 'seat-top', node);
      if (card.portrait) {
        const portrait = el('div', 'portrait', top);
        const img = el('img', null, portrait);
        img.alt = '';
        img.draggable = false;
        el('span', 'initial', portrait).textContent = card.name.charAt(0);
        const entry = { holder: portrait, img, name: card.portrait };
        images.push(entry);
        own.push(entry);
      }
      const text = el('div', 'seat-text', top);
      const head = el('div', 'seat-head', text);
      el('span', 'seat-label', head).textContent = card.label;
      if (card.stone) el('span', 'stone', head).textContent = card.stone;
      if (card.name) el('span', 'seat-name', text).textContent = card.name;
      const tags = el('div', 'seat-tags', text);
      if (card.note) el('span', 'seat-note', tags).textContent = card.note;
      el('span', 'seat-status', tags).textContent = card.statusText;
      if (card.choices.length > 0) {
        const choices = el('div', 'seat-choices', node);
        for (const choice of card.choices) {
          const button = el('button', 'choice', choices);
          button.type = 'button';
          button.dataset.hudBox = choice.box;
          button.dataset.character = choice.character;
          button.disabled = choice.disabled;
          button.setAttribute('aria-pressed', String(choice.selected));
          el('span', null, button).textContent = choice.name;
          if (choice.takenText) el('small', null, button).textContent = choice.takenText;
          button.addEventListener('click', () => act('pick', choice.character, card.seat));
        }
      }
      if (card.readyButton) {
        const ready = el('button', 'seat-ready', node);
        ready.type = 'button';
        ready.dataset.hudBox = card.readyButton.box;
        ready.disabled = card.readyButton.disabled;
        ready.textContent = card.readyButton.label;
        ready.addEventListener('click', () => act('ready', card.seat));
      }
    }
    if (focusBox) {
      const again = container.querySelector(`[data-hud-box="${focusBox}"]`);
      const next = again && !again.disabled ? again : container.querySelector(`[data-seat="${focusSeat}"] button:not(:disabled)`);
      next?.focus();
    }
    showArt();
  };
  const waitingCards = $('waiting-cards');
  const selectCards = $('select-cards');
  $('select-back').textContent = STRINGS.back;

  const update = () => {
    const view = app.getView();
    const entering = view.screen !== shown;
    shown = view.screen;

    root.hidden = view.screen === GAME;
    root.classList.toggle('over', view.screen === GAME_OVER);
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
      if (entering) clearCopy();
    } else if (view.screen === SELECT && view.select) {
      const vm = view.select;
      $('select-title').textContent = vm.title;
      $('select-lead').textContent = vm.lead;
      showSeats(selectCards, vm.cards);
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
    // The asset store (render/assets.js) for the portraits.
    setAssets(store) {
      assets = store;
      showArt();
    },
  };
}

