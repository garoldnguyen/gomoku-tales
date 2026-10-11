// The glass HUD over the 3D world (docs/art-direction-v3.md section 8): a
// DOM overlay styled by src/ui/hud.css with the markup of
// docs/reference/v3/hud-states.html. It renders only the view model of
// hud-view.js and touches the DOM only where a value changed. Every control
// is a real button; the skill rows call onSkill like the old canvas
// buttons did, so the target flows, Esc, right click, R and Q work as before.
//
// Each card folds into a pill (docs/art-direction-v3-1.md section 4): a
// chevron button per card, the pill's own skill buttons calling the same
// onSkill, and one shared tooltip with the skill's header, brief and facts,
// placed by tooltipPosition(). The slim layouts of narrow windows never fold.
//
// Free Action (docs/free-action-design.md section 8): the view model says
// which card just cast a skill (cast), which card a Hiss hit (reaction) and
// which card is locked (lock). Each cast is drawn once, when its key is new:
// the border flash, the shake, the gold and green dust, the feathers and the
// purple wave all animate opacity and transforms in hud.css and stand still
// under reduced motion; the lock rune and the dimmed icons are plain state.
// Nothing here decides what to show or reads a cell.
//
// Design v4: a click on a skill button still runs onSkill and also opens
// the skill detail popup (skillPopupViewModel) next to its card, the compact
// card of docs/skill-popup-design.md section 1: the header (icon, title,
// character name, state chip), the brief, the facts, the rules and the hint
// (not opened by a click in the slim layouts of phones, where it would cover
// the board; openSkillPopup() opens it there for the screenshot tool).
// Escape or a press outside it closes it; neither is swallowed, so Escape
// still cancels a target flow and a press on the board still picks the
// target. It takes no presses itself: one on it goes through to the board.

import { X, O } from '../logic/board.js';
import { characterForStone } from '../logic/characters.js';
import { getSkill } from '../logic/skills.js';
import { HISS_WAVE_MS, HUD_SHAKE_MS } from '../config.js';
import { DUST_COUNT, FEATHER_COUNT, castCssVars, castDurationMs, shakeFrames } from './cast-view.js';
import { CARD_HEIGHT, chevronSize, hudFoldLayout, pillScale, topBarLayout } from './hud-layout.js';
import { PORTRAIT_ART, QUALITY_CHOICES, SKILL_ICON_ART, skillPopupViewModel } from './hud-view.js';
import { FACTS_MAX, RULES_MAX } from './skill-info.js';
import { TOOLTIP_LONG_PRESS_MS, TOOLTIP_SHOW_MS, tooltipPosition } from './tooltip-position.js';

const LOOK_CLASSES = { selected: 'is-selected', cooling: 'is-cooling', off: 'is-off', ready: null };
const SVG = 'http://www.w3.org/2000/svg';
// The pill's cooldown ring: viewBox 72, radius 33, stroke 4.
const RING_RADIUS = 33;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const TOOLTIP_ID = 'hud-tooltip';
const POPUP_ID = 'hud-skill-popup';

// root: the empty .hud element. handlers:
//   onSkill(player, skillId)  a skill row was pressed
//   onQuality(level)          a quality button was pressed
//   onCancel()                a right click on the HUD
//   onCollapse(player)        a card's chevron was pressed
//   onFullscreen()            the Fullscreen button was pressed; it must
//                             call the Fullscreen API at once (a user action)
// assets: the asset store (render/assets.js) or null; setAssets() swaps it.
// holdCast: a cast effect stays in its first frame and is never cleared by a
// timer (shot mode, whose pictures must stand still).
export function createHud(root, { onSkill, onQuality, onCancel, onCollapse, onFullscreen }, assets = null, { holdCast = false } = {}) {
  root.classList.add('hud');
  for (const [name, value] of Object.entries(castCssVars())) root.style.setProperty(name, value);
  if (holdCast) root.dataset.castHold = '';
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

  // The Fullscreen button and the quality switch, side by side at the top
  // right (or the button under the switch, .fs-below). The button stays
  // hidden until setFullscreen() says the browser has the Fullscreen API.
  const tools = el('div', 'top-tools', root);
  const fullscreen = el('button', 'fullscreen glass', tools);
  fullscreen.type = 'button';
  fullscreen.dataset.hudBox = 'fullscreen';
  fullscreen.hidden = true;
  fullscreen.setAttribute('aria-pressed', 'false');
  fullscreen.innerHTML = '<svg class="fs-enter" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"></path></svg>'
    + '<svg class="fs-exit" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"></path></svg>';
  fullscreen.addEventListener('click', () => onFullscreen?.());

  // Quality switch.
  const quality = el('div', 'quality glass', tools);
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
    const initial = el('span', 'initial', holder);
    initial.textContent = letter;
    const entry = { holder, img, name, initial };
    images.push(entry);
    return entry;
  };
  const showArt = () => {
    for (const { holder, img, name } of images) {
      const image = assets?.get(name) ?? null;
      if (image?.src) img.src = image.src;
      holder.classList.toggle('no-art', !image?.src);
    }
  };

  // The compact skill card of the tooltip and the popup (docs/skill-popup-design.md
  // section 1): the header (icon, title, character name, state chip), a gold
  // hairline, the brief and the facts; the popup (withRules) also has the rules
  // and the hint. The cells for the most facts and rules are made once and
  // hidden when a skill has fewer.
  const skillCard = (parent, withRules) => {
    const head = el('div', 'pop-head', parent);
    const icon = artImage(el('span', 'ico pop-ico', head), null, '');
    const who = el('div', 'pop-who', head);
    const card = {
      icon,
      title: el('div', 'pop-title', who),
      character: el('div', 'pop-char', who),
      state: el('div', 'tip-state', head),
      brief: null,
      facts: [],
      rules: [],
      hint: null,
    };
    el('div', 'pop-hair', parent);
    card.brief = el('div', 'pop-brief', parent);
    const facts = el('div', 'pop-facts', parent);
    for (let i = 0; i < FACTS_MAX; i++) {
      const cell = el('div', 'pop-fact', facts);
      card.facts.push({ cell, label: el('span', 'pop-fact-label', cell), value: el('span', 'pop-fact-value', cell) });
    }
    if (withRules) {
      const rules = el('div', 'pop-rules', parent);
      for (let i = 0; i < RULES_MAX; i++) card.rules.push(el('div', 'pop-rule', rules));
      card.hint = el('div', 'pop-hint', parent);
    }
    return card;
  };
  const setHidden = (node, hidden) => {
    if (node.hidden !== hidden) node.hidden = hidden;
  };
  // Shows the skill view (a row of the view model, or skillPopupViewModel()).
  const fillSkillCard = (card, view) => {
    setText(card.title, view.title);
    setText(card.character, view.characterName);
    setText(card.state, view.stateText);
    setAttr(card.state, 'data-state', view.state);
    if (card.icon.name !== view.icon) {
      card.icon.name = view.icon;
      card.icon.initial.textContent = skillLetters(view.id);
      card.icon.img.removeAttribute('src');
      showArt();
    }
    setText(card.brief, view.brief);
    card.facts.forEach((slot, i) => {
      const fact = view.facts[i];
      setHidden(slot.cell, !fact);
      setText(slot.label, fact?.label ?? '');
      setText(slot.value, fact?.value ?? '');
    });
    card.rules.forEach((line, i) => {
      setHidden(line, i >= view.rules.length);
      setText(line, view.rules[i] ?? '');
    });
    if (card.hint) setText(card.hint, view.hint);
  };

  // The shared skill tooltip (filled and placed in showTip below).
  const tip = el('div', 'tooltip', root);
  tip.id = TOOLTIP_ID;
  tip.setAttribute('role', 'tooltip');
  tip.dataset.hudBox = 'tooltip';
  tip.hidden = true;
  const tipCard = skillCard(tip, false);

  // The skill detail popup (filled and placed in openPopup below).
  const popup = el('div', 'skill-popup', root);
  popup.id = POPUP_ID;
  popup.setAttribute('role', 'dialog');
  popup.dataset.hudBox = 'skill-popup';
  popup.hidden = true;
  const popCard = skillCard(popup, true);

  // A skill button: a row of the expanded card or a button of the pill.
  // Both run onSkill, unless a long press just showed the tooltip. slot.id
  // is the skill of the row: the character of a side comes from the pick
  // order, so render() changes it when the game's characters change.
  let skipClick = null;
  const skillButton = (className, parent, player, slot, c, s) => {
    const button = el('button', className, parent);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (skipClick === button) {
        skipClick = null; // the click after a long press: the tooltip stays
        return;
      }
      hideTip();
      onSkill(player, slot.id);
      // The slim layouts of phones have no room beside the board: the
      // popup would lie over the plots the skill needs (a long press still
      // shows the tooltip, and the turn pill says the next step).
      if (!compact) openPopup(button, player, slot.id, c);
    });
    attachTip(button, c, s);
    return button;
  };

  // Player cards. Each is one section that folds: the chevron stays, the
  // card body hides and the pill's skill buttons show.
  const cards = [X, O].map((player, c) => {
    const character = characterForStone(player);
    const team = player.toLowerCase();
    const card = el('section', `card ${player === X ? 'left' : 'right'} glass`, root);
    card.setAttribute('aria-label', character.name);
    card.dataset.hudBox = `card-${team}`;
    const whoRow = el('div', 'who-row', card);
    const tile = el('div', 'tile', whoRow);
    const portrait = artImage(tile, PORTRAIT_ART[character.id], character.name[0]);
    el('span', 'turn-dot', tile);
    const text = el('div', 'who-text', whoRow);
    const name = el('div', 'name', text);
    const meta = el('div', 'meta', text);
    const pillSkills = el('div', 'pill-skills', whoRow);
    pillSkills.hidden = true;
    const chevron = el('button', 'chevron', whoRow);
    chevron.type = 'button';
    chevron.dataset.hudBox = `chevron-${team}`;
    chevron.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"></path></svg>';
    chevron.addEventListener('click', () => onCollapse?.(player));
    const body = el('div', 'card-body', card);
    body.id = `hud-card-${team}-body`;
    chevron.setAttribute('aria-controls', body.id);
    // The status chip; a Hiss lock adds the red lock rune inside it, so the
    // card keeps its height.
    const chip = el('div', 'chip', body);
    const chipText = el('span', 'chip-text', chip);
    const rune = el('span', 'lock-rune', chip);
    rune.hidden = true;
    rune.dataset.hudBox = `lock-rune-${team}`;
    rune.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg><span class="lock-text"></span>';
    const runeText = rune.querySelector('.lock-text');
    el('div', 'rule', body);
    el('div', 'label', body).textContent = 'SKILLS';
    const list = el('div', 'skills', body);
    const skills = character.skills.map((skillId, s) => {
      const slot = { id: skillId };
      const button = skillButton('skill', list, player, slot, c, s);
      button.dataset.hudBox = `skill-${skillId}`;
      const ico = el('span', 'ico', button);
      const icon = artImage(ico, SKILL_ICON_ART[skillId], skillLetters(skillId));
      const ring = el('span', 'ring', ico);
      const count = el('span', 'count', ico);
      const t = el('span', 't', button);
      const title = el('span', 'title', t);
      const state = el('span', 'state', t);

      // The pill's button for the same skill.
      const pill = skillButton('pskill', pillSkills, player, slot, c, s);
      pill.dataset.hudBox = `pill-skill-${skillId}`;
      const pico = el('span', 'ico', pill);
      const picon = artImage(pico, SKILL_ICON_ART[skillId], skillLetters(skillId));
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', 'pring');
      svg.setAttribute('viewBox', '0 0 72 72');
      svg.setAttribute('aria-hidden', 'true');
      const track = document.createElementNS(SVG, 'circle');
      const arc = document.createElementNS(SVG, 'circle');
      for (const circle of [track, arc]) {
        circle.setAttribute('cx', '36');
        circle.setAttribute('cy', '36');
        circle.setAttribute('r', String(RING_RADIUS));
        svg.append(circle);
      }
      track.setAttribute('class', 'track');
      arc.setAttribute('class', 'arc');
      arc.setAttribute('transform', 'rotate(-90 36 36)');
      pill.append(svg);
      const pcount = el('span', 'count', pill);
      el('span', 'ready-dot', pill);

      return {
        slot, icon, picon, button, ico, ring, count, title, state, pill, arc, pcount, look: null, progress: null, view: null,
      };
    });
    // Decorative specks for the Petrification dust and the Cloud feathers,
    // made once; hud.css shows them only while the card is casting.
    const fx = el('div', 'cast-fx', card);
    fx.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < DUST_COUNT; i++) el('span', 'dust', fx).style.setProperty('--i', String(i));
    for (let i = 0; i < FEATHER_COUNT; i++) el('span', 'feather', fx).style.setProperty('--i', String(i));
    return {
      card, team, portrait, text, pillSkills, chevron, body, name, meta, chip, chipText, rune, runeText, skills,
      folded: false, collapsed: false, castKey: null, reactionKey: null, castTimer: null, locked: false,
    };
  });

  // The purple wave a Hiss sends from the serpent's card to the opponent's.
  const wave = el('div', 'cast-wave', root);
  wave.setAttribute('aria-hidden', 'true');
  let waveTimer = null;

  const toast = el('div', 'toast glass', root);
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.dataset.hudBox = 'toast';
  toast.hidden = true;

  root.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    // A touch long press on a skill shows its tooltip, not a cancel.
    if (pressed || skipClick) return;
    onCancel?.();
  });

  // --- The Free Action effects (view model: cast, reaction, lock) ---
  const reducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  // A shake of the whole card with the Web Animations API, on `translate`
  // only, so the card's --card-scale transform and its fold animation stay.
  const shake = (dom, light) => {
    if (reducedMotion() || typeof dom.card.animate !== 'function') return;
    dom.card.animate(shakeFrames(light), { duration: HUD_SHAKE_MS, easing: 'ease-out' });
  };
  // The wave crosses from the middle of card `from` to the middle of card `to`.
  const sendWave = (from, to) => {
    const area = root.getBoundingClientRect();
    const a = cards[from].card.getBoundingClientRect();
    const b = cards[to].card.getBoundingClientRect();
    const ax = a.left + a.width / 2 - area.left;
    const ay = a.top + a.height / 2 - area.top;
    wave.style.setProperty('--wave-x', `${ax}px`);
    wave.style.setProperty('--wave-y', `${ay}px`);
    wave.style.setProperty('--wave-dx', `${b.left + b.width / 2 - area.left - ax}px`);
    wave.style.setProperty('--wave-dy', `${b.top + b.height / 2 - area.top - ay}px`);
    wave.classList.remove('is-playing');
    void wave.offsetWidth; // restart the animation
    wave.classList.add('is-playing');
    clearTimeout(waveTimer);
    if (!holdCast) waveTimer = setTimeout(() => wave.classList.remove('is-playing'), HISS_WAVE_MS + 50);
  };
  const clearCast = (dom) => {
    clearTimeout(dom.castTimer);
    dom.castTimer = null;
    dom.card.classList.remove('is-cast', 'is-dust', 'is-feathers');
  };
  const playCast = (c, cast) => {
    const dom = cards[c];
    clearCast(dom);
    void dom.card.offsetWidth; // restart the animations of a new cast
    dom.card.style.setProperty('--cast-colour', cast.colour ?? 'var(--ink)');
    dom.card.classList.add('is-cast');
    if (cast.dust) dom.card.classList.add('is-dust');
    if (cast.feathers) dom.card.classList.add('is-feathers');
    if (cast.shake) shake(dom, false);
    if (cast.wave) sendWave(c, 1 - c);
    if (!holdCast) dom.castTimer = setTimeout(() => clearCast(dom), castDurationMs(cast) + 50);
  };
  // One card's effects for its part of the view model; a cast or a hit plays
  // once, when its key is new.
  const showCast = (c, card) => {
    const dom = cards[c];
    const castKey = card.cast?.key ?? null;
    if (castKey !== dom.castKey) {
      dom.castKey = castKey;
      if (card.cast) playCast(c, card.cast);
      else clearCast(dom);
    }
    const reactionKey = card.reaction?.key ?? null;
    if (reactionKey !== dom.reactionKey) {
      dom.reactionKey = reactionKey;
      if (card.reaction) shake(dom, true);
    }
    const locked = card.lock !== null;
    if (dom.locked !== locked) {
      dom.locked = locked;
      dom.card.classList.toggle('is-locked', locked);
      dom.rune.hidden = !locked;
    }
    if (locked) {
      setText(dom.runeText, card.lock.text);
      setAttr(dom.rune, 'aria-label', card.lock.text);
    }
  };

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
  // size or the orientation changes, or a card folds, not per frame. The
  // height that counts is the last measured height of the full card, or
  // the pill's when both cards are folded (hudFoldLayout).
  let cardHeight = CARD_HEIGHT;
  let compact = false;
  let foldable = true;
  const layout = () => {
    if (root.hidden) return;
    if (!compact) {
      for (const dom of cards) if (!dom.folded) cardHeight = Math.max(CARD_HEIGHT, dom.card.offsetHeight);
    }
    const collapsed = { [X]: cards[0].collapsed, [O]: cards[1].collapsed };
    const { layout: next, foldable: fits } = hudFoldLayout(window.innerWidth, window.innerHeight, { collapsed, cardHeight });
    const top = topBarLayout(window.innerWidth, window.innerHeight, next, { fullscreen: !fullscreen.hidden });
    root.classList.toggle('fs-below', top.fullscreenBelow);
    root.classList.toggle('tools-below', top.toolsBelow); // the Leave match button too (leave-match.js)
    root.classList.toggle('no-fullscreen', fullscreen.hidden);
    compact = next.compact;
    foldable = fits;
    root.classList.toggle('is-compact', next.compact);
    root.classList.toggle('is-rail', next.rail);
    root.classList.toggle('is-stacked', next.stacked);
    // Where no pill fits (the slim layouts, the smallest full cards) the
    // chevrons hide and the cards stay full; the saved choice is kept.
    root.classList.toggle('no-fold', !fits);
    const value = String(next.scale);
    if (root.style.getPropertyValue('--card-scale') !== value) root.style.setProperty('--card-scale', value);
    const pill = String(pillScale(next.scale, window.innerWidth, window.innerHeight));
    if (root.style.getPropertyValue('--pill-scale') !== pill) root.style.setProperty('--pill-scale', pill);
    // The chevrons stay 44 px on screen however small the card or pill is drawn.
    const chevronCard = `${chevronSize(next.scale)}px`;
    if (root.style.getPropertyValue('--chevron-card') !== chevronCard) root.style.setProperty('--chevron-card', chevronCard);
    const chevronPill = `${chevronSize(pillScale(next.scale, window.innerWidth, window.innerHeight))}px`;
    if (root.style.getPropertyValue('--chevron-pill') !== chevronPill) root.style.setProperty('--chevron-pill', chevronPill);
    const width = `${next.railWidth}px`;
    if (root.style.getPropertyValue('--rail-width') !== width) root.style.setProperty('--rail-width', width);
    if (fold()) layout();
    else {
      placeTip();
      placePopup();
    }
  };
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);
  document.fonts?.ready.then(layout);

  // Shows each card folded or not: folded when the view model says
  // collapsed and a pill fits (not in the slim layouts; there the saved
  // choice is ignored, not erased). Returns true if a card changed.
  function fold() {
    let changed = false;
    for (const dom of cards) {
      const folded = dom.collapsed && foldable;
      if (dom.folded === folded) continue;
      changed = true;
      // Focus on a part that hides moves to the chevron, which stays.
      const lost = dom.card.contains(document.activeElement) && document.activeElement !== dom.chevron;
      if (lost || (tipOwner && dom.card.contains(tipOwner.button))) hideTip();
      if (popupOwner && dom.card.contains(popupOwner.button)) hidePopup();
      dom.folded = folded;
      dom.card.classList.toggle('is-collapsed', folded);
      dom.card.dataset.hudBox = `${folded ? 'pill' : 'card'}-${dom.team}`;
      dom.body.hidden = folded;
      dom.text.hidden = folded;
      dom.pillSkills.hidden = !folded;
      if (lost) dom.chevron.focus({ preventScroll: true });
    }
    return changed;
  }

  // The tooltip: one element, shown for one skill button at a time.
  let tipOwner = null; // { button, c, s }
  let hoverTimer = null;
  let pressTimer = null;
  let pressed = false;
  function fillTip() {
    const view = cards[tipOwner.c].skills[tipOwner.s].view;
    if (view) fillSkillCard(tipCard, view);
  }
  function showTip(button, c, s) {
    clearTimeout(hoverTimer);
    if (popupOwner) return; // the open popup already says it all
    if (tipOwner && tipOwner.button !== button) tipOwner.button.removeAttribute('aria-describedby');
    tipOwner = { button, c, s };
    button.setAttribute('aria-describedby', TOOLTIP_ID);
    fillTip();
    tip.hidden = false;
    placeTip();
  }
  // Places the open tooltip next to its button. Runs when it opens, when
  // its text changes and after every layout (resize, orientation, fold),
  // so it never stays where the button was. A button that is no longer
  // drawn closes it.
  function placeTip() {
    if (!tipOwner) return;
    const rect = tipOwner.button.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      hideTip();
      return;
    }
    const at = tooltipPosition(rect, { width: tip.offsetWidth, height: tip.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight });
    tip.style.left = `${at.left}px`;
    tip.style.top = `${at.top}px`;
    tip.dataset.placement = at.placement;
  }
  function hideTip() {
    clearTimeout(hoverTimer);
    hoverTimer = null;
    if (tipOwner) tipOwner.button.removeAttribute('aria-describedby');
    tipOwner = null;
    tip.hidden = true;
  }
  // Hover after TOOLTIP_SHOW_MS and keyboard focus at once, on the full
  // cards and the pills; a long touch press everywhere, the slim bars too.
  function attachTip(button, c, s) {
    button.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'mouse' || compact) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => showTip(button, c, s), TOOLTIP_SHOW_MS);
    });
    button.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse') hideTip();
    });
    button.addEventListener('focus', () => {
      if (!compact && button.matches(':focus-visible')) showTip(button, c, s);
    });
    button.addEventListener('blur', hideTip);
    button.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch') return;
      clearTimeout(pressTimer);
      pressed = true;
      pressTimer = setTimeout(() => {
        skipClick = button;
        showTip(button, c, s);
      }, TOOLTIP_LONG_PRESS_MS);
    });
    const release = () => {
      clearTimeout(pressTimer);
      pressed = false;
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', () => {
      release();
      skipClick = null;
    });
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && tipOwner) hideTip();
    if (event.key === 'Escape' && popupOwner) hidePopup();
  });

  // The skill detail popup: one element, for the skill last clicked. It
  // reads the latest view model, so its state text follows the game.
  let popupOwner = null; // { button, player, skillId, c }
  let lastVm = null;
  function fillPopup() {
    const view = lastVm && skillPopupViewModel(lastVm, popupOwner.player, popupOwner.skillId);
    if (!view) return;
    fillSkillCard(popCard, view);
    setAttr(popup, 'aria-label', view.title);
  }
  function openPopup(button, player, skillId, c) {
    popupOwner = { button, player, skillId, c };
    button.setAttribute('aria-controls', POPUP_ID);
    fillPopup();
    popup.hidden = false;
    placePopup();
  }
  // Below (or above) the button's card, like the tooltip is to its button,
  // so it covers neither the card nor its other skill. A button that is no
  // longer drawn closes it.
  function placePopup() {
    if (!popupOwner) return;
    const rect = popupOwner.button.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      hidePopup();
      return;
    }
    const at = tooltipPosition(cards[popupOwner.c].card.getBoundingClientRect(),
      { width: popup.offsetWidth, height: popup.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
    popup.style.left = `${at.left}px`;
    popup.style.top = `${at.top}px`;
    popup.dataset.placement = at.placement;
  }
  function hidePopup() {
    if (popupOwner) popupOwner.button.removeAttribute('aria-controls');
    popupOwner = null;
    popup.hidden = true;
  }
  // A long press that ends without a click (moved off) must not eat the
  // next one, and a touch anywhere else closes its tooltip.
  window.addEventListener('pointerdown', (event) => {
    if (skipClick && !skipClick.contains(event.target)) skipClick = null;
    if (tipOwner && event.pointerType === 'touch' && !tipOwner.button.contains(event.target)) hideTip();
    // A press outside the popup and its button closes it (and still goes on
    // to whatever it pressed, the board too).
    if (popupOwner && !popup.contains(event.target) && !popupOwner.button.contains(event.target)) hidePopup();
  }, true);

  // A skill row now shows another skill (the characters of a new game).
  const setSkill = (row, skillId) => {
    row.slot.id = skillId;
    row.button.dataset.hudBox = `skill-${skillId}`;
    row.pill.dataset.hudBox = `pill-skill-${skillId}`;
    for (const icon of [row.icon, row.picon]) {
      icon.name = SKILL_ICON_ART[skillId];
      icon.initial.textContent = skillLetters(skillId);
      icon.img.removeAttribute('src');
    }
    showArt();
  };

  const setQuality = (level) => {
    if (root.dataset.quality !== level) root.dataset.quality = level;
  };

  return {
    // Shows the view model of hudViewModel().
    render(vm) {
      lastVm = vm;
      setQuality(vm.quality);
      setAttr(turn, 'data-team', vm.turn.team);
      setText(turnWho, vm.turn.who);
      setText(turnHint, vm.turn.hint ?? '');
      setAttr(turn, 'title', vm.hint ?? '');
      vm.qualityChoices.forEach((choice, i) => setAttr(qualityButtons[i], 'aria-pressed', String(choice.pressed)));

      vm.cards.forEach((card, c) => {
        const dom = cards[c];
        // The portrait of the character playing this side (a new game may
        // seat other characters).
        if (dom.portrait.name !== card.portrait) {
          dom.portrait.name = card.portrait;
          dom.portrait.initial.textContent = card.name[0];
          dom.portrait.img.removeAttribute('src');
          showArt();
        }
        setText(dom.name, card.name);
        setText(dom.meta, card.meta);
        setText(dom.chipText, card.chip);
        showCast(c, card);
        dom.card.classList.toggle('is-waiting', card.waiting);
        dom.card.classList.toggle('is-winner', card.winner);
        dom.card.classList.toggle('is-active', card.active);
        setAttr(dom.chevron, 'aria-label', card.chevronLabel);
        setAttr(dom.chevron, 'aria-expanded', String(!card.collapsed));
        if (dom.collapsed !== card.collapsed) {
          dom.collapsed = card.collapsed;
          if (fold()) layout();
        }
        setAttr(dom.card, 'aria-label', card.name);
        card.skills.forEach((skill, s) => {
          const row = dom.skills[s];
          row.view = skill;
          if (row.slot.id !== skill.id) setSkill(row, skill.id);
          if (row.look !== skill.look) {
            for (const button of [row.button, row.pill]) {
              if (row.look && LOOK_CLASSES[row.look]) button.classList.remove(LOOK_CLASSES[row.look]);
              if (LOOK_CLASSES[skill.look]) button.classList.add(LOOK_CLASSES[skill.look]);
            }
            row.look = skill.look;
          }
          for (const button of [row.button, row.pill]) button.classList.toggle('is-dimmed', skill.dimmed);
          setAttr(row.pill, 'data-state', skill.state);
          setText(row.title, skill.title);
          setText(row.state, skill.stateText);
          const count = skill.cooldownTurns > 0 ? String(skill.cooldownTurns) : '';
          setText(row.count, count);
          setText(row.pcount, count);
          const percent = Math.round(skill.cooldownProgress * 100);
          if (row.progress !== percent) {
            row.ring.style.setProperty('--p', String(percent));
            const dash = (RING_LENGTH * percent) / 100;
            row.arc.setAttribute('stroke-dasharray', `${dash.toFixed(1)} ${RING_LENGTH.toFixed(1)}`);
            row.progress = percent;
          }
          for (const button of [row.button, row.pill]) {
            setAttr(button, 'aria-label', skill.ariaLabel);
            setAttr(button, 'aria-disabled', String(skill.disabled));
            setAttr(button, 'aria-pressed', String(skill.selected));
          }
        });
      });
      if (tipOwner) {
        fillTip();
        placeTip();
      }
      if (popupOwner) {
        fillPopup();
        placePopup();
      }

      const message = vm.toast ?? '';
      setText(toast, message);
      if (toast.hidden !== !message) toast.hidden = !message;
    },

    // Sets data-quality: Low is solid, Medium blurs 10 px, High 18 px.
    setQuality,

    // Opens the popup of `skillId` on the card of `player` as a click would,
    // also in the slim layouts (the screenshot tool shows it on the phone
    // shape). Needs a rendered view model; false when there is no such skill
    // or its button is not drawn.
    openSkillPopup(player, skillId) {
      const c = player === X ? 0 : 1;
      const row = lastVm && cards[c].skills.find((r) => r.slot.id === skillId);
      if (!row) return false;
      hideTip();
      openPopup(cards[c].folded ? row.pill : row.button, player, skillId, c);
      return popupOwner !== null;
    },

    show(visible) {
      if (root.hidden === visible) {
        root.hidden = !visible;
        if (!visible) {
          hideTip();
          hidePopup();
        }
        layout();
      }
    },

    // False while the HUD is hidden and where the cards never fold (the
    // slim layouts and the windows too small for a pill): the C key then
    // does nothing.
    canCollapse() {
      return !root.hidden && foldable;
    },

    // Shows the Fullscreen button from fullscreenViewModel() (fullscreen.js):
    // hidden without the Fullscreen API, else its label and pressed state.
    setFullscreen(vm) {
      setAttr(fullscreen, 'aria-label', vm.ariaLabel);
      setAttr(fullscreen, 'aria-pressed', String(vm.pressed));
      if (fullscreen.hidden === vm.visible) {
        fullscreen.hidden = !vm.visible;
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

// The letters shown while a skill icon is missing: Wind Dash gives WD.
function skillLetters(skillId) {
  return getSkill(skillId).name.split(' ').map((word) => word[0]).join('');
}
