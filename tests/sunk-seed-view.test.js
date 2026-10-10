// A seed sunk in mud is drawn dim (SUNK_DIM) and pushed down. The sprites are
// made again when the quality level changes (the marks are tinted again), and
// the new ones must be dimmed again: the dim is not a cache that survives them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { SUNK_DIM } from '../src/config.js';
import { O } from '../src/logic/board.js';
import { MUD_TRAP } from '../src/logic/skills.js';
import { fakeCanvas, fakeRenderer, installFakeDocument } from './fake-browser.js';

// The browser maps "three" with an import map; Node needs the same mapping.
const hook = `
const root = ${JSON.stringify(new URL('../', import.meta.url).href)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: root + 'vendor/three/build/three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: root + 'vendor/three/examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);

test('a sunk seed stays dim after a quality switch makes its sprite again', async () => {
  installFakeDocument();
  const { createWorldRenderer } = await import('../src/render3d/world-renderer.js');
  const { createLocalGame } = await import('../src/ui/local-game.js');
  const gl = fakeRenderer();
  const renderer = createWorldRenderer(fakeCanvas(), { storage: null, quality: 'medium', createRenderer: () => gl });
  const game = createLocalGame();
  const ctx = fakeCanvas().getContext('2d');
  let time = 1000;
  const frames = (count) => {
    for (let i = 0; i < count; i++) {
      time += 16;
      renderer.drawGameScreen(ctx, { ...game.getView(), time });
    }
  };
  // Sprites drawn at the sunk brightness: planted sheets with the dim colour.
  const dimSprites = () => {
    let count = 0;
    gl.scene.traverse((object) => {
      const material = object.material;
      if (object.visible && material?.map && material.color && Math.abs(material.color.r - SUNK_DIM) < 1e-6) count++;
    });
    return count;
  };

  frames(2);
  const before = dimSprites();
  assert.equal(game.click({ x: 0, y: 0 }), true); // X
  renderer.trigger(game.takeEvents(), time, game.getState().characters);
  assert.equal(game.clickSkill(O, MUD_TRAP), true);
  assert.equal(game.click({ x: 3, y: 3 }), true); // a puddle
  assert.equal(game.click({ x: 3, y: 3 }), true); // O plants into its own puddle: a sunk seed
  renderer.trigger(game.takeEvents(), time, game.getState().characters);
  assert.equal(game.getState().sunk.length, 1);
  frames(60);
  assert.equal(dimSprites(), before + 1, 'the sunk seed is drawn dim');

  renderer.setQuality('high'); // the plant sprites are made again
  frames(60);
  assert.equal(dimSprites(), before + 1, 'and still dim on the new sprite');
  renderer.setQuality('low');
  frames(60);
  assert.equal(dimSprites(), before + 1, 'at every level');
});
