// The farmland board (docs/art-direction-v3.md section 3): the 15 by 15
// field of tilled plots, the wooden curb around it, and on levels with
// scenery the fence and the dirt path with its stepping stones. The layout
// is in farm-layout.js. Wood appears only on the curb and the fence.

import * as THREE from 'three';
import { CURB_FACE_PX, CURB_LIFT_PX, CURB_PX, PX_WORLD, SPRITE_STRETCH_Y } from '../config.js';
import { artSource } from './art.js';
import { ART } from './art-assets.js';
import { CURB, CURB_SIDES, curbTopCorners, FENCE_RAIL_HEIGHTS, fencePosts, fenceRails, FIELD, PATH, pathStones } from './farm-layout.js';
import { PixelSprite, pixelTexture } from './sprites.js';
import { terrainHeight } from './terrain.js';

const CURB_TILE = 32 * PX_WORLD; // curb-wood is 32 px long
const RAIL_TILE = 16 * PX_WORLD; // fence-rail is 16 px long
const RAIL_THICKNESS_PX = 6;
const PATH_TILE = 32 * PX_WORLD; // path-tile repeats every 32 px in y
const PATH_LIFT = 0.006; // keeps the path just above the meadow
const PATH_SEGMENTS = 10; // the path follows the ground along its length
const COLORS = {
  curbFace: 0xa8a8a8, // the front face is the curb wood, darker
  curbInner: 0xc0c0c0,
  soilBank: 0x6b4430, // the bank under the curb face down to the meadow
};

// Builds the farm into `scene`; posts and stepping stones are upright
// sprites added with `addSprite` (see world.js). Returns { setFeatures }
// for a quality table row (src/render3d/quality.js): boardTexture picks
// the field texture and scenery shows the fence and the path.
export function createFarmField(scene, addSprite) {
  const fieldTextures = new Map(); // board texture name -> texture, made once each
  const fieldTexture = (name) => {
    if (!fieldTextures.has(name)) fieldTextures.set(name, pixelTexture(artSource(name)));
    return fieldTextures.get(name);
  };

  // The field: one plane over exactly the picked cells. On a PlaneGeometry
  // turned flat the texture's top row lies at -z, so row 0 is the far edge,
  // matching src/render3d/picking.js.
  const fieldMaterial = new THREE.MeshStandardMaterial({ map: fieldTexture(ART.v3.board.field), roughness: 0.95 });
  const field = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.size, FIELD.size).rotateX(-Math.PI / 2), fieldMaterial);
  field.position.y = FIELD.y;
  field.receiveShadow = true;
  scene.add(field);

  scene.add(createCurb());

  // Fence and path: scenery, Medium and High only.
  const extras = new THREE.Group();
  const extraSprites = [];
  const postSheet = artSource(ART.v3.fencePost);
  for (const post of fencePosts()) {
    const sprite = addSprite(new PixelSprite({ sheet: postSheet }).placeAt(post.x, CURB.ground, post.z));
    extraSprites.push(sprite);
  }
  for (const run of fenceRails()) {
    for (const height of FENCE_RAIL_HEIGHTS) extras.add(createRail(run, height));
  }
  extras.add(createPath());
  const stoneSheet = artSource(ART.v3.pebble);
  for (const stone of pathStones()) {
    const y = Math.max(terrainHeight(stone.x, stone.z), CURB.ground);
    extraSprites.push(addSprite(new PixelSprite({ sheet: stoneSheet }).placeAt(stone.x, y, stone.z)));
  }
  scene.add(extras);

  return {
    setFeatures(features) {
      const map = fieldTexture(features.boardTexture);
      if (fieldMaterial.map !== map) {
        fieldMaterial.map = map;
        fieldMaterial.needsUpdate = true;
      }
      extras.visible = features.scenery;
      for (const sprite of extraSprites) sprite.object.visible = features.scenery;
    },
  };
}

// The curb: a mitred wooden top just above the plots, a darker wooden face
// CURB.faceHeight tall on the outside and a soil bank under it down to the
// meadow, plus a thin inner face up from the plots. Material groups: 0 top,
// 1 face, 2 inner face, 3 soil bank.
function createCurb() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const groups = [[], [], [], []]; // vertex indices per group
  let vertexCount = 0;

  // A quad from four [x, y, z] corners and their [u, v], wound so it faces
  // `normal`.
  const quad = (group, corners, quadUvs, normal) => {
    const [a, b, c] = corners;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const facing = cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2] > 0;
    const order = facing ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (let i = 0; i < 4; i++) {
      positions.push(...corners[i]);
      normals.push(...normal);
      uvs.push(...quadUvs[i]);
    }
    for (const i of order) groups[group].push(vertexCount + i);
    vertexCount += 4;
  };

  const top = CURB.top;
  const faceRows = CURB_FACE_PX / CURB_PX; // of the 8 rows of curb-wood
  const innerRows = CURB_LIFT_PX / CURB_PX;
  const faceBottom = top - CURB.faceHeight;
  const corners = curbTopCorners();
  const outer = corners[2].along;
  for (const side of CURB_SIDES) {
    const at = (along, across, y) => {
      const p = side.toWorld(along, across);
      return [p.x, y, p.z];
    };
    const out = [side.outward.x, 0, side.outward.z];
    // Top: u runs along the side (one texture length per CURB_TILE), v
    // from the field edge (0) to the outer edge (1).
    quad(0, corners.map((c) => at(c.along, c.across, top)),
      corners.map((c) => [c.along / CURB_TILE, c.across / CURB.width]), [0, 1, 0]);
    // Outer face: the top CURB_FACE_PX rows of wood, darker.
    quad(1, [at(-outer, CURB.width, top), at(outer, CURB.width, top), at(outer, CURB.width, faceBottom), at(-outer, CURB.width, faceBottom)],
      [[-outer / CURB_TILE, 1], [outer / CURB_TILE, 1], [outer / CURB_TILE, 1 - faceRows], [-outer / CURB_TILE, 1 - faceRows]], out);
    // Inner face from the plots up to the curb top.
    const inward = [-out[0], 0, -out[2]];
    quad(2, [at(-CURB.inner, 0, top), at(CURB.inner, 0, top), at(CURB.inner, 0, FIELD.y), at(-CURB.inner, 0, FIELD.y)],
      [[-CURB.inner / CURB_TILE, innerRows], [CURB.inner / CURB_TILE, innerRows], [CURB.inner / CURB_TILE, 0], [-CURB.inner / CURB_TILE, 0]], inward);
    // Soil bank below the face, a little into the ground.
    const bankBottom = CURB.ground - 0.05;
    quad(3, [at(-outer, CURB.width, faceBottom), at(outer, CURB.width, faceBottom), at(outer, CURB.width, bankBottom), at(-outer, CURB.width, bankBottom)],
      [[0, 1], [1, 1], [1, 0], [0, 0]], out);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const indices = [];
  groups.forEach((list, i) => {
    geometry.addGroup(indices.length, list.length, i);
    indices.push(...list);
  });
  geometry.setIndex(indices);

  const wood = repeatingTexture(artSource(ART.v3.curb));
  const mesh = new THREE.Mesh(geometry, [
    new THREE.MeshLambertMaterial({ map: wood }),
    new THREE.MeshLambertMaterial({ map: wood, color: COLORS.curbFace }),
    new THREE.MeshLambertMaterial({ map: wood, color: COLORS.curbInner }),
    new THREE.MeshLambertMaterial({ color: COLORS.soilBank }),
  ]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// A crisp pixel texture that tiles.
function repeatingTexture(source) {
  const texture = pixelTexture(source);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// One fence rail: an upright strip of fence-rail along a straight run,
// `height` above the ground at its centre.
const railTextures = new Map(); // run length -> texture
function createRail(run, height) {
  const length = Math.hypot(run.to.x - run.from.x, run.to.z - run.from.z);
  let texture = railTextures.get(length);
  if (!texture) {
    texture = repeatingTexture(artSource(ART.v3.fenceRail));
    texture.repeat.set(length / RAIL_TILE, 1);
    railTextures.set(length, texture);
  }
  const thickness = RAIL_THICKNESS_PX * PX_WORLD * SPRITE_STRETCH_Y;
  const material = new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide });
  const rail = new THREE.Mesh(new THREE.PlaneGeometry(length, thickness), material);
  rail.position.set((run.from.x + run.to.x) / 2, CURB.ground + height, (run.from.z + run.to.z) / 2);
  rail.rotation.y = -Math.atan2(run.to.z - run.from.z, run.to.x - run.from.x);
  rail.castShadow = true;
  return rail;
}

// The dirt path: path-tile repeated along z, following the ground.
function createPath() {
  const length = PATH.endZ - PATH.startZ;
  const geometry = new THREE.PlaneGeometry(PATH.width, length, 1, PATH_SEGMENTS).rotateX(-Math.PI / 2);
  geometry.translate(PATH.x, 0, (PATH.startZ + PATH.endZ) / 2);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const height = Math.max(terrainHeight(position.getX(i), position.getZ(i)), CURB.ground);
    position.setY(i, height + PATH_LIFT);
  }
  geometry.computeVertexNormals();
  const texture = repeatingTexture(artSource(ART.v3.path));
  texture.repeat.set(1, length / PATH_TILE);
  const path = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.5 }));
  path.receiveShadow = true;
  return path;
}
