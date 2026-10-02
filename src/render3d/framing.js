// How the fixed camera frames the farm (docs/art-direction-v3.md sections
// 6 and 7, "Framing numbers"): the camera pose and the framing numbers, in
// ONE place that the renderer (camera.js, world.js) and the HUD layout
// (src/ui/hud-layout.js, through camera.js) both read. The flat meadow
// fills the screen on the left, right and bottom and ends at a far edge
// placed on purpose, the horizon (horizon.js works it out). Behind it stand
// the far hills and the sky. Constants only, no imports.

// The game's one fixed camera: it looks down `pitchDeg` with a vertical
// field of view of `fovDeg` at the aim point on the board's centre line,
// `aimBehind` world units behind the board centre (at z = -aimBehind, no
// sideways offset), from `distance` away. camera.js builds the renderer's
// camera and the HUD layout's board projection (src/ui/hud-layout.js) from
// it, so both always agree. The camera may change only these four things.
export const CAMERA_POSE = Object.freeze({
  pitchDeg: 45, // how far it looks down, 90 is straight down
  fovDeg: 17, // vertical field of view in degrees
  distance: 65.5, // from the aim point, in world units
  aimBehind: 2.2, // the aim point (0, 0, -aimBehind) lies this far behind the board centre
});

// Where things must show at 16:9, as percentages of the screen from the top
// (y) or of its width (x), each with its accepted range.
export const FRAMING = Object.freeze({
  farEdgeY: { target: 21, min: 19, max: 23 }, // the horizon: where the meadow ends
  farEdgeYPortrait: { min: 10, max: 30 }, // the same at 9:16
  hillCrestY: { min: 15, max: 19 }, // the top of both far hills
  treeBaseY: { min: 22, max: 25 }, // every back-row trunk base
  treeCrownY: { min: 11, max: 17 }, // every back-row crown top, the trees at scale 1
  fieldBackY: { target: 31, min: 28, max: 34 }, // outer curb corners, back edge
  fieldFrontY: { target: 90, min: 87, max: 93 }, // outer curb corners, front edge
  fieldBackWidth: { target: 42, min: 39, max: 45 }, // back edge, share of the screen width
  fieldFrontWidth: { target: 50, min: 47, max: 53 }, // front edge
  fieldCentreX: { target: 50, min: 48.5, max: 51.5 },
  lowEdgeWaveY: { max: 1 }, // Low: the far edge is a gentle wavy line at most this tall
});

// The far edge is the ground under the screen point 21 percent down from
// the top: NDC y = 1 - 2 * 0.21.
export const FAR_EDGE_NDC_Y = 0.58;
// The aspect ratios the meadow must fill, width over height.
export const ASPECTS = Object.freeze({ '4:3': 4 / 3, '16:10': 16 / 10, '16:9': 16 / 9, '21:9': 21 / 9, '9:16': 9 / 16 });
export const GAME_ASPECT = ASPECTS['16:9'];
