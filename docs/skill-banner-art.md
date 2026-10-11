# Skill cast banners and effect art (design, art not yet supplied)

Owner request, October 2026: banner art (and optionally effect art) for the skills of the four
characters. The owner makes the pictures with an image generator and hands the files over; the
builder cleans them to the pixel grid (magenta to alpha, BOX downscale, quantize, plum outline) and
integrates them in a later task. This file is the brief for both. The art is not in the repo yet.

## 1. What a cast banner is

When a skill is cast, a slim banner slides in at the top centre of the screen below the turn pill,
shows for `SKILL_BANNER_MS` (about 1500 ms: 160 ms in, hold, 240 ms out; opacity and a 8 px
translate only; nothing under `prefers-reduced-motion`), and goes. One banner at a time (a new cast
replaces it). Both players and spectators see it. It adds to the card flash of Free Action; it does
not replace it.

Seven skills have a banner (Sky Watch is passive and is never cast): Wind Dash, Tornado Zone, Mud
Trap, Petrification, Hiss, Venom, Cloud.

What is art and what is text:

- The picture (a PNG) is only the plaque: the ribbon, the medallion frame, the colour accent and a
  motif at the right end. NO letters in the art.
- The skill icon (`assets/3d/v5/icon-*.png`, 128 px) is drawn by the page inside the empty medallion
  at 48 CSS px.
- The skill name (Jost 500, 20 px) and under it the character name (spaced gold capitals, 10 px) are
  DOM text from `src/ui/strings.js` and `SKILL_INFO`, in the clear middle of the plaque.
- A Tornado Zone never shows its cell and, for the other seat, keeps the words of the existing trap
  notice ("Wind Rabbit placed a trap!"); the banner picture carries no cell, so it is safe.

## 2. File spec

| File (planned) | Grid | Stored size | Notes |
|---|---|---|---|
| `assets/3d/v6/banner-wind-dash.png` and `banner-tornado-zone`, `banner-mud-trap`, `banner-petrification`, `banner-hiss`, `banner-venom`, `banner-cloud` | 160 x 40 art pixels | 320 x 80 (each art pixel exactly 2 x 2) | PNG, real alpha, binary alpha (0 or 255), at most 16 colours, 1 px plum `#2b1d3a` outline |

Zones on the 160 x 40 grid (art pixels), the same in all seven so one layout fits all:

- Medallion: a circle centred at (20, 20), outer radius 16, inner empty disc radius 12.
- Clear text area: x 40 to 128, y 6 to 34, flat dark navy, no pattern.
- Motif: x 128 to 156, fading into the panel.
- Plaque: navy `#16203a`, border pale gold `#e8c77a` (1 px), a 2 px accent stripe along the bottom edge
  in the accent colour of the character.

Accent colours: Wind Rabbit blue `#3b8cff`, Earth Bear ochre red `#c9703a`, Jade Serpent jade
`#2fbf7a` (Venom deep purple `#7b3fb0`, `VENOM_FLASH_COLOUR`), Cloud Eagle pale yellow `#fff2a8`.

## 3. Prompts for the image generator

Open one new chat, paste BASE once, then send one MOTIF line at a time. Ask for the picture on a
flat magenta background and put the files OUTSIDE the repo (the cleaning script reads them from
`/home/pc/games/art-source-skill-banners`, the Windows path is
`\\wsl.localhost\Ubuntu\home\pc\games\art-source-skill-banners`). Name the files as in the table.

BASE:

```
Cute 16-bit pixel art in the HD-2D style of Octopath Traveler, bright saturated candy colours,
limited palette of at most 16 colours, flat shading with 2 or 3 shades per colour, bold 1 pixel
dark plum (#2b1d3a) outline, crisp hard pixel edges, no anti-aliasing, no blur, no gradients,
no text, no letters, no watermark, light from the upper left. Drawn on an exact 160x40 pixel
grid, shown enlarged with each art pixel a perfect square. Solid pure magenta (#FF00FF)
background outside the banner, magenta used nowhere else.

One wide horizontal game banner, exactly 4 to 1 (width four times the height), centred in the
image with a margin of magenta all around. A slim ribbon plaque with small swallow-tail notched
ends. Base: a flat dark navy panel (#16203a) with a thin pale gold (#e8c77a) 1 pixel border and
a 2 pixel stripe in the ACCENT colour along the bottom edge. Left end: a round medallion about as
tall as the banner, with a ring in the ACCENT colour and a pale gold rim; its inside is a plain
flat dark navy disc with NOTHING drawn in it (an icon is placed there later). Middle: a calm,
flat, plain dark navy area with no picture and no pattern (text is added later). Right end,
within the last fifth of the width only: the MOTIF, fading softly into the panel so the middle
stays clean. Front view, flat, no perspective, no shadow outside the banner.

I will now send ACCENT and MOTIF for each banner, one at a time. Make each as a separate image.
```

MOTIF lines (one message each):

1. `banner-wind-dash`: ACCENT bright blue #3b8cff. MOTIF: a small gust of white and pale blue petals
   and dandelion seeds curling to the right, two or three curved wind lines (no straight lines),
   one tiny seed flying off the right edge.
2. `banner-tornado-zone`: ACCENT bright blue #3b8cff. MOTIF: five small tilled soil plots in a
   plus-shaped cross, and over the middle one a pale blue swirl of petals and fluff drawn lighter
   and dotted as if half hidden, plus a tiny closed eye (secret trap).
3. `banner-mud-trap`: ACCENT ochre red #c9703a. MOTIF: a brown mud puddle with two bubbles and a few
   splashes, a tiny green sprout sinking into it.
4. `banner-petrification`: ACCENT ochre red #c9703a. MOTIF: a small flower whose lower half has
   turned to grey stone, fine cracks, a few grey dust flakes drifting off.
5. `banner-hiss`: ACCENT jade green #2fbf7a. MOTIF: three wavy sound arcs spreading to the right in
   jade green, wisps of pale green mist, one tiny pale fang shape at the base of the arcs.
6. `banner-venom`: ACCENT deep purple #7b3fb0. MOTIF: three dripping purple sap drops, two toxic
   bubbles, and a small wilting flower bending over.
7. `banner-cloud`: ACCENT pale yellow #fff2a8. MOTIF: two puffy white and grey clouds with soft
   scalloped edges and one tiny pale yellow feather floating beside them.

## 4. Optional effect art (only if the owner wants more polish)

These two fill visible gaps of the 3D field; the particles of the other skills stay procedural.
Same STYLE as BASE, but ask for the grid named below and a magenta background.

- `assets/3d/v6/storm-cloud.png`, two frames side by side, each 128 x 128 (the 4 by 4 plots of the
  opponent's view of a Cloud at 32 px a plot), 256 x 128 in all. A dense, puffy slate-grey storm
  cloud seen from slightly above, filling the frame, scalloped soft pixel edge, opaque body in
  `#3d4a63`, `#5b6b86`, `#8c9bb5` with a plum outline. Frame 1 calm. Frame 2 the same cloud with a
  bright yellow-white zigzag lightning bolt inside it and a brighter rim. No text.
- `assets/3d/v6/stone-crack.png`, 32 x 32, one plot. A see-through overlay: thin dark grey cracks
  radiating from the centre, about 20 pixels across, and a few small pale grey flakes, in `#5c616b`,
  `#8a8f99`, `#c4c8cf`, on magenta. No plant and no ground. It lies on top of a plant turning to stone.

## 5. Integration (a later task, once the PNGs arrive)

Clean with the same pipeline as the Free Action art (`clean_art.py`: key magenta, crop to the
plaque, fit 160 x 40 with the BOX filter, quantize to at most 16 colours, binary alpha, plum
outline, then enlarge exactly 2 x to 320 x 80). Register the files in `assets/manifest.json` (use
`hud`), add `SKILL_BANNER_MS` and its timings to `src/config.js`, a pure `castBannerView` in
`src/ui/cast-view.js` (key, skill id, banner art name, title, character, colour), the DOM in
`hud.js` and `hud.css`, a shot picture, and tests (the view for the caster, the other seat and a
spectator; Tornado Zone names no cell; a missing PNG shows the plain plaque and only warns).
