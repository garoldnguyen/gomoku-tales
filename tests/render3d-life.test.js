import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  CHARACTER_CAST_FRAME_MS, CHARACTER_CAST_MS, CHARACTER_GLOW_FADE_MS, CHARACTER_IDLE_FRAME_MS,
  CHARACTER_POSE_FRAME_MS, CHARACTER_SPRITE_PX, CHARACTER_X, PIECE_POP_IN_MS, SHOW_WORLD_CHARACTERS,
} from '../src/config.js';
import { O, X } from '../src/logic/board.js';
import { createInitialState, placeStone, useSkill } from '../src/logic/game.js';
import { MUD_TRAP } from '../src/logic/skills.js';
import {
  CHARACTER_ANIMS, CHARACTER_FRAME_COUNT, characterFrame, createCharacterDirector, glowPulse, popCellsForEvents,
  popInScale, stepGlow, worldCharacterSpots,
} from '../src/render3d/character-poses.js';
import { bearFrames, CHARACTER_POSES, rabbitFrames } from '../src/render3d/placeholder-art.js';

test('character animations sit side by side in one sheet row, in pose order', () => {
  let next = 0;
  for (const [name, anim] of Object.entries(CHARACTER_ANIMS)) {
    assert.equal(anim.start, next, `${name} starts right after the previous pose`);
    next += anim.count;
  }
  assert.equal(CHARACTER_FRAME_COUNT, next);
  assert.deepEqual(CHARACTER_POSES, Object.keys(CHARACTER_ANIMS));
  assert.equal(CHARACTER_ANIMS.idle.count, 4);
  assert.equal(CHARACTER_ANIMS.cast.count, 4);
});

test('characterFrame loops idle, win and lose and holds the last cast frame', () => {
  const { idle, cast, win, lose } = CHARACTER_ANIMS;
  assert.equal(characterFrame('idle', 0), idle.start);
  assert.equal(characterFrame('idle', CHARACTER_IDLE_FRAME_MS * 5), idle.start + 1);
  assert.equal(characterFrame('cast', 0), cast.start);
  assert.equal(characterFrame('cast', CHARACTER_CAST_FRAME_MS * 2), cast.start + 2);
  assert.equal(characterFrame('cast', CHARACTER_CAST_MS * 10), cast.start + cast.count - 1);
  assert.equal(characterFrame('win', CHARACTER_POSE_FRAME_MS), win.start + 1);
  assert.equal(characterFrame('win', CHARACTER_POSE_FRAME_MS * 2), win.start);
  assert.equal(characterFrame('lose', CHARACTER_POSE_FRAME_MS * 3), lose.start + 1);
  assert.equal(characterFrame('nonsense', 0), idle.start);
  for (let t = 0; t < 5000; t += 37) {
    for (const pose of CHARACTER_POSES) {
      const frame = characterFrame(pose, t);
      const anim = CHARACTER_ANIMS[pose];
      assert.ok(frame >= anim.start && frame < anim.start + anim.count, `${pose} stays in its own frames`);
    }
  }
});

test('the cast lasts long enough to show every cast frame', () => {
  assert.ok(CHARACTER_CAST_MS >= CHARACTER_ANIMS.cast.count * CHARACTER_CAST_FRAME_MS);
});

test('characters idle until their player uses a skill, then cast for CHARACTER_CAST_MS', () => {
  const director = createCharacterDirector();
  assert.deepEqual(director.poseAt(X, 500), { pose: 'idle', ageMs: 500 });
  director.trigger([{ type: 'stonePlaced', player: X, x: 1, y: 1 }, { type: 'turnEnded', player: X, turn: 1 }], 600);
  assert.equal(director.poseAt(X, 700).pose, 'idle', 'placing a stone is not a cast');

  director.trigger([{ type: 'skillUsed', player: O, skill: MUD_TRAP, target: { x: 2, y: 2 } }], 1000);
  assert.deepEqual(director.poseAt(O, 1000), { pose: 'cast', ageMs: 0 });
  assert.deepEqual(director.poseAt(O, 1250), { pose: 'cast', ageMs: 250 });
  assert.equal(director.poseAt(X, 1250).pose, 'idle', 'only the caster casts');
  assert.equal(director.poseAt(O, 1000 + CHARACTER_CAST_MS).pose, 'idle');
});

test('a win puts the winner in the win pose and the other character in the lose pose', () => {
  const director = createCharacterDirector();
  director.trigger([{ type: 'stonePlaced', player: X, x: 4, y: 0 }, { type: 'win', player: X, line: [] }], 2000);
  assert.deepEqual(director.poseAt(X, 2300), { pose: 'win', ageMs: 300 });
  assert.deepEqual(director.poseAt(O, 2300), { pose: 'lose', ageMs: 300 });
  assert.equal(director.poseAt(X, 99_000).pose, 'win', 'the pose stays until reset');
  director.reset();
  assert.equal(director.poseAt(X, 99_000).pose, 'idle');
  assert.equal(director.poseAt(O, 99_000).pose, 'idle');
});

test('a skill that wins the game finishes the cast before the win pose', () => {
  const director = createCharacterDirector();
  director.trigger([
    { type: 'skillUsed', player: O, skill: 'petrification', target: { x: 3, y: 3 } },
    { type: 'stonePetrified', player: O, x: 3, y: 3, from: X },
    { type: 'win', player: O, line: [] },
  ], 5000);
  assert.equal(director.poseAt(O, 5100).pose, 'cast');
  assert.equal(director.poseAt(X, 5100).pose, 'lose');
  assert.deepEqual(director.poseAt(O, 5000 + CHARACTER_CAST_MS + 40), { pose: 'win', ageMs: 40 });
});

test('the director follows real events from src/logic', () => {
  const director = createCharacterDirector();
  const placed = placeStone(createInitialState(), { player: X, x: 0, y: 0 });
  assert.equal(placed.ok, true);
  const skill = useSkill(placed.state, { player: O, skill: MUD_TRAP, target: { x: 7, y: 7 } });
  assert.equal(skill.ok, true, skill.error);
  director.trigger(placed.events, 100);
  director.trigger(skill.events, 200);
  assert.equal(director.poseAt(O, 300).pose, 'cast');
  assert.equal(director.poseAt(X, 300).pose, 'idle');
  // Feeding events to the director never changes them or the game.
  assert.deepEqual(popCellsForEvents(placed.events), [{ x: 0, y: 0 }]);
  assert.deepEqual(popCellsForEvents(skill.events), [], 'the puddle appears (effects3d.js) instead of a seed popping');
});

test('placed stones pop in; pieces that arrive by a skill are left to the skill visuals', () => {
  const cells = popCellsForEvents([
    { type: 'stonePlaced', player: X, x: 1, y: 2 },
    { type: 'mudPlaced', player: O, x: 3, y: 4, driesAfterTurn: 6 },
    { type: 'stonePetrified', player: O, x: 5, y: 6, from: X },
    { type: 'stoneSunk', player: O, x: 5, y: 7, surfacesAfterTurn: 5 },
    { type: 'stoneSurfaced', player: O, x: 5, y: 7 },
    { type: 'dashResolved', player: X, from: { x: 0, y: 0 }, to: { x: 7, y: 8 } },
    { type: 'stoneThrown', player: O, from: { x: 9, y: 9 }, to: { x: 10, y: 11 } },
    { type: 'skillUsed', player: X, skill: 'windDash', target: {} },
    { type: 'dashAnnounced', player: X, from: { x: 0, y: 0 }, to: { x: 7, y: 8 } },
    { type: 'dashFailed', player: X, from: { x: 0, y: 0 }, to: { x: 7, y: 8 }, reason: 'targetTaken' },
    { type: 'tornadoAnnounced', player: X, x: 5, y: 5, cells: [] },
    { type: 'throwBlocked', player: X, x: 5, y: 5 },
    { type: 'mudDried', player: O, x: 3, y: 4 },
    { type: 'turnEnded', player: X, turn: 3 },
    { type: 'win', player: X, line: [] },
  ]);
  assert.deepEqual(cells, [{ x: 1, y: 2 }]);
  assert.deepEqual(popCellsForEvents([]), []);
});

test('popInScale grows from small, bounces past full size and settles at exactly 1', () => {
  const start = popInScale(0);
  assert.ok(start.x > 0 && start.x < 0.5 && start.y > 0 && start.y < 0.5, 'starts small but never zero');
  let peak = 0;
  for (let t = 0; t < PIECE_POP_IN_MS; t += 4) peak = Math.max(peak, popInScale(t).x, popInScale(t).y);
  assert.ok(peak > 1.05, 'overshoots for the bounce');
  assert.ok(peak < 1.4, 'the bounce stays small');
  assert.deepEqual(popInScale(PIECE_POP_IN_MS), { x: 1, y: 1 });
  assert.deepEqual(popInScale(PIECE_POP_IN_MS * 50), { x: 1, y: 1 });
  const nearEnd = popInScale(PIECE_POP_IN_MS - 1);
  assert.ok(Math.abs(nearEnd.x - 1) < 0.02 && Math.abs(nearEnd.y - 1) < 0.02, 'no jump at the end');
  assert.deepEqual(popInScale(-50), start, 'times before the start show the start');
});

test('the glow fades in for the player to move and out for the other', () => {
  let level = 0;
  level = stepGlow(level, true, CHARACTER_GLOW_FADE_MS / 2);
  assert.ok(Math.abs(level - 0.5) < 1e-12);
  level = stepGlow(level, true, CHARACTER_GLOW_FADE_MS * 3);
  assert.equal(level, 1, 'never above 1');
  assert.equal(stepGlow(level, true, 0), 1);
  level = stepGlow(level, false, CHARACTER_GLOW_FADE_MS / 4);
  assert.ok(Math.abs(level - 0.75) < 1e-12);
  assert.equal(stepGlow(level, false, CHARACTER_GLOW_FADE_MS * 9), 0, 'never below 0');
  assert.equal(stepGlow(0.3, true, -100), 0.3, 'a negative step changes nothing');
});

test('the glow pulse breathes gently between 0.6 and 1', () => {
  let low = Infinity;
  let high = -Infinity;
  for (let t = 0; t < 10_000; t += 10) {
    const p = glowPulse(t);
    low = Math.min(low, p);
    high = Math.max(high, p);
  }
  assert.ok(low >= 0.6 - 1e-9 && low < 0.65);
  assert.ok(high <= 1 + 1e-9 && high > 0.95);
});

test('character sheets hold every pose at the configured size', () => {
  for (const frames of [rabbitFrames('all'), bearFrames('all')]) {
    assert.equal(frames.length, CHARACTER_FRAME_COUNT);
    for (const grid of frames) {
      assert.equal(grid.width, CHARACTER_SPRITE_PX);
      assert.equal(grid.height, CHARACTER_SPRITE_PX);
    }
    const { idle, cast, win, lose } = CHARACTER_ANIMS;
    // Each pose looks different from the idle bob.
    for (const start of [cast.start + 2, win.start, lose.start]) {
      assert.notDeepEqual(frames[start].pixels, frames[idle.start].pixels);
    }
    // The second win frame is a jump: the feet leave the bottom row.
    const bottomRow = (grid) => grid.pixels.slice(-grid.width);
    assert.ok(bottomRow(frames[win.start]).some(Boolean));
    assert.ok(!bottomRow(frames[win.start + 1]).some(Boolean));
  }
  for (const pose of CHARACTER_POSES) {
    assert.equal(rabbitFrames(pose).length, CHARACTER_ANIMS[pose].count);
    assert.equal(bearFrames(pose).length, CHARACTER_ANIMS[pose].count);
  }
});

test('SHOW_WORLD_CHARACTERS switches the world characters off for now, and back on in one line', () => {
  assert.equal(SHOW_WORLD_CHARACTERS, false, 'the HUD cards carry the characters for now');
  assert.deepEqual(worldCharacterSpots(), worldCharacterSpots(SHOW_WORLD_CHARACTERS));
  assert.deepEqual(worldCharacterSpots(false), [], 'nothing drawn while off');
  assert.deepEqual(worldCharacterSpots(true), [
    { player: 'X', x: -CHARACTER_X, phaseMs: 0 },
    { player: 'O', x: CHARACTER_X, phaseMs: CHARACTER_IDLE_FRAME_MS * 2 },
  ], 'Wind Rabbit left and Earth Bear right when on');
});

test('no rule, turn or skill code depends on the world characters being drawn', () => {
  // Only the drawing reads the switch; the logic, the HUD and the director never do.
  const files = [
    ...readdirSync(new URL('../src/logic/', import.meta.url)).map((f) => `logic/${f}`),
    ...readdirSync(new URL('../src/ui/', import.meta.url)).map((f) => `ui/${f}`),
    'render3d/world-renderer.js',
  ].filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.ok(!/SHOW_WORLD_CHARACTERS|worldCharacterSpots/.test(source), file);
  }
  const director = createCharacterDirector();
  director.trigger([{ type: 'skillUsed', player: X, skill: MUD_TRAP }], 0);
  assert.equal(director.poseAt(X, 0).pose, 'cast', 'the poses still follow the events');
});
