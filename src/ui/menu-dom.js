// DOM side of the main menu, How to Play and Settings (docs/flow-design.md
// sections 3.1 to 3.3): quiet glass layers (src/ui/menu.css) over the 3D
// world, drawn from menuViewModel (menu.js). This file only renders the
// view model and reports clicks; which screen and overlay is shown is the
// flow's decision (flow.js).
//
// handlers:
//   onEvent(type)      a menu button, Close or Escape: a flow event of MENU_EVENTS
//   onQuality(level)   a Graphics quality option was chosen
//   onFullscreen()     the Fullscreen button was pressed

import { FLOW_EVENTS, OVERLAYS } from './flow.js';
import { OVERLAY_OPENER } from './menu.js';

export function createMenu(root, { onEvent, onQuality, onFullscreen }) {
  let assets = null;
  let shown = null; // the last view model drawn
  const images = [];

  const el = (tag, className, parent) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    parent?.append(node);
    return node;
  };
  const button = (className, parent, label, box) => {
    const node = el('button', className, parent);
    node.type = 'button';
    node.textContent = label;
    if (box) node.dataset.hudBox = box;
    return node;
  };
  // An art image (asset store name) with a letter shown while it is missing.
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
      if (image?.src && img.getAttribute('src') !== image.src) img.src = image.src;
      holder.classList.toggle('no-art', !image?.src);
    }
  };

  // The menu card: title and the four buttons in one column.
  const menu = el('section', 'menu-card glass', root);
  menu.dataset.hudBox = 'menu-card';
  menu.setAttribute('aria-labelledby', 'menu-title');
  const title = el('h1', 'menu-title', menu);
  title.id = 'menu-title';
  const list = el('div', 'menu-buttons', menu);
  const menuButtons = new Map(); // button id -> element

  // A panel with a heading and a Close button (How to Play, Settings).
  const panel = (name, labelText) => {
    const node = el('section', `panel ${name}-panel glass`, root);
    node.dataset.hudBox = `${name}-panel`;
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-labelledby', `${name}-title`);
    node.hidden = true;
    const head = el('header', 'panel-head', node);
    const heading = el('h2', null, head);
    heading.id = `${name}-title`;
    heading.textContent = labelText;
    const close = button('close', head, '', `${name}-close`);
    close.addEventListener('click', () => onEvent(FLOW_EVENTS.CLOSE_OVERLAY));
    const body = el('div', 'panel-body', node);
    return { node, heading, close, body };
  };
  const howto = panel('howto', '');
  const settings = panel('settings', '');
  let howtoBuilt = false;
  let settingsBuilt = false;
  const levelButtons = [];
  let fullscreenRow = null;
  let fullscreenButton = null;
  let qualityRow = null;

  const buildMenu = (vm) => {
    title.textContent = vm.title;
    for (const item of vm.buttons) {
      const node = button('menu-button', list, item.label, item.box);
      node.dataset.menu = item.id;
      node.addEventListener('click', () => onEvent(item.event));
      menuButtons.set(item.id, node);
    }
  };

  const buildHowTo = (vm) => {
    howto.heading.textContent = vm.title;
    howto.close.textContent = vm.close;
    const rules = el('ol', 'rules', howto.body);
    for (const line of vm.rules) el('li', null, rules).textContent = line;
    el('h3', 'skills-title', howto.body).textContent = vm.skillsTitle;
    for (const character of vm.characters) {
      const group = el('section', `character team-${character.team}`, howto.body);
      group.dataset.character = character.id;
      const who = el('div', 'who', group);
      artImage(el('div', 'portrait', who), character.portrait, character.name.charAt(0));
      const name = el('div', 'who-name', who);
      el('span', 'name', name).textContent = character.name;
      el('span', 'stone', name).textContent = character.stone;
      for (const skill of character.skills) {
        const row = el('div', 'skill', group);
        row.dataset.skill = skill.id;
        artImage(el('div', 'icon', row), skill.icon, skill.title.charAt(0));
        const text = el('div', 'skill-text', row);
        const head = el('div', 'skill-head', text);
        el('span', 'skill-title', head).textContent = skill.title;
        const rests = el('span', 'rests', head);
        rests.textContent = skill.cooldownText;
        rests.dataset.cooldown = String(skill.cooldown);
        el('p', 'desc', text).textContent = skill.description;
      }
    }
    showArt();
  };

  const buildSettings = (vm) => {
    settings.heading.textContent = vm.title;
    settings.close.textContent = vm.close;
    qualityRow = el('div', 'setting', settings.body);
    const qualityTitle = el('h3', null, qualityRow);
    qualityTitle.id = 'settings-quality-title';
    qualityTitle.textContent = vm.qualityTitle;
    const group = el('div', 'segmented', qualityRow);
    group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', 'settings-quality-title');
    for (const option of vm.levels) {
      const node = el('button', 'segment', group);
      node.type = 'button';
      node.dataset.hudBox = option.box;
      node.dataset.level = option.level;
      el('span', 'segment-label', node).textContent = option.label;
      el('span', 'segment-help', node).textContent = option.help;
      node.addEventListener('click', () => onQuality(option.level));
      levelButtons.push(node);
    }
    fullscreenRow = el('div', 'setting setting-row', settings.body);
    el('h3', null, fullscreenRow).textContent = vm.fullscreenTitle;
    fullscreenButton = button('fullscreen-button', fullscreenRow, '', 'settings-fullscreen');
    fullscreenButton.addEventListener('click', () => onFullscreen());
  };

  const focusOf = (vm) => {
    if (vm.overlay === OVERLAYS.HOWTO) return howto.close;
    if (vm.overlay === OVERLAYS.SETTINGS) return settings.close;
    return menuButtons.get(vm.focus) ?? null;
  };

  // Escape closes an open overlay (focus then goes back to its opener).
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !shown?.visible || shown.overlay === OVERLAYS.NONE) return;
    event.preventDefault();
    onEvent(FLOW_EVENTS.CLOSE_OVERLAY);
  });

  return {
    // Draws a menuViewModel. Moves the focus only when the screen or the
    // overlay changed: to the first button when the menu appears, to an
    // overlay's Close button when it opens, and back to the button that
    // opened it when it closes.
    render(vm) {
      const before = shown;
      shown = vm;
      if (menuButtons.size === 0) buildMenu(vm);
      root.hidden = !vm.visible;
      if (!vm.visible) return;

      menu.classList.toggle('is-covered', vm.overlay !== OVERLAYS.NONE);
      menu.setAttribute('aria-hidden', String(vm.overlay !== OVERLAYS.NONE));
      howto.node.hidden = vm.overlay !== OVERLAYS.HOWTO;
      settings.node.hidden = vm.overlay !== OVERLAYS.SETTINGS;
      if (vm.howto && !howtoBuilt) {
        buildHowTo(vm.howto);
        howtoBuilt = true;
      }
      if (vm.settings) {
        if (!settingsBuilt) {
          buildSettings(vm.settings);
          settingsBuilt = true;
        }
        qualityRow.hidden = !vm.settings.qualityVisible;
        vm.settings.levels.forEach((option, i) => levelButtons[i].setAttribute('aria-pressed', String(option.current)));
        fullscreenRow.hidden = !vm.settings.fullscreen.visible;
        fullscreenButton.textContent = vm.settings.fullscreen.label;
        fullscreenButton.setAttribute('aria-pressed', String(vm.settings.fullscreen.pressed));
      }

      const appeared = !before?.visible;
      if (appeared || before.overlay !== vm.overlay) {
        if (vm.overlay === OVERLAYS.NONE && !appeared && before.overlay !== OVERLAYS.NONE) {
          menuButtons.get(OVERLAY_OPENER[before.overlay])?.focus();
        } else {
          focusOf(vm)?.focus();
        }
        if (vm.overlay === OVERLAYS.HOWTO) howto.body.scrollTop = 0;
      }
    },

    // The glass frost of the quality level (hudFrost of the table in
    // src/render3d/quality.js, or null for the 2D renderer): solid with no
    // blur at 0 px, frosted above, as in the HUD.
    setFrost(frost) {
      const blur = frost?.blurPx ?? 0;
      root.style.setProperty('--blur', `${blur}px`);
      root.classList.toggle('is-solid', blur <= 0);
    },

    // The asset store (render/assets.js) for the portraits and icons.
    setAssets(store) {
      assets = store;
      showArt();
    },
  };
}
