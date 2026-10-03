// How the fixed camera frames the farm (docs/art-direction-v3.md sections
// 6 and 7, "Framing numbers"): the camera pose and the framing numbers, in
// ONE place that the renderer (camera.js, world.js) and the HUD layout
// (src/ui/hud-layout.js, through camera.js) both read. The flat meadow
// fills the screen on the left, right and bottom and ends at a far edge
// placed on purpose, the horizon (horizon.js works it out). Behind it stand
// the far hills and the sky. The canvas fills the whole window, and
// fitView widens the view for windows narrower than 16:9
// (docs/art-direction-v3-1.md section 3). Constants and pure functions, no
// imports.

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

// --- The full window view (docs/art-direction-v3-1.md section 3.2) ---

const DEG = Math.PI / 180;

// Half the side of the square on the ground that must always be in view:
// the 15 by 15 board (7.5), its 8 art pixel curb (0.25) and a margin of
// one cell (1). tests/render3d-full-window.test.js checks the sum against
// BOARD_SIZE, CURB_PX and CELL_SIZE in config.js (this file has no imports).
export const FIELD_HALF_EXTENT = 7.5 + 0.25 + 1;
// fitView adds this much so the corners are inside with a small tolerance
// (far less than the 0.05 degrees of the smallest-view test).
export const FIT_VIEW_TOLERANCE_DEG = 0.005;
// The supported window shapes, width over height (section 3.1 item 5):
// 9:21 (tall phone) to 32:9 (super ultrawide). Outside them nothing breaks
// but nothing is tuned: fitView treats a narrower window as 9:21, so the
// view never widens toward 180 degrees, where the ground under the bottom
// of the screen is gone and the clip planes cannot be worked out.
export const MIN_ASPECT = 9 / 21;
export const MAX_ASPECT = 32 / 9;

// The tangent of half the vertical field of view at which ground point
// (x, 0, z) is just inside the view of CAMERA_POSE at `aspect`: the camera
// looks straight along the board's centre line, so its right is +x and its
// up and forward lie in the y-z plane.
function tanHalfNeeded(x, z, aspect) {
  const pitch = CAMERA_POSE.pitchDeg * DEG;
  const s = Math.sin(pitch);
  const c = Math.cos(pitch);
  // Offset from the camera to the point, the camera at the aim point
  // (0, 0, -aimBehind) moved `distance` up and back along the pitch.
  const dy = -CAMERA_POSE.distance * s;
  const dz = z + CAMERA_POSE.aimBehind - CAMERA_POSE.distance * c;
  const depth = -s * dy - c * dz; // along forward (0, -sin, -cos)
  const up = c * dy - s * dz; // along up (0, cos, -sin)
  return Math.max(Math.abs(x) / (depth * aspect), Math.abs(up) / depth);
}

// The vertical field of view in degrees for a window `aspect` (width over
// height) wide: CAMERA_POSE.fovDeg at 16:9 and wider (a wider window shows
// more meadow at the sides, the board stays the same size), narrower the
// smallest one that keeps the four corners of the FIELD_HALF_EXTENT square
// in view, never less than CAMERA_POSE.fovDeg. Narrower than MIN_ASPECT it
// is the 9:21 value (the board's sides may then be cut). The camera's
// position and aim never change.
export function fitView(aspect) {
  const reference = CAMERA_POSE.fovDeg;
  if (!(aspect < GAME_ASPECT)) return reference;
  const fitAspect = aspect > MIN_ASPECT ? aspect : MIN_ASPECT; // also catches 0 and NaN
  const e = FIELD_HALF_EXTENT;
  const need = Math.max(tanHalfNeeded(e, -e, fitAspect), tanHalfNeeded(e, e, fitAspect));
  const fov = (2 * Math.atan(need)) / DEG + FIT_VIEW_TOLERANCE_DEG;
  return Math.max(reference, fov);
}

// How much smaller things look at vertical field of view `vfov` than at
// the reference view: tan(reference / 2) / tan(vfov / 2). 1 at 16:9 and
// wider, under 1 as the view widens (section 5 keeps the sky in proportion).
export function zoomK(vfov) {
  return Math.tan((CAMERA_POSE.fovDeg * DEG) / 2) / Math.tan((vfov * DEG) / 2);
}
