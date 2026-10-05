// Skill registry (docs/design.md section 5): which character owns each
// skill and its cooldown class. The effects live in the character modules.

import { COOLDOWN_SHORT, COOLDOWN_LONG } from '../config.js';

export const SHORT = 'short';
export const LONG = 'long';
export const PASSIVE = 'passive'; // always on, never used, no cooldown

export const WIND_DASH = 'windDash';
export const TORNADO_ZONE = 'tornadoZone';
export const TERRAIN_CREATION = 'terrainCreation';
export const STONE_CONVERSION = 'stoneConversion';
export const HISS = 'hiss';
export const VENOM = 'venom';
export const SKY_WATCH = 'skyWatch';
export const CLOUD = 'cloud';

export const SKILLS = {
  [WIND_DASH]: { id: WIND_DASH, name: 'Wind Dash', character: 'windRabbit', cooldownClass: SHORT },
  [TORNADO_ZONE]: { id: TORNADO_ZONE, name: 'Tornado Zone', character: 'windRabbit', cooldownClass: LONG },
  [TERRAIN_CREATION]: { id: TERRAIN_CREATION, name: 'Terrain Creation', character: 'earthBear', cooldownClass: SHORT },
  [STONE_CONVERSION]: { id: STONE_CONVERSION, name: 'Stone Conversion', character: 'earthBear', cooldownClass: LONG },
  [HISS]: { id: HISS, name: 'Hiss', character: 'jadeSerpent', cooldownClass: SHORT },
  [VENOM]: { id: VENOM, name: 'Venom', character: 'jadeSerpent', cooldownClass: LONG },
  [SKY_WATCH]: { id: SKY_WATCH, name: 'Sky Watch', character: 'cloudEagle', cooldownClass: PASSIVE },
  [CLOUD]: { id: CLOUD, name: 'Cloud', character: 'cloudEagle', cooldownClass: LONG },
};

// Every skill the rules know. Since the HUD and the character select know
// Cloud Eagle, this is SKILLS itself.
export const ALL_SKILLS = SKILLS;

export function getSkill(skillId) {
  return Object.hasOwn(ALL_SKILLS, skillId) ? ALL_SKILLS[skillId] : null;
}

// True for a passive skill (Sky Watch): always on, it is never used.
export function isPassiveSkill(skillId) {
  return getSkill(skillId)?.cooldownClass === PASSIVE;
}

// Number of the owner's own turns during which the skill cannot be used
// after it has been used. A passive skill has none.
export function cooldownTurns(skillId) {
  const skill = getSkill(skillId);
  if (!skill || skill.cooldownClass === PASSIVE) return 0;
  return skill.cooldownClass === LONG ? COOLDOWN_LONG : COOLDOWN_SHORT;
}
