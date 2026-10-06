// Player names and room chat (docs/flow-design.md section 3.12), the parts
// the rooms, the relay and the screens share. Pure: no DOM.
//
// A name is what a player typed on Play Online or Watch a match, cleaned
// by cleanName: control characters removed, spaces squeezed, at most
// NAME_MAX_LENGTH characters. The host sends the names of both seats with
// its messages ({ host, guest }), the guest sends its own with join.
//
// A chat message is { type: 'chat', from, name, text } sent to everyone in
// the room: the relay passes it to every other socket, spectators included
// (worker/pairing.js). cleanChat checks one that arrived.

import { CHAT_MAX_LENGTH, NAME_MAX_LENGTH } from '../config.js';

export const CHAT = 'chat';

// Control characters (C0, DEL and C1) and the line and paragraph separators.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

function clean(text, max) {
  if (typeof text !== 'string') return '';
  return [...text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim();
}

// A cleaned name, or null when nothing is left.
export function cleanName(text) {
  const name = clean(text, NAME_MAX_LENGTH);
  return name.length > 0 ? name : null;
}

// A cleaned chat text, or null when nothing is left.
export function cleanChatText(text) {
  const words = clean(text, CHAT_MAX_LENGTH);
  return words.length > 0 ? words : null;
}

// The names of both seats from a host message, cleaned: { host, guest }
// (null for an unknown name), or null when the message carries none.
export function namesOf(message) {
  const names = message?.names;
  if (!names || typeof names !== 'object') return null;
  return { host: cleanName(names.host), guest: cleanName(names.guest) };
}

// A chat message that arrived, as { from, name, text }, or null when it is
// not a usable one.
export function chatOf(message) {
  if (message?.type !== CHAT || typeof message.from !== 'string') return null;
  const text = cleanChatText(message.text);
  if (text === null) return null;
  return { from: message.from, name: cleanName(message.name), text };
}
