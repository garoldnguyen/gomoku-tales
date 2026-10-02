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

// Returns { decals: [{ kind, x, y, dx?, dy? }], ghost: { kind, x, y } | null }
// where a ghost kind is 'X' or 'O' (a stone about to be placed) or 'rock'.
export function boardMarks(view) {
  const { state, hover, preview } = view;
  const decals = [];
  const add = (kind, cell) => decals.push({ kind, x: cell.x, y: cell.y });

  if (state.winLine) for (const cell of state.winLine) add('win', cell);

  let ghost = null;
  if (hover) ghost = { kind: state.currentPlayer, x: hover.x, y: hover.y };

  // Hover preview for the skill target flow (see ui/targeting.js).
  if (preview) {
    switch (preview.type) {
      case 'select':
        add('select', preview);
        break;
      case 'dash':
        add('select', preview.from);
        if (preview.to) add('dashTarget', preview.to);
        break;
      case 'zone':
        for (const cell of preview.cells) {
          decals.push({ kind: 'zonePreview', x: cell.x, y: cell.y, dx: cell.x - preview.x, dy: cell.y - preview.y });
        }
        break;
      case 'rock':
        ghost = { kind: 'rock', x: preview.x, y: preview.y };
        break;
    }
  }
  return { decals, ghost };
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
