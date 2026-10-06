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

import { MENU_SCRIM_BLUR_PX } from '../config.js';
import { FLOW_EVENTS, OVERLAYS } from './flow.js';
import { OVERLAY_OPENER, menuKeyAction } from './menu.js';
import { createFader } from './motion.js';

const SVG = 'http://www.w3.org/2000/svg';

// The line icon of each menu button (24 by 24 view box, drawn with the
// text colour) and the chevron on its right.
const MENU_ICONS = {
  'play-online': ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18', 'M3 12h18', 'M12 3c2.5 2.6 3.6 5.6 3.6 9s-1.1 6.4-3.6 9c-2.5-2.6-3.6-5.6-3.6-9s1.1-6.4 3.6-9'],
  'play-local': ['M9 11a3 3 0 1 0 0-6a3 3 0 1 0 0 6', 'M3.5 19c.6-3 2.8-5 5.5-5s4.9 2 5.5 5', 'M16 11a2.5 2.5 0 1 0 0-5', 'M16.5 14c2.2.3 3.7 2.2 4 5'],
  watch: ['M2.5 12c2.2-4 5.6-6.5 9.5-6.5s7.3 2.5 9.5 6.5c-2.2 4-5.6 6.5-9.5 6.5s-7.3-2.5-9.5-6.5', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6'],
  howto: ['M5 4.5h5.5a2.5 2.5 0 0 1 2.5 2.5v12.5a2 2 0 0 0-2-2H5z', 'M19 4.5h-5.5a2.5 2.5 0 0 0-2.5 2.5v12.5a2 2 0 0 1 2-2H19z'],
  settings: ['M4 7h10', 'M18 7h2', 'M4 17h2', 'M10 17h10', 'M16 5v4', 'M8 15v4'],
};
const CHEVRON = ['M9 6l6 6l-6 6'];

export function createMenu(root, { onEvent, onQuality, onFullscreen }) {
  let assets = null;
  let shown = null; // the last view model drawn
  const fader = createFader(); // the menu and its panels fade out (motion.js)
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

  // An inline line icon of `paths` (24 by 24 view box).
  const icon = (className, parent, paths) => {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const d of paths) {
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    parent.append(svg);
    return svg;
  };

  // The dark scrim over the 3D scene (blurred on the frosted levels), then
  // the menu card: title, place pill, the five buttons and the hint bar.
  el('div', 'scrim', root);
  const menu = el('section', 'menu-card glass', root);
  menu.dataset.hudBox = 'menu-card';
  menu.setAttribute('aria-labelledby', 'menu-title');
  const head = el('header', 'menu-head', menu);
  const title = el('h1', 'menu-title', head);
  title.id = 'menu-title';
  const place = el('p', 'menu-place', head);
  const list = el('div', 'menu-buttons', menu);
  const keysHint = el('p', 'menu-keys', menu);
  const menuButtons = new Map(); // button id -> element
  const menuOrder = []; // the buttons in view model order, for the arrow keys

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
    // The last word of the title in italics (the Ivory title, menu.css).
    const words = vm.title.split(' ');
    title.textContent = words.length > 1 ? `${words.slice(0, -1).join(' ')} ` : '';
    el('em', null, title).textContent = words.at(-1);
    place.textContent = vm.place;
    keysHint.textContent = vm.keysHint;
    for (const item of vm.buttons) {
      const node = button('menu-button', list, '', item.box);
      node.dataset.menu = item.id;
      node.style.setProperty('--i', String(menuOrder.length)); // its place in the staggered entrance (menu.css)
      const badge = el('span', 'menu-icon', node);
      icon('menu-glyph', badge, MENU_ICONS[item.id] ?? []);
      const text = el('span', 'menu-text', node);
      el('span', 'menu-label', text).textContent = item.label;
      el('span', 'menu-hint', text).textContent = item.hint;
      icon('menu-chevron', node, CHEVRON);
      node.addEventListener('click', () => onEvent(item.event));
      menuButtons.set(item.id, node);
      menuOrder.push(item);
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

  // Escape closes an open overlay (focus then goes back to its opener). On
  // the plain menu Up and Down move the focus between the buttons and Enter
  // selects the focused one (menuKeyAction ignores typing targets).
  window.addEventListener('keydown', (event) => {
    if (!shown?.visible) return;
    if (shown.overlay !== OVERLAYS.NONE) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onEvent(FLOW_EVENTS.CLOSE_OVERLAY);
      return;
    }
    const current = menuOrder.findIndex((item) => menuButtons.get(item.id) === document.activeElement);
    const action = menuKeyAction(event, current, menuOrder.length);
    if (!action) return;
    event.preventDefault();
    if ('move' in action) menuButtons.get(menuOrder[action.move].id)?.focus();
    else onEvent(menuOrder[action.select].event);
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
      fader.set(root, vm.visible);
      if (!vm.visible) return;

      menu.classList.toggle('is-covered', vm.overlay !== OVERLAYS.NONE);
      menu.setAttribute('aria-hidden', String(vm.overlay !== OVERLAYS.NONE));
      fader.set(howto.node, vm.overlay === OVERLAYS.HOWTO);
      fader.set(settings.node, vm.overlay === OVERLAYS.SETTINGS);
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
    // blur at 0 px, frosted above, as in the HUD. The scrim blurs by
    // MENU_SCRIM_BLUR_PX on the frosted levels and not at all on solid glass.
    setFrost(frost) {
      const blur = frost?.blurPx ?? 0;
      root.style.setProperty('--blur', `${blur}px`);
      root.style.setProperty('--scrim-blur', `${blur > 0 ? MENU_SCRIM_BLUR_PX : 0}px`);
      root.classList.toggle('is-solid', blur <= 0);
    },

    // The asset store (render/assets.js) for the portraits and icons.
    setAssets(store) {
      assets = store;
      showArt();
    },
  };
}
