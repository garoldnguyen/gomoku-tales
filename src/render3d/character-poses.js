// Pure animation logic for the living pieces and characters
// (docs/art-direction-hd2d.md sections D and G). Which pose Wind Rabbit and
// Earth Bear show (idle, cast, win or lose) and which sheet frame that is,
// the pop-in bounce of a placed piece, and the gentle glow of the current
// player's character. Everything here only follows the events returned by
// src/logic; nothing feeds back into the rules. No DOM or Three.js, so it
// runs under node --test.

import {
  CHARACTER_CAST_FRAME_MS, CHARACTER_CAST_MS, CHARACTER_GLOW_FADE_MS, CHARACTER_GLOW_PULSE_MS,
  CHARACTER_IDLE_FRAME_MS, CHARACTER_POSE_FRAME_MS, CHARACTER_X, PIECE_POP_IN_MS, SHOW_WORLD_CHARACTERS,
} from '../config.js';
import { frameAt } from './sprite-frames.js';

// Where the characters stand in the world, { player, x, phaseMs } each:
// Wind Rabbit (X) on the left, Earth Bear (O) on the right, their idle
// bobs offset so they do not move in step. Empty while `show` is off
// (SHOW_WORLD_CHARACTERS, false for now: the HUD cards carry the
// characters). Only the drawing depends on it; the poses keep following
// the events and nothing in the rules reads them.
export function worldCharacterSpots(show = SHOW_WORLD_CHARACTERS) {
  if (!show) return [];
  return [
    { player: 'X', x: -CHARACTER_X, phaseMs: 0 },
    { player: 'O', x: CHARACTER_X, phaseMs: CHARACTER_IDLE_FRAME_MS * 2 },
  ];
}

// The poses in a character sheet, in order, all frames in one row:
// 4 idle bob frames, 4 cast frames (the last one holds), then 2 win and 2
// lose frames that loop.
export const CHARACTER_ANIMS = {
  idle: { start: 0, count: 4, frameMs: CHARACTER_IDLE_FRAME_MS, loop: true },
  cast: { start: 4, count: 4, frameMs: CHARACTER_CAST_FRAME_MS, loop: false },
  win: { start: 8, count: 2, frameMs: CHARACTER_POSE_FRAME_MS, loop: true },
  lose: { start: 10, count: 2, frameMs: CHARACTER_POSE_FRAME_MS, loop: true },
};

export const CHARACTER_FRAME_COUNT = Object.values(CHARACTER_ANIMS).reduce((n, anim) => n + anim.count, 0);

// Sheet frame index for `pose` shown for `ageMs`.
export function characterFrame(pose, ageMs) {
  const anim = CHARACTER_ANIMS[pose] ?? CHARACTER_ANIMS.idle;
  return anim.start + frameAt(ageMs, anim.count, anim.frameMs, anim); // anim carries `loop`
}

// Follows logic events to choose each character's pose. A 'skillUsed'
// event makes its player cast for CHARACTER_CAST_MS. A 'win' event puts the
// winner in the win pose and the other character in the lose pose until
// reset(); a caster finishes the cast first. Characters are 'X' and 'O'.
export function createCharacterDirector() {
  let castStart = {};
  let result = null; // { winner, at }

  return {
    // `events` from src/logic, applied at time `now` (ms).
    trigger(events, now) {
      for (const event of events) {
        if (event.type === 'skillUsed') castStart[event.player] = now;
        else if (event.type === 'win') result = { winner: event.player, at: now };
      }
    },

    // A new game: everyone is idle again.
    reset() {
      castStart = {};
      result = null;
    },

    // { pose, ageMs } for `player` at `now`; ageMs is how long the pose has
    // shown, except idle, which runs on `now` so it never restarts.
    poseAt(player, now) {
      return poseAtInto(player, now, { pose: 'idle', ageMs: 0 });
    },

    // poseAt written into `out` { pose, ageMs } (no allocation, for the
    // render loop). Returns `out`.
    poseAtInto,
  };

  function poseAtInto(player, now, out) {
    const start = castStart[player];
    const casting = start !== undefined && now >= start && now - start < CHARACTER_CAST_MS;
    if (casting) {
      out.pose = 'cast';
      out.ageMs = now - start;
    } else if (result) {
      const from = Math.max(result.at, start !== undefined ? start + CHARACTER_CAST_MS : -Infinity);
      out.pose = result.winner === player ? 'win' : 'lose';
      out.ageMs = Math.max(0, now - from);
    } else {
      out.pose = 'idle';
      out.ageMs = now;
    }
    return out;
  }
}

// Cells where a placed stone pops in. Pieces that arrive another way (a
// Wind Dash, a thrown stone, a falling rock, a converted stone) are shown
// arriving by their skill visuals instead (src/render3d/effects3d.js).
export function popCellsForEvents(events) {
  const cells = [];
  for (const event of events) {
    if (event.type === 'stonePlaced') cells.push({ x: event.x, y: event.y });
  }
  return cells;
}

const POP_MIN_SCALE = 0.2; // a piece starts this small, never at zero size
const POP_OVERSHOOT = 1.7; // how far past full size the bounce goes (ease out back)

// Scale { x, y } of a piece `ageMs` after it was placed: it grows from
// small, overshoots a little (stretched taller than wide), settles back and
// is exactly { x: 1, y: 1 } from PIECE_POP_IN_MS on.
export function popInScale(ageMs, durationMs = PIECE_POP_IN_MS) {
  return popInScaleInto(ageMs, { x: 1, y: 1 }, durationMs);
}

// popInScale writing into out.x and out.y, for per-frame use without
// allocations.
export function popInScaleInto(ageMs, out, durationMs = PIECE_POP_IN_MS) {
  if (!(ageMs < durationMs)) {
    out.x = 1;
    out.y = 1;
    return out;
  }
  const t = Math.max(0, ageMs) / durationMs;
  const u = t - 1;
  const grow = 1 + (POP_OVERSHOOT + 1) * u * u * u + POP_OVERSHOOT * u * u; // ease out back
  const s = POP_MIN_SCALE + (1 - POP_MIN_SCALE) * grow;
  const stretch = 0.12 * Math.sin(Math.PI * t); // squash and stretch
  out.x = s * (1 - stretch);
  out.y = s * (1 + stretch);
  return out;
}

// The glow of a character moves towards 1 while its player is to move and
// towards 0 otherwise, taking CHARACTER_GLOW_FADE_MS for the whole way.
export function stepGlow(level, on, dtMs, fadeMs = CHARACTER_GLOW_FADE_MS) {
  const step = fadeMs > 0 ? Math.max(0, dtMs) / fadeMs : 1;
  return on ? Math.min(1, level + step) : Math.max(0, level - step);
}

// A slow breath for the glow, between 0.6 and 1, one cycle every
// CHARACTER_GLOW_PULSE_MS.
export function glowPulse(timeMs, pulseMs = CHARACTER_GLOW_PULSE_MS) {
  return 0.8 + 0.2 * Math.sin((2 * Math.PI * timeMs) / pulseMs);
}
