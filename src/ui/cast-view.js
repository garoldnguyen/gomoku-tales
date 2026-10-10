// What the HUD shows when a skill is used (docs/free-action-design.md
// section 8). Pure (no DOM): every function reads the game state the viewer
// is allowed to see, so the same state gives the same flash, notice and lock
// rune in the caster's window, the other seat's window and a spectator's.
// src/ui/hud-view.js puts the answers in the view model and src/ui/hud.js
// only draws them.
//
// A skill no longer ends the turn (Free Action), so while the caster is
// still to move `state.skillUsed` names the skill. That is the cue: it is
// set when the skill is used and cleared when the turn ends. The Tornado Zone
// is a secret trap, so nothing here ever reads state.tornado: the other seat
// gets the character that cast it and no cell.

import {
  HISS_LOCK_TURNS, HISS_WAVE_COLOUR, HISS_WAVE_MS, HUD_DUST_COUNT, HUD_DUST_MS, HUD_FEATHER_COUNT, HUD_FEATHER_MS, HUD_SHAKE_LIGHT_PX,
  HUD_SHAKE_MS, HUD_SHAKE_PX, HUD_SHAKE_STEPS, LOCKED_ICON_OPACITY, LOCK_BLINK_MS, SKILL_FLASH_MS, VENOM_FLASH_COLOUR,
} from '../config.js';
import { characterOf, isGameOver } from '../logic/game.js';
import { isSkillLocked } from '../logic/jade-serpent-skills.js';
import { CLOUD, HISS, MUD_TRAP, PETRIFICATION, TORNADO_ZONE, VENOM, WIND_DASH } from '../logic/skills.js';
import { CHARACTER_LOOK } from '../render3d/character-look.js';
import { STRINGS, fillText, lockedText } from './strings.js';

// The extras of each skill's card effect, besides the border flash every
// used skill gets. Sky Watch is passive and never used, so it has none.
//   shake    the user's card shakes slightly (Petrification)
//   dust     gold and green dust rises off the card (Petrification)
//   wave     a purple sonic wave crosses to the opponent's card (Hiss)
//   feathers white feathers float out of the card (Cloud)
const NONE = Object.freeze({ shake: false, dust: false, wave: false, feathers: false });
export const CAST_EXTRAS = Object.freeze({
  [WIND_DASH]: NONE,
  [TORNADO_ZONE]: NONE, // the card lights up; the other seat sees nothing else
  [MUD_TRAP]: NONE,
  [PETRIFICATION]: Object.freeze({ ...NONE, shake: true, dust: true }),
  [HISS]: Object.freeze({ ...NONE, wave: true }),
  [VENOM]: NONE,
  [CLOUD]: Object.freeze({ ...NONE, feathers: true }),
});

// The border flash colour of a skill: the colour of the character that has
// it (CHARACTER_LOOK), deep purple for Venom.
export function flashColour(skillId, characterId) {
  if (skillId === VENOM) return VENOM_FLASH_COLOUR;
  return CHARACTER_LOOK[characterId]?.colour ?? null;
}

// The effect of the skill the card's player used this turn, or null: { key,
// skill, colour, shake, dust, wave, feathers }. `key` is new for every cast
// (the turn number and the skill; one skill a turn), so the HUD plays the
// effect once per cast and not on every redraw.
export function castView(state, player) {
  if (isGameOver(state) || state.currentPlayer !== player) return null;
  const skill = state.skillUsed ?? null;
  if (!skill || !Object.hasOwn(CAST_EXTRAS, skill)) return null;
  const character = characterOf(state, player);
  return { key: `${state.turn}:${skill}`, skill, colour: flashColour(skill, character.id), ...CAST_EXTRAS[skill] };
}

// The card of the player a Hiss was cast at: { key, shake } while the caster
// is still to move after the Hiss (the card shakes lightly), else null. The
// lock itself is lockView().
export function reactionView(state, player) {
  if (isGameOver(state) || state.skillUsed !== HISS || state.currentPlayer === player) return null;
  return { key: `${state.turn}:${HISS}:hit`, shake: true };
}

// The red lock rune of a card whose player a Hiss keeps from using skills:
// { text } with the number of turns of HISS_LOCK_TURNS, else null. It shows
// from the cast until the locked player's turn ends.
export function lockView(state, player) {
  if (isGameOver(state) || !isSkillLocked(state, player)) return null;
  return { text: lockedText(HISS_LOCK_TURNS) };
}

// The notice the other seat and the spectators get when a Tornado Zone was
// just cast: { key, text, colour }, else null. The text names the character
// (from CHARACTERS) and nothing else: no cell of the trap is ever in it.
export function trapNotice(state) {
  if (isGameOver(state) || state.skillUsed !== TORNADO_ZONE) return null;
  const character = characterOf(state, state.currentPlayer);
  return {
    key: `${state.turn}:${TORNADO_ZONE}:notice`,
    text: fillText(STRINGS.trapPlaced, { name: character.name }),
    colour: flashColour(TORNADO_ZONE, character.id),
  };
}

// The banner after a skill (the announcer shows it, the turn pill says the
// same): { key, text, colour } or null.
//   the caster (one screen, or the window of the player to move) is told to
//   plant; the other seat and the spectators, who cannot act, only learn
//   of a trap. local: one window plays both sides; watching: a spectator;
//   you: this window's stone online.
export function castNotice(state, { local = false, watching = false, you = null } = {}) {
  if (isGameOver(state) || !state.skillUsed) return null;
  const player = state.currentPlayer;
  const character = characterOf(state, player);
  const colour = flashColour(state.skillUsed, character.id);
  if (!watching && (local || you === player)) {
    return { key: `${state.turn}:${state.skillUsed}`, text: STRINGS.plantToEndTurn, colour };
  }
  return trapNotice(state);
}

// The numbers hud.js hands to hud.css as custom properties on the HUD, once.
// Keys are the property names.
export function castCssVars() {
  return {
    '--flash-ms': `${SKILL_FLASH_MS}ms`,
    '--shake-ms': `${HUD_SHAKE_MS}ms`,
    '--dust-ms': `${HUD_DUST_MS}ms`,
    '--wave-ms': `${HISS_WAVE_MS}ms`,
    '--wave-colour': HISS_WAVE_COLOUR,
    '--feather-ms': `${HUD_FEATHER_MS}ms`,
    '--blink-ms': `${LOCK_BLINK_MS}ms`,
    '--locked-icon-opacity': String(LOCKED_ICON_OPACITY),
  };
}

// The keyframes of a card shake for the Web Animations API: the card swings
// HUD_SHAKE_STEPS times along x, each swing smaller, and settles. `translate`
// is its own property, so the card's --card-scale transform stays. light: the
// lighter shake of the card a Hiss locks.
export function shakeFrames(light = false) {
  const amplitude = light ? HUD_SHAKE_LIGHT_PX : HUD_SHAKE_PX;
  const frames = [{ translate: '0px 0px' }];
  for (let i = 1; i <= HUD_SHAKE_STEPS; i++) {
    const side = i % 2 === 1 ? 1 : -1;
    const fade = 1 - (i - 1) / HUD_SHAKE_STEPS;
    frames.push({ translate: `${(side * amplitude * fade).toFixed(2)}px 0px` });
  }
  frames.push({ translate: '0px 0px' });
  return frames;
}

// How many dust specks and feathers a card holds.
export const DUST_COUNT = HUD_DUST_COUNT;
export const FEATHER_COUNT = HUD_FEATHER_COUNT;

// How long the longest effect of a cast plays: after it the HUD clears the cast.
export function castDurationMs(cast) {
  if (!cast) return 0;
  let ms = SKILL_FLASH_MS;
  if (cast.shake) ms = Math.max(ms, HUD_SHAKE_MS);
  if (cast.dust) ms = Math.max(ms, HUD_DUST_MS);
  if (cast.wave) ms = Math.max(ms, HISS_WAVE_MS);
  if (cast.feathers) ms = Math.max(ms, HUD_FEATHER_MS);
  return ms;
}
