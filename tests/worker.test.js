import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as config from '../src/config.js';
import * as limits from '../worker/limits.js';
import {
  JOIN_ACCEPT,
  JOIN_FULL,
  JOIN_NO_ROOM,
  JOIN_TAKEN,
  FRAME_OK,
  FRAME_TOO_LARGE,
  FRAME_TOO_FAST,
  FRAME_BAD_JSON,
  SNAPSHOT_TYPES,
  decideJoin,
  checkFrame,
  countFrame,
  snapshotFor,
  parseRelayQuery,
} from '../worker/pairing.js';

const LIMIT_NAMES = ['MAX_FRAME_BYTES', 'MAX_FRAMES_PER_SECOND', 'SPECTATOR_LIMIT', 'EMPTY_ROOM_CLEANUP_MS'];

test('worker limits equal the constants of src/config.js', () => {
  for (const name of LIMIT_NAMES) {
    assert.ok(Number.isInteger(config[name]) && config[name] > 0, name + ' is a positive integer in src/config.js');
    assert.equal(limits[name], config[name], name);
    assert.equal(limits.LIMITS[name], config[name], 'LIMITS.' + name);
  }
});

test('decideJoin: hosts', () => {
  assert.equal(decideJoin({ host: false, guest: false, spectators: 0 }, 'host'), JOIN_ACCEPT);
  assert.equal(decideJoin({ host: true, guest: false, spectators: 0 }, 'host'), JOIN_TAKEN);
  assert.equal(decideJoin({ host: true, guest: true, spectators: 3 }, 'host'), JOIN_TAKEN);
});

test('decideJoin: guests', () => {
  assert.equal(decideJoin({ host: true, guest: false, spectators: 0 }, 'guest'), JOIN_ACCEPT);
  assert.equal(decideJoin({ host: true, guest: true, spectators: 0 }, 'guest'), JOIN_FULL);
  assert.equal(decideJoin({ host: false, guest: false, spectators: 0 }, 'guest'), JOIN_NO_ROOM);
  assert.equal(decideJoin({ host: false, guest: true, spectators: 0 }, 'guest'), JOIN_NO_ROOM);
});

test('decideJoin: spectators up to SPECTATOR_LIMIT', () => {
  const max = config.SPECTATOR_LIMIT;
  assert.equal(decideJoin({ host: true, guest: false, spectators: 0 }, 'spectator'), JOIN_ACCEPT);
  assert.equal(decideJoin({ host: true, guest: true, spectators: max - 1 }, 'spectator'), JOIN_ACCEPT);
  assert.equal(decideJoin({ host: true, guest: true, spectators: max }, 'spectator'), JOIN_FULL);
  assert.equal(decideJoin({ host: false, guest: false, spectators: 0 }, 'spectator'), JOIN_NO_ROOM);
  assert.equal(decideJoin({ host: true, guest: false, spectators: 1 }, 'spectator', { SPECTATOR_LIMIT: 1 }), JOIN_FULL);
});

test('decideJoin: an unknown role is refused', () => {
  assert.notEqual(decideJoin({ host: true, guest: false, spectators: 0 }, 'admin'), JOIN_ACCEPT);
});

const frameLimits = (framesThisSecond = 1) => ({
  MAX_FRAME_BYTES: config.MAX_FRAME_BYTES,
  MAX_FRAMES_PER_SECOND: config.MAX_FRAMES_PER_SECOND,
  framesThisSecond,
});

test('checkFrame: a JSON message object is ok', () => {
  assert.equal(checkFrame(JSON.stringify({ type: 'ping', from: 'a' }), frameLimits()), FRAME_OK);
});

test('checkFrame: size is counted in bytes, the limit itself is ok', () => {
  const base = JSON.stringify({ type: 'x', pad: '' });
  const exact = JSON.stringify({ type: 'x', pad: 'a'.repeat(config.MAX_FRAME_BYTES - base.length) });
  assert.equal(new TextEncoder().encode(exact).length, config.MAX_FRAME_BYTES);
  assert.equal(checkFrame(exact, frameLimits()), FRAME_OK);
  const over = JSON.stringify({ type: 'x', pad: 'a'.repeat(config.MAX_FRAME_BYTES - base.length + 1) });
  assert.equal(checkFrame(over, frameLimits()), FRAME_TOO_LARGE);
  // Two bytes per character: half as many characters already exceed it.
  const wide = JSON.stringify({ type: 'x', pad: 'é'.repeat(config.MAX_FRAME_BYTES / 2) });
  assert.ok(wide.length < config.MAX_FRAME_BYTES);
  assert.equal(checkFrame(wide, frameLimits()), FRAME_TOO_LARGE);
  assert.equal(checkFrame(new ArrayBuffer(config.MAX_FRAME_BYTES + 1), frameLimits()), FRAME_TOO_LARGE);
});

test('checkFrame: more than MAX_FRAMES_PER_SECOND frames in a second is too fast', () => {
  const text = JSON.stringify({ type: 'ping' });
  assert.equal(checkFrame(text, frameLimits(config.MAX_FRAMES_PER_SECOND)), FRAME_OK);
  assert.equal(checkFrame(text, frameLimits(config.MAX_FRAMES_PER_SECOND + 1)), FRAME_TOO_FAST);
});

test('checkFrame: anything but JSON text of an object with a string type is bad-json', () => {
  for (const raw of ['not json', '{', '42', '"text"', 'null', '[]', '{}', '{"type":3}', new ArrayBuffer(4)]) {
    assert.equal(checkFrame(raw, frameLimits()), FRAME_BAD_JSON, String(raw));
  }
});

test('checkFrame: size beats rate beats JSON', () => {
  const big = 'x'.repeat(config.MAX_FRAME_BYTES + 1);
  assert.equal(checkFrame(big, frameLimits(config.MAX_FRAMES_PER_SECOND + 1)), FRAME_TOO_LARGE);
  assert.equal(checkFrame('bad', frameLimits(config.MAX_FRAMES_PER_SECOND + 1)), FRAME_TOO_FAST);
});

test('countFrame counts frames within one second and then starts again', () => {
  const window = { start: 0, count: 0 };
  for (let i = 0; i < config.MAX_FRAMES_PER_SECOND + 1; i++) countFrame(window, 500);
  assert.equal(window.count, config.MAX_FRAMES_PER_SECOND + 1);
  countFrame(window, 999);
  assert.equal(window.count, config.MAX_FRAMES_PER_SECOND + 2);
  countFrame(window, 1000);
  assert.deepEqual(window, { start: 1000, count: 1 });
});

test('snapshotFor replays the last message of each type in a fixed order', () => {
  assert.deepEqual([...SNAPSHOT_TYPES], ['seats', 'state', 'start', 'result', 'new-game', 'rematch-status']);
  const store = {
    'rematch-status': 'R',
    'new-game': 'N',
    ping: 'P',
    result: 'X',
    start: 'S',
    state: 'T',
    seats: 'E',
  };
  assert.deepEqual(snapshotFor(store), ['E', 'T', 'S', 'X', 'N', 'R']);
  assert.deepEqual(snapshotFor({ state: 'T', seats: 'E' }), ['E', 'T']);
  assert.deepEqual(snapshotFor({}), []);
  assert.deepEqual(snapshotFor(null), []);
});

test('parseRelayQuery checks the room code and the role', () => {
  const query = (text) => parseRelayQuery(new URLSearchParams(text));
  assert.deepEqual(query('room=ABCDE&role=host'), { ok: true, room: 'ABCDE', role: 'host' });
  assert.equal(query('room=ZZ9CH&role=spectator').ok, true);
  for (const bad of ['room=ABC0E&role=host', 'room=abcde&role=guest', 'room=ABCD&role=guest', 'room=ABCDEF&role=guest', 'role=guest', 'room=ABCDE&role=admin', 'room=ABCDE']) {
    const result = query(bad);
    assert.equal(result.ok, false, bad);
    assert.equal(result.status, 400, bad);
  }
});

test('wrangler.toml runs the worker for /ws and binds the room object', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /^main = "worker\/index\.js"$/m);
  assert.match(toml, /^\[assets\]\ndirectory = "\."\nbinding = "ASSETS"\nrun_worker_first = \["\/ws"\]$/m);
  assert.match(toml, /^\[\[durable_objects\.bindings\]\]\nname = "ROOM"\nclass_name = "RoomRelay"$/m);
  assert.match(toml, /^\[\[migrations\]\]\ntag = "v1"\nnew_sqlite_classes = \["RoomRelay"\]$/m);
});

test('.assetsignore keeps the server, tests and private files off the public site', () => {
  const lines = readFileSync(new URL('../.assetsignore', import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  for (const entry of ['worker/', 'tests/', 'docs/', 'tools/', 'shots/', '.millstone/', '.git/', 'node_modules/', 'wrangler.toml', 'package.json', 'package-lock.json']) {
    assert.ok(lines.includes(entry), entry);
  }
  // A debug screenshot dropped in the repo root must never go public.
  assert.ok(lines.includes('/*.png'), '/*.png');
  // The game itself must stay public.
  for (const kept of ['src/', 'assets/', 'vendor/', 'index.html']) {
    assert.ok(!lines.some((line) => line.replace(/\/$/, '') === kept.replace(/\/$/, '')), kept);
  }
});
