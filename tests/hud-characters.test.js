// The Ivory HUD (docs/hud-characters.md): cards, pills and the skill popup are
// paper like the menus, and the character is a colour that spreads from its
// portrait (data-character). The view model names the character, hud.js puts
// it on the card, the popup and the tooltip, and hud.css holds one token block
// per character. The shapes are the same for all four, and no piece of art has
// a border.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { O, X } from '../src/logic/board.js';
import { CHARACTERS, CLOUD_EAGLE, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT } from '../src/logic/characters.js';
import { newGame } from '../src/logic/game.js';
import { CHEVRON_SIZE, MIN_PILL_SCALE, PILL_BORDER, PILL_GAP, PILL_HEIGHT, PILL_PAD, PILL_TILE, PILL_WIDTH } from '../src/ui/hud-layout.js';
import { hudViewModel, skillPopupViewModel } from '../src/ui/hud-view.js';
import { createHud } from '../src/ui/hud.js';
import { byClass, fakeElement, installFakeWindow } from './fake-hud-dom.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/ui/hud.css');
const SECTION = css.slice(css.indexOf('/* ===== Ivory HUD'));
const hudSource = read('../src/ui/hud.js');
const IDS = Object.keys(CHARACTERS);

// The rules of the Ivory section: { selector, body }.
const rules = [...SECTION.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim() }));
const rule = (selector) => rules.find((r) => r.selector === selector)?.body;
const props = (body) => body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => d.slice(0, d.indexOf(':')).trim());
const tokenValue = (body, name) => new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1].trim();

const MATCHUPS = [{ [X]: WIND_RABBIT, [O]: EARTH_BEAR }, { [X]: JADE_SERPENT, [O]: CLOUD_EAGLE }, { [X]: CLOUD_EAGLE, [O]: WIND_RABBIT }];

function setup(vm) {
  const fake = installFakeWindow();
  const root = fakeElement('div');
  root.hidden = true;
  const hud = createHud(root, { onSkill() {}, onQuality() {}, onCancel() {} });
  hud.render(vm);
  hud.show(true);
  return { ...fake, root, hud, cards: byClass(root, 'card') };
}

test('the view model names the character of each card, each skill row and the popup', () => {
  for (const characters of MATCHUPS) {
    const state = newGame({ characters });
    const vm = hudViewModel(state, {}, null);
    assert.deepEqual(vm.cards.map((card) => card.character), [characters[X], characters[O]]);
    for (const card of vm.cards) {
      for (const skill of card.skills) {
        assert.equal(skill.character, card.character, skill.id);
        assert.equal(skillPopupViewModel(vm, card.player, skill.id).character, card.character, skill.id);
      }
    }
  }
});

test('hud.js gives each card and skill button its character and skill, follows a new game, and tells the popup', () => {
  const t = setup(hudViewModel(newGame({ characters: MATCHUPS[0] }), {}, null));
  try {
    assert.deepEqual(t.cards.map((card) => card.dataset.character), [WIND_RABBIT, EARTH_BEAR]);
    t.hud.render(hudViewModel(newGame({ characters: MATCHUPS[1] }), {}, null));
    assert.deepEqual(t.cards.map((card) => card.dataset.character), [JADE_SERPENT, CLOUD_EAGLE]);
    for (const card of t.cards) {
      const ids = CHARACTERS[card.dataset.character].skills;
      assert.deepEqual(byClass(card, 'skill').map((b) => b.dataset.skill), ids);
      assert.deepEqual(byClass(card, 'pskill').map((b) => b.dataset.skill), ids);
    }
    // The popup of a skill takes its character and skill (the colour of the wash, Venom's purple).
    assert.equal(t.hud.openSkillPopup(X, 'venom'), true);
    const popup = byClass(t.root, 'skill-popup')[0];
    assert.equal(popup.attrs['data-character'], JADE_SERPENT);
    assert.equal(popup.attrs['data-skill'], 'venom');
  } finally {
    t.restore();
  }
});

test('every skill row has the cooldown badge at its end, and the HUD has no ornament layer', () => {
  const t = setup(hudViewModel(newGame({ characters: MATCHUPS[0] }), {}, null));
  try {
    for (const card of t.cards) {
      assert.equal(byClass(card, 'orn').length, 0, 'the colour is a gradient, not drawn art');
      for (const button of byClass(card, 'skill')) {
        assert.equal(byClass(button, 'count').length, 1);
        assert.ok(byClass(button, 'ico').every((ico) => byClass(ico, 'count').length === 0), 'the badge is not inside the icon');
        assert.equal(button.children.at(-1).className.split(' ')[0], 'count', 'last in the row');
      }
    }
  } finally {
    t.restore();
  }
  assert.equal(existsSync(new URL('../src/ui/hud-ornaments.js', import.meta.url)), false);
  assert.doesNotMatch(hudSource, /hud-ornaments|rule-art|'orn'/);
});

test('hud.css has one colour token block per character and a purple Venom', () => {
  const blocks = IDS.map((id) => rule(`.hud [data-character="${id}"]`));
  for (const [i, body] of blocks.entries()) {
    assert.ok(body, `${IDS[i]} has a token block`);
    assert.deepEqual(props(body).sort(), ['--c-acc', '--c-deep'], IDS[i]);
    assert.match(tokenValue(body, '--c-acc'), /^#[0-9a-f]{6}$/i);
  }
  assert.equal(new Set(blocks.map((b) => tokenValue(b, '--c-acc'))).size, 4, 'four different colours');
  // The colours of the characters are the game's mark colours (character-look.js).
  assert.equal(tokenValue(rule('.hud [data-character="windRabbit"]'), '--c-acc'), '#3b8cff');
  assert.equal(tokenValue(rule('.hud [data-character="earthBear"]'), '--c-acc'), '#c9703a');
  assert.equal(tokenValue(rule('.hud [data-character="jadeSerpent"]'), '--c-acc'), '#2fbf7a');
  const venom = rule('.hud [data-character="jadeSerpent"] [data-skill="venom"], .hud [data-character][data-skill="venom"]');
  assert.deepEqual(props(venom).sort(), ['--c-acc', '--c-deep']);
});

test('the HUD paper is the menus\' Ivory palette', () => {
  const screens = read('../src/ui/screens.css');
  const ivory = screens.slice(screens.indexOf('#screens {'), screens.indexOf('}', screens.indexOf('#screens {')));
  const root = rule('.hud');
  assert.ok(root, 'the HUD root tokens');
  for (const name of ['--ink', '--ink-2', '--ink-3', '--card-solid', '--hair', '--row', '--ready']) {
    assert.equal(tokenValue(root, name), tokenValue(ivory, name), `${name} is the menus' value`);
  }
  assert.equal(tokenValue(root, '--accent'), tokenValue(ivory, '--gold'), 'the gold of the labels');
  // The cast banner keeps its own navy plaque and its light text.
  assert.match(rule('.hud .cast-banner'), /--ink: #f4f7fb/);
});

test('no colour outside a token block, and the colour of a piece is the character\'s', () => {
  const tokenSelectors = new Set(['.hud', ...IDS.map((id) => `.hud [data-character="${id}"]`),
    '.hud [data-character="jadeSerpent"] [data-skill="venom"], .hud [data-character][data-skill="venom"]', '.hud .cast-banner']);
  for (const { selector, body } of rules) {
    if (tokenSelectors.has(selector)) continue;
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, `hex colour in ${selector}`);
  }
  const text = rules.filter((r) => !tokenSelectors.has(r.selector)).map((r) => r.body).join(' ');
  assert.match(text, /radial-gradient\(120% 90% at 0% 0%, color-mix\(in srgb, var\(--c-acc\) 40%/, 'the wash spreads from the portrait corner');
  assert.doesNotMatch(text, /blur\(/, 'paper has no blur: the battery');
});

test('no piece of art has a border: the portrait, the icons and the pill\'s buttons', () => {
  for (const selector of [
    '.hud .card[data-character] .tile', '.hud .card[data-character] .skill .ico', '.hud .card[data-character] .skill', '.hud .card[data-character] .pskill',
    '.hud .card[data-character] .chevron',
  ]) {
    assert.match(rule(selector), /border: 0/, selector);
  }
  assert.match(rule('.hud .card[data-character] .tile'), /box-shadow: 0 8px 18px color-mix/, 'a soft glow of the colour instead');
  assert.match(rule('.hud .card[data-character] .skill .ico'), /box-shadow: 0 4px 10px color-mix/);
});

test('the shapes are the same for every character', () => {
  const SHAPE = /^(border-radius|clip-path|width|height|transform)$/;
  for (const { selector, body } of rules) {
    if (!/\[data-character="[a-zA-Z]+"\]/.test(selector) || /\.card|\.tooltip|\.skill-popup/.test(selector)) continue;
    for (const name of props(body)) assert.ok(name.startsWith('--') && !SHAPE.test(name), `${selector} sets ${name}`);
  }
  assert.match(SECTION, /\.card\[data-character\]:not\(\.is-collapsed\) \.tile \{ width: 58px; height: 58px; border-radius: 16px; \}/);
  assert.match(SECTION, /\.skill \.ico \{ width: 44px; height: 44px; flex: none; border-radius: 12px; \}/);
  assert.match(SECTION, /\.card\.is-collapsed\[data-character\] \.tile \{ width: 48px; height: 48px; border-radius: 50%; \}/);
  assert.match(SECTION, /\.pskill \{ width: 48px; height: 48px; border: 0; border-radius: 50%;/);
});

test('the pill is one round capsule whose size the layout knows', () => {
  assert.equal(PILL_TILE, 48);
  assert.equal(PILL_WIDTH, 2 * (PILL_PAD + PILL_BORDER) + 3 * PILL_TILE + 3 * PILL_GAP + CHEVRON_SIZE - 2);
  assert.equal(PILL_HEIGHT, 2 * (PILL_PAD + PILL_BORDER) + PILL_TILE);
  assert.ok(MIN_PILL_SCALE * PILL_TILE >= 44 - 1e-9, 'the skill buttons keep 44 px');
  assert.match(SECTION, /\.card\.is-collapsed\[data-character\] \{ padding: 6px; gap: 8px; border-radius: 999px;/);
});

test('cooling down is one thing for every character: a dim icon and a badge, no ring and no bar', () => {
  assert.match(SECTION, /\.skill\.is-cooling \.ico img, [^{]*\{ opacity: 0\.5; \}/);
  assert.match(SECTION, /\.skill \.count \{ display: none;/);
  assert.match(SECTION, /\.skill\.is-cooling \.count \{ display: flex; \}/);
  assert.match(SECTION, /\.skill \.ring \{ display: none !important; \}/);
  assert.match(SECTION, /\.pskill \.pring \{ display: none !important; \}/);
});

test('the whole HUD is paper: the turn pill, the quality switch and the toast read their tokens', () => {
  const root = rule('.hud');
  assert.equal(tokenValue(root, '--card-solid'), '#fffdf8');
  assert.match(rule('.hud .quality button[aria-pressed="true"]'), /background: var\(--ink\); color: var\(--card-solid\)/);
  for (const file of ['announce.css', 'leave-match.css']) {
    assert.match(read(`../src/ui/${file}`), /--card-solid: #fffdf8;/, `${file} uses the paper too`);
  }
});

test('the slim bars and low quality take the paper too', () => {
  assert.match(SECTION, /\.hud\.is-compact \.card\[data-character\] \{ border-radius: 22px; \}/);
  assert.match(SECTION, /\.hud\[data-quality="low"\] \.card\[data-character\] \{ box-shadow: none; \}/);
  assert.match(SECTION, /\.hud \.glass, \.hud\[data-quality\] \.glass \{ -webkit-backdrop-filter: none; backdrop-filter: none;/);
  // The status chip takes the colour on the slim bars as well.
  assert.match(SECTION, /\.hud \.card\[data-character\] \.chip \{ background: color-mix\(in srgb, var\(--c-acc\) 22%/);
});
