// Free Action, part 1 (docs/free-action-design.md sections 1 and 11): a skill
// does not end the turn. On your turn you may use at most one skill and then
// you MUST plant a seed, which is the only action that ends a turn. The
// rules (src/logic/game.js), the room over the fake transport, the HUD view
// model, the local game flow and the banner are all checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_TURNS, COOLDOWN_LONG, COOLDOWN_SHORT } from '../src/config.js';
import { EMPTY, O, ROCK, X } from '../src/logic/board.js';
import { CLOUD_EAGLE, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT, assignSides } from '../src/logic/characters.js';
import { cloudsOf } from '../src/logic/cloud.js';
import {
  SKILL_ALREADY_USED_ERROR, canUseSkill, createInitialState, newGame, placeStone, skillCooldown, useSkill,
} from '../src/logic/game.js';
import {
  CLOUD, HISS, SKY_WATCH, PETRIFICATION, MUD_TRAP, TORNADO_ZONE, VENOM, WIND_DASH, cooldownTurns,
} from '../src/logic/skills.js';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { createGuestRoom, createHostRoom } from '../src/net/room.js';
import { announcements } from '../src/ui/announce.js';
import {
  READY, COOLING, OFF, SPECTATOR_VIEW, STATE_COOLING, STATE_READY, STATE_WAITING, hudViewModel,
} from '../src/ui/hud-view.js';
import { createLocalGame, statusText } from '../src/ui/local-game.js';
import { statusLine } from '../src/ui/online-game.js';
import { STRINGS } from '../src/ui/strings.js';
import { pickAndReady } from './room-start.js';
import { skillTurn } from './skill-turn.js';

const EXACT_ERROR = 'You already used a skill this turn.';

function ok(result) {
  assert.equal(result.ok, true, result.error);
  return result;
}

const place = (state, player, x, y) => ok(placeStone(state, { player, x, y })).state;
const use = (state, player, skill, target = null) => ok(useSkill(state, { player, skill, target }));

// A fresh game with X stones at (3, 3) and (4, 4) and an O stone at (5, 5),
// X to move, set directly on the board.
function gameFor(sides) {
  const state = newGame({ characters: assignSides(sides) });
  state.board[3][3] = X;
  state.board[4][4] = X;
  state.board[5][5] = O;
  return state;
}

// Every skill that can be used, with the sides that give it to X and a target.
const CASES = [
  { skill: WIND_DASH, sides: [WIND_RABBIT, EARTH_BEAR], target: { from: { x: 3, y: 3 }, to: { x: 6, y: 3 } } },
  { skill: TORNADO_ZONE, sides: [WIND_RABBIT, EARTH_BEAR], target: { x: 9, y: 9 } },
  { skill: MUD_TRAP, sides: [EARTH_BEAR, WIND_RABBIT], target: { x: 8, y: 8 } },
  { skill: PETRIFICATION, sides: [EARTH_BEAR, WIND_RABBIT], target: { x: 5, y: 5 } },
  { skill: HISS, sides: [JADE_SERPENT, WIND_RABBIT], target: null },
  { skill: VENOM, sides: [JADE_SERPENT, WIND_RABBIT], target: { x: 5, y: 5 } },
  { skill: CLOUD, sides: [CLOUD_EAGLE, WIND_RABBIT], target: { x: 9, y: 9 } },
];

// --- The state ---

test('createInitialState and newGame start with no skill used', () => {
  assert.equal(createInitialState().skillUsed, null);
  assert.equal(newGame().skillUsed, null);
  assert.deepEqual(JSON.parse(JSON.stringify(newGame())), newGame(), 'the state stays plain data');
});

test('a rematch starts with skillUsed null, also from the middle of a turn', () => {
  const midTurn = use(gameFor([WIND_RABBIT, EARTH_BEAR]), X, TORNADO_ZONE, { x: 9, y: 9 }).state;
  assert.equal(midTurn.skillUsed, TORNADO_ZONE);
  const rematch = newGame({ characters: midTurn.characters });
  assert.equal(rematch.skillUsed, null);
  assert.deepEqual(rematch, newGame({ characters: midTurn.characters }));

  const game = createLocalGame();
  game.click({ x: 7, y: 7 });
  game.click({ x: 8, y: 8 });
  assert.equal(game.clickSkill(X, TORNADO_ZONE), true);
  assert.equal(game.click({ x: 3, y: 3 }), true);
  assert.equal(game.getState().skillUsed, TORNADO_ZONE);
  game.rematchLocal();
  assert.equal(game.getState().skillUsed, null);
});

// --- A skill does not end the turn ---

for (const { skill, sides, target } of CASES) {
  test(`${skill}: the same player is still to move, state.turn is unchanged, no turnEnded and skillUsed names it`, () => {
    const state = gameFor(sides);
    const result = use(state, X, skill, target);
    assert.equal(result.state.currentPlayer, X);
    assert.equal(result.state.turn, state.turn);
    assert.equal(result.state.skillUsed, skill);
    assert.equal(result.events.some((e) => e.type === 'turnEnded'), false);
    assert.equal(result.events[0].type, 'skillUsed');
    assert.equal(skillCooldown(result.state, X, skill), cooldownTurns(skill), 'the full cooldown starts at once');
    assert.equal(state.skillUsed, null, 'the given state is not mutated');
    assert.equal(state.turn, 1);
  });
}

test('a skill alone never wins and never ends the game, but it plants nothing', () => {
  for (const { skill, sides, target } of CASES) {
    const state = gameFor(sides);
    const stones = state.board.flat().filter((cell) => cell === X || cell === O).length;
    const after = use(state, X, skill, target).state;
    assert.equal(after.winner, null, skill);
    assert.equal(after.draw, false, skill);
    const now = after.board.flat().filter((cell) => cell === X || cell === O).length;
    assert.ok(now <= stones, `${skill} plants no seed`);
  }
});

test('a skill never wins on its own: petrifying the X between four O leaves a rock, not a fifth O', () => {
  // O O X O O: Petrification turns the X into a rock, which breaks the line.
  const state = newGame();
  state.currentPlayer = O;
  for (const x of [2, 3, 5, 6]) state.board[5][x] = O;
  state.board[5][4] = X;
  const result = use(state, O, PETRIFICATION, { x: 4, y: 5 });
  assert.equal(result.state.winner, null);
  assert.equal(result.state.board[5][4], ROCK);
  assert.deepEqual(result.events.map((e) => e.type), ['skillUsed', 'stonePetrified']);
  assert.equal(result.state.skillUsed, PETRIFICATION, 'the turn goes on until O plants');
});

test('a skill never fills the last empty plot: the player to move can always plant', () => {
  const state = newGame();
  state.currentPlayer = O;
  for (let y = 0; y < state.board.length; y++) {
    for (let x = 0; x < state.board[y].length; x++) state.board[y][x] = (x + 2 * y) % 5 < 2 ? X : ROCK;
  }
  state.board[7][7] = EMPTY;
  const result = use(state, O, MUD_TRAP, { x: 7, y: 7 });
  assert.equal(result.state.draw, false, 'a puddle leaves the plot empty');
  assert.equal(result.state.skillUsed, MUD_TRAP);
  assert.deepEqual(result.events.map((e) => e.type), ['skillUsed', 'mudPlaced']);
  const planted = placeStone(result.state, { player: O, x: 7, y: 7 });
  assert.equal(planted.ok, true);
  assert.deepEqual(planted.events.map((e) => e.type), ['stonePlaced', 'stoneSunk', 'stoneSurfaced', 'draw']);
  assert.equal(planted.state.draw, true, 'the draw waits for the sunk seed, then it is decided');
});

// --- At most one skill ---

test('a second skill in the same turn is refused with the exact error and changes nothing', () => {
  assert.equal(SKILL_ALREADY_USED_ERROR, EXACT_ERROR);
  assert.equal(STRINGS.skillAlreadyUsedError, EXACT_ERROR);
  const first = use(gameFor([WIND_RABBIT, EARTH_BEAR]), X, WIND_DASH, CASES[0].target).state;
  const before = JSON.stringify(first);
  const second = useSkill(first, { player: X, skill: TORNADO_ZONE, target: { x: 9, y: 9 } });
  assert.equal(second.ok, false);
  assert.equal(second.error, EXACT_ERROR);
  assert.deepEqual(second.events, []);
  assert.equal(JSON.stringify(first), before);
  assert.equal(canUseSkill(first, X, TORNADO_ZONE), false);
});

test('the one skill rule is checked after the other checks', () => {
  const used = use(gameFor([JADE_SERPENT, WIND_RABBIT]), X, HISS).state;
  const refused = (state, action) => useSkill(state, action).error;
  assert.equal(refused({ ...used, winner: O }, { player: X, skill: VENOM, target: { x: 5, y: 5 } }), 'The game is over.');
  assert.equal(refused(used, { player: O, skill: WIND_DASH }), 'It is not your turn.');
  assert.equal(refused(used, { player: X, skill: 'fireball' }), 'Unknown skill.');
  assert.equal(refused(used, { player: X, skill: WIND_DASH }), 'That is not your skill.');
  assert.equal(refused(used, { player: X, skill: HISS }), 'Hiss is on cooldown for 3 more turns.', 'the cooldown comes before the new rule');
  assert.equal(refused({ ...used, skillLock: { player: X, endsAfterTurn: 9 } }, { player: X, skill: VENOM, target: { x: 5, y: 5 } }),
    'Hiss: you cannot use a skill this turn.', 'the Hiss lock comes before the new rule');
  assert.equal(refused(used, { player: X, skill: VENOM, target: { x: 5, y: 5 } }), EXACT_ERROR);

  const eagle = use(gameFor([CLOUD_EAGLE, WIND_RABBIT]), X, CLOUD, { x: 9, y: 9 }).state;
  assert.equal(refused(eagle, { player: X, skill: SKY_WATCH }), 'Sky Watch is always on.', 'a passive skill comes before the new rule');
});

test('a refused skill (bad target) costs nothing: it is not counted as the skill of the turn', () => {
  const state = gameFor([EARTH_BEAR, WIND_RABBIT]);
  const bad = useSkill(state, { player: X, skill: PETRIFICATION, target: { x: 0, y: 0 } });
  assert.equal(bad.ok, false);
  assert.equal(state.skillUsed, null);
  assert.equal(use(state, X, MUD_TRAP, { x: 8, y: 8 }).state.skillUsed, MUD_TRAP);
});

// --- Planting is the only action that ends a turn ---

test('planting is still required to end the turn, and it resets skillUsed', () => {
  const used = use(gameFor([WIND_RABBIT, EARTH_BEAR]), X, TORNADO_ZONE, { x: 9, y: 9 }).state;
  // The opponent cannot act and nothing else ends the turn.
  assert.equal(placeStone(used, { player: O, x: 0, y: 0 }).error, 'It is not your turn.');
  assert.equal(useSkill(used, { player: O, skill: MUD_TRAP, target: { x: 0, y: 0 } }).error, 'It is not your turn.');
  const planted = ok(placeStone(used, { player: X, x: 0, y: 0 }));
  assert.equal(planted.state.currentPlayer, O);
  assert.equal(planted.state.turn, used.turn + 1);
  assert.equal(planted.state.skillUsed, null);
  assert.deepEqual(planted.events.map((e) => e.type), ['stonePlaced', 'turnEnded']);
  // The next player may use a skill of their own, and so may X again two turns later.
  assert.equal(canUseSkill(planted.state, O, MUD_TRAP), true);
});

test('a win by planting after a skill ends the game and leaves no skillUsed', () => {
  const state = newGame();
  for (let x = 0; x < 4; x++) state.board[0][x] = X;
  state.board[14][14] = X;
  const used = use(state, X, TORNADO_ZONE, { x: 9, y: 9 }).state;
  const won = ok(placeStone(used, { player: X, x: 4, y: 0 }));
  assert.equal(won.state.winner, X);
  assert.equal(won.state.skillUsed, null);
  assert.equal(won.state.tornado, null, 'the zone of the winner is dropped as before');
});

// --- Cooldowns ---

test('the cooldown is full right after the skill, the skill\'s own planting turn does not count it down, the other skills do', () => {
  let state = gameFor([WIND_RABBIT, EARTH_BEAR]);
  state.cooldowns = { ...state.cooldowns, [X]: { [WIND_DASH]: 2, [TORNADO_ZONE]: 0 } }; // Wind Dash was used earlier
  state = use(state, X, TORNADO_ZONE, { x: 9, y: 9 }).state;
  assert.equal(skillCooldown(state, X, TORNADO_ZONE), COOLDOWN_LONG, 'full at once');
  assert.equal(skillCooldown(state, X, WIND_DASH), 2, 'nothing counts before the planting');
  state = place(state, X, 0, 0);
  assert.equal(skillCooldown(state, X, TORNADO_ZONE), COOLDOWN_LONG, 'the planting of the skill\'s own turn does not count it');
  assert.equal(skillCooldown(state, X, WIND_DASH), 1, 'the other skill of the player counts down');
  state = place(state, O, 1, 0);
  state = place(state, X, 2, 0);
  assert.equal(skillCooldown(state, X, TORNADO_ZONE), COOLDOWN_LONG - 1, 'from the next own turn on it counts');
  assert.equal(skillCooldown(state, X, WIND_DASH), 0);
});

test('a skill rests for the owner\'s next COOLDOWN turns after the turn it was used in', () => {
  let state = gameFor([WIND_RABBIT, EARTH_BEAR]);
  state = skillTurn(state, X, WIND_DASH, CASES[0].target, { x: 0, y: 13 });
  const usable = [];
  for (let turn = 0; turn < COOLDOWN_SHORT + 1; turn++) {
    state = place(state, O, turn, 14); // the opponent's turn
    usable.push(canUseSkill(state, X, WIND_DASH));
    if (turn < COOLDOWN_SHORT) state = place(state, X, turn * 2, 11);
  }
  assert.deepEqual(usable, [false, false, false, true]);
});

test('the opponent\'s skills and plantings never count down my cooldowns', () => {
  let state = gameFor([WIND_RABBIT, EARTH_BEAR]);
  state = skillTurn(state, X, TORNADO_ZONE, { x: 9, y: 9 }, { x: 0, y: 13 });
  state = skillTurn(state, O, MUD_TRAP, { x: 12, y: 12 }, { x: 2, y: 13 });
  assert.equal(skillCooldown(state, X, TORNADO_ZONE), COOLDOWN_LONG);
  assert.equal(skillCooldown(state, O, MUD_TRAP), COOLDOWN_SHORT);
});

// --- Hiss, Wind Dash, Cloud, Tornado still count by turns ---

test('Hiss locks the opponent\'s next turn only', () => {
  let state = gameFor([JADE_SERPENT, EARTH_BEAR]);
  state = use(state, X, HISS).state;
  assert.equal(state.skillLock.player, O);
  assert.equal(canUseSkill(state, X, VENOM), false, 'the serpent itself is not locked, just limited to one skill');
  state = place(state, X, 0, 0); // the cast turn ends: the lock stays for the opponent's turn
  assert.deepEqual(state.skillLock, { player: O, endsAfterTurn: 2 });
  assert.equal(canUseSkill(state, O, MUD_TRAP), false);
  assert.match(useSkill(state, { player: O, skill: MUD_TRAP, target: { x: 9, y: 9 } }).error, /Hiss/);
  const answered = ok(placeStone(state, { player: O, x: 1, y: 0 })); // the opponent plants anyway
  assert.ok(answered.events.some((e) => e.type === 'hissEnded' && e.player === O));
  assert.equal(answered.state.skillLock, null);
  state = place(answered.state, X, 2, 0);
  assert.equal(canUseSkill(state, O, MUD_TRAP), true, 'their turn after that is free again');
});

test('a Wind Dash cast then a planting resolves after the opponent\'s next turn', () => {
  let state = gameFor([WIND_RABBIT, EARTH_BEAR]);
  state = use(state, X, WIND_DASH, CASES[0].target).state;
  assert.equal(state.pendingDash.resolvesAfterTurn, 2);
  const castTurn = ok(placeStone(state, { player: X, x: 0, y: 0 }));
  assert.equal(castTurn.events.some((e) => e.type === 'dashResolved'), false, 'the cast turn\'s own planting does not resolve it');
  assert.equal(castTurn.state.board[3][3], X);
  assert.ok(castTurn.state.pendingDash);
  const resolved = ok(placeStone(castTurn.state, { player: O, x: 1, y: 0 }));
  assert.ok(resolved.events.some((e) => e.type === 'dashResolved'));
  assert.equal(resolved.state.board[3][3], EMPTY);
  assert.equal(resolved.state.board[3][6], X);
  assert.equal(resolved.state.pendingDash, null);
});

test('a cloud still lasts the owner\'s next CLOUD_TURNS turns', () => {
  let state = gameFor([CLOUD_EAGLE, WIND_RABBIT]);
  state = use(state, X, CLOUD, { x: 9, y: 9 }).state;
  state = place(state, X, 0, 0); // the cast turn does not count
  assert.equal(cloudsOf(state)[0].turnsLeft, CLOUD_TURNS);
  let ended = null;
  for (let own = 1; own <= CLOUD_TURNS; own++) {
    state = place(state, O, own, 14);
    assert.equal(cloudsOf(state).length, 1, `still up during the opponent's turn ${own}`);
    const result = ok(placeStone(state, { player: X, x: own, y: 0 }));
    state = result.state;
    ended = result.events.find((e) => e.type === 'cloudEnded') ?? ended;
  }
  assert.deepEqual(cloudsOf(state), []);
  assert.deepEqual(ended, { type: 'cloudEnded', player: X, x: 9, y: 9 });
});

test('a Tornado Zone cast then a planting waits through the opponent\'s next turn and the caster\'s next turn', () => {
  let state = gameFor([WIND_RABBIT, EARTH_BEAR]);
  state = use(state, X, TORNADO_ZONE, { x: 9, y: 9 }).state;
  state = place(state, X, 0, 0);
  assert.ok(state.tornado, 'armed for the opponent\'s turn');
  const outside = ok(placeStone(state, { player: O, x: 1, y: 0 }));
  assert.equal(outside.events.some((e) => e.type === 'tornadoEnded'), false, 'still waiting for the caster\'s next turn');
  assert.ok(outside.state.tornado);
  const last = ok(placeStone(outside.state, { player: X, x: 2, y: 0 }));
  assert.ok(last.events.some((e) => e.type === 'tornadoEnded'));
  assert.equal(last.state.tornado, null);
});

// --- The room over the fake transport ---

test('online: the guest uses a skill, the host answers with a state where the guest is still to move, then the guest plants and the turn passes', () => {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const host = createHostRoom({ transport: network.connect(), code: 'AB2C9', clock, id: 'host' });
  const guest = createGuestRoom({ transport: network.connect(), code: 'AB2C9', clock, id: 'guest' });
  const guestEvents = [];
  const hostEvents = [];
  guest.onEvent((e) => guestEvents.push(e));
  host.onEvent((e) => hostEvents.push(e));
  pickAndReady(host, guest); // the host plays Wind Rabbit (X), the guest Earth Bear (O)
  assert.equal(host.place(7, 7).ok, true);
  assert.equal(guest.getView().yourTurn, true);

  assert.equal(guest.useSkill(MUD_TRAP, { x: 9, y: 9 }).ok, true);
  assert.equal(host.state.currentPlayer, O, 'the guest is still to move');
  assert.equal(host.state.turn, 2);
  assert.equal(host.state.skillUsed, MUD_TRAP);
  assert.deepEqual(guest.state, host.state);
  const afterSkill = guestEvents.filter((e) => e.type === 'state').at(-1);
  assert.equal(afterSkill.events[0].type, 'skillUsed');
  assert.equal(afterSkill.events.some((e) => e.type === 'turnEnded'), false);
  assert.equal(guest.getView().yourTurn, true, 'the guest can still act');
  assert.equal(host.getView().yourTurn, false);
  assert.equal(guest.getView().waiting, false, 'the request is settled');
  assert.equal(host.place(0, 0).error, 'It is not your turn.');

  // A second skill is refused by the host with the exact sentence.
  assert.equal(guest.useSkill(PETRIFICATION, { x: 7, y: 7 }).ok, true, 'sent; the host decides');
  assert.equal(guestEvents.filter((e) => e.type === 'rejected').at(-1).error, EXACT_ERROR);
  assert.deepEqual(guest.state, host.state);

  // The guest plants: the turn passes to the host.
  assert.equal(guest.place(0, 14).ok, true);
  assert.equal(host.state.currentPlayer, X);
  assert.equal(host.state.turn, 3);
  assert.equal(host.state.skillUsed, null);
  assert.deepEqual(guest.state, host.state);
  const afterPlant = guestEvents.filter((e) => e.type === 'state').at(-1);
  assert.deepEqual(afterPlant.events.map((e) => e.type), ['stonePlaced', 'turnEnded']);
  assert.equal(guest.getView().yourTurn, false);
  assert.equal(host.getView().yourTurn, true);
});

// --- The HUD ---

function rowsOf(vm, player) {
  return vm.cards.find((card) => card.player === player).skills;
}

test('hud view model after a skill: every skill row of that player is disabled with the hint, the used one shows its cooldown', () => {
  const state = use(gameFor([WIND_RABBIT, EARTH_BEAR]), X, WIND_DASH, CASES[0].target).state;
  for (const localPlayer of [null, X]) {
    const vm = hudViewModel(state, {}, localPlayer);
    const [dash, tornado] = rowsOf(vm, X);
    assert.equal(dash.state, STATE_COOLING);
    assert.equal(dash.look, COOLING);
    assert.equal(dash.cooldownTurns, COOLDOWN_SHORT, 'the cooldown shows at once');
    assert.equal(dash.stateText, `Ready in ${COOLDOWN_SHORT} turns`);
    assert.equal(tornado.state, STATE_WAITING);
    assert.equal(tornado.look, OFF);
    assert.equal(tornado.stateText, STRINGS.skillUsedState);
    for (const row of [dash, tornado]) {
      assert.equal(row.disabled, true, row.id);
      assert.equal(row.hint, STRINGS.skillUsedHint);
    }
    assert.equal(STRINGS.skillUsedHint, 'Already used a skill this turn.');
    assert.equal(vm.turn.hint, STRINGS.plantToEndTurn);
    assert.equal(STRINGS.plantToEndTurn, 'Now plant a seed to end your turn.');
    assert.equal(vm.turn.player, X, 'the same player is still to move');
    assert.equal(vm.cards.find((c) => c.player === X).active, true);
  }
  // The other seat sees the same rows, none of them its own, and its own hint.
  const other = hudViewModel(state, {}, O);
  assert.ok(rowsOf(other, X).every((row) => row.disabled));
  assert.notEqual(other.turn.hint, STRINGS.plantToEndTurn);
  assert.ok(rowsOf(other, O).every((row) => row.hint !== STRINGS.skillUsedHint), 'the waiting player\'s rows keep their own hints');
  // A spectator sees the rows disabled too.
  const watching = hudViewModel(state, {}, SPECTATOR_VIEW);
  assert.ok(rowsOf(watching, X).every((row) => row.disabled));
});

test('hud view model: before the skill the rows are ready, after the planting the next player\'s rows are ready and the old ones count', () => {
  const start = gameFor([WIND_RABBIT, EARTH_BEAR]);
  const before = hudViewModel(start, {}, null);
  assert.ok(rowsOf(before, X).every((row) => row.look === READY && !row.disabled && row.state === STATE_READY));
  assert.equal(before.turn.hint, 'Plant a seed');

  const afterPlant = skillTurn(start, X, WIND_DASH, CASES[0].target, { x: 0, y: 13 });
  const vm = hudViewModel(afterPlant, {}, null);
  assert.ok(rowsOf(vm, O).every((row) => row.look === READY && !row.disabled), 'the new player to move has ready rows');
  assert.ok(rowsOf(vm, O).every((row) => row.hint !== STRINGS.skillUsedHint));
  assert.equal(vm.turn.hint, 'Plant a seed');
  assert.equal(rowsOf(vm, X)[0].cooldownTurns, COOLDOWN_SHORT);
});

test('hud view model: Sky Watch keeps its own row after a Cloud', () => {
  const state = use(gameFor([CLOUD_EAGLE, WIND_RABBIT]), X, CLOUD, { x: 9, y: 9 }).state;
  const [sky, cloud] = rowsOf(hudViewModel(state, {}, null), X);
  assert.equal(sky.passive, true);
  assert.equal(sky.stateText, STRINGS.skillAlwaysOn);
  assert.notEqual(sky.hint, STRINGS.skillUsedHint);
  assert.equal(cloud.look, COOLING);
  assert.equal(cloud.disabled, true);
});

test('hud view model: a finished round shows no plant hint', () => {
  const used = use(gameFor([WIND_RABBIT, EARTH_BEAR]), X, WIND_DASH, CASES[0].target).state;
  const vm = hudViewModel({ ...used, winner: X }, {}, null);
  assert.notEqual(vm.turn.hint, STRINGS.plantToEndTurn);
  assert.ok(rowsOf(vm, X).every((row) => row.hint !== STRINGS.skillUsedHint));
});

// --- The status lines and the banner ---

test('the status lines say to plant a seed after a skill', () => {
  const used = use(gameFor([WIND_RABBIT, EARTH_BEAR]), X, WIND_DASH, CASES[0].target).state;
  assert.equal(statusText(used), STRINGS.plantToEndTurn);
  assert.equal(statusText(newGame()), 'Wind Rabbit to move');
  assert.equal(statusLine({ state: used, you: X, yourTurn: true }), STRINGS.plantToEndTurn);
  assert.equal(statusLine({ state: used, you: O, yourTurn: false }), "Opponent's turn");
  assert.equal(statusLine({ state: newGame(), you: X, yourTurn: true }), 'Your turn');
  assert.equal(statusLine({ state: used, you: X, yourTurn: true, targeting: { skill: WIND_DASH, from: null } }), 'Wind Dash: choose one of your stones');
});

test('the banner tells the player who used a skill to plant, once, and never a spectator or the other seat', () => {
  const start = gameFor([WIND_RABBIT, EARTH_BEAR]);
  const used = use(start, X, TORNADO_ZONE, { x: 9, y: 9 }).state;
  const first = announcements(null, start, null, { local: true });
  assert.equal(first.next.used, null);

  const local = announcements(first.next, used, null, { local: true });
  assert.equal(local.banner.name, STRINGS.plantToEndTurn);
  assert.equal(local.banner.kicker, null);
  assert.equal(announcements(local.next, used, null, { local: true }).banner, null, 'once per skill');
  const planted = place(used, X, 0, 0);
  assert.equal(announcements(local.next, planted, null, { local: true }).banner.name, 'Earth Bear', 'the turn banner is back when the turn passes');

  const onlineIn = announcements(first.next, used, null, { local: false, you: X });
  assert.equal(onlineIn.banner.name, STRINGS.plantToEndTurn);
  assert.equal(announcements(first.next, used, null, { local: false, you: O }).banner, null);
  assert.equal(announcements(first.next, used, null, { local: false, watching: true }).banner, null);
});

// --- The local game flow ---

test('local game: a skill, then a plant, targeting and Esc work as before', () => {
  const game = createLocalGame({ random: () => 0 });
  game.click({ x: 7, y: 7 }); // X
  game.click({ x: 8, y: 8 }); // O
  game.takeEvents();

  // Esc cancels a target flow before any skill is used.
  assert.equal(game.clickSkill(X, WIND_DASH), true);
  assert.deepEqual(game.getTargeting(), { skill: WIND_DASH, from: null });
  assert.equal(game.cancel(), true);
  assert.equal(game.getTargeting(), null);
  assert.equal(game.getState().skillUsed, null);

  // Tornado Zone: choose the centre; the same player is still to move.
  assert.equal(game.clickSkill(X, TORNADO_ZONE), true);
  assert.equal(game.getView().status, 'Tornado Zone: choose the trap centre');
  assert.equal(game.click({ x: 3, y: 3 }), true);
  const state = game.getState();
  assert.equal(state.currentPlayer, X);
  assert.equal(state.skillUsed, TORNADO_ZONE);
  assert.equal(state.turn, 3);
  assert.equal(game.getTargeting(), null);
  assert.equal(game.getView().status, STRINGS.plantToEndTurn);
  assert.equal(game.takeEvents().some((e) => e.type === 'turnEnded'), false);
  const [left] = game.getView().panels;
  assert.ok(left.active && left.skills.every((skill) => !skill.usable));
  assert.equal(hudViewModel(game.getView().state, { status: game.getView().status }, null).turn.hint, STRINGS.plantToEndTurn);

  // A second skill is refused and starts no target flow.
  assert.equal(game.clickSkill(X, WIND_DASH), false);
  assert.equal(game.getView().message, EXACT_ERROR);
  assert.equal(game.getTargeting(), null);
  // Esc with nothing to cancel does nothing.
  assert.equal(game.cancel(), false);

  // Planting ends the turn.
  assert.equal(game.click({ x: 14, y: 0 }), true);
  assert.equal(game.getState().currentPlayer, O);
  assert.equal(game.getState().skillUsed, null);
  assert.equal(game.getState().turn, 4);
  assert.equal(game.getView().status, 'Earth Bear to move');
  assert.deepEqual(game.takeEvents().map((e) => e.type), ['stonePlaced', 'turnEnded']);
  // And the skill that was used still rests.
  assert.equal(game.clickSkill(X, TORNADO_ZONE), false);
});

test('local game: Hiss needs no target and still ends with a planting', () => {
  const game = createLocalGame({ characters: { [X]: JADE_SERPENT, [O]: EARTH_BEAR } });
  assert.equal(game.clickSkill(X, HISS), true);
  assert.equal(game.getState().currentPlayer, X);
  assert.equal(game.getView().status, STRINGS.plantToEndTurn);
  assert.equal(game.getView().panels[0].skills.every((skill) => !skill.usable), true);
  assert.equal(game.click({ x: 7, y: 7 }), true);
  assert.equal(game.getState().currentPlayer, O);
});

// --- The words ---

test('How to Play says one skill and then a planting, not that a skill uses the turn', () => {
  const rule = STRINGS.howToRule2;
  assert.match(rule, /one skill/);
  assert.match(rule, /plant a seed/);
  assert.doesNotMatch(rule, /whole turn|takes your/);
  for (let n = 1; n <= 6; n++) assert.doesNotMatch(STRINGS[`howToRule${n}`], /uses? (up )?(the|your) (whole )?turn/i);
});
