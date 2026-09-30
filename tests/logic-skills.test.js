import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOLDOWN_SHORT, COOLDOWN_LONG } from '../src/config.js';
import { X, O } from '../src/logic/board.js';
import { CHARACTERS, EARTH_BEAR, WIND_RABBIT, characterForStone } from '../src/logic/characters.js';
import {
  LONG,
  SHORT,
  SKILLS,
  STONE_CONVERSION,
  TERRAIN_CREATION,
  TORNADO_ZONE,
  WIND_DASH,
  cooldownTurns,
  getSkill,
} from '../src/logic/skills.js';
import { canUseSkill, createInitialState, placeStone, skillCooldown, useSkill } from '../src/logic/game.js';

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

test('Wind Rabbit plays X and Earth Bear plays O', () => {
  assert.equal(CHARACTERS[WIND_RABBIT].stone, X);
  assert.equal(CHARACTERS[EARTH_BEAR].stone, O);
  assert.equal(CHARACTERS[WIND_RABBIT].name, 'Wind Rabbit');
  assert.equal(CHARACTERS[EARTH_BEAR].name, 'Earth Bear');
  assert.equal(characterForStone(X).id, WIND_RABBIT);
  assert.equal(characterForStone(O).id, EARTH_BEAR);
  assert.equal(characterForStone('ROCK'), null);
});

test('each character owns its two skills', () => {
  assert.deepEqual(CHARACTERS[WIND_RABBIT].skills, [WIND_DASH, TORNADO_ZONE]);
  assert.deepEqual(CHARACTERS[EARTH_BEAR].skills, [TERRAIN_CREATION, STONE_CONVERSION]);
  for (const character of Object.values(CHARACTERS)) {
    for (const skillId of character.skills) assert.equal(SKILLS[skillId].character, character.id);
  }
});

test('the four skills have the design cooldown classes', () => {
  assert.equal(Object.keys(SKILLS).length, 4);
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

test('the turn counter goes up by one for every turn of either player', () => {
  let state = createInitialState();
  state = place(state, X, 0, 0);
  assert.equal(state.turn, 2);
  state = skill(state, O, TERRAIN_CREATION, { x: 5, y: 5 });
  assert.equal(state.turn, 3);
  state = skill(state, X, WIND_DASH);
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

test('using a skill uses the whole turn', () => {
  const state = createInitialState();
  const result = useSkill(state, { player: X, skill: WIND_DASH, target: { from: { x: 1, y: 1 }, to: { x: 2, y: 2 } } });
  assert.equal(result.ok, true);
  assert.equal(result.state.currentPlayer, O);
  assert.deepEqual(result.state.board, state.board, 'no effect yet, no stone placed');
  assert.deepEqual(result.events, [
    { type: 'skillUsed', player: X, skill: WIND_DASH, target: { from: { x: 1, y: 1 }, to: { x: 2, y: 2 } } },
    { type: 'turnEnded', player: X, turn: 1 },
  ]);
  // The same player cannot then also place a stone.
  assert.equal(placeStone(result.state, { player: X, x: 7, y: 7 }).ok, false);
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
  let state = skill(createInitialState(), X, WIND_DASH);
  state = place(state, O, 0, 0);
  assertSkillRejected(state, { player: X, skill: WIND_DASH }, /Wind Dash is on cooldown for 3 more turns/);
});

// --- Cooldown counting ---

// Plays the given skill for `player`, then lets both players place stones
// and records, at the start of each of the owner's following turns,
// whether the skill can be used and how many turns are left.
function cooldownTimeline(player, skillId, ownTurns) {
  const next = filler();
  let state = createInitialState();
  let xStone = null;
  if (player === O) {
    xStone = next();
    state = place(state, X, xStone.x, xStone.y);
  }
  // Stone Conversion needs an X stone; the other skills get a free cell.
  state = skill(state, player, skillId, skillId === STONE_CONVERSION ? xStone : { x: 7, y: 0 });
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
  let state = skill(createInitialState(), X, WIND_DASH);
  assert.equal(skillCooldown(state, X, WIND_DASH), 3);
  // The opponent's turns (placing or using skills) do not count down X.
  state = place(state, O, 0, 0);
  assert.equal(skillCooldown(state, X, WIND_DASH), 3);
  state = place(state, X, 2, 0);
  assert.equal(skillCooldown(state, X, WIND_DASH), 2);
  state = skill(state, O, TERRAIN_CREATION, { x: 6, y: 6 });
  assert.equal(skillCooldown(state, X, WIND_DASH), 2);
  assert.equal(skillCooldown(state, O, TERRAIN_CREATION), 3);
  state = place(state, X, 4, 0);
  assert.equal(skillCooldown(state, X, WIND_DASH), 1);
  assert.equal(skillCooldown(state, O, TERRAIN_CREATION), 3);
});

test('cooldowns of the two skills of one player are tracked separately', () => {
  let state = skill(createInitialState(), X, WIND_DASH);
  state = place(state, O, 0, 0);
  // Wind Dash is locked but Tornado Zone is still ready.
  assert.equal(canUseSkill(state, X, WIND_DASH), false);
  assert.equal(canUseSkill(state, X, TORNADO_ZONE), true);
  state = skill(state, X, TORNADO_ZONE);
  assert.equal(skillCooldown(state, X, WIND_DASH), 2);
  assert.equal(skillCooldown(state, X, TORNADO_ZONE), 6);
});

test('a skill can be used again as soon as its cooldown is over', () => {
  let state = skill(createInitialState(), X, WIND_DASH);
  const next = filler();
  for (let i = 0; i < COOLDOWN_SHORT; i++) {
    let move = next();
    state = place(state, O, move.x, move.y);
    move = next();
    state = place(state, X, move.x, move.y);
  }
  state = place(state, O, 7, 7);
  state = skill(state, X, WIND_DASH);
  assert.equal(skillCooldown(state, X, WIND_DASH), COOLDOWN_SHORT);
});

test('canUseSkill is false when it is not the player\'s turn', () => {
  const state = createInitialState();
  assert.equal(canUseSkill(state, O, TERRAIN_CREATION), false);
  assert.equal(canUseSkill(state, X, TERRAIN_CREATION), false);
});
