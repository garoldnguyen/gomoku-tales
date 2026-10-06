// The skill detail popup never blocks the board (a phone report: Wind
// Dash could not pick a plant under the popup). It takes no presses, so a
// press on it reaches the board and closes it, and the slim layouts of
// phones do not open it at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/ui/hud.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');

test('the skill popup takes no presses', () => {
  assert.match(css, /\.hud \.skill-popup \{[^}]*pointer-events: none;/);
});

test('a skill press opens the popup only beside full cards, never in the slim phone layouts', () => {
  assert.ok(js.includes('if (!compact) openPopup(button, player, slot.id, c);'));
});
