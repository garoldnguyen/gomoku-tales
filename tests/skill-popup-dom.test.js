// The compact skill popup and tooltip (docs/skill-popup-design.md section 1):
// the view model of hud-view.js (skillPopupViewModel), the DOM of hud.js built
// on a fake DOM (tests/fake-hud-dom.js), and the look in hud.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { O, X } from '../src/logic/board.js';
import { CHARACTERS, CLOUD_EAGLE, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT } from '../src/logic/characters.js';
import { newGame } from '../src/logic/game.js';
import { SKILLS, TORNADO_ZONE } from '../src/logic/skills.js';
import { SKILL_ICON_ART, hudViewModel, skillPopupViewModel } from '../src/ui/hud-view.js';
import { createHud } from '../src/ui/hud.js';
import { FACTS_MAX, FACTS_MIN, RULES_MAX, RULES_MIN, RULE_MAX, SKILL_INFO } from '../src/ui/skill-info.js';
import { allNodes, byClass, fakeElement, fire, installFakeWindow } from './fake-hud-dom.js';

const css = readFileSync(new URL('../src/ui/hud.css', import.meta.url), 'utf8');

// The two matchups together hold all 8 skills.
const MATCHUPS = [{ [X]: WIND_RABBIT, [O]: EARTH_BEAR }, { [X]: JADE_SERPENT, [O]: CLOUD_EAGLE }];
const ALL_IDS = Object.keys(SKILLS);

const viewOf = (characters) => hudViewModel(newGame({ characters }), {}, null);

// A HUD on a fake window, showing the view model; restore() puts the globals back.
function setup(vm, size) {
  const fake = installFakeWindow(size);
  const root = fakeElement('div');
  root.hidden = true;
  const calls = [];
  const hud = createHud(root, { onSkill: (player, id) => calls.push([player, id]), onQuality() {}, onCancel() {} });
  hud.render(vm);
  hud.show(true);
  return {
    ...fake,
    root,
    hud,
    calls,
    popup: byClass(root, 'skill-popup')[0],
    tooltip: byClass(root, 'tooltip')[0],
    button: (id) => byClass(root, 'skill').find((b) => b.dataset.hudBox === `skill-${id}`),
  };
}

const textOf = (node, className) => byClass(node, className).map((n) => n.textContent);
const shownFacts = (node) => byClass(node, 'pop-fact').filter((cell) => !cell.hidden).map((cell) => ({
  label: textOf(cell, 'pop-fact-label')[0], value: textOf(cell, 'pop-fact-value')[0],
}));
const shownRules = (node) => byClass(node, 'pop-rule').filter((line) => !line.hidden).map((line) => line.textContent);

test('the popup view model has the header, brief, facts, rules and hint of all 8 skills', () => {
  const seen = [];
  for (const characters of MATCHUPS) {
    const state = newGame({ characters });
    const vm = hudViewModel(state, {}, null);
    for (const player of [X, O]) {
      for (const skillId of CHARACTERS[characters[player]].skills) {
        const popup = skillPopupViewModel(vm, player, skillId);
        const info = SKILL_INFO[skillId];
        assert.equal(popup.title, info.title, skillId);
        assert.equal(popup.characterName, CHARACTERS[characters[player]].name, `${skillId} names the character of the card`);
        assert.equal(popup.icon, SKILL_ICON_ART[skillId], skillId);
        assert.ok(popup.icon, `${skillId} has an icon art key`);
        assert.equal(popup.brief, info.brief, skillId);
        assert.deepEqual(popup.facts, info.facts, skillId);
        assert.deepEqual(popup.rules, info.rules, skillId);
        assert.equal(popup.hint, info.hint, skillId);
        assert.ok(['ready', 'selected', 'cooling', 'waiting'].includes(popup.state), `${skillId} state ${popup.state}`);
        assert.ok(popup.stateText.length > 0, skillId);
        seen.push(skillId);
      }
    }
  }
  assert.deepEqual(seen.sort(), ALL_IDS.slice().sort());
});

test('the popup shows the header, the brief, the facts, the rules and the hint', () => {
  const ui = setup(viewOf(MATCHUPS[0]));
  try {
    assert.equal(ui.popup.hidden, true, 'closed until a skill is pressed');
    fire(ui.button(TORNADO_ZONE), 'click');
    assert.deepEqual(ui.calls, [[X, TORNADO_ZONE]], 'the press still runs the skill');
    assert.equal(ui.popup.hidden, false);
    const info = SKILL_INFO[TORNADO_ZONE];
    assert.deepEqual(textOf(ui.popup, 'pop-title'), [info.title]);
    assert.deepEqual(textOf(ui.popup, 'pop-char'), ['Wind Rabbit'], 'the character name');
    assert.deepEqual(textOf(ui.popup, 'tip-state'), ['Ready']);
    assert.equal(byClass(ui.popup, 'tip-state')[0].getAttribute('data-state'), 'ready');
    assert.equal(byClass(ui.popup, 'pop-hair').length, 1, 'one hairline under the header');
    assert.deepEqual(textOf(ui.popup, 'pop-brief'), [info.brief]);
    assert.deepEqual(shownFacts(ui.popup), info.facts.map(({ label, value }) => ({ label, value })));
    assert.deepEqual(shownRules(ui.popup), info.rules);
    assert.deepEqual(textOf(ui.popup, 'pop-hint'), [info.hint]);
    const icon = byClass(ui.popup, 'pop-ico')[0];
    assert.equal(icon.children.length, 2, 'the icon art and its letters');
    assert.equal(ui.popup.getAttribute('aria-label'), info.title);
    assert.equal(ui.popup.dataset.hudBox, 'skill-popup');
  } finally {
    ui.restore();
  }
});

test('the tooltip shows only the header, the brief and the facts, never the rules or the hint', () => {
  const ui = setup(viewOf(MATCHUPS[1]));
  try {
    const venom = 'venom';
    fire(ui.button(venom), 'focus');
    assert.equal(ui.tooltip.hidden, false);
    const info = SKILL_INFO[venom];
    assert.deepEqual(textOf(ui.tooltip, 'pop-title'), [info.title]);
    assert.deepEqual(textOf(ui.tooltip, 'pop-char'), ['Jade Serpent']);
    assert.deepEqual(textOf(ui.tooltip, 'tip-state'), ['Ready']);
    assert.deepEqual(textOf(ui.tooltip, 'pop-brief'), [info.brief]);
    assert.deepEqual(shownFacts(ui.tooltip), info.facts.map(({ label, value }) => ({ label, value })));
    assert.equal(byClass(ui.tooltip, 'pop-rule').length, 0, 'no rules in the tooltip');
    assert.equal(byClass(ui.tooltip, 'pop-hint').length, 0, 'no hint in the tooltip');
    assert.equal(ui.popup.hidden, true, 'the tooltip is not the popup');
    fire(ui.button(venom), 'click');
    assert.equal(ui.tooltip.hidden, true, 'a press swaps the tooltip for the popup');
    assert.equal(ui.popup.hidden, false);
    assert.deepEqual(shownRules(ui.popup), info.rules);
  } finally {
    ui.restore();
  }
});

test('every skill popup has 2 or 3 facts and 2 to 4 rule lines of at most 44 characters', () => {
  assert.equal(RULE_MAX, 44);
  const seen = [];
  for (const characters of MATCHUPS) {
    const ui = setup(viewOf(characters));
    try {
      for (const player of [X, O]) {
        for (const skillId of CHARACTERS[characters[player]].skills) {
          assert.equal(ui.hud.openSkillPopup(player, skillId), true, skillId);
          const facts = shownFacts(ui.popup);
          const rules = shownRules(ui.popup);
          assert.ok(facts.length >= FACTS_MIN && facts.length <= FACTS_MAX, `${skillId} facts ${facts.length}`);
          assert.ok(rules.length >= RULES_MIN && rules.length <= RULES_MAX, `${skillId} rules ${rules.length}`);
          for (const rule of rules) assert.ok(rule.length <= RULE_MAX, `${skillId}: "${rule}" is ${rule.length} characters`);
          assert.deepEqual(rules, SKILL_INFO[skillId].rules, skillId);
          // The cells a skill does not use are hidden and empty.
          for (const cell of byClass(ui.popup, 'pop-fact').filter((c) => c.hidden)) assert.deepEqual(textOf(cell, 'pop-fact-label'), ['']);
          for (const line of byClass(ui.popup, 'pop-rule').filter((l) => l.hidden)) assert.equal(line.textContent, '');
          seen.push(skillId);
        }
      }
    } finally {
      ui.restore();
    }
  }
  assert.deepEqual(seen.sort(), ALL_IDS.slice().sort());
});

test('a new game with other characters changes the popup rows and the icon', () => {
  const ui = setup(viewOf(MATCHUPS[0]));
  try {
    ui.hud.openSkillPopup(X, TORNADO_ZONE);
    assert.deepEqual(textOf(ui.popup, 'pop-char'), ['Wind Rabbit']);
    ui.hud.render(viewOf(MATCHUPS[1]));
    assert.equal(ui.popup.hidden, false, 'still open: the button now holds another skill');
    ui.hud.openSkillPopup(X, 'hiss');
    assert.deepEqual(textOf(ui.popup, 'pop-title'), ['Hiss']);
    assert.deepEqual(textOf(ui.popup, 'pop-char'), ['Jade Serpent']);
    assert.equal(ui.hud.openSkillPopup(X, TORNADO_ZONE), false, 'a skill the card does not have opens nothing');
  } finally {
    ui.restore();
  }
});

test('the popup closes on Escape and on a press outside, and not on a press on itself', () => {
  const ui = setup(viewOf(MATCHUPS[0]));
  try {
    fire(ui.button(TORNADO_ZONE), 'click');
    assert.equal(ui.popup.hidden, false);
    ui.fireWindow('keydown', { key: 'Enter' });
    assert.equal(ui.popup.hidden, false);
    ui.fireWindow('keydown', { key: 'Escape' });
    assert.equal(ui.popup.hidden, true);
    fire(ui.button(TORNADO_ZONE), 'click');
    ui.fireWindow('pointerdown', { target: ui.popup, pointerType: 'mouse' });
    assert.equal(ui.popup.hidden, false, 'a press on the popup is not outside');
    ui.fireWindow('pointerdown', { target: fakeElement('canvas'), pointerType: 'mouse' });
    assert.equal(ui.popup.hidden, true);
  } finally {
    ui.restore();
  }
});

test('the phone layout opens no popup by a click, but openSkillPopup shows the same content there', () => {
  const ui = setup(viewOf(MATCHUPS[0]), { width: 390, height: 844 });
  try {
    assert.ok(ui.root.classList.contains('is-compact'));
    fire(ui.button(TORNADO_ZONE), 'click');
    assert.equal(ui.popup.hidden, true, 'a click would cover the board');
    assert.equal(ui.hud.openSkillPopup(X, TORNADO_ZONE), true);
    assert.equal(ui.popup.hidden, false);
    assert.deepEqual(shownRules(ui.popup), SKILL_INFO[TORNADO_ZONE].rules);
    assert.deepEqual(shownFacts(ui.popup).map((f) => f.label), SKILL_INFO[TORNADO_ZONE].facts.map((f) => f.label));
    assert.ok(ui.popup.style.left !== undefined && ui.popup.style.top !== undefined, 'placed by tooltipPosition()');
  } finally {
    ui.restore();
  }
});

// The CSS block of the tooltip and the popup.
const block = css.slice(css.indexOf('/* The shared skill tooltip'), css.indexOf('/* Ivory accents'));

test('hud.css: the popup is 280 px of the existing glass, takes no presses and fades in for 120 ms', () => {
  assert.ok(block.length > 500, 'found the block');
  assert.match(block, /\.hud \.tooltip, \.hud \.skill-popup \{[^}]*width: 280px;[^}]*max-width: calc\(100vw - 24px\);/);
  assert.match(block, /\.hud \.tooltip, \.hud \.skill-popup \{[^}]*padding: 16px 18px;[^}]*border-radius: 22px;[^}]*pointer-events: none;/);
  assert.match(block, /\.hud\.is-compact \.tooltip, \.hud\.is-compact \.skill-popup \{ width: min\(280px, calc\(100vw - 24px\)\); \}/);
  assert.match(block, /\.hud \.skill-popup \{ animation: hud-pop-in 120ms ease-out; \}/);
  assert.match(block, /@keyframes hud-pop-in \{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/, 'only opacity animates');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^@]*\.hud \.skill-popup \{ animation: none; \}/);
  assert.match(block, /\.hud\[data-quality="low"\] \.skill-popup/, 'blur only above Low');
  assert.match(block, /\.hud \.pop-ico \{[^}]*width: 40px; height: 40px;[^}]*border-radius: 12px;/);
  assert.match(block, /\.hud \.pop-rule \{[^}]*font-size: 13px;/);
  assert.match(block, /\.hud \.pop-rule::before \{[^}]*background: var\(--accent\);/, 'a small gold dot each');
});

test('hud.css: the popup block uses no hex colour and only tokens the HUD already defines', () => {
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/, 'no hex colour outside a token block');
  for (const [, name] of block.matchAll(/var\((--[a-z0-9-]+)/g)) {
    assert.ok(css.includes(`${name}:`), `${name} is defined in hud.css`);
  }
  for (const gone of ['tip-title', 'tip-text', 'tip-rule', 'tip-hint', 'pop-text']) {
    assert.ok(!css.includes(gone), `the old ${gone} style is gone`);
  }
});

test('the popup and tooltip DOM uses only classes that hud.css styles', () => {
  const ui = setup(viewOf(MATCHUPS[0]));
  try {
    const classes = new Set();
    for (const node of [...allNodes(ui.popup), ...allNodes(ui.tooltip)]) for (const name of node.className.split(/\s+/).filter(Boolean)) classes.add(name);
    for (const name of classes) {
      if (['initial', 'ico'].includes(name)) continue; // the shared icon letters and holder styles
      assert.ok(css.includes(`.${name}`), `.${name} has a style`);
    }
  } finally {
    ui.restore();
  }
});
