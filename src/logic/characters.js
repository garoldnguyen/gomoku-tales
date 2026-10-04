// The three characters (docs/design.md section 5). Each character owns two
// skills. A character has no fixed stone colour: the side is decided by
// pick order (assignSides), the first pick plays X and moves first.

import { X, O } from './board.js';
import { WIND_DASH, TORNADO_ZONE, TERRAIN_CREATION, STONE_CONVERSION, HISS, VENOM } from './skills.js';

export const WIND_RABBIT = 'windRabbit';
export const EARTH_BEAR = 'earthBear';
export const JADE_SERPENT = 'jadeSerpent';

export const CHARACTERS = {
  [WIND_RABBIT]: { id: WIND_RABBIT, name: 'Wind Rabbit', skills: [WIND_DASH, TORNADO_ZONE] },
  [EARTH_BEAR]: { id: EARTH_BEAR, name: 'Earth Bear', skills: [TERRAIN_CREATION, STONE_CONVERSION] },
  [JADE_SERPENT]: { id: JADE_SERPENT, name: 'Jade Serpent', skills: [HISS, VENOM] },
};

// The side that moves first.
export const FIRST_PLAYER = X;

// Sides by pick order: pickOrder = [first pick, second pick] of two
// different characters. The first pick plays X (and moves first), the
// second plays O. Returns { X: characterId, O: characterId }.
export function assignSides(pickOrder) {
  const [first, second] = pickOrder ?? [];
  for (const id of [first, second]) {
    if (!Object.hasOwn(CHARACTERS, id)) throw new Error(`Unknown character: ${id}`);
  }
  if (first === second) throw new Error('Both players picked the same character.');
  return { [X]: first, [O]: second };
}

// The sides of the two character lobby, which has no pick order yet: Wind
// Rabbit plays X and Earth Bear plays O. Used wherever no sides are given.
export const DEFAULT_SIDES = Object.freeze(assignSides([WIND_RABBIT, EARTH_BEAR]));

export function characterForStone(stone, sides = DEFAULT_SIDES) {
  const id = sides && Object.hasOwn(sides, stone) ? sides[stone] : null;
  return id && Object.hasOwn(CHARACTERS, id) ? CHARACTERS[id] : null;
}

// The stone (X or O) the character plays with the given sides, or null.
export function stoneForCharacter(characterId, sides = DEFAULT_SIDES) {
  if (sides?.[X] === characterId) return X;
  if (sides?.[O] === characterId) return O;
  return null;
}
