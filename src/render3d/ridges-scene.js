// The two soft ridges behind the forest (docs/art-direction-v3-1.md section
// 5.6), on levels whose quality row has `ridges` on (Medium and High). They
// replace the old flat far hill band. One full screen layer drawn right
// after the sky and behind everything else: per pixel it finds how far
// below each crest it lies, feathers the alpha at the crest (a smoothstep,
// no blur pass) and mixes the ridge colour toward HAZE_COLOR, more at the
// crest. Crests are sums of sines in virtual pixels (haze.js ridgeCrest),
// scaled by zoomK so they keep their place against the world when the view
// widens. The numbers all come from haze.js. Built once; a resize only
// writes uniforms, so nothing is allocated per frame.

import * as THREE from 'three';
import {
  HAZE_COLOR, hexRgb, RIDGE_CREST_HAZE, RIDGE_FADE_PX, RIDGE_VIRTUAL_HEIGHT, RIDGES,
} from './haze.js';

const RIDGE_RENDER_ORDER = -100; // first of the scene, right after the sky background

const glslFloat = (value) => (Number.isInteger(value) ? `${value}.0` : `${value}`);
const glslColor = (hex) => `vec3(${hexRgb(hex).map((v) => v.toFixed(5)).join(', ')})`;

// GLSL of ridgeCrest (haze.js) for `ridge`, in virtual px above the horizon.
function crestGlsl(ridge) {
  const waves = ridge.waves.map(([amplitude, period, phase]) => ` - ${glslFloat(amplitude)} * sin(x / ${glslFloat(period)} + ${glslFloat(phase)})`);
  return `${glslFloat(ridge.base)}${waves.join('')}`;
}

// One ridge over `color` (sRGB): `above` is how many virtual px the pixel
// lies above the horizon at virtual x `x`.
function layerGlsl(ridge) {
  return `
  {
    float depth = (${crestGlsl(ridge)}) * uZoom - above;
    float alpha = smoothstep(0.0, ${glslFloat(ridge.featherPx)} * uZoom, depth);
    float haze = ${glslFloat(ridge.haze)} + ${glslFloat(RIDGE_CREST_HAZE)} * (1.0 - clamp(depth / (${glslFloat(RIDGE_FADE_PX)} * uZoom), 0.0, 1.0));
    vec3 ridge = mix(${glslColor(ridge.color)}, HAZE, haze);
    color = mix(color, ridge, alpha);
    coverage = coverage + (1.0 - coverage) * alpha;
  }`;
}

const VERTEX = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uHorizon; // the horizon, a fraction of the view from the top
  uniform float uZoom; // zoomK of the view
  uniform float uHeight; // the drawing buffer's height in pixels
  const vec3 HAZE = ${glslColor(HAZE_COLOR)};
  vec3 toLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
  void main() {
    float unit = uHeight / ${glslFloat(RIDGE_VIRTUAL_HEIGHT)}; // screen px per virtual px
    float x = gl_FragCoord.x / unit;
    float above = (gl_FragCoord.y - (1.0 - uHorizon) * uHeight) / unit;
    vec3 color = HAZE;
    float coverage = 0.0;
    ${RIDGES.map(layerGlsl).join('\n')}
    if (coverage <= 0.0) discard;
    // The colours mix as sRGB, like the gradient of the sky behind.
    gl_FragColor = vec4(toLinear(color), coverage);
    #include <colorspace_fragment>
  }
`;

// Adds the ridges to `scene`. Returns { mesh, setView(horizon, zoom,
// heightPx), setFeatures(features) }.
export function createRidges(scene) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uHorizon: { value: 0 },
      uZoom: { value: 1 },
      uHeight: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    // In the opaque list, so it draws before the ground and everything
    // else, but blended over the sky by its own alpha.
    transparent: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthTest: false,
    depthWrite: false,
    toneMapped: false, // like the sky gradient
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = RIDGE_RENDER_ORDER;
  scene.add(mesh);
  const { uniforms } = material;
  return {
    mesh,
    // The horizon as a fraction of the view from the top, zoomK of the view
    // and the drawing buffer height in pixels.
    setView(horizon, zoom, heightPx) {
      uniforms.uHorizon.value = horizon;
      uniforms.uZoom.value = zoom;
      uniforms.uHeight.value = heightPx;
    },
    setFeatures(features) {
      mesh.visible = features.ridges;
    },
  };
}
