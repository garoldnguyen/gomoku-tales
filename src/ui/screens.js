// DOM side of the lobby, room and game over screens (docs/flow-design.md
// sections 3.4, 3.5 and 3.7). The markup lives in index.html; this fills in its text from
// strings.js, draws the view models of room-screens.js, wires the buttons
// to the screen flow in app.js and shows the right screen whenever the app
// changes. The Game screen itself is drawn on the canvas, so the overlay
// hides for it. Which screen shows is the flow's decision (flow.js).
//
// app is the app of app.js, or in shot mode a still stand-in with the same
// getView, getScreen and onChange (its actions may be missing).

import { COPY_FEEDBACK_MS } from '../config.js';
import { CHARACTERS } from '../logic/characters.js';
import { CHARACTER_CHOICES, GAME, GAME_OVER, JOIN, WAITING_SCREEN } from './app.js';
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
  $('create-title').textContent = STRINGS.lobbyCreate;
  $('create-lead').textContent = STRINGS.lobbyCreateLead;
  $('join-title').textContent = STRINGS.lobbyJoin;
  $('join-label').textContent = STRINGS.lobbyCodeLabel;
  for (const back of root.querySelectorAll('.back-button')) back.textContent = STRINGS.back;
  $('copy-code').textContent = STRINGS.waitingCopy;
  leave.textContent = STRINGS.waitingLeave;

  // Character choice buttons for Create Room.
  const choices = $('character-choices');
  for (const id of CHARACTER_CHOICES) {
    const character = CHARACTERS[id];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.dataset.character = id;
    button.dataset.hudBox = `create-${id}`;
    const disc = document.createElement('span');
    disc.className = `disc ${character.stone.toLowerCase()}`;
    const name = document.createElement('span');
    name.textContent = character.name;
    const note = document.createElement('small');
    note.textContent = `${character.stone} stones${character.stone === 'X' ? ', moves first' : ''}`;
    button.append(disc, name, note);
    button.addEventListener('click', () => act('createRoom', id));
    choices.append(button);
  }

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
  // (only while Leave is enabled).
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || root.hidden) return;
    const screen = app.getScreen();
    if (screen === WAITING_SCREEN) {
      if (!leave.disabled) act('leaveRoom');
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

  // The two character cards of the waiting room, rebuilt when they change.
  const cards = $('waiting-cards');
  let cardsKey = null;
  const showCards = (list) => {
    const key = JSON.stringify(list);
    if (key === cardsKey) return;
    cardsKey = key;
    cards.replaceChildren();
    images.length = 0;
    for (const card of list) {
      const node = el('div', `seat team-${card.team}`, cards);
      node.dataset.hudBox = card.box;
      node.dataset.character = card.character;
      node.classList.toggle('is-placeholder', card.placeholder);
      if (card.placeholder) {
        el('span', 'seat-waiting', node).textContent = card.placeholderText;
        continue;
      }
      const portrait = el('div', 'portrait', node);
      const img = el('img', null, portrait);
      img.alt = '';
      img.draggable = false;
      el('span', 'initial', portrait).textContent = card.name.charAt(0);
      images.push({ holder: portrait, img, name: card.portrait });
      const text = el('div', 'seat-text', node);
      const head = el('div', 'seat-head', text);
      el('span', 'seat-name', head).textContent = card.name;
      el('span', 'stone', head).textContent = card.stone;
      const tags = el('div', 'seat-tags', text);
      if (card.youText) el('span', 'you', tags).textContent = card.youText;
      if (card.note) el('span', 'seat-note', tags).textContent = card.note;
    }
    showArt();
  };

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
      $('waiting-hint').textContent = vm.hint;
      $('waiting-starting').textContent = vm.startingText ?? '';
      leave.disabled = !vm.leave.enabled;
      showCards(vm.cards);
      if (entering) clearCopy();
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

