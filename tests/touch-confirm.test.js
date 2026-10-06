// Two taps to plant on a touch screen (src/ui/input.js createTouchConfirm):
// the first tap on a cell previews it, the second on the same cell acts; a
// mouse or pen click acts at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOUCH_ACT, TOUCH_PREVIEW, createTouchConfirm } from '../src/ui/input.js';

test('a mouse or pen click acts at once', () => {
  const confirm = createTouchConfirm();
  assert.equal(confirm.decide('mouse', { x: 3, y: 4 }), TOUCH_ACT);
  assert.equal(confirm.decide('pen', { x: 3, y: 4 }), TOUCH_ACT);
  assert.equal(confirm.pending, null);
});

test('a finger previews first, then plants on a second tap of the same cell', () => {
  const confirm = createTouchConfirm();
  assert.equal(confirm.decide('touch', { x: 7, y: 7 }), TOUCH_PREVIEW);
  assert.deepEqual(confirm.pending, { x: 7, y: 7 });
  assert.equal(confirm.decide('touch', { x: 7, y: 7 }), TOUCH_ACT);
  assert.equal(confirm.pending, null, 'the next tap previews again');
  assert.equal(confirm.decide('touch', { x: 7, y: 7 }), TOUCH_PREVIEW);
});

test('a tap on another cell moves the preview; a cancel or a mouse click forgets it', () => {
  const confirm = createTouchConfirm();
  confirm.decide('touch', { x: 1, y: 1 });
  assert.equal(confirm.decide('touch', { x: 2, y: 1 }), TOUCH_PREVIEW);
  assert.deepEqual(confirm.pending, { x: 2, y: 1 });
  confirm.clear();
  assert.equal(confirm.decide('touch', { x: 2, y: 1 }), TOUCH_PREVIEW, 'after a cancel the same cell previews again');
  assert.equal(confirm.decide('mouse', { x: 9, y: 9 }), TOUCH_ACT);
  assert.equal(confirm.decide('touch', { x: 2, y: 1 }), TOUCH_PREVIEW, 'a mouse click forgot the preview');
});
