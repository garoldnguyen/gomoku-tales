// Limits of the relay server (docs/deploy.md). The numbers live in
// src/config.js and are re-exported here, so no number is typed twice;
// tests/worker.test.js checks that both match.

import {
  MAX_FRAME_BYTES,
  MAX_FRAMES_PER_SECOND,
  SPECTATOR_LIMIT,
  EMPTY_ROOM_CLEANUP_MS,
} from '../src/config.js';

export { MAX_FRAME_BYTES, MAX_FRAMES_PER_SECOND, SPECTATOR_LIMIT, EMPTY_ROOM_CLEANUP_MS };

export const LIMITS = Object.freeze({
  MAX_FRAME_BYTES,
  MAX_FRAMES_PER_SECOND,
  SPECTATOR_LIMIT,
  EMPTY_ROOM_CLEANUP_MS,
});
