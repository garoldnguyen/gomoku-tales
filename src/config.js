// Tunable values from docs/design.md section 10.

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

// Screen timings not listed in docs/design.md section 10.
export const GAME_OVER_DELAY_MS = 1500; // time to see the final board before the Game over screen

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
export const CAMERA_FOV = 35; // vertical field of view in degrees
export const CAMERA_PITCH_DEG = 55; // how far the camera looks down, 90 is straight down
export const CAMERA_DISTANCE = 30; // from the board centre, in world units
export const CELL_SIZE = 1;
export const FPS_SAMPLE_MS = 500; // the on-screen FPS counter averages over this
export const BOARD_THICKNESS = 0.4; // the raised field: its top is y = 0, the meadow lies this far below

// The farmland board from docs/art-direction-v3.md section 3, in art pixels
// (PX_WORLD world units each) or cells.
export const CURB_PX = 8; // width of the wooden curb around the field
export const CURB_LIFT_PX = 1; // the curb top sits this far above the plots
export const CURB_FACE_PX = 6; // height of the darker wooden front face; soil below it
export const FENCE_OFFSET_CELLS = 1.5; // the fence line lies this far outside the curb
export const FENCE_POST_EVERY = 3; // cells between fence posts
export const FENCE_RAIL_PX = [10, 18]; // rail heights above the ground
export const PATH_WIDTH_CELLS = 1.25;
export const PATH_LENGTH_CELLS = 2.5; // from the curb toward the camera
export const PATH_STONES = [0.7, 1.7]; // stepping stones, cells from the curb

// HD-2D sprites from docs/art-direction-hd2d.md section D. One art pixel is
// PX_WORLD world units for every sprite, so all sprite pixels look the same
// size. 1/32 matches the 480 px board texture (32 px per cell).
export const PX_WORLD = 1 / 32;
export const PIECE_SPRITE_PX = 32; // X and O stones and the rock, square frames
export const CHARACTER_SPRITE_PX = 96; // Wind Rabbit and Earth Bear, square frames
export const BOARD_TEXTURE_PX = 480; // the board top texture, square, so one cell is 32 px
export const DECAL_PX = 16; // flat cell decals (hover, marks, skill targets), square
export const CLOUD_VARIANTS = 4; // cloud shapes, the frames of the cloud sheet
// The camera looks down CAMERA_PITCH_DEG, so an upright sprite looks only
// cos(pitch) as tall as it is. Sprites stay upright but are stretched in
// height by this factor, so their art pixels look square on screen. Set it
// to 1 to turn the correction off.
export const SPRITE_STRETCH_Y = 1 / Math.cos((CAMERA_PITCH_DEG * Math.PI) / 180);
export const CHARACTER_IDLE_FRAME_MS = 220; // time per frame of the 4 frame idle bob
export const CHARACTER_X = 9.75; // characters stand this far left and right of the board centre

// Living pieces and characters (sections D and G). They only animate; they
// never change the game state.
export const PIECE_POP_IN_MS = 320; // a placed stone or rock grows in with a small bounce
export const CHARACTER_CAST_FRAME_MS = 140; // time per frame of the 4 frame cast animation
export const CHARACTER_CAST_MS = 1000; // a cast shows this long (it holds its last frame), then idle again
export const CHARACTER_POSE_FRAME_MS = 300; // time per frame of the 2 frame win and lose poses
export const CHARACTER_GLOW_FADE_MS = 400; // the current player's glow fades in and out this fast
export const CHARACTER_GLOW_PULSE_MS = 2400; // one slow breath of the glow

// Map 1, Windy Spring Breeze Hill (section C).
export const WILDFLOWER_COUNT = 280; // instanced flower and grass tuft billboards
export const CLOUD_COUNT = 7;
export const CLOUD_SPEED = 0.6; // world units per second, drifting towards +x
export const CLOUD_PX_WORLD = 1 / 8; // clouds are far away, so their art pixels are bigger
export const WIND3D_STREAK_COUNT = 10;
export const WIND3D_STREAK_SPEED = 5; // world units per second, towards +x
export const FOG_NEAR = 45; // light fog for depth, in world units from the camera
export const FOG_FAR = 140;

// Post-processing and quality levels. The levels themselves (pixel ratio
// cap, particle caps and every other switch) live in ONE table in
// src/render3d/quality.js (docs/art-direction-v3.md section 5).
// 60 fps is 16.7 ms a frame. The step-down limit leaves some headroom so the
// normal jitter of a 60 Hz screen and a rare dropped frame never step down.
export const TARGET_FRAME_MS = 20;
export const QUALITY_STEP_DOWN_MS = 3000; // the average must stay above TARGET_FRAME_MS this long
export const QUALITY_STALL_MS = 250; // a longer frame is a stall (hidden tab, shader compile), not load
export const RESUME_GAP_MS = 1000; // a longer gap between frames means the page was hidden; events from meanwhile show settled, without replaying their effects
export const DOF_APERTURE = 0.0002; // high, depth of field focused on the board centre
export const DOF_MAX_BLUR = 0.006; // in screen widths
export const BLOOM_STRENGTH = 0.3; // subtle bloom on bright things only
export const BLOOM_RADIUS = 0.3;
export const BLOOM_THRESHOLD = 0.85; // linear brightness a pixel needs before it blooms
// Light vignette: corners are mixed VIGNETTE_OFFSET^2 / 2 of the way (18%)
// towards the colour 1 - VIGNETTE_DARKNESS (black), the centre not at all.
export const VIGNETTE_OFFSET = 0.6;
export const VIGNETTE_DARKNESS = 1.0;
export const TONE_MAPPING_EXPOSURE = 1.0;

// Skill visuals and placement effects in 3D (section G). They only draw; they
// never change the game state. Particle counts and rates are for high; the
// quality levels scale them down and cap the live particles
// (particleCap in src/render3d/quality.js).
export const PLACE_SPARKLE_COUNT = 12; // sparkles when a stone lands
export const PLACE_DUST_COUNT = 10; // specks in a dust puff
export const DASH_STREAK_MS = 420; // a resolved Wind Dash streaks to its target this fast
export const DASH_TRAIL_RATE = 160; // trail particles per second behind a dashing stone
export const DASH_SWIRL_RATE = 40; // swirl particles per second around a dash source
export const MARK_FADE_MS = 300; // the Wind Dash marks and the Tornado Zone fade out this fast when they end
export const TORNADO_PARTICLE_RATE = 110; // particles per second rising in a Tornado Zone column
export const THROW_DELAY_MS = 180; // a stone placed in a zone shows this long before it is thrown
export const THROW_MS = 560; // flight time of a thrown stone
export const THROW_ARC_HEIGHT = 1.6; // world units at the top of the arc
export const ROCK_FALL_MS = 460; // a Terrain Creation rock falls this long
export const ROCK_FALL_HEIGHT = 9; // world units above the board where it starts
export const ROCK_SETTLE_MS = 160; // the squash after the impact
export const ROCK_CRUMBLE_MS = 380; // a breaking rock sinks into rubble this long
export const CONVERT_MS = 900; // Stone Conversion: glow, lift, flip and land
export const CONVERT_LIFT = 0.7; // world units the converted stone rises
export const CONVERT_SPARKLE_RATE = 36; // rising sparkles per second while it glows
export const SHAKE3D_MS = 240; // camera shake length
export const SHAKE3D_LIGHT = 0.04; // world units at the start of a light shake (placements, landings)
export const SHAKE3D_HEAVY = 0.13; // a falling rock
export const BANNER_3D_Y = 84; // top of the skill banner on the 3D HUD, under the title and hint
