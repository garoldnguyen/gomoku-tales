// Free Action part 5: Cloud Eagle's 4 by 4 cloud (docs/free-action-design.md
// section 6). A 4 by 4 area has no centre cell: the chosen cell is the upper
// left one of the middle 2 by 2, so the cloud covers x - 1 to x + 2 and
// y - 1 to y + 2, clipped to the board (lo = floor((CLOUD_SIZE - 1) / 2),
// hi = CLOUD_SIZE - 1 - lo). These tests cover the area for an odd and an
// even size, the clipping at every edge and corner, what each seat sees, the
// mask of events, every host message, the local view, the owner's turns, Sky
// Watch with a sunk seed and the preview.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE, CLOUD_SIZE, CLOUD_TURNS, PEER_TIMEOUT_MS } from '../src/config.js';
import { EMPTY, HIDDEN as TAKEN, X, O } from '../src/logic/board.js';
import { CLOUD_EAGLE, EARTH_BEAR, assignSides } from '../src/logic/characters.js';
import {
  cloudBox, cloudCells, cloudCentre, cloudReach, coveredCells, createCloud, inCloud, localViewEvents, localViewState, maskEventsForViewer,
  maskForViewer, skyWatchCells,
} from '../src/logic/cloud.js';
import { newGame, placeStone, useSkill } from '../src/logic/game.js';
import { CLOUD, MUD_TRAP } from '../src/logic/skills.js';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { PLAYING, createGuestRoom, createHostRoom, hostStateMessages } from '../src/net/room.js';
import { cloudOverlayCells } from '../src/render3d/cloud-overlay.js';
import { SKILL_INFO } from '../src/ui/skill-info.js';
import { STRINGS } from '../src/ui/strings.js';
import { createLocalGame } from '../src/ui/local-game.js';
import { startTargeting, targetPreview } from '../src/ui/targeting.js';
import { pickAndReady } from './room-start.js';

function ok(result) {
  assert.equal(result.ok, true, result.error);
  return result;
}

const place = (state, player, x, y) => ok(placeStone(state, { player, x, y })).state;
const key = ({ x, y }) => `${x},${y}`;
const sorted = (cells) => cells.map(key).sort();

// The cells x0..x1 by y0..y1, row by row.
function rect(x0, y0, x1, y1) {
  const cells = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push({ x, y });
  return cells;
}

// Cloud Eagle picked first (X) against Earth Bear (O).
function eagleGame() {
  return newGame({ characters: assignSides([CLOUD_EAGLE, EARTH_BEAR]) });
}

const BOARD = eagleGame().board;

// --- the area: odd and even sizes ---

test('cloudReach: an odd size is centred on the cell, an even size reaches one more cell down and right', () => {
  assert.deepEqual(cloudReach(1), { lo: 0, hi: 0 });
  assert.deepEqual(cloudReach(2), { lo: 0, hi: 1 });
  assert.deepEqual(cloudReach(3), { lo: 1, hi: 1 });
  assert.deepEqual(cloudReach(4), { lo: 1, hi: 2 });
  assert.deepEqual(cloudReach(5), { lo: 2, hi: 2 });
  assert.deepEqual(cloudReach(6), { lo: 2, hi: 3 });
  for (let size = 1; size <= 9; size++) {
    const { lo, hi } = cloudReach(size);
    assert.equal(lo + hi + 1, size, `size ${size}: lo, the cell and hi add up`);
    assert.equal(lo, Math.floor((size - 1) / 2));
  }
  assert.deepEqual(cloudReach(), cloudReach(CLOUD_SIZE), 'the default is CLOUD_SIZE');
  assert.equal(CLOUD_SIZE, 4);
  assert.deepEqual(cloudReach(), { lo: 1, hi: 2 });
});

test('the area for odd sizes is the old centred square, for even sizes it is shifted up and left by half a cell', () => {
  const cloud = createCloud(7, 7, X, 1);
  assert.deepEqual(cloudCells(BOARD, cloud, 5), rect(5, 5, 9, 9), 'size 5: x - 2 to x + 2');
  assert.deepEqual(cloudCells(BOARD, cloud, 3), rect(6, 6, 8, 8), 'size 3: x - 1 to x + 1');
  assert.deepEqual(cloudCells(BOARD, cloud, 1), [{ x: 7, y: 7 }], 'size 1: the cell itself');
  assert.deepEqual(cloudCells(BOARD, cloud, 4), rect(6, 6, 9, 9), 'size 4: x - 1 to x + 2');
  assert.deepEqual(cloudCells(BOARD, cloud, 2), rect(7, 7, 8, 8), 'size 2: x to x + 1');
  assert.deepEqual(cloudCells(BOARD, cloud, 6), rect(5, 5, 10, 10), 'size 6: x - 2 to x + 3');
  assert.deepEqual(cloudCells(BOARD, cloud), rect(6, 6, 9, 9), 'the default size is 4');
  for (const size of [1, 2, 3, 4, 5, 6]) {
    const cells = cloudCells(BOARD, cloud, size);
    assert.equal(cells.length, size * size);
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        assert.equal(inCloud(cloud, x, y, size), cells.some((c) => c.x === x && c.y === y), `size ${size}, (${x}, ${y})`);
      }
    }
  }
});

test('the 4 by 4 cloud: the chosen cell is the upper left of the middle 2 by 2', () => {
  const cloud = createCloud(7, 7, X, 1);
  assert.deepEqual(sorted(cloudCells(BOARD, cloud)), sorted(rect(6, 6, 9, 9)));
  for (const [x, y] of [[6, 6], [9, 9], [6, 9], [9, 6], [7, 7], [8, 8]]) assert.equal(inCloud(cloud, x, y), true, `(${x}, ${y}) is under it`);
  for (const [x, y] of [[5, 7], [10, 7], [7, 5], [7, 10], [5, 5], [10, 10]]) assert.equal(inCloud(cloud, x, y), false, `(${x}, ${y}) is not`);
  // The old 5 by 5 cloud also covered x - 2 (column 5) and the row y - 2: not any more.
  assert.equal(inCloud(cloud, 5, 7), false);
  assert.equal(inCloud(cloud, 7, 5), false);
});

test('the drawn centre of a cloud is the middle of its covered cells, not the chosen cell', () => {
  assert.deepEqual(cloudCentre(createCloud(7, 7, X, 1), BOARD_SIZE), { x: 7.5, y: 7.5 });
  assert.deepEqual(cloudCentre(createCloud(7, 7, X, 1), BOARD_SIZE, 5), { x: 7, y: 7 }, 'an odd size is centred on the cell');
  assert.deepEqual(cloudCentre(createCloud(0, 0, X, 1), BOARD_SIZE), { x: 1, y: 1 }, 'clipped: cells 0 to 2');
  assert.deepEqual(cloudCentre(createCloud(14, 14, X, 1), BOARD_SIZE), { x: 13.5, y: 13.5 }, 'clipped: cells 13 and 14');
  assert.deepEqual(cloudCentre(createCloud(14, 7, X, 1), BOARD_SIZE), { x: 13.5, y: 7.5 });
  assert.deepEqual(cloudBox(createCloud(7, 7, X, 1), BOARD_SIZE), { x0: 6, y0: 6, x1: 9, y1: 9 });
  assert.deepEqual(cloudBox(createCloud(14, 0, X, 1), BOARD_SIZE), { x0: 13, y0: 0, x1: 14, y1: 2 });
  // The centre is the middle of what cloudCells lists, whatever the clipping.
  for (const [x, y] of [[0, 0], [14, 14], [0, 14], [14, 0], [7, 0], [0, 7], [14, 7], [7, 14], [3, 11], [7, 7]]) {
    const cloud = createCloud(x, y, X, 1);
    const cells = cloudCells(BOARD, cloud);
    const xs = cells.map((c) => c.x);
    const ys = cells.map((c) => c.y);
    assert.deepEqual(cloudCentre(cloud, BOARD_SIZE), { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }, `(${x}, ${y})`);
  }
});

// --- the area clipped at every edge and corner ---

test('the cloud is clipped at every edge and corner of the board', () => {
  const last = BOARD_SIZE - 1;
  const cases = [
    // [chosen cell, first column, first row, last column, last row]
    ['upper left corner', 0, 0, 0, 0, 2, 2],
    ['upper right corner', last, 0, last - 1, 0, last, 2],
    ['lower left corner', 0, last, 0, last - 1, 2, last],
    ['lower right corner', last, last, last - 1, last - 1, last, last],
    ['top edge', 7, 0, 6, 0, 9, 2],
    ['bottom edge', 7, last, 6, last - 1, 9, last],
    ['left edge', 0, 7, 0, 6, 2, 9],
    ['right edge', last, 7, last - 1, 6, last, 9],
    ['one in from the upper left corner', 1, 1, 0, 0, 3, 3],
    ['one in from the lower right corner', last - 1, last - 1, last - 2, last - 2, last, last],
  ];
  for (const [name, x, y, x0, y0, x1, y1] of cases) {
    const cloud = createCloud(x, y, X, 1);
    const cells = cloudCells(BOARD, cloud);
    assert.deepEqual(cells, rect(x0, y0, x1, y1), name);
    assert.deepEqual(cloudBox(cloud, BOARD_SIZE), { x0, y0, x1, y1 }, `${name}: the box`);
    for (let cy = 0; cy < BOARD_SIZE; cy++) {
      for (let cx = 0; cx < BOARD_SIZE; cx++) {
        assert.equal(inCloud(cloud, cx, cy), cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1, `${name}: (${cx}, ${cy})`);
      }
    }
  }
  // The cell counts: 16 inside, 12 and 8 on an edge, 9, 6 and 4 at the corners, 9 one in from the lower right corner.
  assert.deepEqual(cases.map(([name, x, y]) => cloudCells(BOARD, createCloud(x, y, X, 1)).length), [9, 6, 6, 4, 12, 8, 12, 8, 16, 9]);
});

test('the skill: any cell works and its event lists the covered cells, clipped', () => {
  for (const [x, y] of [[0, 0], [14, 14], [7, 7], [14, 0]]) {
    const result = ok(useSkill(eagleGame(), { player: X, skill: CLOUD, target: { x, y } }));
    const placed = result.events.find((e) => e.type === 'cloudPlaced');
    assert.deepEqual(placed.cells, cloudCells(BOARD, createCloud(x, y, X, 1)));
    assert.deepEqual([placed.x, placed.y], [x, y], 'the event names the chosen cell');
  }
});

// --- what each seat sees ---

// X (Cloud Eagle) puts a cloud on (7, 7) (covering x and y 6 to 9) and
// plants (9, 9), the last covered cell; O plays; X plants (6, 6), the first
// covered cell; X's seeds on (10, 10) and (5, 5), just outside, were
// planted before the cloud. O is to move. The cloud has one owner turn left.
function cloudState() {
  let state = eagleGame();
  state = place(state, X, 10, 10);
  state = place(state, O, 0, 0);
  state = place(state, X, 5, 5);
  state = place(state, O, 0, 2);
  const used = ok(useSkill(state, { player: X, skill: CLOUD, target: { x: 7, y: 7 } }));
  state = ok(placeStone(used.state, { player: X, x: 9, y: 9 })).state;
  state = place(state, O, 0, 4);
  return place(state, X, 6, 6);
}

const COVERED = rect(6, 6, 9, 9);

test('the owner and a spectator see everything under the cloud, the other seat sees it covered', () => {
  const state = cloudState();
  assert.equal(state.currentPlayer, O);
  assert.equal(state.clouds.length, 1);
  assert.deepEqual(state.clouds[0], { x: 7, y: 7, owner: X, turnsLeft: CLOUD_TURNS - 1, placedTurn: 5 });
  assert.deepEqual(coveredCells(state, X), [], 'the owner has nothing covered');
  assert.deepEqual(coveredCells(state, O), COVERED, 'the other seat: the 16 cells, row by row');
  assert.equal(maskForViewer(state, X), state);
  assert.equal(maskForViewer(state, null), state, 'a spectator sees the full state');
  assert.equal(maskForViewer(state, undefined), state);

  const masked = maskForViewer(state, O);
  assert.deepEqual(masked.covered, COVERED);
  assert.equal(masked.board[9][9], TAKEN, 'the last covered cell is hidden');
  assert.equal(masked.board[6][6], TAKEN, 'the first covered cell is hidden');
  assert.equal(masked.board[10][10], X, 'one cell down and right of the cloud is seen');
  assert.equal(masked.board[5][5], X, 'one cell up and left of the cloud is seen (the old 5 by 5 cloud hid it)');
  assert.equal(masked.board[0][0], O);
  for (const { x, y } of COVERED) assert.ok(masked.board[y][x] === EMPTY || masked.board[y][x] === TAKEN, `(${x}, ${y})`);
  assert.equal(state.board[9][9], X, 'the true state is not changed');
});

test('a hidden seed stays hidden at every cell of the area, an empty covered cell stays empty', () => {
  const state = cloudState();
  for (let y = 6; y <= 9; y++) {
    for (let x = 6; x <= 9; x++) {
      if (state.board[y][x] === EMPTY) continue;
      assert.equal(maskForViewer(state, O).board[y][x], TAKEN, `(${x}, ${y})`);
    }
  }
  const masked = maskForViewer(state, O);
  assert.equal(masked.board[7][8], EMPTY, 'an empty covered plot may still be planted');
  // A cloud in a corner hides only what its clipped area covers.
  let corner = eagleGame();
  corner = place(corner, X, 2, 2);
  corner = place(corner, O, 3, 3);
  corner = { ...corner, clouds: [createCloud(0, 0, X, corner.turn)], currentPlayer: O };
  const seen = maskForViewer(corner, O);
  assert.equal(seen.board[2][2], TAKEN, '(2, 2) is the last cell of the corner cloud');
  assert.equal(seen.board[3][3], O, '(3, 3) is out of it');
  assert.deepEqual(seen.covered, rect(0, 0, 2, 2));
});

test('the overlay draws exactly the covered cells, each look by seat', () => {
  const state = cloudState();
  const forO = cloudOverlayCells(maskForViewer(state, O), O);
  assert.deepEqual(forO.map(({ x, y }) => ({ x, y })), COVERED);
  assert.ok(forO.every((c) => c.look === 'cover'));
  const forX = cloudOverlayCells(state, X);
  assert.deepEqual(forX.map(({ x, y }) => ({ x, y })), COVERED);
  assert.ok(forX.every((c) => c.look === 'seeThrough'));
  assert.deepEqual(cloudOverlayCells(state, null).map(({ x, y }) => ({ x, y })), COVERED, 'a spectator sees the same area');
});

// --- the mask of events ---

test('the mask of events leaves out what names a cell of the 4 by 4 area, and only those', () => {
  const state = cloudState();
  const masked = maskForViewer(state, O);
  const at = (x, y) => ({ type: 'stonePlaced', player: X, x, y });
  const inside = [at(6, 6), at(9, 9), at(6, 9), at(9, 6), at(7, 8)];
  const outside = [at(5, 6), at(6, 5), at(10, 9), at(9, 10), at(5, 5), at(10, 10), at(7, 4), at(7, 11)];
  const events = [...inside, ...outside, { type: 'turnEnded', player: X, turn: 7 }];
  const seen = maskEventsForViewer(masked, events);
  for (const event of inside) assert.equal(seen.includes(event), false, `(${event.x}, ${event.y}) is left out`);
  for (const event of outside) assert.equal(seen.includes(event), true, `(${event.x}, ${event.y}) is told`);
  assert.equal(seen.at(-1).type, 'turnEnded');
  // The other fields that name a cell are masked the same way.
  const named = [
    { type: 'dashStarted', player: X, from: { x: 9, y: 9 }, to: { x: 12, y: 12 } },
    { type: 'dashStarted', player: X, from: { x: 12, y: 12 }, to: { x: 6, y: 6 } },
    { type: 'skillUsed', player: X, skill: MUD_TRAP, target: { x: 8, y: 8 } },
  ];
  assert.deepEqual(maskEventsForViewer(masked, named), []);
  const open = [
    { type: 'dashStarted', player: X, from: { x: 10, y: 10 }, to: { x: 12, y: 12 } },
    { type: 'skillUsed', player: X, skill: MUD_TRAP, target: { x: 5, y: 8 } },
  ];
  assert.equal(maskEventsForViewer(masked, open), open);
  // The cloud itself and its end are no secret, covered or not.
  const cloudEvents = [{ type: 'cloudPlaced', player: X, x: 7, y: 7, cells: COVERED }, { type: 'cloudEnded', player: X, x: 7, y: 7 }];
  assert.equal(maskEventsForViewer(masked, cloudEvents), cloudEvents);
  // A win keeps only the cells outside the area.
  const win = { type: 'win', player: X, line: [{ x: 5, y: 7 }, { x: 6, y: 7 }, { x: 7, y: 7 }, { x: 8, y: 7 }, { x: 9, y: 7 }] };
  assert.deepEqual(maskEventsForViewer(masked, [win])[0].line, [{ x: 5, y: 7 }], 'only (5, 7) is outside');
});

// --- every host message ---

// X is Cloud Eagle on the host, O is Earth Bear on the guest. The same
// moves as cloudState, through the rooms: the cloud on (7, 7) hides (9, 9)
// and (6, 6), and (10, 10) and (5, 5) stay in the open.
function playCloudRooms({ relay }) {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const hostTransport = network.connect();
  if (relay) hostTransport.reachesSpectators = true;
  const makeGame = () => newGame({ characters: assignSides([CLOUD_EAGLE, EARTH_BEAR]) });
  const host = createHostRoom({ transport: hostTransport, code: 'AB2C9', clock, id: 'host', makeGame });
  const guestTransport = network.connect();
  const guest = createGuestRoom({ transport: guestTransport, code: 'AB2C9', clock, id: 'guest' });
  pickAndReady(host, guest);
  assert.equal(host.phase, PLAYING);
  ok(host.place(10, 10));
  ok(guest.place(0, 0));
  ok(host.place(5, 5));
  ok(guest.place(0, 2));
  ok(host.useSkill(CLOUD, { x: 7, y: 7 }));
  ok(host.place(9, 9));
  ok(guest.place(0, 4));
  ok(host.place(6, 6));
  const guestBound = () => hostTransport.sent.filter((m) => m.spectatorsOnly !== true);
  const sentOfType = (type) => guestBound().filter((m) => m.type === type);
  return { clock, host, guest, hostTransport, guestTransport, guestBound, sentOfType };
}

// What a state of a guest-bound message may tell of the four seeds.
function assertEdgesHidden(message) {
  const what = `${message.type} ${JSON.stringify(message).slice(0, 100)}`;
  const board = message.state.board;
  assert.equal(board[9][9], TAKEN, `${what}: (9, 9)`);
  assert.equal(board[6][6], TAKEN, `${what}: (6, 6)`);
  assert.equal(board[10][10], X, `${what}: (10, 10) is in the open`);
  assert.equal(board[5][5], X, `${what}: (5, 5) is in the open`);
  assert.deepEqual(message.state.covered, COVERED, `${what}: the covered list`);
}

for (const relay of [false, true]) {
  const over = relay ? ' (relay)' : '';

  test(`host messages${over}: state, welcome and start hide the 4 by 4 area and nothing more`, () => {
    const ctx = playCloudRooms({ relay });
    ctx.guestTransport.send({ type: 'join', from: 'guest' }); // the host answers with welcome and start
    for (const type of ['state', 'welcome', 'start']) {
      const messages = ctx.sentOfType(type);
      assert.ok(messages.length > 0, `a ${type} message was sent`);
      const last = messages.at(-1);
      assert.equal(last.masked, true, `${type} is the masked copy`);
      assertEdgesHidden(last);
    }
    // No state message tells where a seed under the cloud was planted; the two in the open are told.
    const placed = ctx.sentOfType('state').flatMap((m) => m.events.filter((e) => e.type === 'stonePlaced')).map(key);
    assert.deepEqual(placed.filter((c) => c === '9,9' || c === '6,6'), []);
    assert.ok(placed.includes('10,10') && placed.includes('5,5'));
    assert.equal(ctx.guest.state.board[9][9], TAKEN);
    assert.equal(ctx.host.state.board[9][9], X, 'the host keeps the true state');
    if (relay) {
      const full = ctx.hostTransport.sent.filter((m) => m.spectatorsOnly === true).at(-1);
      assert.equal(full.state.board[9][9], X, 'the spectators get the full state');
      assert.equal(full.state.covered, undefined);
    } else {
      assert.equal(ctx.hostTransport.sent.some((m) => m.spectatorsOnly === true), false);
    }
  });

  test(`host messages${over}: a ping and a refusal tell nothing of the area`, () => {
    const ctx = playCloudRooms({ relay });
    ctx.clock.advance(PEER_TIMEOUT_MS / 2);
    const pings = ctx.sentOfType('ping');
    assert.ok(pings.length > 0);
    for (const ping of pings) assert.equal(JSON.stringify(ping).includes('"state"'), false, 'a ping carries no board');
    const rejected = [];
    ctx.guest.onEvent((e) => e.type === 'rejected' && rejected.push(e.error));
    ctx.guest.place(9, 9); // a hidden seed of X: the guest only knows the plot is taken
    ctx.guest.place(10, 10); // a seed in the open: taken as well
    assert.deepEqual(rejected, ['That cell is not empty.', 'That cell is not empty.']);
    for (const message of ctx.sentOfType('rejected')) assert.equal(JSON.stringify(message).includes('"x"'), false, 'a refusal names no cell');
  });
}

test('each message type that carries a state masks the 4 by 4 area, the rest go out unchanged', () => {
  const state = cloudState();
  for (const type of ['state', 'welcome', 'start', 'new-game']) {
    const message = { type, to: 'guest', state, events: [], seq: 5, round: 1, from: 'host' };
    const [guestCopy, spectators, ...rest] = hostStateMessages(message, O, true);
    assert.deepEqual(rest, []);
    assert.equal(guestCopy.masked, true, type);
    assertEdgesHidden(guestCopy);
    assert.equal(spectators.spectatorsOnly, true);
    assert.equal(spectators.state.board[9][9], X, `${type}: the spectators' copy is the full state`);
  }
  for (const type of ['ping', 'rejected', 'seats', 'rematch-status']) {
    const message = { type, to: 'guest', seq: 5, from: 'host' };
    assert.deepEqual(hostStateMessages(message, O, true, state), [message], `${type} has no cell`);
  }
});

// --- the local view ---

test('local mode: the area is covered while the other seat moves, the owner sees everything', () => {
  const state = cloudState();
  assert.equal(state.currentPlayer, O);
  const seen = localViewState(state);
  assert.deepEqual(seen.covered, COVERED);
  assert.equal(seen.board[9][9], TAKEN);
  assert.equal(seen.board[6][6], TAKEN);
  assert.equal(seen.board[10][10], X);
  assert.equal(seen.board[5][5], X);
  // The events of the owner's move under the cloud: the other seat sees none of them.
  const events = [{ type: 'stonePlaced', player: X, x: 6, y: 6 }, { type: 'stonePlaced', player: X, x: 5, y: 5 }, { type: 'turnEnded', player: X, turn: 7 }];
  assert.deepEqual(localViewEvents(state, events), [events[1], events[2]]);

  const game = createLocalGame({ makeGame: () => cloudState() });
  assert.equal(game.getView().state.board[9][9], TAKEN);
  assert.equal(game.click({ x: 0, y: 6 }), true); // O plays far from the cloud
  assert.equal(game.getState().currentPlayer, X);
  assert.equal(game.getView().state.board[9][9], X, "on the owner's turn nothing is covered");
  assert.equal(localViewState(game.getState()), game.getState());
});

// --- the owner's turns ---

test('the cloud lasts CLOUD_TURNS turns of its owner, covering the same 4 by 4 cells until it ends', () => {
  let state = ok(useSkill(eagleGame(), { player: X, skill: CLOUD, target: { x: 7, y: 7 } })).state;
  state = place(state, X, 14, 0); // the cast turn ends: it does not count
  assert.equal(state.clouds[0].turnsLeft, CLOUD_TURNS);
  state = place(state, O, 0, 0); // an opponent turn does not count
  assert.equal(state.clouds[0].turnsLeft, CLOUD_TURNS);
  assert.deepEqual(coveredCells(state, O), COVERED);
  state = place(state, X, 14, 2); // the owner's first turn
  assert.equal(state.clouds[0].turnsLeft, CLOUD_TURNS - 1);
  assert.deepEqual(coveredCells(state, O), COVERED, 'the area does not shrink');
  state = place(state, O, 0, 2);
  const ended = ok(placeStone(state, { player: X, x: 14, y: 4 })); // the owner's second turn
  assert.deepEqual(ended.state.clouds, []);
  assert.deepEqual(ended.events.filter((e) => e.type === 'cloudEnded'), [{ type: 'cloudEnded', player: X, x: 7, y: 7 }], 'it ends on the chosen cell');
  assert.deepEqual(coveredCells(ended.state, O), []);
  assert.equal(maskForViewer(ended.state, O), ended.state);
});

// --- Sky Watch with a sunk seed ---

test('Sky Watch: a seed sunk in mud counts for nobody, then for its owner once it surfaces', () => {
  let state = eagleGame();
  state = place(state, X, 14, 0);
  state = place(state, O, 3, 5);
  state = place(state, X, 14, 2);
  state = place(state, O, 4, 5);
  state = place(state, X, 14, 4);
  // O floods (5, 5) and plants on it: the seed sinks.
  const mud = ok(useSkill(state, { player: O, skill: MUD_TRAP, target: { x: 5, y: 5 } }));
  state = ok(placeStone(mud.state, { player: O, x: 5, y: 5 })).state;
  assert.equal(state.board[5][5], O, 'the cell holds the stone');
  assert.equal(state.sunk.length, 1);
  assert.deepEqual(skyWatchCells(state, X), [], 'two plants and a sunk seed: no run of four is one plant away');
  // The same board with the seed counted would mark both ends.
  assert.deepEqual(skyWatchCells({ ...state, sunk: [] }, X), [{ x: 2, y: 5 }, { x: 6, y: 5 }]);
  // The sunk seed also breaks a longer line.
  const board = state.board.map((row) => row.slice());
  for (const x of [6, 7]) board[5][x] = O;
  assert.deepEqual(skyWatchCells({ ...state, board }, X), [], 'the sunk seed splits (3, 5)-(4, 5) from (6, 5)-(7, 5)');
  // X plants: the seed surfaces at the end of this opponent turn and counts again.
  state = place(state, X, 14, 6);
  assert.equal(state.sunk.length, 0);
  assert.deepEqual(skyWatchCells(state, X), [{ x: 2, y: 5 }, { x: 6, y: 5 }]);
});

// --- the preview and the texts ---

test('the Cloud preview shows the cells the cloud will cover, clipped like the skill', () => {
  const state = eagleGame();
  const targeting = startTargeting(CLOUD);
  const last = BOARD_SIZE - 1;
  for (const [x, y] of [[7, 7], [0, 0], [last, last], [0, last], [last, 0], [7, 0], [7, last], [0, 7], [last, 7], [1, 1]]) {
    const preview = targetPreview(state, X, targeting, { x, y });
    assert.equal(preview.type, 'cloud');
    assert.deepEqual([preview.x, preview.y], [x, y]);
    assert.deepEqual(preview.cells, cloudCells(BOARD, createCloud(x, y, X, 1)), `(${x}, ${y})`);
    const cast = ok(useSkill(state, { player: X, skill: CLOUD, target: { x, y } }));
    assert.deepEqual(preview.cells, cast.events.find((e) => e.type === 'cloudPlaced').cells, `(${x}, ${y}): the preview is the cast area`);
  }
  assert.deepEqual(targetPreview(state, X, targeting, { x: 7, y: 7 }).cells, rect(6, 6, 9, 9));
  assert.equal(targetPreview(state, X, targeting, null), null);
  assert.equal(targetPreview(state, X, targeting, { x: -1, y: 3 }), null);
});

test('the texts name the size from the constants and no longer a centre cell', () => {
  const { lo, hi } = cloudReach(CLOUD_SIZE);
  const text = SKILL_INFO[CLOUD].description;
  assert.ok(text.includes(`${CLOUD_SIZE} by ${CLOUD_SIZE} cloud`), text);
  assert.ok(text.includes(`${lo} plot up and left`), text);
  assert.ok(text.includes(`${hi} plots down and right`), text);
  assert.equal(/centre/i.test(text), false, 'a 4 by 4 cloud has no centre');
  assert.equal(/centre/i.test(SKILL_INFO[CLOUD].hint), false);
  assert.equal(/centre/i.test(STRINGS.cloudTargetPrompt), false);
});
