// The HUD art of every character: the portrait follows the character, not
// the side, every skill has its icon, and the files the owner sent have the
// sizes the manifest names (docs/design.md section 5.3 and 5.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { X, O } from '../src/logic/board.js';
import { CHARACTERS, CLOUD_EAGLE, JADE_SERPENT } from '../src/logic/characters.js';
import { createInitialState } from '../src/logic/game.js';
import { ART, HUD_ART_PX, JADE_SERPENT_ART_PX, PLACEHOLDERS_3D, placeholderShape } from '../src/render3d/art-assets.js';
import { PORTRAIT_ART, SKILL_ICON_ART, hudViewModel } from '../src/ui/hud-view.js';

const manifest = JSON.parse(readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'));

// Width and height from the PNG header (IHDR).
function pngSize(file) {
  const bytes = readFileSync(new URL(`../assets/${file}`, import.meta.url));
  assert.equal(bytes.toString('latin1', 1, 4), 'PNG', `${file} is a PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test('every character has a HUD portrait and every skill has an icon', () => {
  for (const [id, character] of Object.entries(CHARACTERS)) {
    assert.ok(manifest.assets[PORTRAIT_ART[id]], `${character.name} has no portrait`);
    for (const skillId of character.skills) assert.ok(manifest.assets[SKILL_ICON_ART[skillId]], `${skillId} has no icon`);
  }
});

test('the HUD card shows the portrait of the character playing that side', () => {
  const state = createInitialState(undefined, { [X]: JADE_SERPENT, [O]: CLOUD_EAGLE });
  const vm = hudViewModel(state);
  const byPlayer = Object.fromEntries(vm.cards.map((card) => [card.player, card]));
  assert.equal(byPlayer[X].portrait, ART.jadeSerpent.hud);
  assert.equal(byPlayer[O].portrait, ART.cloudEagle.hud);
  assert.deepEqual(byPlayer[X].skills.map((skill) => skill.icon), [ART.jadeSerpent.hissIcon, ART.jadeSerpent.venomIcon]);
  assert.deepEqual(byPlayer[O].skills.map((skill) => skill.icon), [ART.cloudEagle.skyWatchIcon, ART.cloudEagle.cloudIcon]);
});

test('the 64 px grid HUD files are 3D-loaded manifest entries with a placeholder of the same size', () => {
  for (const name of [ART.jadeSerpent, ART.windRabbit, ART.earthBear].flatMap((group) => Object.values(group))) {
    const entry = manifest.assets[name];
    const size = HUD_ART_PX;
    assert.deepEqual([entry.use, entry.width, entry.height, entry.frames], ['3d', size, size, 1], name);
    assert.ok(PLACEHOLDERS_3D[name]?.paint, `"${name}" has no placeholder`);
    assert.deepEqual(placeholderShape(name), { width: size, height: size, frames: 1 });
  }
});

test('the files of the Cloud Eagle, Jade Serpent, Wind Rabbit and Earth Bear art have the manifest sizes', () => {
  for (const name of [ART.cloudEagle, ART.jadeSerpent, ART.windRabbit, ART.earthBear].flatMap((group) => Object.values(group))) {
    const entry = manifest.assets[name];
    assert.deepEqual(pngSize(entry.file), [entry.width, entry.height], name);
  }
});

test('a player silenced by Hiss sees every skill row Silenced, never Ready', async () => {
  const { STRINGS } = await import('../src/ui/strings.js');
  const { useSkill } = await import('../src/logic/game.js');
  const { HISS } = await import('../src/logic/skills.js');
  const start = createInitialState(undefined, { [X]: JADE_SERPENT, [O]: CLOUD_EAGLE });
  const after = useSkill(start, { player: X, skill: HISS });
  assert.ok(!after.error, after.error);
  const vm = hudViewModel(after.state);
  const eagle = vm.cards.find((card) => card.player === O);
  const cloud = eagle.skills.find((skill) => skill.id === 'cloud');
  assert.equal(cloud.stateText, STRINGS.skillSilenced);
  assert.equal(cloud.disabled, true);
  assert.equal(eagle.skills.find((skill) => skill.id === 'skyWatch').stateText, STRINGS.skillAlwaysOn, 'a passive skill stays on');
});

test('every character\'s HUD portrait and skill icons are on the 64 px grid art', () => {
  const grid = new Set([ART.jadeSerpent, ART.windRabbit, ART.earthBear, ART.cloudEagle].flatMap((group) => Object.values(group)));
  for (const name of [...Object.values(PORTRAIT_ART), ...Object.values(SKILL_ICON_ART)]) assert.ok(grid.has(name), name);
  assert.equal(JADE_SERPENT_ART_PX[ART.jadeSerpent.hud], HUD_ART_PX);
});
