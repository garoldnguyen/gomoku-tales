// Who watches a room (src/net/audience.js, docs/flow-design.md section
// 3.9): the list, the relay's part and the chat popup's pick.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIENCE, RELAY_ID, UNWATCH, WATCH, audienceMessage, createAudience } from '../src/net/audience.js';
import { maySend, routeFor, watchersOf } from '../worker/pairing.js';
import { toastMessage } from '../src/ui/chat-dom.js';

test('createAudience: watch adds, unwatch removes, the relay audience replaces; never lists itself', () => {
  const audience = createAudience('me');
  assert.equal(audience.take({ type: WATCH, from: 'a', name: ' Calm  Owl ' }), true);
  assert.equal(audience.take({ type: WATCH, from: 'a', name: 'Calm Owl' }), false, 'a repeat changes nothing');
  assert.equal(audience.take({ type: WATCH, from: 'me', name: 'Me' }), false);
  assert.equal(audience.take({ type: WATCH, from: 'b' }), true);
  assert.deepEqual(audience.list(), [{ id: 'a', name: 'Calm Owl' }, { id: 'b', name: null }]);
  assert.equal(audience.take({ type: UNWATCH, from: 'a' }), true);
  assert.deepEqual(audience.list(), [{ id: 'b', name: null }]);
  assert.equal(audience.take(audienceMessage([{ id: 'c', name: 'Fox' }, { id: 'me', name: 'Me' }])), true);
  assert.deepEqual(audience.list(), [{ id: 'c', name: 'Fox' }]);
  assert.equal(audience.take({ type: 'chat', from: 'x' }), false);
  assert.equal(audience.take({ type: AUDIENCE, from: RELAY_ID }), false, 'no list, no change');
});

test('the relay: a spectator may send watch and unwatch, which go to nobody; the audience lists the watching sockets', () => {
  assert.equal(maySend('spectator', { type: WATCH }), true);
  assert.equal(maySend('spectator', { type: UNWATCH }), true);
  assert.equal(maySend('spectator', { type: 'state' }), false);
  assert.deepEqual(routeFor('spectator', { type: WATCH }), []);
  assert.deepEqual(watchersOf([{ watching: true, peer: 'a', name: 'Owl' }, { watching: false, peer: 'b' }, { peer: 'c' }]), [{ id: 'a', name: 'Owl' }]);
});

test('the chat popup shows the newest message after the last one shown, never this window\'s own', () => {
  const messages = [{ id: 1, text: 'a' }, { id: 2, text: 'b', mine: true }];
  assert.equal(toastMessage(messages, 2), null);
  assert.equal(toastMessage(messages, 1), null, 'mine');
  assert.equal(toastMessage([...messages, { id: 3, text: 'c', system: true }], 2).id, 3);
  assert.equal(toastMessage([], 0), null);
});
