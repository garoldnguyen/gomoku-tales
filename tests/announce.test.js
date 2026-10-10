// The turn banner and the first-game hints (src/ui/announce.js): what is
// announced for a change of the HUD inputs, the words of each hint, and
// that each hint shows once per browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HINT_MS, TURN_BANNER_MS } from '../src/config.js';
import { O, X } from '../src/logic/board.js';
import { CLOUD_EAGLE, JADE_SERPENT } from '../src/logic/characters.js';
import { createInitialState, placeStone, useSkill } from '../src/logic/game.js';
import { HISS, TORNADO_ZONE } from '../src/logic/skills.js';
import { CHARACTER_LOOK } from '../src/render3d/character-look.js';
import {
  HINT_STORAGE_KEY, HINT_TOUCH, HINT_WIN, announcements, createAnnouncer, hintText, parseSeen, skillHintId,
} from '../src/ui/announce.js';
import { skillInfo } from '../src/ui/skill-info.js';
import { STRINGS } from '../src/ui/strings.js';

const sides = { [X]: JADE_SERPENT, [O]: CLOUD_EAGLE };

test('on one screen the banner names the character to move whenever the turn passes', () => {
  const start = createInitialState(undefined, sides);
  const first = announcements(null, start, null, { local: true });
  assert.deepEqual(first.banner, { name: 'Jade Serpent', colour: CHARACTER_LOOK[JADE_SERPENT].colour });
  const same = announcements(first.next, start, null, { local: true });
  assert.equal(same.banner, null, 'no banner while the same player is to move');
  const after = placeStone(start, { player: X, x: 7, y: 7 }).state;
  assert.equal(announcements(same.next, after, null, { local: true }).banner.name, 'Cloud Eagle');
  assert.equal(announcements(null, start, null, { local: false }).banner, null, 'online: no banner');
});

test('the first game shows the five in a row hint, a picked skill its own hint, a spectator none', () => {
  const start = createInitialState(undefined, sides);
  const first = announcements(null, start, null, { local: false });
  assert.deepEqual(first.hints, [HINT_WIN]);
  assert.deepEqual(announcements(first.next, start, null, { local: false }).hints, [], 'once per game');
  const picked = announcements(first.next, start, { skill: TORNADO_ZONE }, { local: false });
  assert.deepEqual(picked.hints, [skillHintId(TORNADO_ZONE)]);
  assert.deepEqual(announcements(picked.next, start, { skill: TORNADO_ZONE }, { local: false }).hints, []);
  assert.deepEqual(announcements(null, start, null, { watching: true }).hints, []);
});

test('the words of each hint come from strings.js and SKILL_INFO', () => {
  assert.deepEqual(hintText(HINT_WIN), { title: STRINGS.hintWinTitle, text: STRINGS.hintWinText });
  assert.deepEqual(hintText(HINT_TOUCH), { title: STRINGS.hintTouchTitle, text: STRINGS.hintTouchText });
  const info = skillInfo(TORNADO_ZONE);
  assert.deepEqual(hintText(skillHintId(TORNADO_ZONE)), { title: info.title, text: `${info.description} ${STRINGS.hintCancel}` });
  assert.equal(hintText('nope'), null);
  assert.deepEqual([...parseSeen('["a","b",3]')], ['a', 'b']);
  assert.equal(parseSeen('{bad').size, 0);
  assert.equal(parseSeen(null).size, 0);
});

// A tiny stand-in for the DOM the announcer builds.
function fakeElement(tag) {
  const node = {
    tag, children: [], hidden: false, textContent: '', dataset: {}, attrs: {}, listeners: {}, offsetWidth: 1,
    classes: new Set(),
    style: { props: {}, setProperty(name, value) { this.props[name] = value; } },
    append(child) { this.children.push(child); },
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
  };
  node.classList = {
    add: (name) => node.classes.add(name),
    remove: (name) => node.classes.delete(name),
    contains: (name) => node.classes.has(name),
  };
  Object.defineProperty(node, 'className', { set(value) { for (const c of value.split(' ')) node.classes.add(c); } });
  return node;
}

function setup(stored = null) {
  const root = fakeElement('div');
  root.ownerDocument = { createElement: fakeElement };
  const storage = { data: stored === null ? {} : { [HINT_STORAGE_KEY]: stored }, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
  const timers = [];
  const announcer = createAnnouncer(root, {
    storage,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {},
  });
  const [banner, card] = root.children;
  return { root, storage, timers, announcer, banner, card };
}

test('the announcer shows the banner for TURN_BANNER_MS and each hint once, remembered in storage', () => {
  const { storage, timers, announcer, banner, card } = setup();
  const start = createInitialState(undefined, sides);
  announcer.onHud(start, null, true, false);
  assert.equal(banner.hidden, false);
  assert.ok(banner.classes.has('is-shown'));
  assert.equal(banner.children[1].textContent, 'Jade Serpent');
  assert.equal(banner.style.props['--banner-colour'], CHARACTER_LOOK[JADE_SERPENT].colour);
  assert.ok(timers.some((t) => t.ms === TURN_BANNER_MS));
  assert.equal(card.hidden, false, 'the five in a row hint');
  assert.equal(card.children[0].textContent, STRINGS.hintWinTitle);
  assert.ok(timers.some((t) => t.ms === HINT_MS));
  assert.deepEqual(JSON.parse(storage.data[HINT_STORAGE_KEY]), [HINT_WIN]);

  announcer.touchPreview(); // queued behind the shown hint
  card.children[2].listeners.click(); // Got it
  assert.equal(card.children[0].textContent, STRINGS.hintTouchTitle, 'the next hint follows');
  card.children[2].listeners.click();
  assert.equal(card.hidden, true);

  announcer.reset();
  announcer.touchPreview();
  announcer.onHud(start, null, true, false);
  assert.equal(card.hidden, true, 'seen hints never show again');
});

test('hints stored in an earlier visit stay hidden', () => {
  const { announcer, card } = setup(JSON.stringify([HINT_WIN]));
  announcer.onHud(createInitialState(undefined, sides), null, false, false);
  assert.equal(card.hidden, true);
});

test('after a skill the banner says to plant a seed, without the To play label, and the turn banner comes back after the planting', () => {
  const { timers, announcer, banner } = setup();
  const start = createInitialState(undefined, sides);
  announcer.onHud(start, null, true, false);
  assert.equal(banner.children[0].hidden, false, 'the turn banner shows its label');
  assert.equal(banner.children[0].textContent, STRINGS.turnBannerKicker);

  const used = useSkill(start, { player: X, skill: HISS });
  assert.equal(used.ok, true, used.error);
  banner.hidden = true;
  announcer.onHud(used.state, null, true, false);
  assert.equal(banner.hidden, false);
  assert.equal(banner.children[0].hidden, true, 'no label on the plant reminder');
  assert.equal(banner.children[1].textContent, STRINGS.plantToEndTurn);
  assert.equal(banner.style.props['--banner-colour'], CHARACTER_LOOK[JADE_SERPENT].colour);
  assert.ok(timers.filter((t) => t.ms === TURN_BANNER_MS).length >= 2);

  banner.hidden = true;
  announcer.onHud(used.state, null, true, false);
  assert.equal(banner.hidden, true, 'the same state shows nothing again');

  const planted = placeStone(used.state, { player: X, x: 0, y: 0 });
  announcer.onHud(planted.state, null, true, false);
  assert.equal(banner.hidden, false);
  assert.equal(banner.children[0].hidden, false, 'the label is back');
  assert.equal(banner.children[1].textContent, 'Cloud Eagle');
});
