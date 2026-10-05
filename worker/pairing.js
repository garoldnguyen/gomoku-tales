// Pure rules of the relay server (docs/deploy.md): who may join a room,
// which frames are accepted and what a new spectator is replayed. No
// Cloudflare or WebSocket APIs, so node --test runs them.

import { isValidRoomCode } from '../src/net/room-code.js';
import { ROLES, ROLE_HOST, ROLE_GUEST, ROLE_SPECTATOR } from '../src/net/ws-transport.js';
import { LIMITS } from './limits.js';

export const JOIN_ACCEPT = 'accept';
export const JOIN_FULL = 'full'; // the guest seat is taken, or the spectator limit is reached
export const JOIN_NO_ROOM = 'noRoom'; // a guest or spectator came, but no host is there
export const JOIN_TAKEN = 'taken'; // a second host for the same code

export const FRAME_OK = 'ok';
export const FRAME_TOO_LARGE = 'too-large';
export const FRAME_TOO_FAST = 'too-fast';
export const FRAME_BAD_JSON = 'bad-json';

// The host messages a new spectator is replayed, last one of each type, in
// this order.
export const SNAPSHOT_TYPES = Object.freeze(['seats', 'state', 'start', 'result', 'new-game', 'rematch-status']);

// The /ws query: { ok: true, room, role }, or { ok: false, status } with
// the HTTP status to refuse with. The room code must be ROOM_CODE_LENGTH
// characters of ROOM_CODE_ALPHABET.
export function parseRelayQuery(searchParams) {
  const room = searchParams.get('room');
  const role = searchParams.get('role');
  if (!isValidRoomCode(room)) return { ok: false, status: 400, reason: 'bad room code' };
  if (!ROLES.includes(role)) return { ok: false, status: 400, reason: 'bad role' };
  return { ok: true, room, role };
}

// current is { host: boolean, guest: boolean, spectators: number }.
export function decideJoin(current, role, limits = LIMITS) {
  const host = Boolean(current?.host);
  const guest = Boolean(current?.guest);
  const spectators = current?.spectators ?? 0;
  if (role === ROLE_HOST) return host ? JOIN_TAKEN : JOIN_ACCEPT;
  if (!host) return JOIN_NO_ROOM;
  if (role === ROLE_GUEST) return guest ? JOIN_FULL : JOIN_ACCEPT;
  if (role === ROLE_SPECTATOR) return spectators >= limits.SPECTATOR_LIMIT ? JOIN_FULL : JOIN_ACCEPT;
  return JOIN_NO_ROOM;
}

function byteLength(raw) {
  if (typeof raw === 'string') return new TextEncoder().encode(raw).length;
  return raw?.byteLength ?? 0;
}

// raw is the frame as received (text, or an ArrayBuffer for a binary
// frame). limits holds MAX_FRAME_BYTES and MAX_FRAMES_PER_SECOND, plus
// framesThisSecond: the frames of this socket in the current second,
// this one included (see countFrame). Checked in this order: size, rate,
// then the frame must be JSON text of an object with a string type.
export function checkFrame(raw, limits) {
  if (byteLength(raw) > limits.MAX_FRAME_BYTES) return FRAME_TOO_LARGE;
  if ((limits.framesThisSecond ?? 0) > limits.MAX_FRAMES_PER_SECOND) return FRAME_TOO_FAST;
  if (typeof raw !== 'string') return FRAME_BAD_JSON;
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return FRAME_BAD_JSON;
  }
  if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') return FRAME_BAD_JSON;
  return FRAME_OK;
}

// Counts one frame at time now (ms) into a socket's rate window
// { start, count }, which restarts once a second has passed. Changes and
// returns window.
export function countFrame(window, now) {
  if (now - window.start >= 1000 || now < window.start) {
    window.start = now;
    window.count = 0;
  }
  window.count += 1;
  return window;
}

// store maps a message type to the text of the last host message of that
// type. Returns the texts of SNAPSHOT_TYPES present, in that order.
export function snapshotFor(store) {
  const list = [];
  for (const type of SNAPSHOT_TYPES) {
    if (store && typeof store[type] === 'string') list.push(store[type]);
  }
  return list;
}
