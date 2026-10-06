// DOM side of the lobby, room, local character select and game over screens
// (docs/flow-design.md sections 3.4 to 3.7), and the spectator's room code
// box, watched game card and Room closed notice (sections 3.8 and 3.9). The markup lives in index.html; this fills in its text from
// strings.js, draws the view models of room-screens.js, wires the buttons
// to the screen flow in app.js and shows the right screen whenever the app
// changes. The Game screen itself is drawn on the canvas, so the overlay
// hides for it. Which screen shows is the flow's decision (flow.js).
//
// app is the app of app.js, or in shot mode a still stand-in with the same
// getView, getScreen and onChange (its actions may be missing).

import { COPY_FEEDBACK_MS, ENTER_STAGGER_MS, INVITE_LINK_SHOW_MS } from '../config.js';
import { AVATAR_PX } from '../render3d/art-assets.js';
import { watchCardBox } from './hud-layout.js';
import { GAME, GAME_OVER, JOIN, LOBBY, ROOM_CLOSED_SCREEN, SELECT, SPECTATE_SCREEN, WAITING_SCREEN, WATCH } from './app.js';
import {
  characterStage, copyFeedbackText, portraitScale, copyRoomCode, inviteFeedbackText, inviteLink, joinViewModel, lobbyViewModel, roomClosedViewModel,
  selectGlassStyle, spectateViewModel,
} from './room-screens.js';
import { TIP_CLOSED, selectTipReducer, selectTipViewModel, tipDelay } from './select-tooltip.js';
import { tooltipPosition } from './tooltip-position.js';
import { createFader } from './motion.js';
import { chooseName, loadName, randomName } from './player-names.js';
import { STRINGS } from './strings.js';

export function attachScreens(root, app, {
  clipboard = globalThis.navigator?.clipboard, location = globalThis.location, storage = null, suggestName = randomName,
} = {}) {
  const $ = (id) => root.querySelector(`#${id}`);
  const act = (name, ...args) => app[name]?.(...args);
  const sections = [...root.querySelectorAll('[data-screen]')];
  const joinForm = $('join-form');
  const joinInput = $('join-code');
  const joinSubmit = $('join-submit');
  const copyStatus = $('copy-status');
  const roomCode = $('room-code');
  const copyInvite = $('copy-invite');
  const leave = $('waiting-leave');
  const overRematch = $('over-rematch');
  const overMenu = $('over-menu');
  const overCard = root.querySelector('.result-card');
  const overView = $('over-view');
  const overShow = $('over-show');
  overView.textContent = STRINGS.gameOverViewBoard;
  overShow.textContent = STRINGS.gameOverShowResult;
  // View board folds the game over card into the Show result pill (this
  // window only, not a screen of the flow); a new game over opens it again.
  const foldResult = (folded) => {
    overCard.classList.toggle('is-folded', folded);
    (folded ? overShow : overRematch.disabled ? overMenu : overRematch).focus();
  };
  overView.addEventListener('click', () => foldResult(true));
  overShow.addEventListener('click', () => foldResult(false));
  const spectateForm = $('spectate-form');
  const spectateInput = $('spectate-code');
  const spectateSubmit = $('spectate-submit');
  let shown = null;
  let copyTimer = null;
  // Motion (docs/flow-design.md section 3.11): a card that leaves is pinned
  // where it stood while it fades, so the next card can rise in its place;
  // the new card's lists enter one item after another (is-entering) for
  // ENTER_STAGGER_MS.
  const PINNED = ['left', 'top', 'width'];
  const fader = createFader({
    beforeLeave(node) {
      if (node === root) return;
      node.style.left = `${node.offsetLeft}px`;
      node.style.top = `${node.offsetTop}px`;
      node.style.width = `${node.offsetWidth}px`;
    },
    afterLeave(node) {
      if (node === root) return;
      for (const property of PINNED) node.style.removeProperty(property);
    },
  });
  let enteringTimer = null;
  let assets = null; // the asset store (render/assets.js), see setAssets
  const warned = new Set(); // portrait keys already warned about
  let frosted = null; // see setFrosted

  // The fixed text.
  const lobby = lobbyViewModel();
  $('lobby-title').textContent = lobby.title;
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
  const spectate = spectateViewModel();
  $('spectate-title').textContent = spectate.title;
  $('spectate-lead').textContent = spectate.lead;
  $('spectate-label').textContent = spectate.label;
  $('spectate-back').textContent = spectate.back.label;
  const closed = roomClosedViewModel();
  $('room-closed-title').textContent = closed.title;
  $('room-closed-detail').textContent = closed.detail;
  $('room-closed-menu').textContent = closed.back.label;

  // The name boxes of Play Online and Watch a match: the saved name, or
  // empty with a random name suggested (and used when it stays empty).
  // Both boxes show the same name.
  const nameBoxes = [$('lobby-name'), $('spectate-name')];
  const suggested = suggestName();
  $('lobby-name-label').textContent = STRINGS.nameLabel;
  $('spectate-name-label').textContent = STRINGS.nameLabel;
  for (const box of nameBoxes) {
    box.value = loadName(storage) ?? '';
    box.placeholder = suggested;
    box.addEventListener('input', () => {
      for (const other of nameBoxes) if (other !== box) other.value = box.value;
    });
  }
  // Before a room opens: the name it uses, saved for next time.
  const takeName = () => act('setPlayerName', chooseName(nameBoxes[0].value, storage, suggested));
  const NAMED_ACTIONS = new Set(['createRoom', 'openJoin']);

  for (const button of root.querySelectorAll('[data-action]')) {
    button.addEventListener('click', () => {
      if (NAMED_ACTIONS.has(button.dataset.action)) takeName();
      act(button.dataset.action);
    });
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

  // The spectator's code box works like Join Room's: code characters only,
  // the inline error clears on typing, Enter submits.
  const showSpectate = (view) => {
    const vm = spectateViewModel({
      text: spectateInput.value, connecting: view.spectate?.inputDisabled ?? false, error: view.spectate?.error ?? null,
    });
    if (spectateInput.value !== vm.value) spectateInput.value = vm.value;
    spectateInput.disabled = vm.inputDisabled;
    spectateSubmit.textContent = vm.watch.label;
    spectateSubmit.disabled = vm.watch.disabled;
    $('spectate-error').textContent = vm.error ?? '';
    spectateInput.setAttribute('aria-invalid', String(vm.error !== null));
  };
  spectateInput.addEventListener('input', () => {
    act('clearSpectateError');
    showSpectate(app.getView());
  });
  spectateForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (spectateSubmit.disabled) return;
    takeName();
    act('watchRoom', spectateInput.value);
  });

  const clearCopy = () => {
    clearTimeout(copyTimer);
    copyTimer = null;
    copyStatus.textContent = '';
    copyStatus.classList.remove('is-link');
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
  // Copy invite link: this page with ?join=CODE. Where the clipboard is
  // refused the link itself shows, selectable, to copy by hand.
  copyInvite.addEventListener('click', async () => {
    const link = inviteLink(location.href, roomCode.textContent);
    const result = await copyRoomCode(link, clipboard);
    clearTimeout(copyTimer);
    copyStatus.textContent = inviteFeedbackText(result, link);
    copyStatus.classList.toggle('is-link', result !== 'copied');
    copyTimer = setTimeout(clearCopy, result === 'copied' ? COPY_FEEDBACK_MS : INVITE_LINK_SHOW_MS);
  });
  leave.addEventListener('click', () => act('leaveRoom'));

  // Escape: Back on the lobby and its panels, Leave in the waiting room
  // (only while Leave is enabled) and Back on the local character select.
  // An open skill tooltip closes first, and only it.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || root.hidden) return;
    if (tipState.open !== null || tipState.pending !== null) {
      tipEvent({ type: 'escape' });
      return;
    }
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
  // bloom, the jade circle with a leaf and the pale yellow cloud with a
  // feather. Their colours come from room.css.
  const SVG = 'http://www.w3.org/2000/svg';
  const EMBLEMS = {
    cross: [['circle', 'petal', { cx: 50, cy: 28, r: 16 }], ['circle', 'petal', { cx: 50, cy: 72, r: 16 }],
      ['circle', 'petal', { cx: 28, cy: 50, r: 16 }], ['circle', 'petal', { cx: 72, cy: 50, r: 16 }],
      ['circle', 'core', { cx: 50, cy: 50, r: 9 }]],
    bloom: [['circle', 'petal', { cx: 50, cy: 50, r: 34 }], ['circle', 'core', { cx: 50, cy: 50, r: 13 }]],
    leaf: [['circle', 'petal', { cx: 50, cy: 50, r: 36 }],
      ['path', 'core', { d: 'M50 22 C 70 34, 70 66, 50 78 C 34 66, 34 34, 50 22 Z' }]],
    cloud: [['circle', 'petal', { cx: 34, cy: 58, r: 20 }], ['circle', 'petal', { cx: 54, cy: 44, r: 24 }],
      ['circle', 'petal', { cx: 72, cy: 60, r: 18 }], ['rect', 'petal', { x: 22, y: 58, width: 62, height: 20, rx: 10 }],
      ['path', 'core', { d: 'M40 70 C 48 56, 60 48, 70 46 C 66 56, 56 66, 40 70 Z' }]],
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
    // Each item's place in the staggered entrance (screens.css).
    [...container.children].forEach((child, i) => child.style.setProperty('--i', String(i)));
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

  // The skill tooltip of the character cards (select-tooltip.js): one
  // element with the skill's name, rest turns and SKILL_INFO description,
  // placed by tooltipPosition next to its row. Keyboard focus shows it at
  // once, a mouse hover after SELECT_TIP_HOVER_MS; pointer leave, blur and
  // Escape close it.
  const tip = el('div', 'select-tip', root);
  tip.id = 'select-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const tipHead = el('div', 'select-tip-head', tip);
  const tipTitle = el('span', 'select-tip-title', tipHead);
  const tipRest = el('span', 'rest', tipHead);
  const tipText = el('p', 'select-tip-text', tip);
  const tipRows = new Map(); // key -> { row, skill }
  let tipState = TIP_CLOSED;
  let tipTimer = null;
  let tipRow = null; // the row whose tooltip shows
  const placeTip = () => {
    if (!tipRow) return;
    const at = tooltipPosition(tipRow.getBoundingClientRect(), { width: tip.offsetWidth, height: tip.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight });
    tip.style.left = `${at.left}px`;
    tip.style.top = `${at.top}px`;
    tip.dataset.placement = at.placement;
  };
  const tipEvent = (event) => {
    const next = selectTipReducer(tipState, event);
    if (next === tipState) return;
    tipState = next;
    clearTimeout(tipTimer);
    tipTimer = null;
    const delay = tipDelay(event);
    if (next.pending !== null && delay !== null) {
      const key = next.pending;
      tipTimer = setTimeout(() => tipEvent({ type: 'hoverTimer', key }), delay);
    }
    tipRow?.removeAttribute('aria-describedby');
    tipRow = null;
    const shown = next.open === null ? null : tipRows.get(next.open) ?? null;
    tip.hidden = shown === null;
    if (!shown) return;
    const vm = selectTipViewModel(shown.skill);
    tipTitle.textContent = vm.title;
    tipRest.textContent = vm.restText;
    tipText.textContent = vm.description;
    tipRow = shown.row;
    tipRow.setAttribute('aria-describedby', tip.id);
    placeTip();
  };
  window.addEventListener('resize', placeTip);
  const attachTip = (row, key, skill) => {
    tipRows.set(key, { row, skill });
    row.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') tipEvent({ type: 'hover', key });
    });
    row.addEventListener('pointerleave', () => tipEvent({ type: 'leave', key }));
    // Only keyboard focus: a mouse click on a row picks the card.
    row.addEventListener('focus', () => {
      if (row.matches(':focus-visible')) tipEvent({ type: 'focus', key });
    });
    row.addEventListener('blur', () => tipEvent({ type: 'blur', key }));
  };
  // A rebuilt or hidden list closes the tooltip of its old rows.
  const dropTips = (container) => {
    for (const [key, { row }] of tipRows) {
      if (!container.contains(row)) continue;
      tipRows.delete(key);
      if (tipState.open === key || tipState.pending === key) tipEvent({ type: 'escape' });
    }
  };

  // The four character cards of the active seat (characterSelectViewModel
  // characters): portrait (or emblem), name, tagline and one
  // row per skill with its rest turns. The pick button holds the portrait,
  // name and tagline; the skill rows under it take keyboard focus for
  // their tooltip, and a click anywhere on an enabled card picks it.
  const showCharacters = (container, list, seat) => {
    if (built.get(container) !== JSON.stringify(list)) dropTips(container);
    rebuild(container, list, (card, parent) => {
      const node = el('div', `character colour-${card.colour}`, parent);
      node.dataset.character = card.character;
      node.classList.toggle('is-selected', card.selected);
      node.classList.toggle('is-disabled', card.disabled);
      const button = el('button', 'character-pick', node);
      button.type = 'button';
      button.dataset.hudBox = card.box;
      button.disabled = card.disabled;
      button.setAttribute('aria-pressed', String(card.selected));
      const tile = el('span', 'emblem-tile', button);
      showStage(card, tile);
      const body = el('span', 'character-body', button);
      const head = el('span', 'character-head', body);
      el('span', 'character-name', head).textContent = card.name;
      if (card.takenText) el('span', 'taken', head).textContent = card.takenText;
      el('span', 'tagline', body).textContent = card.tagline;
      const skills = el('div', 'skill-list', node);
      for (const skill of card.skills) {
        const row = el('div', 'skill-row', skills);
        row.tabIndex = 0;
        el('span', 'skill-name', row).textContent = skill.name;
        el('span', 'rest', row).textContent = skill.restText;
        attachTip(row, `${container.id}:${card.character}:${skill.id}`, skill);
      }
      node.addEventListener('click', () => {
        if (!button.disabled) act('pick', card.character, seat);
      });
    });
  };

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

  // The watch card goes where it never lies over the plots (hud-layout.js
  // watchCardBox): measured at its width, then placed, slim where the full
  // card does not fit. On entering the watched game and on resize.
  const watchCard = root.querySelector('.watch-card');
  const placeWatch = () => {
    if (shown !== WATCH) return;
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const width = watchCardBox(viewW, viewH, 0).w;
    watchCard.classList.remove('is-slim');
    watchCard.style.width = `${width}px`;
    const box = watchCardBox(viewW, viewH, watchCard.offsetHeight);
    watchCard.classList.toggle('is-slim', box.slim);
    watchCard.style.width = `${box.w}px`;
    root.style.setProperty('--watch-left', `${box.x}px`);
    root.style.setProperty('--watch-bottom', `${viewH - box.y - box.h}px`);
  };
  window.addEventListener('resize', placeWatch);

  const update = () => {
    const view = app.getView();
    const entering = view.screen !== shown;
    shown = view.screen;

    fader.set(root, view.screen !== GAME);
    root.classList.toggle('over', view.screen === GAME_OVER || view.screen === WATCH);
    root.classList.toggle('result', view.screen === GAME_OVER);
    if (entering && view.screen === GAME_OVER) overCard.classList.remove('is-folded');
    root.classList.toggle('watching', view.screen === WATCH);
    root.classList.toggle('picking', view.screen === WAITING_SCREEN || view.screen === SELECT);
    for (const section of sections) {
      const now = section.dataset.screen === view.screen;
      if (entering && now) {
        section.classList.add('is-entering');
        clearTimeout(enteringTimer);
        enteringTimer = setTimeout(() => section.classList.remove('is-entering'), ENTER_STAGGER_MS);
      }
      fader.set(section, now);
    }
    if (entering) tipEvent({ type: 'escape' });

    if (view.screen === LOBBY) {
      // The hint, Create (Connecting while the relay opens) and the
      // connection error (room-screens.js lobbyViewModel).
      const vm = view.lobby ?? lobby;
      $('lobby-hint').textContent = vm.hint ?? '';
      $('lobby-create').textContent = vm.create.label;
      $('lobby-create').disabled = vm.create.disabled;
      $('lobby-error').textContent = vm.error ?? '';
    } else if (view.screen === JOIN) {
      if (entering && !view.joining) joinInput.value = '';
      showJoin(view);
      if (!view.joining) joinInput.focus();
    } else if (view.screen === SPECTATE_SCREEN) {
      if (entering) spectateInput.value = '';
      showSpectate(view);
      if (!spectateInput.disabled) spectateInput.focus();
    } else if (view.screen === WATCH && view.watch) {
      const vm = view.watch;
      $('watch-title').textContent = vm.title;
      $('watch-players').textContent = vm.players;
      $('watch-status').textContent = vm.status;
      $('watch-leave').textContent = vm.leave.label;
      placeWatch();
    } else if (view.screen === WAITING_SCREEN && view.waiting) {
      const vm = view.waiting;
      $('waiting-title').textContent = vm.title;
      leave.textContent = vm.leave.label;
      roomCode.textContent = vm.code;
      roomCode.dataset.roomCode = vm.code;
      $('waiting-hint').textContent = vm.hint;
      $('waiting-lead').textContent = vm.lead;
      $('waiting-starting').textContent = vm.startingText ?? '';
      leave.disabled = !vm.leave.enabled;
      copyInvite.hidden = vm.invite === null;
      if (vm.invite) copyInvite.textContent = vm.invite.label;
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

    if (entering && view.screen !== JOIN && view.screen !== SPECTATE_SCREEN && !root.hidden) {
      root.querySelector(`[data-screen="${view.screen}"] button:not(:disabled)`)?.focus();
    }
  };

  app.onChange(update);
  update();

  return {
    // frosted: the window's quality level has frosted glass (quality.js
    // blursMenus); the see-through select panel then blurs the map behind it.
    setFrosted(value) {
      if (value === frosted) return;
      frosted = value;
      root.classList.toggle('is-solid', !frosted);
      for (const [name, css] of Object.entries(selectGlassStyle({ frosted }))) root.style.setProperty(name, css);
    },
    // The asset store (render/assets.js) of the portraits: the character
    // cards are built again with it.
    setAssets(store) {
      assets = store ?? null;
      built.clear();
      update();
    },
  };
}

