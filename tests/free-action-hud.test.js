// Free Action, part 6 (docs/free-action-design.md section 8): what the HUD
// shows when a skill is used. The pure view model (src/ui/hud-view.js, with
// src/ui/cast-view.js) decides the flash, the extras of each skill, the
// dimmed rows, the lock rune and the notice of the other seat, and hud.js
// only draws them. Nothing here reads a DOM. PRIORITY: no cell of a secret
// trap is ever shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_SIZE, HISS_LOCK_TURNS, HISS_WAVE_COLOUR, HISS_WAVE_MS, HUD_DUST_COUNT, HUD_DUST_MS, HUD_FEATHER_COUNT, HUD_FEATHER_MS,
  HUD_SHAKE_LIGHT_PX, HUD_SHAKE_MS, HUD_SHAKE_PX, HUD_SHAKE_STEPS, LOCKED_ICON_OPACITY, LOCK_BLINK_MS, SKILL_FLASH_MS, VENOM_FLASH_COLOUR,
} from '../src/config.js';
import { O, X } from '../src/logic/board.js';
import { CHARACTERS, CLOUD_EAGLE, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT, assignSides } from '../src/logic/characters.js';
import { newGame, placeStone, useSkill } from '../src/logic/game.js';
import {
  CLOUD, HISS, MUD_TRAP, PETRIFICATION, SKY_WATCH, TORNADO_ZONE, VENOM, WIND_DASH, isPassiveSkill,
} from '../src/logic/skills.js';
import { CHARACTER_LOOK } from '../src/render3d/character-look.js';
import {
  CAST_EXTRAS, DUST_COUNT, FEATHER_COUNT, castCssVars, castDurationMs, castNotice, castView, flashColour, lockView, reactionView,
  shakeFrames, trapNotice,
} from '../src/ui/cast-view.js';
import { announcements } from '../src/ui/announce.js';
import { COOLING, OFF, SPECTATOR_VIEW, hudViewModel } from '../src/ui/hud-view.js';
import { SHOT_FREE_ACTION_SCENE, parseShotParams, setUpShotScene } from '../src/ui/shot-mode.js';
import { createLocalGame } from '../src/ui/local-game.js';
import { STRINGS, fillText, lockedText } from '../src/ui/strings.js';

const ok = (result) => {
  assert.equal(result.ok, true, result.error);
  return result;
};
const place = (state, player, x, y) => ok(placeStone(state, { player, x, y })).state;
const use = (state, player, skill, target = null) => ok(useSkill(state, { player, skill, target })).state;

// X stones at (3, 3) and (4, 4), an O stone at (5, 5), X to move.
function gameFor(sides) {
  const state = newGame({ characters: assignSides(sides) });
  state.board[3][3] = X;
  state.board[4][4] = X;
  state.board[5][5] = O;
  return state;
}

// Every skill, with the sides that give it to X and a target (as in free-action-core.test.js).
const CASES = [
  { skill: WIND_DASH, sides: [WIND_RABBIT, EARTH_BEAR], target: { from: { x: 3, y: 3 }, to: { x: 6, y: 3 } }, character: WIND_RABBIT },
  { skill: TORNADO_ZONE, sides: [WIND_RABBIT, EARTH_BEAR], target: { x: 9, y: 9 }, character: WIND_RABBIT },
  { skill: MUD_TRAP, sides: [EARTH_BEAR, WIND_RABBIT], target: { x: 8, y: 8 }, character: EARTH_BEAR },
  { skill: PETRIFICATION, sides: [EARTH_BEAR, WIND_RABBIT], target: { x: 5, y: 5 }, character: EARTH_BEAR },
  { skill: HISS, sides: [JADE_SERPENT, CLOUD_EAGLE], target: null, character: JADE_SERPENT },
  { skill: VENOM, sides: [JADE_SERPENT, WIND_RABBIT], target: { x: 5, y: 5 }, character: JADE_SERPENT },
  { skill: CLOUD, sides: [CLOUD_EAGLE, WIND_RABBIT], target: { x: 9, y: 9 }, character: CLOUD_EAGLE },
];
const usedState = (c) => use(gameFor(c.sides), X, c.skill, c.target);
const card = (vm, player) => vm.cards.find((entry) => entry.player === player);
const row = (vm, player, id) => card(vm, player).skills.find((s) => s.id === id);

// --- The config constants and the strings ---

test('the cast timings and numbers are named constants in the config', () => {
  for (const [name, value] of Object.entries({
    SKILL_FLASH_MS, HUD_SHAKE_MS, HUD_SHAKE_PX, HUD_SHAKE_LIGHT_PX, HUD_SHAKE_STEPS, HUD_DUST_MS, HUD_DUST_COUNT, HISS_WAVE_MS,
    HUD_FEATHER_MS, HUD_FEATHER_COUNT, LOCK_BLINK_MS,
  })) {
    assert.ok(Number.isFinite(value) && value > 0, `${name} is a positive number`);
  }
  assert.ok(Number.isInteger(HUD_SHAKE_STEPS) && Number.isInteger(HUD_DUST_COUNT) && Number.isInteger(HUD_FEATHER_COUNT));
  assert.ok(HUD_SHAKE_LIGHT_PX < HUD_SHAKE_PX, 'the lock shake is lighter than the Petrification shake');
  assert.equal(LOCKED_ICON_OPACITY, 0.4, 'the icons of a locked card dim to 40 percent');
  assert.match(VENOM_FLASH_COLOUR, /^#[0-9a-f]{6}$/i);
  assert.match(HISS_WAVE_COLOUR, /^#[0-9a-f]{6}$/i);
  assert.equal(DUST_COUNT, HUD_DUST_COUNT);
  assert.equal(FEATHER_COUNT, HUD_FEATHER_COUNT);
});

test('castCssVars hands the config timings to the CSS, nothing typed twice', () => {
  assert.deepEqual(castCssVars(), {
    '--flash-ms': `${SKILL_FLASH_MS}ms`,
    '--shake-ms': `${HUD_SHAKE_MS}ms`,
    '--dust-ms': `${HUD_DUST_MS}ms`,
    '--wave-ms': `${HISS_WAVE_MS}ms`,
    '--wave-colour': HISS_WAVE_COLOUR,
    '--feather-ms': `${HUD_FEATHER_MS}ms`,
    '--blink-ms': `${LOCK_BLINK_MS}ms`,
    '--locked-icon-opacity': String(LOCKED_ICON_OPACITY),
  });
});

test('the strings: Locked is built from HISS_LOCK_TURNS, the trap notice names a character', () => {
  assert.equal(HISS_LOCK_TURNS, 1);
  assert.equal(lockedText(HISS_LOCK_TURNS), 'Locked: 1 turn');
  assert.equal(STRINGS.skillLocked, lockedText(HISS_LOCK_TURNS));
  assert.equal(lockedText(2), 'Locked: 2 turns');
  assert.equal(STRINGS.trapPlaced, '{name} placed a trap!');
  assert.equal(fillText(STRINGS.trapPlaced, { name: CHARACTERS[WIND_RABBIT].name }), 'Wind Rabbit placed a trap!');
});

test('shakeFrames: a shake that settles, lighter for the Hiss lock, on translate only', () => {
  const frames = shakeFrames(false);
  assert.equal(frames.length, HUD_SHAKE_STEPS + 2);
  assert.deepEqual(frames[0], { translate: '0px 0px' });
  assert.deepEqual(frames.at(-1), { translate: '0px 0px' });
  const swing = (list) => Math.max(...list.map((frame) => Math.abs(parseFloat(frame.translate))));
  assert.equal(swing(frames), HUD_SHAKE_PX);
  assert.equal(swing(shakeFrames(true)), HUD_SHAKE_LIGHT_PX);
  for (const frame of frames) assert.deepEqual(Object.keys(frame), ['translate']);
});

test('castDurationMs covers the longest effect of the cast', () => {
  assert.equal(castDurationMs(null), 0);
  assert.equal(castDurationMs({ ...CAST_EXTRAS[WIND_DASH] }), SKILL_FLASH_MS);
  assert.equal(castDurationMs({ ...CAST_EXTRAS[CLOUD] }), Math.max(SKILL_FLASH_MS, HUD_FEATHER_MS));
  assert.equal(castDurationMs({ ...CAST_EXTRAS[PETRIFICATION] }), Math.max(SKILL_FLASH_MS, HUD_SHAKE_MS, HUD_DUST_MS));
  assert.equal(castDurationMs({ ...CAST_EXTRAS[HISS] }), Math.max(SKILL_FLASH_MS, HISS_WAVE_MS));
});

// --- The flash of the user's card ---

test('the flash is the colour of the character, deep purple for Venom', () => {
  for (const id of [WIND_RABBIT, EARTH_BEAR, JADE_SERPENT, CLOUD_EAGLE]) {
    assert.equal(flashColour(WIND_DASH, id), CHARACTER_LOOK[id].colour);
  }
  assert.equal(flashColour(VENOM, JADE_SERPENT), VENOM_FLASH_COLOUR);
  assert.notEqual(VENOM_FLASH_COLOUR, CHARACTER_LOOK[JADE_SERPENT].colour);
  assert.equal(flashColour(HISS, JADE_SERPENT), CHARACTER_LOOK[JADE_SERPENT].colour);
});

test('the view model flashes the card of the skill user and no other card', () => {
  for (const c of CASES) {
    const state = usedState(c);
    for (const viewer of [null, X, O, SPECTATOR_VIEW]) {
      const vm = hudViewModel(state, {}, viewer);
      const cast = card(vm, X).cast;
      assert.ok(cast, `${c.skill}: the card of the user flashes`);
      assert.equal(cast.skill, c.skill);
      assert.equal(cast.colour, flashColour(c.skill, c.character));
      assert.equal(cast.key, `${state.turn}:${c.skill}`, 'a new key for every cast');
      assert.equal(card(vm, O).cast, null, `${c.skill}: the other card does not flash`);
    }
  }
});

test('Petrification shakes the card with dust, Hiss sends a wave, Cloud floats feathers, the rest only flash', () => {
  const extras = (c) => {
    const { shake, dust, wave, feathers } = card(hudViewModel(usedState(c), {}, null), X).cast;
    return { shake, dust, wave, feathers };
  };
  const none = { shake: false, dust: false, wave: false, feathers: false };
  for (const c of CASES) {
    const expected = { ...none };
    if (c.skill === PETRIFICATION) Object.assign(expected, { shake: true, dust: true });
    if (c.skill === HISS) expected.wave = true;
    if (c.skill === CLOUD) expected.feathers = true;
    assert.deepEqual(extras(c), expected, c.skill);
  }
});

test('no cast before a skill, after the planting, and when the game is over', () => {
  const fresh = gameFor([WIND_RABBIT, EARTH_BEAR]);
  assert.equal(castView(fresh, X), null);
  const used = use(fresh, X, WIND_DASH, CASES[0].target);
  assert.ok(castView(used, X));
  assert.equal(castView(place(used, X, 0, 0), X), null, 'the flash is gone when the turn passes');
  assert.equal(castView({ ...used, winner: X }, X), null);
  const vm = hudViewModel({ ...used, winner: X }, {}, X);
  assert.equal(card(vm, X).cast, null);
  assert.equal(card(vm, X).lock, null);
  assert.equal(vm.notice, null);
});

test('Sky Watch is passive: it is never a cast', () => {
  assert.ok(isPassiveSkill(SKY_WATCH));
  assert.equal(Object.hasOwn(CAST_EXTRAS, SKY_WATCH), false);
  const cloud = CASES.find((c) => c.skill === CLOUD);
  assert.equal(castView({ ...usedState(cloud), skillUsed: SKY_WATCH }, X), null);
});

// --- The rows of the card after a skill ---

test('after a skill the used row shows its cooldown at once and the other rows are off', () => {
  for (const c of CASES) {
    const state = usedState(c);
    const vm = hudViewModel(state, {}, X);
    const mine = card(vm, X);
    const used = mine.skills.find((s) => s.id === c.skill);
    assert.equal(used.look, COOLING, `${c.skill}: resting at once`);
    assert.ok(used.cooldownTurns > 0);
    assert.equal(used.disabled, true);
    for (const other of mine.skills.filter((s) => s.id !== c.skill)) {
      if (other.passive) {
        assert.equal(other.stateText, STRINGS.skillAlwaysOn, 'Sky Watch keeps working');
        continue;
      }
      assert.equal(other.look, other.cooldownTurns > 0 ? COOLING : OFF, `${c.skill}: ${other.id}`);
      assert.equal(other.disabled, true);
      if (other.cooldownTurns === 0) {
        assert.equal(other.stateText, STRINGS.skillUsedState);
        assert.equal(other.hint, STRINGS.skillUsedHint);
      }
    }
  }
});

test('the hint stays right after every skill, also the ones with no target', () => {
  for (const c of CASES) {
    const state = usedState(c);
    assert.equal(hudViewModel(state, {}, X).turn.hint, STRINGS.plantToEndTurn, c.skill);
    assert.equal(hudViewModel(state, {}, null).turn.hint, STRINGS.plantToEndTurn, c.skill);
    assert.equal(hudViewModel(state, {}, X).notice.text, STRINGS.plantToEndTurn, c.skill);
  }
  assert.equal(CASES.find((c) => c.skill === HISS).target, null, 'Hiss has no target');
});

// --- Hiss: the opponent's card ---

test('Hiss: the opponent rows dim, the card shakes lightly and shows the red lock rune', () => {
  const c = CASES.find((entry) => entry.skill === HISS);
  const state = usedState(c);
  const vm = hudViewModel(state, {}, X);
  const locked = card(vm, O);
  assert.deepEqual(locked.lock, { text: 'Locked: 1 turn' });
  assert.equal(locked.reaction.shake, true);
  assert.equal(locked.reaction.key, `${state.turn}:${HISS}:hit`);
  assert.equal(locked.cast, null, 'the opponent does not flash');
  for (const s of locked.skills) {
    assert.equal(s.dimmed, !s.passive, `${s.id}: dimmed unless passive`);
    if (!s.passive) assert.equal(s.stateText, STRINGS.skillLocked);
  }
  assert.equal(row(vm, O, SKY_WATCH).dimmed, false, 'Sky Watch is passive and stays bright');
  // The serpent's own card has no lock, no shake and nothing dimmed.
  const own = card(vm, X);
  assert.equal(own.lock, null);
  assert.equal(own.reaction, null);
  assert.ok(own.skills.every((s) => !s.dimmed));
});

test('Hiss: the lock rune shows until the locked player has planted', () => {
  const c = CASES.find((entry) => entry.skill === HISS);
  const hissed = usedState(c);
  const serpentPlanted = place(hissed, X, 0, 0); // the locked player is to move
  const lockedTurn = hudViewModel(serpentPlanted, {}, O);
  assert.deepEqual(card(lockedTurn, O).lock, { text: lockedText(HISS_LOCK_TURNS) });
  assert.equal(card(lockedTurn, O).reaction, null, 'the shake plays on the cast only');
  assert.ok(card(lockedTurn, O).skills.filter((s) => !s.passive).every((s) => s.dimmed && s.disabled));
  const cleared = hudViewModel(place(serpentPlanted, O, 1, 0), {}, O);
  assert.equal(card(cleared, O).lock, null);
  assert.ok(card(cleared, O).skills.every((s) => !s.dimmed));
});

test('only a Hiss locks or shakes the other card', () => {
  for (const c of CASES.filter((entry) => entry.skill !== HISS)) {
    const vm = hudViewModel(usedState(c), {}, X);
    assert.equal(card(vm, O).lock, null, c.skill);
    assert.equal(card(vm, O).reaction, null, c.skill);
    assert.equal(lockView(usedState(c), O), null);
    assert.equal(reactionView(usedState(c), O), null);
  }
});

// --- The Tornado Zone: a secret trap, never a cell ---

const TORNADO = CASES.find((entry) => entry.skill === TORNADO_ZONE);

test('the other seat sees the Wind Rabbit card light up and the trap banner, never a cell', () => {
  const state = usedState(TORNADO);
  const other = hudViewModel(state, {}, O);
  assert.equal(card(other, X).cast.skill, TORNADO_ZONE, 'the Wind Rabbit card lights up');
  assert.equal(other.notice.text, 'Wind Rabbit placed a trap!');
  assert.equal(other.turn.hint, 'Wind Rabbit placed a trap!');
  assert.deepEqual(Object.keys(other.notice).sort(), ['colour', 'key', 'text']);
  assert.deepEqual(trapNotice(state), other.notice);
  assert.equal(castNotice(state, { local: false, you: O }).text, 'Wind Rabbit placed a trap!');
  // The caster is told to plant instead.
  assert.equal(hudViewModel(state, {}, X).notice.text, STRINGS.plantToEndTurn);
});

test('the character name in the trap banner follows the side, whichever stone plays it', () => {
  const swapped = newGame({ characters: assignSides([EARTH_BEAR, WIND_RABBIT]) });
  swapped.board[3][3] = O;
  const afterX = place(swapped, X, 0, 0); // O (Wind Rabbit) to move
  const trapped = use(afterX, O, TORNADO_ZONE, { x: 9, y: 9 });
  assert.equal(hudViewModel(trapped, {}, X).notice.text, 'Wind Rabbit placed a trap!');
  assert.equal(card(hudViewModel(trapped, {}, X), O).cast.skill, TORNADO_ZONE);
});

test('the spectator sees the same flash and the trap banner, with every row disabled', () => {
  const state = usedState(TORNADO);
  const vm = hudViewModel(state, {}, SPECTATOR_VIEW);
  assert.equal(vm.notice.text, 'Wind Rabbit placed a trap!');
  assert.equal(vm.turn.hint, 'Wind Rabbit placed a trap!');
  assert.equal(card(vm, X).cast.skill, TORNADO_ZONE);
  for (const c of vm.cards) assert.ok(c.skills.every((s) => s.disabled), 'a spectator has no input');
  // The same flashes under Petrification and Hiss.
  const hiss = hudViewModel(usedState(CASES.find((entry) => entry.skill === HISS)), {}, SPECTATOR_VIEW);
  assert.deepEqual(card(hiss, O).lock, { text: 'Locked: 1 turn' });
  assert.equal(card(hiss, X).cast.wave, true);
  assert.equal(hiss.notice, null, 'only the trap has a notice for a spectator');
  assert.equal(card(hudViewModel(usedState(CASES.find((entry) => entry.skill === PETRIFICATION)), {}, SPECTATOR_VIEW), X).cast.dust, true);
});

test('no cell of the trap in anything the other seat or a spectator is given', () => {
  // The same game with the trap on every cell of a coarse grid: the views of
  // the other seat and of a spectator are identical, so no cell can be in them.
  const reference = {};
  for (const viewer of [O, SPECTATOR_VIEW]) reference[viewer] = JSON.stringify(hudViewModel(usedState(TORNADO), {}, viewer));
  for (let y = 1; y < BOARD_SIZE; y += 5) {
    for (let x = 1; x < BOARD_SIZE; x += 5) {
      if (x === 3 || x === 4 || x === 5) continue; // not on the stones
      const state = use(gameFor(TORNADO.sides), X, TORNADO_ZONE, { x, y });
      for (const viewer of [O, SPECTATOR_VIEW]) {
        assert.equal(JSON.stringify(hudViewModel(state, {}, viewer)), reference[viewer], `trap at ${x},${y} for ${viewer}`);
      }
      const banner = announcements(null, state, null, { local: false, you: O }).banner;
      assert.equal(banner.name, 'Wind Rabbit placed a trap!');
      assert.doesNotMatch(banner.name, /\d/, 'no number in the banner');
    }
  }
  assert.doesNotMatch(trapNotice(usedState(TORNADO)).text, /\d/);
});

test('the trap notice is only for a Tornado Zone, and the other seat gets nothing for other skills', () => {
  for (const c of CASES.filter((entry) => entry.skill !== TORNADO_ZONE)) {
    const state = usedState(c);
    assert.equal(trapNotice(state), null, c.skill);
    assert.equal(castNotice(state, { local: false, you: O }), null, c.skill);
    assert.equal(castNotice(state, { watching: true }), null, c.skill);
    assert.equal(hudViewModel(state, {}, O).notice, null, c.skill);
    assert.notEqual(hudViewModel(state, {}, O).turn.hint, STRINGS.trapPlaced);
  }
  assert.equal(trapNotice(gameFor([WIND_RABBIT, EARTH_BEAR])), null);
});

test('the notice is gone when the turn passes', () => {
  const state = place(usedState(TORNADO), X, 0, 0);
  assert.equal(hudViewModel(state, {}, O).notice, null);
  assert.equal(hudViewModel(state, {}, SPECTATOR_VIEW).notice, null);
});

// --- The freeaction shot scene ---

test('the freeaction scene: Mud Trap used, the same player still to plant, no skill selected', () => {
  assert.equal(SHOT_FREE_ACTION_SCENE, 'freeaction');
  assert.equal(parseShotParams('?shot=freeaction&quality=low').scene, 'freeaction');
  const game = createLocalGame({ random: () => 0 });
  const staged = setUpShotScene(game, SHOT_FREE_ACTION_SCENE);
  const state = game.getState();
  assert.equal(state.skillUsed, MUD_TRAP);
  assert.equal(state.currentPlayer, O);
  assert.equal(game.getTargeting(), null);
  assert.ok(staged.last && staged.last.player === X, 'the last plant is shown');
  const vm = hudViewModel(state, {}, null);
  assert.equal(vm.turn.hint, STRINGS.plantToEndTurn);
  assert.equal(card(vm, O).cast.skill, MUD_TRAP);
  const used = card(vm, O).skills.find((s) => s.id === MUD_TRAP);
  assert.equal(used.look, COOLING);
  assert.ok(card(vm, O).skills.filter((s) => s.id !== MUD_TRAP).every((s) => s.disabled));
});
