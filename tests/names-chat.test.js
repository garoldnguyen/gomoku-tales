// Player names and the room chat (docs/flow-design.md section 3.12): the
// cleaning rules, the random names, the names both seats and the
// spectators learn, chat between everyone in a room, the relay's routing,
// and the app's chat (cleared on a rematch and on leaving).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_HISTORY, CHAT_MAX_LENGTH, CHAT_MIN_INTERVAL_MS, NAME_MAX_LENGTH } from '../src/config.js';
import { WIND_RABBIT } from '../src/logic/characters.js';
import { createFakeClock } from '../src/net/clock.js';
import { CHAT, chatOf, cleanChatText, cleanName, namesOf } from '../src/net/chat.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { createGuestRoom, createHostRoom } from '../src/net/room.js';
import { createSpectatorRoom } from '../src/net/spectator-room.js';
import { ROLE_GUEST, ROLE_HOST, ROLE_SPECTATOR } from '../src/net/ws-transport.js';
import { GAME, GAME_OVER, MENU, WAITING_SCREEN, createApp } from '../src/ui/app.js';
import { senderLabel, unreadCount } from '../src/ui/chat-dom.js';
import {
  NAME_ADJECTIVES, NAME_ANIMALS, NAME_STORAGE_KEY, chooseName, createPlayersByStone, loadName, randomName,
} from '../src/ui/player-names.js';
import { STRINGS } from '../src/ui/strings.js';
import { maySend, routeFor } from '../worker/pairing.js';
import { pickAndReady } from './room-start.js';

test('names and chat texts are cleaned: control characters, extra spaces and length', () => {
  assert.equal(cleanName('  Garold \n  Nguyen\u0007 '), 'Garold Nguyen');
  assert.equal(cleanName('   '), null);
  assert.equal(cleanName(42), null);
  assert.equal(cleanName('x'.repeat(50)).length, NAME_MAX_LENGTH);
  assert.equal(cleanChatText(' gg  wp '), 'gg wp');
  assert.equal(cleanChatText(''), null);
  assert.equal(cleanChatText('a'.repeat(500)).length, CHAT_MAX_LENGTH);
  assert.deepEqual(namesOf({ names: { host: ' Ann ', guest: '' } }), { host: 'Ann', guest: null });
  assert.equal(namesOf({}), null);
  assert.deepEqual(chatOf({ type: CHAT, from: 'p1', name: 'Ann', text: ' hi ' }), { from: 'p1', name: 'Ann', text: 'hi' });
  assert.equal(chatOf({ type: CHAT, from: 'p1', text: '   ' }), null);
});

test('a random name is an adjective and an animal from two lists of 100 different words', () => {
  assert.equal(new Set(NAME_ADJECTIVES).size, 100);
  assert.equal(new Set(NAME_ANIMALS).size, 100);
  assert.equal(randomName(() => 0), `${NAME_ADJECTIVES[0]} ${NAME_ANIMALS[0]}`);
  assert.equal(randomName(() => 0.9999), `${NAME_ADJECTIVES[99]} ${NAME_ANIMALS[99]}`);
  for (let i = 0; i < 50; i++) assert.ok(cleanName(randomName()).length <= NAME_MAX_LENGTH, 'every name fits');
  for (const a of NAME_ADJECTIVES) for (const b of NAME_ANIMALS) assert.ok(`${a} ${b}`.length <= NAME_MAX_LENGTH, `${a} ${b}`);
});

test('the typed name is kept in this browser; an empty box takes the suggested random name', () => {
  const data = {};
  const storage = { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
  assert.equal(loadName(storage), null);
  assert.equal(chooseName('  Ann ', storage, 'Sweet Ant'), 'Ann');
  assert.equal(data[NAME_STORAGE_KEY], 'Ann');
  assert.equal(chooseName('', storage, 'Sweet Ant'), 'Sweet Ant');
  assert.equal(loadName(storage), 'Sweet Ant');
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(loadName(blocked), null);
  assert.equal(chooseName('Bo', blocked), 'Bo');
});

function makeRoom() {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const host = createHostRoom({ transport: network.connect(), code: 'AB2C9', clock, random: () => 0, name: 'Ann' });
  const guest = createGuestRoom({ transport: network.connect(), code: 'AB2C9', clock, name: 'Bo' });
  return { network, clock, host, guest };
}

test('both seats learn both names: the guest sends its own with join, the host sends both', () => {
  const { host, guest, network, clock } = makeRoom();
  assert.deepEqual(host.getView().names, { host: 'Ann', guest: 'Bo' });
  assert.deepEqual(guest.getView().names, { host: 'Ann', guest: 'Bo' });
  const watcher = createSpectatorRoom({ transport: network.connect(), code: 'AB2C9', clock, name: 'Cy' });
  pickAndReady(host, guest, WIND_RABBIT);
  assert.deepEqual(watcher.getView().names, { host: 'Ann', guest: 'Bo' }, 'spectators read them from the host');
  const players = createPlayersByStone((seats, seat) => (seats.order.indexOf(seat) === 0 ? 'X' : 'O'));
  const view = host.getView();
  const first = players(view);
  assert.equal(players(view), first, 'the same object while nothing changes');
  assert.deepEqual(Object.values(first).sort(), ['Ann', 'Bo']);
});

test('chat reaches everyone in the room, spectators too, at most once per CHAT_MIN_INTERVAL_MS each', () => {
  const { host, guest, network, clock } = makeRoom();
  const watcher = createSpectatorRoom({ transport: network.connect(), code: 'AB2C9', clock, name: 'Cy' });
  const heard = { host: [], guest: [], watcher: [] };
  for (const [key, room] of Object.entries({ host, guest, watcher })) {
    room.onEvent((event) => {
      if (event.type === 'chat') heard[key].push(`${event.mine ? 'me' : event.name}:${event.text}`);
    });
  }
  assert.equal(guest.sendChat(' hello '), true);
  assert.equal(guest.sendChat('again'), false, 'too soon');
  assert.equal(guest.sendChat('   '), false, 'empty');
  clock.advance(CHAT_MIN_INTERVAL_MS);
  assert.equal(watcher.sendChat('nice game'), true);
  assert.equal(host.sendChat('thanks'), true);
  assert.deepEqual(heard.guest, ['me:hello', 'Cy:nice game', 'Ann:thanks']);
  assert.deepEqual(heard.host, ['Bo:hello', 'Cy:nice game', 'me:thanks']);
  assert.deepEqual(heard.watcher, ['Bo:hello', 'me:nice game', 'Ann:thanks']);
});

test('the relay passes chat from anyone to everyone; a spectator may send chat and nothing else', () => {
  for (const role of [ROLE_HOST, ROLE_GUEST, ROLE_SPECTATOR]) {
    assert.deepEqual([...routeFor(role, { type: CHAT })].sort(), [ROLE_GUEST, ROLE_HOST, ROLE_SPECTATOR].sort());
    assert.equal(maySend(role, { type: CHAT }), true);
  }
  assert.equal(maySend(ROLE_SPECTATOR, { type: 'state' }), false);
  assert.equal(maySend(ROLE_GUEST, { type: 'action' }), true);
});

test('the chat panel helpers: You for your own lines, unread counts only others', () => {
  assert.equal(senderLabel({ mine: true, name: 'Ann' }), STRINGS.chatYou);
  assert.equal(senderLabel({ mine: false, name: null }), STRINGS.chatSomeone);
  const messages = [{ id: 1, mine: false }, { id: 2, mine: true }, { id: 3, mine: false }];
  assert.equal(unreadCount(messages, 0), 2);
  assert.equal(unreadCount(messages, 2), 1);
});

function makeApps() {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const window = (name) => {
    const app = createApp({ openTransport: () => network.connect(), clock, random: () => 0, makeCode: () => 'AB2C9', playerName: name });
    app.playOnline();
    return app;
  };
  return { clock, window };
}

test('in the app: names label the seats, chat shows in the room and clears on a rematch and on leaving', () => {
  const { clock, window } = makeApps();
  const host = window('Ann');
  const guest = window(null);
  guest.setPlayerName('  Bo ');
  host.createRoom();
  assert.equal(host.getScreen(), WAITING_SCREEN);
  assert.deepEqual(host.getView().chat, { messages: [], name: 'Ann' });
  guest.openJoin();
  guest.joinRoom('AB2C9');
  assert.deepEqual(host.getView().waiting.cards.map((card) => card.label), [`Ann (you)`, 'Bo']);
  assert.equal(guest.sendChat('hi'), true);
  assert.deepEqual(host.getView().chat.messages.map((m) => [m.name, m.text, m.mine]), [['Bo', 'hi', false]]);

  pickAndReady(host, guest, WIND_RABBIT);
  assert.equal(host.getScreen(), GAME);
  assert.equal(host.getView().chat.messages.length, 1, 'the first start keeps the waiting room chat');
  assert.ok(CHAT_HISTORY >= 50);

  // Leaving the room: no chat any more.
  guest.leaveRoom?.();
  host.close();
  assert.equal(host.getView().chat, null);
  clock.advance(CHAT_MIN_INTERVAL_MS);
  assert.equal(host.sendChat('anyone?'), false);
  assert.equal(host.getScreen() === MENU || host.getScreen() === GAME || host.getScreen() === GAME_OVER, true);
});
