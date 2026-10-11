// The art of the character HUDs (docs/hud-characters.md): small SVG
// ornaments drawn once into every player card. Pure strings, no DOM, so they
// can be tested under Node. Each character's pieces carry its id in a class
// (oa-windRabbit, ra-earthBear, ...); hud.css shows the pieces of the
// character a card belongs to (data-character) and hides the rest, and gives
// every piece its colours through custom properties (--o-a to --o-e), so no
// colour is written here.
//
// The shapes of the controls (portrait, skill icons, chevron, count badge) are
// the same for every character: they live in hud.css. Only these ornaments
// and the colours and materials of hud.css make a character's card its own.

import { CHARACTERS } from '../logic/characters.js';

// The corner pieces: Earth Bear's rivets, Jade Serpent's gems, Cloud Eagle's
// stars (hud.css shapes one span for each; Wind Rabbit has none).
const CORNERS = '<span class="gem g1"></span><span class="gem g2"></span><span class="gem g3"></span><span class="gem g4"></span>';

// Wind Rabbit: two wind curves across the card (stretched to its size) and a
// dandelion seed at the top right.
const WIND_RABBIT = [
  '<svg class="oa oa-windRabbit oa-curves" viewBox="0 0 250 300" preserveAspectRatio="none" aria-hidden="true">',
  '<path class="sa" vector-effect="non-scaling-stroke" d="M-8 100 C 44 66 92 134 154 90 S 236 60 262 84" fill="none"/>',
  '<path class="sa" vector-effect="non-scaling-stroke" d="M-8 232 C 54 200 108 268 172 228 S 244 204 262 220" fill="none"/>',
  '</svg>',
  '<svg class="oa oa-windRabbit oa-seed" viewBox="-16 -18 32 32" aria-hidden="true">',
  '<path class="sb" d="M0 0 L-12 -9 M0 0 L-4 -15 M0 0 L7 -14 M0 0 L14 -5 M0 0 L12 7" fill="none" stroke-width="1.2" stroke-linecap="round"/>',
  '<circle class="fb" r="2.4"/><circle class="fb" cx="-12" cy="-9" r="1.5"/><circle class="fb" cx="-4" cy="-15" r="1.5"/>',
  '<circle class="fb" cx="7" cy="-14" r="1.5"/><circle class="fb" cx="14" cy="-5" r="1.5"/><circle class="fb" cx="12" cy="7" r="1.5"/>',
  '</svg>',
].join('');

// Earth Bear: a mound of soil with two sprouts at the bottom right.
const EARTH_BEAR = [
  '<svg class="oa oa-earthBear" viewBox="0 0 86 46" aria-hidden="true">',
  '<path class="fa" d="M0 46 C 10 30 24 24 43 24 S 76 30 86 46 Z"/>',
  '<path class="fb" d="M0 46 C 10 34 24 29 43 29 S 76 34 86 46 Z"/>',
  '<path class="sc" d="M30 28 C 30 18 28 12 22 8" fill="none" stroke-width="2.4" stroke-linecap="round"/>',
  '<path class="fc" d="M22 8 C 14 6 11 11 12 15 C 18 15 22 12 22 8 Z"/>',
  '<path class="fd" d="M22 8 C 28 2 36 3 37 8 C 31 11 25 11 22 8 Z"/>',
  '<path class="sc" d="M54 28 C 54 22 56 18 60 15" fill="none" stroke-width="2.2" stroke-linecap="round"/>',
  '<path class="fd" d="M60 15 C 64 10 70 11 71 15 C 67 18 62 18 60 15 Z"/>',
  '</svg>',
].join('');

// Jade Serpent: a coiled snake with a forked tongue at the bottom right.
const JADE_BODY = 'M2 48 C 14 32 28 28 42 34 S 66 42 76 28 S 86 14 90 10';
const JADE_SERPENT = [
  '<svg class="oa oa-jadeSerpent" viewBox="0 0 104 50" aria-hidden="true">',
  `<path class="sa" d="${JADE_BODY}" fill="none" stroke-width="10" stroke-linecap="round"/>`,
  `<path class="sb" d="${JADE_BODY}" fill="none" stroke-width="7" stroke-linecap="round"/>`,
  `<path class="sc" d="${JADE_BODY}" fill="none" stroke-width="1.8" stroke-dasharray="1 6" stroke-linecap="round"/>`,
  '<ellipse class="fb" cx="92" cy="9" rx="8" ry="5.5" transform="rotate(-38 92 9)"/>',
  '<circle class="fe" cx="94" cy="6.5" r="1.5"/>',
  '<path class="sd" d="M97 12 L100 16 M100 16 L103 15 M100 16 L100 20" fill="none" stroke-width="1.5" stroke-linecap="round"/>',
  '</svg>',
].join('');

// Cloud Eagle: a small cloud and a golden feather at the bottom right, and
// the four-point stars of the corners (the CORNERS spans).
const CLOUD_EAGLE = [
  '<svg class="oa oa-cloudEagle" viewBox="0 0 104 50" aria-hidden="true">',
  '<g class="fa"><circle cx="24" cy="38" r="11"/><circle cx="40" cy="31" r="15"/><circle cx="58" cy="37" r="12"/><rect x="13" y="38" width="57" height="14"/></g>',
  '<g class="fb"><circle cx="38" cy="28" r="10"/><circle cx="54" cy="33" r="7"/><circle cx="24" cy="35" r="7"/></g>',
  '<path class="fc" d="M76 44 C 82 30 92 20 102 15 C 100 28 90 40 76 44 Z"/>',
  '<path class="sd" d="M76 44 C 84 36 92 26 100 17" fill="none" stroke-width="1.4" stroke-linecap="round"/>',
  '</svg>',
].join('');

// All the card pieces, inside the card's .orn layer.
export const CARD_ART_HTML = CORNERS + WIND_RABBIT + EARTH_BEAR + JADE_SERPENT + CLOUD_EAGLE;

// The rule after the SKILLS label: Wind Rabbit's wave, Earth Bear's pebbles,
// Jade Serpent's snake line with a forked tongue, Cloud Eagle's hairline with
// a feather. Each piece stretches to the room left of the label.
export const RULE_ART_HTML = [
  '<svg class="ra ra-windRabbit" viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true">',
  '<path class="rs1" vector-effect="non-scaling-stroke" d="M0 7 C 22 -1 40 15 64 7 S 108 -1 132 7 S 170 14 200 7" fill="none" stroke-width="2" stroke-linecap="round"/>',
  '</svg>',
  '<svg class="ra ra-earthBear" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true">',
  '<path class="rs1" vector-effect="non-scaling-stroke" d="M0 6 H200" fill="none" stroke-width="2" stroke-dasharray="1 7" stroke-linecap="round"/>',
  '<ellipse class="rf1" cx="14" cy="6" rx="4" ry="3"/><ellipse class="rf2" cx="52" cy="7" rx="3" ry="2.4"/><ellipse class="rf3" cx="86" cy="5.5" rx="5" ry="3.4"/>',
  '<ellipse class="rf4" cx="128" cy="6.5" rx="3" ry="2.4"/><ellipse class="rf1" cx="160" cy="6" rx="4" ry="3"/><ellipse class="rf2" cx="190" cy="7" rx="2.6" ry="2"/>',
  '</svg>',
  '<svg class="ra ra-jadeSerpent" viewBox="0 0 200 16" preserveAspectRatio="none" aria-hidden="true">',
  '<path class="rs1" vector-effect="non-scaling-stroke" d="M0 8 C 12 0 24 16 36 8 S 60 0 72 8 S 96 16 108 8 S 132 0 144 8 S 170 14 184 8" fill="none" stroke-width="2.4" stroke-linecap="round"/>',
  '<path class="rs2" vector-effect="non-scaling-stroke" d="M184 8 L192 8 M192 8 L199 3 M192 8 L199 13" fill="none" stroke-width="1.6" stroke-linecap="round"/>',
  '</svg>',
  '<svg class="ra ra-cloudEagle" viewBox="0 0 200 4" preserveAspectRatio="none" aria-hidden="true">',
  '<path class="rs1" vector-effect="non-scaling-stroke" d="M0 2 H200" fill="none" stroke-width="2" stroke-linecap="round"/>',
  '</svg>',
  '<svg class="rf ra-cloudEagle" viewBox="0 0 30 16" aria-hidden="true">',
  '<path class="rf1" d="M2 14 C 8 4 18 1 28 2 C 24 10 14 15 2 14 Z"/>',
  '<path class="rs2" d="M2 14 C 10 10 18 6 25 3" fill="none" stroke-width="1.2" stroke-linecap="round"/>',
  '</svg>',
].join('');

// The characters the art knows (a test checks this matches the rules' list).
export const ORNAMENT_CHARACTERS = Object.freeze(Object.keys(CHARACTERS));
