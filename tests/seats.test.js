// The seats of the character select (src/logic/seats.js, docs/flow-design.md
// sections 3.5 and 5): pick order gives the sides, a taken character is
// refused, Ready needs a pick and locks it, an emptied seat loses its place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { O, X } from '../src/logic/board.js';
import { EARTH_BEAR, JADE_SERPENT, WIND_RABBIT } from '../src/logic/characters.js';
import {
  SEAT_REJECT, bothReady, clearSeat, createSeats, isSeats, pickCharacter, seatOf, seatSides, seatStone, setReady,
} from '../src/logic/seats.js';

const NAMES = ['a', 'b'];
const pick = (seats, seat, character) => {
  const result = pickCharacter(seats, seat, character);
  assert.equal(result.ok, true, `${seat} picks ${character}`);
  return result.seats;
};
const ready = (seats, seat) => {
  const result = setReady(seats, seat);
  assert.equal(result.ok, true, `${seat} Ready`);
  return result.seats;
};

test('two empty seats, frozen', () => {
  const seats = createSeats(NAMES);
  assert.deepEqual(JSON.parse(JSON.stringify(seats)), { names: NAMES, picks: { a: null, b: null }, ready: { a: false, b: false }, order: [] });
  for (const part of [seats, seats.names, seats.picks, seats.ready, seats.order]) assert.ok(Object.isFrozen(part));
  assert.equal(bothReady(seats), false);
  assert.equal(seatStone(seats, 'a'), null);
});

test('the first pick gets X and the second gets O, whichever seat picks first', () => {
  let seats = pick(createSeats(NAMES), 'b', JADE_SERPENT);
  seats = pick(seats, 'a', WIND_RABBIT);
  assert.equal(seatStone(seats, 'b'), X);
  assert.equal(seatStone(seats, 'a'), O);
  assert.deepEqual(seatSides(seats), { [X]: JADE_SERPENT, [O]: WIND_RABBIT });
  assert.equal(seatOf(seats, JADE_SERPENT), 'b');
  assert.equal(seatOf(seats, EARTH_BEAR), null);
});

test('a seat may change its pick before Ready and keeps its place in the order', () => {
  let seats = pick(createSeats(NAMES), 'a', WIND_RABBIT);
  seats = pick(seats, 'b', EARTH_BEAR);
  const changed = pick(seats, 'a', JADE_SERPENT);
  assert.deepEqual([...changed.order], ['a', 'b']);
  assert.deepEqual(seatSides(changed), { [X]: JADE_SERPENT, [O]: EARTH_BEAR });
  assert.equal(pickCharacter(changed, 'a', JADE_SERPENT).seats, changed, 'the same pick changes nothing');
});

test('a taken character, an unknown character or seat, and a pick after Ready are refused', () => {
  const seats = pick(createSeats(NAMES), 'a', WIND_RABBIT);
  assert.deepEqual(pickCharacter(seats, 'b', WIND_RABBIT), { ok: false, error: 'That character is taken.', reason: SEAT_REJECT.TAKEN });
  assert.equal(pickCharacter(seats, 'b', 'nobody').reason, SEAT_REJECT.UNKNOWN_CHARACTER);
  assert.equal(pickCharacter(seats, 'c', EARTH_BEAR).reason, SEAT_REJECT.UNKNOWN_SEAT);
  const locked = ready(seats, 'a');
  assert.equal(pickCharacter(locked, 'a', EARTH_BEAR).reason, SEAT_REJECT.READY);
  assert.equal(seats.picks.b, null, 'nothing changed');
  assert.deepEqual(pickCharacter(locked, 'a', WIND_RABBIT), { ok: true, seats: locked }, 'a repeat of the own pick after Ready is not refused');
});

test('Ready needs a pick; both Ready means the game may start', () => {
  let seats = createSeats(NAMES);
  assert.equal(setReady(seats, 'a').reason, SEAT_REJECT.NO_PICK);
  assert.equal(setReady(seats, 'c').reason, SEAT_REJECT.UNKNOWN_SEAT);
  seats = pick(seats, 'a', WIND_RABBIT);
  seats = ready(seats, 'a');
  assert.equal(setReady(seats, 'a').seats, seats, 'Ready twice changes nothing');
  assert.equal(bothReady(seats), false);
  seats = pick(seats, 'b', EARTH_BEAR);
  assert.equal(bothReady(seats), false);
  seats = ready(seats, 'b');
  assert.equal(bothReady(seats), true);
});

test('a Ready for a named pick is refused when the seat holds another one', () => {
  const seats = pick(createSeats(NAMES), 'a', WIND_RABBIT);
  assert.deepEqual(setReady(seats, 'a', EARTH_BEAR), { ok: false, error: 'Your pick was not taken; press Ready again.', reason: SEAT_REJECT.PICK_CHANGED });
  assert.equal(setReady(seats, 'a', WIND_RABBIT).seats.ready.a, true);
  assert.equal(setReady(createSeats(NAMES), 'a', WIND_RABBIT).reason, SEAT_REJECT.NO_PICK);
});

test('an emptied seat loses its pick, its Ready and its place; the other pick becomes the first', () => {
  let seats = pick(createSeats(NAMES), 'b', WIND_RABBIT);
  seats = pick(seats, 'a', EARTH_BEAR);
  seats = ready(seats, 'b');
  seats = ready(seats, 'a');
  const emptied = clearSeat(seats, 'b');
  assert.deepEqual(JSON.parse(JSON.stringify(emptied)), {
    names: NAMES, picks: { a: EARTH_BEAR, b: null }, ready: { a: true, b: false }, order: ['a'],
  });
  assert.equal(seatStone(emptied, 'a'), X);
  assert.equal(clearSeat(emptied, 'c'), emptied);
  assert.equal(pickCharacter(emptied, 'b', WIND_RABBIT).ok, true, 'the character is free again');
});

test('isSeats checks seats that come from the other window', () => {
  const seats = pick(createSeats(NAMES), 'a', WIND_RABBIT);
  assert.equal(isSeats(JSON.parse(JSON.stringify(seats)), NAMES), true);
  assert.equal(isSeats(seats, ['x', 'y']), false);
  assert.equal(isSeats(null, NAMES), false);
  assert.equal(isSeats({ ...seats, picks: { a: 'nobody', b: null } }, NAMES), false);
  assert.equal(isSeats({ ...seats, order: ['b'] }, NAMES), false, 'an order seat must have a pick');
  assert.equal(isSeats({ ...seats, ready: { a: 'yes', b: false } }, NAMES), false);
});
