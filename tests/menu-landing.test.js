// Design v4 part 2: the landing menu (scrim, place pill, two line buttons
// with icons, arrow keys, hint bar, fits 1280 by 720).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as config from '../src/config.js';
import { FLOW_EVENTS, initialFlow } from '../src/ui/flow.js';
import { MENU_BUTTONS, MENU_LAYOUT, menuKeyAction, menuLayout, menuViewModel, stepMenuFocus } from '../src/ui/menu.js';
import { STRINGS } from '../src/ui/strings.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the new menu strings exist with the exact English text', () => {
  assert.equal(STRINGS.menuPlace, 'Windy Spring Breeze Hill');
  assert.equal(STRINGS.menuPlayOnlineHint, 'Create a room or join one');
  assert.equal(STRINGS.menuPlayLocalHint, 'Two players, one window');
  assert.equal(STRINGS.menuHowToHint, 'Rules and skills');
  assert.equal(STRINGS.menuSettingsHint, 'Graphics quality and full screen');
  assert.equal(STRINGS.menuKeysHint, 'Up, Down to choose, Enter to select');
});

test('menuViewModel: the pill, the hint bar and the four buttons with their hints in order', () => {
  const vm = menuViewModel(initialFlow());
  assert.equal(vm.place, STRINGS.menuPlace);
  assert.equal(vm.keysHint, STRINGS.menuKeysHint);
  assert.deepEqual(vm.buttons.map((b) => [b.label, b.hint]), [
    ['Play Online', 'Create a room or join one'],
    ['Play on this computer', 'Two players, one window'],
    ['How to Play', 'Rules and skills'],
    ['Settings', 'Graphics quality and full screen'],
  ]);
  assert.deepEqual(vm.buttons.map((b) => b.event), [
    FLOW_EVENTS.PLAY_ONLINE, FLOW_EVENTS.PLAY_LOCAL, FLOW_EVENTS.OPEN_HOWTO, FLOW_EVENTS.OPEN_SETTINGS,
  ]);
});

test('stepMenuFocus: Up and Down move the focus and wrap at both ends', () => {
  assert.equal(stepMenuFocus(0, 'ArrowDown', 4), 1);
  assert.equal(stepMenuFocus(2, 'ArrowDown', 4), 3);
  assert.equal(stepMenuFocus(3, 'ArrowDown', 4), 0, 'wraps to the first');
  assert.equal(stepMenuFocus(1, 'ArrowUp', 4), 0);
  assert.equal(stepMenuFocus(0, 'ArrowUp', 4), 3, 'wraps to the last');
  assert.equal(stepMenuFocus(-1, 'ArrowDown', 4), 0, 'no focus: Down picks the first');
  assert.equal(stepMenuFocus(-1, 'ArrowUp', 4), 3, 'no focus: Up picks the last');
  assert.equal(stepMenuFocus(2, 'ArrowLeft', 4), 2);
  assert.equal(stepMenuFocus(0, 'ArrowDown'), 1, 'counts MENU_BUTTONS by default');
  assert.equal(stepMenuFocus(MENU_BUTTONS.length - 1, 'ArrowDown'), 0);
});

test('menuKeyAction: arrows move, Enter selects, typing targets and modifiers are ignored', () => {
  const key = (k, extra = {}) => ({ key: k, target: { tagName: 'BUTTON' }, ...extra });
  assert.deepEqual(menuKeyAction(key('ArrowDown'), 0), { move: 1 });
  assert.deepEqual(menuKeyAction(key('ArrowUp'), 0), { move: 3 });
  assert.deepEqual(menuKeyAction(key('Enter'), 2), { select: 2 });
  assert.deepEqual(menuKeyAction(key('Enter'), -1), { select: 0 });
  assert.equal(menuKeyAction(key('Enter', { repeat: true }), 2), null);
  assert.equal(menuKeyAction(key('a'), 0), null);
  assert.equal(menuKeyAction(key('ArrowDown', { ctrlKey: true }), 0), null);
  for (const target of [{ tagName: 'INPUT' }, { tagName: 'textarea' }, { tagName: 'DIV', isContentEditable: true }]) {
    assert.equal(menuKeyAction({ key: 'ArrowDown', target }, 0), null, target.tagName);
    assert.equal(menuKeyAction({ key: 'Enter', target }, 0), null, target.tagName);
  }
});

test('menuLayout: the card fits 1280 by 720 without scrolling and every button is at least 44 px high', () => {
  const layout = menuLayout();
  assert.equal(layout.fits, true);
  assert.ok(layout.cardHeight <= config.MENU_FIT_HEIGHT - 2 * MENU_LAYOUT.flowPadding, `${layout.cardHeight}`);
  assert.ok(layout.cardWidth <= config.MENU_FIT_WIDTH - 2 * MENU_LAYOUT.flowPadding);
  assert.ok(layout.buttonHeight >= config.MENU_MIN_BUTTON_PX);
  assert.equal(layout.buttonsTallEnough, true);
  assert.equal(config.MENU_MIN_BUTTON_PX, 44);
  assert.deepEqual([config.MENU_FIT_WIDTH, config.MENU_FIT_HEIGHT], [1280, 720]);
  assert.equal(menuLayout({ ...MENU_LAYOUT, buttonHeight: 200 }).fits, false, 'a too tall card does not fit');
  assert.equal(menuLayout({ ...MENU_LAYOUT, buttonHeight: 40 }).buttonsTallEnough, false);
});

// The CSS without comments, as a map of selector -> body.
function cssBlocks(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return new Map([...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]));
}

test('menu.css uses the MENU_LAYOUT sizes, a 2 px focus ring of a glass token and the scrim', () => {
  const blocks = cssBlocks(read('src/ui/menu.css'));
  const px = (selector, property) => {
    const match = blocks.get(selector)?.match(new RegExp(`(?:^|[;\\s])${property}:\\s*([\\d\\s]+?)px`));
    return match ? match[1] : null;
  };
  const L = MENU_LAYOUT;
  assert.equal(px('#flow', 'padding'), String(L.flowPadding));
  assert.equal(px('#flow .menu-card', 'width'), String(L.cardWidth));
  assert.equal(px('#flow .menu-card', 'gap'), String(L.gap));
  assert.match(blocks.get('#flow .menu-card'), new RegExp(`padding: ${L.cardPadTop}px ${L.cardPadX}px ${L.cardPadBottom}px;`));
  assert.equal(px('#flow .menu-title', 'line-height'), String(L.titleHeight));
  assert.equal(px('#flow .menu-head', 'gap'), String(L.headGap));
  assert.equal(px('#flow .menu-place', 'height'), String(L.pillHeight));
  assert.equal(px('#flow .menu-button', 'height'), String(L.buttonHeight));
  assert.equal(px('#flow .menu-buttons', 'gap'), String(L.buttonGap));
  assert.equal(px('#flow .menu-keys', 'height'), String(L.hintHeight));
  assert.match(blocks.get('#flow .menu-button:focus,\n#flow .menu-button:focus-visible'), /outline: 2px solid var\(--ink\)/);
  assert.match(blocks.get('#flow .scrim'), /backdrop-filter: blur\(var\(--scrim-blur\)\)/);
  assert.match(blocks.get('#flow .scrim'), /background: var\(--scrim\)/);
  assert.match(blocks.get('#flow.is-solid .scrim'), /backdrop-filter: none/);
});

test('menu-dom.js: scrim blur from MENU_SCRIM_BLUR_PX only with frosted glass, inline SVG icons, chevrons and arrow keys', () => {
  assert.equal(config.MENU_SCRIM_BLUR_PX, 6);
  const dom = read('src/ui/menu-dom.js');
  assert.match(dom, /--scrim-blur', `\$\{blur > 0 \? MENU_SCRIM_BLUR_PX : 0\}px`/);
  assert.ok(dom.includes("createElementNS(SVG, 'svg')"));
  for (const button of MENU_BUTTONS) assert.ok(dom.includes(`'${button.id}'`) || dom.includes(`  ${button.id}:`), button.id);
  assert.ok(dom.includes('menu-chevron'));
  assert.ok(dom.includes('menuKeyAction('));
  assert.ok(!/['"](low|medium|high)['"]/.test(dom), 'no level name: the frost of the quality table decides');
});
