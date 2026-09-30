// Leave detection (docs/design.md section 6) as pure timing logic. A
// presence record tracks one peer; every function takes the current time
// in milliseconds and returns a new record, so tests need no timers.
//
// The leave countdown starts when nothing has been heard from the peer for
// PEER_TIMEOUT_MS, or at once when a "leave" message arrives. Hearing from
// the peer again cancels it. When it reaches 0 the peer is gone for good.

import { LEAVE_COUNTDOWN_S, PEER_TIMEOUT_MS } from '../config.js';

export const CONNECTED = 'connected';
export const COUNTDOWN = 'countdown';
export const GONE = 'gone';

const DEFAULTS = { timeoutMs: PEER_TIMEOUT_MS, countdownS: LEAVE_COUNTDOWN_S };

export function createPresence(now) {
  return { lastHeardAt: now, leftAt: null, goneAt: null };
}

// Any message from the peer.
export function markHeard(presence, now) {
  if (presence.goneAt !== null) return presence;
  return { ...presence, lastHeardAt: Math.max(presence.lastHeardAt, now), leftAt: null };
}

// A "leave" message from the peer.
export function markLeft(presence, now) {
  if (presence.goneAt !== null || presence.leftAt !== null) return presence;
  return { ...presence, leftAt: now };
}

// Time the countdown started, or null if it is not running.
export function countdownStart(presence, now, options = {}) {
  const { timeoutMs } = { ...DEFAULTS, ...options };
  const silentSince = presence.lastHeardAt + timeoutMs;
  const starts = [presence.leftAt, now >= silentSince ? silentSince : null].filter((t) => t !== null);
  return starts.length > 0 ? Math.min(...starts) : null;
}

// Where the peer stands at time now: { presence, status, secondsLeft }.
// status is CONNECTED, COUNTDOWN (secondsLeft counts down from countdownS
// to 1) or GONE. The returned presence remembers GONE, so later messages
// cannot bring the peer back.
export function checkPresence(presence, now, options = {}) {
  const { countdownS } = { ...DEFAULTS, ...options };
  if (presence.goneAt !== null) return { presence, status: GONE, secondsLeft: 0 };
  const start = countdownStart(presence, now, options);
  if (start === null) return { presence, status: CONNECTED, secondsLeft: null };
  const endsAt = start + countdownS * 1000;
  if (now >= endsAt) return { presence: { ...presence, goneAt: endsAt }, status: GONE, secondsLeft: 0 };
  return { presence, status: COUNTDOWN, secondsLeft: Math.ceil((endsAt - now) / 1000) };
}
