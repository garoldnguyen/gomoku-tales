// Leave match on the game screen (docs/flow-design.md section 3.13): a
// small glass circle where topBarLayout (hud-layout.js) puts it: the top
// left corner beside full HUD cards, by the Fullscreen button in the slim
// layouts. A press asks first
// in a small card, as leaving cannot be undone: online the opponent wins at
// once and the room closes (app.leaveMatch, room.js resign), on this
// computer the game ends. It shows while app.getView().leaveMatch is set
// (the game screen, not the character select, never for a spectator) and
// never picks a screen itself.

import { STRINGS } from './strings.js';
import { hudLayout, topBarLayout } from './hud-layout.js';

const DOOR = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"></path><path d="M10 16l-4-4 4-4"></path><path d="M6 12h10"></path></svg>';

// fullscreen() is true when the HUD shows its Fullscreen button.
export function attachLeaveMatch(root, app, { fullscreen = () => true } = {}) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const el = (tag, className, parent) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    parent.append(node);
    return node;
  };

  const button = el('button', 'leave-button', root);
  button.type = 'button';
  button.dataset.hudBox = 'leave-match';
  button.innerHTML = DOOR;
  button.setAttribute('aria-label', STRINGS.leaveMatchLabel);
  button.title = STRINGS.leaveMatchLabel;

  const confirm = el('section', 'leave-confirm', root);
  confirm.dataset.hudBox = 'leave-confirm';
  confirm.setAttribute('role', 'alertdialog');
  confirm.setAttribute('aria-modal', 'true');
  confirm.setAttribute('aria-labelledby', 'leave-confirm-title');
  confirm.setAttribute('aria-describedby', 'leave-confirm-text');
  confirm.hidden = true;
  const title = el('h2', 'leave-title', confirm);
  title.id = 'leave-confirm-title';
  title.textContent = STRINGS.leaveMatchTitle;
  const text = el('p', 'leave-text', confirm);
  text.id = 'leave-confirm-text';
  const row = el('div', 'leave-actions', confirm);
  const stay = el('button', 'leave-stay', row);
  stay.type = 'button';
  stay.textContent = STRINGS.leaveMatchStay;
  stay.dataset.hudBox = 'leave-stay';
  const go = el('button', 'leave-go', row);
  go.type = 'button';
  go.textContent = STRINGS.leaveMatchConfirm;
  go.dataset.hudBox = 'leave-go';

  // Placed with the HUD's numbers when the window size changes.
  const place = () => {
    const w = win.innerWidth;
    const h = win.innerHeight;
    const { leave } = topBarLayout(w, h, hudLayout(w, h), { fullscreen: fullscreen() });
    button.style.left = `${leave.x}px`;
    button.style.top = `${leave.y}px`;
  };
  win.addEventListener('resize', place);

  let asking = false;
  const ask = (value) => {
    asking = value;
    update();
    (value ? stay : button).focus();
  };
  button.addEventListener('click', () => ask(!asking));
  stay.addEventListener('click', () => ask(false));
  go.addEventListener('click', () => {
    asking = false;
    app.leaveMatch();
  });
  confirm.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    ask(false);
  });

  function update() {
    const view = app.getView().leaveMatch;
    const shown = view !== null;
    if (shown && root.hidden) place();
    root.hidden = !shown;
    if (!shown) asking = false;
    text.textContent = view?.online ? STRINGS.leaveMatchOnline : STRINGS.leaveMatchLocal;
    confirm.hidden = !asking;
    button.setAttribute('aria-expanded', String(asking));
    root.classList.toggle('is-asking', asking);
  }

  app.onChange(update);
  update();
  return { update, ask, place };
}
