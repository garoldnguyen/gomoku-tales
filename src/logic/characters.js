// The two characters (docs/design.md section 5). Each character plays one
// stone colour and owns two skills.

import { X, O } from './board.js';
import { WIND_DASH, TORNADO_ZONE, TERRAIN_CREATION, STONE_CONVERSION } from './skills.js';

export const WIND_RABBIT = 'windRabbit';
export const EARTH_BEAR = 'earthBear';

export const CHARACTERS = {
  [WIND_RABBIT]: { id: WIND_RABBIT, name: 'Wind Rabbit', stone: X, skills: [WIND_DASH, TORNADO_ZONE] },
  [EARTH_BEAR]: { id: EARTH_BEAR, name: 'Earth Bear', stone: O, skills: [TERRAIN_CREATION, STONE_CONVERSION] },
};

export function characterForStone(stone) {
  return Object.values(CHARACTERS).find((character) => character.stone === stone) ?? null;
}
