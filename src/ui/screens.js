// DOM side of the lobby and room screens (docs/design.md section 3). The
// markup lives in index.html; this wires its buttons to the screen flow in
// app.js and shows the right screen whenever the app changes. The Game
// screen itself is drawn on the canvas, so the overlay hides for it.

import { CHARACTERS } from '../logic/characters.js';
import { CHARACTER_CHOICES, GAME, GAME_OVER, JOIN, WAITING_SCREEN } from './app.js';

export function attachScreens(root, app) {
  const $ = (id) => root.querySelector(`#${id}`);
  const sections = [...root.querySelectorAll('[data-screen]')];
  const joinForm = $('join-form');
  const joinInput = $('join-code');
  const joinSubmit = $('join-submit');
  let shown = null;
  let copyTimer = null;

  // Character choice buttons for Create Room.
  const choices = $('character-choices');
  for (const id of CHARACTER_CHOICES) {
    const character = CHARACTERS[id];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.dataset.character = id;
    const disc = document.createElement('span');
    disc.className = `disc ${character.stone.toLowerCase()}`;
    const name = document.createElement('span');
    name.textContent = character.name;
    const note = document.createElement('small');
    note.textContent = `${character.stone} stones${character.stone === 'X' ? ', moves first' : ''}`;
    button.append(disc, name, note);
    button.addEventListener('click', () => app.createRoom(id));
    choices.append(button);
  }

  for (const button of root.querySelectorAll('[data-action]')) {
    button.addEventListener('click', () => app[button.dataset.action]());
  }

  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    app.joinRoom(joinInput.value);
  });

  $('copy-code').addEventListener('click', async () => {
    const code = app.getView().code;
    const status = $('copy-status');
    const ok = await copyText(code);
    status.textContent = ok ? 'Copied!' : 'Could not copy. Select the code and copy it by hand.';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      status.textContent = '';
    }, 2000);
  });

  // Esc goes back from the screens that have a Back or Cancel button.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || root.hidden) return;
    const screen = app.getScreen();
    if (screen !== GAME_OVER && screen !== GAME) app.backToLobby();
  });

  const update = () => {
    const view = app.getView();
    const entering = view.screen !== shown;
    shown = view.screen;

    root.hidden = view.screen === GAME;
    root.classList.toggle('over', view.screen === GAME_OVER);
    for (const section of sections) section.hidden = section.dataset.screen !== view.screen;

    if (view.screen === JOIN) {
      if (entering) joinInput.value = '';
      $('join-error').textContent = view.joinError ?? '';
      $('join-status').textContent = view.joining ? `Looking for room ${view.joiningCode}...` : '';
      joinInput.disabled = view.joining;
      joinSubmit.disabled = view.joining;
      if (!view.joining) joinInput.focus();
    } else if (view.screen === WAITING_SCREEN) {
      $('room-code').textContent = view.code ?? '';
      $('waiting-character').textContent = view.characterName ? `You play ${view.characterName}.` : '';
      if (entering) $('copy-status').textContent = '';
    } else if (view.screen === GAME_OVER && view.outcome) {
      $('over-title').textContent = view.outcome.title;
      $('over-detail').textContent = view.outcome.detail;
    }

    if (entering && view.screen !== JOIN && !root.hidden) {
      root.querySelector(`[data-screen="${view.screen}"] button`)?.focus();
    }
  };

  app.onChange(update);
  update();
}

// Copies text to the clipboard. Returns true if it worked.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers or a denied permission: fall back to a hidden field.
    const field = document.createElement('textarea');
    field.value = text;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    field.remove();
    return ok;
  }
}
