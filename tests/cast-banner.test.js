// The cast banner (docs/skill-banner-art.md): the pure view of cast-view.js
// (castBannerView), the picture files in assets/3d/v6, the DOM of hud.js on
// the fake DOM (tests/fake-hud-dom.js) and the motion rules in hud.css.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { O, X } from '../src/logic/board.js';
import { CHARACTERS, EARTH_BEAR, WIND_RABBIT } from '../src/logic/characters.js';
import { newGame, placeStone, useSkill } from '../src/logic/game.js';
import { MUD_TRAP, SKILLS, TORNADO_ZONE, WIND_DASH, isPassiveSkill } from '../src/logic/skills.js';
import { SKILL_BANNER_IN_MS, SKILL_BANNER_MEDALLION, SKILL_BANNER_MS, SKILL_BANNER_OUT_MS, SKILL_BANNER_PX, SKILL_BANNER_SPARKS } from '../src/config.js';
import { ART, artNames } from '../src/render3d/art-assets.js';
import { castBannerView, castCssVars, flashColour } from '../src/ui/cast-view.js';
import { SPECTATOR_VIEW, hudViewModel } from '../src/ui/hud-view.js';
import { createHud } from '../src/ui/hud.js';
import { SKILL_INFO } from '../src/ui/skill-info.js';
import { STRINGS } from '../src/ui/strings.js';
import { allNodes, byClass, fakeElement, installFakeWindow } from './fake-hud-dom.js';
import { png } from './png-read.js';

const css = readFileSync(new URL('../src/ui/hud.css', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
const entryOf = (name) => Object.entries(manifest.assets ?? manifest).find(([key, entry]) => (entry.name ?? key) === name)?.[1];

const ACTIVE = Object.keys(SKILLS).filter((id) => !isPassiveSkill(id));
const KEYS = ['art', 'character', 'colour', 'key', 'medallion', 'secret', 'skill', 'title'];

// The character that has the skill plays X; another one plays O.
function casting(skill) {
  const owner = Object.values(CHARACTERS).find((c) => c.skills.includes(skill)).id;
  const other = owner === EARTH_BEAR ? WIND_RABBIT : EARTH_BEAR;
  return { ...newGame({ characters: { [X]: owner, [O]: other } }), skillUsed: skill };
}

test('seven active skills have a banner, Sky Watch (passive) has none', () => {
  assert.equal(ACTIVE.length, 7);
  assert.deepEqual(Object.keys(ART.banner).sort(), [...ACTIVE].sort());
  for (const skill of ACTIVE) assert.ok(castBannerView(casting(skill), { local: true }), skill);
  const passive = Object.keys(SKILLS).filter(isPassiveSkill);
  assert.ok(passive.length >= 1);
  for (const skill of passive) assert.equal(castBannerView(casting(skill), { local: true }), null, skill);
});

test('the banner names the skill and the character, with the colour of the flash and the art of its skill', () => {
  for (const skill of ACTIVE) {
    const state = casting(skill);
    const view = castBannerView(state, { local: true });
    const character = CHARACTERS[state.characters[X]];
    assert.deepEqual(Object.keys(view).sort(), KEYS);
    assert.equal(view.skill, skill);
    assert.equal(view.art, ART.banner[skill]);
    assert.equal(view.title, SKILL_INFO[skill].title);
    assert.equal(view.character, character.name);
    assert.equal(view.colour, flashColour(skill, character.id));
    assert.equal(view.key, `${state.turn}:${skill}:banner`);
    const { x, y, size } = view.medallion;
    for (const share of [x, y, size]) assert.ok(share > 0 && share < 1, `${skill} medallion share ${share}`);
  }
});

test('players and spectators see the same banner; only a Tornado Zone is named differently to the seat that cannot act', () => {
  for (const skill of ACTIVE) {
    const state = casting(skill);
    const caster = castBannerView(state, { you: X });
    const other = castBannerView(state, { you: O });
    const spectator = castBannerView(state, { watching: true });
    const local = castBannerView(state, { local: true });
    assert.deepEqual(local, caster, `${skill}: one screen plays both sides`);
    assert.equal(other.key, caster.key, skill);
    assert.equal(spectator.key, caster.key, skill);
    assert.equal(other.character, caster.character, skill);
    if (skill === TORNADO_ZONE) {
      assert.equal(caster.title, SKILL_INFO[TORNADO_ZONE].title);
      assert.equal(caster.secret, false);
      for (const view of [other, spectator]) {
        assert.equal(view.title, STRINGS.trapBannerTitle);
        assert.equal(view.secret, true);
        assert.doesNotMatch(`${view.title} ${view.character}`, /\d/, 'no cell in the words');
      }
    } else {
      assert.deepEqual(other, caster, skill);
      assert.deepEqual(spectator, caster, skill);
    }
  }
});

test('the Tornado Zone banner of the other seat is the same wherever the trap lies', () => {
  const trapAt = (x, y) => {
    const state = newGame({ characters: { [X]: WIND_RABBIT, [O]: EARTH_BEAR } });
    const used = useSkill(state, { player: X, skill: TORNADO_ZONE, target: { x, y } });
    assert.equal(used.ok, true, used.error);
    return used.state;
  };
  const a = castBannerView(trapAt(7, 7), { you: O });
  const b = castBannerView(trapAt(3, 11), { you: O });
  assert.ok(a);
  assert.deepEqual(a, b);
});

test('the banner shows from the skill to the planting, and never after the game is over', () => {
  const state = newGame({ characters: { [X]: EARTH_BEAR, [O]: WIND_RABBIT } });
  assert.equal(castBannerView(state, { local: true }), null, 'no skill used yet');
  const cast = useSkill(state, { player: X, skill: MUD_TRAP, target: { x: 6, y: 6 } });
  assert.equal(cast.ok, true, cast.error);
  assert.equal(castBannerView(cast.state, { local: true }).skill, MUD_TRAP, 'after the skill');
  const planted = placeStone(cast.state, { player: X, x: 2, y: 2 });
  assert.equal(planted.ok, true, planted.error);
  assert.equal(castBannerView(planted.state, { local: true }), null, 'after the planting');
  assert.equal(castBannerView({ ...casting(MUD_TRAP), winner: X }, { local: true }), null, 'game over');
});

test('hudViewModel carries the banner for a player, the other seat and a spectator', () => {
  const state = casting(MUD_TRAP);
  for (const localPlayer of [null, X, O, SPECTATOR_VIEW]) {
    const banner = hudViewModel(state, {}, localPlayer).banner;
    assert.equal(banner.skill, MUD_TRAP, String(localPlayer));
    assert.equal(banner.art, ART.banner[MUD_TRAP]);
  }
  assert.equal(hudViewModel(newGame({}), {}, null).banner, null);
});

test('the banner files exist in the manifest at the banner size and hold the empty medallion the table says', () => {
  const names = artNames(ART.banner);
  assert.equal(names.length, ACTIVE.length);
  assert.deepEqual(Object.keys(SKILL_BANNER_MEDALLION).sort(), [...ACTIVE].sort());
  for (const skill of ACTIVE) {
    const name = ART.banner[skill];
    const entry = entryOf(name);
    assert.ok(entry, `${name} is in the manifest`);
    assert.equal(entry.use, '3d');
    assert.deepEqual([entry.width, entry.height, entry.frames], [SKILL_BANNER_PX.width, SKILL_BANNER_PX.height, 1], name);
    const picture = png(`../assets/${entry.file}`);
    assert.deepEqual([picture.width, picture.height], [SKILL_BANNER_PX.width, SKILL_BANNER_PX.height], name);

    // Binary alpha, a limited palette, and no magenta left over from the key.
    const colours = new Set();
    for (let y = 0; y < picture.height; y++) {
      for (let x = 0; x < picture.width; x++) {
        const [r, g, b, a] = picture.at(x, y);
        assert.ok(a === 0 || a === 255, `${name} has partly see-through pixels at ${x},${y}`);
        if (a === 255) {
          colours.add(`${r},${g},${b}`);
          assert.ok(!(r > 200 && b > 200 && g < 90), `${name} still has magenta at ${x},${y}`);
        }
      }
    }
    assert.ok(colours.size <= 40, `${name} has ${colours.size} colours`);

    // The medallion disc is one flat navy colour (the icon is drawn on it by the page).
    const [cx, cy, radius] = SKILL_BANNER_MEDALLION[skill];
    const centre = picture.at(cx, cy);
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (Math.hypot(x - cx, y - cy) > radius - 1) continue;
        const [r, g, b, a] = picture.at(x, y);
        assert.equal(a, 255, `${name}: the medallion disc is solid at ${x},${y}`);
        assert.ok(Math.abs(r - centre[0]) + Math.abs(g - centre[1]) + Math.abs(b - centre[2]) < 60, `${name}: something is drawn in the medallion at ${x},${y}`);
      }
    }
    assert.ok(centre[2] > centre[0] && centre[2] > centre[1], `${name}: the medallion is navy`);
  }
});

test('the banner timings fit together and reach the CSS from config', () => {
  assert.ok(SKILL_BANNER_IN_MS + SKILL_BANNER_OUT_MS < SKILL_BANNER_MS);
  const vars = castCssVars();
  assert.equal(vars['--banner-in-ms'], `${SKILL_BANNER_IN_MS}ms`);
  assert.equal(vars['--banner-out-ms'], `${SKILL_BANNER_OUT_MS}ms`);
  assert.equal(vars['--banner-out-delay'], `${SKILL_BANNER_MS - SKILL_BANNER_OUT_MS}ms`);
});

// --- The DOM ---

function setup({ holdCast = false, assets = null } = {}) {
  const fake = installFakeWindow();
  const root = fakeElement('div');
  root.hidden = true;
  const hud = createHud(root, { onSkill() {}, onQuality() {}, onCancel() {} }, assets, { holdCast });
  hud.show(true);
  return { ...fake, root, hud, banner: byClass(root, 'cast-banner')[0] };
}
const render = (hud, state, viewer = null) => hud.render(hudViewModel(state, {}, viewer));
const textOf = (node, className) => byClass(node, className)[0].textContent;

test('the HUD plays the banner once for a new cast and hides it when its time is up', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const t = setup();
  try {
    assert.equal(t.banner.hidden, true, 'nothing cast yet');
    assert.equal(t.banner.dataset.hudBox, 'cast-banner');
    render(t.hud, casting(MUD_TRAP));
    assert.equal(t.banner.hidden, false);
    assert.ok(t.banner.classList.contains('is-playing'));
    assert.equal(t.banner.dataset.skill, MUD_TRAP);
    assert.equal(textOf(t.banner, 'cb-title'), SKILL_INFO[MUD_TRAP].title);
    assert.equal(textOf(t.banner, 'cb-char'), CHARACTERS[EARTH_BEAR].name);
    assert.equal(t.banner.style.props['--cast-colour'], flashColour(MUD_TRAP, EARTH_BEAR));
    assert.equal(byClass(t.banner, 'cb-spark').length, SKILL_BANNER_SPARKS);

    // The same cast drawn again does not restart it.
    t.banner.classList.remove('is-playing');
    render(t.hud, casting(MUD_TRAP));
    assert.equal(t.banner.classList.contains('is-playing'), false, 'same key, no replay');
    render(t.hud, casting(MUD_TRAP));

    // A cast that leaves the view model (the turn went on) lets the banner finish.
    mock.timers.tick(SKILL_BANNER_MS - 100);
    render(t.hud, newGame({}));
    assert.equal(t.banner.hidden, false, 'still up before its time');
    mock.timers.tick(200);
    assert.equal(t.banner.hidden, true, 'hidden after SKILL_BANNER_MS');
    assert.equal(t.banner.classList.contains('is-playing'), false);
  } finally {
    t.restore();
    mock.timers.reset();
  }
});

test('a new cast replaces the banner on screen', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const t = setup();
  try {
    render(t.hud, casting(MUD_TRAP));
    mock.timers.tick(500);
    render(t.hud, casting(WIND_DASH));
    assert.equal(t.banner.dataset.skill, WIND_DASH);
    assert.equal(textOf(t.banner, 'cb-title'), SKILL_INFO[WIND_DASH].title);
    mock.timers.tick(SKILL_BANNER_MS - 400); // the first cast's timer would have fired by now
    assert.equal(t.banner.hidden, false, 'the new cast has its own full time');
  } finally {
    t.restore();
    mock.timers.reset();
  }
});

test('in shot mode (holdCast) the banner stays', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const t = setup({ holdCast: true });
  try {
    render(t.hud, casting(MUD_TRAP));
    mock.timers.tick(SKILL_BANNER_MS * 3);
    assert.equal(t.banner.hidden, false);
    assert.ok(t.banner.classList.contains('is-playing'));
    assert.ok('castHold' in t.root.dataset);
  } finally {
    t.restore();
    mock.timers.reset();
  }
});

test('with the picture missing the banner shows the plain plaque and still reads the names', () => {
  const t = setup({ assets: { get: () => null } });
  try {
    render(t.hud, casting(MUD_TRAP));
    const plaque = byClass(t.banner, 'cb-plaque')[0];
    assert.ok(plaque.classList.contains('no-art'), 'the CSS plaque stands in');
    assert.equal(byClass(t.banner, 'cb-medal')[0].classList.contains('no-art'), true);
    assert.equal(textOf(t.banner, 'cb-title'), SKILL_INFO[MUD_TRAP].title);
    assert.match(css, /\.cb-plaque\.no-art\s*\{[^}]*background/);
  } finally {
    t.restore();
  }
});

test('the banner takes no clicks and has the text of a status', () => {
  const t = setup();
  try {
    assert.equal(t.banner.attrs.role, 'status');
    assert.match(css, /\.hud \.cast-banner\s*\{[^}]*pointer-events: none/);
    assert.equal(allNodes(t.banner).filter((n) => n.tag === 'button').length, 0, 'no button inside');
  } finally {
    t.restore();
  }
});

// --- The motion rules ---

test('the banner animates opacity and transforms only, and stands still under reduced motion and in shot mode', () => {
  const frames = [...css.matchAll(/@keyframes (cb-[a-z]+) \{((?:[^{}]|\{[^{}]*\})*)\}/g)];
  assert.ok(frames.length >= 8, 'in, out, unfurl, pop, ring, shine, text, spark, judder');
  for (const [, name, body] of frames) {
    const props = new Set([...body.matchAll(/([a-z-]+):\s*[^;{}]+;/g)].map((m) => m[1]));
    for (const prop of props) assert.ok(['opacity', 'transform', 'translate'].includes(prop), `${name} animates ${prop}`);
  }
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.hud \.cast-banner\.is-playing, \.hud \.cast-banner\.is-playing \* \{ animation: none !important/);
  assert.match(css, /\.hud\[data-cast-hold\] \.cast-banner\.is-playing[^{]*\{ animation: none !important/);
  // Every part rests in its finished look: the unfurl, pop and text only start somewhere else.
  assert.match(css, /\.hud \.cb-ring \{[^}]*opacity: 0/);
  assert.match(css, /\.hud \.cb-spark \{[^}]*opacity: 0/);
  assert.match(css, /\.hud \.cb-shine \{[^}]*opacity: 0/);
});

test('every skill has its own way in and the colours come from tokens', () => {
  for (const skill of ACTIVE) assert.match(css, new RegExp(`\\.cast-banner\\[data-skill="${skill}"\\]`), skill);
  const rules = css.slice(css.indexOf('The cast banner (docs/skill-banner-art.md)'), css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .hud .card.is-cast'));
  const outsideTokens = rules.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(outsideTokens, [], 'no hex colour in the banner rules');
  assert.equal(SKILL_BANNER_PX.width / SKILL_BANNER_PX.height, 400 / 60);
});
