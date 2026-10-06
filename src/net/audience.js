// Who watches a room (docs/flow-design.md section 3.9): the spectators the
// players and the other spectators see. Pure: no DOM, shared with the relay.
//
// A spectator says it is there with { type: 'watch', from, name } when it
// connects (and again when it hears a guest welcomed, so a guest who came
// later learns it too), and { type: 'unwatch', from } when it stops.
// Over the relay these never reach the others: the relay keeps the list
// itself, as the spectators' sockets come and go (a closed tab sends
// nothing), and sends everyone { type: 'audience', from: 'relay',
// watchers: [{ id, name }] } after every change, and to a player that
// connects while spectators are there. On a BroadcastChannel the watch and
// unwatch messages go to everyone directly.

import { CHAT, cleanName } from './chat.js';

export const WATCH = 'watch';
export const UNWATCH = 'unwatch';
export const AUDIENCE = 'audience';
export const RELAY_ID = 'relay';
export const AUDIENCE_TYPES = Object.freeze([WATCH, UNWATCH, AUDIENCE]);
// The only messages a spectator sends (the relay closes it for any other).
export const SPECTATOR_SENDS = Object.freeze([CHAT, WATCH, UNWATCH]);

// The audience message the relay sends for watchers [{ id, name }].
export function audienceMessage(watchers) {
  return { type: AUDIENCE, from: RELAY_ID, watchers: watchers.map(({ id, name }) => ({ id, name: cleanName(name) })) };
}

// A list of who watches, changed by the messages above. self is the id of
// this window (a spectator does not list itself).
export function createAudience(self = null) {
  let watchers = new Map(); // id -> name (null when it gave none)
  return {
    // Takes one message; true when the list changed.
    take(message) {
      if (!message || !AUDIENCE_TYPES.includes(message.type)) return false;
      const before = JSON.stringify([...watchers]);
      if (message.type === AUDIENCE) {
        if (!Array.isArray(message.watchers)) return false;
        watchers = new Map();
        for (const watcher of message.watchers) {
          if (typeof watcher?.id === 'string' && watcher.id !== self) watchers.set(watcher.id, cleanName(watcher.name));
        }
      } else if (typeof message.from !== 'string' || message.from === self) {
        return false;
      } else if (message.type === WATCH) {
        watchers.set(message.from, cleanName(message.name));
      } else {
        watchers.delete(message.from);
      }
      return JSON.stringify([...watchers]) !== before;
    },
    // [{ id, name }] in the order they came.
    list() {
      return [...watchers].map(([id, name]) => ({ id, name }));
    },
    clear() {
      watchers = new Map();
    },
  };
}
