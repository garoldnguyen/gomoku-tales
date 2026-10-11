# Character HUDs: one look for each character

Owner request, October 2026: every character gets its own HUD card and pill, in its own style, but the
shapes stay the same for all four. The designs were made on a canvas (a private Claude Design page) and the
owner chose them; this file is the record of what was built.

## 1. What is shared and what is not

Shared by all four (one rule each in `src/ui/hud.css`, no rule of one character may set them; a test checks it):

- The portrait: a rounded square (58 px, radius 12, a 2 px rim) in the card; a round 48 px portrait in the pill.
- The skill icons: a rounded square (46 px, radius 9) inset at the start of the row, the art filling it edge to
  edge (scaled 1.14 so the icon's own frame is cropped away); round 48 px buttons in the pill.
- The chevron: a rounded square, 44 px touch target; in the pill a 28 px circle inside the same touch target.
- The cooldown badge: a 28 px rounded square at the end of the row with the turns left.
- The status chip: a small slab with a diamond (a solid colour for Your turn, dim for Waiting).
- Cooling down: the icon dims, a dark sweep wipes over it (`--p`, the share served) and the badge shows. In the
  pill the button's ring shows the same share and the number sits in the middle. No bar under a row.
- The anatomy: portrait, name, "Plays X, N planted", chevron, chip, SKILLS with a rule, two skill rows.

Different per character (token blocks `.hud .card[data-character="…"]`, plus the ornaments):

| Character | Card | Ornaments |
|---|---|---|
| Wind Rabbit | breezy blue glass, soft round corners, capsule rows | two wind curves, a dandelion seed, a wave rule |
| Earth Bear | pressed clay with speckles, stitched inlay, bevelled slabs | four rivets, a sprouting mound, a pebble rule |
| Jade Serpent | scaled jade, an inlay line, bevelled slabs; Venom is purple | four gems, a coiled snake, a snake rule with a tongue |
| Cloud Eagle | gold rimmed sky glass with specks, bevelled slabs | four stars, a cloud and a feather, a hairline rule with a feather |

The pill is one capsule per character: Wind Rabbit has a gloss, Earth Bear a stitched line, Jade Serpent the
scale pattern, Cloud Eagle a gold hairline and a glow.

## 2. How it is built

- `cardView` (`src/ui/hud-view.js`) names the `character`; `hud.js` sets `data-character` on each card (and on a
  new game's seats) and `data-skill` on every skill button and pill button.
- `src/ui/hud-ornaments.js` (pure strings): the card's ornament layer (`CARD_ART_HTML`, in `.orn` behind the
  content) and the rule after SKILLS (`RULE_ART_HTML`). No colour is written there: classes (`fa`, `sb`, `rs1`,
  `rf2`, …) read the tokens `--o-a` to `--o-e` and `--r-s1`, `--r-s2`, `--r-f1` to `--r-f4`.
- `src/ui/hud.css`, the section "Character HUDs": one token block per character (the same `--c-` tokens in each:
  chrome, rim, shadows, tile, icon, row, selected, chevron, chip, ready ring, sweep, badge, inlay, gem), then the
  rules that only read them. Hex colours live in the token blocks only.
- The pill's size is in `src/ui/hud-layout.js` (`PILL_*`: 226 by 64 px; `CARD_TILE` 58).
- Low quality drops the blur and the shadows. The slim bars (phones, small landscape rails) keep their layout
  and take the colours, without the ornaments. Waiting dims the card (and the pill to 55 percent).
- Tests: `tests/hud-characters.test.js`.
