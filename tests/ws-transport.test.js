import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as config from '../src/config.js';
import { TRANSPORT_BROADCAST, TRANSPORT_WEBSOCKET, chooseTransport } from '../src/net/transport.js';
import { createWebSocketTransport, relayUrl } from '../src/net/ws-transport.js';

// A fake WebSocket: records the URL and sent frames; the test drives the
// open, message, error and close events.
function fakeSocketClass() {
  const sockets = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.closeCalls = 0;
      sockets.push(this);
    }
    send(text) {
      if (this.readyState !== 1) throw new Error('send before open');
      this.sent.push(text);
    }
    close() {
      this.closeCalls += 1;
      this.readyState = 3;
    }
    serverOpen() {
      this.readyState = 1;
      this.onopen?.({});
    }
    serverSend(data) {
      this.onmessage?.({ data });
    }
    serverError() {
      this.onerror?.({});
    }
    serverClose(code = 1008) {
      this.readyState = 3;
      this.onclose?.({ code });
    }
  }
  return { FakeWebSocket, sockets };
}

const HTTP = { protocol: 'http:', host: 'localhost:8000' };
const HTTPS = { protocol: 'https:', host: 'gomoku.example' };

function make(role = 'host', location = HTTP) {
  const { FakeWebSocket, sockets } = fakeSocketClass();
  const transport = createWebSocketTransport('AB2C9', role, { WebSocketImpl: FakeWebSocket, location });
  return { transport, socket: sockets[0] };
}

test('the URL comes from the page location: ws for http, wss for https, path /ws, room and role', () => {
  assert.equal(config.RELAY_PATH, '/ws');
  assert.equal(make('host', HTTP).socket.url, 'ws://localhost:8000/ws?room=AB2C9&role=host');
  assert.equal(make('guest', HTTPS).socket.url, 'wss://gomoku.example/ws?room=AB2C9&role=guest');
  assert.equal(relayUrl('AB2C9', 'spectator', HTTPS), 'wss://gomoku.example/ws?room=AB2C9&role=spectator');
});

test('an unknown role is refused', () => {
  const { FakeWebSocket } = fakeSocketClass();
  assert.throws(() => createWebSocketTransport('AB2C9', 'admin', { WebSocketImpl: FakeWebSocket, location: HTTP }));
});

test('opened resolves when the socket opens', async () => {
  const { transport, socket } = make();
  socket.serverOpen();
  await transport.opened;
});

test('opened rejects when the server refuses the connection', async () => {
  const { transport, socket } = make('guest');
  socket.serverClose(1008);
  await assert.rejects(transport.opened);
});

test('opened rejects when the socket fails before opening', async () => {
  const { transport, socket } = make('guest');
  socket.serverError();
  await assert.rejects(transport.opened);
});

test('a later close does not change an opened promise that already resolved', async () => {
  const { transport, socket } = make();
  socket.serverOpen();
  socket.serverClose(1000);
  await transport.opened;
});

test('onClose fires once when an opened connection is lost, also for a late subscriber', () => {
  const { transport, socket } = make();
  let calls = 0;
  transport.onClose(() => { calls += 1; });
  socket.serverOpen();
  socket.serverError();
  socket.serverClose(1006);
  assert.equal(calls, 1);
  let late = 0;
  transport.onClose(() => { late += 1; });
  assert.equal(late, 1);
});

test('onClose does not fire for a refusal before opening or for close()', async () => {
  const refused = make();
  let calls = 0;
  refused.transport.onClose(() => { calls += 1; });
  refused.socket.serverClose(1008);
  await assert.rejects(refused.transport.opened);
  const own = make();
  own.transport.onClose(() => { calls += 1; });
  own.socket.serverOpen();
  own.transport.close();
  own.socket.serverClose(1000);
  assert.equal(calls, 0);
});

test('send writes JSON once the socket is open', () => {
  const { transport, socket } = make();
  socket.serverOpen();
  assert.equal(transport.send({ type: 'state', round: 2 }), true);
  assert.deepEqual(socket.sent, ['{"type":"state","round":2}']);
});

test('messages sent before the socket is open are dropped, not queued', () => {
  const { transport, socket } = make();
  assert.equal(transport.send({ type: 'hello' }), false);
  socket.serverOpen();
  assert.deepEqual(socket.sent, []);
  transport.send({ type: 'after' });
  assert.deepEqual(socket.sent, ['{"type":"after"}']);
});

test('a spectator sends only chat, watch and unwatch; anything else returns false and sends nothing', () => {
  const { transport, socket } = make('spectator');
  socket.serverOpen();
  assert.equal(transport.send({ type: 'move', cell: 3 }), false);
  assert.deepEqual(socket.sent, []);
  assert.equal(transport.send({ type: 'chat', text: 'hi' }), true);
  assert.equal(transport.send({ type: 'watch', name: 'Owl' }), true);
  assert.equal(transport.send({ type: 'unwatch' }), true);
  assert.equal(socket.sent.length, 3);
});

test('incoming JSON reaches every handler; unsubscribe removes one', () => {
  const { transport, socket } = make('guest');
  socket.serverOpen();
  const a = [];
  const b = [];
  const offA = transport.onMessage((m) => a.push(m));
  transport.onMessage((m) => b.push(m));
  socket.serverSend('{"type":"welcome"}');
  offA();
  socket.serverSend('{"type":"state"}');
  assert.deepEqual(a, [{ type: 'welcome' }]);
  assert.deepEqual(b, [{ type: 'welcome' }, { type: 'state' }]);
});

test('incoming text that is not JSON is ignored', () => {
  const { transport, socket } = make('spectator');
  socket.serverOpen();
  const got = [];
  transport.onMessage((m) => got.push(m));
  socket.serverSend('not json {');
  socket.serverSend('');
  socket.serverSend('{"type":"seats"}');
  assert.deepEqual(got, [{ type: 'seats' }]);
});

test('close closes the socket, stops sending and receiving, and is safe twice', async () => {
  const { transport, socket } = make();
  socket.serverOpen();
  const got = [];
  transport.onMessage((m) => got.push(m));
  transport.close();
  transport.close();
  assert.equal(socket.closeCalls, 1);
  assert.equal(transport.send({ type: 'x' }), false);
  socket.serverSend('{"type":"late"}');
  assert.deepEqual(got, []);
  await transport.opened;
});

test('close before the socket opens rejects opened', async () => {
  const { transport } = make();
  transport.close();
  await assert.rejects(transport.opened);
});

test('chooseTransport returns the configured value', () => {
  assert.equal(config.ONLINE_TRANSPORT, TRANSPORT_WEBSOCKET, 'the deployed game plays through the relay');
  assert.equal(chooseTransport(config), TRANSPORT_WEBSOCKET);
  assert.equal(chooseTransport({ ONLINE_TRANSPORT: 'websocket' }), TRANSPORT_WEBSOCKET);
  assert.equal(chooseTransport({ ONLINE_TRANSPORT: 'broadcast' }), TRANSPORT_BROADCAST);
  assert.equal(chooseTransport({ ONLINE_TRANSPORT: 'carrier-pigeon' }), TRANSPORT_BROADCAST);
});

test('only chooseTransport reads ONLINE_TRANSPORT', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const readers = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.js') && (await readFile(path, 'utf8')).includes('ONLINE_TRANSPORT')) readers.push(path);
    }
  }
  await walk('src');
  assert.deepEqual(readers.sort(), ['src/config.js', 'src/net/transport.js']);
});

test('?transport=websocket on localhost overrides broadcast', () => {
  const broadcast = { ONLINE_TRANSPORT: 'broadcast' };
  for (const hostname of ['localhost', '127.0.0.1', '::1', '[::1]']) {
    assert.equal(chooseTransport(broadcast, { search: '?transport=websocket', hostname }), TRANSPORT_WEBSOCKET);
  }
  assert.equal(chooseTransport({ ONLINE_TRANSPORT: 'websocket' }, { search: '?transport=broadcast', hostname: 'localhost' }), TRANSPORT_BROADCAST);
  assert.equal(chooseTransport(config, { search: '?local=0&transport=websocket', hostname: 'localhost' }), TRANSPORT_WEBSOCKET);
});

test('?transport= is ignored on a real domain', () => {
  for (const hostname of ['example.com', 'localhost.example.com', 'game.workers.dev', '']) {
    assert.equal(chooseTransport({ ONLINE_TRANSPORT: 'broadcast' }, { search: '?transport=websocket', hostname }), TRANSPORT_BROADCAST);
    assert.equal(chooseTransport({ ONLINE_TRANSPORT: 'websocket' }, { search: '?transport=broadcast', hostname }), TRANSPORT_WEBSOCKET);
  }
});

test('an unknown ?transport= value is ignored', () => {
  for (const search of ['?transport=carrier-pigeon', '?transport=', '?transport=WEBSOCKET']) {
    assert.equal(chooseTransport({ ONLINE_TRANSPORT: 'broadcast' }, { search, hostname: 'localhost' }), TRANSPORT_BROADCAST);
    assert.equal(chooseTransport({ ONLINE_TRANSPORT: 'websocket' }, { search, hostname: 'localhost' }), TRANSPORT_WEBSOCKET);
  }
});

test('no ?transport= parameter returns the config value', () => {
  assert.equal(chooseTransport({ ONLINE_TRANSPORT: 'broadcast' }, { search: '', hostname: 'localhost' }), TRANSPORT_BROADCAST);
  assert.equal(chooseTransport({ ONLINE_TRANSPORT: 'websocket' }, { search: '?local=1', hostname: '127.0.0.1' }), TRANSPORT_WEBSOCKET);
  assert.equal(chooseTransport({ ONLINE_TRANSPORT: 'websocket' }, {}), TRANSPORT_WEBSOCKET);
  assert.equal(chooseTransport({ ONLINE_TRANSPORT: 'websocket' }, null), TRANSPORT_WEBSOCKET);
});
