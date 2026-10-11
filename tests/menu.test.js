// Flow v1 step 4: the main menu, How to Play and Settings
// (docs/flow-design.md sections 3.1 to 3.3, 7 and 8).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as config from '../src/config.js';
import { CHARACTERS } from '../src/logic/characters.js';
import { cooldownTurns, isPassiveSkill } from '../src/logic/skills.js';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { markLookFor } from '../src/render3d/character-look.js';
import { QUALITY_LEVELS } from '../src/render3d/quality.js';
import { GAME, LOBBY, MENU, SELECT, createApp } from '../src/ui/app.js';
import { FLOW_EVENTS, OVERLAYS, SCREENS, flowReducer, initialFlow } from '../src/ui/flow.js';
import {
  MENU_BUTTONS, MENU_EVENTS, OVERLAY_OPENER, howToViewModel, menuViewModel, qualityLevelNames, rulesLines, settingsViewModel,
} from '../src/ui/menu.js';
import { SHOT_SCENES, parseShotParams, shotFlow } from '../src/ui/shot-mode.js';
import { SKILL_INFO } from '../src/ui/skill-info.js';
import { STRINGS } from '../src/ui/strings.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const menuFlow = initialFlow();
const open = (event) => flowReducer(menuFlow, event);

// --- the menu ---

test('menuViewModel: the five buttons in order with their flow events and box names', () => {
  const vm = menuViewModel(menuFlow);
  assert.equal(vm.visible, true);
  assert.equal(vm.title, 'Gomoku Tales');
  assert.deepEqual(vm.buttons.map((b) => b.label), ['Play Online', 'Play on this computer', 'Watch a match', 'How to Play', 'Settings']);
  assert.deepEqual(vm.buttons.map((b) => b.event), [
    FLOW_EVENTS.PLAY_ONLINE, FLOW_EVENTS.PLAY_LOCAL, FLOW_EVENTS.WATCH, FLOW_EVENTS.OPEN_HOWTO, FLOW_EVENTS.OPEN_SETTINGS,
  ]);
  assert.deepEqual(vm.buttons.map((b) => b.box), ['menu-play-online', 'menu-play-local', 'menu-watch', 'menu-howto', 'menu-settings']);
  assert.equal(vm.focus, MENU_BUTTONS[0].id, 'the first button gets the focus');
  assert.equal(vm.overlay, OVERLAYS.NONE);
  assert.equal(vm.howto, null);
  assert.equal(vm.settings, null);
});

test('menuViewModel: hidden off the menu screen; an overlay takes the focus to its Close button', () => {
  assert.equal(menuViewModel(initialFlow({ local: true })).visible, false);
  assert.equal(menuViewModel(flowReducer(menuFlow, FLOW_EVENTS.PLAY_ONLINE)).visible, false);
  const howto = menuViewModel(open(FLOW_EVENTS.OPEN_HOWTO));
  assert.equal(howto.overlay, OVERLAYS.HOWTO);
  assert.equal(howto.focus, 'howto-close');
  assert.ok(howto.howto);
  assert.equal(howto.settings, null);
  const settings = menuViewModel(open(FLOW_EVENTS.OPEN_SETTINGS), { quality: qualityLevelNames()[0] });
  assert.equal(settings.focus, 'settings-close');
  assert.ok(settings.settings);
  // Escape and Close send CLOSE_OVERLAY; focus goes back to the opener.
  assert.ok(MENU_EVENTS.includes(FLOW_EVENTS.CLOSE_OVERLAY));
  assert.equal(OVERLAY_OPENER[OVERLAYS.HOWTO], 'howto');
  assert.equal(OVERLAY_OPENER[OVERLAYS.SETTINGS], 'settings');
  assert.ok(MENU_BUTTONS.some((b) => b.id === OVERLAY_OPENER[OVERLAYS.HOWTO] && b.event === FLOW_EVENTS.OPEN_HOWTO));
  assert.equal(flowReducer(open(FLOW_EVENTS.OPEN_HOWTO), FLOW_EVENTS.CLOSE_OVERLAY).overlay, OVERLAYS.NONE);
});

test('the app starts on the menu; Play on this computer is the local game, menu events only', () => {
  const network = createFakeNetwork();
  const app = createApp({ openTransport: () => network.connect(), clock: createFakeClock() });
  assert.equal(app.getScreen(), MENU);
  assert.equal(app.menuEvent(FLOW_EVENTS.START), false, 'not a menu event');
  assert.equal(app.menuEvent(FLOW_EVENTS.OPEN_HOWTO), true);
  assert.equal(app.getFlow().overlay, OVERLAYS.HOWTO);
  assert.equal(app.menuEvent(FLOW_EVENTS.PLAY_LOCAL), false, 'the overlay is open');
  assert.equal(app.menuEvent(FLOW_EVENTS.CLOSE_OVERLAY), true);
  assert.equal(app.menuEvent(FLOW_EVENTS.PLAY_LOCAL), true);
  assert.equal(app.getFlow().mode, 'local');
  assert.equal(app.getFlow().screen, SCREENS.GAME);
  assert.equal(app.getScreen(), SELECT, 'the game screen opens on the character select');
  assert.equal(app.getGame(), null);
  const other = createApp({ openTransport: () => network.connect(), clock: createFakeClock() });
  assert.equal(other.playOnline(), true);
  assert.equal(other.getScreen(), LOBBY);
  other.backToLobby(); // nothing on the lobby
  assert.equal(other.getScreen(), LOBBY);
});

test('?local=1 still starts in the local game; the menu, howto and settings shot scenes show their own screen', () => {
  const { seats, ...rest } = initialFlow({ local: true });
  assert.deepEqual(rest, { screen: 'game', overlay: 'none', mode: 'local', role: null, notice: null });
  assert.deepEqual([...seats.order], [], 'on the character select, nobody picked yet');
  for (const scene of ['menu', 'howto', 'settings']) {
    assert.ok(SHOT_SCENES.includes(scene), scene);
    assert.equal(parseShotParams(`?shot=${scene}`).scene, scene);
    assert.equal(shotFlow(scene).screen, SCREENS.MENU);
  }
  assert.equal(shotFlow('menu').overlay, OVERLAYS.NONE);
  assert.equal(shotFlow('howto').overlay, OVERLAYS.HOWTO);
  assert.equal(shotFlow('settings').overlay, OVERLAYS.SETTINGS);
  assert.equal(shotFlow('field'), null, 'the game scenes skip the menu');
  assert.equal(shotFlow('empty'), null);
});

// --- How to Play ---

test('rulesLines: seven lines whose numbers come from the injected config', () => {
  const lines = rulesLines();
  assert.equal(lines.length, 7);
  assert.deepEqual(lines, [1, 2, 3, 4, 5, 6, 7].map((n) => STRINGS[`howToRule${n}`]));
  const changed = rulesLines({ ...config, COOLDOWN_SHORT: 11, COOLDOWN_LONG: 17, MUD_LIFETIME_TURNS: 9, MUD_SINK_TURNS: 2, WIN_LENGTH: 7 });
  assert.notDeepEqual(changed, lines);
  assert.ok(changed[2].startsWith('7 or more'));
  assert.ok(changed[3].includes('next 11 turns'));
  assert.ok(changed[3].includes('next 17 turns'));
  assert.ok(changed[4].includes('after 9 turns'));
  assert.ok(changed[4].includes('no row for 2 turns.'), 'the plural follows the number');
  assert.ok(changed[5].includes('7 in a row'));
  assert.ok(lines[2].startsWith(`${config.WIN_LENGTH} or more`));
  assert.ok(lines[3].includes(`next ${config.COOLDOWN_SHORT} turns`) && lines[3].includes(`next ${config.COOLDOWN_LONG} turns`));
  assert.ok(lines[4].includes(`after ${config.MUD_LIFETIME_TURNS} turns`));
});

test('How to Play: every skill of every character, with the SKILL_INFO text and the config cooldown', () => {
  const vm = howToViewModel();
  const shown = vm.characters.flatMap((c) => c.skills.map((s) => s.id));
  // All four characters, in the order of the character table (a character has no fixed side).
  const all = Object.keys(CHARACTERS).flatMap((id) => CHARACTERS[id].skills);
  assert.deepEqual(vm.characters.map((c) => c.id), Object.keys(CHARACTERS));
  assert.equal(all.length, 8);
  assert.deepEqual(shown, all);
  for (const character of vm.characters) {
    assert.deepEqual(character.skills.map((s) => s.id), CHARACTERS[character.id].skills, 'grouped by character');
    assert.equal(character.name, CHARACTERS[character.id].name);
    assert.equal(character.colour, markLookFor(character.id).colour, 'the group takes the mark colour of the character');
    assert.equal('stone' in character, false, 'no fixed X or O for a character');
    assert.ok(character.portrait);
    for (const skill of character.skills) {
      assert.equal(skill.description, SKILL_INFO[skill.id].description, 'the text is SKILL_INFO\'s');
      assert.equal(skill.title, SKILL_INFO[skill.id].title);
      assert.ok(skill.icon);
      if (isPassiveSkill(skill.id)) {
        assert.equal(skill.cooldown, 0);
        assert.equal(skill.cooldownText, STRINGS.howToAlwaysOn, 'a passive skill never rests');
      } else {
        assert.equal(skill.cooldown, cooldownTurns(skill.id));
        assert.ok(skill.cooldownText.includes(String(skill.cooldown)));
      }
    }
  }
  const changed = howToViewModel({ ...config, COOLDOWN_SHORT: 11, COOLDOWN_LONG: 17 });
  assert.deepEqual(changed.characters.flatMap((c) => c.skills.map((s) => s.cooldown)).sort((a, b) => a - b), [0, 11, 11, 11, 17, 17, 17, 17]);
});

test('menu-dom.js fills How to Play only from the view model (no skill text copied into the DOM code)', () => {
  const dom = read('src/ui/menu-dom.js');
  for (const info of Object.values(SKILL_INFO)) {
    assert.ok(!dom.includes(info.description.slice(0, 30)), 'no copied description');
  }
  assert.ok(dom.includes('skill.description'));
});

// --- Settings ---

test('settingsViewModel: exactly the levels of the quality table, in key order, with the current one marked', () => {
  const keys = Object.keys(QUALITY_LEVELS);
  assert.deepEqual(qualityLevelNames(), keys);
  for (const current of keys) {
    const vm = settingsViewModel({ quality: current, fullscreen: { supported: true, active: false } });
    assert.deepEqual(vm.levels.map((l) => l.level), keys);
    assert.deepEqual(vm.levels.filter((l) => l.current).map((l) => l.level), [current]);
    for (const level of vm.levels) {
      assert.ok(level.help.length > 0);
      assert.equal(level.box, `settings-quality-${level.level}`);
      assert.equal(level.label.toLowerCase(), level.level);
    }
    assert.equal(vm.qualityVisible, true);
  }
  assert.equal(new Set(settingsViewModel({ quality: keys[0] }).levels.map((l) => l.help)).size, keys.length, 'one help line each');
  assert.equal(settingsViewModel({ quality: null }).qualityVisible, false, 'no 3D renderer, nothing to switch');
});

test('settingsViewModel: the Fullscreen row follows fullscreenViewModel and hides without the API', () => {
  assert.equal(settingsViewModel({ fullscreen: { supported: false, active: false } }).fullscreen.visible, false);
  const off = settingsViewModel({ fullscreen: { supported: true, active: false } }).fullscreen;
  const on = settingsViewModel({ fullscreen: { supported: true, active: true } }).fullscreen;
  assert.equal(off.visible, true);
  assert.equal(off.pressed, false);
  assert.equal(on.pressed, true);
  assert.notEqual(off.label, on.label);
});

// --- style and page ---

// The CSS without comments, as [selector, body] blocks.
function cssBlocks(text) {
  // The base rules only: the @media blocks (short windows, phones,
  // reduced motion) adapt them and are left out.
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
}
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g;

test('menu.css: no colour literal outside the token block, and every token colour is one of the Ivory palette', () => {
  const css = read('src/ui/menu.css');
  const known = read('src/ui/screens.css') + read('src/ui/hud.css');
  const blocks = cssBlocks(css);
  const tokens = blocks.filter(([selector, body]) => selector === '#flow' && body.includes('--ink:'));
  assert.equal(tokens.length, 1, 'one token block');
  for (const [selector, body] of blocks) {
    if (selector === '#flow' && body.includes('--ink:')) {
      for (const declaration of body.split(';').map((d) => d.trim()).filter(Boolean)) {
        assert.ok(declaration.startsWith('--'), `only tokens in the token block: ${declaration}`);
        const value = declaration.slice(declaration.indexOf(':') + 1).trim();
        if (value.match(COLOUR)) assert.ok(known.includes(value), `${declaration} is an Ivory palette colour`);
      }
      continue;
    }
    assert.equal(body.match(COLOUR), null, `${selector} uses tokens only`);
  }
});

test('menu.css: menu buttons at least 240 by 44 px, single words with air between them; panels 720 px wide, 80 percent high, 44 px Close', () => {
  const blocks = new Map(cssBlocks(read('src/ui/menu.css')).map(([selector, body]) => [selector, body]));
  const px = (selector, property) => {
    const match = blocks.get(selector)?.match(new RegExp(`(?:^|[;\\s])${property}:\\s*(\\d+)px`));
    return match ? Number(match[1]) : null;
  };
  // The card is 400 px wide, so the buttons (full card width less its
  // padding) are 336 px (Design v4 part 2, tests/menu-landing.test.js).
  assert.ok(px('#flow .menu-card', 'width') - 2 * 32 >= 240);
  assert.ok(px('#flow .menu-button', 'min-height') >= 44);
  assert.ok(px('#flow button', 'min-height') >= 44);
  assert.ok(px('#flow .menu-buttons', 'gap') > 0, 'air between the choices');
  assert.match(blocks.get('#flow .menu-button'), /border: 0;/, 'no rule between the choices');
  assert.match(blocks.get('#flow .menu-hint'), /clip-path: inset\(50%\)/, 'the hint is for screen readers only');
  assert.match(blocks.get('#flow .menu-buttons'), /flex-direction: column/);
  assert.match(blocks.get('#flow .panel'), /width: min\(720px/);
  assert.match(blocks.get('#flow .panel'), /max-height: 80vh/);
  assert.match(blocks.get('#flow .panel-body'), /overflow-y: auto/);
  assert.equal(px('#flow .panel .close', 'height'), 44);
  assert.match(blocks.get('#flow button:focus-visible'), /outline: 2px solid var\(--ink\)/);
});

test('index.html: one menu layer, the menu styles, and no new canvas', () => {
  const html = read('index.html');
  assert.equal((html.match(/<canvas/g) ?? []).length, 2, 'only the WebGL world and the 2D overlay');
  assert.ok(html.includes('<div id="flow" hidden></div>'));
  assert.ok(html.includes('href="src/ui/menu.css"'));
  const dom = read('src/ui/menu-dom.js');
  assert.ok(!dom.includes('canvas') && !dom.includes('WebGL'));
  assert.ok(!/['"](low|medium|high)['"]/.test(dom + read('src/ui/menu.js')), 'no level name in the menu code');
});
