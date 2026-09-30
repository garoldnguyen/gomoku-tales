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

// Typed input to code form: spaces removed, upper case.
export function normalizeRoomCode(input) {
  return String(input ?? '').replace(/\s+/g, '').toUpperCase();
}

export function isValidRoomCode(code) {
  if (typeof code !== 'string' || code.length !== ROOM_CODE_LENGTH) return false;
  return [...code].every((char) => ROOM_CODE_ALPHABET.includes(char));
}
