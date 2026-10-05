// Transport interface (docs/design.md section 6). A transport moves plain,
// serializable message objects between the two windows of a room:
//
//   send(message)      delivers message to every other end of the room
//                      (never back to the sender)
//   onMessage(handler) calls handler(message) for each message that
//                      arrives; returns a function that removes the handler
//   close()            stops sending and receiving
//
// Version 1 uses a BroadcastChannel, which links windows of the same origin
// and browser profile. src/net/ws-transport.js offers the same three methods
// over a WebSocket to the relay server; chooseTransport picks between them.

export const CHANNEL_PREFIX = 'gomoku-tales-';

export const TRANSPORT_BROADCAST = 'broadcast';
export const TRANSPORT_WEBSOCKET = 'websocket';
export const TRANSPORTS = Object.freeze([TRANSPORT_BROADCAST, TRANSPORT_WEBSOCKET]);

// The only place that reads ONLINE_TRANSPORT. Returns the configured
// transport name; an unknown value falls back to broadcast.
export function chooseTransport(config) {
  const value = config?.ONLINE_TRANSPORT;
  return TRANSPORTS.includes(value) ? value : TRANSPORT_BROADCAST;
}

export function channelName(roomCode) {
  return CHANNEL_PREFIX + roomCode;
}

// options.BroadcastChannelImpl lets tests swap the channel class.
export function createBroadcastTransport(roomCode, options = {}) {
  const { BroadcastChannelImpl = globalThis.BroadcastChannel } = options;
  const channel = new BroadcastChannelImpl(channelName(roomCode));
  const handlers = new Set();
  let closed = false;

  channel.onmessage = (event) => {
    if (closed) return;
    for (const handler of [...handlers]) handler(event.data);
  };

  return {
    send(message) {
      if (!closed) channel.postMessage(message);
    },

    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },

    close() {
      if (closed) return;
      closed = true;
      handlers.clear();
      channel.close();
    },
  };
}
