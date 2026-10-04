// Collapsible HUD cards and skill descriptions (docs/art-direction-v3-1.md
// section 4.6): the view model, tooltipPosition, the saved choice, the C key
// and the card and pill rectangles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROCK_LIFETIME_TURNS, TORNADO_SIZE } from '../src/config.js';
import { X, O } from '../src/logic/board.js';
import { createInitialState, placeStone } from '../src/logic/game.js';
import { SKILLS, STONE_CONVERSION, TERRAIN_CREATION, TORNADO_ZONE, WIND_DASH, cooldownTurns } from '../src/logic/skills.js';
import {
  ALL_COLLAPSED, ALL_EXPANDED, COLLAPSE_KEY, COLLAPSE_STORAGE_KEYS, isCollapseKey, parseHudParam, readCollapsed,
  startCollapsed, toggleAll, withCollapsed, writeCollapsed,
} from '../src/ui/hud-collapse.js';
import {
  CARD_SIDE, CARD_TOP, CARD_WIDTH, CHEVRON_SIZE, MIN_PILL_SCALE, PILL_HEIGHT, PILL_WIDTH, boardScreenRect, chevronSize,
  canFold, hudBoxes, hudFoldLayout, hudLayout, pillScale,
} from '../src/ui/hud-layout.js';
import { STATE_COOLING, STATE_READY, STATE_SELECTED, STATE_WAITING, hudViewModel } from '../src/ui/hud-view.js';
import { parseShotParams } from '../src/ui/shot-mode.js';
import { SKILL_INFO } from '../src/ui/skill-info.js';
import { startTargeting } from '../src/ui/targeting.js';
import { TOOLTIP_GAP, TOOLTIP_MARGIN, tooltipPosition } from '../src/ui/tooltip-position.js';

const card = (vm, player) => vm.cards.find((c) => c.player === player);
const skill = (vm, player, id) => card(vm, player).skills.find((s) => s.id === id);

function midGame() {
  let state = createInitialState();
  for (const [player, x, y] of [[X, 7, 7], [O, 7, 8], [X, 8, 8], [O, 0, 0]]) {
    state = placeStone(state, { player, x, y }).state;
  }
  return state; // X to move
}

function withCooldown(state, player, skillId, turns) {
  return { ...state, cooldowns: { ...state.cooldowns, [player]: { ...state.cooldowns[player], [skillId]: turns } } };
}

// ---------------------------------------------------------------- view model

test('view model: cards start expanded, and each card follows its own collapsed flag', () => {
  const plain = hudViewModel(midGame(), {}, null);
  for (const c of plain.cards) assert.equal(c.collapsed, false);
  assert.equal(card(plain, X).chevronLabel, 'Collapse Wind Rabbit panel');
  assert.equal(card(plain, O).chevronLabel, 'Collapse Earth Bear panel');

  const folded = hudViewModel(midGame(), { collapsed: withCollapsed(ALL_EXPANDED, O, true) }, null);
  assert.equal(card(folded, X).collapsed, false);
  assert.equal(card(folded, O).collapsed, true);
  assert.equal(card(folded, O).chevronLabel, 'Expand Earth Bear panel');
  const both = hudViewModel(midGame(), { collapsed: ALL_COLLAPSED }, null);
  assert.equal(card(both, X).chevronLabel, 'Expand Wind Rabbit panel');
});

test('view model: my turn with skills ready (turn ring on my card, ready state)', () => {
  const vm = hudViewModel(midGame(), { collapsed: ALL_COLLAPSED }, X);
  assert.equal(card(vm, X).active, true);
  assert.equal(card(vm, O).active, false);
  for (const id of [WIND_DASH, TORNADO_ZONE]) {
    const row = skill(vm, X, id);
    assert.equal(row.state, STATE_READY);
    assert.equal(row.stateText, 'Ready');
    assert.equal(row.cooldownTurns, 0);
    assert.equal(row.cooldownProgress, 0);
    assert.equal(row.disabled, false);
  }
  assert.equal(skill(vm, X, WIND_DASH).ariaLabel, 'Wind Dash: Ready');
});

test('view model: a selected skill', () => {
  const targeting = startTargeting(TORNADO_ZONE);
  const vm = hudViewModel(midGame(), { targeting, collapsed: ALL_COLLAPSED }, X);
  const row = skill(vm, X, TORNADO_ZONE);
  assert.equal(row.state, STATE_SELECTED);
  assert.equal(row.stateText, 'Selected');
  assert.equal(row.selected, true);
  assert.equal(skill(vm, X, WIND_DASH).state, STATE_READY);
});

test('view model: cooling with 1 turn and with 2 turns left', () => {
  const one = skill(hudViewModel(withCooldown(midGame(), X, WIND_DASH, 1), {}, X), X, WIND_DASH);
  assert.equal(one.state, STATE_COOLING);
  assert.equal(one.stateText, 'Ready in 1 turn');
  assert.equal(one.ariaLabel, 'Wind Dash: Ready in 1 turn');
  assert.equal(one.cooldownTurns, 1);
  const total = cooldownTurns(WIND_DASH);
  assert.equal(one.cooldownProgress, (total - 1) / total);

  const two = skill(hudViewModel(withCooldown(midGame(), X, WIND_DASH, 2), {}, X), X, WIND_DASH);
  assert.equal(two.state, STATE_COOLING);
  assert.equal(two.stateText, 'Ready in 2 turns');
  assert.equal(two.cooldownTurns, 2);
  assert.equal(two.cooldownProgress, (total - 2) / total);
  assert.ok(two.cooldownProgress >= 0 && two.cooldownProgress <= 1);
  assert.equal(two.disabled, true);
});

test("view model: the opponent's turn (waiting, disabled, no turn ring)", () => {
  const vm = hudViewModel(midGame(), { collapsed: ALL_COLLAPSED }, X);
  const theirs = card(vm, O);
  assert.equal(theirs.active, false);
  assert.equal(theirs.waiting, true);
  for (const row of theirs.skills) {
    assert.equal(row.state, STATE_WAITING);
    assert.equal(row.stateText, 'Wait for your turn');
    assert.equal(row.disabled, true);
    // Disabled buttons still explain themselves.
    assert.ok(row.description.length > 0);
  }
});

test('view model: every skill has its description and hint from SKILL_INFO', () => {
  const vm = hudViewModel(midGame(), {}, null);
  const rows = vm.cards.flatMap((c) => c.skills);
  assert.deepEqual(rows.map((r) => r.id).sort(), Object.keys(SKILLS).sort());
  for (const row of rows) {
    assert.equal(row.description, SKILL_INFO[row.id].description);
    assert.equal(row.hint, SKILL_INFO[row.id].hint);
    assert.equal(row.title, SKILL_INFO[row.id].title);
    assert.ok(row.description.length > 20 && row.hint.startsWith('Click to select'));
  }
  assert.equal(SKILL_INFO[WIND_DASH].hint, 'Click to select, then choose a plot');
  assert.equal(SKILL_INFO[TORNADO_ZONE].hint, 'Click to select, then choose the zone centre');
  assert.equal(SKILL_INFO[TERRAIN_CREATION].hint, 'Click to select, then choose a plot');
  assert.equal(SKILL_INFO[STONE_CONVERSION].hint, 'Click to select, then choose a plant');
});

test('SKILL_INFO: the numbers are the config constants and the text matches the rules', () => {
  assert.ok(SKILL_INFO[TORNADO_ZONE].description.includes(`${TORNADO_SIZE} by ${TORNADO_SIZE} zone`));
  assert.ok(SKILL_INFO[TERRAIN_CREATION].description.includes(`stays for ${ROCK_LIFETIME_TURNS} turns`));
  // No number is typed into the strings: the only digits are the constants.
  const source = readFileSync(new URL('../src/ui/skill-info.js', import.meta.url), 'utf8');
  const strings = source.slice(source.indexOf('export const SKILL_INFO'));
  assert.doesNotMatch(strings.replace(/\$\{[^}]*\}/g, ''), /'[^'\n]*\d[^'\n]*'|`[^`\n]*\d[^`\n]*`/);
  // Accuracy (src/logic): Wind Dash needs an empty target and lands after
  // the opponent's turn; Tornado Zone throws only a seed planted inside it
  // on the opponent's next turn; Terrain Creation needs an empty plot;
  // Stone Conversion takes only an opponent's plant.
  assert.match(SKILL_INFO[WIND_DASH].description, /empty target plot\. After the opponent's next turn/);
  assert.match(SKILL_INFO[TORNADO_ZONE].description, /On the opponent's next turn, .* a seed they plant inside/);
  assert.match(SKILL_INFO[TERRAIN_CREATION].description, /on an empty plot/);
  assert.match(SKILL_INFO[STONE_CONVERSION].description, /^Pick one of the opponent's plants\./);
  // Only Earth Bear (O) has Stone Conversion, so it never turns O into X.
  assert.ok(SKILL_INFO[STONE_CONVERSION].description.endsWith('X becomes O.'));
  assert.ok(!SKILL_INFO[STONE_CONVERSION].description.includes('O becomes X'));
});

// ---------------------------------------------------------------- tooltip

const VIEW = { width: 1920, height: 1080 };
const TIP = { width: 356, height: 160 };
const anchor = (left, top, width = 72, height = 72) => ({ left, top, width, height });
const inside = (pos, size, view) => pos.left >= TOOLTIP_MARGIN && pos.top >= TOOLTIP_MARGIN
  && pos.left + size.width <= view.width - TOOLTIP_MARGIN && pos.top + size.height <= view.height - TOOLTIP_MARGIN;

test('tooltipPosition: below and centred when there is room', () => {
  const pos = tooltipPosition(anchor(800, 120), TIP, VIEW);
  assert.equal(pos.placement, 'below');
  assert.equal(pos.top, 120 + 72 + TOOLTIP_GAP);
  assert.equal(pos.left, 800 + 36 - TIP.width / 2);
});

test('tooltipPosition: flips above near the bottom', () => {
  const pos = tooltipPosition(anchor(800, 980), TIP, VIEW);
  assert.equal(pos.placement, 'above');
  assert.equal(pos.top, 980 - TOOLTIP_GAP - TIP.height);
  assert.ok(inside(pos, TIP, VIEW));
});

test('tooltipPosition: clamps at the left and right edges', () => {
  const left = tooltipPosition(anchor(20, 120), TIP, VIEW);
  assert.equal(left.left, TOOLTIP_MARGIN);
  const right = tooltipPosition(anchor(1880, 120, 30, 72), TIP, VIEW);
  assert.equal(right.left, VIEW.width - TOOLTIP_MARGIN - TIP.width);
});

test('tooltipPosition: stays inside the window whenever it fits', () => {
  for (const view of [VIEW, { width: 1280, height: 720 }, { width: 800, height: 600 }, { width: 390, height: 844 }]) {
    for (let x = 0; x <= view.width - 48; x += 37) {
      for (let y = 0; y <= view.height - 48; y += 41) {
        const pos = tooltipPosition(anchor(x, y, 48, 48), TIP, view);
        // It fits below or above whenever one side has room for it.
        if (y + 48 + TOOLTIP_GAP + TIP.height <= view.height - TOOLTIP_MARGIN || y - TOOLTIP_GAP - TIP.height >= TOOLTIP_MARGIN) {
          assert.ok(inside(pos, TIP, view), `${view.width}x${view.height} at ${x},${y}`);
          const below = pos.top >= y + 48;
          const above = pos.top + TIP.height <= y;
          assert.ok(below || above, 'never covers its button');
        }
      }
    }
  }
});

test('tooltipPosition: a tooltip wider than the window sits at the left margin', () => {
  const view = { width: 300, height: 600 };
  const pos = tooltipPosition(anchor(200, 100, 48, 48), { width: 356, height: 160 }, view);
  assert.equal(pos.left, TOOLTIP_MARGIN);
  assert.equal(pos.placement, 'below');
  // Exactly the room left by the margins still centres and clamps.
  const exact = tooltipPosition(anchor(200, 100, 48, 48), { width: 276, height: 160 }, view);
  assert.equal(exact.left, TOOLTIP_MARGIN);
});

// ---------------------------------------------------------------- storage

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

const throwing = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
};

test('storage: the keys, and reading and writing with a working storage', () => {
  assert.deepEqual(COLLAPSE_STORAGE_KEYS, { X: 'gomoku.hud.collapsed.x', O: 'gomoku.hud.collapsed.o' });
  const storage = memoryStorage();
  assert.deepEqual(readCollapsed(storage), { X: false, O: false }, 'nothing saved: expanded');
  assert.equal(writeCollapsed(storage, X, true), true);
  assert.equal(storage.data.get('gomoku.hud.collapsed.x'), '1');
  assert.deepEqual(readCollapsed(storage), { X: true, O: false });
  assert.equal(writeCollapsed(storage, X, false), true);
  assert.equal(storage.data.get('gomoku.hud.collapsed.x'), '0');
  writeCollapsed(storage, O, true);
  assert.deepEqual(readCollapsed(storage), { X: false, O: true });
});

test('storage: a storage that throws, or none, means expanded and never crashes', () => {
  assert.deepEqual(readCollapsed(throwing), { X: false, O: false });
  assert.equal(writeCollapsed(throwing, X, true), false);
  assert.deepEqual(readCollapsed(null), { X: false, O: false });
  assert.equal(writeCollapsed(null, O, true), false);
  assert.deepEqual(startCollapsed(throwing), { X: false, O: false });
});

test('storage: garbage values mean expanded', () => {
  for (const value of ['true', 'yes', '2', '', ' 1', '01', 'null', '{}']) {
    const storage = memoryStorage({ 'gomoku.hud.collapsed.x': value, 'gomoku.hud.collapsed.o': value });
    assert.deepEqual(readCollapsed(storage), { X: false, O: false }, JSON.stringify(value));
  }
});

test('the shot hud parameter sets both cards over the saved choice', () => {
  const saved = memoryStorage({ 'gomoku.hud.collapsed.x': '1' });
  assert.deepEqual(startCollapsed(saved), { X: true, O: false });
  assert.deepEqual(startCollapsed(saved, 'expanded'), ALL_EXPANDED);
  assert.deepEqual(startCollapsed(memoryStorage(), 'collapsed'), ALL_COLLAPSED);
  assert.equal(parseHudParam('Collapsed'), 'collapsed');
  assert.equal(parseHudParam('expanded'), 'expanded');
  assert.equal(parseHudParam('open'), null);
  assert.equal(parseHudParam(null), null);
  assert.equal(parseShotParams('?shot=field&hud=collapsed').hud, 'collapsed');
  assert.equal(parseShotParams('?shot=field&hud=expanded').hud, 'expanded');
  assert.equal(parseShotParams('?shot=field').hud, null);
});

test('withCollapsed changes one team and keeps the same object when nothing changes', () => {
  const next = withCollapsed(ALL_EXPANDED, O, true);
  assert.deepEqual(next, { X: false, O: true });
  assert.deepEqual(ALL_EXPANDED, { X: false, O: false }, 'the old flags stay as they were');
  assert.equal(withCollapsed(next, O, true), next);
});

// ---------------------------------------------------------------- the C key

const key = (k, extra = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, target: null, ...extra });

test('C key: toggles both cards, ignored with modifiers, while typing and on repeat', () => {
  assert.equal(COLLAPSE_KEY, 'c');
  assert.equal(isCollapseKey(key('c')), true);
  assert.equal(isCollapseKey(key('C', { shiftKey: false })), true, 'Caps Lock');
  for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    assert.equal(isCollapseKey(key('c', { [mod]: true })), false, mod);
  }
  assert.equal(isCollapseKey(key('c', { repeat: true })), false);
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(isCollapseKey(key('c', { target: { tagName } })), false, tagName);
  }
  assert.equal(isCollapseKey(key('c', { target: { tagName: 'DIV', isContentEditable: true } })), false);
  assert.equal(isCollapseKey(key('c', { target: { tagName: 'BUTTON' } })), true);
  // The game's other keys stay theirs.
  for (const other of ['q', 'r', 'Escape', 'h', 'v']) assert.equal(isCollapseKey(key(other)), false, other);

  assert.deepEqual(toggleAll(ALL_EXPANDED), ALL_COLLAPSED);
  assert.deepEqual(toggleAll(ALL_COLLAPSED), ALL_EXPANDED);
  assert.deepEqual(toggleAll({ X: true, O: false }), ALL_COLLAPSED, 'mixed: both collapse');
});

// ---------------------------------------------------------------- layout

const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0
  && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0;

function checkBoxes(w, h, collapsed) {
  const boxes = hudBoxes(w, h, { collapsed });
  for (const box of boxes) {
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= w && box.y + box.h <= h, `${w}x${h} ${box.name} inside`);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.ok(!overlap(boxes[i], boxes[j]), `${w}x${h} ${boxes[i].name} and ${boxes[j].name}`);
    }
  }
  return boxes;
}

test('hud-layout: no overlaps and everything inside, collapsed and expanded', () => {
  for (const [w, h] of [[1920, 1080], [1280, 720], [800, 600]]) {
    for (const collapsed of [ALL_EXPANDED, ALL_COLLAPSED, { X: true, O: false }]) checkBoxes(w, h, collapsed);
  }
  // The slim bars of a phone, whatever is saved.
  for (const collapsed of [ALL_EXPANDED, ALL_COLLAPSED]) {
    const boxes = checkBoxes(390, 844, collapsed);
    assert.deepEqual(boxes.map((b) => b.name), ['turn', 'quality', 'fullscreen', 'card-x', 'card-o']);
  }
  // The other shapes of the screenshot check.
  for (const [w, h] of [[1680, 720], [1024, 768], [720, 1280]]) checkBoxes(w, h, ALL_COLLAPSED);
});

test('hud-layout: at 1920x1080 the pill is at most 320 by 96 and sits at the card anchor', () => {
  assert.ok(PILL_WIDTH <= 320 && PILL_WIDTH >= 280, `width ${PILL_WIDTH}`);
  assert.ok(PILL_HEIGHT <= 96 && PILL_HEIGHT >= 80, `height ${PILL_HEIGHT}`);
  const open = hudBoxes(1920, 1080, { collapsed: ALL_EXPANDED });
  const folded = hudBoxes(1920, 1080, { collapsed: ALL_COLLAPSED });
  for (const team of ['x', 'o']) {
    const cardBox = open.find((b) => b.name === `card-${team}`);
    const pill = folded.find((b) => b.name === `pill-${team}`);
    assert.ok(pill.w <= 320 && pill.h <= 96);
    assert.equal(pill.y, cardBox.y);
    assert.equal(pill.y, CARD_TOP);
    if (team === 'x') assert.equal(pill.x, cardBox.x);
    else assert.equal(pill.x + pill.w, cardBox.x + cardBox.w, 'the right pill keeps the right edge');
  }
  assert.equal(open.find((b) => b.name === 'card-x').x, CARD_SIDE);
  assert.equal(open.find((b) => b.name === 'card-x').w, CARD_WIDTH);
});

test('hud-layout: pills keep 44 px skill buttons and stay off the board', () => {
  for (let w = 700; w <= 2560; w += 40) {
    for (let h = 400; h <= 1600; h += 40) {
      const layout = hudLayout(w, h);
      if (layout.compact) continue;
      const board = boardScreenRect(w, h);
      for (const pill of hudBoxes(w, h, { collapsed: ALL_COLLAPSED }).filter((b) => b.name.startsWith('pill'))) {
        assert.ok(pill.h * (72 / PILL_HEIGHT) >= 44 - 1e-9, `${w}x${h} button height`);
        const clear = pill.x + pill.w <= board.left || pill.x >= board.right || pill.y + pill.h <= board.top;
        assert.ok(clear, `${w}x${h} ${pill.name} off the plots`);
      }
    }
  }
  assert.ok(MIN_PILL_SCALE * 72 >= 44 - 1e-9);
});

test('hud-layout: the chevron stays a 44 px touch target at every card and pill scale', () => {
  assert.equal(chevronSize(1), CHEVRON_SIZE);
  assert.equal(chevronSize(0.5), 2 * CHEVRON_SIZE);
  for (let w = 700; w <= 2560; w += 40) {
    for (let h = 400; h <= 1600; h += 40) {
      const layout = hudLayout(w, h);
      if (layout.compact) continue;
      assert.ok(chevronSize(layout.scale) * layout.scale >= CHEVRON_SIZE - 1e-9, `${w}x${h} card chevron`);
      const pill = pillScale(layout.scale);
      assert.ok(chevronSize(pill) * pill >= CHEVRON_SIZE - 1e-9, `${w}x${h} pill chevron`);
      // It never makes the pill taller than its tile row.
      assert.ok(chevronSize(pill) <= 72 + 1e-9, `${w}x${h} pill chevron height`);
    }
  }
});

test('hud-layout: where no pill fits beside the board the cards stay full and keep the saved choice', () => {
  // 1000x560: the cards are drawn at about 0.81; a pill with 44 px buttons
  // and chevron would reach over the plots.
  const small = hudFoldLayout(1000, 560, { collapsed: ALL_COLLAPSED });
  assert.equal(small.layout.compact, false);
  assert.equal(small.foldable, false);
  assert.deepEqual(small.folded, { X: false, O: false });
  assert.deepEqual(hudBoxes(1000, 560, { collapsed: ALL_COLLAPSED }).map((b) => b.name), ['turn', 'quality', 'fullscreen', 'card-x', 'card-o']);
  checkBoxes(1000, 560, ALL_COLLAPSED);
  // Full size windows fold; the slim layouts never do.
  assert.equal(canFold(1920, 1080, hudLayout(1920, 1080)), true);
  assert.deepEqual(hudFoldLayout(1920, 1080, { collapsed: { X: true, O: false } }).folded, { X: true, O: false });
  assert.equal(hudFoldLayout(390, 844, { collapsed: ALL_COLLAPSED }).foldable, false);
  // Wherever a pill shows, it is clear of the plots by the HUD gap.
  for (let w = 700; w <= 2560; w += 20) {
    for (let h = 400; h <= 1600; h += 20) {
      const { layout, foldable } = hudFoldLayout(w, h, { collapsed: ALL_COLLAPSED });
      if (!foldable) continue;
      assert.equal(layout.compact, false);
      const left = boardScreenRect(w, h).left;
      const pill = hudBoxes(w, h, { collapsed: ALL_COLLAPSED }).find((b) => b.name === 'pill-x');
      assert.ok(pill.x + pill.w + 12 <= left + 1e-9, `${w}x${h}`);
    }
  }
});
