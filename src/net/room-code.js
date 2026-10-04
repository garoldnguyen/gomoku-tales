// Room codes (docs/design.md section 6): ROOM_CODE_LENGTH characters of
// uppercase letters and digits, leaving out the easily confused 0, O, 1
// and I.

import { ROOM_CODE_LENGTH } from '../config.js';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// random returns a number in [0, 1), like Math.random.
export function generateRoomCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const index = Math.min(ROOM_CODE_ALPHABET.length - 1, Math.floor(random() * ROOM_CODE_ALPHABET.length));
    code += ROOM_CODE_ALPHABET[index];
  }
  return code;
}

// Typed input to code form (docs/flow-design.md section 3.4): upper case,
// every character that is not in ROOM_CODE_ALPHABET removed (so spaces,
// dashes and the confusing 0, O, 1 and I vanish), cut to ROOM_CODE_LENGTH.
export function normalizeRoomCode(input) {
  const kept = [...String(input ?? '').toUpperCase()].filter((char) => ROOM_CODE_ALPHABET.includes(char));
  return kept.slice(0, ROOM_CODE_LENGTH).join('');
}

export function isValidRoomCode(code) {
  if (typeof code !== 'string' || code.length !== ROOM_CODE_LENGTH) return false;
  return [...code].every((char) => ROOM_CODE_ALPHABET.includes(char));
}
