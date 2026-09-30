// Skill registry (docs/design.md section 5). Only the framework data lives
// here for now: which character owns each skill and its cooldown class.
// Skill effects are added by later tasks.

import { COOLDOWN_SHORT, COOLDOWN_LONG } from '../config.js';

export const SHORT = 'short';
export const LONG = 'long';

export const WIND_DASH = 'windDash';
export const TORNADO_ZONE = 'tornadoZone';
export const TERRAIN_CREATION = 'terrainCreation';
export const STONE_CONVERSION = 'stoneConversion';

export const SKILLS = {
  [WIND_DASH]: { id: WIND_DASH, name: 'Wind Dash', character: 'windRabbit', cooldownClass: SHORT },
  [TORNADO_ZONE]: { id: TORNADO_ZONE, name: 'Tornado Zone', character: 'windRabbit', cooldownClass: LONG },
  [TERRAIN_CREATION]: { id: TERRAIN_CREATION, name: 'Terrain Creation', character: 'earthBear', cooldownClass: SHORT },
  [STONE_CONVERSION]: { id: STONE_CONVERSION, name: 'Stone Conversion', character: 'earthBear', cooldownClass: LONG },
};

export function getSkill(skillId) {
  return Object.hasOwn(SKILLS, skillId) ? SKILLS[skillId] : null;
}

// Number of the owner's own turns during which the skill cannot be used
// after it has been used.
export function cooldownTurns(skillId) {
  const skill = getSkill(skillId);
  if (!skill) return 0;
  return skill.cooldownClass === LONG ? COOLDOWN_LONG : COOLDOWN_SHORT;
}
