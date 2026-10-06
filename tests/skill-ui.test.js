import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOLDOWN_SHORT, COOLDOWN_LONG, ROCK_LIFETIME_TURNS } from '../src/config.js';
import { X, O, ROCK } from '../src/logic/board.js';
import { createInitialState } from '../src/logic/game.js';
import { WIND_DASH, TORNADO_ZONE, TERRAIN_CREATION, STONE_CONVERSION } from '../src/logic/skills.js';
import { BOARD_X, BOARD_Y, BOARD_PX, panelRect, skillButtonAt, skillButtonRect } from '../src/render/layout.js';
import { hitTest, isCancelKey } from '../src/ui/input.js';
import { createLocalGame, describeEvents, panelView, skillLockReason } from '../src/ui/local-game.js';
import { startTargeting, targetClick, targetPreview, targetPrompt } from '../src/ui/targeting.js';

// --- Layout and hit testing ---

test('panels sit left (Wind Rabbit) and right (Earth Bear) of the board without overlapping it', () => {
  const left = panelRect(X);
  const right = panelRect(O);
  assert.ok(left.x >= 0 && left.x + left.w < BOARD_X);
  assert.ok(right.x > BOARD_X + BOARD_PX && right.x + right.w <= 960);
  assert.equal(left.y, right.y);
  assert.ok(left.y < BOARD_Y && left.y + left.h > BOARD_Y + BOARD_PX);
});

test('skill buttons lie inside their panel and do not overlap', () => {
  for (const player of [X, O]) {
    const panel = panelRect(player);
    const a = skillButtonRect(player, 0);
    const b = skillButtonRect(player, 1);
    for (const r of [a, b]) {
      assert.ok(r.x >= panel.x && r.x + r.w <= panel.x + panel.w);
      assert.ok(r.y >= panel.y && r.y + r.h <= panel.y + panel.h);
    }
    assert.ok(a.y + a.h <= b.y);
  }
});

test('skillButtonAt and hitTest find buttons, board cells and empty space', () => {
  const r = skillButtonRect(O, 1);
  assert.deepEqual(skillButtonAt(r.x, r.y), { player: O, index: 1 });
  assert.deepEqual(skillButtonAt(r.x + r.w - 1, r.y + r.h - 1), { player: O, index: 1 });
  assert.equal(skillButtonAt(r.x + r.w, r.y), null);

  const l = skillButtonRect(X, 0);
  assert.deepEqual(hitTest(l.x + 5, l.y + 5), { skill: { player: X, skillId: WIND_DASH } });
  assert.deepEqual(hitTest(r.x + 5, r.y + 5), { skill: { player: O, skillId: STONE_CONVERSION } });
  assert.deepEqual(hitTest(BOARD_X + 1, BOARD_Y + 1), { cell: { x: 0, y: 0 } });
  assert.equal(hitTest(5, 5), null);
});

test('Escape is the cancel key', () => {
  assert.equal(isCancelKey({ key: 'Escape' }), true);
  assert.equal(isCancelKey({ key: 'r' }), false);
});

// --- Targeting flows (pure) ---

function stateWith(cells, currentPlayer = X) {
  const state = createInitialState();
  for (const [x, y, v] of cells) state.board[y][x] = v;
  return { ...state, currentPlayer };
}

test('Wind Dash targeting: pick an own stone, then an empty cell', () => {
  const state = stateWith([[2, 2, X], [3, 3, O], [5, 5, X]]);
  let t = startTargeting(WIND_DASH);
  assert.equal(targetPrompt(t), 'Wind Dash: choose one of your stones');
  assert.deepEqual(targetClick(state, X, t, { x: 3, y: 3 }), { error: 'Choose one of your own stones.' });
  assert.deepEqual(targetClick(state, X, t, { x: 0, y: 0 }), { error: 'Choose one of your own stones.' });

  t = targetClick(state, X, t, { x: 2, y: 2 }).targeting;
  assert.deepEqual(t.from, { x: 2, y: 2 });
  assert.equal(targetPrompt(t), 'Wind Dash: choose an empty target cell');
  assert.deepEqual(targetClick(state, X, t, { x: 3, y: 3 }), { error: 'Choose an empty target cell.' });

  // Another own stone switches the source; the same stone un-picks it.
  assert.deepEqual(targetClick(state, X, t, { x: 5, y: 5 }).targeting.from, { x: 5, y: 5 });
  assert.equal(targetClick(state, X, t, { x: 2, y: 2 }).targeting.from, null);

  assert.deepEqual(targetClick(state, X, t, { x: 9, y: 9 }), { target: { from: { x: 2, y: 2 }, to: { x: 9, y: 9 } } });
});

test('Wind Dash target cannot be a rock', () => {
  const state = stateWith([[2, 2, X], [4, 4, ROCK]]);
  const t = { skill: WIND_DASH, from: { x: 2, y: 2 } };
  assert.deepEqual(targetClick(state, X, t, { x: 4, y: 4 }), { error: 'Choose an empty target cell.' });
});

test('Tornado Zone accepts any cell as the centre, including occupied and edge cells', () => {
  const state = stateWith([[4, 4, O]]);
  const t = startTargeting(TORNADO_ZONE);
  assert.equal(targetPrompt(t), 'Tornado Zone: choose the zone centre');
  assert.deepEqual(targetClick(state, X, t, { x: 4, y: 4 }), { target: { x: 4, y: 4 } });
  assert.deepEqual(targetClick(state, X, t, { x: 0, y: 0 }), { target: { x: 0, y: 0 } });
});

test('Terrain Creation needs an empty cell; Stone Conversion needs an opponent stone', () => {
  const state = stateWith([[1, 1, X], [2, 2, O], [3, 3, ROCK]], O);
  const terrain = startTargeting(TERRAIN_CREATION);
  assert.equal(targetPrompt(terrain), 'Terrain Creation: choose an empty cell');
  for (const cell of [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]) {
    assert.deepEqual(targetClick(state, O, terrain, cell), { error: 'Choose an empty cell.' });
  }
  assert.deepEqual(targetClick(state, O, terrain, { x: 6, y: 6 }), { target: { x: 6, y: 6 } });

  const convert = startTargeting(STONE_CONVERSION);
  assert.equal(targetPrompt(convert), "Stone Conversion: choose an opponent's stone");
  for (const cell of [{ x: 2, y: 2 }, { x: 3, y: 3 }, { x: 6, y: 6 }]) {
    assert.deepEqual(targetClick(state, O, convert, cell), { error: "Choose one of your opponent's stones." });
  }
  assert.deepEqual(targetClick(state, O, convert, { x: 1, y: 1 }), { target: { x: 1, y: 1 } });
});

test('target previews follow the hovered cell', () => {
  const state = stateWith([[2, 2, X], [3, 3, O]]);
  assert.deepEqual(targetPreview(state, X, startTargeting(WIND_DASH), { x: 2, y: 2 }), { type: 'select', x: 2, y: 2 });
  assert.equal(targetPreview(state, X, startTargeting(WIND_DASH), { x: 3, y: 3 }), null);
  assert.equal(targetPreview(state, X, startTargeting(WIND_DASH), null), null);

  const dash = { skill: WIND_DASH, from: { x: 2, y: 2 } };
  assert.deepEqual(targetPreview(state, X, dash, { x: 6, y: 6 }), { type: 'dash', from: { x: 2, y: 2 }, to: { x: 6, y: 6 } });
  assert.deepEqual(targetPreview(state, X, dash, { x: 3, y: 3 }), { type: 'dash', from: { x: 2, y: 2 }, to: null });
  assert.deepEqual(targetPreview(state, X, dash, null), { type: 'dash', from: { x: 2, y: 2 }, to: null });

  const zone = targetPreview(state, X, startTargeting(TORNADO_ZONE), { x: 0, y: 0 });
  assert.equal(zone.type, 'zone');
  assert.equal(zone.cells.length, 4); // clipped at the corner

  assert.deepEqual(targetPreview(state, O, startTargeting(TERRAIN_CREATION), { x: 5, y: 5 }), { type: 'rock', x: 5, y: 5 });
  assert.equal(targetPreview(state, O, startTargeting(TERRAIN_CREATION), { x: 2, y: 2 }), null);
  assert.deepEqual(targetPreview(state, O, startTargeting(STONE_CONVERSION), { x: 2, y: 2 }), { type: 'select', x: 2, y: 2 });
  assert.equal(targetPreview(state, O, startTargeting(STONE_CONVERSION), { x: 3, y: 3 }), null);
});

// --- Panels ---

test('panel view shows name, stone, turn highlight, cooldowns and locked state', () => {
  const game = createLocalGame();
  let [left, right] = game.getView().panels;
  assert.equal(left.name, 'Wind Rabbit');
  assert.equal(left.stone, X);
  assert.equal(right.name, 'Earth Bear');
  assert.equal(right.stone, O);
  assert.equal(left.active, true);
  assert.equal(right.active, false);
  assert.equal(left.you, true);
  assert.deepEqual(left.skills.map((s) => s.id), [WIND_DASH, TORNADO_ZONE]);
  assert.deepEqual(right.skills.map((s) => s.id), [TERRAIN_CREATION, STONE_CONVERSION]);
  assert.ok(left.skills.every((s) => s.usable && !s.locked && s.cooldown === 0));
  assert.ok(right.skills.every((s) => !s.usable && !s.locked));

  game.click({ x: 7, y: 7 }); // X
  game.clickSkill(O, TERRAIN_CREATION);
  game.click({ x: 0, y: 0 });
  [left, right] = game.getView().panels;
  assert.equal(left.active, true);
  assert.equal(right.skills[0].cooldown, COOLDOWN_SHORT);
  assert.equal(right.skills[0].locked, true);
  assert.equal(right.skills[1].locked, false);
});

test('panelView marks the selected skill and the winner', () => {
  const state = createInitialState();
  const panel = panelView(state, X, { targeting: startTargeting(TORNADO_ZONE), hoverSkill: { player: X, skillId: WIND_DASH } });
  assert.deepEqual(panel.skills.map((s) => [s.selected, s.hovered]), [[false, true], [true, false]]);

  const won = { ...state, winner: O };
  assert.equal(panelView(won, O).winner, true);
  assert.equal(panelView(won, O).active, false);
  assert.equal(panelView(won, X).skills[0].usable, false);
});

// --- Local mode controller with skills ---

test('clicking a skill button starts targeting and the status shows the prompt', () => {
  const game = createLocalGame();
  assert.equal(game.clickSkill(X, TORNADO_ZONE), true);
  assert.deepEqual(game.getTargeting(), { skill: TORNADO_ZONE, from: null });
  assert.equal(game.getView().status, 'Tornado Zone: choose the zone centre');
  // Placement hover is off while targeting.
  game.setHover({ x: 3, y: 3 });
  assert.equal(game.getView().hover, null);
  assert.equal(game.getView().preview.type, 'zone');
});

test('the same skill button, Escape and restart cancel targeting', () => {
  const game = createLocalGame();
  game.clickSkill(X, WIND_DASH);
  assert.equal(game.clickSkill(X, WIND_DASH), false);
  assert.equal(game.getTargeting(), null);

  game.clickSkill(X, WIND_DASH);
  assert.equal(game.cancel(), true);
  assert.equal(game.getTargeting(), null);
  assert.equal(game.cancel(), false);
  assert.equal(game.getView().status, 'Wind Rabbit to move');

  game.clickSkill(X, TORNADO_ZONE);
  game.restart();
  assert.equal(game.getTargeting(), null);
});

test('another skill button switches the flow to that skill', () => {
  const game = createLocalGame();
  game.clickSkill(X, WIND_DASH);
  game.clickSkill(X, TORNADO_ZONE);
  assert.equal(game.getTargeting().skill, TORNADO_ZONE);
});

test("the other player's buttons and locked skills refuse with a message", () => {
  const game = createLocalGame();
  assert.equal(game.clickSkill(O, TERRAIN_CREATION), false);
  assert.equal(game.getView().message, "It is Wind Rabbit's turn.");
  assert.equal(game.getTargeting(), null);

  game.clickSkill(X, TORNADO_ZONE);
  game.click({ x: 7, y: 7 });
  game.click({ x: 0, y: 14 }); // O, outside the zone
  assert.equal(game.clickSkill(X, TORNADO_ZONE), false);
  assert.equal(game.getView().message, `Tornado Zone is locked for ${COOLDOWN_LONG} more turns.`);
  assert.equal(skillLockReason(game.getState(), X, WIND_DASH), null);
  assert.equal(skillLockReason(game.getState(), O, TERRAIN_CREATION), "It is Wind Rabbit's turn.");
});

test('an invalid target keeps the flow running with a message', () => {
  const game = createLocalGame();
  game.clickSkill(X, WIND_DASH);
  assert.equal(game.click({ x: 4, y: 4 }), false);
  assert.equal(game.getView().message, 'Choose one of your own stones.');
  assert.equal(game.getTargeting().skill, WIND_DASH);
  assert.equal(game.getView().status, 'Wind Dash: choose one of your stones');
});

test('Wind Dash end to end: announce, red frame data, opponent turn, landing', () => {
  const game = createLocalGame();
  game.click({ x: 2, y: 2 }); // X
  game.click({ x: 10, y: 10 }); // O
  game.clickSkill(X, WIND_DASH);
  assert.equal(game.click({ x: 2, y: 2 }), false); // source picked, no action yet
  assert.deepEqual(game.getView().preview, { type: 'dash', from: { x: 2, y: 2 }, to: null });
  assert.equal(game.click({ x: 6, y: 6 }), true);

  let state = game.getState();
  assert.deepEqual(state.pendingDash.to, { x: 6, y: 6 });
  assert.equal(state.currentPlayer, O);
  assert.equal(game.getTargeting(), null);
  assert.equal(game.getView().message, 'Wind Dash! The stone dashes after the next turn.');

  game.click({ x: 11, y: 11 }); // O's turn ends, the dash resolves
  state = game.getState();
  assert.equal(state.pendingDash, null);
  assert.equal(state.board[2][2], null);
  assert.equal(state.board[6][6], X);
  assert.equal(game.getView().message, 'Wind Dash landed.');
});

test('Wind Dash failure is reported when the target is taken', () => {
  const game = createLocalGame();
  game.click({ x: 2, y: 2 });
  game.click({ x: 10, y: 10 });
  game.clickSkill(X, WIND_DASH);
  game.click({ x: 2, y: 2 });
  game.click({ x: 6, y: 6 });
  game.click({ x: 6, y: 6 }); // O takes the target
  assert.equal(game.getState().board[2][2], X);
  assert.equal(game.getView().message, 'Wind Dash failed: the target cell is taken.');
});

test('Tornado Zone end to end: on one screen the zone is hidden, and a seed planted in it is thrown with injected random', () => {
  const game = createLocalGame({ random: () => 0 });
  game.clickSkill(X, TORNADO_ZONE);
  game.click({ x: 7, y: 7 });
  assert.equal(game.getState().tornado.cells.length, 9);
  assert.equal(game.getView().message, 'Tornado Zone! Somewhere a storm is waiting.', 'O is to move and must not see it');

  game.click({ x: 7, y: 7 }); // O inside the zone; random 0 picks the first empty plot outside, (0, 0)
  const state = game.getState();
  assert.equal(state.board[7][7], null);
  assert.equal(state.board[0][0], O);
  assert.equal(state.tornado, null);
  assert.equal(game.getView().message, 'The dandelion storm threw the stone away!');
});

test('Terrain Creation end to end: a rock appears and later crumbles', () => {
  const game = createLocalGame();
  game.click({ x: 7, y: 7 }); // X
  game.clickSkill(O, TERRAIN_CREATION);
  game.setHover({ x: 3, y: 3 });
  assert.deepEqual(game.getView().preview, { type: 'rock', x: 3, y: 3 });
  assert.equal(game.click({ x: 3, y: 3 }), true);
  assert.equal(game.getState().board[3][3], ROCK);
  assert.equal(game.getView().message, 'Terrain Creation! A rock fell.');

  // Placing on the rock is refused.
  assert.equal(game.click({ x: 3, y: 3 }), false);
  assert.equal(game.getView().message, 'That cell is not empty.');

  for (let i = 0; i < ROCK_LIFETIME_TURNS; i++) game.click({ x: i, y: 12 });
  assert.equal(game.getState().board[3][3], null);
  assert.equal(game.getView().message, 'A rock crumbled.');
});

test('Stone Conversion end to end: an X stone becomes O', () => {
  const game = createLocalGame();
  game.click({ x: 7, y: 7 }); // X
  game.clickSkill(O, STONE_CONVERSION);
  assert.equal(game.click({ x: 0, y: 0 }), false);
  assert.equal(game.getView().message, "Choose one of your opponent's stones.");
  assert.equal(game.click({ x: 7, y: 7 }), true);
  assert.equal(game.getState().board[7][7], O);
  assert.equal(game.getState().currentPlayer, X);
  assert.equal(game.getView().message, 'Stone Conversion! The stone changed sides.');
});

test('skills are refused after the game is won', () => {
  const game = createLocalGame();
  for (let i = 0; i < 4; i++) {
    game.click({ x: i, y: 0 });
    game.click({ x: i, y: 1 });
  }
  game.click({ x: 4, y: 0 });
  assert.equal(game.getState().winner, X);
  assert.equal(game.clickSkill(O, TERRAIN_CREATION), false);
  assert.equal(game.getView().message, 'The game is over.');
  const [left, right] = game.getView().panels;
  assert.equal(left.winner, true);
  assert.equal(left.you || right.you, false);
});

test('describeEvents skips plain placements and joins skill messages', () => {
  assert.equal(describeEvents([{ type: 'stonePlaced' }, { type: 'turnEnded' }]), null);
  assert.equal(
    describeEvents([{ type: 'stonePlaced' }, { type: 'dashFailed', reason: 'sourceLost' }, { type: 'rockBroken' }]),
    'Wind Dash failed: the stone is gone. A rock crumbled.',
  );
});
