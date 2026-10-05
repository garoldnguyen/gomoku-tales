// One room of the relay server (docs/deploy.md): a Durable Object named by
// the room code, using the WebSocket hibernation API so an idle room costs
// nothing. The relay does not know the game rules; it only passes frames:
//
//   host       its messages go to the guest and to every spectator
//   guest      its messages go to the host only
//   spectator  only listens; any message it sends closes its socket
//
// Each socket keeps { role, peer } with serializeAttachment (it survives
// hibernation). peer starts as a relay id and becomes the from of the
// socket's first message, so the leave message sent to the other side when
// a host or guest closes names the peer the browser rooms know.
//
// The last host message of each SNAPSHOT_TYPES type is kept in ctx.storage
// and replayed to every new spectator. A room with no socket forgets it
// after EMPTY_ROOM_CLEANUP_MS.

import { DurableObject } from 'cloudflare:workers';
import { ROLE_HOST, ROLE_GUEST, ROLE_SPECTATOR } from '../src/net/ws-transport.js';
import { LIMITS } from './limits.js';
import {
  JOIN_ACCEPT,
  JOIN_NO_ROOM,
  FRAME_OK,
  FRAME_TOO_LARGE,
  SNAPSHOT_TYPES,
  parseRelayQuery,
  decideJoin,
  checkFrame,
  countFrame,
  snapshotFor,
} from './pairing.js';

const SOCKET_OPEN = 1; // WebSocket.READY_STATE_OPEN
const CLOSE_NORMAL = 1000;
const CLOSE_POLICY = 1008;
const CLOSE_TOO_BIG = 1009;
const SNAPSHOT_KEY = 'snapshot';

export class RoomRelay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rates = new Map(); // socket -> { start, count }, rebuilt after hibernation
    this.snapshot = null; // loaded from ctx.storage on first use
  }

  openSockets(role) {
    return this.ctx.getWebSockets(role).filter((ws) => ws.readyState === SOCKET_OPEN);
  }

  current() {
    return {
      host: this.openSockets(ROLE_HOST).length > 0,
      guest: this.openSockets(ROLE_GUEST).length > 0,
      spectators: this.openSockets(ROLE_SPECTATOR).length,
    };
  }

  async loadSnapshot() {
    if (!this.snapshot) this.snapshot = (await this.ctx.storage.get(SNAPSHOT_KEY)) ?? {};
    return this.snapshot;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const query = parseRelayQuery(new URL(request.url).searchParams);
    if (!query.ok) return new Response(query.reason, { status: query.status });

    const decision = decideJoin(this.current(), query.role);
    if (decision !== JOIN_ACCEPT) return new Response(decision, { status: decision === JOIN_NO_ROOM ? 404 : 409 });

    const empty = this.ctx.getWebSockets().length === 0;
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [query.role]);
    server.serializeAttachment({ role: query.role, peer: crypto.randomUUID(), learned: false });

    await this.ctx.storage.deleteAlarm();
    if (query.role === ROLE_HOST && empty) {
      // A new room under this code: nothing of an older one is replayed.
      this.snapshot = {};
      await this.ctx.storage.delete(SNAPSHOT_KEY);
    }
    if (query.role === ROLE_SPECTATOR) {
      for (const text of snapshotFor(await this.loadSnapshot())) server.send(text);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const attachment = ws.deserializeAttachment();
    if (!attachment || attachment.role === ROLE_SPECTATOR) {
      ws.close(CLOSE_POLICY, 'spectators only listen');
      return;
    }

    let window = this.rates.get(ws);
    if (!window) {
      window = { start: Date.now(), count: 0 };
      this.rates.set(ws, window);
    }
    countFrame(window, Date.now());
    const verdict = checkFrame(raw, {
      MAX_FRAME_BYTES: LIMITS.MAX_FRAME_BYTES,
      MAX_FRAMES_PER_SECOND: LIMITS.MAX_FRAMES_PER_SECOND,
      framesThisSecond: window.count,
    });
    if (verdict !== FRAME_OK) {
      ws.close(verdict === FRAME_TOO_LARGE ? CLOSE_TOO_BIG : CLOSE_POLICY, verdict);
      return;
    }

    const message = JSON.parse(raw);
    if (!attachment.learned && typeof message.from === 'string') {
      attachment.peer = message.from;
      attachment.learned = true;
      ws.serializeAttachment(attachment);
    }

    if (attachment.role === ROLE_GUEST) {
      for (const peer of this.openSockets(ROLE_HOST)) peer.send(raw);
      return;
    }
    for (const peer of this.openSockets(ROLE_GUEST)) peer.send(raw);
    for (const peer of this.openSockets(ROLE_SPECTATOR)) peer.send(raw);
    if (SNAPSHOT_TYPES.includes(message.type)) {
      const snapshot = await this.loadSnapshot();
      snapshot[message.type] = raw;
      await this.ctx.storage.put(SNAPSHOT_KEY, snapshot);
    }
  }

  async webSocketClose(ws, code, reason) {
    await this.closed(ws, code === 1005 || code === 1006 ? CLOSE_NORMAL : code, reason);
  }

  async webSocketError(ws) {
    await this.closed(ws, CLOSE_NORMAL, 'error');
  }

  async closed(ws, code, reason) {
    this.rates.delete(ws);
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
    const attachment = ws.deserializeAttachment();
    if (attachment?.role === ROLE_HOST || attachment?.role === ROLE_GUEST) {
      // The other side learns at once that this peer left.
      const others = attachment.role === ROLE_HOST
        ? [...this.openSockets(ROLE_GUEST), ...this.openSockets(ROLE_SPECTATOR)]
        : this.openSockets(ROLE_HOST);
      for (const peer of others) {
        if (peer === ws) continue;
        const to = peer.deserializeAttachment()?.peer;
        peer.send(JSON.stringify({ type: 'leave', from: attachment.peer, to }));
      }
    }
    const left = this.ctx.getWebSockets().filter((other) => other !== ws && other.readyState === SOCKET_OPEN);
    if (left.length === 0) await this.ctx.storage.setAlarm(Date.now() + LIMITS.EMPTY_ROOM_CLEANUP_MS);
  }

  async alarm() {
    if (this.openSockets().length > 0) return;
    this.snapshot = null;
    await this.ctx.storage.deleteAll();
  }
}
