// Online games over the relay (ONLINE_TRANSPORT websocket): the app builds
// its rooms with chooseTransport(config), the host enters its room once the
// connection is open, the guest joins and gets welcome, a refused guest
// reports No room found at once, a host that cannot connect sees the
// connection error, and the same-browser hint follows the transport.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as config from '../src/config.js';
import { EARTH_BEAR, WIND_RABBIT } from '../src/logic/characters.js';
import { createFakeClock } from '../src/net/clock.js';
import { onlineSameBrowserOnly } from '../src/net/transport.js';
import { JOIN, LOBBY, WAITING_SCREEN, createApp } from '../src/ui/app.js';
import { SCREENS } from '../src/ui/flow.js';
import { lobbyViewModel, waitingViewModel } from '../src/ui/room-screens.js';
import { STRINGS, withCode } from '../src/ui/strings.js';

const WEBSOCKET = { ...config, ONLINE_TRANSPORT: 'websocket' };
const BROADCAST = { ...config, ONLINE_TRANSPORT: 'broadcast' };
const LOCATION = { protocol: 'http:', host: 'localhost:8787' };

// A fake relay behind a fake WebSocketImpl, like worker/room.js: one host
// and one guest per room code; a guest without a host, or a second host,
// is refused (the socket closes without opening). Host frames go to the
// guest, guest frames to the host. Everything happens a microtask later,
// like a real socket.
function fakeRelay() {
  const rooms = new Map(); // code -> { host, guest }
  const sockets = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.received = [];
      const query = new URL(url).searchParams;
      this.code = query.get('room');
      this.role = query.get('role');
      sockets.push(this);
      queueMicrotask(() => this.connect());
    }
    connect() {
      if (this.readyState !== 0) return;
      const room = rooms.get(this.code) ?? {};
      const refused = this.role === 'host' ? Boolean(room.host) : !room.host || Boolean(room.guest);
      if (refused) {
        this.readyState = 3;
        this.onclose?.({ code: 1006 });
        return;
      }
      room[this.role] = this;
      rooms.set(this.code, room);
      this.readyState = 1;
      this.onopen?.({});
    }
    send(text) {
      if (this.readyState !== 1) throw new Error('send before open');
      const room = rooms.get(this.code);
      const to = this.role === 'host' ? room.guest : room.host;
      if (!to) return;
      queueMicrotask(() => {
        if (to.readyState !== 1) return;
        to.received.push(JSON.parse(text));
        to.onmessage?.({ data: text });
      });
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      const room = rooms.get(this.code);
      if (room?.[this.role] === this) delete room[this.role];
    }
    // The server or the network drops this open socket.
    drop() {
      this.close();
      this.onclose?.({ code: 1006 });
    }
  }
  return { FakeWebSocket, rooms, sockets };
}

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function makeApp(relay, clock, code = 'AB2C9') {
  const app = createApp({
    config: WEBSOCKET,
    transportOptions: { WebSocketImpl: relay.FakeWebSocket, location: LOCATION },
    clock,
    makeCode: () => code,
  });
  app.playOnline();
  return app;
}

test('onlineSameBrowserOnly: true only for the broadcast transport', () => {
  assert.equal(onlineSameBrowserOnly(BROADCAST), true);
  assert.equal(onlineSameBrowserOnly(WEBSOCKET), false);
  assert.equal(onlineSameBrowserOnly({ ONLINE_TRANSPORT: 'carrier-pigeon' }), true, 'unknown falls back to broadcast');
});

test('websocket: the host opens its relay connection, then creates the room', async () => {
  const relay = fakeRelay();
  const host = makeApp(relay, createFakeClock());
  assert.equal(host.createRoom(), true);
  assert.equal(relay.sockets[0].url, 'ws://localhost:8787/ws?room=AB2C9&role=host');
  // Still opening: the lobby reads Connecting and Create waits.
  assert.equal(host.getScreen(), LOBBY);
  assert.equal(host.getView().lobby.create.label, STRINGS.lobbyConnecting);
  assert.equal(host.getView().lobby.create.disabled, true);
  assert.equal(host.createRoom(), false);
  await settle();
  assert.equal(host.getScreen(), WAITING_SCREEN);
  assert.equal(host.getView().code, 'AB2C9');
  assert.equal(relay.rooms.get('AB2C9').host, relay.sockets[0]);
  host.close();
});

test('websocket: the guest waits for its connection, joins and gets welcome', async () => {
  const relay = fakeRelay();
  const clock = createFakeClock();
  const host = makeApp(relay, clock);
  host.createRoom();
  await settle();
  const guest = makeApp(relay, clock);
  guest.openJoin();
  assert.equal(guest.joinRoom('ab2c9'), true);
  assert.equal(guest.getView().joining, true);
  await settle();
  const guestSocket = relay.sockets[1];
  assert.equal(guestSocket.url, 'ws://localhost:8787/ws?room=AB2C9&role=guest');
  assert.ok(guestSocket.received.some((message) => message.type === 'welcome'), 'the guest got welcome');
  assert.equal(guest.getFlow().screen, SCREENS.STARTING);
  assert.equal(host.getFlow().screen, SCREENS.STARTING);
  assert.equal(guest.getView().code, 'AB2C9');
  guest.close();
  host.close();
});

test('websocket: a guest the relay refuses gets No room found at once, with no join timeout', async () => {
  const relay = fakeRelay();
  const clock = createFakeClock();
  const guest = makeApp(relay, clock);
  guest.openJoin();
  guest.joinRoom('ZZ2C9');
  await settle(); // the clock never moves: no JOIN_TIMEOUT_MS wait
  const view = guest.getView();
  assert.equal(view.screen, JOIN);
  assert.equal(view.joining, false);
  assert.equal(view.joinError, withCode(STRINGS.joinErrorNotFound, 'ZZ2C9'));
  assert.equal(relay.sockets[0].readyState, 3);
  // The player can try again.
  assert.equal(guest.joinRoom('ZZ2C9'), true);
});

test('websocket: a host that cannot open stays on the lobby with the connection error', async () => {
  const relay = fakeRelay();
  const clock = createFakeClock();
  const first = makeApp(relay, clock);
  first.createRoom();
  await settle();
  const second = makeApp(relay, clock); // the same code is taken: refused
  second.createRoom();
  await settle();
  assert.equal(second.getScreen(), LOBBY);
  assert.equal(second.getView().lobby.error, STRINGS.connectionError);
  assert.equal(second.getView().lobby.create.label, STRINGS.lobbyCreate);
  assert.equal(second.getView().lobby.create.disabled, false);
  assert.ok(STRINGS.connectionError.length > 0);
  // Join Room clears the error.
  second.openJoin();
  assert.equal(second.getView().lobby.error, null);
  first.close();
});

test('websocket: Back while the host connects drops the connection and never opens the room', async () => {
  const relay = fakeRelay();
  const host = makeApp(relay, createFakeClock());
  host.createRoom();
  host.back();
  await settle();
  assert.equal(host.getFlow().screen, SCREENS.MENU);
  assert.equal(relay.rooms.get('AB2C9')?.host, undefined);
});

test('websocket: a host whose open connection is lost leaves its dead room for the lobby with the connection error', async () => {
  const relay = fakeRelay();
  const host = makeApp(relay, createFakeClock());
  host.createRoom();
  await settle();
  assert.equal(host.getScreen(), WAITING_SCREEN);
  relay.sockets[0].drop();
  assert.equal(host.getScreen(), LOBBY);
  assert.equal(host.getFlow().screen, SCREENS.LOBBY);
  assert.equal(host.getView().code, null);
  assert.equal(host.getView().lobby.error, STRINGS.connectionError);
  // A new room can be created.
  assert.equal(host.createRoom(), true);
  await settle();
  assert.equal(host.getScreen(), WAITING_SCREEN);
  host.close();
});

test('websocket: a guest whose connection is lost while it joins sees the connection error on Join Room', async () => {
  const relay = fakeRelay();
  const clock = createFakeClock();
  const host = makeApp(relay, clock);
  host.createRoom();
  await settle();
  relay.sockets[0].onmessage = null; // the host never answers: the join stays pending
  const guest = makeApp(relay, clock);
  guest.openJoin();
  guest.joinRoom('AB2C9');
  await settle();
  assert.equal(guest.getView().joining, true);
  relay.sockets[1].drop();
  const view = guest.getView();
  assert.equal(view.screen, JOIN);
  assert.equal(view.joining, false);
  assert.equal(view.joinError, STRINGS.connectionError);
  clock.advance(config.JOIN_TIMEOUT_MS * 2); // the closed room has no join timeout left
  assert.equal(guest.getView().joinError, STRINGS.connectionError);
  host.close();
});

test('websocket: a seated guest whose connection is lost leaves the waiting room for the lobby with the connection error', async () => {
  const relay = fakeRelay();
  const clock = createFakeClock();
  const host = makeApp(relay, clock);
  host.createRoom();
  await settle();
  const guest = makeApp(relay, clock);
  guest.openJoin();
  guest.joinRoom('AB2C9');
  await settle();
  assert.equal(guest.getFlow().screen, SCREENS.STARTING);
  relay.sockets[1].drop();
  assert.equal(guest.getScreen(), LOBBY);
  assert.equal(guest.getFlow().screen, SCREENS.LOBBY);
  assert.equal(guest.getView().code, null);
  assert.equal(guest.getView().joining, false);
  assert.equal(guest.getView().joinError, null);
  assert.equal(guest.getView().lobby.error, STRINGS.connectionError);
  host.close();
});

// Host and guest in a game over the fake relay: both pick and are Ready.
async function playingPair(relay, clock) {
  const host = makeApp(relay, clock);
  host.createRoom();
  await settle();
  const guest = makeApp(relay, clock);
  guest.openJoin();
  guest.joinRoom('AB2C9');
  await settle();
  host.pick(WIND_RABBIT);
  await settle();
  guest.pick(EARTH_BEAR);
  await settle();
  host.ready();
  await settle();
  guest.ready();
  await settle();
  assert.equal(host.getFlow().screen, SCREENS.GAME);
  assert.equal(guest.getFlow().screen, SCREENS.GAME);
  return { host, guest };
}

for (const [side, index] of [['host', 0], ['guest', 1]]) {
  test(`websocket: a ${side} whose connection is lost during a game goes to the lobby with the connection error, never "you win"`, async () => {
    const relay = fakeRelay();
    const clock = createFakeClock();
    const pair = await playingPair(relay, clock);
    const app = pair[side];
    relay.sockets[index].drop();
    assert.equal(app.getScreen(), LOBBY);
    assert.equal(app.getFlow().screen, SCREENS.LOBBY);
    assert.equal(app.getGame(), null);
    assert.equal(app.getView().lobby.error, STRINGS.connectionError);
    // No presence countdown is left to end a game for this window.
    clock.advance(config.PEER_TIMEOUT_MS + config.LEAVE_COUNTDOWN_S * 1000);
    await settle();
    assert.equal(app.getScreen(), LOBBY);
    assert.equal(app.getView().outcome, null);
    pair.host.close();
    pair.guest.close();
  });
}

test('broadcast: the room opens at once over the BroadcastChannel (the same-browser mode)', () => {
  const channels = [];
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      channels.push(this);
    }
    postMessage() {}
    close() {}
  }
  const app = createApp({ config: BROADCAST, transportOptions: { BroadcastChannelImpl: FakeBroadcastChannel }, clock: createFakeClock(), makeCode: () => 'AB2C9' });
  app.playOnline();
  assert.equal(app.createRoom(), true);
  assert.equal(app.getScreen(), WAITING_SCREEN);
  assert.equal(channels[0].name, 'gomoku-tales-AB2C9');
  assert.equal(app.getView().lobby.hint, STRINGS.lobbySameBrowserHint);
  app.close();
});

test('the hint lines depend on the transport', () => {
  assert.equal(lobbyViewModel({ config: BROADCAST }).hint, STRINGS.lobbySameBrowserHint);
  assert.equal(lobbyViewModel({ config: WEBSOCKET }).hint, null);
  const relay = fakeRelay();
  assert.equal(makeApp(relay, createFakeClock()).getView().lobby.hint, null);
  const flow = { screen: SCREENS.WAITING, role: 'host' };
  const room = { code: 'AB2C9', seats: null, seat: null };
  assert.equal(waitingViewModel(flow, room, { config: BROADCAST }).hint, STRINGS.waitingHint);
  assert.equal(waitingViewModel(flow, room, { config: WEBSOCKET }).hint, STRINGS.waitingHintRelay);
});
