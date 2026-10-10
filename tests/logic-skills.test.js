import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOLDOWN_SHORT, COOLDOWN_LONG } from '../src/config.js';
import { X, O } from '../src/logic/board.js';
import { CHARACTERS, DEFAULT_SIDES, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT, characterForStone } from '../src/logic/characters.js';
import {
  LONG,
  SHORT,
  HISS,
  SKILLS,
  STONE_CONVERSION,
  TERRAIN_CREATION,
  TORNADO_ZONE,
  VENOM,
  WIND_DASH,
  cooldownTurns,
  getSkill,
} from '../src/logic/skills.js';
import { canUseSkill, createInitialState, placeStone, skillCooldown, useSkill } from '../src/logic/game.js';
import { skillTurn } from './skill-turn.js';

function place(state, player, x, y) {
  const result = placeStone(state, { player, x, y });
  assert.equal(result.ok, true, result.error);
  return result.state;
}

function skill(state, player, skillId, target = null) {
  const result = useSkill(state, { player, skill: skillId, target });
  assert.equal(result.ok, true, result.error);
  return result.state;
}

function assertSkillRejected(state, action, errorPattern) {
  const before = JSON.stringify(state);
  const result = useSkill(state, action);
  assert.equal(result.ok, false);
  assert.match(result.error, errorPattern);
  assert.deepEqual(result.events, []);
  assert.equal(JSON.stringify(state), before, 'state must not change');
}

// A Wind Dash from an X stone at (14, 0) to (14, 2). startWithDashSource()
// is a fresh game with that X stone set directly on the board.
const DASH = { from: { x: 14, y: 0 }, to: { x: 14, y: 2 } };

function startWithDashSource() {
  const state = createInitialState();
  state.board[0][14] = X;
  return state;
}

// Fills free cells row by row from the bottom so filler moves never line up
// with each other or with the test's own stones near the top.
function filler() {
  let i = 0;
  return () => {
    const x = (i * 2) % 15;
    const y = 14 - Math.floor((i * 2) / 15) * 2;
    i++;
    return { x, y };
  };
}

// --- Characters and registry ---

test('without a pick order (DEFAULT_SIDES) Wind Rabbit plays X and Earth Bear plays O', () => {
  assert.deepEqual(DEFAULT_SIDES, { [X]: WIND_RABBIT, [O]: EARTH_BEAR });
  for (const character of Object.values(CHARACTERS)) assert.equal('stone' in character, false, 'no fixed stone');
  assert.equal(CHARACTERS[WIND_RABBIT].name, 'Wind Rabbit');
  assert.equal(CHARACTERS[EARTH_BEAR].name, 'Earth Bear');
  assert.equal(CHARACTERS[JADE_SERPENT].name, 'Jade Serpent');
  assert.equal(characterForStone(X).id, WIND_RABBIT);
  assert.equal(characterForStone(O).id, EARTH_BEAR);
  assert.equal(characterForStone('ROCK'), null);
});

test('each character owns its two skills', () => {
  assert.deepEqual(CHARACTERS[WIND_RABBIT].skills, [WIND_DASH, TORNADO_ZONE]);
  assert.deepEqual(CHARACTERS[EARTH_BEAR].skills, [TERRAIN_CREATION, STONE_CONVERSION]);
  assert.deepEqual(CHARACTERS[JADE_SERPENT].skills, [HISS, VENOM]);
  for (const character of Object.values(CHARACTERS)) {
    for (const skillId of character.skills) assert.equal(SKILLS[skillId].character, character.id);
  }
});

test('the eight skills have the design cooldown classes', () => {
  assert.equal(Object.keys(SKILLS).length, 8);
  assert.equal(getSkill(WIND_DASH).cooldownClass, SHORT);
  assert.equal(getSkill(TORNADO_ZONE).cooldownClass, LONG);
  assert.equal(getSkill(TERRAIN_CREATION).cooldownClass, SHORT);
  assert.equal(getSkill(STONE_CONVERSION).cooldownClass, LONG);
  assert.equal(cooldownTurns(WIND_DASH), COOLDOWN_SHORT);
  assert.equal(cooldownTurns(TERRAIN_CREATION), COOLDOWN_SHORT);
  assert.equal(cooldownTurns(TORNADO_ZONE), COOLDOWN_LONG);
  assert.equal(cooldownTurns(STONE_CONVERSION), COOLDOWN_LONG);
  assert.equal(getSkill('toString'), null);
  assert.equal(getSkill('nope'), null);
});

// --- Initial state ---

test('initial state starts at turn 1 with every skill ready', () => {
  const state = createInitialState();
  assert.equal(state.turn, 1);
  assert.deepEqual(state.cooldowns, {
    X: { [WIND_DASH]: 0, [TORNADO_ZONE]: 0 },
    O: { [TERRAIN_CREATION]: 0, [STONE_CONVERSION]: 0 },
  });
  assert.equal(canUseSkill(state, X, WIND_DASH), true);
  assert.equal(canUseSkill(state, X, TORNADO_ZONE), true);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

// --- Turn counter and events ---

test('the turn counter goes up by one for every planting of either player, never for a skill', () => {
  let state = startWithDashSource();
  state = place(state, X, 0, 0);
  assert.equal(state.turn, 2);
  state = skill(state, O, TERRAIN_CREATION, { x: 5, y: 5 });
  assert.equal(state.turn, 2, 'a skill does not end the turn (Free Action)');
  state = place(state, O, 1, 0);
  assert.equal(state.turn, 3);
  state = skill(state, X, WIND_DASH, DASH);
  assert.equal(state.turn, 3);
  state = place(state, X, 2, 0);
  assert.equal(state.turn, 4);
});

test('placeStone returns stonePlaced and turnEnded events', () => {
  const result = placeStone(createInitialState(), { player: X, x: 3, y: 4 });
  assert.deepEqual(result.events, [
    { type: 'stonePlaced', player: X, x: 3, y: 4 },
    { type: 'turnEnded', player: X, turn: 1 },
  ]);
});

test('a winning placement returns a win event and does not end the turn', () => {
  let state = createInitialState();
  for (let x = 0; x < 4; x++) state.board[0][x] = X;
  const result = placeStone(state, { player: X, x: 4, y: 0 });
  assert.deepEqual(result.events.map((e) => e.type), ['stonePlaced', 'win']);
  assert.equal(result.events[1].player, X);
  assert.equal(result.events[1].line.length, 5);
  assert.equal(result.state.turn, 1);
});

test('rejected actions return an empty events list', () => {
  const result = placeStone(createInitialState(), { player: O, x: 0, y: 0 });
  assert.equal(result.ok, false);
  assert.deepEqual(result.events, []);
});

// --- Using a skill uses the whole turn ---

test('using a skill does not end the turn: the same player still has to plant a seed', () => {
  const state = startWithDashSource();
  const result = useSkill(state, { player: X, skill: WIND_DASH, target: DASH });
  assert.equal(result.ok, true);
  assert.equal(result.state.currentPlayer, X);
  assert.equal(result.state.turn, state.turn);
  assert.deepEqual(result.state.board, state.board, 'the dash is only announced, no stone placed');
  assert.deepEqual(result.events, [
    { type: 'skillUsed', player: X, skill: WIND_DASH, target: DASH },
    { type: 'dashAnnounced', player: X, from: DASH.from, to: DASH.to },
  ]);
  // The other player cannot act yet; the same player plants to end the turn.
  assert.equal(placeStone(result.state, { player: O, x: 7, y: 7 }).ok, false);
  const planted = placeStone(result.state, { player: X, x: 7, y: 7 });
  assert.equal(planted.ok, true);
  assert.equal(planted.state.currentPlayer, O);
});

test('useSkill does not mutate the given state', () => {
  const state = createInitialState();
  const before = JSON.stringify(state);
  skill(state, X, TORNADO_ZONE, { x: 7, y: 7 });
  assert.equal(JSON.stringify(state), before);
});

// --- useSkill validation ---

test('useSkill rejects the wrong player', () => {
  assertSkillRejected(createInitialState(), { player: O, skill: TERRAIN_CREATION }, /not your turn/);
});

test('useSkill rejects a skill of the other character', () => {
  const state = createInitialState();
  assertSkillRejected(state, { player: X, skill: TERRAIN_CREATION }, /not your skill/);
  assertSkillRejected(state, { player: X, skill: STONE_CONVERSION }, /not your skill/);
  const oTurn = place(state, X, 0, 0);
  assertSkillRejected(oTurn, { player: O, skill: WIND_DASH }, /not your skill/);
});

test('useSkill rejects an unknown skill', () => {
  const state = createInitialState();
  assertSkillRejected(state, { player: X, skill: 'fireball' }, /Unknown skill/);
  assertSkillRejected(state, { player: X, skill: 'constructor' }, /Unknown skill/);
  assertSkillRejected(state, { player: X }, /Unknown skill/);
});

test('useSkill rejects any skill after the game is over', () => {
  const won = { ...createInitialState(), winner: O };
  assertSkillRejected(won, { player: X, skill: WIND_DASH }, /game is over/);
  const drawn = { ...createInitialState(), draw: true };
  assertSkillRejected(drawn, { player: X, skill: WIND_DASH }, /game is over/);
  assert.equal(canUseSkill(won, X, WIND_DASH), false);
});

test('useSkill rejects a skill on cooldown', () => {
  let state = skillTurn(startWithDashSource(), X, WIND_DASH, DASH);
  state = place(state, O, 0, 0);
  const again = { from: DASH.to, to: { x: 14, y: 4 } };
  assertSkillRejected(state, { player: X, skill: WIND_DASH, target: again }, /Wind Dash is on cooldown for 3 more turns/);
});

// --- Cooldown counting ---

// Plays the given skill for `player`, then lets both players place stones
// and records, at the start of each of the owner's following turns,
// whether the skill can be used and how many turns are left.
function cooldownTimeline(player, skillId, ownTurns) {
  const next = filler();
  let state = startWithDashSource();
  let xStone = null;
  if (player === O) {
    xStone = next();
    state = place(state, X, xStone.x, xStone.y);
  }
  // Stone Conversion needs an X stone, Wind Dash an X stone and a free
  // cell; the other skills get a free cell.
  const targets = { [STONE_CONVERSION]: xStone, [WIND_DASH]: DASH };
  state = skillTurn(state, player, skillId, targets[skillId] ?? { x: 7, y: 0 });
  const timeline = [];
  for (let i = 0; i < ownTurns; i++) {
    const opponentMove = next();
    state = place(state, state.currentPlayer, opponentMove.x, opponentMove.y);
    assert.equal(state.currentPlayer, player);
    timeline.push({ left: skillCooldown(state, player, skillId), usable: canUseSkill(state, player, skillId) });
    const ownMove = next();
    state = place(state, player, ownMove.x, ownMove.y);
  }
  return timeline;
}

test('short cooldown: cannot use it during your next 3 turns, usable on the 4th', () => {
  for (const [player, skillId] of [[X, WIND_DASH], [O, TERRAIN_CREATION]]) {
    const timeline = cooldownTimeline(player, skillId, 5);
    assert.deepEqual(timeline, [
      { left: 3, usable: false },
      { left: 2, usable: false },
      { left: 1, usable: false },
      { left: 0, usable: true },
      { left: 0, usable: true },
    ]);
  }
});

test('long cooldown: cannot use it during your next 6 turns, usable on the 7th', () => {
  for (const [player, skillId] of [[X, TORNADO_ZONE], [O, STONE_CONVERSION]]) {
    const timeline = cooldownTimeline(player, skillId, 8);
    assert.deepEqual(
      timeline.map((t) => t.usable),
      [false, false, false, false, false, false, true, true],
    );
    assert.deepEqual(
      timeline.map((t) => t.left),
      [6, 5, 4, 3, 2, 1, 0, 0],
    );
  }
});

test('cooldowns count only the owner\'s turns', () => {
  let state = skillTurn(startWithDashSource(), X, WIND_DASH, DASH);
  assert.equal(skillCooldown(state, X, WIND_DASH), 3, 'the planting of the skill turn does not count it down');
  // The opponent's turns (placing or using skills) do not count down X.
  state = place(state, O, 0, 0);
  assert.equal(skillCooldown(state, X, WIND_DASH), 3);
  state = place(state, X, 2, 0);
  assert.equal(skillCooldown(state, X, WIND_DASH), 2);
  state = skillTurn(state, O, TERRAIN_CREATION, { x: 6, y: 6 });
  assert.equal(skillCooldown(state, X, WIND_DASH), 2);
  assert.equal(skillCooldown(state, O, TERRAIN_CREATION), 3);
  state = place(state, X, 4, 0);
  assert.equal(skillCooldown(state, X, WIND_DASH), 1);
  assert.equal(skillCooldown(state, O, TERRAIN_CREATION), 3);
});

test('cooldowns of the two skills of one player are tracked separately', () => {
  let state = skillTurn(startWithDashSource(), X, WIND_DASH, DASH);
  state = place(state, O, 0, 0);
  // Wind Dash is locked but Tornado Zone is still ready.
  assert.equal(canUseSkill(state, X, WIND_DASH), false);
  assert.equal(canUseSkill(state, X, TORNADO_ZONE), true);
  state = skill(state, X, TORNADO_ZONE, { x: 7, y: 7 });
  assert.equal(skillCooldown(state, X, WIND_DASH), 3, 'Wind Dash was not counted down yet');
  assert.equal(skillCooldown(state, X, TORNADO_ZONE), 6);
  state = place(state, X, 9, 9);
  assert.equal(skillCooldown(state, X, WIND_DASH), 2, 'the planting counts down the other skills, not the one used');
  assert.equal(skillCooldown(state, X, TORNADO_ZONE), 6);
});

test('a skill can be used again as soon as its cooldown is over', () => {
  let state = skillTurn(startWithDashSource(), X, WIND_DASH, DASH);
  const next = filler();
  for (let i = 0; i < COOLDOWN_SHORT; i++) {
    let move = next();
    state = place(state, O, move.x, move.y);
    move = next();
    state = place(state, X, move.x, move.y);
  }
  state = place(state, O, 7, 7);
  // The first dash moved the stone to DASH.to; dash it again from there.
  state = skill(state, X, WIND_DASH, { from: DASH.to, to: { x: 14, y: 4 } });
  assert.equal(skillCooldown(state, X, WIND_DASH), COOLDOWN_SHORT);
});

test('canUseSkill is false when it is not the player\'s turn', () => {
  const state = createInitialState();
  assert.equal(canUseSkill(state, O, TERRAIN_CREATION), false);
  assert.equal(canUseSkill(state, X, TERRAIN_CREATION), false);
});
