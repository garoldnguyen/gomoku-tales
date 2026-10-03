// Post-processing for the farmland scene, using passes that ship with
// Three.js plus one small depth of field pass of our own:
//   render -> depth of field -> bloom (UnrealBloomPass)
//          -> warm grade and vignette -> tone mapping and sRGB (OutputPass)
// Every pass is built once; the postEffects switches of the quality table
// (src/render3d/quality.js) only turn passes on and off, so a quality switch
// creates and replaces no texture, material or render target. With every
// switch off (low and medium: no blur at all) the composer is skipped and
// the scene renders straight to the screen, where the renderer applies the
// same tone mapping.
//
// The bloom threshold (BLOOM_THRESHOLD) lies above anything the lit scene
// and the sky reach, so only what GLOW lifts over it glows: while bloom is
// on, the sparkles (effects3d.js) and the bright wind petals (sky-scene.js)
// are drawn brighter through the shared GLOW uniforms.
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
import {
  BLOOM_PETAL_GLOW, BLOOM_RADIUS, BLOOM_SPARKLE_GLOW, BLOOM_STRENGTH, BLOOM_THRESHOLD, TONE_MAPPING_EXPOSURE,
  VIGNETTE_DARKNESS, VIGNETTE_OFFSET, WARM_GRADE_GAIN, WARM_GRADE_SATURATION,
} from '../config.js';
import { createDofState, updateDofUniforms } from './depth-of-field.js';

const DOF_TAPS = 12; // samples of the blur disc

// How much brighter sparkles and bright petals are drawn: 1 (no change)
// unless bloom is on. Shader materials share these uniform objects.
export const GLOW = Object.freeze({
  uSparkleGlow: { value: 1 },
  uPetalGlow: { value: 1 },
});

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

  const grade = new ShaderPass(GRADE_SHADER);
  composer.addPass(grade);

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
      GLOW.uSparkleGlow.value = postEffects.bloom ? BLOOM_SPARKLE_GLOW : 1;
      GLOW.uPetalGlow.value = postEffects.bloom ? BLOOM_PETAL_GLOW : 1;
      grade.enabled = postEffects.warmGrade || postEffects.vignette;
      grade.uniforms.uWarm.value = postEffects.warmGrade ? 1 : 0;
      grade.uniforms.uVignette.value = postEffects.vignette ? 1 : 0;
      useComposer = postEffects.depthOfField || postEffects.bloom || postEffects.vignette || postEffects.warmGrade;
    },
    resize,
    render(deltaSeconds) {
      if (useComposer) composer.render(deltaSeconds);
      else renderer.render(scene, camera);
    },
  };
}

// The warm grade and the light vignette in one pass, the same formulas as
// warmGrade and vignetteMix in screen-grade.js. Linear colour, before tone
// mapping (OutputPass).
const GRADE_SHADER = {
  name: 'WarmGradeVignette',
  uniforms: {
    tDiffuse: { value: null },
    uWarm: { value: 0 },
    uVignette: { value: 0 },
    uGain: { value: new THREE.Vector3(...WARM_GRADE_GAIN) },
    uSaturation: { value: WARM_GRADE_SATURATION },
    uOffset: { value: VIGNETTE_OFFSET },
    uDarkness: { value: Math.min(Math.max(VIGNETTE_DARKNESS, 0), 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uWarm;
    uniform float uVignette;
    uniform vec3 uGain;
    uniform float uSaturation;
    uniform float uOffset;
    uniform float uDarkness;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;
      if (uWarm > 0.5) {
        color *= uGain;
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = max(vec3(0.0), vec3(luma) + (color - vec3(luma)) * uSaturation);
      }
      if (uVignette > 0.5) {
        vec2 p = (vUv - 0.5) * uOffset;
        color *= 1.0 - dot(p, p) * uDarkness;
      }
      gl_FragColor = vec4(color, texel.a);
    }
  `,
};

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
