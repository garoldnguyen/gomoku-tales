// The lobby and the waiting room (docs/flow-design.md sections 3.4 and
// 3.5, Flow v1 step 5): the room code box, the pure view models, the copy
// helper, Leave, the shot scenes, the typing guard and the style rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COPY_FEEDBACK_MS, JOIN_TIMEOUT_MS, ONLINE_SAME_BROWSER_ONLY, ROOM_CODE_LENGTH, WAITING_START_DELAY_MS } from '../src/config.js';
import { O, X } from '../src/logic/board.js';
import { CHARACTERS, EARTH_BEAR, WIND_RABBIT } from '../src/logic/characters.js';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { ROOM_CODE_ALPHABET, isValidRoomCode, normalizeRoomCode } from '../src/net/room-code.js';
import { CLOSED, NO_ROOM, createGuestRoom } from '../src/net/room.js';
import { JOIN, LOBBY, MENU, WAITING_SCREEN, createApp } from '../src/ui/app.js';
import { FLOW_EVENTS, ROLES, SCREENS, flowReducer, initialFlow } from '../src/ui/flow.js';
import { PORTRAIT_ART } from '../src/ui/hud-view.js';
import { isTypingTarget, shortcutKeyHandler } from '../src/ui/input.js';
import {
  WAITING_CARD_ORDER, copyFeedbackText, copyRoomCode, joinViewModel, lobbyViewModel, waitingViewModel,
} from '../src/ui/room-screens.js';
import { SHOT_ROOM, SHOT_SCENES, shotFlow, shotRoomView } from '../src/ui/shot-mode.js';
import { STRINGS } from '../src/ui/strings.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// --- the room code box ---

test('normalizeRoomCode uppercases, keeps only code characters and cuts to ROOM_CODE_LENGTH', () => {
  assert.equal(normalizeRoomCode('ab c-d5xyz'), 'ABCD5');
  assert.equal(normalizeRoomCode('  ab2c9  '), 'AB2C9');
  assert.equal(normalizeRoomCode('A-B-2-C-9'), 'AB2C9');
  assert.equal(normalizeRoomCode('0O1Iab'), 'AB', 'the confusing 0, O, 1 and I vanish');
  assert.equal(normalizeRoomCode('zzzzzzzz'), 'ZZZZZ');
  assert.equal(normalizeRoomCode('é!?@ #'), '');
  assert.equal(normalizeRoomCode(''), '');
  assert.equal(normalizeRoomCode(null), '');
  assert.equal(normalizeRoomCode(12345), '2345');
  for (const raw of ['ab c-d5xyz', 'qwertyuiop', '2 3 4 5 6 7 8 9']) {
    const code = normalizeRoomCode(raw);
    assert.ok(code.length <= ROOM_CODE_LENGTH, raw);
    assert.ok([...code].every((char) => ROOM_CODE_ALPHABET.includes(char)), raw);
  }
  assert.equal(isValidRoomCode(normalizeRoomCode('ab c-d5xyz')), true);
});

test('joinViewModel: Join stays disabled until the box holds ROOM_CODE_LENGTH characters, and reads Joining while pending', () => {
  for (let n = 0; n < ROOM_CODE_LENGTH; n++) {
    const vm = joinViewModel({ text: 'ABCDE'.slice(0, n) });
    assert.equal(vm.joinDisabled, true, `${n} characters`);
  }
  const ready = joinViewModel({ text: 'ab c-d5xyz' });
  assert.equal(ready.value, 'ABCD5');
  assert.equal(ready.joinDisabled, false);
  assert.equal(ready.joinLabel, STRINGS.lobbyJoinButton);
  assert.equal(ready.inputDisabled, false);
  assert.equal(ready.error, null);
  const pending = joinViewModel({ text: 'ABCD5', joining: true });
  assert.equal(pending.joinLabel, STRINGS.lobbyJoining);
  assert.equal(pending.joinLabel, 'Joining');
  assert.equal(pending.joinDisabled, true);
  assert.equal(pending.inputDisabled, true);
  assert.equal(joinViewModel({ text: 'ABCD5', error: 'x' }).error, 'x');
});

test('lobbyViewModel: Create, Join and Back, and the same-browser hint while ONLINE_SAME_BROWSER_ONLY is true', () => {
  const vm = lobbyViewModel();
  assert.equal(vm.back.label, 'Back');
  assert.deepEqual([vm.create.box, vm.join.box, vm.back.box], ['lobby-create', 'lobby-join', 'lobby-back']);
  assert.equal(vm.hint, ONLINE_SAME_BROWSER_ONLY ? STRINGS.lobbySameBrowserHint : null);
  assert.equal(lobbyViewModel({ sameBrowserOnly: true }).hint, STRINGS.lobbySameBrowserHint);
  assert.equal(lobbyViewModel({ sameBrowserOnly: false }).hint, null);
});

// --- the app: Back, join errors, Leave ---

function makeWorld() {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const window = () => {
    const transports = [];
    const app = createApp({
      openTransport: () => {
        const transport = network.connect();
        transports.push(transport);
        return transport;
      },
      clock,
      makeCode: () => 'ABCD5',
    });
    app.playOnline();
    return { app, transports };
  };
  return { network, clock, window };
}

test('the lobby Back button (event BACK) returns to the menu; Back on Join Room goes to the lobby first', () => {
  const { window } = makeWorld();
  const { app } = window();
  app.openJoin();
  assert.equal(app.getScreen(), JOIN);
  app.back();
  assert.equal(app.getScreen(), LOBBY);
  app.back();
  assert.equal(app.getScreen(), MENU);
  assert.deepEqual({ ...app.getFlow() }, { screen: 'menu', overlay: 'none', mode: null, role: null, notice: null });
});

test('join errors come from strings.js and clear when the player types', () => {
  const { window, clock } = makeWorld();
  const { app } = window();
  app.openJoin();
  assert.equal(app.joinRoom('ZZZZZ'), true);
  assert.equal(app.getView().joining, true);
  clock.advance(JOIN_TIMEOUT_MS - 1);
  assert.equal(app.getView().joining, true);
  clock.advance(1);
  assert.equal(app.getView().joining, false, 'Joining lasts at most JOIN_TIMEOUT_MS');
  assert.equal(app.getView().joinError, STRINGS.joinErrorNotFound.replace('{code}', 'ZZZZZ'));
  app.clearJoinError();
  assert.equal(app.getView().joinError, null);
});

test('the host-left notice of the flow state shows as the join error', () => {
  const { window, clock } = makeWorld();
  const host = window();
  const guest = window();
  host.app.openCreate();
  host.app.createRoom(WIND_RABBIT);
  guest.app.openJoin();
  guest.app.joinRoom('ABCD5');
  assert.equal(guest.app.getScreen(), WAITING_SCREEN);
  host.app.close();
  assert.equal(guest.app.getFlow().notice, 'host-left');
  assert.equal(guest.app.getScreen(), JOIN);
  assert.equal(guest.app.getView().joinError, STRINGS.noticeHostLeft);
  guest.app.clearJoinError();
  assert.equal(guest.app.getView().joinError, null);
  clock.advance(WAITING_START_DELAY_MS);
  guest.app.close();
});

test('Leave in the waiting room closes the transport, stops every timer and the code can no longer be joined', () => {
  const { network, clock, window } = makeWorld();
  const host = window();
  host.app.openCreate();
  host.app.createRoom(WIND_RABBIT);
  assert.equal(host.app.leaveRoom(), true);
  assert.equal(host.app.getScreen(), MENU);
  assert.equal(host.app.getFlow().screen, SCREENS.MENU);
  assert.equal(host.transports[0].closed, true);
  assert.equal(clock.pending, 0, 'no timer left');
  assert.equal(network.size, 0);

  // A later join gets no welcome.
  const transport = network.connect();
  const heard = [];
  const listener = network.connect();
  listener.onMessage((message) => heard.push(message.type));
  const guest = createGuestRoom({ transport, code: 'ABCD5', clock });
  clock.advance(JOIN_TIMEOUT_MS);
  assert.equal(heard.includes('welcome'), false);
  assert.equal(guest.phase, NO_ROOM);
  guest.close();
  listener.close();
  assert.equal(guest.phase, CLOSED);
});

test('Leave is off while the room is starting; both players enter the game only on the host start', () => {
  const { window, clock } = makeWorld();
  const host = window();
  const guest = window();
  host.app.openCreate();
  host.app.createRoom(WIND_RABBIT);
  guest.app.openJoin();
  guest.app.joinRoom('ABCD5');
  for (const win of [host, guest]) {
    assert.equal(win.app.getScreen(), WAITING_SCREEN);
    assert.equal(win.app.getView().waiting.leave.enabled, false);
    assert.equal(win.app.leaveRoom(), false);
  }
  clock.advance(WAITING_START_DELAY_MS - 1);
  assert.equal(guest.app.getFlow().screen, SCREENS.STARTING);
  clock.advance(1);
  assert.equal(host.app.getFlow().screen, SCREENS.GAME);
  assert.equal(guest.app.getFlow().screen, SCREENS.GAME);
  host.app.close();
  guest.app.close();
});

// --- waitingViewModel ---

const flowOf = (...events) => events.reduce(flowReducer, initialFlow());
const hostWaiting = flowOf(FLOW_EVENTS.PLAY_ONLINE, FLOW_EVENTS.ROOM_CREATED);
const hostStarting = flowReducer(hostWaiting, FLOW_EVENTS.OPPONENT_JOINED);
const guestStarting = flowOf(FLOW_EVENTS.PLAY_ONLINE, FLOW_EVENTS.JOINED);

test('waitingViewModel in phase waiting: title, code, hint, the other card a Waiting placeholder, Leave enabled', () => {
  const vm = waitingViewModel(hostWaiting, { code: 'ABCD5', character: WIND_RABBIT });
  assert.equal(vm.title, 'Waiting for opponent');
  assert.equal(vm.code, 'ABCD5');
  assert.equal(vm.hint, STRINGS.waitingHint);
  assert.equal(vm.starting, false);
  assert.equal(vm.startingText, null);
  assert.deepEqual(vm.cards.map((card) => card.character), [WIND_RABBIT, EARTH_BEAR]);
  assert.deepEqual(vm.cards.map((card) => card.stone), [X, O]);
  const [rabbit, bear] = vm.cards;
  assert.equal(rabbit.you, true);
  assert.equal(rabbit.youText, 'You');
  assert.equal(rabbit.placeholder, false);
  assert.equal(rabbit.box, 'card-host');
  assert.equal(rabbit.portrait, PORTRAIT_ART[X]);
  assert.equal(bear.placeholder, true);
  assert.equal(bear.placeholderText, 'Waiting');
  assert.equal(bear.you, false);
  assert.equal(bear.box, 'card-guest');
  assert.equal(vm.leave.enabled, true);
  assert.equal(vm.copy.enabled, true);
  assert.equal(vm.leave.label, 'Leave');
});

test('waitingViewModel in phase starting: Opponent joined, both cards filled, Leave disabled, Starting shows', () => {
  const vm = waitingViewModel(hostStarting, { code: 'ABCD5', character: EARTH_BEAR });
  assert.equal(vm.title, 'Opponent joined');
  assert.equal(vm.starting, true);
  assert.equal(vm.startingText, 'Starting');
  assert.equal(vm.leave.enabled, false);
  assert.ok(vm.cards.every((card) => !card.placeholder));
  assert.deepEqual(vm.cards.map((card) => card.name), WAITING_CARD_ORDER.map((id) => CHARACTERS[id].name));
  assert.deepEqual(vm.cards.map((card) => card.you), [false, true]);
  assert.deepEqual(vm.cards.map((card) => card.box), ['card-guest', 'card-host']);
});

test('the joiner sees the same room in phase starting, with its own card tagged You', () => {
  assert.equal(guestStarting.role, ROLES.GUEST);
  const guest = waitingViewModel(guestStarting, { code: 'ABCD5', character: EARTH_BEAR });
  const host = waitingViewModel(hostStarting, { code: 'ABCD5', character: WIND_RABBIT });
  assert.equal(guest.title, host.title);
  assert.equal(guest.code, host.code);
  assert.deepEqual(guest.cards.map((card) => card.box), host.cards.map((card) => card.box));
  assert.deepEqual(guest.cards.map((card) => card.you), [false, true]);
  assert.equal(waitingViewModel(initialFlow(), { code: 'ABCD5', character: WIND_RABBIT }), null);
});

// --- Copy ---

test('copyRoomCode: copied with a clipboard, manual (select and Ctrl+C) when it is missing or rejects', async () => {
  const written = [];
  assert.equal(await copyRoomCode('ABCD5', { writeText: async (text) => written.push(text) }), 'copied');
  assert.deepEqual(written, ['ABCD5']);
  assert.equal(await copyRoomCode('ABCD5', undefined), 'manual');
  assert.equal(await copyRoomCode('ABCD5', {}), 'manual');
  assert.equal(await copyRoomCode('ABCD5', { writeText: async () => { throw new Error('denied'); } }), 'manual');
  assert.equal(copyFeedbackText('copied'), 'Copied');
  assert.equal(copyFeedbackText('manual'), 'Press Ctrl+C');
  assert.ok(COPY_FEEDBACK_MS > 0);
});

// --- typing guard ---

test('the lobby code box is a typing target, so C, F, Z, H and V typed into it trigger no shortcut', () => {
  const html = read('index.html');
  const tag = html.match(/<(\w+)[^>]*\bid="join-code"/)?.[1];
  assert.equal(tag, 'input');
  const box = { tagName: tag.toUpperCase(), isContentEditable: false };
  assert.equal(isTypingTarget(box), true);
  let calls = 0;
  const handler = shortcutKeyHandler(() => calls++);
  for (const key of ['c', 'f', 'z', 'h', 'v', 'C', 'F', 'Z', 'H', 'V']) handler({ key, target: box });
  assert.equal(calls, 0);
  handler({ key: 'c', target: { tagName: 'BODY' } });
  assert.equal(calls, 1, 'outside the box the shortcut still works');
});

// --- shot scenes ---

test('the lobby, waiting and starting shot scenes: fixed code ABCD5, role host, Wind Rabbit', () => {
  for (const scene of ['lobby', 'waiting', 'starting']) assert.ok(SHOT_SCENES.includes(scene), scene);
  assert.equal(shotFlow('lobby').screen, SCREENS.LOBBY);
  assert.equal(shotRoomView('lobby').screen, LOBBY);
  assert.deepEqual({ ...SHOT_ROOM }, { code: 'ABCD5', character: WIND_RABBIT });
  const waiting = shotRoomView('waiting');
  assert.equal(waiting.screen, WAITING_SCREEN);
  assert.equal(waiting.flow.role, ROLES.HOST);
  assert.equal(waiting.waiting.title, 'Waiting for opponent');
  assert.equal(waiting.waiting.code, 'ABCD5');
  const starting = shotRoomView('starting');
  assert.equal(starting.flow.screen, SCREENS.STARTING);
  assert.equal(starting.waiting.leave.enabled, false);
  assert.equal(shotRoomView('menu'), null);
  assert.equal(shotRoomView('field'), null);
});

test('index.html names a data-hud-box for every lobby and waiting room button and card', () => {
  const html = read('index.html');
  for (const name of ['lobby-panel', 'lobby-create', 'lobby-join', 'lobby-back', 'join-code', 'join-submit', 'join-back',
    'create-back', 'waiting-panel', 'waiting-code', 'waiting-copy', 'waiting-leave']) {
    assert.ok(html.includes(`data-hud-box="${name}"`), name);
  }
  assert.match(html, /id="join-error"[^>]*aria-live="polite"/);
  assert.match(html, /id="copy-status"[^>]*aria-live="polite"/);
  assert.equal(/role="alert"/.test(html.slice(html.indexOf('id="screens"'))), false, 'errors are polite, never an alert');
  assert.ok(html.includes('href="src/ui/room.css"'));
});

// --- style ---

function cssBlocks(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
}
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g;

test('room.css: no colour literal outside the token block, and every token colour is one of the HUD glass', () => {
  const css = read('src/ui/room.css');
  const known = read('src/ui/hud.css');
  const blocks = cssBlocks(css);
  const isTokens = ([selector, body]) => selector === '#screens' && body.trim().startsWith('--');
  assert.equal(blocks.filter(isTokens).length, 1, 'one token block');
  for (const block of blocks) {
    const [selector, body] = block;
    if (isTokens(block)) {
      for (const declaration of body.split(';').map((d) => d.trim()).filter(Boolean)) {
        assert.ok(declaration.startsWith('--'), `only tokens in the token block: ${declaration}`);
        const value = declaration.slice(declaration.indexOf(':') + 1).trim();
        if (value.match(COLOUR)) assert.ok(known.includes(value), `${declaration} is a HUD glass colour`);
      }
      continue;
    }
    assert.equal(body.match(COLOUR), null, `${selector} uses tokens only`);
  }
});

test('room.css: the room code at least 40 px, the pulse 0.6 to 1 over 1.6 s and off for reduced motion', () => {
  const css = read('src/ui/room.css');
  const blocks = new Map();
  for (const [selector, body] of cssBlocks(css)) if (!blocks.has(selector)) blocks.set(selector, body);
  assert.match(blocks.get('#screens .room-card .code'), /font-size:\s*max\(40px,/);
  assert.match(blocks.get('#screens .seat.is-placeholder'), /animation:\s*seat-pulse 1\.6s/);
  assert.match(css, /from \{ opacity: 0\.6; \}\s*to \{ opacity: 1; \}/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.seat\.is-placeholder\s*\{\s*animation:\s*none/);
  // Buttons keep the 44 px floor of screens.css.
  assert.match(read('src/ui/screens.css'), /#screens button \{[^}]*min-height:\s*44px/);
});
