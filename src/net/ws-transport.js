// WebSocket transport (docs/design.md section 6): the same three methods as
// src/net/transport.js (send, onMessage, close), carried over a WebSocket to
// the relay server on the page's own host, plus
//
//   opened   a promise that resolves when the socket is open and rejects
//            when the server refuses the connection or it fails (or is
//            closed) before opening
//
// Messages travel as JSON text. Messages sent before the socket is open are
// dropped: src/net/room.js resends its state through the heartbeat. A
// spectator only listens; its send returns false and sends nothing.

import { RELAY_PATH } from '../config.js';

export const ROLE_HOST = 'host';
export const ROLE_GUEST = 'guest';
export const ROLE_SPECTATOR = 'spectator';
export const ROLES = Object.freeze([ROLE_HOST, ROLE_GUEST, ROLE_SPECTATOR]);

const OPEN = 1; // WebSocket.OPEN

// wss when the page is https, ws otherwise, on the page's host.
export function relayUrl(roomCode, role, location, path = RELAY_PATH) {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = 'room=' + encodeURIComponent(roomCode) + '&role=' + encodeURIComponent(role);
  return scheme + '//' + location.host + path + '?' + query;
}

// options.WebSocketImpl and options.location let tests inject a fake socket
// and page location; options.path overrides RELAY_PATH.
export function createWebSocketTransport(roomCode, role, options = {}) {
  if (!ROLES.includes(role)) throw new Error('Unknown transport role: ' + role);
  const {
    WebSocketImpl = globalThis.WebSocket,
    location = globalThis.location,
    path = RELAY_PATH,
  } = options;

  const socket = new WebSocketImpl(relayUrl(roomCode, role, location, path));
  const handlers = new Set();
  let isOpen = false;
  let settled = false;
  let closed = false;
  let resolveOpened;
  let rejectOpened;
  const opened = new Promise((resolve, reject) => {
    resolveOpened = resolve;
    rejectOpened = reject;
  });
  // A caller that never awaits opened must not see an unhandled rejection.
  opened.catch(() => {});

  const fail = (reason) => {
    isOpen = false;
    if (settled) return;
    settled = true;
    rejectOpened(new Error(reason));
  };

  socket.onopen = () => {
    if (closed) return;
    isOpen = true;
    if (!settled) {
      settled = true;
      resolveOpened();
    }
  };

  socket.onmessage = (event) => {
    if (closed || typeof event.data !== 'string') return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return; // not JSON: ignored
    }
    for (const handler of [...handlers]) handler(message);
  };

  socket.onerror = () => fail('connection failed');
  socket.onclose = (event) => fail('connection refused' + (event?.code ? ' (' + event.code + ')' : ''));

  return {
    opened,

    send(message) {
      if (role === ROLE_SPECTATOR || closed) return false;
      if (!isOpen || socket.readyState !== OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    },

    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },

    close() {
      if (closed) return;
      closed = true;
      handlers.clear();
      fail('closed');
      socket.close();
    },
  };
}
