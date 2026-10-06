// Game v5 part 5: the see-through character select and its skill tooltips.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SELECT_BLUR_PX, SELECT_CARD_OPACITY, SELECT_PANEL_OPACITY, SELECT_SCRIM_OPACITY,
} from '../src/config.js';
import { CHARACTERS } from '../src/logic/characters.js';
import { createSeats } from '../src/logic/seats.js';
import { cooldownTurns, isPassiveSkill } from '../src/logic/skills.js';
import { GUEST, HOST, ROOM_SEATS } from '../src/net/room.js';
import { LOCAL_SEATS } from '../src/ui/flow.js';
import {
  GLASS_SOLID_ALPHA, characterSelectViewModel, restText, selectGlassStyle,
} from '../src/ui/room-screens.js';
import {
  SELECT_TIP_HOVER_MS, TIP_CLOSED, selectTipReducer, selectTipViewModel, tipDelay,
} from '../src/ui/select-tooltip.js';
import { SKILL_INFO, skillInfo } from '../src/ui/skill-info.js';
import { STRINGS } from '../src/ui/strings.js';
import { TOOLTIP_MARGIN, TOOLTIP_SHOW_MS, tooltipPosition } from '../src/ui/tooltip-position.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const views = () => [
  characterSelectViewModel({
    seats: createSeats(ROOM_SEATS), labels: { [HOST]: 'A', [GUEST]: 'B' }, editable: [HOST], you: HOST,
  }),
  characterSelectViewModel({
    seats: createSeats(LOCAL_SEATS), labels: { [LOCAL_SEATS[0]]: 'P1', [LOCAL_SEATS[1]]: 'P2' }, editable: LOCAL_SEATS,
  }),
];

// --- the view model ---

test('the character select gives each skill its SKILL_INFO description (the HUD text) and its rest turns', () => {
  for (const vm of views()) {
    for (const card of vm.characters) {
      assert.deepEqual(card.skills.map((skill) => skill.id), CHARACTERS[card.character].skills);
      for (const skill of card.skills) {
        assert.equal(skill.description, SKILL_INFO[skill.id].description);
        assert.equal(skill.description, skillInfo(skill.id).description, 'the same text as the in-game HUD');
        assert.ok(skill.description.length > 0);
        assert.equal(skill.rest, cooldownTurns(skill.id));
        if (isPassiveSkill(skill.id)) {
          // Sky Watch (Cloud Eagle) is always on: no timer, no turns.
          assert.equal(skill.restText, STRINGS.skillAlwaysOn);
          continue;
        }
        assert.equal(skill.restText, restText(skill.rest));
        assert.ok(skill.restText.includes(String(skill.rest)));
      }
    }
  }
});

test('selectTipViewModel: the tooltip shows the skill name, its rest turns and its description', () => {
  const skill = views()[0].characters[2].skills[0];
  assert.deepEqual(selectTipViewModel(skill), {
    title: SKILL_INFO[skill.id].title, restText: skill.restText, description: SKILL_INFO[skill.id].description,
  });
});

// --- showing and closing ---

test('keyboard focus shows the tooltip at once, with no timer', () => {
  const event = { type: 'focus', key: 'a' };
  assert.deepEqual(selectTipReducer(TIP_CLOSED, event), { open: 'a', pending: null });
  assert.equal(tipDelay(event), null);
});

test('a hover shows the tooltip only after about 120 ms', () => {
  assert.equal(SELECT_TIP_HOVER_MS, TOOLTIP_SHOW_MS);
  assert.equal(SELECT_TIP_HOVER_MS, 120);
  const hover = { type: 'hover', key: 'a' };
  assert.equal(tipDelay(hover), SELECT_TIP_HOVER_MS);
  const waiting = selectTipReducer(TIP_CLOSED, hover);
  assert.deepEqual(waiting, { open: null, pending: 'a' }, 'nothing shows before the timer');
  assert.deepEqual(selectTipReducer(waiting, { type: 'hoverTimer', key: 'a' }), { open: 'a', pending: null });
  // A stale timer of another row changes nothing.
  assert.equal(selectTipReducer(waiting, { type: 'hoverTimer', key: 'b' }), waiting);
});

test('pointer leave before the timer cancels the hover, and leave, blur and Escape close the tooltip', () => {
  const waiting = selectTipReducer(TIP_CLOSED, { type: 'hover', key: 'a' });
  const left = selectTipReducer(waiting, { type: 'leave', key: 'a' });
  assert.deepEqual(left, TIP_CLOSED);
  assert.deepEqual(selectTipReducer(left, { type: 'hoverTimer', key: 'a' }), TIP_CLOSED, 'the old timer shows nothing');
  const open = { open: 'a', pending: null };
  assert.deepEqual(selectTipReducer(open, { type: 'leave', key: 'a' }), TIP_CLOSED);
  assert.deepEqual(selectTipReducer(open, { type: 'blur', key: 'a' }), TIP_CLOSED);
  assert.deepEqual(selectTipReducer(open, { type: 'escape' }), TIP_CLOSED);
  assert.equal(selectTipReducer(open, { type: 'leave', key: 'b' }), open, 'leaving another row keeps it');
  assert.equal(selectTipReducer(TIP_CLOSED, { type: 'escape' }), TIP_CLOSED);
});

test('focus on another row moves the tooltip, and a hover over the open row keeps it', () => {
  const open = { open: 'a', pending: null };
  assert.deepEqual(selectTipReducer(open, { type: 'focus', key: 'b' }), { open: 'b', pending: null });
  assert.equal(selectTipReducer(open, { type: 'hover', key: 'a' }), open);
});

// --- placement ---

test('tooltipPosition keeps the skill tooltip inside the viewport for rows anywhere in the window', () => {
  const sizes = [{ width: 300, height: 120 }, { width: 300, height: 200 }, { width: 366, height: 160 }];
  const viewports = [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 390, height: 844 }];
  for (const viewport of viewports) {
    for (const size of sizes) {
      const width = Math.min(size.width, viewport.width - 24);
      for (let x = 0; x <= viewport.width - 40; x += 37) {
        for (let y = 0; y <= viewport.height - 24; y += 41) {
          const at = tooltipPosition({ left: x, top: y, width: 180, height: 24 }, { width, height: size.height }, viewport);
          const where = `${viewport.width}x${viewport.height} row ${x},${y}`;
          assert.ok(at.left >= TOOLTIP_MARGIN && at.left + width <= viewport.width - TOOLTIP_MARGIN + 1e-9, where);
          assert.ok(at.top >= TOOLTIP_MARGIN && at.top + size.height <= viewport.height - TOOLTIP_MARGIN + 1e-9, where);
        }
      }
    }
  }
});

// --- the see-through glass ---

test('selectGlassStyle (Ivory): no panel, solid paper cards, an 80 percent wash, an 8 px blur only when frosted', () => {
  assert.equal(SELECT_PANEL_OPACITY, 0);
  assert.equal(SELECT_CARD_OPACITY, 1);
  assert.equal(SELECT_SCRIM_OPACITY, 0.8);
  assert.equal(SELECT_BLUR_PX, 8);
  const style = selectGlassStyle({ frosted: true });
  const opacity = (mix) => (parseFloat(mix) / 100) * GLASS_SOLID_ALPHA;
  assert.ok(Math.abs(opacity(style['--panel-mix']) - SELECT_PANEL_OPACITY) < 0.005);
  assert.ok(Math.abs(opacity(style['--character-mix']) - SELECT_CARD_OPACITY) < 0.005);
  assert.ok(Math.abs(opacity(style['--scrim-mix']) - SELECT_SCRIM_OPACITY) < 0.005);
  assert.equal(style['--select-blur'], '8px');
  assert.equal(selectGlassStyle({ frosted: false })['--select-blur'], '0px');
});

test('room.css: the select mixes the ivory --card-solid paper, with defaults equal to selectGlassStyle', () => {
  assert.equal(GLASS_SOLID_ALPHA, 1, 'the ivory paper is opaque');
  assert.ok(read('src/ui/room.css').includes('--card-solid: #fffdf8;'));
  const css = read('src/ui/room.css');
  for (const [name, value] of Object.entries(selectGlassStyle({ frosted: true }))) {
    assert.ok(css.includes(`${name}: ${value};`), `${name} default`);
  }
  const block = (selector) => css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))[1];
  assert.match(block('#screens.picking'), /color-mix\(in srgb, var\(--card-solid\) var\(--scrim-mix\), transparent\)/);
  const panel = block('#screens .card.select-card');
  assert.match(panel, /var\(--panel-mix\)/);
  assert.match(panel, /backdrop-filter: blur\(var\(--select-blur\)\)/);
  assert.match(panel, /border: 1px solid transparent/, 'no box: the cards lie on the wash');
  assert.match(block('#screens.is-solid .card.select-card'), /backdrop-filter: none/);
  const card = block('#screens .character');
  assert.match(card, /var\(--character-mix\)/);
  assert.match(card, /border: 1px solid var\(--hair\)/, 'a hairline border');
  assert.match(block('#screens .character.is-selected'), /border-color: var\(--gold\)/, 'a gold hairline on the pick');
  assert.match(block('#screens .character.is-selected'), /outline: 1px solid var\(--gold\)/, 'and a gold frame set off the card');
});

test('room.css: the portrait has no tile or frame, only a soft glow that fades into the card', () => {
  const css = read('src/ui/room.css');
  const tile = css.match(/#screens \.emblem-tile \{([^}]*)\}/)[1];
  assert.match(tile, /background: radial-gradient\(closest-side, var\(--c-tile\), transparent\)/);
  assert.doesNotMatch(tile, /border/);
  assert.doesNotMatch(css, /border: 2px/, 'no 2 px borders left');
});

test('room.css: on phones the four cards sit two by two, the portrait over the text, and the game over card clears the Fullscreen button', () => {
  const css = read('src/ui/room.css');
  const phone = css.slice(css.indexOf('@media (max-width: 600px) {\n  #screens.picking'));
  assert.match(phone, /#screens \.characters \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.doesNotMatch(phone.slice(0, phone.indexOf('@media (prefers-reduced-motion')), /grid-template-columns: var\(--stage-w\)/, 'no side by side stage on phones');
  assert.match(css, /@media \(max-width: 600px\) \{\s*#screens\.over \{\s*padding-top: 136px;/);
});
