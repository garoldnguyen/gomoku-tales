// The hidden Tornado Zone (owner's rule, docs/design.md section 5.1): only
// the player who cast it sees where it is. The other seat's state and
// events say that a zone was cast, never its centre or cells; spectators
// see everything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { O, X } from '../src/logic/board.js';
import { localViewEvents, localViewState, maskEventsForViewer, maskForViewer } from '../src/logic/cloud.js';
import { createInitialState, placeStone, useSkill } from '../src/logic/game.js';
import { TORNADO_ZONE } from '../src/logic/skills.js';
import { hostStateMessages } from '../src/net/room.js';
import { visualsForEvents, zoneVisible } from '../src/render3d/effect-plans.js';
import { createLocalGame } from '../src/ui/local-game.js';

// The cast alone: a skill does not end the turn, so X is still to move.
function castOnly() {
  const result = useSkill(createInitialState(), { player: X, skill: TORNADO_ZONE, target: { x: 4, y: 9 } });
  assert.equal(result.ok, true);
  return result;
}

// The cast and the planting that ends the turn: O is to move. Returns the
// state after the planting and the events of the cast.
function cast() {
  const used = castOnly();
  const planted = placeStone(used.state, { player: X, x: 14, y: 14 });
  assert.equal(planted.ok, true);
  return { state: planted.state, events: used.events };
}

test('the rabbit sees its zone; the other seat only that one was cast; a spectator sees all', () => {
  const { state } = cast();
  assert.equal(maskForViewer(state, X), state);
  assert.equal(maskForViewer(state, null), state);
  const theirs = maskForViewer(state, O);
  assert.deepEqual(theirs.tornado, { player: X, hidden: true, endsAfterTurn: state.tornado.endsAfterTurn });
  assert.equal(JSON.stringify(theirs).includes('"cells"'), false);
  assert.deepEqual(theirs.board, state.board);
});

test('the cast events lose the target and the zone for the other seat', () => {
  const { state, events } = cast();
  const seen = maskEventsForViewer(maskForViewer(state, O), events);
  assert.deepEqual(seen.find((e) => e.type === 'skillUsed'), { type: 'skillUsed', player: X, skill: TORNADO_ZONE, target: null });
  assert.deepEqual(seen.find((e) => e.type === 'tornadoAnnounced'), { type: 'tornadoAnnounced', player: X, hidden: true });
  assert.equal(JSON.stringify(seen).includes('"x":4'), false, 'no coordinate of the zone at all');
  assert.equal(maskEventsForViewer(maskForViewer(state, X), events), events, 'the rabbit keeps them');
  // The other seat's effects: a gust over the field, no cast ring on the plot.
  const kinds = visualsForEvents(seen).map((spec) => spec.kind);
  assert.ok(kinds.includes('tornadoHidden'));
  assert.ok(!kinds.includes('castRing') && !kinds.includes('tornado'));
});

test('online the guest gets the hidden copy and the spectators the full one; one screen hides it from the player to move', () => {
  const { state, events } = cast();
  const [guestCopy, spectators] = hostStateMessages({ type: 'state', state, events }, O, true, state);
  assert.equal(guestCopy.masked, true);
  assert.equal(guestCopy.state.tornado.hidden, true);
  assert.equal(spectators.spectatorsOnly, true);
  assert.deepEqual(spectators.state.tornado.cells, state.tornado.cells);
  assert.equal(localViewState(state).tornado.hidden, true, 'O is to move');
  assert.deepEqual(localViewState(castOnly().state).tornado, castOnly().state.tornado, 'X, the caster, is still to move and sees its zone');
  assert.equal(localViewEvents(state, events).find((e) => e.type === 'tornadoAnnounced').hidden, true);
});

// One screen (Free Action): the rabbit casts and is still to move, so it
// sees the zone, swirl included. What outlives the turn is handled by the
// renderer, which draws the zone from the viewer's state (zoneVisible and
// effects.syncTornado, tests/tornado-view.test.js), so the swirl is gone the
// moment the turn passes to the bear.
test('one screen: the caster sees the cast while it is still to move', () => {
  const { state, events } = castOnly();
  assert.equal(state.currentPlayer, X);
  const seen = localViewEvents(state, events);
  const announced = seen.find((e) => e.type === 'tornadoAnnounced');
  assert.deepEqual(announced.cells, state.tornado.cells);
  assert.ok(visualsForEvents(seen).some((spec) => spec.kind === 'tornado'), 'the swirl starts for the caster');
  assert.deepEqual(localViewState(state).tornado.cells, state.tornado.cells);
  assert.equal(zoneVisible(localViewState(state).tornado), true);
});

test('one screen: once the turn passes the bear\'s board shows only that a zone was cast', () => {
  const game = createLocalGame();
  assert.equal(game.clickSkill(X, TORNADO_ZONE), true);
  assert.equal(game.click({ x: 4, y: 9 }), true); // the zone's centre
  const afterCast = game.takeEvents();
  assert.equal(game.getState().currentPlayer, X, 'the cast does not end the turn');
  assert.equal(zoneVisible(game.getView().state.tornado), true, 'the caster sees the zone before planting');
  assert.ok(visualsForEvents(afterCast).some((spec) => spec.kind === 'tornado'));
  assert.equal(game.click({ x: 14, y: 14 }), true); // the planting that ends the turn
  assert.equal(game.getState().currentPlayer, O);
  const afterPlant = game.takeEvents();
  assert.equal(visualsForEvents(afterPlant).some((spec) => spec.kind === 'tornado' || spec.kind === 'castRing'), false);
  assert.equal(game.getView().state.tornado.hidden, true, 'the bear\'s board shows only that a zone was cast');
  assert.equal(JSON.stringify(game.getView().state.tornado).includes('"cells"'), false);
  assert.equal(zoneVisible(game.getView().state.tornado), false, 'the renderer keeps no swirl for the bear');
});

test('zoneVisible: only a zone with its cells that is not hidden', () => {
  assert.equal(zoneVisible(null), false);
  assert.equal(zoneVisible(undefined), false);
  assert.equal(zoneVisible({ player: X, hidden: true, endsAfterTurn: 2 }), false);
  assert.equal(zoneVisible({ player: X, x: 1, y: 1, cells: [{ x: 1, y: 1 }] }), true);
});
