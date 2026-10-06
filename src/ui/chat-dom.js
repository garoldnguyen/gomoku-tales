// The room chat panel (docs/flow-design.md section 3.12): a small glass
// panel in the lower left over the game, for both players and every
// spectator of an online room. It shows app.getView().chat (null: hidden),
// sends with app.sendChat, and never picks a screen.
//
//   open    the panel with the messages, a text box and Send; the browser's
//           resize handle in its corner makes it larger or smaller
//   hidden  folded into a round Chat button that counts unread messages
//
// Whether it is open is kept in this browser (CHAT_OPEN_KEY); it starts
// folded. Typing in the box never reaches the game's keys (isTypingTarget).

import { CHAT_MAX_LENGTH } from '../config.js';
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

export function attachChat(root, app, { storage = null } = {}) {
  const doc = root.ownerDocument;
  const el = (tag, className, parent) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    parent.append(node);
    return node;
  };

  const toggle = el('button', 'chat-toggle', root);
  toggle.type = 'button';
  toggle.dataset.hudBox = 'chat-toggle';
  const toggleLabel = el('span', 'chat-toggle-label', toggle);
  toggleLabel.textContent = STRINGS.chatOpen;
  const badge = el('span', 'chat-badge', toggle);
  badge.hidden = true;

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
  toggle.addEventListener('click', () => setOpen(true));
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
      const item = el('li', `chat-line${message.mine ? ' is-mine' : ''}`, log);
      el('span', 'chat-name', item).textContent = senderLabel(message);
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
  }

  app.onChange(update);
  update();
  return { update };
}
