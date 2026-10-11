# Skill popup (compact) and the story line on the first page

Owner request, October 2026: every skill popup must look professional and tidy: a small
description, the cooldown, and the rules that apply (for example: Venom can pick a plant sunk in
mud; a Tornado Zone is cut at the edge of the field). Minimal, glass, in the style of the HUD. No
walls of text. The story goes on the first page of the menu only, short.

Source of truth for the numbers: `src/config.js`. Source of truth for the words: the ONE table
`SKILL_INFO` in `src/ui/skill-info.js` (strings that are not skill text live in `src/ui/strings.js`).
Numbers are never typed in a string: they are built from the config constants.

## 1. The popup (opened by a click on a skill, `hud.js` `openPopup`)

```
+--------------------------------------+
| [icon 40]  Venom            [ Ready ]|   title (Jost 500, 17px); under it the character name
|            JADE SERPENT              |   in spaced gold capitals (10px); the state chip at right
| ------------------------------------ |   gold hairline
| Poison a 3x3 patch around an         |   brief: one sentence, 14px
| enemy plant.                         |
|                                      |
|  REST        LASTS       AREA        |   facts: 2 or 3 cells, label = gold capitals 10px,
|  6 turns     2 turns     3 x 3       |   value = 15px
|                                      |
|  . Can pick a plant sunk in mud      |   rules: 2 to 4 lines, 13px, a small gold dot each
|  . No planting, Dash, Mud or         |
|    Tornado there                     |
|  . The plant stays and still counts  |
|  . Rocks cannot be picked            |
|                                      |
|  Click, then pick a plant            |   hint: 12px, dim
+--------------------------------------+
```

- Width 280 px (`max-width: calc(100vw - 24px)`), padding 16 px 18 px, radius 22 px, the dark glass
  of `.hud .skill-popup` (blur only above Low, as now). The popup still only reads: it takes no
  pointer events, a press outside closes it, Escape closes it, placement stays `tooltipPosition()`.
- Header: the skill icon (the same art as the button, 40 px, radius 12 px), the title, the character
  name, the state chip. The chip shows the existing `stateText` of the skill ("Ready", "Rests 3",
  "Locked", "Used", "Always on") and keeps `data-state`; the colours stay the existing state tokens.
- Facts and rules are separate blocks with a quiet gap (10 to 12 px). No boxes around the facts, no
  icons inside them, only text. At most one hairline (under the header).
- Everything uses the HUD tokens already in `hud.css` (`--accent`, `--hair`, `--font`, `--display`,
  `--label`). No new hex colour outside a token block. Only opacity and transforms animate (a
  120 ms fade in, nothing under `prefers-reduced-motion`).
- The hover and long-press tooltip shows only the header, the brief and the facts. It is for a quick
  look; the popup has the rules.
- Phones (`is-compact`): same content, width `min(280px, calc(100vw - 24px))`, 13 px rules.

## 2. The content model (SKILL_INFO)

Each entry becomes `{ title, brief, facts, rules, hint, description }`:

- `brief`: one sentence, at most 60 characters.
- `facts`: an array of 2 or 3 `{ label, value }`. `label` at most 8 characters, upper-cased by CSS
  (store it in normal case: `Rest`, `Lasts`, `Area`). `value` at most 16 characters.
- `rules`: an array of 2 to 4 strings, each at most 44 characters, no full stop at the end.
- `hint`: as now (how to use it).
- `description`: derived, never typed: `brief` plus the rules joined as sentences. Used where a full
  sentence form is wanted (aria-labels, the How to Play skill rows). The old long paragraphs are
  deleted.

Every number comes from config: `COOLDOWN_SHORT`, `COOLDOWN_LONG` (through `cooldownTurns`),
`WIND_DASH_RANGE`, `TORNADO_ARM`, `TORNADO_TURNS`, `MUD_LIFETIME_TURNS`, `MUD_SINK_TURNS`,
`HISS_LOCK_TURNS`, `VENOM_ZONE_SIZE`, `VENOM_TURNS`, `CLOUD_SIZE` (area through `cloudReach`),
`CLOUD_TURNS`, `SKY_WATCH_RUN`. Plural words follow the number (`1 turn`, `2 turns`).

### The words (draft; check each rule against `src/logic` and `docs/design.md` section 5 and fix the
### draft where the game does something else, then say so in the summary)

| Skill | Brief | Facts (label: value) | Rules |
|---|---|---|---|
| Wind Dash | Send one of your plants to a nearby empty plot. | Rest: 3 turns; Range: 3 plots; Lands: After their turn | Diagonals count / Fails if the plot is taken by then / Cannot land on mud |
| Tornado Zone | Hide a cross-shaped trap on the field. | Rest: 6 turns; Waits: 2 turns; Size: 5 plots | Cut at the edge of the field / Hidden from your opponent, one use / Armed at once: your own seed counts / Throws the first seed to a random free plot |
| Mud Trap | Turn an empty plot into a mud puddle. | Rest: 3 turns; Puddle: 4 turns; Sinks: 1 turn | A seed planted in it sinks and counts for no line / Then it surfaces and counts again / Empty plots only, not mud already |
| Petrification | Turn one enemy plant to stone. | Rest: 6 turns; Lasts: For good; Target: Enemy plant | The rock breaks every line / Cannot pick a seed sunk in mud |
| Hiss | Silence your opponent's skills. | Rest: 3 turns; Locks: 1 turn; Target: None | They can still plant a seed / No target needed |
| Venom | Poison a 3 by 3 patch around an enemy plant. | Rest: 6 turns; Lasts: 2 turns; Area: 3 by 3 | Can pick a plant sunk in mud / No planting, Dash, Mud or Tornado there / The plant stays and still counts / Rocks cannot be picked |
| Sky Watch | See where your opponent could make 4 in a row. | Rest: None; Mode: Always on | Marks empty plots with a little cloud / Warns when a row of 3 can become 4 / Nothing to click |
| Cloud | Hide a 4 by 4 patch of the field from your opponent. | Rest: 6 turns; Lasts: 2 turns; Area: 4 by 4 | Hides what lies under it; the opponent sees taken plots as puffs / You still see everything / Cut at the edge of the field |

The numbers in the table are the current config values; the code builds them. "3 by 3" is written
with the word "by" (no special characters in strings).

## 3. Tests (pure, node)

- Each of the 8 skills has a brief (<= 60), 2 or 3 facts (label <= 8, value <= 16), 2 to 4 rules
  (each <= 44, none ending in a full stop) and a hint.
- The Rest fact equals `cooldownTurns(skill)` (a passive skill says None); Range, Lasts, Waits,
  Size, Area, Locks, Puddle and Sinks equal the config constants (change a constant in the test and
  the text follows: the test reads the text, it does not retype the number).
- `description` is derived from brief and rules and no longer holds a paragraph over 220 characters.
- `skillPopupViewModel` returns `facts`, `rules`, `brief`, the character name and the icon art key;
  the popup DOM shows them (the fake browser of the existing tests), the tooltip shows no rules.
- Nothing in `SKILL_INFO` names a cell, and the Tornado Zone text says nothing that the other seat
  could use (the text is public, the trap is not).

## 4. The story line (first page of the menu only)

The menu (`src/ui/menu-dom.js`, `menu.css`, `menuViewModel`) gets two small lines under the title,
before the buttons. All text in `src/ui/strings.js`:

- kicker (spaced gold capitals): `The Festival of All Seeds`
- line (one or two lines, centred, the menu's secondary text colour):
  `Every spring the spirits of Flora gather on Breeze Hill to sow seeds, not to fight. Grow five in a row to win the Floral Crown.`

Nothing else of the story goes into the game now. The block is hidden under a short window height
(it must never push the buttons under the fold or make a box overlap), fades in with the menu
(opacity only) and follows the Ivory look (`docs/flow-design.md` section 3.0). It appears on the
menu only, not in the lobby, the waiting room, the game or the game over card.

## 5. Not in this task

Cast banners per skill (art comes from the owner, `docs/skill-banner-art.md`) and sound effects.
