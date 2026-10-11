# The Ivory HUD: paper, and a colour for each character

Owner request, October 2026: the first character HUDs (a different frame, ornaments and materials for each
character) looked out of place and not rich enough. The owner asked for something minimal, chose the Ivory
option of a design canvas (a private Claude Design page) and asked for the art to have no borders and the
character's colour to spread over the HUD. This file is the record of what was built; the first version
(clay, jade and feather ornaments, one token block of about 45 tokens per character) is gone.

## The look

- Paper, like the menus: the HUD tokens of `.hud` in `src/ui/hud.css` are the Ivory palette of `#screens`
  (`src/ui/screens.css`): ink `#1c1913`, paper `#fffdf8`, the gold `#86642a` for the spaced labels, the ready
  green `#3d7a52`. A test compares them with the menu's values. The paper is 97 percent opaque and has no
  blur (a battery gain on phones, `docs/performance.md`).
- The character is one colour (`--c-acc`) and a deeper ink of it (`--c-deep`), set by `data-character` on the
  card, the tooltip and the popup. The colours are the game's mark colours (Wind Rabbit blue, Earth Bear
  ochre, Jade Serpent jade, Cloud Eagle a deeper yellow that reads on paper); Venom is purple on the
  serpent's card (`data-skill="venom"`).
- The colour spreads from the portrait: a radial wash from the card's top left corner (40 percent, fading out
  at about 80 percent of the card), a gradient under the portrait, a gradient along each skill row from its
  icon to the right, a tinted status pill, and a glow of the colour under every piece of art.
- No piece of art has a border: the portrait (58 px rounded square), the skill icons (44 px rounded squares
  filling their tile, scaled 1.14 so the icon's own frame is cropped away), the chevron and the pill's round
  art. A soft glow of the colour stands where a border would have been.
- Skill states: ready (a lit dot at the end of the row), cooling down (the icon dims, a round badge with the
  turns left), selected (a stronger wash and a glow), locked (a red tint and the lock), always on (Sky Watch).
- The folded pill is a capsule (48 px round portrait and skill buttons, the 44 px chevron button with a 28 px
  circle) whose colour runs from the portrait to the right. A dot marks the player to move. Its size is in
  `src/ui/hud-layout.js` (`PILL_*`: 226 by 64 px).
- The top turn pill, the quality switch, the Fullscreen and Leave buttons, the toast, the turn banner and the
  hint cards read the same paper tokens. The cast banner keeps its navy plaque and its light text.
- The slim bars of phones and small windows keep their layout and take the paper, the wash and the chip.

## How it is built

- `cardView` and `skillView` (`src/ui/hud-view.js`) name the `character`; `hud.js` puts it in `data-character`
  on each card (and again on a new game's seats), on the popup and the tooltip, and `data-skill` on every skill
  button and pill button.
- `src/ui/hud.css`, the section "Ivory HUD": the root tokens, one two-token block per character, then rules that
  read them with `color-mix` (no colour is written twice and no hex colour stands outside a token block).
- Tests: `tests/hud-characters.test.js` (the view model, the DOM, the token blocks, the Ivory values, no
  border on art, the same shapes for every character, the pill's size).
