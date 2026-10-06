// The hidden Tornado Zone (owner's rule, docs/design.md section 5.1): only
// the player who cast it sees where it is. The other seat's state and
// events say that a zone was cast, never its centre or cells; spectators
// see everything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { O, X } from '../src/logic/board.js';
import { localViewEvents, localViewState, maskEventsForViewer, maskForViewer } from '../src/logic/cloud.js';
import { createInitialState, useSkill } from '../src/logic/game.js';
import { TORNADO_ZONE } from '../src/logic/skills.js';
import { hostStateMessages } from '../src/net/room.js';
import { visualsForEvents } from '../src/render3d/effect-plans.js';

function cast() {
  const result = useSkill(createInitialState(), { player: X, skill: TORNADO_ZONE, target: { x: 4, y: 9 } });
  assert.equal(result.ok, true);
  return result;
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
  assert.equal(localViewEvents(state, events).find((e) => e.type === 'tornadoAnnounced').hidden, true);
});
