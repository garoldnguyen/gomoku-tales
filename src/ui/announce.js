// Announcements over the game (docs/flow-design.md section 3.10): the
// turn banner of a game on one screen, and the first-game hints, each shown
// once per browser. Nothing here changes the rules or picks a screen; it
// only watches the HUD inputs (main.js showHud calls onHud when they
// change) and draws over the board.
//
//   turn banner   on this computer, every time the turn passes (and at the
//                 start), the name of the character to move in a dark glass
//                 band with gold hairlines, for TURN_BANNER_MS
//   hints         short tips in a small glass card, each once (stored under
//                 HINT_STORAGE_KEY): five in a row wins (the first game),
//                 what a skill does (the first time it is picked), tap again
//                 to plant (the first touch preview)
//
// Off in shot mode (no tutorial or tip popup, docs/shots.md section 4).

import { TURN_BANNER_MS, HINT_MS } from '../config.js';
import { EMPTY } from '../logic/board.js';
import { characterOf, isGameOver } from '../logic/game.js';
import { CHARACTER_LOOK } from '../render3d/character-look.js';
import { skillInfo } from './skill-info.js';
import { STRINGS } from './strings.js';

export const HINT_STORAGE_KEY = 'gomoku.hints.seen';
export const HINT_WIN = 'win-line';
export const HINT_TOUCH = 'touch-preview';
export const skillHintId = (skillId) => `skill-${skillId}`;

// True when no stone or rock is on the board yet.
function emptyBoard(state) {
  return state.board.every((row) => row.every((cell) => cell === EMPTY));
}

// What to announce for a change of the HUD inputs: { banner, hints }.
// prev is what the last call saw ({ player, skill, started } or null for a
// new game); next the same for this call. banner is null or { name,
// colour }; hints is a list of hint ids to show (the caller drops the ones
// already seen). local is true for a game on one screen; watching for a
// spectator, who gets no hints.
export function announcements(prev, state, targeting, { local, watching }) {
  const over = isGameOver(state);
  const player = over ? null : state.currentPlayer;
  const skill = targeting?.skill ?? null;
  const next = { player, skill, started: prev?.started ?? false };
  const out = { next, banner: null, hints: [] };
  if (over) return out;
  if (local && player && player !== prev?.player) {
    const character = characterOf(state, player);
    out.banner = { name: character.name, colour: CHARACTER_LOOK[character.id]?.colour ?? null };
  }
  if (watching) return out;
  if (!next.started && emptyBoard(state)) {
    next.started = true;
    out.hints.push(HINT_WIN);
  }
  if (skill && skill !== prev?.skill) out.hints.push(skillHintId(skill));
  return out;
}

// The words of a hint id: { title, text }, or null for an unknown id.
export function hintText(id) {
  if (id === HINT_WIN) return { title: STRINGS.hintWinTitle, text: STRINGS.hintWinText };
  if (id === HINT_TOUCH) return { title: STRINGS.hintTouchTitle, text: STRINGS.hintTouchText };
  if (id.startsWith('skill-')) {
    const info = skillInfo(id.slice('skill-'.length));
    if (!info) return null;
    return { title: info.title, text: `${info.description} ${STRINGS.hintCancel}` };
  }
  return null;
}

// The ids seen so far, from the stored text (a JSON list), never failing.
export function parseSeen(text) {
  try {
    const list = JSON.parse(text ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

// The DOM layer. root is an empty element over the canvases (index.html
// #announce); storage a localStorage-like object (or null: nothing is
// remembered). setTimer and clearTimer default to the window's.
export function createAnnouncer(root, { storage = null, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const doc = root.ownerDocument;
  const el = (tag, className, parent) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    parent.append(node);
    return node;
  };
  let seen = parseSeen(storage?.getItem?.(HINT_STORAGE_KEY) ?? null);
  const remember = (id) => {
    seen.add(id);
    try {
      storage?.setItem?.(HINT_STORAGE_KEY, JSON.stringify([...seen]));
    } catch {
      // a full or blocked storage: the hint may show again next time
    }
  };

  const banner = el('div', 'turn-banner', root);
  banner.setAttribute('aria-live', 'polite');
  banner.dataset.hudBox = 'turn-banner';
  const bannerKicker = el('span', 'turn-banner-kicker', banner);
  const bannerName = el('span', 'turn-banner-name', banner);
  banner.hidden = true;
  let bannerTimer = null;

  const card = el('section', 'hint-card', root);
  card.setAttribute('role', 'status');
  card.dataset.hudBox = 'hint-card';
  const cardTitle = el('h3', 'hint-title', card);
  const cardText = el('p', 'hint-text', card);
  const cardClose = el('button', 'hint-close', card);
  cardClose.type = 'button';
  cardClose.textContent = STRINGS.hintGotIt;
  card.hidden = true;
  const queue = [];
  let hintTimer = null;

  const hideHint = () => {
    if (hintTimer !== null) clearTimer(hintTimer);
    hintTimer = null;
    card.hidden = true;
    card.classList.remove('is-shown');
    showNextHint();
  };
  const showNextHint = () => {
    if (!card.hidden || queue.length === 0) return;
    const id = queue.shift();
    const words = hintText(id);
    if (!words) {
      showNextHint();
      return;
    }
    remember(id);
    cardTitle.textContent = words.title;
    cardText.textContent = words.text;
    card.hidden = false;
    card.classList.remove('is-shown');
    void card.offsetWidth; // restart the entrance
    card.classList.add('is-shown');
    hintTimer = setTimer(hideHint, HINT_MS);
  };
  cardClose.addEventListener('click', hideHint);

  const hint = (id) => {
    if (seen.has(id) || queue.includes(id)) return;
    queue.push(id);
    showNextHint();
  };

  let last = null;
  return {
    // The HUD inputs changed (main.js showHud). local: a game on one
    // screen; watching: a spectator.
    onHud(state, targeting, local = false, watching = false) {
      const result = announcements(last, state, targeting, { local, watching });
      last = result.next;
      if (result.banner) {
        bannerKicker.textContent = STRINGS.turnBannerKicker;
        bannerName.textContent = result.banner.name;
        banner.style.setProperty('--banner-colour', result.banner.colour ?? 'currentColor');
        banner.hidden = false;
        banner.classList.remove('is-shown');
        void banner.offsetWidth; // restart the animation
        banner.classList.add('is-shown');
        if (bannerTimer !== null) clearTimer(bannerTimer);
        bannerTimer = setTimer(() => {
          banner.hidden = true;
          bannerTimer = null;
        }, TURN_BANNER_MS);
      }
      for (const id of result.hints) hint(id);
    },

    // The first touch preview of a cell (main.js): Tap again to plant.
    touchPreview() {
      hint(HINT_TOUCH);
    },

    // A new game or leaving the game: forget the last turn, hide everything.
    reset() {
      last = null;
      queue.length = 0;
      banner.hidden = true;
      if (bannerTimer !== null) clearTimer(bannerTimer);
      bannerTimer = null;
      if (hintTimer !== null) clearTimer(hintTimer);
      hintTimer = null;
      card.hidden = true;
    },
  };
}
