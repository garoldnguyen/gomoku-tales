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
// opponent plants inside it on that turn, Mud Trap needs an empty plot that
// is not mud already, and Petrification takes only an opponent's plant that
// is not sunk in mud. Venom also takes only an opponent's plant.

import {
  CLOUD_SIZE, CLOUD_TURNS, MUD_LIFETIME_TURNS, MUD_SINK_TURNS, SKY_WATCH_RUN, TORNADO_ARM, TORNADO_TURNS, WIND_DASH_RANGE,
} from '../config.js';
import {
  CLOUD, HISS, MUD_TRAP, PETRIFICATION, SKY_WATCH, TORNADO_ZONE, VENOM, WIND_DASH, getSkill,
} from '../logic/skills.js';

const turns = (count) => `${count} ${count === 1 ? 'turn' : 'turns'}`;
const plots = (count) => `${count} ${count === 1 ? 'plot' : 'plots'}`;
const info = (skillId, description, hint) => Object.freeze({ title: getSkill(skillId).name, description, hint });

export const SKILL_INFO = Object.freeze({
  [WIND_DASH]: info(
    WIND_DASH,
    `Pick one of your plants, then an empty target plot up to ${plots(WIND_DASH_RANGE)} away, diagonals included. After the opponent's next turn, the plant folds back into a seed, rides a gust of petals to the target and grows again there, if it is still yours and the plot is still empty. It cannot land on mud.`,
    'Click to select, then choose a plot',
  ),
  [TORNADO_ZONE]: info(
    TORNADO_ZONE,
    `Secretly pick the centre of a cross of ${plots(4 * TORNADO_ARM + 1)}: that plot and ${plots(TORNADO_ARM)} up, down, left and right of it, cut at the edge of the field. Your opponent never sees it. It is armed when this turn ends and waits for ${turns(TORNADO_TURNS)}. The first seed anyone plants on the cross, yours too, fires it: a dandelion storm throws that seed to a free plot next to it and the trap is used up.`,
    'Click to select, then choose the trap centre',
  ),
  [MUD_TRAP]: info(
    MUD_TRAP,
    `Turns an empty plot into a mud puddle. The puddle stays for ${turns(MUD_LIFETIME_TURNS)}, then dries. A seed planted in it sinks: it counts for no line for ${turns(MUD_SINK_TURNS)}, then it surfaces and counts again.`,
    'Click to select, then choose a plot',
  ),
  [PETRIFICATION]: info(
    PETRIFICATION,
    'Pick one of the opponent\'s plants. It turns to stone: a rock that stays for good and breaks every line. A seed sunk in mud cannot be picked.',
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
    `Always on. Glowing plots with a little cloud show every empty plot where the opponent would make ${SKY_WATCH_RUN} or more in a row with one more plant, so you see a three before it becomes a four.`,
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
