// Wind Rabbit and Earth Bear beside the board (docs/art-direction-hd2d.md
// sections C, D and G): pixel sprites whose sheet holds every pose (idle
// bob, cast, win and lose, see character-poses.js; one art file per pose,
// see art-assets.js), and a gentle glow on the
// current player's character: a soft halo behind the sprite and a little
// extra brightness, both breathing slowly. The poses follow the events
// returned by src/logic through trigger(); nothing here touches the rules.
// Only the characters of worldCharacterSpots are drawn: none while
// SHOW_WORLD_CHARACTERS (src/config.js) is off.

import * as THREE from 'three';
import { combinedSheet } from './art.js';
import { ART } from './art-assets.js';
import {
  CHARACTER_FRAME_COUNT, characterFrame, createCharacterDirector, glowPulse, stepGlow, worldCharacterSpots,
} from './character-poses.js';
import { PixelSprite, pixelTexture, uprightPlaneGeometry } from './sprites.js';
import { GROUND_Y } from './terrain.js';

const SHADOW_RADIUS = 0.95;
const GLOW_COLOR = 0xfff0b8;
const GLOW_EMISSIVE = 0.22; // extra brightness of the sprite at full glow
const HALO_OPACITY = 0.5;
// The halo is drawn in art pixels like the sprites (one texel is PX_WORLD),
// a little wider than the 96 px character and resting on its feet.
const HALO_WIDTH_PX = 120;
const HALO_HEIGHT_PX = 100;
const HALO_STEPS = 5; // the halo fades out in a few flat bands, pixel-art style
const HALO_BEHIND = 0.05; // world units behind the sprite plane

// Builds both characters and adds their sprites with `addSprite` (see
// world.js). Returns the controller; call update(now, dtMs) every frame
// before the sprites update. `show` defaults to SHOW_WORLD_CHARACTERS.
export function createCharacters(addSprite, show) {
  const director = createCharacterDirector();
  const haloGeometry = uprightPlaneGeometry(HALO_WIDTH_PX, HALO_HEIGHT_PX);
  const haloMap = pixelTexture(drawHalo());
  let active = null;

  const make = (player, x, phaseMs) => {
    const sprite = addSprite(new PixelSprite({
      sheet: combinedSheet(Object.values(ART.character[player])),
      frameCount: CHARACTER_FRAME_COUNT,
      shadowRadius: SHADOW_RADIUS,
      frameFor: (timeMs) => {
        const { pose, ageMs } = director.poseAt(player, timeMs);
        return characterFrame(pose, pose === 'idle' ? ageMs + phaseMs : ageMs);
      },
    }).placeAt(x, GROUND_Y, 0));

    // The glow brightens the sprite's own colours: the emissive map is the
    // sprite sheet, so the frame offset applies to it too. It is set up
    // once here, so changing the glow never rebuilds a shader.
    const material = sprite.plane.material;
    material.emissive.set(GLOW_COLOR);
    material.emissiveMap = sprite.texture;
    material.emissiveIntensity = 0;

    // The halo hangs behind the plane and turns with it; the opaque sprite
    // pixels hide its middle, so it shows as a rim of light. It is tone
    // mapped like the rest, so it looks the same at every quality level.
    const halo = new THREE.Mesh(haloGeometry, new THREE.MeshBasicMaterial({
      map: haloMap,
      color: GLOW_COLOR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    halo.position.z = -HALO_BEHIND;
    halo.visible = false;
    sprite.plane.add(halo);
    return { sprite, material, halo, glow: 0 };
  };

  // Wind Rabbit (X) on the left, Earth Bear (O) on the right, when shown.
  const parts = {};
  for (const spot of worldCharacterSpots(show)) parts[spot.player] = make(spot.player, spot.x, spot.phaseMs);

  return {
    // Their sprites, null while not drawn.
    X: parts.X?.sprite ?? null,
    O: parts.O?.sprite ?? null,

    // Logic events at time `now`: 'skillUsed' casts, 'win' sets the win and
    // lose poses.
    trigger(events, now) {
      director.trigger(events, now);
    },

    // A new game: both idle.
    reset() {
      director.reset();
    },

    // The player to move ('X' or 'O') glows; null for nobody.
    setActive(player) {
      active = player;
    },

    update(now, dtMs) {
      for (const [player, part] of Object.entries(parts)) {
        part.glow = stepGlow(part.glow, active === player, dtMs);
        const strength = part.glow * glowPulse(now);
        part.material.emissiveIntensity = GLOW_EMISSIVE * strength;
        part.halo.material.opacity = HALO_OPACITY * strength;
        part.halo.visible = strength > 0;
      }
    },
  };
}

// A soft oval of light, brightest at the middle of the body, in flat bands.
function drawHalo() {
  const canvas = document.createElement('canvas');
  canvas.width = HALO_WIDTH_PX;
  canvas.height = HALO_HEIGHT_PX;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(HALO_WIDTH_PX, HALO_HEIGHT_PX);
  const cx = (HALO_WIDTH_PX - 1) / 2;
  const cy = (HALO_HEIGHT_PX - 1) / 2;
  for (let y = 0; y < HALO_HEIGHT_PX; y++) {
    for (let x = 0; x < HALO_WIDTH_PX; x++) {
      const d = Math.hypot((x - cx) / (HALO_WIDTH_PX / 2), (y - cy) / (HALO_HEIGHT_PX / 2));
      const level = Math.ceil(Math.max(0, 1 - d) * HALO_STEPS) / HALO_STEPS;
      const i = (y * HALO_WIDTH_PX + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = 255;
      image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(255 * level * level);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
