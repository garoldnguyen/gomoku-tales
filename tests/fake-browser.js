// A stand-in browser for tests that build the 3D world under Node: a
// document whose canvases have a 2D context that draws nothing, and a
// WebGL renderer stand-in that renders nothing. Enough for the world to
// build its scene, switch quality levels and run its render loop.

import * as THREE from '../vendor/three/build/three.module.js';

function fakeContext(canvas) {
  const gradient = { addColorStop() {} };
  const state = {
    canvas,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({}),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    measureText: (text) => ({ width: String(text).length * 8 }),
  };
  // Every other method (fillRect, drawImage, save, ...) does nothing.
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      return () => {};
    },
  });
}

export function fakeCanvas(width = 1, height = 1) {
  const canvas = {
    width,
    height,
    clientWidth: 1600,
    clientHeight: 900,
    style: {},
    getContext: () => (canvas.context ??= fakeContext(canvas)),
    addEventListener() {},
    removeEventListener() {},
  };
  return canvas;
}

// Installs the fake document (only once).
export function installFakeDocument() {
  globalThis.document ??= {
    createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : { style: {} }),
  };
  globalThis.devicePixelRatio ??= 1;
}

// A WebGLRenderer stand-in: the calls the world and the post-processing
// make, with no drawing.
export function fakeRenderer() {
  const size = new THREE.Vector2(1, 1);
  let pixelRatio = 1;
  return {
    shadowMap: { enabled: false },
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: THREE.SRGBColorSpace,
    renders: 0,
    setPixelRatio(value) {
      pixelRatio = value;
    },
    getPixelRatio: () => pixelRatio,
    setSize(w, h) {
      size.set(w, h);
    },
    getSize: (target) => target.copy(size),
    getDrawingBufferSize: (target) => target.copy(size).multiplyScalar(pixelRatio),
    scene: null, // the last Scene rendered (not a post pass's full screen quad)
    render(object) {
      this.renders++;
      if (object.isScene) this.scene = object;
    },
    setRenderTarget() {},
    getRenderTarget: () => null,
    clear() {},
    getClearColor: (target) => target.set(0, 0, 0),
    getClearAlpha: () => 1,
    setClearColor() {},
    setClearAlpha() {},
    get autoClear() {
      return true;
    },
    set autoClear(value) {},
    getContext: () => ({}),
    dispose() {},
  };
}
