// What each skill does, in words (docs/skill-popup-design.md sections 2 and 3):
// ONE table, the single source of the skill texts. The skill popup, the shared
// tooltip, the aria-labels, the first-game hints and the How to Play rows read
// it (hud-view.js, announce.js, menu.js). Numbers in the text come from the
// game config constants, never from the strings themselves. Pure (no DOM).
//
// Each entry is { title, brief, facts, rules, hint, description }:
//   brief  one sentence, at most BRIEF_MAX characters.
//   facts  2 or 3 { label, value }: label at most FACT_LABEL_MAX, value at most
//          FACT_VALUE_MAX characters (the label is upper-cased by CSS).
//   rules  2 to 4 lines of at most RULE_MAX characters, no full stop at the end.
//   hint   how to use it.
//   description  DERIVED from brief and rules (never typed), under
//          DESCRIPTION_MAX characters.
//   turn   { kind, label, text }: how the skill relates to the turn, shown in a
//          small box of the popup and the tooltip. Every active skill is a FREE
//          ACTION (docs/free-action-design.md: using it never ends the turn,
//          only planting a seed does); the passive Sky Watch never uses a turn.
//          DERIVED from isPassiveSkill, never typed per skill.
//
// The draft wording of the doc was checked against the rules (src/logic and
// docs/design.md section 5) and changed where it said something the game
// does not do: Wind Dash lands only after the opponent's next turn, only on a
// plot that is still empty, not mud and not poisoned, and never moves a plant
// sunk in mud; the Tornado Zone cross is cut at the edge of the field and
// throws only the seed planted on it to a random free plot of the field, and
// is armed at once (the caster's own seed in the cast turn fires it); Mud Trap needs an
// empty plot that is not mud or poisoned; Petrification cannot pick a seed sunk in mud; Venom can
// pick a plant sunk in mud, cannot pick a rock, removes nothing, and bars
// only the Tornado throw from its plots (a Tornado Zone can still be cast
// over them); Sky Watch
// leaves out plots under the opponent's cloud; the opponent of a Cloud sees
// the taken plots under it as puffs.

import {
  CLOUD_SIZE, CLOUD_TURNS, HISS_LOCK_TURNS, MUD_LIFETIME_TURNS, MUD_SINK_TURNS, SKY_WATCH_RUN, TORNADO_ARM, TORNADO_TURNS, VENOM_TURNS,
  VENOM_ZONE_SIZE, WIND_DASH_RANGE,
} from '../config.js';
import { cloudReach } from '../logic/cloud.js';
import {
  CLOUD, HISS, MUD_TRAP, PETRIFICATION, SKY_WATCH, TORNADO_ZONE, VENOM, WIND_DASH, cooldownTurns, getSkill, isPassiveSkill,
} from '../logic/skills.js';

// The limits of the doc, shared by the table and its tests.
export const BRIEF_MAX = 60;
export const FACT_LABEL_MAX = 8;
export const FACT_VALUE_MAX = 16;
export const FACTS_MIN = 2;
export const FACTS_MAX = 3;
export const RULE_MAX = 44;
export const RULES_MIN = 2;
export const RULES_MAX = 4;
export const DESCRIPTION_MAX = 220;
export const TURN_LABEL_MAX = 14;
export const TURN_TEXT_MAX = 48;

// The two turn boxes: kind 'free' (an active skill) and 'passive' (Sky Watch).
export const TURN_FREE = Object.freeze({ kind: 'free', label: 'Free action', text: 'Uses no turn. Plant a seed to end it' });
export const TURN_PASSIVE = Object.freeze({ kind: 'passive', label: 'Always on', text: 'Works by itself and never uses a turn' });

// The plural follows the number: 1 turn, 2 turns.
const turns = (count) => `${count} ${count === 1 ? 'turn' : 'turns'}`;
const plots = (count) => `${count} ${count === 1 ? 'plot' : 'plots'}`;
const by = (size) => `${size} by ${size}`;
const CLOUD_REACH = cloudReach(CLOUD_SIZE);
const NONE = 'None';

const fact = (label, value) => Object.freeze({ label, value });
// The Rest fact of every skill: its cooldown, or None for a passive skill.
const rest = (skillId) => fact('Rest', isPassiveSkill(skillId) ? NONE : turns(cooldownTurns(skillId)));
const sentence = (text) => (text.endsWith('.') ? text : `${text}.`);
// The one-line form of an entry (aria-labels, hints, How to Play): the brief,
// then every rule as a sentence.
const describe = (brief, rules) => [brief, ...rules].map(sentence).join(' ');

const info = (skillId, { brief, facts, rules, hint }) => Object.freeze({
  title: getSkill(skillId).name,
  brief,
  facts: Object.freeze([rest(skillId), ...facts]),
  rules: Object.freeze([...rules]),
  hint,
  description: describe(brief, rules),
  turn: isPassiveSkill(skillId) ? TURN_PASSIVE : TURN_FREE,
});

export const SKILL_INFO = Object.freeze({
  [WIND_DASH]: info(WIND_DASH, {
    brief: 'Send one of your plants to a nearby empty plot.',
    facts: [fact('Range', plots(WIND_DASH_RANGE)), fact('Lands', 'After their turn')],
    rules: [
      'Diagonals count',
      'Fails if the plot is taken by then',
      'Cannot land on mud or poison',
      'Cannot move a plant sunk in mud',
    ],
    hint: 'Click to select, then choose a plot',
  }),
  [TORNADO_ZONE]: info(TORNADO_ZONE, {
    brief: 'Hide a cross-shaped trap on the field.',
    facts: [fact('Waits', turns(TORNADO_TURNS)), fact('Size', plots(4 * TORNADO_ARM + 1))],
    rules: [
      'Cut at the edge of the field',
      'Hidden from your opponent, one use',
      'Armed at once: your own seed counts',
      'Throws the first seed to a random free plot',
    ],
    hint: 'Click to select, then choose the trap centre',
  }),
  [MUD_TRAP]: info(MUD_TRAP, {
    brief: 'Turn an empty plot into a mud puddle.',
    facts: [fact('Puddle', turns(MUD_LIFETIME_TURNS)), fact('Sinks', turns(MUD_SINK_TURNS))],
    rules: [
      'A seed planted in it sinks',
      'A sunk seed counts for no line',
      'Then it surfaces and counts again',
      'Empty plots only, not mud or poison',
    ],
    hint: 'Click to select, then choose a plot',
  }),
  [PETRIFICATION]: info(PETRIFICATION, {
    brief: 'Turn one enemy plant to stone.',
    facts: [fact('Lasts', 'For good'), fact('Target', 'Enemy plant')],
    rules: [
      'The rock breaks every line',
      'It blocks its plot for both players',
      'Cannot pick a seed sunk in mud',
    ],
    hint: 'Click to select, then choose a plant',
  }),
  [HISS]: info(HISS, {
    brief: 'Silence your opponent\'s skills.',
    facts: [fact('Locks', turns(HISS_LOCK_TURNS)), fact('Target', NONE)],
    rules: [
      'They can still plant a seed',
      'No target needed',
    ],
    hint: 'Click to select, no target needed',
  }),
  [VENOM]: info(VENOM, {
    brief: `Poison a ${by(VENOM_ZONE_SIZE)} patch around an enemy plant.`,
    facts: [fact('Lasts', turns(VENOM_TURNS)), fact('Area', by(VENOM_ZONE_SIZE))],
    rules: [
      'Can pick a plant sunk in mud',
      'No seed, Dash, Mud or Tornado throw there',
      'The plant stays and still counts',
      'Rocks cannot be picked',
    ],
    hint: 'Click to select, then choose a plant',
  }),
  [SKY_WATCH]: info(SKY_WATCH, {
    brief: `See where your opponent could make ${SKY_WATCH_RUN} in a row.`,
    facts: [fact('Mode', 'Always on')],
    rules: [
      'Marks empty plots with a little cloud',
      `Warns when a row of ${SKY_WATCH_RUN - 1} can become ${SKY_WATCH_RUN}`,
      'Your opponent never sees the marks',
      'Plots under their cloud are left out',
    ],
    hint: 'Always on, nothing to click',
  }),
  [CLOUD]: info(CLOUD, {
    brief: `Hide a ${by(CLOUD_SIZE)} patch of the field from your opponent.`,
    facts: [fact('Lasts', turns(CLOUD_TURNS)), fact('Area', by(CLOUD_SIZE))],
    rules: [
      'Your opponent sees taken plots as puffs',
      'You still see everything under it',
      `Covers ${plots(CLOUD_REACH.lo)} up and left, ${CLOUD_REACH.hi} down and right`,
      'Cut at the edge of the field',
    ],
    hint: 'Click to select, then choose where the cloud goes',
  }),
});

// The entry of a skill id, or null.
export function skillInfo(skillId) {
  return Object.hasOwn(SKILL_INFO, skillId) ? SKILL_INFO[skillId] : null;
}
