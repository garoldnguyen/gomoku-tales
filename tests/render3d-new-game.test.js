// The renderer reset of a new game (a rematch or a local restart, step 6
// of docs/flow-design.md): after reset() and a fresh board, nothing of the
// old game is left in the 3D scene: no plant sprites or growth, no win line
// or last move decal, no rock, no pending Wind Dash marker, no Tornado Zone
// swirl, no banner. Built on the Three.js stand-ins of fake-browser.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { X, O } from '../src/logic/board.js';
import { TERRAIN_CREATION, TORNADO_ZONE, WIND_DASH } from '../src/logic/skills.js';
import { fakeCanvas, fakeRenderer, installFakeDocument } from './fake-browser.js';

const hook = `
const root = ${JSON.stringify(new URL('../', import.meta.url).href)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: root + 'vendor/three/build/three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: root + 'vendor/three/examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);

// Every visible object of the scene (with all its parents visible), with
// the instance count of instanced meshes.
function visibleObjects(scene) {
  const found = new Map();
  const walk = (object) => {
    if (!object.visible) return;
    found.set(object.uuid, object.isInstancedMesh ? object.count : true);
    for (const child of object.children) walk(child);
  };
  walk(scene);
  return found;
}

for (const quality of ['low', 'high']) {
  test(`reset() and a new game leave nothing of the old game in the scene (${quality})`, async () => {
    installFakeDocument();
    const { createWorldRenderer } = await import('../src/render3d/world-renderer.js');
    const { createLocalGame } = await import('../src/ui/local-game.js');
    const gl = fakeRenderer();
    const renderer = createWorldRenderer(fakeCanvas(), { storage: null, quality, createRenderer: () => gl });
    const game = createLocalGame({ random: () => 0 });
    const ctx = fakeCanvas().getContext('2d');
    let time = 1000;
    const frames = (n = 1) => {
      for (let i = 0; i < n; i++) {
        time += 16;
        renderer.trigger(game.takeEvents(), time);
        renderer.drawGameScreen(ctx, { ...game.getView(), time });
      }
    };

    frames(5);
    const fresh = visibleObjects(gl.scene);

    // Game 1: plants, a rock, a Tornado Zone, then Earth Bear wins while a
    // Wind Dash is still pending; the new game starts a few frames after
    // the winning move, with the effects still running.
    // A skill does not end the turn (Free Action), so each skill is followed
    // by the planting of the same player.
    const moves = [
      () => game.click({ x: 7, y: 7 }), // X
      () => game.clickSkill(O, TERRAIN_CREATION) && game.click({ x: 14, y: 14 }),
      () => game.click({ x: 0, y: 6 }),
      () => game.clickSkill(X, TORNADO_ZONE) && game.click({ x: 10, y: 10 }),
      () => game.click({ x: 1, y: 0 }),
      () => game.click({ x: 1, y: 6 }),
      () => game.click({ x: 2, y: 0 }),
      () => game.click({ x: 2, y: 6 }),
      () => game.click({ x: 3, y: 0 }),
      () => game.click({ x: 3, y: 6 }),
      () => game.clickSkill(X, WIND_DASH) && game.click({ x: 7, y: 7 }) === false && game.click({ x: 7, y: 9 }),
      () => game.click({ x: 4, y: 0 }),
      () => game.click({ x: 4, y: 6 }),
    ];
    moves.forEach((move, i) => {
      assert.ok(move(), `move ${i}`);
      frames(i === moves.length - 1 ? 2 : 40);
    });
    assert.equal(game.getState().winner, O);
    assert.notDeepEqual(visibleObjects(gl.scene), fresh, 'the old game shows in the scene');

    // The new game (main.js: watchNewGame calls renderer.reset()).
    game.rematchLocal();
    renderer.reset();
    frames(5);
    assert.deepEqual(visibleObjects(gl.scene), fresh, 'the scene is the same as at the start of the first game');
  });
}
