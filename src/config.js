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
