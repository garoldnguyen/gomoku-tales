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

// Sprite sizes in px from docs/design.md section 7. Art files may be any
// size; they are drawn scaled to these.
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
