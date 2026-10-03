// The glass HUD over the 3D world (docs/art-direction-v3.md section 8): a
// DOM overlay styled by src/ui/hud.css with the markup of
// docs/reference/v3/hud-states.html. It renders only the view model of
// hud-view.js and touches the DOM only where a value changed. Every control
// is a real button; the skill rows call onSkill like the old canvas
// buttons did, so the target flows, Esc, right click, R and Q work as before.

import { X, O } from '../logic/board.js';
import { characterForStone } from '../logic/characters.js';
import { getSkill } from '../logic/skills.js';
import { CARD_HEIGHT, hudLayout } from './hud-layout.js';
import { PORTRAIT_ART, QUALITY_CHOICES, SKILL_ICON_ART } from './hud-view.js';

const LOOK_CLASSES = { selected: 'is-selected', cooling: 'is-cooling', off: 'is-off', ready: null };

// root: the empty .hud element. handlers:
//   onSkill(player, skillId)  a skill row was pressed
//   onQuality(level)          a quality button was pressed
//   onCancel()                a right click on the HUD
// assets: the asset store (render/assets.js) or null; setAssets() swaps it.
export function createHud(root, { onSkill, onQuality, onCancel }, assets = null) {
  root.classList.add('hud');
  const el = (tag, className, parent) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    parent?.append(node);
    return node;
  };

  // Top bar: the turn pill.
  const topbar = el('div', 'topbar', root);
  const turn = el('div', 'turn glass', topbar);
  // data-hud-box names every element that takes screen space, for the
  // overlap check of the screenshot self-check (docs/shots.md section 4).
  turn.dataset.hudBox = 'turn';
  turn.setAttribute('role', 'status');
  turn.setAttribute('aria-live', 'polite');
  el('span', 'dot', turn);
  const turnWho = el('span', 'who', turn);
  const turnHint = el('span', 'hint', turn);

  // Quality switch.
  const quality = el('div', 'quality glass', root);
  quality.setAttribute('role', 'group');
  quality.setAttribute('aria-label', 'Quality');
  quality.dataset.hudBox = 'quality';
  const qualityButtons = QUALITY_CHOICES.map(({ level, label }) => {
    const button = el('button', null, quality);
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-pressed', 'false');
    button.dataset.hudBox = `quality-${level}`;
    button.addEventListener('click', () => onQuality(level));
    return button;
  });

  // An image with a letter shown in its place while the art is missing.
  const images = [];
  const artImage = (holder, name, letter) => {
    const img = el('img', null, holder);
    img.alt = '';
    img.draggable = false;
    el('span', 'initial', holder).textContent = letter;
    images.push({ holder, img, name });
  };
  const showArt = () => {
    for (const { holder, img, name } of images) {
      const image = assets?.get(name) ?? null;
      if (image?.src) img.src = image.src;
      holder.classList.toggle('no-art', !image?.src);
    }
  };

  // Player cards.
  const cards = [X, O].map((player) => {
    const character = characterForStone(player);
    const card = el('section', `card ${player === X ? 'left' : 'right'} glass`, root);
    card.setAttribute('aria-label', character.name);
    card.dataset.hudBox = `card-${player.toLowerCase()}`;
    const whoRow = el('div', 'who-row', card);
    artImage(el('div', 'tile', whoRow), PORTRAIT_ART[player], character.name[0]);
    const text = el('div', null, whoRow);
    const name = el('div', 'name', text);
    const meta = el('div', 'meta', text);
    const chip = el('div', 'chip', card);
    el('div', 'rule', card);
    el('div', 'label', card).textContent = 'SKILLS';
    const list = el('div', 'skills', card);
    const skills = character.skills.map((skillId) => {
      const button = el('button', 'skill', list);
      button.type = 'button';
      button.dataset.hudBox = `skill-${skillId}`;
      const ico = el('span', 'ico', button);
      artImage(ico, SKILL_ICON_ART[skillId], getSkill(skillId).name.split(' ').map((word) => word[0]).join(''));
      const ring = el('span', 'ring', ico);
      const count = el('span', 'count', ico);
      const t = el('span', 't', button);
      const title = el('span', 'title', t);
      const state = el('span', 'state', t);
      button.addEventListener('click', () => onSkill(player, skillId));
      return { button, ico, ring, count, title, state, look: null, progress: null };
    });
    return { card, name, meta, chip, skills };
  });

  const toast = el('div', 'toast glass', root);
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.dataset.hudBox = 'toast';
  toast.hidden = true;

  root.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    onCancel?.();
  });

  const setText = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };
  const setAttr = (node, name, value) => {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };

  showArt();

  // Shrinks the cards or turns them into slim bars (at the bottom or upright
  // beside the board) so they never lie over
  // the board (hud-layout.js), against the full window. Runs when the window
  // size or the orientation changes, not per frame.
  let cardHeight = CARD_HEIGHT;
  const layout = () => {
    if (root.hidden) return;
    if (!root.classList.contains('is-compact')) cardHeight = Math.max(CARD_HEIGHT, cards[0].card.offsetHeight);
    const { compact, rail, railWidth, stacked, scale } = hudLayout(window.innerWidth, window.innerHeight, cardHeight);
    root.classList.toggle('is-compact', compact);
    root.classList.toggle('is-rail', rail);
    root.classList.toggle('is-stacked', stacked);
    const value = String(scale);
    if (root.style.getPropertyValue('--card-scale') !== value) root.style.setProperty('--card-scale', value);
    const width = `${railWidth}px`;
    if (root.style.getPropertyValue('--rail-width') !== width) root.style.setProperty('--rail-width', width);
  };
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);

  const setQuality = (level) => {
    if (root.dataset.quality !== level) root.dataset.quality = level;
  };

  return {
    // Shows the view model of hudViewModel().
    render(vm) {
      setQuality(vm.quality);
      setAttr(turn, 'data-team', vm.turn.team);
      setText(turnWho, vm.turn.who);
      setText(turnHint, vm.turn.hint ?? '');
      setAttr(turn, 'title', vm.hint ?? '');
      vm.qualityChoices.forEach((choice, i) => setAttr(qualityButtons[i], 'aria-pressed', String(choice.pressed)));

      vm.cards.forEach((card, c) => {
        const dom = cards[c];
        setText(dom.name, card.name);
        setText(dom.meta, card.meta);
        setText(dom.chip, card.chip);
        dom.card.classList.toggle('is-waiting', card.waiting);
        dom.card.classList.toggle('is-winner', card.winner);
        card.skills.forEach((skill, s) => {
          const row = dom.skills[s];
          if (row.look !== skill.look) {
            if (row.look && LOOK_CLASSES[row.look]) row.button.classList.remove(LOOK_CLASSES[row.look]);
            if (LOOK_CLASSES[skill.look]) row.button.classList.add(LOOK_CLASSES[skill.look]);
            row.look = skill.look;
          }
          setText(row.title, skill.title);
          setText(row.state, skill.state);
          setText(row.count, skill.cooldown > 0 ? String(skill.cooldown) : '');
          const percent = Math.round(skill.progress * 100);
          if (row.progress !== percent) {
            row.ring.style.setProperty('--p', String(percent));
            row.progress = percent;
          }
          setAttr(row.button, 'aria-label', skill.label);
          setAttr(row.button, 'aria-disabled', String(skill.disabled));
          setAttr(row.button, 'aria-pressed', String(skill.selected));
        });
      });

      const message = vm.toast ?? '';
      setText(toast, message);
      if (toast.hidden !== !message) toast.hidden = !message;
    },

    // Sets data-quality: Low is solid, Medium blurs 10 px, High 18 px.
    setQuality,

    show(visible) {
      if (root.hidden === visible) {
        root.hidden = !visible;
        layout();
      }
    },

    // The loaded art; missing files keep their letters.
    setAssets(store) {
      assets = store;
      showArt();
    },
  };
}
