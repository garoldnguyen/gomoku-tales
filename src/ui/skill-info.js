// What each skill does, in words (docs/art-direction-v3-1.md section 4.3):
// ONE table, the single source of the skill descriptions and hints. The
// skill detail popup, the shared tooltip and the aria-labels read it through
// hudViewModel (hud-view.js). Numbers in the text come from the game config
// constants, never from the strings themselves. Pure (no DOM).
//
// The draft wording of the doc was checked against the rules (src/logic and
// docs/design.md section 5) and changed where it said something the game
// does not do: Wind Dash lands only after the opponent's next turn and only
// on a plot that is still empty, Tornado Zone throws only the seed the
// opponent plants inside it on that turn, Terrain Creation needs an empty
// plot, and Stone Conversion takes only an opponent's plant (only Earth
// Bear, who plays O in the two character lobby, has it, so it only ever
// turns X into O there). Venom also takes only an opponent's plant.

import { CLOUD_SIZE, CLOUD_TURNS, ROCK_LIFETIME_TURNS, TORNADO_SIZE } from '../config.js';
import {
  CLOUD, HISS, SKY_WATCH, STONE_CONVERSION, TERRAIN_CREATION, TORNADO_ZONE, VENOM, WIND_DASH, getSkill,
} from '../logic/skills.js';

const info = (skillId, description, hint) => Object.freeze({ title: getSkill(skillId).name, description, hint });

export const SKILL_INFO = Object.freeze({
  [WIND_DASH]: info(
    WIND_DASH,
    'Pick one of your plants, then an empty target plot. After the opponent\'s next turn, the plant folds back into a seed, rides a gust of petals to the target and grows again there, if it is still yours and the plot is still empty.',
    'Click to select, then choose a plot',
  ),
  [TORNADO_ZONE]: info(
    TORNADO_ZONE,
    `Pick the centre of a ${TORNADO_SIZE} by ${TORNADO_SIZE} zone. On the opponent's next turn, a swirl of petals and leaves throws a seed they plant inside off its plot.`,
    'Click to select, then choose the zone centre',
  ),
  [TERRAIN_CREATION]: info(
    TERRAIN_CREATION,
    `Drops a rock on an empty plot. The rock stays for ${ROCK_LIFETIME_TURNS} turns, then crumbles back into plain soil.`,
    'Click to select, then choose a plot',
  ),
  [STONE_CONVERSION]: info(
    STONE_CONVERSION,
    'Pick one of the opponent\'s plants. It wilts and regrows as your plant: X becomes O.',
    'Click to select, then choose a plant',
  ),
  [HISS]: info(
    HISS,
    'A warning hiss. On their next turn the opponent cannot use a skill, but they can still plant a seed.',
    'Click to select, no target needed',
  ),
  [VENOM]: info(
    VENOM,
    'Pick one of the opponent\'s plants. It withers and its plot is left empty. Rocks cannot be picked.',
    'Click to select, then choose a plant',
  ),
  [SKY_WATCH]: info(
    SKY_WATCH,
    'Always on. Soft yellow outlines show every empty plot where the opponent would make five in a row with one more plant.',
    'Always on, nothing to click',
  ),
  [CLOUD]: info(
    CLOUD,
    `Pick the centre of a ${CLOUD_SIZE} by ${CLOUD_SIZE} cloud on any plot. For your next ${CLOUD_TURNS} turns the opponent cannot see the plants or rocks under it; you still can. It plants no seed.`,
    'Click to select, then choose the cloud centre',
  ),
});

// The entry of a skill id, or null.
export function skillInfo(skillId) {
  return Object.hasOwn(SKILL_INFO, skillId) ? SKILL_INFO[skillId] : null;
}
