// Tunable values from docs/design.md section 10.

import { CAMERA_POSE } from './render3d/framing.js';

export const BOARD_SIZE = 15;
export const WIN_LENGTH = 5; // five or more in a row wins
export const COOLDOWN_SHORT = 3;
export const COOLDOWN_LONG = 6;
export const ROCK_LIFETIME_TURNS = 4;
export const TORNADO_SIZE = 3;
export const CELL_PX = 24;
export const INTERNAL_WIDTH = 960;
export const INTERNAL_HEIGHT = 540;
export const HEARTBEAT_INTERVAL_MS = 1000;
export const PEER_TIMEOUT_MS = 3000;
export const LEAVE_COUNTDOWN_S = 10;
export const ROOM_CODE_LENGTH = 5;

// Networking timings not listed in docs/design.md section 10.
export const PRESENCE_CHECK_INTERVAL_MS = 250; // how often the leave countdown is re-checked
export const JOIN_TIMEOUT_MS = 3000; // no answer to "join" within this time means no such room
// Online play works only between windows of the same browser on this
// computer (BroadcastChannel). Becomes false when a WebSocket transport exists.
export const ONLINE_SAME_BROWSER_ONLY = true;

// Screen timings not listed in docs/design.md section 10.
export const GAME_OVER_DELAY_MS = 1500; // time to see the final board before the Game over screen
export const COPY_FEEDBACK_MS = 1500; // how long Copied shows after the room code was copied
export const SELECT_PORTRAIT_SCALE = 2; // whole-number scale of the 128 px portraits on the character cards (sharp pixels)
// The see-through character select (src/ui/room.css, room-screens.js
// selectGlassStyle): how opaque the dark glass of the panel, the character
// cards and the scrim behind the panel is, and how much the panel blurs
// the map behind it on the levels with frosted glass (none on Low).
export const SELECT_PANEL_OPACITY = 0.4;
export const SELECT_CARD_OPACITY = 0.3;
export const SELECT_SCRIM_OPACITY = 0.25;
export const SELECT_BLUR_PX = 8;
// The landing menu (src/ui/menu.css): the dark scrim over the 3D scene
// blurs it this much on the levels with frosted glass (none on Low).
export const MENU_SCRIM_BLUR_PX = 6;
export const MENU_FIT_WIDTH = 1280; // the menu fits this window without scrolling
export const MENU_FIT_HEIGHT = 720;
export const MENU_MIN_BUTTON_PX = 44; // no menu button is lower than this

// Sprite sizes in px from docs/design.md section 7. They are drawn scaled
// to these; the art files themselves must have the size listed in
// assets/manifest.json (see docs/art-spec.md).
export const STONE_PX = 24;
export const ROCK_PX = 24;
export const SKILL_ICON_PX = 32;
export const PORTRAIT_PX = 96;
export const TORNADO_PX = 72; // one frame of the animated overlay
export const ANIMATION_FRAME_MS = 120; // time per frame of animated sprites

// Placeholder effects from docs/design.md section 8. They only draw; they
// never change the game state.
export const SPARKLE_COUNT = 8; // sparkles per placement or skill hit
export const SPARKLE_MS = 500;
export const DUST_COUNT = 6; // dust specks per puff
export const DUST_MS = 450;
export const SHAKE_MS = 180;
export const SHAKE_PX = 2; // largest offset of the light screen shake
export const BANNER_MS = 1200; // how long a skill announcement banner shows
export const WIND_STREAK_COUNT = 7;
export const WIND_STREAK_SPEED = 60; // px per second, left to right

// HD-2D 3D scene from docs/art-direction-hd2d.md sections B and C. World
// units: one board cell is CELL_SIZE wide.
// The camera pose lives in ONE place, CAMERA_POSE in src/render3d/framing.js
// (docs/art-direction-v3.md "Framing numbers"), shared by the renderer and
// the HUD layout. These names read it: the camera looks at CAMERA_TARGET_Z
// on the board's centre line, a little behind the centre, so the field
// sits low on the screen with the meadow, the far edge and the sky above it.
export const CAMERA_FOV = CAMERA_POSE.fovDeg; // vertical field of view in degrees
export const CAMERA_PITCH_DEG = CAMERA_POSE.pitchDeg; // how far the camera looks down, 90 is straight down
export const CAMERA_DISTANCE = CAMERA_POSE.distance; // from the point it looks at, in world units
export const CAMERA_TARGET_Z = -CAMERA_POSE.aimBehind; // the point it looks at: (0, 0, CAMERA_TARGET_Z)
export const CELL_SIZE = 1;
export const FPS_SAMPLE_MS = 500; // the on-screen FPS counter averages over this

// The farmland board from docs/art-direction-v3.md section 3, in art pixels
// (PX_WORLD world units each) or cells.
export const CURB_PX = 8; // width of the wooden curb around the field
// The curb is a raised wooden frame standing this many art pixels above the
// flat meadow and the plots (both at y = 0), so its top and its darker
// camera-side face both show.
export const CURB_HEIGHT_PX = 6;
export const CURB_HEIGHT = CURB_HEIGHT_PX / 32; // in world units (PX_WORLD each)
export const FENCE_OFFSET_CELLS = 1.5; // the fence line lies this far outside the curb
export const FENCE_POST_EVERY = 3; // cells between fence posts
export const FENCE_RAIL_PX = [10, 18]; // rail heights above the ground
export const PATH_WIDTH_CELLS = 1.25;
export const PATH_LENGTH_CELLS = 2.5; // from the curb toward the camera
export const PATH_STONES = [0.7, 1.7]; // stepping stones, cells from the curb

// HD-2D sprites from docs/art-direction-hd2d.md section D. One art pixel is
// PX_WORLD world units for every sprite, so all sprite pixels look the same
// size. 1/32 matches the 480 px farm board texture (32 px per cell).
export const PX_WORLD = 1 / 32;
export const CHARACTER_SPRITE_PX = 96; // Wind Rabbit and Earth Bear, square frames
// The camera looks down CAMERA_PITCH_DEG, so an upright sprite looks only
// cos(pitch) as tall as it is. Sprites stay upright but are stretched in
// height by this factor, so their art pixels look square on screen. Set it
// to 1 to turn the correction off.
export const SPRITE_STRETCH_Y = 1 / Math.cos((CAMERA_PITCH_DEG * Math.PI) / 180);
export const CHARACTER_IDLE_FRAME_MS = 220; // time per frame of the 4 frame idle bob
export const CHARACTER_X = 9.75; // characters stand this far left and right of the board centre
// Wind Rabbit and Earth Bear are not drawn in the world for now: the HUD
// player cards carry the characters. Set to true to show them again; their
// poses keep following the events either way.
export const SHOW_WORLD_CHARACTERS = false;

// Living pieces and characters (sections D and G). They only animate; they
// never change the game state.
export const PIECE_POP_IN_MS = 320; // a placed stone or rock grows in with a small bounce
// Seeds and plants (docs/art-direction-v3.md section 4). The stage start
// times are in assets/v3-meta.json.
export const PLANT_DROP_PX = 10; // the seed slides down this many art pixels onto the plot
export const PLANT_DROP_MS = 150; // over this long, ease in
export const PLANT_OPEN_POP_MS = 120; // the Open stage pops 1.0, 1.12, 1.0 over this long
export const PLANT_OPEN_POP_SCALE = 1.12;
// The in-between frames of the planting animation (plant-frames.js) move
// the sprite up or down by at most this many art pixels. How many there are
// is plantInBetween in the quality table (src/render3d/quality.js).
export const PLANT_IN_BETWEEN_LIFT_PX = 2;
export const PLANT_OPEN_SPARKLES = 4; // gold (X) or pink (O) sparkles when the bloom opens
export const SOIL_PUFF_MIN = 6; // soil pixels flying out when a seed lands
export const SOIL_PUFF_MAX = 8;
export const SOIL_PUFF_MS = 300;
export const CHARACTER_CAST_FRAME_MS = 140; // time per frame of the 4 frame cast animation
export const CHARACTER_CAST_MS = 1000; // a cast shows this long (it holds its last frame), then idle again
export const CHARACTER_POSE_FRAME_MS = 300; // time per frame of the 2 frame win and lose poses
export const CHARACTER_GLOW_FADE_MS = 400; // the current player's glow fades in and out this fast
export const CHARACTER_GLOW_PULSE_MS = 2400; // one slow breath of the glow

// Map 1, Windy Spring Breeze Hill (section C).
// Light fog for depth, in world units from the camera, starting a little
// behind the board.
export const FOG_NEAR = CAMERA_DISTANCE + 15;
export const FOG_FAR = CAMERA_DISTANCE + 110;

// The meadow around the field (docs/art-direction-v3.md section 6). Plan
// distances are in cells (world units).
export const MEADOW_SEED = 20261002; // planMeadow gives the same meadow every game
export const MEADOW_PATCHES = 36; // flower patches, about
export const MEADOW_PATCH_PLANTS = [5, 14]; // plants in one patch, min and max
export const MEADOW_SPACING = 0.7; // Poisson-disc minimum between two meadow plants
export const MEADOW_MARGIN = 1; // keep-out margin around the field, curb, fence, path and characters
export const MEADOW_TREES_BACK = [12, 14]; // back-row trees on screen at 16:9, min and max (the row runs wider, at most 18)
export const MEADOW_TREES_BACK_MAX = 18; // back-row trees in all, covering 21:9 plus 2 world units each side
export const MEADOW_TREES_SIDE = [4, 6]; // trees along the left and right edges together
// Trees are always scale 1 (section 1: never a non-integer scale at
// rest); they vary by random mirroring and a brightness shift of up to
// plus or minus this share.
export const MEADOW_TREE_SCALE = 1;
export const MEADOW_TREE_BRIGHTNESS = 0.06;
export const MEADOW_BUSHES = [8, 10];
export const MEADOW_BALES = 3;
// The forest behind the far edge (docs/art-direction-v3-1.md section 6):
// planForest gives the same forest every game. Its other numbers are in
// src/render3d/forest.js.
export const FOREST_SEED = 20261002;
export const MEADOW_TUFTS = [120, 160]; // grass tufts in all, edges of patches included
export const GROUND_STRIPE_CELLS = 3; // Low: mown stripes this many cells wide
// Blob shadows in the meadow lie flat this far above the flat ground.
// They are layered over it by polygon offset, not by height, so 0.
export const MEADOW_SHADOW_LIFT = 0;
// High: long sun shadows (docs/art-direction-v3.md sections 5 and 7). The
// sun is in the upper left, so each upright sprite casts its dark sheared
// silhouette on the ground toward the lower right of the screen (+x, and
// +z toward the camera), SUN_SHADOW_LENGTH times the sprite's height long.
export const SUN_SHADOW_DIR = [1, 0, 0.9];
export const SUN_SHADOW_LENGTH = 0.9;
export const SUN_SHADOW_OPACITY = 0.35;
// High: slow cloud shadows, a soft multiply layer on the plots and the
// meadow that slides with the near cloud layer. Its darkest spot keeps at
// least 75 percent of the light in every channel, so a plot stays readable.
export const CLOUD_SHADOW_TINT = [0.75, 0.78, 0.85]; // multiply colour at full shadow
export const CLOUD_SHADOW_TILE = 48; // world units: the soft pattern repeats this often
// The cloud shadow layer's resolution: its soft mask tile is this many
// pixels square. The first cost to cut if High is below 60 FPS (64 is fine).
export const CLOUD_SHADOW_MASK_PX = 128;
// Long sun shadows for the meadow flowers (13 instanced kinds) as well as
// for the trees, bushes, bales and board sprites. The second cost to cut
// (false keeps only the scenery and board shadows).
export const SUN_SHADOW_MEADOW_FLOWERS = true;
// The two HUD glass cards (docs/art-direction-v3.md section 8) at 1920 x
// 1080: no tall flowers or trees may show behind them. The height is the
// most the expanded card with both skill rows may take (src/ui/hud.css
// draws it shorter; the skill descriptions live in the tooltip and the
// skill detail popup, not on the card). A skill row is HUD_SKILL_ROW_PX
// tall with its icon filling the square at its start.
export const HUD_CARD_SIDE_PX = 56;
export const HUD_CARD_TOP_PX = 120;
export const HUD_CARD_WIDTH_PX = 250;
export const HUD_CARD_HEIGHT_PX = 310;
export const HUD_SKILL_ROW_PX = 60;
// The calm screen area behind each card where the meadow grows no tall
// flowers or trees (src/render3d/meadow.js). It keeps the size of the
// larger v3 card, so it still covers the smaller card and the scenery plan
// does not change with the HUD.
export const HUD_CALM_WIDTH_PX = 332;
export const HUD_CALM_HEIGHT_PX = 430;
export const HUD_SCREEN_PX = [1920, 1080];

// Wind and sway (section 6, High only). Everything moves along WIND_DIR.
export const WIND_DIR = [1, 0, 0.35]; // x, y, z; normalised on the ground where used
export const SWAY_CALM_PX = 1; // the top of a meadow plant leans this many art pixels
export const SWAY_GUST_PX = 2; // in a gust
export const PLANT_SWAY_SHARE = 0.5; // resting X and O plants sway at half the meadow's amplitude
export const SWAY_PERIOD_MS = 2600; // one slow sway back and forth
export const GUST_EVERY_MS = [7000, 11000]; // time from one gust start to the next
export const GUST_MS = 1200; // a gust lasts this long
export const DANDELION_RELEASE_MS = [6000, 10000]; // a seed puff lets a seed fleck go this often
export const DANDELION_FLECK_MS = 4500; // a seed fleck drifts this long before it is gone
export const DANDELION_FLECK_SPEED = 0.7; // world units per second along the wind, tripled in a gust
export const DANDELION_FLECK_POOL = 24; // most seed flecks in the air at once

// Sky, clouds and wind petals (docs/art-direction-v3.md section 7). Screen
// spots are fractions of the view: x from the left, y from the top.
// The horizon, the meadow's far edge (src/render3d/horizon.js farEdgeZ),
// lies 21 percent of the height down at 16:9 (SKY_HORIZON_FRACTION). The
// sky gradient's stops are SKY_HAZE_STOPS in src/render3d/haze.js
// (docs/art-direction-v3-1.md section 5); it follows the live horizon.
export const SKY_HORIZON_FRACTION = 0.21;
// The lowest the far hills' crests reach on screen: every cloud stays above it.
export const SKY_STRIP_FRACTION = 0.15;
// Cloud layers from clouds.png. A cloud stands `depth` world units in front
// of the camera: in front of the far hills, behind the trees and the
// meadow's far edge. At scale 1 its art pixels look as big as the board's.
// speed is world units per second straight to the right on screen (High
// only): clouds are high above the ground, so they drift horizontally.
export const CLOUD_LAYERS = {
  far: { scale: 0.6, speed: 0.35, depth: 110 },
  near: { scale: 1.0, speed: 0.6, depth: 90 },
};
// Medium: 4 still clouds. x is the cloud's centre, y its flat bottom. The
// bottoms stay above the hill crests (SKY_STRIP_FRACTION) so nothing cuts them.
export const STILL_CLOUDS = [
  { x: 0.14, y: 0.13, frame: 0, layer: 'near' },
  { x: 0.5, y: 0.115, frame: 2, layer: 'near' },
  { x: 0.78, y: 0.095, frame: 3, layer: 'far' },
  { x: 0.9, y: 0.135, frame: 4, layer: 'near' },
];
// High: 4 clouds in each layer drift to the right and wrap around
// sideways, out of sight. Each keeps its flat bottom at one of these
// heights (fractions of the view down) so it shows whole inside the sky
// strip above the hill crests (SKY_STRIP_FRACTION): a near cloud is about
// 0.09 of the view tall, a far one about 0.054.
export const DRIFT_CLOUD_BOTTOMS = {
  far: [0.085, 0.1, 0.08, 0.095],
  near: [0.125, 0.135, 0.12, 0.13],
};
export const WISP_COUNT = 6; // thin soft streaks drifting with the far layer
export const WISP_ALPHA = 0.25;
export const WISP_PX = [160, 6]; // art pixels at the far layer's pixel size
export const WISP_HEIGHTS = [0.03, 0.055, 0.04, 0.07, 0.025, 0.06]; // wisp centres, fractions of the view down
export const SUN_RAY_COUNT = 3; // soft additive wedges from the upper left
export const SUN_RAY_ALPHA = 0.1; // at the top of a breath
export const SUN_RAY_LOW = 0.45; // share of SUN_RAY_ALPHA at the bottom of a breath
export const SUN_RAY_PERIOD_MS = 14000; // one slow breath
export const SUN_RAY_ANGLES_DEG = [-24, -37, -50]; // below the screen's horizontal, toward the lower right
export const SUN_RAY_LENGTH = 0.85; // in view widths
export const SUN_RAY_DEPTH = 10; // sun rays hang this far in front of the camera, over everything
// Wind petals from wind-bits (High only), in three lanes. Each lane is a
// band along the wind: `centre` on the ground, `length` along the wind,
// `width` across it, petals `height` world units up. Petals wrap around
// from its downwind end to its upwind end, fading in and out at the ends
// (PETAL_END_FADE of the length). About 40 show in view at a time.
export const WIND_LANES = {
  far: { scale: 0.6, speed: 0.6, count: 13, centre: [0, -9], length: 30, width: 3, height: [0.3, 2.2] },
  mid: { scale: 1.0, speed: 1.0, count: 20, centre: [0, 0.5], length: 34, width: 12, height: [0.6, 2.0] },
  // Near-lane petals hide while in front of the field, about half of them.
  near: { scale: 1.6, speed: 1.5, count: 22, centre: [0, 6], length: 28, width: 8, height: [5.5, 8.5] },
};
export const PETAL_END_FADE = 0.08;
export const PETAL_TRAIL_MS = [60, 120, 180]; // ghost copies this far behind a petal
export const PETAL_TRAIL_ALPHA = [0.5, 0.3, 0.15];
export const PETAL_BOB = 0.15; // world units up and down
export const PETAL_BOB_MS = 1600;
export const PETAL_FLUTTER = 0.12; // world units from side to side, across the wind
export const PETAL_FLUTTER_MS = 2300;
export const PETAL_TUMBLE_MS = 700; // a petal flips over this often
export const PETAL_FIELD_FADE = 1; // cells: near-lane petals fade out over this distance onto the field

// Post-processing and quality levels. The levels themselves (pixel ratio
// cap, particle caps and every other switch) live in ONE table in
// src/render3d/quality.js (docs/art-direction-v3.md section 5).
// 60 fps is 16.7 ms a frame. The step-down limit leaves some headroom so the
// normal jitter of a 60 Hz screen and a rare dropped frame never step down.
export const TARGET_FRAME_MS = 20;
export const QUALITY_STEP_DOWN_MS = 3000; // the average must stay above TARGET_FRAME_MS this long
export const QUALITY_STALL_MS = 250; // a longer frame is a stall (hidden tab, shader compile), not load
export const RESUME_GAP_MS = 1000; // a longer gap between frames means the page was hidden; events from meanwhile show settled, without replaying their effects
// High: a gentle depth of field (src/render3d/depth-of-field.js). Every
// depth from DOF_SHARP_MARGIN world units in front of the field's front edge
// to DOF_SHARP_MARGIN behind its back edge (and the back row of trees) is
// perfectly sharp. Outside that band the blur radius grows by
// DOF_BLUR_PER_UNIT per world unit of depth, up to DOF_MAX_BLUR. Radii are
// fractions of the screen height (0.0015 is 1.6 px at 1080 px tall).
export const DOF_SHARP_MARGIN = 3;
export const DOF_BLUR_PER_UNIT = 0.00003;
export const DOF_MAX_BLUR = 0.0015;
export const BLOOM_STRENGTH = 0.3; // subtle bloom on bright things only
export const BLOOM_RADIUS = 0.3;
// Linear brightness a pixel needs before it blooms. Above anything the lit
// scene, the sky and the clouds reach (at most about 1.0), so only what
// BLOOM_GLOW lifts over it glows: sparkles and bright wind petals.
export const BLOOM_THRESHOLD = 1.0;
// While bloom is on, sparkles are drawn this many times brighter and bright
// wind petals (linear luminance above BLOOM_PETAL_LUMINANCE) BLOOM_PETAL_GLOW
// times, so they pass BLOOM_THRESHOLD. Tone mapping keeps them in range.
export const BLOOM_SPARKLE_GLOW = 2.2;
export const BLOOM_PETAL_GLOW = 1.25;
export const BLOOM_PETAL_LUMINANCE = 0.6;
// High: a warm colour grade, a gain per linear channel (red and green up a
// little, blue down), and a slight lift of saturation.
export const WARM_GRADE_GAIN = [1.05, 1.015, 0.92];
export const WARM_GRADE_SATURATION = 1.06;
// Light vignette: corners are mixed VIGNETTE_OFFSET^2 / 2 of the way (18%)
// towards the colour 1 - VIGNETTE_DARKNESS (black), the centre not at all.
export const VIGNETTE_OFFSET = 0.6;
export const VIGNETTE_DARKNESS = 1.0;
export const TONE_MAPPING_EXPOSURE = 1.0;

// Skill visuals and placement effects in 3D (section G). They only draw; they
// never change the game state. Particle counts and rates are for high; the
// quality levels scale them down and cap the live particles
// (particleCap in src/render3d/quality.js).
export const PLACE_DUST_COUNT = 10; // soil specks in a soil puff
export const REVERSE_GROWTH_SPEED = 2.5; // a plant folds back through its stages this many times faster than it grows
export const DASH_STREAK_MS = 420; // a resolved Wind Dash seed rides its gust to the target this fast
export const DASH_CURVE = 0.22; // the gust bows sideways by this share of the way's length
export const DASH_LIFT = 0.35; // world units the seed rises halfway along the gust
export const DASH_TRAIL_RATE = 160; // petals per second in the gust behind a dashing seed
export const DASH_SWIRL_RATE = 40; // petals per second circling a dash source
export const MARK_FADE_MS = 300; // the Wind Dash marks and the Tornado Zone fade out this fast when they end
export const TORNADO_PARTICLE_RATE = 110; // petals and leaves per second rising in a Tornado Zone swirl
export const TORNADO_BEND_PX = 3; // plants inside a Tornado Zone lean their tops this many art pixels towards it (High)
export const THROW_DELAY_MS = 180; // a seed planted in a zone drops onto its plot this long before it is thrown
export const THROW_MS = 560; // flight time of a thrown seed
export const THROW_ARC_HEIGHT = 1.6; // world units at the top of the arc
export const ROCK_FALL_MS = 460; // a Terrain Creation rock falls this long
export const ROCK_FALL_HEIGHT = 9; // world units above the board where it starts
export const ROCK_SETTLE_MS = 160; // the squash after the impact
export const ROCK_CRUMBLE_MS = 380; // a breaking rock sinks into soil crumbs and pebbles this long
export const CONVERT_SPARK_MS = 320; // Stone Conversion: the spark runs through the soil this long after the wilt
export const CONVERT_SPARK_RATE = 70; // spark twinkles per second left in the soil
export const SHAKE3D_MS = 240; // camera shake length
export const SHAKE3D_LIGHT = 0.04; // world units at the start of a light shake (a rock landing, the only shake)
export const SHAKE3D_HEAVY = 0.13; // a strong shake (unused by the farm visuals)
export const BANNER_3D_Y = 84; // top of the skill banner on the 3D HUD, under the title and hint

// Shot mode (?shot=<scene>, docs/shots.md section 4): the screenshot
// self-check freezes every time driven thing at this time and seeds the
// game's random source (the Tornado Zone throw) with this number.
export const SHOT_TIME_MS = 12000;
export const SHOT_SEED = 20261003;
// Seed of the 2D renderer's sparkles and dust in shot mode (?render=2d).
export const SHOT_EFFECTS_SEED = 0x51f15e;
// The ready flag waits for this many frames drawn at the final window size.
export const SHOT_READY_FRAMES = 3;
