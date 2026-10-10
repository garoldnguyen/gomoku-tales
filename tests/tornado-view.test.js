// The Tornado Zone seen through the real 3D renderer (fake browser): the zone
// is drawn from the viewer's state, so a secret zone is on the screen of the
// player who may see it and gone the moment the turn passes to the other seat,
// whether the events arrived in time, late or not at all. One screen (local
// play) is the case: the caster casts, is still to move (Free Action), plants,
// and the bear looks at the same screen next.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { O, X } from '../src/logic/board.js';
import { TORNADO_ZONE } from '../src/logic/skills.js';
import { visualsForEvents } from '../src/render3d/effect-plans.js';
import { createParticlePool, createSpawnParams } from '../src/render3d/particle-pool.js';
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

async function build() {
  installFakeDocument();
  const { createWorldRenderer } = await import('../src/render3d/world-renderer.js');
  const { createLocalGame } = await import('../src/ui/local-game.js');
  const { artSource } = await import('../src/render3d/art.js');
  const { ART } = await import('../src/render3d/art-assets.js');
  const gl = fakeRenderer();
  const renderer = createWorldRenderer(fakeCanvas(), { storage: null, quality: 'high', createRenderer: () => gl });
  const game = createLocalGame();
  const ctx = fakeCanvas().getContext('2d');
  const zoneSource = artSource(ART.v3.decal.zoneCross);
  let time = 1000;
  const frames = (count = 4) => {
    for (let i = 0; i < count; i++) {
      time += 16;
      renderer.drawGameScreen(ctx, { ...game.getView(), time });
    }
  };
  // Delivers the events of an action to the renderer, as main.js does.
  const deliver = () => renderer.trigger(game.takeEvents(), time, game.getState().characters);
  // The zone decals on the screen now: visible meshes that show the zone art.
  const zoneDecals = () => {
    let count = 0;
    gl.scene.traverse((object) => {
      if (object.visible && object.material?.map?.image === zoneSource) count++;
    });
    return count;
  };
  // How far the plants lean towards a zone on screen now: the sum of the
  // bend uniforms of every sprite (0 when nothing leans).
  const bendTotal = () => {
    let total = 0;
    gl.scene.traverse((object) => {
      const bend = object.material?.userData?.sway?.uBendPx;
      if (bend) total += Math.abs(bend.value);
    });
    return total;
  };
  return { game, renderer, frames, deliver, zoneDecals, bendTotal, now: () => time };
}

function cast(game, x = 7, y = 7) {
  assert.equal(game.clickSkill(X, TORNADO_ZONE), true);
  assert.equal(game.click({ x, y }), true);
}

test('one screen: the caster sees the zone before planting, the bear sees none once the turn passes', async () => {
  const { game, frames, deliver, zoneDecals } = await build();
  frames();
  assert.equal(zoneDecals(), 0, 'no zone before the cast');

  cast(game);
  deliver();
  frames();
  assert.equal(game.getState().currentPlayer, X, 'the cast does not end the turn');
  assert.equal(zoneDecals(), game.getState().tornado.cells.length, 'every zone cell is on the caster\'s screen');

  assert.equal(game.click({ x: 0, y: 0 }), true); // the planting that ends the turn
  deliver();
  frames();
  assert.equal(game.getState().currentPlayer, O);
  assert.equal(zoneDecals(), 0, 'nothing of the zone is drawn during the bear\'s turn');
  frames(60);
  assert.equal(zoneDecals(), 0, 'and it stays gone');
});

test('the zone follows the state even when the events never reach the renderer', async () => {
  const { game, frames, zoneDecals } = await build();
  cast(game, 4, 9);
  game.takeEvents(); // dropped: the renderer never heard of the cast
  frames();
  assert.equal(zoneDecals(), game.getState().tornado.cells.length, 'drawn from the caster\'s state');
  assert.equal(game.click({ x: 14, y: 14 }), true);
  game.takeEvents();
  frames();
  assert.equal(zoneDecals(), 0, 'gone for the bear');
});

test('events that arrive late (catch up) do not bring a hidden zone back', async () => {
  const { game, renderer, frames, zoneDecals, now } = await build();
  cast(game);
  const castEvents = game.takeEvents();
  assert.equal(game.click({ x: 0, y: 0 }), true);
  const plantEvents = game.takeEvents();
  // The page was hidden: the events of both actions pile up and are caught
  // up in one go, and the cast event on its own starts the swirl.
  renderer.catchUp([...castEvents, ...plantEvents], now());
  frames();
  assert.equal(game.getState().currentPlayer, O);
  assert.equal(zoneDecals(), 0, 'the bear\'s state hides the zone, whatever the late events said');
});

test('the caster sees the cross: 5 decals in the middle, 4 at an edge, 3 at a corner', async () => {
  for (const [x, y, count] of [[7, 7, 5], [7, 0, 4], [0, 7, 4], [14, 7, 4], [7, 14, 4], [0, 0, 3], [14, 14, 3]]) {
    const { game, frames, deliver, zoneDecals } = await build();
    cast(game, x, y);
    deliver();
    frames();
    assert.equal(game.getState().tornado.cells.length, count);
    assert.equal(zoneDecals(), count, `centre (${x}, ${y})`);
  }
});

test('plants lean towards the cross cells only, not towards its diagonal corners', async () => {
  const lean = async (plantAt) => {
    const { game, frames, deliver, bendTotal } = await build();
    assert.equal(game.click(plantAt), true); // X plants
    deliver();
    assert.equal(game.click({ x: 1, y: 1 }), true); // O plants
    deliver();
    frames(80);
    cast(game, 7, 7);
    deliver();
    frames(4);
    return bendTotal();
  };
  assert.ok(await lean({ x: 6, y: 7 }) > 0, 'an arm cell of the cross leans');
  assert.equal(await lean({ x: 6, y: 6 }), 0, 'a diagonal neighbour of the centre is outside the cross');
});

test('the very first frame of the bear\'s turn has no zone in it: no decal and no lean', async () => {
  const { game, frames, deliver, zoneDecals, bendTotal } = await build();
  assert.equal(game.click({ x: 6, y: 7 }), true); // X plants next to where the zone will be
  deliver();
  assert.equal(game.click({ x: 1, y: 1 }), true); // O plants
  deliver();
  frames(80); // the plants settle
  cast(game, 7, 7);
  deliver();
  frames(4);
  assert.ok(zoneDecals() > 0, 'the caster sees the zone');
  assert.ok(bendTotal() > 0, 'and the plant beside it leans towards it (High)');

  assert.equal(game.click({ x: 14, y: 14 }), true); // the planting that ends the turn
  deliver();
  frames(1); // ONE frame, the first one the bear sees
  assert.equal(game.getState().currentPlayer, O);
  assert.equal(zoneDecals(), 0, 'no zone decal on the first frame');
  assert.equal(bendTotal(), 0, 'no plant leans towards a zone the bear may not see, not even for one frame');
});

test('no visual but the swirl names the secret centre, so nothing is left round it after the turn passes', async () => {
  const { game } = await build();
  cast(game, 7, 7);
  const specs = visualsForEvents(game.takeEvents());
  assert.deepEqual(specs.map((spec) => spec.kind).filter((kind) => kind !== 'banner'), ['tornado'], 'the swirl, which syncTornado removes');
  const others = specs.filter((spec) => spec.kind !== 'tornado');
  assert.equal(JSON.stringify(others).includes('"x":7'), false, 'no cast ring, twinkle or other mark at the centre');
});

test('pool.removeSpiralAt removes only the particles circling that point', () => {
  const pool = createParticlePool(32);
  const p = createSpawnParams();
  p.life = 5;
  p.size = 0.1;
  const spawn = (x, z, kind) => {
    p.x = x;
    p.z = z;
    p.y = 0.1;
    p.radius = 0.5;
    p.angle = 0.3;
    if (kind === 'spiral') pool.spawnSpiral(p);
    else pool.spawnFall(p);
  };
  for (let i = 0; i < 4; i++) spawn(3.5, 4.5, 'spiral'); // the swirl of the zone
  for (let i = 0; i < 3; i++) spawn(8.5, 1.5, 'spiral'); // another spiral elsewhere
  for (let i = 0; i < 2; i++) spawn(3.5, 4.5, 'fall'); // falling dust at the same point
  assert.equal(pool.count, 9);
  pool.removeSpiralAt(3.5, 4.5);
  assert.equal(pool.count, 5, 'only the four spirals around the point are gone');
  let spirals = 0;
  for (let i = 0; i < pool.count; i++) if (pool.motion[i] === 1) spirals++;
  assert.equal(spirals, 3, 'the other spiral is untouched');
  pool.removeSpiralAt(3.5, 4.5);
  assert.equal(pool.count, 5, 'removing again changes nothing');
});
