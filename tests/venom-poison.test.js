// Free Action part 4 (docs/free-action-design.md section 5): Jade Serpent's
// Venom no longer removes a plant. The 3 by 3 square around one plant of the
// opponent becomes a poison zone (state.poison) that nobody may plant on,
// for VENOM_TURNS turns after the cast turn. These tests follow the zone
// through the rules (cells at the middle, an edge and a corner, planting,
// lines, timing, the no-room refusal, dash, mud and the Tornado throw), the
// masking, the texts, the targeting, the board marks and the renderers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { BOARD_SIZE, HISS_LOCK_TURNS, POISON_OPACITY, POISON_PREVIEW_OPACITY, VENOM_TURNS, VENOM_ZONE_SIZE } from '../src/config.js';
import { EMPTY, ROCK, O, X } from '../src/logic/board.js';
import { coveredCells, maskEventsForViewer, maskForViewer } from '../src/logic/cloud.js';
import {
  CHARACTERS, CLOUD_EAGLE, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT, assignSides,
} from '../src/logic/characters.js';
import { canUseSkill, newGame, placeStone, skillCooldown, useSkill } from '../src/logic/game.js';
import {
  NO_ROOM_ERROR, POISONED_ERROR, hasPlantableCell, isPoisoned, poisonCells,
} from '../src/logic/jade-serpent-skills.js';
import { CLOUD, HISS, MUD_TRAP, TORNADO_ZONE, VENOM, WIND_DASH } from '../src/logic/skills.js';
import { DASH_ON_POISON_ERROR } from '../src/logic/wind-rabbit-skills.js';
import { boardMarks } from '../src/render3d/board-marks.js';
import { visualsForEvents } from '../src/render3d/effect-plans.js';
import { POISON_COLOURS, POISON_TILE_PX, poisonTileGrid } from '../src/render3d/poison-art.js';
import { hudViewModel } from '../src/ui/hud-view.js';
import { SKILL_INFO } from '../src/ui/skill-info.js';
import { STRINGS, lockedText } from '../src/ui/strings.js';
import { startTargeting, targetClick, targetPreview, targetPrompt } from '../src/ui/targeting.js';
import { createLocalGame } from '../src/ui/local-game.js';
import { skillTurn } from './skill-turn.js';
import { fakeCanvas, fakeRenderer, installFakeDocument } from './fake-browser.js';

// The browser maps "three" with an import map; Node needs the same mapping.
const hook = `
const root = ${JSON.stringify(new URL('../', import.meta.url).href)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: root + 'vendor/three/build/three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: root + 'vendor/three/examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);

function ok(result) {
  assert.equal(result.ok, true, result.error);
  return result.state;
}

function place(state, player, x, y) {
  return ok(placeStone(state, { player, x, y }));
}

const keys = (cells) => cells.map((cell) => `${cell.x},${cell.y}`);
const square = (x0, y0, x1, y1) => {
  const cells = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(`${x},${y}`);
  return cells;
};

// Jade Serpent (X) against `second` (O). Turn 1: X plants far away; turn 2:
// O plants `plant`; turn 3: X is to move with Venom ready (turn number 3).
function serpentToVenom(plant = { x: 8, y: 8 }, second = EARTH_BEAR) {
  let state = newGame({ characters: assignSides([JADE_SERPENT, second]) });
  state = place(state, X, 0, 14);
  state = place(state, O, plant.x, plant.y);
  assert.equal(state.turn, 3);
  return state;
}

// X casts Venom on (x, y) and plants at `cell`: O is to move on turn 4.
function venomTurn(state, target = { x: 8, y: 8 }, cell = { x: 14, y: 0 }, events = null) {
  return skillTurn(state, X, VENOM, target, cell, events);
}

// --- Constants ---

test('the Venom and Hiss constants are the ones of the design', () => {
  assert.equal(HISS_LOCK_TURNS, 1);
  assert.equal(VENOM_ZONE_SIZE, 3);
  assert.equal(VENOM_TURNS, 2);
});

test('Hiss locks the opponent for HISS_LOCK_TURNS turns counted from the cast turn', () => {
  const state = newGame({ characters: assignSides([JADE_SERPENT, EARTH_BEAR]) });
  const used = ok(useSkill(state, { player: X, skill: HISS }));
  assert.deepEqual(used.skillLock, { player: O, endsAfterTurn: state.turn + HISS_LOCK_TURNS });
});

// --- The zone ---

test('zone cells: the full square in the middle, cut at an edge and at a corner', () => {
  const { board } = newGame();
  assert.deepEqual(keys(poisonCells(board, 7, 7)), square(6, 6, 8, 8));
  assert.deepEqual(keys(poisonCells(board, 0, 7)), square(0, 6, 1, 8), 'left edge: 6 cells');
  assert.deepEqual(keys(poisonCells(board, 7, BOARD_SIZE - 1)), square(6, BOARD_SIZE - 2, 8, BOARD_SIZE - 1), 'bottom edge: 6 cells');
  assert.deepEqual(keys(poisonCells(board, 0, 0)), square(0, 0, 1, 1), 'upper left corner: 4 cells');
  assert.deepEqual(keys(poisonCells(board, BOARD_SIZE - 1, BOARD_SIZE - 1)), square(BOARD_SIZE - 2, BOARD_SIZE - 2, BOARD_SIZE - 1, BOARD_SIZE - 1));
});

test('Venom makes state.poison at once with the target, the clipped square and the end turn', () => {
  const start = serpentToVenom();
  const used = useSkill(start, { player: X, skill: VENOM, target: { x: 8, y: 8 } });
  const state = ok(used);
  assert.deepEqual(state.poison, {
    player: X, x: 8, y: 8, cells: poisonCells(state.board, 8, 8), endsAfterTurn: start.turn + VENOM_TURNS,
  });
  assert.deepEqual(keys(state.poison.cells), square(7, 7, 9, 9));
  assert.deepEqual(used.events.find((e) => e.type === 'poisonPlaced'), {
    type: 'poisonPlaced', player: X, x: 8, y: 8, cells: state.poison.cells, endsAfterTurn: start.turn + VENOM_TURNS,
  });
  assert.equal(state.skillUsed, VENOM);
  assert.equal(state.currentPlayer, X, 'same player, same turn');
  assert.equal(state.turn, start.turn);
  assert.equal(skillCooldown(state, X, VENOM), 6);
  assert.equal(start.poison, null, 'the old state is untouched');

  const corner = useSkill(serpentToVenom({ x: 14, y: 14 }), { player: X, skill: VENOM, target: { x: 14, y: 14 } });
  assert.deepEqual(keys(corner.state.poison.cells), square(13, 13, 14, 14));
  const edge = useSkill(serpentToVenom({ x: 0, y: 5 }), { player: X, skill: VENOM, target: { x: 0, y: 5 } });
  assert.deepEqual(keys(edge.state.poison.cells), square(0, 4, 1, 6));
});

test('Venom may target a plant of the opponent only: not an empty plot, a rock, an own plant or off the board', () => {
  const fresh = serpentToVenom();
  for (const target of [{ x: 2, y: 2 }, { x: 0, y: 14 }, { x: -1, y: 3 }, { x: BOARD_SIZE, y: 3 }, null]) {
    const result = useSkill(fresh, { player: X, skill: VENOM, target });
    assert.equal(result.ok, false, JSON.stringify(target));
    assert.deepEqual(result.events, []);
  }
  const board = fresh.board.map((row) => row.slice());
  board[4][4] = ROCK;
  const rocky = { ...fresh, board, rocks: [{ x: 4, y: 4 }] };
  assert.equal(useSkill(rocky, { player: X, skill: VENOM, target: { x: 4, y: 4 } }).ok, false);
  assert.equal(skillCooldown(fresh, X, VENOM), 0, 'a refused skill costs nothing');
});

// --- Planting ---

test('nobody may plant on an empty poisoned cell: not the opponent, not the caster in the cast turn', () => {
  const cast = ok(useSkill(serpentToVenom(), { player: X, skill: VENOM, target: { x: 8, y: 8 } }));
  // The caster's own planting in the cast turn already bites.
  const own = placeStone(cast, { player: X, x: 7, y: 7 });
  assert.equal(own.ok, false);
  assert.equal(own.error, 'That cell is poisoned.');
  assert.equal(own.error, POISONED_ERROR);
  assert.deepEqual(own.events, []);
  // The turn was not used: the caster plants elsewhere and the opponent is next.
  const after = place(cast, X, 14, 0);
  assert.equal(after.currentPlayer, O);
  // The opponent is refused on every empty zone cell and may plant beside the zone.
  for (const cell of cast.poison.cells) {
    if (cell.x === 8 && cell.y === 8) continue; // the poisoned plant itself: the plot is taken
    const result = placeStone(after, { player: O, x: cell.x, y: cell.y });
    assert.equal(result.error, 'That cell is poisoned.', `${cell.x},${cell.y}`);
  }
  assert.equal(placeStone(after, { player: O, x: 8, y: 8 }).error, 'That cell is not empty.', 'a taken plot is not poisoned empty ground');
  assert.equal(place(after, O, 6, 6).board[6][6], O);
  assert.equal(isPoisoned(after, 7, 7), true);
  assert.equal(isPoisoned(after, 6, 6), false);
  assert.equal(isPoisoned({ board: after.board }, 7, 7), false, 'a state without the field has no poison');
});

test('plants inside the zone stay and keep counting for lines', () => {
  let state = newGame({ characters: assignSides([JADE_SERPENT, EARTH_BEAR]) });
  const fillers = [[0, 14], [2, 14], [4, 14], [6, 14]];
  const row = [[5, 8], [6, 8], [7, 8], [8, 8]];
  for (let i = 0; i < 4; i++) {
    state = place(state, X, fillers[i][0], fillers[i][1]);
    state = place(state, O, row[i][0], row[i][1]);
  }
  state = venomTurn(state, { x: 8, y: 8 }, { x: 8, y: 14 });
  assert.equal(state.board[8][8], O);
  assert.equal(placeStone(state, { player: O, x: 9, y: 8 }).error, POISONED_ERROR, 'the fifth plant may not go into the zone');
  const won = placeStone(state, { player: O, x: 4, y: 8 });
  assert.equal(won.ok, true, won.error);
  assert.equal(won.state.winner, O, 'the two poisoned plants still count');
  assert.deepEqual(keys(won.state.winLine), ['4,8', '5,8', '6,8', '7,8', '8,8']);
});

// --- Timing ---

test('the zone lasts through the opponent\'s next turn and the caster\'s next, then ends (poisonEnded)', () => {
  const T = 3;
  let state = venomTurn(serpentToVenom());
  assert.equal(state.turn, T + 1);
  assert.equal(state.poison.endsAfterTurn, T + VENOM_TURNS);
  // Turn T+1 (the opponent): the zone is there and stays.
  const kept = placeStone(state, { player: O, x: 1, y: 1 });
  state = ok(kept);
  assert.ok(state.poison, 'still there after the opponent\'s turn');
  assert.equal(kept.events.some((e) => e.type === 'poisonEnded'), false);
  // Turn T+2 (the caster): a cell of the zone is still refused, then the zone ends with this turn.
  assert.equal(placeStone(state, { player: X, x: 9, y: 9 }).error, POISONED_ERROR);
  const ended = placeStone(state, { player: X, x: 3, y: 3 });
  state = ok(ended);
  assert.equal(state.poison, null);
  assert.deepEqual(ended.events.filter((e) => e.type === 'poisonEnded'), [{ type: 'poisonEnded', player: X }]);
  // Turn T+3 (the opponent) may plant where the poison was.
  assert.equal(place(state, O, 9, 9).board[9][9], O);
});

// --- No room ---

// A board where every plot is a rock except `free`, which is empty, and the
// poisoned plant of O at (7, 7). X (Jade Serpent) is to move.
function crowdedGame(free) {
  const state = newGame({ characters: assignSides([JADE_SERPENT, EARTH_BEAR]) });
  const board = state.board.map((row) => row.map(() => ROCK));
  board[7][7] = O;
  for (const { x, y } of free) board[y][x] = EMPTY;
  return { ...state, board, rocks: [] };
}

test('Venom is refused when the zone would leave no empty unpoisoned plot, and the turn is not used', () => {
  const state = crowdedGame([{ x: 6, y: 6 }, { x: 8, y: 8 }, { x: 7, y: 6 }]);
  const refused = useSkill(state, { player: X, skill: VENOM, target: { x: 7, y: 7 } });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'There would be no room left to plant.');
  assert.equal(refused.error, NO_ROOM_ERROR);
  assert.deepEqual(refused.events, []);
  assert.equal(state.skillUsed, null);
  assert.equal(canUseSkill(state, X, VENOM), true, 'Venom is still ready');
  // One plot outside the zone is room enough.
  const roomy = crowdedGame([{ x: 6, y: 6 }, { x: 12, y: 12 }]);
  assert.equal(useSkill(roomy, { player: X, skill: VENOM, target: { x: 7, y: 7 } }).ok, true);
});

test('the player to move can always plant: a zone that would block the next player ends early', () => {
  const start = crowdedGame([{ x: 6, y: 6 }, { x: 12, y: 12 }]);
  const cast = ok(useSkill(start, { player: X, skill: VENOM, target: { x: 7, y: 7 } }));
  assert.equal(hasPlantableCell(cast), true);
  // X takes the only free plot outside the zone: O would be stuck, so the zone ends now.
  const planted = placeStone(cast, { player: X, x: 12, y: 12 });
  const state = ok(planted);
  assert.equal(state.poison, null);
  assert.deepEqual(planted.events.filter((e) => e.type === 'poisonEnded'), [{ type: 'poisonEnded', player: X }]);
  assert.equal(state.currentPlayer, O);
  assert.equal(hasPlantableCell(state), true);
  assert.equal(place(state, O, 6, 6).board[6][6], O);
  assert.equal(state.draw, false);
});

// A small deterministic random generator for the property test below.
function lcg(seed) {
  let value = seed;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

test('property: on small boards the player to move can always plant, whatever the skills did', () => {
  const pairs = [[JADE_SERPENT, EARTH_BEAR], [JADE_SERPENT, WIND_RABBIT], [WIND_RABBIT, JADE_SERPENT], [CLOUD_EAGLE, JADE_SERPENT]];
  let casts = 0;
  for (let game = 0; game < 240; game++) {
    const random = lcg(1000 + game);
    const size = 4 + (game % 3);
    let state = newGame({ size, characters: assignSides(pairs[game % pairs.length]) });
    for (let step = 0; step < 80 && state.winner === null && !state.draw; step++) {
      const player = state.currentPlayer;
      const skills = CHARACTERS[state.characters[player]].skills;
      const cell = () => ({ x: Math.floor(random() * size), y: Math.floor(random() * size) });
      if (random() < 0.7) {
        const skill = skills[Math.floor(random() * skills.length)];
        const target = skill === WIND_DASH ? { from: cell(), to: cell() } : { ...cell() };
        const used = useSkill(state, { player, skill, target });
        if (used.ok) {
          state = used.state;
          if (skill === VENOM) casts++;
        }
      }
      assert.equal(hasPlantableCell(state), true, `game ${game} step ${step}: ${player} cannot plant`);
      const options = [];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) options.push({ x, y });
      let planted = null;
      while (!planted && options.length > 0) {
        const { x, y } = options.splice(Math.floor(random() * options.length), 1)[0];
        const result = placeStone(state, { player, x, y }, { random });
        if (result.ok) planted = result;
      }
      assert.ok(planted, `game ${game} step ${step}: ${player} found no cell to plant`);
      state = planted.state;
    }
  }
  assert.ok(casts > 100, `the property test used Venom ${casts} times`);
});

// --- Dash, mud and the Tornado throw ---

test('a Wind Dash cannot target a poisoned plot, may start inside the zone, and a pending one fails when its target is poisoned', () => {
  // Jade Serpent (X) poisons the rabbit's plant; the rabbit (O) dashes.
  const state = venomTurn(serpentToVenom({ x: 5, y: 5 }, WIND_RABBIT), { x: 5, y: 5 });
  const poisoned = { player: O, skill: WIND_DASH, target: { from: { x: 5, y: 5 }, to: { x: 4, y: 4 } } };
  const refused = useSkill(state, poisoned);
  assert.equal(refused.error, DASH_ON_POISON_ERROR);
  assert.equal(refused.error, 'A Wind Dash cannot land on poison.');
  const out = ok(useSkill(state, { player: O, skill: WIND_DASH, target: { from: { x: 5, y: 5 }, to: { x: 8, y: 5 } } }));
  assert.ok(out.pendingDash, 'a dash from inside the zone to a free plot outside it is announced');

  // The rabbit (X) announces a dash; the serpent (O) poisons its target before it resolves.
  let race = newGame({ characters: assignSides([WIND_RABBIT, JADE_SERPENT]) });
  race = place(race, X, 5, 5);
  race = place(race, O, 12, 12);
  race = skillTurn(race, X, WIND_DASH, { from: { x: 5, y: 5 }, to: { x: 6, y: 6 } }, { x: 0, y: 0 });
  const events = [];
  race = skillTurn(race, O, VENOM, { x: 5, y: 5 }, { x: 10, y: 10 }, events);
  assert.deepEqual(events.filter((e) => e.type === 'dashFailed').map((e) => e.reason), ['targetTaken']);
  assert.equal(race.board[5][5], X, 'the dasher stays where it was');
  assert.equal(race.board[6][6], EMPTY);
  assert.equal(race.pendingDash, null);
});

test('Mud Trap cannot target a poisoned plot; a puddle already there stays but cannot be planted on', () => {
  const state = venomTurn(serpentToVenom({ x: 8, y: 8 }));
  const refused = useSkill(state, { player: O, skill: MUD_TRAP, target: { x: 7, y: 7 } });
  assert.equal(refused.error, 'That cell is poisoned.');
  assert.equal(useSkill(state, { player: O, skill: MUD_TRAP, target: { x: 6, y: 6 } }).ok, true);

  // Earth Bear (X) floods (7, 7) and plants; the serpent (O) poisons around that plant.
  let flood = newGame({ characters: assignSides([EARTH_BEAR, JADE_SERPENT]) });
  flood = skillTurn(flood, X, MUD_TRAP, { x: 7, y: 7 }, { x: 8, y: 8 });
  flood = skillTurn(flood, O, VENOM, { x: 8, y: 8 }, { x: 14, y: 0 });
  assert.equal(flood.mud.length, 1, 'the puddle is still there');
  assert.equal(placeStone(flood, { player: X, x: 7, y: 7 }).error, POISONED_ERROR);
});

test('a Tornado throw never lands on a poisoned plot', () => {
  // The rabbit (X) casts the cross at (3, 3) and plants at (1, 1); the serpent (O) poisons around (1, 1).
  let state = newGame({ characters: assignSides([WIND_RABBIT, JADE_SERPENT]) });
  state = skillTurn(state, X, TORNADO_ZONE, { x: 3, y: 3 }, { x: 1, y: 1 });
  state = skillTurn(state, O, VENOM, { x: 1, y: 1 }, { x: 12, y: 12 });
  assert.equal(isPoisoned(state, 2, 2), true, '(2, 2) is a neighbour of the trap centre inside the zone');
  const planted = placeStone(state, { player: X, x: 3, y: 3 }, { random: () => 0 });
  assert.equal(planted.ok, true, planted.error);
  const thrown = planted.events.find((e) => e.type === 'stoneThrown');
  assert.deepEqual(thrown.to, { x: 3, y: 2 }, 'without the poison the first free neighbour would be (2, 2)');
  assert.equal(planted.state.board[2][2], EMPTY);
});

// --- Hidden information: the zone is public ---

test('the zone and its events are public: a cloud hides nothing of them', () => {
  // The eagle (X) hides in a cloud; the serpent (O) poisons around a plant. The
  // rules do not look at clouds (online the covered target is refused first by
  // coveredActionError), so this only checks the zone itself is never masked.
  let state = newGame({ characters: assignSides([CLOUD_EAGLE, JADE_SERPENT]) });
  state = skillTurn(state, X, CLOUD, { x: 7, y: 7 }, { x: 7, y: 7 });
  const cast = useSkill(state, { player: O, skill: VENOM, target: { x: 7, y: 7 } });
  state = ok(cast);
  const masked = maskForViewer(state, O);
  assert.ok(coveredCells(state, O).length > 0, 'the cloud covers cells for the serpent');
  assert.deepEqual(masked.poison, state.poison, 'state.poison reaches the other seat whole');
  assert.ok(masked.poison.cells.some((c) => masked.covered.some((k) => k.x === c.x && k.y === c.y)), 'some zone cells are under the cloud');
  const poisonEvents = [...cast.events.filter((e) => e.type === 'poisonPlaced'), { type: 'poisonEnded', player: O }];
  assert.equal(poisonEvents.length, 2);
  assert.deepEqual(maskEventsForViewer(masked, poisonEvents), poisonEvents, 'both events stay, also on a covered plot');
  assert.deepEqual(maskForViewer(state, X).poison, state.poison, 'and the cloud owner sees it too');
});

// --- Texts ---

test('the Hiss lock text is Locked: N turn(s) from HISS_LOCK_TURNS and Silenced by Hiss is gone', () => {
  assert.equal(lockedText(1), 'Locked: 1 turn');
  assert.equal(lockedText(2), 'Locked: 2 turns');
  assert.equal(STRINGS.skillLocked, lockedText(HISS_LOCK_TURNS));
  assert.equal(STRINGS.skillLocked, 'Locked: 1 turn');
  assert.equal(Object.hasOwn(STRINGS, 'skillSilenced'), false);
  for (const text of Object.values(STRINGS)) assert.equal(/Silenced/i.test(text), false, text);

  const start = newGame({ characters: assignSides([JADE_SERPENT, EARTH_BEAR]) });
  const hissed = place(ok(useSkill(start, { player: X, skill: HISS })), X, 0, 14);
  const bearCard = hudViewModel(hissed).cards.find((card) => card.player === O);
  for (const row of bearCard.skills) {
    assert.equal(row.stateText, STRINGS.skillLocked, row.id);
    assert.equal(row.disabled, true);
  }
});

test('the skill texts come from the constants', () => {
  const fact = (id, label) => SKILL_INFO[id].facts.find((f) => f.label === label)?.value;
  const turnsText = (count) => `${count} ${count === 1 ? 'turn' : 'turns'}`;
  assert.match(SKILL_INFO[VENOM].brief, new RegExp(`${VENOM_ZONE_SIZE} by ${VENOM_ZONE_SIZE} patch`));
  assert.equal(fact(VENOM, 'Area'), `${VENOM_ZONE_SIZE} by ${VENOM_ZONE_SIZE}`);
  assert.equal(fact(VENOM, 'Lasts'), turnsText(VENOM_TURNS));
  assert.doesNotMatch(SKILL_INFO[VENOM].description, /withers|left empty/);
  assert.ok(SKILL_INFO[VENOM].rules.includes('Can pick a plant sunk in mud'));
  assert.ok(SKILL_INFO[VENOM].rules.includes('Rocks cannot be picked'));
  assert.equal(fact(HISS, 'Locks'), turnsText(HISS_LOCK_TURNS));
  assert.match(STRINGS.venomTargetPrompt, new RegExp(`${VENOM_ZONE_SIZE} by ${VENOM_ZONE_SIZE}`));
});

// --- Targeting and the preview ---

test('Venom targeting: the prompt, a click on an opponent plant, and the 3 by 3 preview', () => {
  const state = serpentToVenom();
  const targeting = startTargeting(VENOM);
  assert.equal(targetPrompt(targeting), STRINGS.venomTargetPrompt);
  assert.deepEqual(targetClick(state, X, targeting, { x: 8, y: 8 }), { target: { x: 8, y: 8 } });
  assert.match(targetClick(state, X, targeting, { x: 0, y: 14 }).error, /opponent/);
  assert.match(targetClick(state, X, targeting, { x: 3, y: 3 }).error, /opponent/);

  const preview = targetPreview(state, X, targeting, { x: 8, y: 8 });
  assert.equal(preview.type, 'poison');
  assert.deepEqual(keys(preview.cells), square(7, 7, 9, 9));
  assert.equal(targetPreview(state, X, targeting, { x: 0, y: 14 }), null, 'an own plant shows nothing');
  assert.equal(targetPreview(state, X, targeting, { x: 3, y: 3 }), null, 'an empty plot shows nothing');
  assert.equal(targetPreview(state, X, targeting, null), null);
  const edge = serpentToVenom({ x: 0, y: 0 });
  assert.deepEqual(keys(targetPreview(edge, X, targeting, { x: 0, y: 0 }).cells), square(0, 0, 1, 1), 'cut at the corner');

  // Mud Trap shows and takes nothing on a poisoned plot.
  const poisoned = venomTurn(state, { x: 8, y: 8 });
  const mud = startTargeting(MUD_TRAP);
  assert.equal(targetClick(poisoned, O, mud, { x: 7, y: 7 }).error, POISONED_ERROR);
  assert.equal(targetPreview(poisoned, O, mud, { x: 7, y: 7 }), null);
  assert.equal(targetPreview(poisoned, O, mud, { x: 6, y: 6 }).type, 'select');
});

// --- The minimum look ---

test('poisoned plots become poison decals; the preview shows the square and a ring on the plant', () => {
  const state = venomTurn(serpentToVenom(), { x: 8, y: 8 });
  const marks = boardMarks({ state, hover: null, preview: null });
  // The withered soil lies on the empty plots only: the target plant (8, 8) stands in the fog.
  assert.deepEqual(keys(marks.decals.filter((d) => d.kind === 'poison')), square(7, 7, 9, 9).filter((key) => key !== '8,8'));

  const bare = serpentToVenom();
  const preview = targetPreview(bare, X, startTargeting(VENOM), { x: 8, y: 8 });
  const shown = boardMarks({ state: bare, hover: { x: 8, y: 8 }, preview });
  assert.deepEqual(keys(shown.decals.filter((d) => d.kind === 'poisonPreview')), square(7, 7, 9, 9));
  assert.deepEqual(shown.decals.filter((d) => d.kind === 'select').map((d) => `${d.x},${d.y}`), ['8,8']);
  assert.equal(boardMarks({ state: bare, hover: null, preview: null }).decals.some((d) => d.kind === 'poison'), false);
});

test('the poison tile is a withered purple 32 by 32 pixel tile', () => {
  const grid = poisonTileGrid();
  assert.equal(grid.width, POISON_TILE_PX);
  assert.equal(grid.height, POISON_TILE_PX);
  const colours = new Set(grid.pixels.filter(Boolean));
  assert.ok(colours.has(POISON_COLOURS.base));
  for (const colour of colours) {
    assert.ok(Object.values(POISON_COLOURS).includes(colour), colour);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
    assert.ok(b > g && r > g, `${colour} is purple`);
  }
});

test('Venom plays a cast effect from its public events (the zone itself is drawn from state.poison)', () => {
  const state = venomTurn(serpentToVenom());
  const used = useSkill(serpentToVenom(), { player: X, skill: VENOM, target: { x: 8, y: 8 } });
  const specs = visualsForEvents(used.events);
  const venom = specs.find((spec) => spec.kind === 'venom');
  assert.ok(venom, 'a venom spec');
  assert.deepEqual([venom.x, venom.y, venom.player, venom.cells.length], [8, 8, X, 9]);
  assert.ok(specs.some((spec) => spec.kind === 'castRing' && spec.x === 8 && spec.y === 8));
  assert.deepEqual(visualsForEvents([{ type: 'poisonEnded', player: X }]), [{ kind: 'poisonEnd', player: X }]);
  assert.ok(state.poison);
});

// The poison decals on the screen now: visible meshes of the decal pool `kind`.
async function renderGame() {
  installFakeDocument();
  const { createWorldRenderer } = await import('../src/render3d/world-renderer.js');
  const gl = fakeRenderer();
  const renderer = createWorldRenderer(fakeCanvas(), { storage: null, quality: 'medium', createRenderer: () => gl });
  const ctx = fakeCanvas().getContext('2d');
  let time = 1000;
  const frames = (view, count = 3) => {
    for (let i = 0; i < count; i++) {
      time += 16;
      renderer.drawGameScreen(ctx, { ...view, time });
    }
  };
  const decals = (kind) => {
    const found = [];
    gl.scene.traverse((object) => {
      if (object.visible && object.isMesh && object.material?.name === `decal-${kind}`) found.push(object.material.opacity);
    });
    return found;
  };
  return { frames, decals };
}

test('the 3D board tints the zone for both seats and drops it when it ends', async () => {
  const { frames, decals } = await renderGame();
  const game = createLocalGame({ characters: { [X]: JADE_SERPENT, [O]: EARTH_BEAR } });
  frames(game.getView());
  assert.equal(decals('poison').length, 0, 'no zone before the cast');

  game.click({ x: 0, y: 14 }); // X
  game.click({ x: 8, y: 8 }); // O
  assert.equal(game.clickSkill(X, VENOM), true);
  frames(game.getView());
  assert.equal(decals('poisonPreview').length, 0, 'no preview before the pointer is on a plant');
  game.setHover({ x: 8, y: 8 });
  frames(game.getView());
  assert.deepEqual(decals('poisonPreview'), Array(9).fill(POISON_PREVIEW_OPACITY), 'the 3 by 3 square around the hovered plant');
  assert.equal(decals('poison').length, 0, 'no zone yet');
  assert.equal(game.click({ x: 8, y: 8 }), true);
  frames(game.getView());
  assert.deepEqual(decals('poison'), Array(8).fill(POISON_OPACITY), 'the zone is drawn from state.poison, on its 8 empty plots');
  assert.equal(decals('poisonPreview').length, 0, 'the preview is gone once the zone exists');

  assert.equal(game.click({ x: 14, y: 0 }), true); // X plants: O's turn, the other seat sees the zone too
  frames(game.getView());
  assert.equal(decals('poison').length, 8);
  assert.equal(game.click({ x: 1, y: 1 }), true); // O
  frames(game.getView());
  assert.equal(decals('poison').length, 8, 'still there on the caster\'s next turn');
  assert.equal(game.click({ x: 2, y: 2 }), true); // X: the zone ends with this turn
  frames(game.getView());
  assert.equal(game.getState().poison, null);
  assert.equal(decals('poison').length, 0);
});

test('the 2D renderer draws a poison zone and its preview without crashing', async () => {
  installFakeDocument();
  const { drawGameScreen } = await import('../src/render/game-renderer.js');
  const game = createLocalGame({ characters: { [X]: JADE_SERPENT, [O]: EARTH_BEAR } });
  game.click({ x: 0, y: 14 });
  game.click({ x: 8, y: 8 });
  game.clickSkill(X, VENOM);
  game.setHover({ x: 8, y: 8 });
  const ctx = fakeCanvas().getContext('2d');
  assert.doesNotThrow(() => drawGameScreen(ctx, { ...game.getView(), time: 1000 }));
  game.click({ x: 8, y: 8 });
  assert.doesNotThrow(() => drawGameScreen(ctx, { ...game.getView(), time: 1100 }));
  // An older state with no poison field draws too.
  const view = game.getView();
  const { poison, ...older } = view.state;
  assert.ok(poison);
  assert.doesNotThrow(() => drawGameScreen(ctx, { ...view, state: older, time: 1200 }));
});
