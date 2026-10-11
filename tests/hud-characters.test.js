// The character HUDs (docs/hud-characters.md): every card and pill takes the
// look of the character that plays it. The view model names the character,
// hud.js puts it in data-character, hud-ornaments.js draws the ornaments, and
// hud.css holds one token block per character. The shapes of the controls are
// the same for all four, so no rule of one character may set them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { O, X } from '../src/logic/board.js';
import { CHARACTERS, CLOUD_EAGLE, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT } from '../src/logic/characters.js';
import { newGame } from '../src/logic/game.js';
import { CARD_ART_HTML, ORNAMENT_CHARACTERS, RULE_ART_HTML } from '../src/ui/hud-ornaments.js';
import { CHEVRON_SIZE, MIN_PILL_SCALE, PILL_BORDER, PILL_GAP, PILL_HEIGHT, PILL_PAD, PILL_TILE, PILL_WIDTH } from '../src/ui/hud-layout.js';
import { hudViewModel } from '../src/ui/hud-view.js';
import { createHud } from '../src/ui/hud.js';
import { byClass, fakeElement, installFakeWindow } from './fake-hud-dom.js';

const css = readFileSync(new URL('../src/ui/hud.css', import.meta.url), 'utf8');
const SECTION = css.slice(css.indexOf('/* ===== Character HUDs'));
const IDS = Object.keys(CHARACTERS);

// The rules of the character section: { selector, body }.
const rules = [...SECTION.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2].trim() }));
const tokenBlock = (id) => rules.find((r) => r.selector === `.hud .card[data-character="${id}"]`);
const props = (body) => body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => d.slice(0, d.indexOf(':')).trim());

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

test('the view model names the character of each card', () => {
  for (const characters of MATCHUPS) {
    const vm = hudViewModel(newGame({ characters }), {}, null);
    assert.deepEqual(vm.cards.map((card) => card.character), [characters[X], characters[O]]);
  }
});

test('hud.js gives each card and each skill button its character and skill, and follows a new game', () => {
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
  } finally {
    t.restore();
  }
});

test('every card has the ornament layer, the rule after SKILLS, and the cooldown badge at the end of the row', () => {
  const t = setup(hudViewModel(newGame({ characters: MATCHUPS[0] }), {}, null));
  try {
    for (const card of t.cards) {
      assert.equal(byClass(card, 'orn').length, 1);
      assert.equal(byClass(card, 'orn')[0].attrs['aria-hidden'], 'true');
      assert.equal(byClass(card, 'rule-art').length, 1);
      for (const button of byClass(card, 'skill')) {
        assert.equal(byClass(button, 'count').length, 1);
        assert.ok(byClass(button, 'ico').every((ico) => byClass(ico, 'count').length === 0), 'the badge is not inside the icon');
        assert.equal(button.children.at(-1).className.split(' ')[0], 'count', 'last in the row');
      }
    }
  } finally {
    t.restore();
  }
});

test('the ornaments are pure strings with a piece for every character and no colour of their own', () => {
  assert.deepEqual([...ORNAMENT_CHARACTERS].sort(), [...IDS].sort());
  for (const id of IDS) {
    assert.match(CARD_ART_HTML, new RegExp(`oa-${id}`), `${id} card art`);
    assert.match(RULE_ART_HTML, new RegExp(`ra-${id}`), `${id} rule art`);
  }
  for (const art of [CARD_ART_HTML, RULE_ART_HTML]) {
    assert.doesNotMatch(art, /#[0-9a-fA-F]{3,8}\b|rgba?\(|fill="(?!none)|stroke="(?!none)/, 'colours come from hud.css tokens');
    assert.equal((art.match(/<svg/g) ?? []).length, (art.match(/<\/svg>/g) ?? []).length, 'balanced svg');
  }
});

test('hud.css has one token block per character, all with the same tokens', () => {
  const blocks = IDS.map((id) => {
    const block = tokenBlock(id);
    assert.ok(block, `${id} has a token block`);
    return new Set(props(block.body));
  });
  const [first, ...rest] = blocks;
  for (const [i, tokens] of rest.entries()) {
    // The ornament and rule colours differ in number (a character uses only the pieces it draws).
    const core = (set) => [...set].filter((name) => name.startsWith('--c-')).sort();
    assert.deepEqual(core(tokens), core(first), `${IDS[i + 1]} has the --c- tokens of ${IDS[0]}`);
  }
  assert.ok([...first].includes('--c-radius') && [...first].includes('--c-chrome'));
});

test('no colour outside a token block, and every token a rule reads is defined', () => {
  const tokenSelectors = new Set([...IDS.map((id) => `.hud .card[data-character="${id}"]`), '.hud .card[data-character="jadeSerpent"] [data-skill="venom"]']);
  for (const { selector, body } of rules) {
    if (tokenSelectors.has(selector)) continue;
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, `hex colour in ${selector}`);
  }
  const defined = new Set(IDS.flatMap((id) => props(tokenBlock(id).body)));
  const read = new Set();
  for (const { selector, body } of rules) {
    if (tokenSelectors.has(selector)) continue;
    for (const m of `${body}`.matchAll(/var\((--[a-z0-9-]+)/g)) read.add(m[1]);
  }
  const outside = ['--ready', '--ink', '--gold', '--gold-ink', '--card-solid', '--p']; // the HUD's own tokens and the cooldown share
  for (const name of read) {
    if (outside.includes(name)) continue;
    assert.ok(defined.has(name), `${name} is read but no character defines it`);
  }
});

test('the shapes are the same for every character: no rule of one character sets them', () => {
  const SHAPE = /^(border-radius|clip-path|width|height|transform)$/;
  for (const { selector, body } of rules) {
    if (!/data-character="[a-zA-Z]+"/.test(selector) || /\.gem\b/.test(selector)) continue;
    for (const name of props(body)) {
      assert.ok(name.startsWith('--') || name === 'display', `${selector} sets ${name}`);
      assert.doesNotMatch(name, SHAPE);
    }
  }
  // The one rule of each control, for all characters.
  assert.match(SECTION, /\.hud:not\(\.is-compact\) \.card\[data-character\]:not\(\.is-collapsed\) \.tile \{ width: 58px; height: 58px; border-radius: 12px; \}/);
  assert.match(SECTION, /\.skill \.ico \{ width: 46px; height: 46px; flex: none; border-radius: 9px; \}/);
  assert.match(SECTION, /\.chevron \{ border: 2px solid var\(--c-chev-line\); border-radius: 10px;/);
});

test('the pill is one round capsule of round icons whose size the layout knows', () => {
  assert.equal(PILL_TILE, 48);
  assert.equal(PILL_WIDTH, 2 * (PILL_PAD + PILL_BORDER) + 3 * PILL_TILE + 3 * PILL_GAP + CHEVRON_SIZE - 2);
  assert.equal(PILL_HEIGHT, 2 * (PILL_PAD + PILL_BORDER) + PILL_TILE);
  assert.ok(MIN_PILL_SCALE * PILL_TILE >= 44 - 1e-9, 'the skill buttons keep 44 px');
  assert.match(SECTION, /\.card\.is-collapsed\[data-character\] \{ padding: 6px; gap: 8px; border-radius: 999px; \}/);
  assert.match(SECTION, /\.pskill \{ width: 48px; height: 48px; border: 0; border-radius: 50%;/);
  assert.match(SECTION, /\.card\.is-collapsed\[data-character\] \.tile \{ width: 48px; height: 48px; border-radius: 50%;/);
});

test('cooling down is one thing for every character: a dim icon, a dark sweep and a badge', () => {
  assert.match(SECTION, /\.skill \.ring \{ display: none;[^}]*conic-gradient\(from 0deg, transparent calc\(var\(--p, 0\) \* 3\.6deg\), var\(--c-sweep\) 0\)/);
  assert.match(SECTION, /\.skill\.is-cooling \.ring \{ display: block; \}/);
  assert.match(SECTION, /\.skill \.count \{ display: none;/);
  // No progress bar under the row.
  assert.doesNotMatch(SECTION, /\.skill[^{]*(track|bar)\b/);
});

test('the character look follows the quality switch and the slim bars', () => {
  assert.match(SECTION, /\.hud\[data-quality="low"\] \.card\[data-character\] \{[^}]*backdrop-filter: none; box-shadow: none;/);
  assert.match(SECTION, /\.hud\.is-compact \.card\[data-character\]::before, \.hud\.is-compact \.card\[data-character\] \.orn \{ display: none; \}/);
});
