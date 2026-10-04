// The two seats of the character select (docs/flow-design.md sections 3.5
// and 5). Pure (no DOM): the online host (net/room.js) and the local
// character select (ui/flow.js) use the same rules.
//
// A seat picks a character and then presses Ready. A character picked by
// one seat is taken for the other. The first seat to pick plays X and
// moves first, the second plays O (assignSides). A seat may change its
// pick until it is Ready; it keeps its place in the pick order. A repeat
// of the seat's own pick changes nothing and is never refused, even after
// Ready (the guest sends a pick again when a host ping looks older). Ready
// needs a pick and holds until the game starts. When a seat is emptied
// (the guest left) it loses its pick, its Ready and its place in the order.
//
// Seats are frozen plain objects (they travel in room messages):
//   { names: [a, b], picks: { a: id|null, b: id|null }, ready: { a: bool, b: bool }, order: [seat names by first pick] }

import { O, X } from './board.js';
import { CHARACTERS, assignSides } from './characters.js';

// Why a pick or a Ready was refused (reason of a rejected result).
export const SEAT_REJECT = Object.freeze({
  UNKNOWN_SEAT: 'unknown-seat',
  UNKNOWN_CHARACTER: 'unknown-character',
  TAKEN: 'taken',
  READY: 'ready',
  NO_PICK: 'no-pick',
  PICK_CHANGED: 'pick-changed',
});

const ERRORS = Object.freeze({
  [SEAT_REJECT.UNKNOWN_SEAT]: 'There is no such seat.',
  [SEAT_REJECT.UNKNOWN_CHARACTER]: 'There is no such character.',
  [SEAT_REJECT.TAKEN]: 'That character is taken.',
  [SEAT_REJECT.READY]: 'You are ready; the pick is locked.',
  [SEAT_REJECT.NO_PICK]: 'Pick a character first.',
  [SEAT_REJECT.PICK_CHANGED]: 'Your pick was not taken; press Ready again.',
});

// Two empty seats with the given names.
export function createSeats(names) {
  const [a, b] = names;
  return freezeSeats({ names: [a, b], picks: { [a]: null, [b]: null }, ready: { [a]: false, [b]: false }, order: [] });
}

// True if value has the shape of seats with these two names (a message
// from the other window is checked before it is taken).
export function isSeats(value, names) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.names) || !Array.isArray(value.order)) return false;
  if (names && (value.names.length !== 2 || value.names[0] !== names[0] || value.names[1] !== names[1])) return false;
  for (const seat of value.names) {
    const pick = value.picks?.[seat];
    if (pick !== null && !Object.hasOwn(CHARACTERS, pick)) return false;
    if (typeof value.ready?.[seat] !== 'boolean') return false;
  }
  return value.order.every((seat) => value.names.includes(seat) && value.picks[seat] !== null);
}

// The seat that holds character, or null.
export function seatOf(seats, character) {
  return seats.names.find((seat) => seats.picks[seat] === character) ?? null;
}

// The other seat's name.
export function otherSeat(seats, seat) {
  return seats.names[0] === seat ? seats.names[1] : seats.names[0];
}

// Seat picks character. Returns { ok: true, seats } (the same seats when
// nothing changes) or { ok: false, error, reason }.
export function pickCharacter(seats, seat, character) {
  if (!seats.names.includes(seat)) return reject(SEAT_REJECT.UNKNOWN_SEAT);
  if (!Object.hasOwn(CHARACTERS, character)) return reject(SEAT_REJECT.UNKNOWN_CHARACTER);
  if (seats.picks[seat] === character) return { ok: true, seats }; // a repeat
  if (seats.ready[seat]) return reject(SEAT_REJECT.READY);
  if (seats.picks[otherSeat(seats, seat)] === character) return reject(SEAT_REJECT.TAKEN);
  const order = seats.order.includes(seat) ? seats.order : [...seats.order, seat];
  return { ok: true, seats: freezeSeats({ ...seats, picks: { ...seats.picks, [seat]: character }, order }) };
}

// Seat presses Ready. character, when given, is the pick the Ready is
// for: a Ready that reaches the seats after that pick was refused (the
// other seat took the character first) is refused too, so a seat is never
// locked on a character it did not press Ready for. Returns { ok: true,
// seats } or { ok: false, error, reason }.
export function setReady(seats, seat, character = undefined) {
  if (!seats.names.includes(seat)) return reject(SEAT_REJECT.UNKNOWN_SEAT);
  if (seats.picks[seat] === null) return reject(SEAT_REJECT.NO_PICK);
  if (character !== undefined && seats.picks[seat] !== character) return reject(SEAT_REJECT.PICK_CHANGED);
  if (seats.ready[seat]) return { ok: true, seats };
  return { ok: true, seats: freezeSeats({ ...seats, ready: { ...seats.ready, [seat]: true } }) };
}

// The seat is empty again: no pick, not ready, out of the pick order.
export function clearSeat(seats, seat) {
  if (!seats.names.includes(seat)) return seats;
  return freezeSeats({
    ...seats,
    picks: { ...seats.picks, [seat]: null },
    ready: { ...seats.ready, [seat]: false },
    order: seats.order.filter((name) => name !== seat),
  });
}

// True when both seats picked and pressed Ready: the game may start.
export function bothReady(seats) {
  return seats.names.every((seat) => seats.picks[seat] !== null && seats.ready[seat]);
}

// The stone (X or O) of the seat by pick order, or null before it picked.
export function seatStone(seats, seat) {
  const index = seats.order.indexOf(seat);
  return index === 0 ? X : index === 1 ? O : null;
}

// The sides of the game ({ X: characterId, O: characterId }, assignSides):
// the first pick plays X. Only when both seats picked.
export function seatSides(seats) {
  return assignSides(seats.order.map((seat) => seats.picks[seat]));
}

function reject(reason) {
  return { ok: false, error: ERRORS[reason], reason };
}

function freezeSeats({ names, picks, ready, order }) {
  return Object.freeze({
    names: Object.freeze([...names]),
    picks: Object.freeze({ ...picks }),
    ready: Object.freeze({ ...ready }),
    order: Object.freeze([...order]),
  });
}
