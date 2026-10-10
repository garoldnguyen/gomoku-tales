import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as config from '../src/config.js';

test('config holds the design values', () => {
  assert.equal(config.BOARD_SIZE, 15);
  assert.equal(config.WIN_LENGTH, 5);
  assert.equal(config.COOLDOWN_SHORT, 3);
  assert.equal(config.COOLDOWN_LONG, 6);
  assert.equal(config.MUD_LIFETIME_TURNS, 4);
  assert.equal(config.MUD_SINK_TURNS, 1);
  assert.equal('ROCK_LIFETIME_TURNS' in config, false, 'rocks are permanent now');
  assert.equal('TORNADO_SIZE' in config, false, 'the Tornado Zone is a cross now');
  assert.equal(config.TORNADO_ARM, 1);
  assert.equal(config.TORNADO_TURNS, 2);
  assert.equal(config.WIND_DASH_RANGE, 3);
  assert.equal(config.CELL_PX, 24);
  assert.equal(config.INTERNAL_WIDTH, 960);
  assert.equal(config.INTERNAL_HEIGHT, 540);
  assert.equal(config.HEARTBEAT_INTERVAL_MS, 1000);
  assert.equal(config.PEER_TIMEOUT_MS, 3000);
  assert.equal(config.LEAVE_COUNTDOWN_S, 10);
  assert.equal(config.ROOM_CODE_LENGTH, 5);
});

test('config holds the sprite sizes from docs/design.md section 7', () => {
  assert.equal(config.STONE_PX, 24);
  assert.equal(config.ROCK_PX, 24);
  assert.equal(config.SKILL_ICON_PX, 32);
  assert.equal(config.PORTRAIT_PX, 96);
  assert.equal(config.TORNADO_PX, 72);
});

test('the board fits inside the internal resolution', () => {
  const boardPx = config.BOARD_SIZE * config.CELL_PX;
  assert.ok(boardPx <= config.INTERNAL_WIDTH);
  assert.ok(boardPx <= config.INTERNAL_HEIGHT);
});
