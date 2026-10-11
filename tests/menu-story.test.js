// Skill popup, part 3: the story line on the first page of the menu
// (docs/skill-popup-design.md section 4, docs/flow-design.md section 3.1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as config from '../src/config.js';
import { FLOW_EVENTS, SCREENS, flowReducer, initialFlow } from '../src/ui/flow.js';
import { MENU_LAYOUT, menuLayout, menuViewModel } from '../src/ui/menu.js';
import { STRINGS } from '../src/ui/strings.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const menuFlow = initialFlow();
const css = read('src/ui/menu.css');
// The base rules as selector -> body (comments and @media blocks left out).
const cssBlocks = (text) => {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  return new Map([...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]));
};
const blocks = cssBlocks(css);
const NUMBER_WORDS = { 3: 'three', 4: 'four', 5: 'five', 6: 'six' };

test('the story strings are the words of the design', () => {
  assert.equal(STRINGS.menuStoryKicker, 'The Festival of All Seeds');
  assert.equal(
    STRINGS.menuStoryLine,
    'Every spring the spirits of Flora gather on Breeze Hill to sow seeds, not to fight. Grow five in a row to win the Floral Crown.',
  );
});

test('menuViewModel: the menu has the story from STRINGS', () => {
  const vm = menuViewModel(menuFlow);
  assert.deepEqual(vm.story, { kicker: STRINGS.menuStoryKicker, line: STRINGS.menuStoryLine });
});

test('menuViewModel: only the menu screen has the story (not the lobby, the waiting room, the game or the game over card)', () => {
  const others = Object.values(SCREENS).filter((screen) => screen !== SCREENS.MENU);
  for (const screen of others) {
    assert.equal(menuViewModel({ ...menuFlow, screen }).story, null, screen);
  }
  assert.equal(menuViewModel(initialFlow({ local: true })).story, null, 'the local game skips the menu');
  assert.equal(menuViewModel(flowReducer(menuFlow, FLOW_EVENTS.PLAY_ONLINE)).story, null, 'the lobby');
});

test('menuViewModel: the How to Play and Settings panels carry no story', () => {
  const howto = menuViewModel(flowReducer(menuFlow, FLOW_EVENTS.OPEN_HOWTO));
  const settings = menuViewModel(flowReducer(menuFlow, FLOW_EVENTS.OPEN_SETTINGS), { quality: null });
  assert.ok(howto.howto && settings.settings);
  assert.equal('story' in howto.howto, false);
  assert.equal('story' in settings.settings, false);
  const text = JSON.stringify([howto.howto, settings.settings]);
  assert.ok(!text.includes(STRINGS.menuStoryKicker));
  assert.ok(!text.includes(STRINGS.menuStoryLine));
});

test('the story strings type no digit; the number of the line is spelled and follows WIN_LENGTH', () => {
  for (const text of [STRINGS.menuStoryKicker, STRINGS.menuStoryLine]) assert.doesNotMatch(text, /\d/, text);
  const word = NUMBER_WORDS[config.WIN_LENGTH];
  assert.ok(word, `a word for WIN_LENGTH ${config.WIN_LENGTH}`);
  assert.match(STRINGS.menuStoryLine, new RegExp(`Grow ${word} in a row`), 'the line says the winning row length of the config');
  for (const [number, other] of Object.entries(NUMBER_WORDS)) {
    if (Number(number) !== config.WIN_LENGTH) assert.doesNotMatch(STRINGS.menuStoryLine, new RegExp(`\\b${other}\\b`), other);
  }
});

test('menu.css: the story uses Ivory tokens only, is centred, at most 36em wide and fades in with opacity only', () => {
  const story = blocks.get('#flow .menu-story');
  const kicker = blocks.get('#flow .menu-story-kicker');
  const line = blocks.get('#flow .menu-story-line');
  assert.ok(story && kicker && line, 'the three story rules exist');
  assert.match(story, /text-align: center/);
  assert.match(story, /animation: flow-fade /, 'the fade of the menu (opacity only)');
  assert.match(kicker, /color: var\(--gold\)/);
  assert.match(kicker, /text-transform: uppercase/);
  assert.match(kicker, /letter-spacing: 0\.\d+em/, 'spaced capitals');
  assert.match(line, /color: var\(--ink-2\)/, 'the secondary text colour of the menu');
  assert.match(line, /max-width: 36em/);
  assert.match(line, /margin: 0 auto/);
  for (const body of [story, kicker, line]) {
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'no colour literal outside the token block');
  }
  assert.match(css, /@keyframes flow-fade \{\s*from \{ opacity: 0; \}\s*\}/, 'flow-fade moves opacity only');
});

test('menu.css: the story is hidden when the window is shorter than 560 px, and still under reduced motion', () => {
  const rule = css.match(/@media \(max-height: (\d+)px\) \{\s*#flow \.menu-story \{\s*display: none;\s*\}\s*\}/);
  assert.ok(rule, 'a max-height media rule hides the story');
  assert.equal(Number(rule[1]) + 1, 560);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^]*animation: none !important/);
});

test('the story sizes of menu.css are the MENU_LAYOUT numbers, and the card with the story still fits 1280 by 720', () => {
  const px = (selector, property) => {
    const match = blocks.get(selector)?.match(new RegExp(`(?:^|[;\\s])${property}:\\s*(?:0 0 )?(\\d+)px`));
    return match ? Number(match[1]) : null;
  };
  assert.equal(px('#flow .menu-story-kicker', 'line-height'), MENU_LAYOUT.storyKickerHeight);
  assert.equal(px('#flow .menu-story-kicker', 'margin'), MENU_LAYOUT.storyGap);
  assert.equal(px('#flow .menu-story-line', 'line-height'), MENU_LAYOUT.storyLineHeight);
  const layout = menuLayout();
  assert.equal(layout.fits, true);
  const without = menuLayout({ ...MENU_LAYOUT, storyKickerHeight: 0, storyGap: 0, storyLines: 0 }).cardHeight;
  const story = MENU_LAYOUT.storyKickerHeight + MENU_LAYOUT.storyGap + MENU_LAYOUT.storyLines * MENU_LAYOUT.storyLineHeight;
  assert.equal(layout.cardHeight, without + story, 'the story (kicker, gap, lines) adds its own height to the card');
  assert.ok(layout.buttonHeight >= config.MENU_MIN_BUTTON_PX, 'the buttons keep their height');
});

test('menu-dom.js: the story block sits between the head and the buttons with the box name menu-story', () => {
  const dom = read('src/ui/menu-dom.js');
  assert.match(dom, /story\.dataset\.hudBox = 'menu-story'/);
  const head = dom.indexOf("el('header', 'menu-head', menu)");
  const story = dom.indexOf("el('div', 'menu-story', menu)");
  const buttons = dom.indexOf("el('div', 'menu-buttons', menu)");
  assert.ok(head > 0 && head < story && story < buttons, 'title, then story, then buttons');
  assert.match(dom, /vm\.story\.kicker/);
  assert.match(dom, /vm\.story\.line/);
});

test('docs/flow-design.md section 3.1 describes the story block', () => {
  const docs = read('docs/flow-design.md');
  const section = docs.slice(docs.indexOf('### 3.1 Menu'), docs.indexOf('### 3.2 How to Play'));
  assert.ok(section.includes('menu-story'));
  assert.ok(section.includes('menuStoryKicker'));
});
