// Post-processing for the farmland scene, using passes that ship with
// Three.js plus one small depth of field pass of our own:
//   render -> depth of field -> bloom (UnrealBloomPass)
//          -> vignette -> tone mapping and sRGB (OutputPass)
// Every pass is built once; the postEffects switches of the quality table
// (src/render3d/quality.js) only turn passes on and off. With every switch
// off (low and medium: no blur at all) the composer is skipped and the
// scene renders straight to the screen, where the renderer applies the same
// tone mapping. The warm grade switch is drawn by a later part
// (docs/art-direction-v3.md section 5 and task part 9).
//
// The depth of field reads the depth buffer of the scene render itself, so
// the depth comes from each object's own material: a sprite writes depth
// only where its alpha test keeps a pixel, and soft see-through quads
// (wisps, rays, petals, ghost trails, decals) write none. (Three.js's
// BokehPass drew the scene again with one plain depth material, which made
// every sprite quad a solid rectangle in depth: the blur on High.) The blur
// radius is the one of blurRadius in depth-of-field.js, worked out every
// frame from the live camera, and is exactly 0 on the field and its
// surroundings.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import {
  BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD, TONE_MAPPING_EXPOSURE, VIGNETTE_DARKNESS, VIGNETTE_OFFSET,
} from '../config.js';
import { createDofState, updateDofUniforms } from './depth-of-field.js';

const DOF_TAPS = 12; // samples of the blur disc

// renderer   a THREE.WebGLRenderer
// camera     the world's live camera: the blur reads its pose every frame
export function createPostProcessing(renderer, scene, camera) {
  // Neutral tone mapping keeps the candy colours' hue and saturation.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;

  // Half float buffers keep bright values for bloom. Both buffers carry a
  // depth texture, so the depth of field reads the scene render's own depth.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  const depthOfField = new DepthOfFieldPass(camera);
  composer.addPass(depthOfField);

  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
  composer.addPass(bloom);

  const vignette = new ShaderPass(VignetteShader);
  vignette.uniforms.offset.value = VIGNETTE_OFFSET;
  vignette.uniforms.darkness.value = VIGNETTE_DARKNESS;
  composer.addPass(vignette);

  composer.addPass(new OutputPass());

  let useComposer = false;
  const size = new THREE.Vector2();

  // Matches the composer to the renderer's drawing buffer size.
  function resize() {
    renderer.getSize(size);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
  }

  return {
    // postEffects is the postEffects row of a quality level.
    setEffects(postEffects) {
      depthOfField.enabled = postEffects.depthOfField;
      bloom.enabled = postEffects.bloom;
      vignette.enabled = postEffects.vignette;
      useComposer = postEffects.depthOfField || postEffects.bloom || postEffects.vignette || postEffects.warmGrade;
    },
    resize,
    render(deltaSeconds) {
      if (useComposer) composer.render(deltaSeconds);
      else renderer.render(scene, camera);
    },
  };
}

// Blurs each pixel by blurRadius (depth-of-field.js) of its depth, with a
// disc of DOF_TAPS samples. A sample counts only when it is at least as
// blurred as its distance, so sharp things never bleed into the blur
// around them. A radius of 0 copies the pixel unchanged.
const DOF_FRAGMENT = /* glsl */ `
  #include <packing>
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform float bandNear;
  uniform float bandFar;
  uniform float blurPerUnit;
  uniform float maxBlur;
  uniform float aspect;
  varying vec2 vUv;

  float blurAt(vec2 uv) {
    float depth = -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
    float outside = max(bandNear - depth, 0.0) + max(depth - bandFar, 0.0);
    return min(maxBlur, outside * blurPerUnit);
  }

  void main() {
    vec4 centre = texture2D(tColor, vUv);
    float radius = blurAt(vUv);
    if (radius <= 0.0) {
      gl_FragColor = centre;
      return;
    }
    vec4 sum = centre;
    float weight = 1.0;
    for (int i = 0; i < TAPS; i++) {
      float angle = float(i) * 2.39996323; // the golden angle
      float reach = sqrt((float(i) + 0.5) / float(TAPS)) * radius;
      vec2 uv = vUv + vec2(cos(angle) * reach / aspect, sin(angle) * reach);
      float w = step(reach, blurAt(uv));
      sum += texture2D(tColor, uv) * w;
      weight += w;
    }
    gl_FragColor = sum / weight;
  }
`;

const DOF_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export class DepthOfFieldPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera; // the live camera, never a copy
    this.state = createDofState();
    this.material = new THREE.ShaderMaterial({
      defines: { TAPS: DOF_TAPS },
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        cameraNear: { value: 0 },
        cameraFar: { value: 0 },
        bandNear: { value: 0 },
        bandFar: { value: 0 },
        blurPerUnit: { value: 0 },
        maxBlur: { value: 0 },
        aspect: { value: 1 },
      },
      vertexShader: DOF_VERTEX,
      fragmentShader: DOF_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  render(renderer, writeBuffer, readBuffer) {
    const { uniforms } = this.material;
    updateDofUniforms(uniforms, this.camera, this.state);
    uniforms.tColor.value = readBuffer.texture;
    uniforms.tDepth.value = readBuffer.depthTexture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
