// Flow v1 step 1 support pieces: isTypingTarget and the global key
// shortcuts, strings.js, the new config values, the room phases, and the
// online app driven by flowReducer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as config from '../src/config.js';
import { CHARACTERS, EARTH_BEAR, WIND_RABBIT } from '../src/logic/characters.js';
import { STONE_CONVERSION, TERRAIN_CREATION, TORNADO_ZONE, WIND_DASH } from '../src/logic/skills.js';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { ROOM_PHASES } from '../src/net/phase.js';
import { onlineSameBrowserOnly } from '../src/net/transport.js';
import { GAME, GAME_OVER, LOBBY, MENU, WAITING_SCREEN, createApp } from '../src/ui/app.js';
import { isFullscreenKey } from '../src/ui/fullscreen.js';
import { isCollapseKey } from '../src/ui/hud-collapse.js';
import { attachGameInput, isQualityKey, isRestartKey, isTypingTarget, shortcutKeyHandler } from '../src/ui/input.js';
import { SKILL_INFO } from '../src/ui/skill-info.js';
import { STRINGS } from '../src/ui/strings.js';
import { pickAndReady } from './room-start.js';

// The app starts on the main menu; Play Online opens the lobby.
const onLobby = (app) => {
  app.playOnline();
  return app;
};

// --- isTypingTarget and the shortcuts ---

const TYPING = [
  { tagName: 'INPUT' },
  { tagName: 'input' },
  { tagName: 'TEXTAREA' },
  { tagName: 'SELECT' },
  { tagName: 'DIV', isContentEditable: true },
  { tagName: 'DIV', contentEditable: 'true' },
  { tagName: 'SPAN', contentEditable: 'plaintext-only' },
];
const NOT_TYPING = [
  null,
  undefined,
  {},
  { tagName: 'BUTTON' },
  { tagName: 'BODY' },
  { tagName: 'DIV', isContentEditable: false, contentEditable: 'inherit' },
  { tagName: 'DIV', contentEditable: 'false' },
];

test('isTypingTarget: true for input, textarea, select and contenteditable elements only', () => {
  for (const element of TYPING) assert.equal(isTypingTarget(element), true, JSON.stringify(element));
  for (const element of NOT_TYPING) assert.equal(isTypingTarget(element), false, JSON.stringify(element));
});

// Each global shortcut key, as its predicate sees it.
const SHORTCUTS = [
  ['C (HUD cards)', 'c', isCollapseKey],
  ['F (Fullscreen)', 'f', isFullscreenKey],
  ['Q (quality)', 'q', isQualityKey],
];

test('every shortcut key works on the page and is ignored in a typing target', () => {
  for (const [name, key, isKey] of SHORTCUTS) {
    assert.equal(isKey({ key, target: { tagName: 'BODY' } }), true, name);
    assert.equal(isKey({ key: key.toUpperCase(), target: { tagName: 'BUTTON' } }), true, name);
    for (const target of TYPING) assert.equal(isKey({ key, target }), false, `${name} in ${JSON.stringify(target)}`);
  }
});

test('shortcutKeyHandler returns early for a typing target and calls the handler otherwise', () => {
  const seen = [];
  const handler = shortcutKeyHandler((event) => seen.push(event.key));
  for (const target of TYPING) {
    for (const key of ['c', 'f', 'q', 'h', 'v', 'z']) handler({ key, target });
  }
  assert.deepEqual(seen, []);
  handler({ key: 'c', target: { tagName: 'BODY' } });
  handler({ key: 'f', target: null });
  assert.deepEqual(seen, ['c', 'f']);
});

test('the R restart key of the game input is ignored in a typing target', () => {
  const listeners = new Map();
  const savedWindow = globalThis.window;
  globalThis.window = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  try {
    const canvas = { addEventListener() {}, removeEventListener() {} };
    let restarts = 0;
    let cancels = 0;
    const detach = attachGameInput(canvas, {
      onHover() {}, onClick() {}, onCancel: () => cancels++, onRestart: () => restarts++,
    });
    const keydown = listeners.get('keydown');
    const event = (key, target) => ({ key, target, preventDefault() {} });
    for (const target of TYPING) keydown(event('r', target));
    assert.equal(restarts, 0);
    keydown(event('r', { tagName: 'BODY' }));
    assert.equal(restarts, 1);
    assert.equal(isRestartKey({ key: 'R' }), true);
    keydown(event('Escape', { tagName: 'BODY' }));
    assert.equal(cancels, 1);
    detach();
    assert.equal(listeners.has('keydown'), false);
  } finally {
    globalThis.window = savedWindow;
  }
});

// --- strings.js ---

test('strings.js: one flat object of English strings for the menu, How to Play, Settings and Game over', () => {
  assert.ok(Object.isFrozen(STRINGS));
  for (const [key, value] of Object.entries(STRINGS)) {
    assert.equal(typeof value, 'string', key);
    assert.ok(value.length > 0, key);
    assert.match(value, /^[\x20-\x7e]+$/, `${key} is plain English text`);
  }
  assert.equal(STRINGS.menuPlayOnline, 'Play Online');
  assert.equal(STRINGS.menuPlayLocal, 'Play on this computer');
  assert.equal(STRINGS.menuHowTo, 'How to Play');
  assert.equal(STRINGS.menuSettings, 'Settings');
  assert.equal(STRINGS.gameOverRematch, 'Rematch');
  assert.equal(STRINGS.gameOverBackToMenu, 'Back to Menu');
  assert.equal(STRINGS.rematchTheirsHint, 'Opponent wants a rematch');
});

test('strings.js: numbers and names in the rules come from the config, the characters and SKILL_INFO', () => {
  assert.ok(STRINGS.howToRule1.includes(CHARACTERS[WIND_RABBIT].name));
  assert.ok(STRINGS.howToRule1.includes(CHARACTERS[EARTH_BEAR].name));
  assert.ok(STRINGS.howToRule3.startsWith(`${config.WIN_LENGTH} or more`));
  assert.ok(STRINGS.howToRule4.includes(`next ${config.COOLDOWN_SHORT} turns`));
  assert.ok(STRINGS.howToRule4.includes(`next ${config.COOLDOWN_LONG} turns`));
  for (const id of [WIND_DASH, TORNADO_ZONE, TERRAIN_CREATION, STONE_CONVERSION]) {
    assert.ok(STRINGS.howToRule4.includes(SKILL_INFO[id].title), id);
  }
  assert.ok(STRINGS.howToRule5.includes(`after ${config.ROCK_LIFETIME_TURNS} turns`));
});

// --- config and room phases ---

test('config: the flow timings and the same browser rule; no automatic start delay any more', () => {
  assert.equal('WAITING_START_DELAY_MS' in config, false, 'the game starts when both players are Ready');
  assert.equal(config.COPY_FEEDBACK_MS, 1500);
  assert.equal(config.JOIN_TIMEOUT_MS, 3000);
  // The same-browser rule is onlineSameBrowserOnly(config) (net/transport.js), no flag of its own.
  assert.equal('ONLINE_SAME_BROWSER_ONLY' in config, false);
  assert.equal(onlineSameBrowserOnly(config), config.ONLINE_TRANSPORT === 'broadcast');
});

test('ROOM_PHASES: a frozen object with waiting, starting, playing and over', () => {
  assert.ok(Object.isFrozen(ROOM_PHASES));
  assert.deepEqual(Object.values(ROOM_PHASES), ['waiting', 'starting', 'playing', 'over']);
});

// --- the app on the reducer ---

test('the online app starts on the menu, Play Online opens the lobby, and it follows the flow reducer into the game', () => {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const make = () => onLobby(createApp({ openTransport: () => network.connect(), clock, makeCode: () => 'AB2C9' }));
  const fresh = createApp({ openTransport: () => network.connect(), clock });
  assert.equal(fresh.getFlow().screen, 'menu', 'the menu is the first screen');
  assert.equal(fresh.getScreen(), MENU);
  const host = make();
  const guest = make();
  assert.equal(host.getScreen(), LOBBY);
  assert.equal(host.getFlow().screen, 'lobby');
  assert.equal(host.getFlow().mode, 'online');
  host.createRoom();
  assert.equal(host.getScreen(), WAITING_SCREEN, 'Create Room opens the room at once');
  assert.deepEqual({ ...host.getFlow() }, { screen: 'waiting', overlay: 'none', mode: 'online', role: 'host', notice: null, seats: null });
  guest.openJoin();
  guest.joinRoom('AB2C9');
  assert.equal(host.getFlow().screen, 'starting');
  assert.equal(guest.getFlow().screen, 'starting');
  clock.advance(60000);
  assert.equal(host.getFlow().screen, 'starting', 'no automatic start');
  pickAndReady(host, guest); // both Ready: the host starts the game
  assert.equal(host.getScreen(), GAME);
  assert.equal(guest.getScreen(), GAME);
  assert.equal(host.getFlow().role, 'host');
  assert.equal(guest.getFlow().role, 'guest');
  assert.equal(guest.getFlow().screen, 'game');
  host.close();
  guest.close();
});

test('the online app waits for the host start; a guest who leaves in starting sends the host back to Waiting with the seat empty', () => {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const make = () => onLobby(createApp({ openTransport: () => network.connect(), clock, makeCode: () => 'AB2C9' }));
  const host = make();
  const guest = make();
  host.createRoom();
  guest.openJoin();
  guest.joinRoom('AB2C9');
  host.pick(WIND_RABBIT);
  host.ready();
  guest.pick(EARTH_BEAR);
  clock.advance(700);
  assert.equal(host.getScreen(), WAITING_SCREEN, 'the host keeps the room screen during starting');
  assert.equal(guest.getScreen(), WAITING_SCREEN, 'the guest sees the same room during starting');
  assert.deepEqual(guest.getView().waiting.cards.map((card) => card.character), [WIND_RABBIT, EARTH_BEAR]);
  assert.equal(guest.leaveRoom(), true, 'Leave works while starting');
  assert.equal(guest.getScreen(), MENU);
  assert.equal(host.getFlow().screen, 'waiting');
  assert.equal(host.getScreen(), WAITING_SCREEN);
  assert.deepEqual(host.getView().waiting.cards.map((card) => card.character), [WIND_RABBIT, null], 'the seat is empty again');
  assert.equal(host.getView().waiting.cards[1].placeholder, true);
  const second = make();
  second.openJoin();
  second.joinRoom('AB2C9');
  assert.equal(host.getFlow().screen, 'starting');
  assert.equal(second.pick(EARTH_BEAR), true);
  assert.equal(second.ready(), true);
  assert.equal(host.getScreen(), GAME);
  assert.equal(second.getScreen(), GAME);
  host.close();
  second.close();
});

test('the online app: a host who leaves in starting sends the guest to the lobby with a notice', () => {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const make = () => onLobby(createApp({ openTransport: () => network.connect(), clock, makeCode: () => 'AB2C9' }));
  const host = make();
  const guest = make();
  host.createRoom();
  guest.openJoin();
  guest.joinRoom('AB2C9');
  guest.pick(WIND_RABBIT);
  guest.ready();
  clock.advance(500);
  host.close();
  assert.equal(guest.getFlow().screen, 'lobby');
  assert.notEqual(guest.getFlow().notice, null);
  clock.advance(60000);
  assert.notEqual(guest.getScreen(), GAME);
  guest.close();
});

test('the online app: a guest whose start is recovered after a forfeit reaches Game over', () => {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const hostTransport = network.connect();
  const guestTransport = network.connect();
  const host = onLobby(createApp({ openTransport: () => hostTransport, clock, makeCode: () => 'AB2C9' }));
  const guest = onLobby(createApp({ openTransport: () => guestTransport, clock }));
  host.createRoom();
  guest.openJoin();
  guest.joinRoom('AB2C9');
  host.pick(WIND_RABBIT);
  guest.pick(EARTH_BEAR);
  host.ready();
  hostTransport.setMuted(true); // the start is lost
  guest.ready();
  guestTransport.setMuted(true);
  hostTransport.setMuted(false);
  clock.advance(config.PEER_TIMEOUT_MS + config.LEAVE_COUNTDOWN_S * 1000);
  assert.equal(host.getScreen(), GAME_OVER);
  assert.equal(guest.getFlow().screen, 'starting');
  guestTransport.setMuted(false);
  clock.advance(config.HEARTBEAT_INTERVAL_MS);
  assert.equal(guest.getScreen(), GAME_OVER, 'the guest does not stay on the game screen');
  assert.equal(guest.getView().outcome.youWin, false);
  host.close();
  guest.close();
});
