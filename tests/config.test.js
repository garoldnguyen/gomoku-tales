import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as config from '../src/config.js';

test('config holds the design values', () => {
  assert.equal(config.BOARD_SIZE, 15);
  assert.equal(config.WIN_LENGTH, 5);
  assert.equal(config.COOLDOWN_SHORT, 3);
  assert.equal(config.COOLDOWN_LONG, 6);
  assert.equal(config.ROCK_LIFETIME_TURNS, 4);
  assert.equal(config.TORNADO_SIZE, 3);
  assert.equal(config.CELL_PX, 24);
  assert.equal(config.INTERNAL_WIDTH, 960);
  assert.equal(config.INTERNAL_HEIGHT, 540);
  assert.equal(config.HEARTBEAT_INTERVAL_MS, 1000);
  assert.equal(config.PEER_TIMEOUT_MS, 3000);
  assert.equal(config.LEAVE_COUNTDOWN_S, 10);
  assert.equal(config.ROOM_CODE_LENGTH, 5);
});

test('the board fits inside the internal resolution', () => {
  const boardPx = config.BOARD_SIZE * config.CELL_PX;
  assert.ok(boardPx <= config.INTERNAL_WIDTH);
  assert.ok(boardPx <= config.INTERNAL_HEIGHT);
});
