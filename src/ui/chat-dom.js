// The room chat panel (docs/flow-design.md section 3.12): a small glass
// panel in the lower left over the game, for both players and every
// spectator of an online room. It shows app.getView().chat (null: hidden),
// sends with app.sendChat, and never picks a screen.
//
//   open    the panel with the messages, a text box and Send; the browser's
//           resize handle in its corner makes it larger or smaller
//   hidden  folded into a round Chat button that counts unread messages
//   popup   while folded, a new message of someone else (or a spectator
//           coming or going) shows for CHAT_TOAST_MS in a small popup by
//           the button; a press on it opens the chat
//   watchers a small eye button with the number of spectators, shown while
//           someone watches; a press lists their names
//
// Whether it is open is kept in this browser (CHAT_OPEN_KEY); it starts
// folded. Typing in the box never reaches the game's keys (isTypingTarget).

import { CHAT_MAX_LENGTH, CHAT_TOAST_MS } from '../config.js';
import { STRINGS } from './strings.js';

export const CHAT_OPEN_KEY = 'gomoku.chat.open';

// The label of a message's sender: You for this window, else the name.
export function senderLabel(message) {
  if (message.mine) return STRINGS.chatYou;
  return message.name ?? STRINGS.chatSomeone;
}

// Unread messages: those after the last one seen (by id), not this
// window's own.
export function unreadCount(messages, seenId) {
  let count = 0;
  for (const message of messages) if (message.id > seenId && !message.mine) count++;
  return count;
}

// The newest message to pop up: after lastId, not this window's own, or
// null.
export function toastMessage(messages, lastId) {
  const message = messages.at(-1);
  return message && message.id > lastId && !message.mine ? message : null;
}

const EYE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>';

export function attachChat(root, app, { storage = null, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const doc = root.ownerDocument;
  const el = (tag, className, parent) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    parent.append(node);
    return node;
  };

  const toast = el('button', 'chat-toast', root);
  toast.type = 'button';
  toast.dataset.hudBox = 'chat-toast';
  toast.hidden = true;
  const toastName = el('span', 'chat-name', toast);
  const toastText = el('span', 'chat-text', toast);

  const bar = el('div', 'chat-bar', root);
  const toggle = el('button', 'chat-toggle', bar);
  toggle.type = 'button';
  toggle.dataset.hudBox = 'chat-toggle';
  const toggleLabel = el('span', 'chat-toggle-label', toggle);
  toggleLabel.textContent = STRINGS.chatOpen;
  const badge = el('span', 'chat-badge', toggle);
  badge.hidden = true;
  const eye = el('button', 'chat-watchers', bar);
  eye.type = 'button';
  eye.dataset.hudBox = 'chat-watchers';
  eye.setAttribute('aria-expanded', 'false');
  eye.innerHTML = EYE;
  const eyeCount = el('span', 'chat-watchers-count', eye);
  const watcherList = el('div', 'chat-watcher-list', root);
  watcherList.dataset.hudBox = 'chat-watcher-list';
  watcherList.hidden = true;
  el('p', 'chat-title', watcherList).textContent = STRINGS.audienceTitle;
  const watcherNames = el('ul', null, watcherList);

  const panel = el('section', 'chat-panel', root);
  panel.dataset.hudBox = 'chat-panel';
  panel.setAttribute('aria-label', STRINGS.chatTitle);
  const head = el('header', 'chat-head', panel);
  el('h2', 'chat-title', head).textContent = STRINGS.chatTitle;
  const hide = el('button', 'chat-hide', head);
  hide.type = 'button';
  hide.dataset.hudBox = 'chat-hide';
  hide.setAttribute('aria-label', STRINGS.chatHide);
  // its fold mark is a short bar drawn by chat.css
  const log = el('ol', 'chat-log', panel);
  log.setAttribute('aria-live', 'polite');
  const empty = el('p', 'chat-empty', panel);
  empty.textContent = STRINGS.chatEmpty;
  const form = el('form', 'chat-form', panel);
  form.setAttribute('autocomplete', 'off');
  const input = el('input', 'chat-input', form);
  input.type = 'text';
  input.maxLength = CHAT_MAX_LENGTH;
  input.placeholder = STRINGS.chatPlaceholder;
  input.setAttribute('aria-label', STRINGS.chatPlaceholder);
  input.dataset.hudBox = 'chat-input';
  const send = el('button', 'chat-send', form);
  send.type = 'submit';
  send.textContent = STRINGS.chatSend;
  send.dataset.hudBox = 'chat-send';

  let open = false;
  try {
    open = storage?.getItem?.(CHAT_OPEN_KEY) === '1';
  } catch {
    open = false;
  }
  let seenId = 0; // the newest message id seen while open
  let toastId = Infinity; // the newest message that popped up (or was there when the chat showed)
  let toastTimer = null;
  let listOpen = false; // the names of the watchers are shown
  let shownWatchers = '';
  let shownIds = ''; // the ids drawn in the log, to redraw only on a change

  const setOpen = (value) => {
    open = value;
    try {
      storage?.setItem?.(CHAT_OPEN_KEY, value ? '1' : '0');
    } catch {
      // the choice only lasts for this visit
    }
    update();
    if (open) input.focus();
    else toggle.focus();
  };
  const hideToast = () => {
    if (toastTimer !== null) clearTimer(toastTimer);
    toastTimer = null;
    toast.hidden = true;
  };
  toggle.addEventListener('click', () => setOpen(true));
  toast.addEventListener('click', () => {
    hideToast();
    setOpen(true);
  });
  eye.addEventListener('click', () => {
    listOpen = !listOpen;
    update();
  });
  hide.addEventListener('click', () => setOpen(false));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (app.sendChat(input.value)) input.value = '';
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      input.blur();
    }
  });

  const drawLog = (messages) => {
    const ids = messages.map((m) => m.id).join(',');
    if (ids === shownIds) return;
    shownIds = ids;
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    log.replaceChildren();
    for (const message of messages) {
      const item = el('li', `chat-line${message.mine ? ' is-mine' : ''}${message.system ? ' is-system' : ''}`, log);
      if (!message.system) el('span', 'chat-name', item).textContent = senderLabel(message);
      el('span', 'chat-text', item).textContent = message.text;
    }
    if (atBottom || messages.at(-1)?.mine) log.scrollTop = log.scrollHeight;
  };

  function update() {
    const view = app.getView();
    const { chat } = view;
    root.hidden = chat === null;
    root.dataset.screen = view.screen; // where it sits on phones (chat.css)
    if (!chat) {
      seenId = 0;
      shownIds = '';
      toastId = Infinity;
      listOpen = false;
      hideToast();
      return;
    }
    const { messages } = chat;
    drawLog(messages);
    empty.hidden = messages.length > 0;
    log.hidden = messages.length === 0;
    if (open) seenId = messages.at(-1)?.id ?? seenId;
    const unread = open ? 0 : unreadCount(messages, seenId);
    badge.hidden = unread === 0;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    panel.hidden = !open;
    toggle.hidden = open;
    root.classList.toggle('is-open', open);

    // The popup: only for messages that came while the chat was shown.
    if (toastId === Infinity) toastId = messages.at(-1)?.id ?? 0;
    const fresh = toastMessage(messages, toastId);
    if (fresh) toastId = fresh.id;
    if (open) hideToast();
    else if (fresh) {
      toastName.hidden = fresh.system === true;
      toastName.textContent = fresh.system ? '' : senderLabel(fresh);
      toastText.textContent = fresh.text;
      toast.setAttribute('aria-label', `${STRINGS.chatNew}: ${fresh.system ? '' : senderLabel(fresh) + ': '}${fresh.text}`);
      toast.hidden = false;
      // replays the pop when a second message replaces the first
      toast.classList.remove('is-popping');
      void toast.offsetWidth;
      toast.classList.add('is-popping');
      if (toastTimer !== null) clearTimer(toastTimer);
      toastTimer = setTimer(hideToast, CHAT_TOAST_MS);
    }

    // The watchers: an eye with their number, and their names on a press.
    const names = chat.watchers ?? [];
    eye.hidden = names.length === 0;
    if (names.length === 0) listOpen = false;
    const label = STRINGS.audienceCount.replace('{count}', String(names.length));
    eyeCount.textContent = String(names.length);
    eye.setAttribute('aria-label', label);
    eye.title = label;
    eye.setAttribute('aria-expanded', String(listOpen));
    watcherList.hidden = !listOpen;
    const joined = names.join('\n');
    if (joined !== shownWatchers) {
      shownWatchers = joined;
      watcherNames.replaceChildren();
      for (const name of names) el('li', null, watcherNames).textContent = name;
    }
  }

  app.onChange(update);
  update();
  return { update };
}
