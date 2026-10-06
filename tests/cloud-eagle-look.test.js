// Cloud Eagle part 3: the look, the character select and the HUD
// (character-look.js, room-screens.js, hud-view.js, skill-info.js and the
// cloud and Sky Watch overlay of cloud-overlay.js).
import { ART } from '../src/render3d/art-assets.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLOUD_SIZE, CLOUD_TURNS, COOLDOWN_LONG, FEATHER_MAX, FEATHER_MIN, FEATHER_MS, SWIRL_MS, SWIRL_PUFF_COUNT,
} from '../src/config.js';
import { EMPTY, HIDDEN, O, X } from '../src/logic/board.js';
import { CHARACTERS, CLOUD_EAGLE, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT, assignSides } from '../src/logic/characters.js';
import { maskForViewer } from '../src/logic/cloud.js';
import { newGame, placeStone, useSkill } from '../src/logic/game.js';
import { createSeats } from '../src/logic/seats.js';
import { CLOUD, SKY_WATCH } from '../src/logic/skills.js';
import { GUEST, HOST, ROOM_SEATS } from '../src/net/room.js';
import { boardMarks } from '../src/render3d/board-marks.js';
import { CHARACTER_LOOK, CLOUD_SWIRL, markLookFor, particleCount, placementPlan, planDurationMs } from '../src/render3d/character-look.js';
import {
  COVER, OVERLAY_TILE_PX, hiddenPuffCells, SEE_THROUGH, SKY_WATCH_COLOUR, cloudEagleSide, cloudOverlayCells, cloudTileGrid, createCloudOverlay,
  skyWatchOutlineCells, skyWatchOutlineGrid, viewerOf,
} from '../src/render3d/cloud-overlay.js';
import { createLocalGame } from '../src/ui/local-game.js';
import { SELECT_CHARACTERS, characterSelectViewModel } from '../src/ui/room-screens.js';
import { hudViewModel, SPECTATOR_VIEW } from '../src/ui/hud-view.js';
import { SKILL_INFO } from '../src/ui/skill-info.js';
import { STRINGS } from '../src/ui/strings.js';
import { targetClick, targetPreview, targetPrompt } from '../src/ui/targeting.js';

function ok(result) {
  assert.equal(result.ok, true, result.error);
  return result.state;
}

// Cloud Eagle picked first (X) against Earth Bear (O).
function eagleGame() {
  return newGame({ characters: assignSides([CLOUD_EAGLE, EARTH_BEAR]) });
}

const place = (state, player, x, y) => ok(placeStone(state, { player, x, y }));
const useCloud = (state, player, x, y) => ok(useSkill(state, { player, skill: CLOUD, target: { x, y } }));
const key = ({ x, y }) => `${x},${y}`;

// --- the look ---

test('Cloud Eagle has the pale yellow mark colour and the cloudSwirl placement effect', () => {
  assert.deepEqual(markLookFor(CLOUD_EAGLE), { colour: '#fff2a8', effect: CLOUD_SWIRL });
  assert.deepEqual(Object.keys(CHARACTER_LOOK), Object.keys(CHARACTERS), 'one look per character, four of them');
});

test('cloudSwirl: soft cloud puffs and 3 to 5 rising feathers, counts and times from the config', () => {
  const plan = placementPlan(CLOUD_SWIRL, { features: { particleCap: 1000 } });
  const puffs = plan.filter((step) => step.kind === 'cloudPuff');
  const feathers = plan.filter((step) => step.kind === 'feather');
  assert.equal(puffs.length, SWIRL_PUFF_COUNT);
  assert.ok(feathers.length >= FEATHER_MIN && feathers.length <= FEATHER_MAX, `${feathers.length} feathers`);
  assert.equal(puffs.length + feathers.length, plan.length);
  for (const puff of puffs) assert.equal(puff.durationMs, SWIRL_MS);
  for (const feather of feathers) {
    assert.equal(feather.durationMs, FEATHER_MS);
    assert.ok(feather.to[1] > feather.from[1], 'a feather rises');
  }
  assert.ok(planDurationMs(plan) > 0);
  // The cap of the quality level: puffs first, then the feathers are cut.
  const capped = placementPlan(CLOUD_SWIRL, { features: { particleCap: 4 } });
  assert.equal(particleCount(capped), 4);
  assert.ok(capped.every((step) => step.kind === 'cloudPuff'));
  assert.equal(particleCount(placementPlan(CLOUD_SWIRL, { features: { particleCap: 0 } })), 0);
});

// --- the character select ---

test('the character select shows four cards in a row: Wind Rabbit, Earth Bear, Jade Serpent, Cloud Eagle', () => {
  assert.deepEqual([...SELECT_CHARACTERS], [WIND_RABBIT, EARTH_BEAR, JADE_SERPENT, CLOUD_EAGLE]);
  const vm = characterSelectViewModel({ seats: createSeats(ROOM_SEATS), labels: { [HOST]: 'A', [GUEST]: 'B' }, editable: [HOST], you: HOST });
  assert.equal(vm.characters.length, 4);
  const eagle = vm.characters[3];
  assert.equal(eagle.name, 'Cloud Eagle');
  assert.equal(eagle.tagline, STRINGS.selectTaglineCloudEagle);
  assert.equal(eagle.box, 'pick-host-cloud-eagle');
  assert.equal(eagle.emblem, 'cloud');
  assert.equal(eagle.portrait, ART.cloudEagle.avatar, 'the owner\'s portrait (the emblem only while the file is missing)');
  assert.deepEqual(eagle.skills.map((skill) => skill.name), [SKILL_INFO[SKY_WATCH].title, SKILL_INFO[CLOUD].title]);
  assert.deepEqual(eagle.skills.map((skill) => skill.restText), [STRINGS.skillAlwaysOn, `${COOLDOWN_LONG} turns`]);
  // No More soon slot: every card is a character.
  assert.ok(vm.characters.every((card) => Object.hasOwn(CHARACTERS, card.character)));
});

test('the room CSS lays the four cards in one row, and the v5 references show four cards', () => {
  const css = readFileSync(new URL('../src/ui/room.css', import.meta.url), 'utf8');
  assert.match(css, /#screens \.characters \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /#screens \.character\.colour-gold \{/);
  for (const file of ['character-select-desktop.html', 'character-select-phone.html']) {
    const html = readFileSync(new URL(`../docs/reference/v5/${file}`, import.meta.url), 'utf8');
    for (const id of SELECT_CHARACTERS) assert.ok(html.includes(CHARACTERS[id].name), `${file} shows ${CHARACTERS[id].name}`);
    assert.ok(!/more soon/i.test(html), `${file} has no More soon slot`);
  }
});

// --- SKILL_INFO and the HUD ---

test('SKILL_INFO numbers of Cloud Eagle equal the config constants', () => {
  assert.equal(SKILL_INFO[SKY_WATCH].title, 'Sky Watch');
  assert.equal(SKILL_INFO[CLOUD].title, 'Cloud');
  assert.ok(SKILL_INFO[CLOUD].description.includes(`${CLOUD_SIZE} by ${CLOUD_SIZE}`));
  assert.ok(SKILL_INFO[CLOUD].description.includes(`next ${CLOUD_TURNS} turns`));
  assert.ok(SKILL_INFO[SKY_WATCH].description.length > 0);
  // The numbers are never typed into the text.
  const source = readFileSync(new URL('../src/ui/skill-info.js', import.meta.url), 'utf8');
  assert.ok(source.includes('${CLOUD_SIZE} by ${CLOUD_SIZE}'));
  assert.ok(source.includes('${CLOUD_TURNS}'));
});

test('the HUD card of Cloud Eagle lists Sky Watch with no timer and Cloud with its turns', () => {
  let state = eagleGame();
  let card = hudViewModel(state).cards.find((c) => c.player === X);
  assert.equal(card.name, 'Cloud Eagle');
  const [watch, cloud] = card.skills;
  assert.equal(watch.id, SKY_WATCH);
  assert.equal(watch.title, 'Sky Watch');
  assert.equal(watch.stateText, STRINGS.skillAlwaysOn);
  assert.equal(watch.passive, true);
  assert.equal(watch.cooldownTurns, 0);
  assert.equal(watch.cooldownProgress, 0);
  assert.equal(watch.disabled, true, 'never used');
  assert.equal(watch.description, SKILL_INFO[SKY_WATCH].description);
  assert.equal(cloud.id, CLOUD);
  assert.equal(cloud.stateText, 'Ready');
  assert.equal(cloud.disabled, false);
  // After a Cloud, its row counts down its turns.
  state = useCloud(state, X, 7, 7);
  state = place(state, O, 0, 0);
  card = hudViewModel(state).cards.find((c) => c.player === X);
  assert.equal(card.skills[1].cooldownTurns, COOLDOWN_LONG);
  assert.equal(card.skills[1].stateText, `Ready in ${COOLDOWN_LONG} turns`);
  assert.equal(card.skills[0].stateText, STRINGS.skillAlwaysOn, 'Sky Watch keeps no timer');
  // A spectator's view too.
  assert.equal(hudViewModel(state, {}, SPECTATOR_VIEW).cards[0].skills[0].stateText, STRINGS.skillAlwaysOn);
});

test('the Cloud target step: any cell, the 5 by 5 preview, and the prompt from strings.js', () => {
  const state = eagleGame();
  const targeting = { skill: CLOUD, from: null };
  assert.equal(targetPrompt(targeting), STRINGS.cloudTargetPrompt);
  assert.deepEqual(targetClick(state, X, targeting, { x: 0, y: 0 }), { target: { x: 0, y: 0 } });
  const preview = targetPreview(state, X, targeting, { x: 7, y: 7 });
  assert.equal(preview.type, 'cloud');
  assert.equal(preview.cells.length, CLOUD_SIZE * CLOUD_SIZE);
  const marks = boardMarks({ state, hover: null, preview });
  assert.equal(marks.decals.length, CLOUD_SIZE * CLOUD_SIZE);
  assert.ok(marks.decals.every((decal) => decal.kind === 'cloudPreview'));
  // Clipped at the corner.
  assert.equal(targetPreview(state, X, targeting, { x: 0, y: 0 }).cells.length, 9);
});

// --- the cloud overlay ---

// X (Cloud Eagle) clouds (7, 7); O then plants under it, X plants under it too.
function cloudedGame() {
  let state = eagleGame();
  state = place(state, X, 7, 7);
  state = place(state, O, 1, 1);
  state = useCloud(state, X, 7, 7);
  state = place(state, O, 8, 8); // under X's cloud: X sees it, O sees its own plant
  return state;
}

test('the cloud overlay for the owner: a translucent cloud over its 5 by 5 area with the stones inside visible', () => {
  const state = cloudedGame();
  const shown = maskForViewer(state, X);
  const cells = cloudOverlayCells(shown, X);
  assert.equal(cells.length, CLOUD_SIZE * CLOUD_SIZE);
  assert.ok(cells.every((cell) => cell.look === SEE_THROUGH));
  assert.ok(cells.every((cell) => Math.abs(cell.x - 7) <= 2 && Math.abs(cell.y - 7) <= 2));
  assert.equal(shown.board[7][7], X, 'the owner sees the plants inside');
  assert.equal(shown.board[8][8], O);
  // Spectators see it translucent too, with everything inside.
  assert.ok(cloudOverlayCells(state, null).every((cell) => cell.look === SEE_THROUGH));
});

test('the cloud overlay for the other seat: a light mist over the area, a cloud puff on every taken plot, no plant shown', () => {
  let state = cloudedGame();
  state = place(state, X, 6, 6); // X plants under its own cloud, hidden from O
  const shown = maskForViewer(state, O);
  const cells = cloudOverlayCells(shown, O);
  assert.equal(cells.length, CLOUD_SIZE * CLOUD_SIZE);
  assert.ok(cells.every((cell) => cell.look === COVER));
  for (const cell of cells) assert.ok(shown.board[cell.y][cell.x] === EMPTY || shown.board[cell.y][cell.x] === HIDDEN, `${key(cell)} shows no plant`);
  assert.deepEqual(cells.map(key), shown.covered.map(key), 'the mist is exactly the covered cells');
  const puffs = hiddenPuffCells(shown, O);
  assert.ok(puffs.map(key).includes('6,6'), 'a puff on the plot X just took');
  for (const cell of shown.covered) {
    const taken = state.board[cell.y][cell.x] !== EMPTY;
    assert.equal(puffs.some((p) => key(p) === key(cell)), taken, `${key(cell)}: a puff exactly on the taken plots`);
  }
  assert.deepEqual(hiddenPuffCells(state, X), [], 'the owner sees the plants, no puffs');
});

test('the cloud overlay: clipped at the edge, each cell once, cover wins where two clouds meet', () => {
  let state = eagleGame();
  state = useCloud(state, X, 0, 0);
  state = place(state, O, 14, 14);
  assert.equal(cloudOverlayCells(state, X).length, 9);
  // Two clouds of different owners overlapping (made by hand: only Cloud Eagle has the skill).
  const two = { ...state, clouds: [...state.clouds, { x: 2, y: 2, owner: O, turnsLeft: 2, placedTurn: state.turn }] };
  const cells = cloudOverlayCells(two, X);
  assert.equal(new Set(cells.map(key)).size, cells.length);
  assert.equal(cells.find((c) => c.x === 1 && c.y === 1).look, COVER);
  assert.equal(cells.find((c) => c.x === 0 && c.y === 0).look, COVER);
  assert.equal(cells.find((c) => c.x === 4 && c.y === 4).look, COVER);
  assert.deepEqual(cloudOverlayCells(eagleGame(), X), []);
});

// --- Sky Watch outlines ---

// X (Cloud Eagle) faces four O plants in a row on row 3: the open ends
// (0, 3) and (5, 3) are the Sky Watch cells.
function threatGame() {
  let state = eagleGame();
  for (let i = 1; i <= 4; i++) {
    state = place(state, X, 10, 2 * i); // scattered, no line of X
    state = place(state, O, i, 3);
  }
  return state;
}

test('Sky Watch outlines: the owner and spectators see the cells from skyWatchCells, the other seat none', () => {
  const state = threatGame();
  assert.equal(cloudEagleSide(state), X);
  const cells = skyWatchOutlineCells(maskForViewer(state, X), X).map(key);
  assert.deepEqual(cells, ['0,3', '5,3']);
  assert.deepEqual(skyWatchOutlineCells(state, null).map(key), ['0,3', '5,3']);
  assert.deepEqual(skyWatchOutlineCells(maskForViewer(state, O), O), []);
  // No Cloud Eagle in the game: no outlines.
  const plain = newGame({ characters: assignSides([WIND_RABBIT, EARTH_BEAR]) });
  assert.equal(cloudEagleSide(plain), null);
  assert.deepEqual(skyWatchOutlineCells(plain, null), []);
});

test('Sky Watch outlines are redrawn when the board changes, and none once the round is over', () => {
  const overlayFor = createCloudOverlay();
  let state = threatGame();
  const first = overlayFor(state, X);
  const version = first.version;
  assert.deepEqual(first.skyWatch.map(key), ['0,3', '5,3']);
  assert.equal(overlayFor(state, X).version, version, 'the same state: nothing is worked out again');
  state = place(state, X, 0, 3); // X blocks one end
  assert.ok(overlayFor(state, X).version > version);
  assert.deepEqual(overlayFor(state, X).skyWatch.map(key), ['5,3'], 'the other end is still open');
  // The viewer changes: worked out again for it.
  assert.deepEqual(overlayFor(state, O).skyWatch, []);
  // O plays the other end and wins: no outlines after the round.
  state = place(state, O, 5, 3);
  assert.ok(state.winner);
  assert.deepEqual(skyWatchOutlineCells(state, X), []);
});

test('Sky Watch outlines never tell a cell under the other seat\'s cloud', () => {
  // O is Cloud Eagle here and hides X's four in a row; the outline cell
  // under O's own cloud is still shown to O (O sees under it).
  let state = newGame({ characters: assignSides([EARTH_BEAR, CLOUD_EAGLE]) });
  for (let i = 1; i <= 4; i++) {
    state = place(state, X, i, 3);
    state = place(state, O, 10, 2 * i);
  }
  assert.equal(cloudEagleSide(state), O);
  assert.deepEqual(skyWatchOutlineCells(maskForViewer(state, O), O).map(key), ['0,3', '5,3']);
  // A covered cell (from the viewer's masked state) is left out.
  const masked = { ...state, covered: [{ x: 0, y: 3 }] };
  assert.deepEqual(skyWatchOutlineCells(masked, O).map(key), ['5,3']);
});

test('the viewer of a view: the named viewer, null for a spectator, else the player to move', () => {
  const state = eagleGame();
  assert.equal(viewerOf({ state, viewer: O }), O);
  assert.equal(viewerOf({ state, viewer: null }), null);
  assert.equal(viewerOf({ state }), X);
  const local = createLocalGame({ characters: assignSides([CLOUD_EAGLE, EARTH_BEAR]) });
  assert.equal(local.getView().viewer, local.getView().state.currentPlayer);
});

test('the overlay tiles: a full cloud tile and a pale yellow Sky Watch outline', () => {
  const cloud = cloudTileGrid();
  assert.equal(cloud.width, OVERLAY_TILE_PX);
  assert.ok(cloud.pixels.every((pixel) => pixel !== null), 'the cloud tile fills the cell, so the cells join');
  const outline = skyWatchOutlineGrid();
  assert.equal(SKY_WATCH_COLOUR, CHARACTER_LOOK[CLOUD_EAGLE].colour);
  const colours = new Set(outline.pixels.filter(Boolean));
  assert.deepEqual([...colours], [SKY_WATCH_COLOUR]);
  assert.equal(outline.pixels[(OVERLAY_TILE_PX / 2) * OVERLAY_TILE_PX + OVERLAY_TILE_PX / 2], null, 'the middle stays open');
});
