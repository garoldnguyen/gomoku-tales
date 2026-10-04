// The phases of an online room (docs/flow-design.md sections 5 and 6),
// owned by the host: waiting for a guest, starting after the join delay,
// playing, and over once the game has ended.

export const ROOM_PHASES = Object.freeze({
  WAITING: 'waiting',
  STARTING: 'starting',
  PLAYING: 'playing',
  OVER: 'over',
});
