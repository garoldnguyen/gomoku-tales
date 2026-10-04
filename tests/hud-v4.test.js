// Design v4, part 3: the smaller expanded HUD card, the skill icons that
// fill their buttons and the skill detail popup (src/ui/hud-view.js
// skillPopupViewModel, src/ui/hud-layout.js, src/ui/hud.css).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HUD_CARD_HEIGHT_PX, HUD_CARD_WIDTH_PX, HUD_SKILL_ROW_PX } from '../src/config.js';
import { X, O } from '../src/logic/board.js';
import { characterForStone } from '../src/logic/characters.js';
import { createInitialState, placeStone } from '../src/logic/game.js';
import { SKILLS } from '../src/logic/skills.js';
import { ALL_COLLAPSED, ALL_EXPANDED } from '../src/ui/hud-collapse.js';
import { CARD_HEIGHT, CARD_WIDTH, MIN_CARD_SCALE, cardBox, hudBoxes, hudLayout } from '../src/ui/hud-layout.js';
import { hudViewModel, skillPopupViewModel } from '../src/ui/hud-view.js';
import { SKILL_INFO } from '../src/ui/skill-info.js';
import { startTargeting } from '../src/ui/targeting.js';

const css = readFileSync(new URL('../src/ui/hud.css', import.meta.url), 'utf8');

test('the expanded card is 250 by at most 310 px at 1920x1080', () => {
  assert.equal(HUD_CARD_WIDTH_PX, 250);
  assert.equal(HUD_CARD_HEIGHT_PX, 310);
  assert.equal(CARD_WIDTH, HUD_CARD_WIDTH_PX);
  assert.equal(CARD_HEIGHT, HUD_CARD_HEIGHT_PX);
  const layout = hudLayout(1920, 1080);
  assert.equal(layout.compact, false);
  assert.equal(layout.scale, 1);
  assert.deepEqual(cardBox(layout.scale), { w: 250, h: 310 });
  for (const name of ['card-x', 'card-o']) {
    const box = hudBoxes(1920, 1080, { collapsed: ALL_EXPANDED }).find((b) => b.name === name);
    assert.equal(box.w, 250);
    assert.ok(box.h <= 310);
  }
  // The skill rows keep a 44 px touch target at the smallest card scale.
  assert.ok(HUD_SKILL_ROW_PX * MIN_CARD_SCALE >= 44 - 1e-9);
  // hud.css draws the same width and row height.
  assert.match(css, new RegExp(`\\.hud \\.card \\{ width: ${HUD_CARD_WIDTH_PX}px;`));
  assert.match(css, new RegExp(`\\.hud \\.skill \\{ height: ${HUD_SKILL_ROW_PX}px;`));
});

test('the skill icons fill their square buttons (object-fit cover)', () => {
  for (const selector of ['.hud .skill .ico img', '.hud .pskill .ico img']) {
    const rules = css.split('\n').filter((line) => line.startsWith(`${selector} {`));
    const last = rules.at(-1) ?? '';
    assert.match(last, /width: 100%; height: 100%; object-fit: cover;/, selector);
  }
  assert.match(css, /\.hud \.pskill \.ico \{ position: absolute; inset: 0; width: 100%; height: 100%;/);
});

function midGame() {
  let state = createInitialState();
  for (const [player, x, y] of [[X, 7, 7], [O, 7, 8], [X, 8, 8], [O, 0, 0]]) {
    state = placeStone(state, { player, x, y }).state;
  }
  return state; // X to move
}

test('the skill popup view model holds the description and hint of each of the four skills', () => {
  const vm = hudViewModel(midGame(), {}, null);
  const seen = [];
  for (const player of [X, O]) {
    for (const skillId of characterForStone(player).skills) {
      const popup = skillPopupViewModel(vm, player, skillId);
      assert.equal(popup.player, player);
      assert.equal(popup.id, skillId);
      assert.equal(popup.title, SKILL_INFO[skillId].title);
      assert.equal(popup.description, SKILL_INFO[skillId].description);
      assert.equal(popup.hint, SKILL_INFO[skillId].hint);
      assert.ok(popup.stateText.length > 0);
      seen.push(skillId);
    }
  }
  assert.deepEqual(seen.sort(), Object.keys(SKILLS).sort());
  // A skill the card does not have gives null.
  assert.equal(skillPopupViewModel(vm, X, characterForStone(O).skills[0]), null);
});

test('the skill popup state follows the view model', () => {
  const state = midGame();
  const skillId = characterForStone(X).skills[0];
  const idle = skillPopupViewModel(hudViewModel(state, {}, X), X, skillId);
  assert.equal(idle.stateText, 'Ready');
  const targeting = startTargeting(skillId);
  const picked = skillPopupViewModel(hudViewModel(state, { targeting }, X), X, skillId);
  assert.equal(picked.state, 'selected');
  assert.equal(picked.stateText, 'Selected');
  const theirs = skillPopupViewModel(hudViewModel(state, {}, X), O, characterForStone(O).skills[0]);
  assert.equal(theirs.stateText, 'Wait for your turn');
});

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('hud-layout: no overlap and everything inside at 1920x1080, 1280x720, 800x600 and 390x844', () => {
  for (const [w, h] of [[1920, 1080], [1280, 720], [800, 600], [390, 844]]) {
    for (const collapsed of [ALL_EXPANDED, ALL_COLLAPSED]) {
      const boxes = hudBoxes(w, h, { collapsed });
      for (const box of boxes) {
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= w + 1e-9 && box.y + box.h <= h + 1e-9, `${w}x${h} ${box.name} inside`);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          assert.ok(!overlaps(boxes[i], boxes[j]), `${w}x${h} ${boxes[i].name} and ${boxes[j].name}`);
        }
      }
    }
  }
});
