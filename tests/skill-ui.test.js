import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOLDOWN_SHORT, COOLDOWN_LONG, MUD_LIFETIME_TURNS, MUD_SINK_TURNS, TORNADO_TURNS } from '../src/config.js';
import { X, O, ROCK } from '../src/logic/board.js';
import { createInitialState } from '../src/logic/game.js';
import { WIND_DASH, TORNADO_ZONE, MUD_TRAP, PETRIFICATION } from '../src/logic/skills.js';
import { BOARD_X, BOARD_Y, BOARD_PX, panelRect, skillButtonAt, skillButtonRect } from '../src/render/layout.js';
import { hitTest, isCancelKey } from '../src/ui/input.js';
import { createLocalGame, describeEvents, panelView, skillLockReason } from '../src/ui/local-game.js';
import { STRINGS } from '../src/ui/strings.js';
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
  assert.deepEqual(hitTest(r.x + 5, r.y + 5), { skill: { player: O, skillId: PETRIFICATION } });
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

  // The range is WIND_DASH_RANGE cells, diagonals included (Chebyshev).
  assert.deepEqual(targetClick(state, X, t, { x: 5, y: 4 }), { target: { from: { x: 2, y: 2 }, to: { x: 5, y: 4 } } });
  assert.deepEqual(targetClick(state, X, t, { x: 2, y: 5 }), { target: { from: { x: 2, y: 2 }, to: { x: 2, y: 5 } } });
  assert.deepEqual(targetClick(state, X, t, { x: 6, y: 2 }), { error: 'That cell is too far for Wind Dash.' });
  assert.deepEqual(targetClick(state, X, t, { x: 9, y: 9 }), { error: 'That cell is too far for Wind Dash.' });
});

test('Wind Dash target cannot be a rock', () => {
  const state = stateWith([[2, 2, X], [4, 4, ROCK]]);
  const t = { skill: WIND_DASH, from: { x: 2, y: 2 } };
  assert.deepEqual(targetClick(state, X, t, { x: 4, y: 4 }), { error: 'Choose an empty target cell.' });
});

test('Tornado Zone accepts any cell as the centre, including occupied and edge cells', () => {
  const state = stateWith([[4, 4, O]]);
  const t = startTargeting(TORNADO_ZONE);
  assert.equal(targetPrompt(t), 'Tornado Zone: choose the trap centre');
  assert.deepEqual(targetClick(state, X, t, { x: 4, y: 4 }), { target: { x: 4, y: 4 } });
  assert.deepEqual(targetClick(state, X, t, { x: 0, y: 0 }), { target: { x: 0, y: 0 } });
});

test('Mud Trap needs an empty plot that is not mud; Petrification needs an opponent plant that is not sunk', () => {
  const state = stateWith([[1, 1, X], [2, 2, O], [3, 3, ROCK], [4, 4, X]], O);
  state.mud = [{ x: 8, y: 8, player: O, driesAfterTurn: 9 }];
  state.sunk = [{ x: 4, y: 4, player: X, surfacesAfterTurn: 9 }];
  const mud = startTargeting(MUD_TRAP);
  assert.equal(targetPrompt(mud), 'Mud Trap: choose an empty cell');
  for (const cell of [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]) {
    assert.deepEqual(targetClick(state, O, mud, cell), { error: 'Choose an empty cell.' });
  }
  assert.deepEqual(targetClick(state, O, mud, { x: 8, y: 8 }), { error: 'That cell is already mud.' });
  assert.deepEqual(targetClick(state, O, mud, { x: 6, y: 6 }), { target: { x: 6, y: 6 } });

  const petrify = startTargeting(PETRIFICATION);
  assert.equal(targetPrompt(petrify), "Petrification: choose an opponent's stone");
  for (const cell of [{ x: 2, y: 2 }, { x: 3, y: 3 }, { x: 6, y: 6 }]) {
    assert.deepEqual(targetClick(state, O, petrify, cell), { error: "Choose one of your opponent's stones." });
  }
  assert.deepEqual(targetClick(state, O, petrify, { x: 4, y: 4 }), { error: 'That plant is sunk in mud.' });
  assert.deepEqual(targetClick(state, O, petrify, { x: 1, y: 1 }), { target: { x: 1, y: 1 } });
});

test('target previews follow the hovered cell', () => {
  const state = stateWith([[2, 2, X], [3, 3, O]]);
  assert.deepEqual(targetPreview(state, X, startTargeting(WIND_DASH), { x: 2, y: 2 }), { type: 'select', x: 2, y: 2 });
  assert.equal(targetPreview(state, X, startTargeting(WIND_DASH), { x: 3, y: 3 }), null);
  assert.equal(targetPreview(state, X, startTargeting(WIND_DASH), null), null);

  const dash = { skill: WIND_DASH, from: { x: 2, y: 2 } };
  assert.deepEqual(targetPreview(state, X, dash, { x: 5, y: 5 }), { type: 'dash', from: { x: 2, y: 2 }, to: { x: 5, y: 5 } });
  assert.deepEqual(targetPreview(state, X, dash, { x: 6, y: 6 }), { type: 'dash', from: { x: 2, y: 2 }, to: null }, 'out of range: no red frame');
  assert.deepEqual(targetPreview(state, X, dash, { x: 3, y: 3 }), { type: 'dash', from: { x: 2, y: 2 }, to: null });
  assert.deepEqual(targetPreview(state, X, dash, null), { type: 'dash', from: { x: 2, y: 2 }, to: null });

  const zone = targetPreview(state, X, startTargeting(TORNADO_ZONE), { x: 0, y: 0 });
  assert.equal(zone.type, 'zone');
  assert.deepEqual(zone.cells, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], 'the cross, clipped at the corner');
  assert.equal(targetPreview(state, X, startTargeting(TORNADO_ZONE), { x: 7, y: 7 }).cells.length, 5);
  assert.equal(targetPreview(state, X, startTargeting(TORNADO_ZONE), { x: 7, y: 0 }).cells.length, 4);

  assert.deepEqual(targetPreview(state, O, startTargeting(MUD_TRAP), { x: 5, y: 5 }), { type: 'select', x: 5, y: 5 });
  assert.equal(targetPreview(state, O, startTargeting(MUD_TRAP), { x: 2, y: 2 }), null);
  assert.deepEqual(targetPreview(state, O, startTargeting(PETRIFICATION), { x: 2, y: 2 }), { type: 'select', x: 2, y: 2 });
  assert.equal(targetPreview(state, O, startTargeting(PETRIFICATION), { x: 3, y: 3 }), null);
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
  assert.deepEqual(right.skills.map((s) => s.id), [MUD_TRAP, PETRIFICATION]);
  assert.ok(left.skills.every((s) => s.usable && !s.locked && s.cooldown === 0));
  assert.ok(right.skills.every((s) => !s.usable && !s.locked));

  game.click({ x: 7, y: 7 }); // X
  game.clickSkill(O, MUD_TRAP);
  game.click({ x: 0, y: 0 });
  [left, right] = game.getView().panels;
  assert.equal(right.active, true, 'a skill does not end the turn');
  assert.equal(left.active, false);
  assert.equal(right.skills[0].cooldown, COOLDOWN_SHORT, 'the full cooldown starts at once');
  assert.equal(right.skills[0].locked, true);
  assert.equal(right.skills[1].locked, false);
  assert.equal(right.skills[1].usable, false, 'one skill per turn');
  game.click({ x: 1, y: 14 }); // O plants, which ends the turn
  [left, right] = game.getView().panels;
  assert.equal(left.active, true);
  assert.equal(right.skills[0].cooldown, COOLDOWN_SHORT, 'the planting does not count the used skill down');
});

test('panelView: after a skill the ready skills of the player to move carry the used note, for the 2D panel', () => {
  const game = createLocalGame();
  assert.ok(game.getView().panels.every((panel) => panel.skills.every((skill) => skill.note === null)), 'no note before a skill');
  game.clickSkill(X, TORNADO_ZONE);
  game.click({ x: 7, y: 7 });
  let [left, right] = game.getView().panels;
  assert.equal(left.skills[0].note, STRINGS.skillUsedState, 'Wind Dash is ready but not usable now');
  assert.equal(left.skills[0].locked, false);
  assert.equal(left.skills[1].note, null, 'the skill used is locked by its cooldown, not noted');
  assert.equal(left.skills[1].locked, true);
  assert.ok(right.skills.every((skill) => skill.note === null), 'the other player is waiting, nothing to note');
  game.click({ x: 14, y: 0 }); // X plants, which ends the turn
  [left, right] = game.getView().panels;
  assert.ok([left, right].every((panel) => panel.skills.every((skill) => skill.note === null)), 'the note ends with the turn');
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
  assert.equal(game.getView().status, 'Tornado Zone: choose the trap centre');
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
  assert.equal(game.clickSkill(O, MUD_TRAP), false);
  assert.equal(game.getView().message, "It is Wind Rabbit's turn.");
  assert.equal(game.getTargeting(), null);

  game.clickSkill(X, TORNADO_ZONE);
  game.click({ x: 7, y: 7 });
  assert.equal(game.clickSkill(X, WIND_DASH), false, 'one skill per turn');
  assert.equal(game.getView().message, STRINGS.skillAlreadyUsedError);
  game.click({ x: 14, y: 0 }); // X plants, which ends the turn
  game.click({ x: 0, y: 14 }); // O, outside the zone
  assert.equal(game.clickSkill(X, TORNADO_ZONE), false);
  assert.equal(game.getView().message, `Tornado Zone is locked for ${COOLDOWN_LONG} more turns.`);
  assert.equal(skillLockReason(game.getState(), X, WIND_DASH), null);
  assert.equal(skillLockReason(game.getState(), O, MUD_TRAP), "It is Wind Rabbit's turn.");
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
  assert.equal(game.click({ x: 6, y: 6 }), false, 'four cells away is out of range');
  assert.equal(game.getView().message, 'That cell is too far for Wind Dash.');
  assert.equal(game.click({ x: 5, y: 5 }), true);

  let state = game.getState();
  assert.deepEqual(state.pendingDash.to, { x: 5, y: 5 });
  assert.equal(state.currentPlayer, X, 'the turn goes on after a skill');
  assert.equal(game.getTargeting(), null);
  assert.equal(game.getView().message, 'Wind Dash! The stone dashes after the next turn.');
  assert.equal(game.getView().status, STRINGS.plantToEndTurn);

  game.click({ x: 3, y: 14 }); // X plants, which ends its turn
  game.click({ x: 11, y: 11 }); // O's turn ends, the dash resolves
  state = game.getState();
  assert.equal(state.pendingDash, null);
  assert.equal(state.board[2][2], null);
  assert.equal(state.board[5][5], X);
  assert.equal(game.getView().message, 'Wind Dash landed.');
});

test('Wind Dash failure is reported when the target is taken', () => {
  const game = createLocalGame();
  game.click({ x: 2, y: 2 });
  game.click({ x: 10, y: 10 });
  game.clickSkill(X, WIND_DASH);
  game.click({ x: 2, y: 2 });
  game.click({ x: 5, y: 5 });
  game.click({ x: 3, y: 14 }); // X plants, which ends its turn
  game.click({ x: 5, y: 5 }); // O takes the target
  assert.equal(game.getState().board[2][2], X);
  assert.equal(game.getView().message, 'Wind Dash failed: the target cell is taken.');
});

test('Tornado Zone end to end: on one screen the zone is hidden, and a seed planted in it is thrown with injected random', () => {
  const game = createLocalGame({ random: () => 0 });
  game.clickSkill(X, TORNADO_ZONE);
  game.click({ x: 7, y: 7 });
  assert.equal(game.getState().tornado.cells.length, 5, 'the cross');
  // X is still to move (a skill does not end the turn) and is told what it cast.
  assert.equal(game.getView().message, `Tornado Zone! The trap waits for ${TORNADO_TURNS} turns.`);
  game.click({ x: 14, y: 0 }); // X plants, which ends its turn
  assert.equal(game.getView().message, null, 'O is to move and reads nothing of the cast');
  assert.deepEqual(Object.keys(game.getView().state.tornado).sort(), ['endsAfterTurn', 'hidden', 'player'], 'O is to move and must not see where');

  game.click({ x: 7, y: 7 }); // O on the cross; random 0 picks the first free neighbour, (6, 6)
  const state = game.getState();
  assert.equal(state.board[7][7], null);
  assert.equal(state.board[6][6], O);
  assert.equal(state.tornado, null);
  assert.equal(game.getView().message, 'The dandelion storm threw the stone away!');
});

test('Mud Trap end to end: a puddle appears, sinks a seed and dries', () => {
  const game = createLocalGame();
  game.click({ x: 7, y: 7 }); // X
  game.clickSkill(O, MUD_TRAP);
  game.setHover({ x: 3, y: 3 });
  assert.deepEqual(game.getView().preview, { type: 'select', x: 3, y: 3 });
  assert.equal(game.click({ x: 3, y: 3 }), true);
  assert.equal(game.getState().board[3][3], null, 'a puddle is not a board stone');
  assert.deepEqual(game.getState().mud.map(({ x, y }) => ({ x, y })), [{ x: 3, y: 3 }]);
  assert.equal(game.getView().message, 'Mud Trap! A mud puddle.');

  // A puddle nobody plants in dries MUD_LIFETIME_TURNS turns after the cast turn.
  const dry = createLocalGame();
  dry.click({ x: 7, y: 7 }); // X
  dry.clickSkill(O, MUD_TRAP);
  dry.click({ x: 3, y: 3 });
  for (let i = 0; i <= MUD_LIFETIME_TURNS; i++) dry.click({ x: i, y: 12 });
  assert.deepEqual(dry.getState().mud, []);
  assert.match(dry.getView().message, /The mud dried\./);

  // A seed planted in the puddle sinks and surfaces MUD_SINK_TURNS turns later.
  const sink = createLocalGame();
  sink.click({ x: 7, y: 7 }); // X
  sink.clickSkill(O, MUD_TRAP);
  sink.click({ x: 3, y: 3 });
  assert.equal(sink.click({ x: 3, y: 3 }), true); // O plants in the puddle
  assert.equal(sink.getState().sunk.length, 1);
  assert.equal(sink.getView().message, 'The seed sank in the mud.');
  for (let i = 0; i < MUD_SINK_TURNS; i++) sink.click({ x: i, y: 12 });
  assert.equal(sink.getState().sunk.length, 0);
  assert.match(sink.getView().message, /The seed surfaced\./);
});

test('Petrification end to end: an X plant turns into a rock for good', () => {
  const game = createLocalGame();
  game.click({ x: 7, y: 7 }); // X
  game.clickSkill(O, PETRIFICATION);
  assert.equal(game.click({ x: 0, y: 0 }), false);
  assert.equal(game.getView().message, "Choose one of your opponent's stones.");
  assert.equal(game.click({ x: 7, y: 7 }), true);
  assert.equal(game.getState().board[7][7], ROCK);
  assert.deepEqual(game.getState().rocks, [{ x: 7, y: 7 }]);
  assert.equal(game.getState().currentPlayer, O, 'O still has to plant');
  assert.equal(game.getView().message, 'Petrification! The plant turned to stone.');
  for (let i = 0; i < 12; i++) game.click({ x: i % 15, y: 12 + (i > 14 ? 1 : 0) });
  assert.equal(game.getState().board[7][7], ROCK, 'a petrified plant never crumbles');
});

test('skills are refused after the game is won', () => {
  const game = createLocalGame();
  for (let i = 0; i < 4; i++) {
    game.click({ x: i, y: 0 });
    game.click({ x: i, y: 1 });
  }
  game.click({ x: 4, y: 0 });
  assert.equal(game.getState().winner, X);
  assert.equal(game.clickSkill(O, MUD_TRAP), false);
  assert.equal(game.getView().message, 'The game is over.');
  const [left, right] = game.getView().panels;
  assert.equal(left.winner, true);
  assert.equal(left.you || right.you, false);
});

test('describeEvents skips plain placements and joins skill messages', () => {
  assert.equal(describeEvents([{ type: 'stonePlaced' }, { type: 'turnEnded' }]), null);
  assert.equal(
    describeEvents([{ type: 'stonePlaced' }, { type: 'dashFailed', reason: 'sourceLost' }, { type: 'mudDried' }]),
    'Wind Dash failed: the stone is gone. The mud dried.',
  );
});
