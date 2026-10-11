// The compact skill content model (docs/skill-popup-design.md sections 2 and 3):
// SKILL_INFO entries are { title, brief, facts, rules, hint, description }.
// The length limits are the doc's own numbers, typed here on purpose; every
// game number is read from src/config.js and the text is checked against it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLOUD_SIZE, CLOUD_TURNS, HISS_LOCK_TURNS, MUD_LIFETIME_TURNS, MUD_SINK_TURNS, SKY_WATCH_RUN, TORNADO_ARM, TORNADO_TURNS, VENOM_TURNS,
  VENOM_ZONE_SIZE, WIND_DASH_RANGE,
} from '../src/config.js';
import { cloudReach } from '../src/logic/cloud.js';
import {
  CLOUD, HISS, MUD_TRAP, PETRIFICATION, SKILLS, SKY_WATCH, TORNADO_ZONE, VENOM, WIND_DASH, cooldownTurns, isPassiveSkill,
} from '../src/logic/skills.js';
import { SKILL_INFO, TURN_FREE, TURN_LABEL_MAX, TURN_PASSIVE, TURN_TEXT_MAX, skillInfo } from '../src/ui/skill-info.js';

const IDS = [WIND_DASH, TORNADO_ZONE, MUD_TRAP, PETRIFICATION, HISS, VENOM, SKY_WATCH, CLOUD];
const turnsText = (count) => `${count} ${count === 1 ? 'turn' : 'turns'}`;
const plotsText = (count) => `${count} ${count === 1 ? 'plot' : 'plots'}`;
const byText = (size) => `${size} by ${size}`;
const fact = (id, label) => SKILL_INFO[id].facts.find((f) => f.label === label)?.value;
const everyText = (id) => {
  const entry = SKILL_INFO[id];
  return [entry.title, entry.brief, ...entry.facts.flatMap((f) => [f.label, f.value]), ...entry.rules, entry.hint, entry.description];
};

test('SKILL_INFO has an entry for each of the 8 skills and nothing else', () => {
  assert.equal(IDS.length, 8);
  assert.deepEqual(Object.keys(SKILL_INFO).sort(), IDS.slice().sort());
  assert.deepEqual(Object.keys(SKILL_INFO).sort(), Object.keys(SKILLS).sort());
  for (const id of IDS) {
    assert.deepEqual(Object.keys(SKILL_INFO[id]).sort(), ['brief', 'description', 'facts', 'hint', 'rules', 'title', 'turn'], id);
    assert.equal(skillInfo(id), SKILL_INFO[id]);
    assert.ok(Object.isFrozen(SKILL_INFO[id]) && Object.isFrozen(SKILL_INFO[id].facts) && Object.isFrozen(SKILL_INFO[id].rules), id);
  }
  assert.equal(skillInfo('nope'), null);
});

test('the length limits of the doc hold for all 8 skills', () => {
  for (const id of IDS) {
    const entry = SKILL_INFO[id];
    assert.ok(entry.title.length > 0, id);
    assert.ok(entry.brief.length > 0 && entry.brief.length <= 60, `${id} brief (${entry.brief.length}): ${entry.brief}`);
    assert.ok(entry.facts.length >= 2 && entry.facts.length <= 3, `${id} has ${entry.facts.length} facts`);
    for (const { label, value } of entry.facts) {
      assert.ok(label.length > 0 && label.length <= 8, `${id} label (${label.length}): ${label}`);
      assert.ok(value.length > 0 && value.length <= 16, `${id} value (${value.length}): ${value}`);
      assert.notEqual(label, label.toUpperCase(), `${id}: the label ${label} is stored in normal case (CSS upper-cases it)`);
    }
    assert.equal(new Set(entry.facts.map((f) => f.label)).size, entry.facts.length, `${id}: fact labels are unique`);
    assert.ok(entry.rules.length >= 2 && entry.rules.length <= 4, `${id} has ${entry.rules.length} rules`);
    for (const rule of entry.rules) {
      assert.ok(rule.length > 0 && rule.length <= 44, `${id} rule (${rule.length}): ${rule}`);
      assert.equal(rule.endsWith('.'), false, `${id}: no full stop at the end of "${rule}"`);
    }
    assert.ok(entry.hint.length > 0, id);
  }
});

test('the Rest fact is the cooldown of the skill (None for the passive Sky Watch)', () => {
  for (const id of IDS) {
    assert.equal(SKILL_INFO[id].facts[0].label, 'Rest', `${id}: Rest comes first`);
    const expected = isPassiveSkill(id) ? 'None' : turnsText(cooldownTurns(id));
    assert.equal(fact(id, 'Rest'), expected, id);
  }
  assert.equal(isPassiveSkill(SKY_WATCH), true);
  assert.equal(fact(SKY_WATCH, 'Rest'), 'None');
  for (const id of IDS.filter((skillId) => skillId !== SKY_WATCH)) assert.ok(cooldownTurns(id) > 0, id);
});

test('every other fact is built from its config constant, the plural following the number', () => {
  assert.equal(fact(WIND_DASH, 'Range'), plotsText(WIND_DASH_RANGE));
  assert.equal(fact(TORNADO_ZONE, 'Waits'), turnsText(TORNADO_TURNS));
  assert.equal(fact(TORNADO_ZONE, 'Size'), plotsText(4 * TORNADO_ARM + 1));
  assert.equal(fact(MUD_TRAP, 'Puddle'), turnsText(MUD_LIFETIME_TURNS));
  assert.equal(fact(MUD_TRAP, 'Sinks'), turnsText(MUD_SINK_TURNS));
  assert.equal(fact(HISS, 'Locks'), turnsText(HISS_LOCK_TURNS));
  assert.equal(fact(VENOM, 'Lasts'), turnsText(VENOM_TURNS));
  assert.equal(fact(VENOM, 'Area'), byText(VENOM_ZONE_SIZE));
  assert.equal(fact(CLOUD, 'Lasts'), turnsText(CLOUD_TURNS));
  assert.equal(fact(CLOUD, 'Area'), byText(CLOUD_SIZE));
  // The plural follows the number: one turn is singular, the others are not.
  assert.equal(turnsText(1), '1 turn');
  assert.equal(turnsText(2), '2 turns');
  for (const value of [MUD_SINK_TURNS, HISS_LOCK_TURNS].map(turnsText)) assert.match(value, /^\d+ turns?$/);
  assert.match(fact(MUD_TRAP, 'Sinks'), MUD_SINK_TURNS === 1 ? /^1 turn$/ : /^\d+ turns$/);
  assert.match(fact(HISS, 'Locks'), HISS_LOCK_TURNS === 1 ? /^1 turn$/ : /^\d+ turns$/);
});

test('the numbers inside briefs and rules come from the config constants', () => {
  const { lo, hi } = cloudReach(CLOUD_SIZE);
  assert.ok(SKILL_INFO[VENOM].brief.includes(`${byText(VENOM_ZONE_SIZE)} patch`), SKILL_INFO[VENOM].brief);
  assert.ok(SKILL_INFO[CLOUD].brief.includes(`${byText(CLOUD_SIZE)} patch`), SKILL_INFO[CLOUD].brief);
  assert.ok(SKILL_INFO[SKY_WATCH].brief.includes(`${SKY_WATCH_RUN} in a row`), SKILL_INFO[SKY_WATCH].brief);
  assert.ok(SKILL_INFO[SKY_WATCH].rules.some((rule) => rule.includes(`${SKY_WATCH_RUN - 1} can become ${SKY_WATCH_RUN}`)));
  const reach = SKILL_INFO[CLOUD].rules.find((rule) => rule.startsWith('Covers'));
  assert.equal(reach, `Covers ${plotsText(lo)} up and left, ${hi} down and right`);
  assert.equal(lo + 1 + hi, CLOUD_SIZE, 'the reach spans the cloud');
  // A skill with no number in its words has none typed: only the config adds digits.
  const source = readFileSync(new URL('../src/ui/skill-info.js', import.meta.url), 'utf8');
  const table = source.slice(source.indexOf('export const SKILL_INFO')).replace(/\$\{[^}]*\}/g, '');
  assert.doesNotMatch(table, /'[^'\n]*\d[^'\n]*'|`[^`\n]*\d[^`\n]*`/, 'no digit typed inside a string of the table');
  assert.doesNotMatch(table, /\b(one|two|three|four|five|six|seven|eight|nine) (turns?|plots?)\b/i, 'no spelled-out count');
});

test('the description is derived from the brief and the rules and stays short', () => {
  for (const id of IDS) {
    const { brief, rules, description } = SKILL_INFO[id];
    assert.equal(description, [brief, ...rules.map((rule) => `${rule}.`)].join(' '), id);
    assert.ok(description.startsWith(brief), id);
    for (const rule of rules) assert.ok(description.includes(`${rule}.`), `${id}: ${rule}`);
    assert.ok(description.length < 220, `${id} description (${description.length})`);
  }
  // Never typed: the source holds no description string, only the derivation.
  const source = readFileSync(new URL('../src/ui/skill-info.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*description:\s*['`]/m, 'description is not written by hand');
  assert.ok(source.includes('description: describe(brief, rules)'));
});

test('no text names a cell, and the Tornado Zone words give the other seat nothing to use', () => {
  const coordinate = [
    /\(\s*\d+\s*,\s*\d+\s*\)/, // (7, 7)
    /\b[A-Oa-o]\d{1,2}\b/, // D4, h10
    /\b[xy]\s*[=:]\s*-?\d/i, // x = 3
    /\b(cell|plot|row|column|line)\s+#?\d/i, // plot 12
    /\bcells?\b/i, // the game says plot
  ];
  for (const id of IDS) {
    for (const text of everyText(id)) {
      for (const pattern of coordinate) assert.doesNotMatch(text, pattern, `${id}: "${text}"`);
    }
  }
  const tornado = SKILL_INFO[TORNADO_ZONE];
  for (const text of [tornado.brief, ...tornado.rules, tornado.hint]) {
    assert.doesNotMatch(text, /\d/, `the Tornado Zone text "${text}" holds no number or place`);
  }
});

test('the words the corrected rules need are in the table', () => {
  const has = (id, rule) => assert.ok(SKILL_INFO[id].rules.includes(rule), `${id}: ${rule}`);
  has(TORNADO_ZONE, 'Cut at the edge of the field');
  has(TORNADO_ZONE, 'Hidden from your opponent, one use');
  has(VENOM, 'Can pick a plant sunk in mud');
  has(VENOM, 'Rocks cannot be picked');
  // Only the Tornado throw is barred from poison; a Tornado Zone can be cast over it.
  has(VENOM, 'No seed, Dash, Mud or Tornado throw there');
  has(PETRIFICATION, 'Cannot pick a seed sunk in mud');
  has(WIND_DASH, 'Cannot land on mud or poison');
  has(CLOUD, 'Your opponent sees taken plots as puffs');
  has(CLOUD, 'Cut at the edge of the field');
  has(HISS, 'They can still plant a seed');
  assert.equal(fact(WIND_DASH, 'Lands'), 'After their turn');
  assert.equal(fact(PETRIFICATION, 'Lasts'), 'For good');
  assert.equal(fact(SKY_WATCH, 'Mode'), 'Always on');
});

test('the Tornado Zone words match the rule: armed at once, one use, a random free plot anywhere', () => {
  const { rules } = SKILL_INFO[TORNADO_ZONE];
  const text = rules.join(' | ');
  assert.match(text, /at once/, 'the cast turn\'s own seed fires it');
  assert.match(text, /random free plot/, 'the seed is thrown anywhere, not aside');
  assert.match(text, /one use/);
  assert.doesNotMatch(text, /next turn|aside|neighbour|next to/, 'nothing of the old rule is left');
});

test('every active skill is a free action and only the passive Sky Watch is not', () => {
  for (const id of IDS) {
    const { turn } = SKILL_INFO[id];
    if (isPassiveSkill(id)) {
      assert.equal(turn, TURN_PASSIVE, id);
      assert.equal(turn.kind, 'passive');
    } else {
      assert.equal(turn, TURN_FREE, id);
      assert.equal(turn.kind, 'free');
    }
    assert.ok(turn.label.length > 0 && turn.label.length <= TURN_LABEL_MAX, `${id} turn label: ${turn.label}`);
    assert.ok(turn.text.length > 0 && turn.text.length <= TURN_TEXT_MAX, `${id} turn text (${turn.text.length}): ${turn.text}`);
    assert.ok(!/[.]$/.test(turn.text), `${id}: no full stop at the end of the turn text`);
    assert.ok(Object.isFrozen(turn), id);
  }
  assert.deepEqual(IDS.filter((id) => SKILL_INFO[id].turn === TURN_PASSIVE), [SKY_WATCH]);
  assert.match(TURN_FREE.text, /plant a seed/i, 'the box says what ends the turn');
});
