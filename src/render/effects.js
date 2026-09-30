// Placeholder effects (docs/design.md section 8): sparkles and dust puffs
// on placements and skill hits, a light screen shake, drifting wind streaks
// and short text banners for skill announcements. Effects only react to the
// events returned by the logic; they never read or change the game rules.
// Every function takes the time in ms, so it runs under Node for tests.

import {
  BANNER_MS, CELL_PX, DUST_COUNT, DUST_MS, INTERNAL_HEIGHT, INTERNAL_WIDTH,
  SHAKE_MS, SHAKE_PX, SPARKLE_COUNT, SPARKLE_MS, WIND_STREAK_COUNT, WIND_STREAK_SPEED,
} from '../config.js';
import { X } from '../logic/board.js';
import { getSkill } from '../logic/skills.js';
import { BOARD_Y, cellCenter } from './layout.js';

const COLORS = {
  sparkle: '#fffbe0',
  sparkleX: '#bfe0ff',
  sparkleO: '#ffc8cf',
  dust: '#c8a878',
  dustDark: '#8a6a44',
  streak: 'rgba(255, 255, 255, 0.35)',
  bannerBack: 'rgba(26, 16, 32, 0.8)',
  bannerEdge: '#ffe14d',
  bannerText: '#ffffff',
};

// What each logic event shows, as a list of effect specs:
//   { kind: 'sparkle', x, y, player? }  sparkles on a cell
//   { kind: 'dust', x, y }              a dust puff on a cell
//   { kind: 'shake' }                   a light screen shake
//   { kind: 'banner', text }            a short text banner
// Events not listed show nothing.
export function effectsForEvents(events) {
  return events.flatMap(effectsForEvent);
}

function hit(cell, player, { sparkle = true } = {}) {
  const specs = [];
  if (sparkle) specs.push({ kind: 'sparkle', x: cell.x, y: cell.y, player });
  specs.push({ kind: 'dust', x: cell.x, y: cell.y }, { kind: 'shake' });
  return specs;
}

function effectsForEvent(event) {
  switch (event.type) {
    case 'stonePlaced':
      return hit(event, event.player);
    case 'skillUsed': {
      const skill = getSkill(event.skill);
      return skill ? [{ kind: 'banner', text: `${skill.name}!` }] : [];
    }
    case 'dashResolved':
      return [{ kind: 'dust', x: event.from.x, y: event.from.y }, ...hit(event.to, event.player), { kind: 'banner', text: 'Wind Dash landed!' }];
    case 'dashFailed':
      return [{ kind: 'dust', x: event.from.x, y: event.from.y }, { kind: 'banner', text: 'Wind Dash failed!' }];
    case 'stoneThrown':
      // The thrown stone belongs to the player who placed it.
      return [{ kind: 'dust', x: event.from.x, y: event.from.y }, ...hit(event.to, event.player), { kind: 'banner', text: 'Whoosh!' }];
    case 'stoneConverted':
      return hit(event, event.player);
    case 'rockPlaced':
      return hit(event, null, { sparkle: false });
    case 'rockBroken':
      return [{ kind: 'dust', x: event.x, y: event.y }];
    default:
      return [];
  }
}

// Screen shake offset at `time` for a shake that started at `start`: it
// fades out over SHAKE_MS and is { dx: 0, dy: 0 } after that.
export function shakeOffset(start, time) {
  const age = time - start;
  if (start === null || age < 0 || age >= SHAKE_MS) return { dx: 0, dy: 0 };
  const strength = SHAKE_PX * (1 - age / SHAKE_MS);
  return {
    dx: Math.round(Math.sin(age * 0.09) * strength),
    dy: Math.round(Math.cos(age * 0.13) * strength),
  };
}

// Wind streak positions at `time`: WIND_STREAK_COUNT short lines that
// drift left to right and wrap around, above the board mostly (the sky and
// the upper hill). Deterministic, so both windows look alike.
export function windStreaks(time) {
  const streaks = [];
  const span = INTERNAL_WIDTH + 200;
  for (let i = 0; i < WIND_STREAK_COUNT; i++) {
    const length = 40 + ((i * 37) % 50);
    const speed = WIND_STREAK_SPEED * (0.7 + ((i * 13) % 7) / 10);
    const travelled = (time / 1000) * speed + i * (span / WIND_STREAK_COUNT);
    const x = (travelled % span) - length - 100;
    const baseY = 20 + ((i * 71) % (INTERNAL_HEIGHT - 40));
    const y = Math.round(baseY + Math.sin(time / 900 + i) * 4);
    streaks.push({ x: Math.round(x), y, length });
  }
  return streaks;
}

export function drawWindStreaks(ctx, time) {
  ctx.save();
  ctx.fillStyle = COLORS.streak;
  for (const { x, y, length } of windStreaks(time)) {
    ctx.fillRect(x, y, length, 2);
    ctx.fillRect(x + Math.round(length * 0.3), y - 3, Math.round(length * 0.4), 1);
  }
  ctx.restore();
}

// Live effects. options.random (default Math.random) scatters the sparkles
// and dust; it is for looks only and never touches the game.
export function createEffects(options = {}) {
  const { random = Math.random } = options;
  let particles = []; // { kind, px, py, vx, vy, start, life, color, size }
  // Banners queue up so every announcement shows for its full BANNER_MS,
  // one after another, even when one action gives several of them (a skill
  // used on the turn a pending Wind Dash resolves) or actions come fast.
  let banners = []; // { text, start }, in the order they show
  let shakeStart = null;

  const burst = (spec, time) => {
    const { px, py } = cellCenter(spec.x, spec.y);
    const sparkle = spec.kind === 'sparkle';
    const count = sparkle ? SPARKLE_COUNT : DUST_COUNT;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + random() * 0.6;
      const speed = sparkle ? 30 + random() * 40 : 12 + random() * 18;
      particles.push({
        kind: spec.kind,
        px,
        py: sparkle ? py : py + CELL_PX / 4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * (sparkle ? 1 : 0.4) - (sparkle ? 0 : 8),
        start: time,
        life: sparkle ? SPARKLE_MS : DUST_MS,
        color: sparkle ? sparkleColor(spec.player, i) : (i % 2 ? COLORS.dust : COLORS.dustDark),
        size: sparkle ? 2 + (i % 2) : 3 + Math.floor(random() * 2),
      });
    }
  };

  const prune = (time) => {
    particles = particles.filter((p) => time - p.start < p.life);
    banners = banners.filter((b) => time - b.start < BANNER_MS);
    if (shakeStart !== null && time - shakeStart >= SHAKE_MS) shakeStart = null;
  };

  return {
    // Starts the effects for the events of one applied action.
    trigger(events, time) {
      for (const spec of effectsForEvents(events)) {
        if (spec.kind === 'sparkle' || spec.kind === 'dust') burst(spec, time);
        else if (spec.kind === 'shake') shakeStart = time;
        else if (spec.kind === 'banner') {
          const last = banners[banners.length - 1];
          const start = last ? Math.max(time, last.start + BANNER_MS) : time;
          banners.push({ text: spec.text, start });
        }
      }
    },

    clear() {
      particles = [];
      banners = [];
      shakeStart = null;
    },

    shake(time) {
      return shakeOffset(shakeStart, time);
    },

    // What is alive at `time`, for tests and drawing. banners lists the
    // one showing and the ones still waiting their turn.
    active(time) {
      prune(time);
      return { particles: particles.length, banners: banners.map((b) => b.text), shaking: shakeStart !== null };
    },

    // Particles, drawn over the board.
    drawParticles(ctx, time) {
      prune(time);
      ctx.save();
      for (const p of particles) {
        const t = (time - p.start) / 1000;
        const fade = 1 - (time - p.start) / p.life;
        const x = Math.round(p.px + p.vx * t);
        const y = Math.round(p.py + p.vy * t + (p.kind === 'dust' ? 0 : 40 * t * t));
        ctx.globalAlpha = Math.max(0, fade);
        ctx.fillStyle = p.color;
        if (p.kind === 'sparkle') {
          // A small plus-shaped twinkle.
          ctx.fillRect(x - p.size, y, p.size * 2 + 1, 1);
          ctx.fillRect(x, y - p.size, 1, p.size * 2 + 1);
        } else {
          const size = p.size + Math.floor((1 - fade) * 3);
          ctx.fillRect(x - Math.floor(size / 2), y - Math.floor(size / 2), size, size);
        }
      }
      ctx.restore();
    },

    // The banner whose turn it is, sliding in above the board and fading out.
    drawBanner(ctx, time) {
      prune(time);
      const banner = banners[0];
      if (!banner || banner.start > time) return;
      const age = time - banner.start;
      const slide = Math.min(1, age / 150);
      const fade = age > BANNER_MS - 250 ? (BANNER_MS - age) / 250 : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade);
      ctx.font = 'bold 22px monospace';
      const w = Math.ceil(ctx.measureText(banner.text).width) + 40;
      const h = 36;
      const x = Math.round(INTERNAL_WIDTH / 2 - w / 2);
      const y = Math.round(BOARD_Y + 40 - (1 - slide) * 20);
      ctx.fillStyle = COLORS.bannerEdge;
      ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
      ctx.fillStyle = COLORS.bannerBack;
      ctx.fillRect(x, y, w, h);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.bannerText;
      ctx.fillText(banner.text, INTERNAL_WIDTH / 2, y + h / 2 + 1);
      ctx.restore();
    },
  };
}

function sparkleColor(player, i) {
  if (i % 2 === 0 || !player) return COLORS.sparkle;
  return player === X ? COLORS.sparkleX : COLORS.sparkleO;
}
