// What the 3D board shows on top of the pieces for a game view (the same
// view the 2D renderer draws, see src/ui/local-game.js getView): flat cell
// decals for the skill targeting previews and the winning line, and a
// see-through ghost piece where a stone or rock would go. The hover
// highlight itself is view.hover. Announced skills (the Wind Dash marks and
// the Tornado Zone) are skill visuals started by logic events
// (src/render3d/effects3d.js). Pure: no DOM or Three.js, so it runs under
// node --test.
//
// Decal kinds:
//   'zonePreview' a Tornado Zone cell while choosing the zone centre
//   'dashTarget'  the red frame on the Wind Dash target cell being chosen
//   'whirl'       the pale blue whirl around the Wind Dash source stone being chosen
//   'select'      the ring around a stone that can be picked
//   'win'         a cell of the winning line

// Returns { decals: [{ kind, x, y }], ghost: { kind, x, y } | null } where
// a ghost kind is 'X' or 'O' (a stone about to be placed) or 'rock'.
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
        add('whirl', preview.from);
        if (preview.to) add('dashTarget', preview.to);
        break;
      case 'zone':
        for (const cell of preview.cells) add('zonePreview', cell);
        break;
      case 'rock':
        ghost = { kind: 'rock', x: preview.x, y: preview.y };
        break;
    }
  }
  return { decals, ghost };
}
