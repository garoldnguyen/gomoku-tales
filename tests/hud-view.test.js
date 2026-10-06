import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { X, O } from '../src/logic/board.js';
import { createInitialState, placeStone } from '../src/logic/game.js';
import {
  STONE_CONVERSION, TERRAIN_CREATION, TORNADO_ZONE, WIND_DASH, cooldownTurns,
} from '../src/logic/skills.js';
import {
  COOLING, OFF, PLANT_HINT, PORTRAIT_ART, READY, SELECTED, SKILL_ICON_ART, hudViewModel,
} from '../src/ui/hud-view.js';
import { createLocalGame } from '../src/ui/local-game.js';
import { startTargeting } from '../src/ui/targeting.js';

const card = (vm, player) => vm.cards.find((c) => c.player === player);
const skill = (vm, player, id) => card(vm, player).skills.find((s) => s.id === id);

// A few stones: X at (7,7) and (8,8), O at (7,8); X to move.
function midGame() {
  let state = createInitialState();
  for (const [player, x, y] of [[X, 7, 7], [O, 7, 8], [X, 8, 8], [O, 0, 0]]) {
    state = placeStone(state, { player, x, y }).state;
  }
  return state;
}

function withCooldown(state, player, skillId, turns) {
  return { ...state, cooldowns: { ...state.cooldowns, [player]: { ...state.cooldowns[player], [skillId]: turns } } };
}

test('my turn: Your turn on my card, Ready skills, the pill says whose turn and Plant a seed', () => {
  const vm = hudViewModel(midGame(), { quality: 'high' }, X);
  assert.equal(vm.turn.who, "Wind Rabbit's turn");
  assert.equal(vm.turn.hint, PLANT_HINT);
  assert.equal(vm.turn.hint, 'Plant a seed');
  assert.equal(vm.turn.team, 'blue');
  assert.equal(vm.turn.countdown, null);
  const mine = card(vm, X);
  assert.equal(mine.side, 'left');
  assert.equal(mine.name, 'Wind Rabbit');
  assert.equal(mine.meta, 'Plays X, 2 planted');
  assert.equal(mine.chip, 'Your turn');
  assert.equal(mine.waiting, false);
  assert.equal(mine.portrait, 'portrait-wind-rabbit-v5');
  for (const id of [WIND_DASH, TORNADO_ZONE]) {
    const row = skill(vm, X, id);
    assert.equal(row.stateText, 'Ready');
    assert.equal(row.look, READY);
    assert.equal(row.selected, false);
    assert.equal(row.disabled, false);
    assert.equal(row.cooldownTurns, 0);
    assert.equal(row.cooldownProgress, 0);
  }
  assert.equal(skill(vm, X, WIND_DASH).title, 'Wind Dash');
  assert.equal(skill(vm, X, WIND_DASH).icon, 'icon-wind-dash-v5');
  assert.equal(skill(vm, X, WIND_DASH).ariaLabel, 'Wind Dash: Ready');
  const theirs = card(vm, O);
  assert.equal(theirs.side, 'right');
  assert.equal(theirs.meta, 'Plays O, 2 planted');
  assert.equal(theirs.chip, 'Waiting');
  assert.equal(theirs.portrait, 'portrait-earth-bear-v5');
  assert.equal(vm.toast, null);
  assert.deepEqual(vm.qualityChoices.map((c) => [c.label, c.pressed]), [['Low', false], ['Medium', false], ['High', true]]);
  assert.equal(vm.quality, 'high');
});

test('a skill is selected: Selected on its row and the targeting prompt in the pill', () => {
  const targeting = startTargeting(WIND_DASH);
  const vm = hudViewModel(midGame(), { targeting }, X);
  const row = skill(vm, X, WIND_DASH);
  assert.equal(row.stateText, 'Selected');
  assert.equal(row.look, SELECTED);
  assert.equal(row.selected, true);
  assert.equal(card(vm, X).chip, 'Your turn');
  assert.equal(skill(vm, X, TORNADO_ZONE).stateText, 'Ready');
  assert.equal(vm.turn.hint, 'Wind Dash: choose one of your stones');
  const next = hudViewModel(midGame(), { targeting: { skill: WIND_DASH, from: { x: 7, y: 7 } } }, X);
  assert.equal(next.turn.hint, 'Wind Dash: choose an empty target cell');
});

test('a skill cooling down with 1 turn left: singular turn, nearly full ring', () => {
  const state = withCooldown(midGame(), X, WIND_DASH, 1);
  const vm = hudViewModel(state, {}, X);
  const row = skill(vm, X, WIND_DASH);
  assert.equal(row.stateText, 'Ready in 1 turn');
  assert.equal(row.look, COOLING);
  assert.equal(row.cooldownTurns, 1);
  const total = cooldownTurns(WIND_DASH);
  assert.equal(row.cooldownProgress, (total - 1) / total);
  assert.equal(row.disabled, true);
  assert.equal(card(vm, X).chip, 'Your turn');
});

test('a skill cooling down with 3 turns left: plural turns and the served share', () => {
  const state = withCooldown(midGame(), X, TORNADO_ZONE, 3);
  const vm = hudViewModel(state, {}, X);
  const row = skill(vm, X, TORNADO_ZONE);
  assert.equal(row.stateText, 'Ready in 3 turns');
  assert.equal(row.look, COOLING);
  assert.equal(row.cooldownTurns, 3);
  assert.equal(row.cooldownProgress, (cooldownTurns(TORNADO_ZONE) - 3) / cooldownTurns(TORNADO_ZONE));
  // A 3 turn cooldown that just started has served nothing yet.
  const fresh = skill(hudViewModel(withCooldown(midGame(), X, WIND_DASH, 3), {}, X), X, WIND_DASH);
  assert.equal(fresh.stateText, 'Ready in 3 turns');
  assert.equal(fresh.cooldownProgress, 0);
  // The reference picture: 2 of 3 turns left fills a third of the ring.
  const ref = skill(hudViewModel(withCooldown(midGame(), O, TERRAIN_CREATION, 2), {}, X), O, TERRAIN_CREATION);
  assert.equal(Math.round(ref.cooldownProgress * 100), 33);
});

test("opponent's turn: Waiting and dimmed rows that say Wait for your turn", () => {
  const state = placeStone(midGame(), { player: X, x: 3, y: 3 }).state; // O to move
  const vm = hudViewModel(state, { status: "Opponent's turn" }, X);
  const mine = card(vm, X);
  assert.equal(mine.chip, 'Waiting');
  assert.equal(mine.waiting, true);
  for (const row of mine.skills) {
    assert.equal(row.stateText, 'Wait for your turn');
    assert.equal(row.look, OFF);
    assert.equal(row.disabled, true);
  }
  assert.equal(vm.turn.who, "Earth Bear's turn");
  assert.equal(vm.turn.team, 'red');
  assert.equal(vm.turn.hint, "Opponent's turn");
  // Their card speaks to their character, but its rows are not mine to press.
  assert.equal(card(vm, O).chip, 'Your turn');
  assert.equal(skill(vm, O, TERRAIN_CREATION).disabled, true);
  // A cooldown still shows while waiting (the reference card).
  const cooling = hudViewModel(withCooldown(state, X, WIND_DASH, 2), {}, X);
  assert.equal(skill(cooling, X, WIND_DASH).stateText, 'Ready in 2 turns');
});

test('round won: Winner in gold on the winner, Round over on every skill row', () => {
  let state = createInitialState();
  for (let i = 0; i < 4; i++) {
    state = placeStone(state, { player: X, x: i, y: 7 }).state;
    state = placeStone(state, { player: O, x: i, y: 9 }).state;
  }
  state = placeStone(state, { player: X, x: 4, y: 7 }).state;
  assert.equal(state.winner, X);
  const vm = hudViewModel(state, { status: 'Wind Rabbit wins! Press R to restart.' }, null);
  assert.equal(card(vm, X).chip, 'Winner');
  assert.equal(card(vm, X).winner, true);
  assert.equal(card(vm, X).meta, 'Plays X, 5 planted');
  assert.equal(card(vm, O).winner, false);
  for (const c of vm.cards) {
    for (const row of c.skills) {
      assert.equal(row.stateText, 'Round over');
      assert.equal(row.look, OFF);
      assert.equal(row.disabled, true);
    }
  }
  assert.equal(vm.turn.who, 'Round over');
  assert.equal(vm.turn.team, 'gold');
  assert.equal(vm.turn.hint, 'Wind Rabbit wins! Press R to restart.', 'the existing winner message stays');
});

test('round over without a winner (a draw): Round over on both cards', () => {
  const state = { ...midGame(), draw: true };
  const vm = hudViewModel(state, { status: 'Draw!' }, O);
  for (const c of vm.cards) {
    assert.equal(c.chip, 'Round over');
    assert.equal(c.winner, false);
    for (const row of c.skills) assert.equal(row.stateText, 'Round over');
  }
  assert.equal(vm.turn.who, 'Round over');
  assert.equal(vm.turn.hint, 'Draw!');
});

test('opponent left: the pill counts down from 10, then the win', () => {
  const vm = hudViewModel(midGame(), { peerCountdown: 10 }, X);
  assert.equal(vm.turn.who, 'Opponent left');
  assert.equal(vm.turn.hint, 'You win in 10');
  assert.equal(vm.turn.countdown, 10);
  assert.equal(hudViewModel(midGame(), { peerCountdown: 3 }, X).turn.hint, 'You win in 3');
  // The room settles the leave: the win goes to this window's card.
  const after = hudViewModel(midGame(), { winner: X, status: 'Opponent left, you win!', peerCountdown: null }, X);
  assert.equal(card(after, X).chip, 'Winner');
  assert.equal(card(after, O).chip, 'Round over');
  assert.equal(after.turn.countdown, null);
  assert.equal(after.turn.hint, 'Opponent left, you win!');
  for (const row of card(after, X).skills) assert.equal(row.stateText, 'Round over');
});

test('local mode: the player to move is always you, and messages become the toast', () => {
  const game = createLocalGame();
  game.click({ x: 7, y: 7 }); // X plants, O to move
  game.clickSkill(X, WIND_DASH); // not X's turn: the existing message
  const view = game.getView();
  const vm = hudViewModel(view.state, { targeting: game.getTargeting(), status: view.status, message: view.message }, null);
  assert.equal(vm.toast, "It is Earth Bear's turn.");
  assert.equal(card(vm, O).chip, 'Your turn');
  assert.equal(skill(vm, O, STONE_CONVERSION).stateText, 'Ready');
  assert.equal(skill(vm, O, STONE_CONVERSION).disabled, false);
  assert.equal(vm.turn.hint, 'Plant a seed');
  game.clickSkill(O, TERRAIN_CREATION);
  const picked = hudViewModel(game.getView().state, { targeting: game.getTargeting() }, null);
  assert.equal(skill(picked, O, TERRAIN_CREATION).stateText, 'Selected');
  assert.equal(picked.turn.hint, 'Terrain Creation: choose an empty cell');
});

test('the HUD art names are manifest entries', () => {
  const manifest = JSON.parse(readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
  const names = new Set(Object.keys(manifest.assets ?? manifest));
  for (const name of [...Object.values(PORTRAIT_ART), ...Object.values(SKILL_ICON_ART)]) {
    assert.ok(names.has(name), name);
  }
});

test('hud.css: fonts from assets/fonts, glass per quality, focus ring and 44 px targets', () => {
  const cssUrl = new URL('../src/ui/hud.css', import.meta.url);
  const css = readFileSync(cssUrl, 'utf8');
  const fonts = [...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.equal(fonts.length, 5); // Nunito and the four DM Sans weights
  for (const font of fonts) {
    assert.ok(font.includes('assets/fonts/'), font);
    assert.ok(existsSync(new URL(font, cssUrl)), `${font} exists`);
  }
  assert.match(css, /\.hud \{[^}]*--blur: 18px;/);
  assert.match(css, /\.hud\[data-quality="low"\] \.glass \{[^}]*backdrop-filter: none;/);
  assert.match(css, /\.hud\[data-quality="medium"\] \{ --blur: 10px; \}/);
  assert.match(css, /\.hud button:focus-visible \{ outline: 3px solid #fff;/);
  // The slim bars come from .is-compact (src/ui/hud-layout.js), not a media query.
  assert.doesNotMatch(css, /@media \(max-width: 700px\) \{/);
  assert.match(css, /\.hud\.is-compact \.skill \{ width: 48px; height: 48px;/);
  // The narrow quality buttons are raised back to 44 px after the reference's 40 px.
  const raised = css.lastIndexOf('.hud.is-compact .quality button { min-height: 44px; min-width: 44px; }');
  assert.ok(raised > css.indexOf('.hud.is-compact .quality button { padding'));
  // The slim layout keeps the hint: it carries the targeting prompts and the countdown.
  assert.doesNotMatch(css, /\.hint \{ display: none/);
  assert.match(css, /\.hud\.is-compact \.turn \.hint \{ flex-basis: 100%;/);
  // Shrunk cards scale from their outer top corner.
  assert.match(css, /\.hud \.card\.left \{[^}]*transform: scale\(var\(--card-scale, 1\)\); transform-origin: top left;/);
  // Small landscape windows stand the bars upright beside the board (.is-rail).
  assert.match(css, /\.hud\.is-compact\.is-rail \.card \{[^}]*width: var\(--rail-width\);/);
  assert.match(css, /\.hud\.is-compact\.is-rail\.is-stacked \.skills \{ flex-direction: column;/);
  // Very narrow phones put the name over the chip so the bar never overflows.
  assert.match(css, /grid-template-areas: "tile name skills" "tile chip skills";/);
});
