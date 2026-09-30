// In-memory transport for tests. Every transport made by one network is an
// end of the same room: a message sent by one end reaches every other open
// end, never the sender, and is structured-cloned like BroadcastChannel
// does. Delivery is synchronous but never nested: a message sent from inside
// a handler is queued and delivered after the current one, in send order.

export function createFakeNetwork() {
  const ends = new Set();
  const queue = [];
  let pumping = false;

  const pump = () => {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0) {
        const { sender, message } = queue.shift();
        for (const end of [...ends]) {
          if (end !== sender) end.deliver(structuredClone(message));
        }
      }
    } finally {
      pumping = false;
    }
  };

  return {
    // Makes a new end of the room.
    connect() {
      const handlers = new Set();
      let closed = false;
      let muted = false;
      const end = {
        deliver(message) {
          if (closed) return;
          for (const handler of [...handlers]) handler(message);
        },
      };
      ends.add(end);

      const transport = {
        // Messages sent by this end (including after close) for checks in tests.
        sent: [],

        send(message) {
          if (closed) return;
          transport.sent.push(structuredClone(message));
          if (muted) return;
          queue.push({ sender: end, message });
          pump();
        },

        onMessage(handler) {
          handlers.add(handler);
          return () => handlers.delete(handler);
        },

        close() {
          closed = true;
          handlers.clear();
          ends.delete(end);
        },

        // Test hook: while muted, this end's messages are silently lost, as
        // if the window froze or the connection dropped.
        setMuted(value) {
          muted = value;
        },

        get closed() {
          return closed;
        },
      };
      return transport;
    },

    // Number of open ends.
    get size() {
      return ends.size;
    },
  };
}
