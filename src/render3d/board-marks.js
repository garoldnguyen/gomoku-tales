// What the 3D board shows on top of the plots for a game view (the same
// view the 2D renderer draws, see src/ui/local-game.js getView): flat v3
// decals for the skill targeting previews and the winning line
// (docs/art-direction-v3.md section 3), and a see-through ghost piece where
// a stone or rock would go. The hover highlight itself is view.hover; the
// last-move mark follows the logic events (world-renderer.js). Announced
// skills (the Wind Dash marks and the Tornado Zone) are skill visuals
// started by logic events (src/render3d/effects3d.js). Pure: no DOM or
// Three.js, so it runs under node --test.
//
// Decal kinds:
//   'zonePreview' a Tornado Zone cell while choosing the zone centre; dx
//                 and dy (-1, 0 or 1) place it inside the 3x3 zone decal
//   'dashTarget'  the Wind Dash target cell being chosen
//   'select'      a chosen or pickable source plant (Wind Dash, Stone Conversion)
//   'win'         a cell of the winning line
//   'cloudPreview' a cell of the Cloud being placed (Cloud Eagle)

// Returns { decals: [{ kind, x, y, dx, dy }], ghost: { kind, x, y } | null }
// where a ghost kind is 'X' or 'O' (a stone about to be placed) or 'rock',
// and dx, dy place a zone preview cell in its zone (0 for other decals).
// A fresh result each call; the render loop uses boardMarksInto.
export function boardMarks(view) {
  const marks = boardMarksInto(view, createBoardMarks());
  return { decals: marks.decals.slice(0, marks.count), ghost: marks.ghost && { ...marks.ghost } };
}

// A reusable result for boardMarksInto: decals[0] to decals[count - 1] are
// this frame's decals (the list only grows, so it never reallocates) and
// ghost is ghostSpot or null.
export function createBoardMarks() {
  return { decals: [], count: 0, ghost: null, ghostSpot: { kind: null, x: 0, y: 0 } };
}

// boardMarks written into `out` from createBoardMarks, reusing its
// objects, so the render loop allocates nothing. Returns `out`.
export function boardMarksInto(view, out) {
  const { state, hover, preview } = view;
  out.count = 0;
  out.ghost = null;

  if (state.winLine) {
    for (let i = 0; i < state.winLine.length; i++) addDecal(out, 'win', state.winLine[i].x, state.winLine[i].y, 0, 0);
  }

  if (hover) setGhost(out, state.currentPlayer, hover.x, hover.y);

  // Hover preview for the skill target flow (see ui/targeting.js).
  if (preview) {
    switch (preview.type) {
      case 'select':
        addDecal(out, 'select', preview.x, preview.y, 0, 0);
        break;
      case 'dash':
        addDecal(out, 'select', preview.from.x, preview.from.y, 0, 0);
        if (preview.to) addDecal(out, 'dashTarget', preview.to.x, preview.to.y, 0, 0);
        break;
      case 'zone':
        for (let i = 0; i < preview.cells.length; i++) {
          const cell = preview.cells[i];
          addDecal(out, 'zonePreview', cell.x, cell.y, cell.x - preview.x, cell.y - preview.y);
        }
        break;
      case 'rock':
        setGhost(out, 'rock', preview.x, preview.y);
        break;
      case 'cloud':
        for (let i = 0; i < preview.cells.length; i++) addDecal(out, 'cloudPreview', preview.cells[i].x, preview.cells[i].y, 0, 0);
        break;
    }
  }
  return out;
}

function addDecal(marks, kind, x, y, dx, dy) {
  const decal = marks.count < marks.decals.length ? marks.decals[marks.count] : newDecal(marks);
  marks.count++;
  decal.kind = kind;
  decal.x = x;
  decal.y = y;
  decal.dx = dx;
  decal.dy = dy;
}

// One more decal object, made the first time this many decals show at once.
function newDecal(marks) {
  const decal = { kind: null, x: 0, y: 0, dx: 0, dy: 0 };
  marks.decals.push(decal);
  return decal;
}

function setGhost(marks, kind, x, y) {
  const ghost = marks.ghostSpot;
  ghost.kind = kind;
  ghost.x = x;
  ghost.y = y;
  marks.ghost = ghost;
}

const WIN_PULSE_MS = 1000; // the winner marks pulse once a second
const WIN_PULSE_MIN = 0.7;

// Opacity of the winner marks at `timeMs`: between 0.7 and 1, once a second.
export function winPulseOpacity(timeMs) {
  const wave = 0.5 + 0.5 * Math.cos((2 * Math.PI * timeMs) / WIN_PULSE_MS);
  return WIN_PULSE_MIN + (1 - WIN_PULSE_MIN) * wave;
}

// Opacity of the last-move mark `ageMs` after its seed was planted: it
// fades in with the plant's Open stage (stageStartMs from v3-meta.js, the
// stages Drop, Land, Sprout, Open, Rest) and stays at 1 from Rest on.
export function lastMoveOpacity(ageMs, stageStartMs) {
  const open = stageStartMs[3];
  const rest = stageStartMs[4];
  if (!(ageMs >= open)) return 0;
  if (ageMs >= rest || rest <= open) return 1;
  return (ageMs - open) / (rest - open);
}

// The newest plant after `events` (a list of logic events, oldest first):
// { x, y, player } of the last 'stonePlaced', or `previous` when there is none.
export function lastPlanted(events, previous = null) {
  let last = previous;
  for (const event of events) {
    if (event.type === 'stonePlaced') last = { x: event.x, y: event.y, player: event.player };
  }
  return last;
}
