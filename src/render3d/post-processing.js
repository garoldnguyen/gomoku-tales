// Post-processing for the farmland scene, using only passes that ship with
// Three.js:
//   render -> depth of field (BokehPass) -> bloom (UnrealBloomPass)
//          -> vignette -> tone mapping and sRGB (OutputPass)
// Every pass is built once; the postEffects switches of the quality table
// (src/render3d/quality.js) only turn passes on and off. With every switch
// off (low and medium: no blur at all) the composer is skipped and the
// scene renders straight to the screen, where the renderer applies the same
// tone mapping. The warm grade switch is drawn by a later part
// (docs/art-direction-v3.md section 5 and task part 9).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import {
  BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD, DOF_APERTURE, DOF_MAX_BLUR,
  TONE_MAPPING_EXPOSURE, VIGNETTE_DARKNESS, VIGNETTE_OFFSET,
} from '../config.js';

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
      bokeh.enabled = postEffects.depthOfField;
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
