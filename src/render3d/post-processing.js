// Post-processing for the HD-2D scene (docs/art-direction-hd2d.md section E),
// using only passes that ship with Three.js:
//   render -> depth of field (BokehPass on HIGH, tilt shift pair on MEDIUM)
//          -> bloom (UnrealBloomPass) -> vignette -> tone mapping and sRGB (OutputPass)
// Every pass is built once; a quality level (src/render3d/quality.js) only
// turns passes on and off. LOW skips the composer and renders straight to
// the screen, where the renderer applies the same tone mapping.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import {
  BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD, DOF_APERTURE, DOF_MAX_BLUR, TILT_SHIFT_BLUR,
  TONE_MAPPING_EXPOSURE, VIGNETTE_DARKNESS, VIGNETTE_OFFSET,
} from '../config.js';
import { QUALITY_LEVELS } from './quality.js';

// The camera looks at the board centre, so it sits in the middle of the screen.
const TILT_SHIFT_FOCUS_LINE = 0.5;

// renderer   a THREE.WebGLRenderer
// focusDistance  distance from the camera to the board centre (depth of field focus)
export function createPostProcessing(renderer, scene, camera, focusDistance) {
  // Neutral tone mapping keeps the candy colours' hue and saturation.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;

  const composer = new EffectComposer(renderer); // half float buffers keep bright values for bloom
  composer.addPass(new RenderPass(scene, camera));

  const bokeh = new BokehPass(scene, camera, {
    focus: focusDistance,
    aperture: DOF_APERTURE,
    maxblur: DOF_MAX_BLUR,
  });
  composer.addPass(bokeh);

  const tiltH = new ShaderPass(HorizontalTiltShiftShader);
  const tiltV = new ShaderPass(VerticalTiltShiftShader);
  tiltH.uniforms.r.value = TILT_SHIFT_FOCUS_LINE;
  tiltV.uniforms.r.value = TILT_SHIFT_FOCUS_LINE;
  composer.addPass(tiltH);
  composer.addPass(tiltV);

  let bloomResolution = 1;
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
  // The composer sizes every pass to the full render size; bloom may run smaller.
  const fullBloomSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (width, height) => {
    fullBloomSetSize(Math.max(1, Math.round(width * bloomResolution)), Math.max(1, Math.round(height * bloomResolution)));
  };
  composer.addPass(bloom);

  const vignette = new ShaderPass(VignetteShader);
  vignette.uniforms.offset.value = VIGNETTE_OFFSET;
  vignette.uniforms.darkness.value = VIGNETTE_DARKNESS;
  composer.addPass(vignette);

  composer.addPass(new OutputPass());

  let level = QUALITY_LEVELS.LOW;
  const size = new THREE.Vector2();

  // Matches the composer to the renderer's drawing buffer size.
  function resize() {
    renderer.getSize(size);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    // The tilt shift blur is in pixels, so it follows the buffer size.
    const width = size.x * renderer.getPixelRatio();
    const height = size.y * renderer.getPixelRatio();
    tiltH.uniforms.h.value = TILT_SHIFT_BLUR / width;
    tiltV.uniforms.v.value = TILT_SHIFT_BLUR / height;
  }

  return {
    // levelName is a key of QUALITY_LEVELS.
    setLevel(levelName) {
      level = QUALITY_LEVELS[levelName];
      bokeh.enabled = level.depthOfField === 'bokeh';
      tiltH.enabled = level.depthOfField === 'tiltShift';
      tiltV.enabled = level.depthOfField === 'tiltShift';
      bloom.enabled = level.bloom;
      vignette.enabled = level.vignette;
      if (level.bloom && level.bloomResolution !== bloomResolution) {
        bloomResolution = level.bloomResolution;
        resize();
      }
    },
    resize,
    render(deltaSeconds) {
      if (level.postProcessing) composer.render(deltaSeconds);
      else renderer.render(scene, camera);
    },
  };
}
