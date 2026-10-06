// The lobby and the waiting room (docs/flow-design.md sections 3.4 and
// 3.5, Flow v1 step 5): the room code box, the pure view models, the copy
// helper, Leave, the shot scenes, the typing guard and the style rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as config from '../src/config.js';
import { COOLDOWN_LONG, COOLDOWN_SHORT, COPY_FEEDBACK_MS, JOIN_TIMEOUT_MS, ROOM_CODE_LENGTH } from '../src/config.js';
import { EMPTY, O, X } from '../src/logic/board.js';
import { CHARACTERS, CLOUD_EAGLE, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT } from '../src/logic/characters.js';
import { createSeats, pickCharacter, setReady } from '../src/logic/seats.js';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { ROOM_CODE_ALPHABET, isValidRoomCode, normalizeRoomCode } from '../src/net/room-code.js';
import { CLOSED, GUEST, HOST, NO_ROOM, ROOM_SEATS, createGuestRoom } from '../src/net/room.js';
import { onlineSameBrowserOnly } from '../src/net/transport.js';
import { ART } from '../src/render3d/art-assets.js';
import { GAME, JOIN, LOBBY, MENU, SELECT, WAITING_SCREEN, createApp } from '../src/ui/app.js';
import { FLOW_EVENTS, LOCAL_SEATS, ROLES, SCREENS, flowReducer, initialFlow } from '../src/ui/flow.js';
import { PORTRAIT_ART } from '../src/ui/hud-view.js';
import { isTypingTarget, shortcutKeyHandler } from '../src/ui/input.js';
import {
  CHARACTER_LOOKS, SELECT_CHARACTERS, characterSelectViewModel, copyFeedbackText, copyRoomCode, joinViewModel, lobbyViewModel, localSelectViewModel,
  restText, waitingViewModel,
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

test('lobbyViewModel: Create, Join and Back, and the same-browser hint only for the broadcast transport', () => {
  const vm = lobbyViewModel();
  assert.equal(vm.back.label, 'Back');
  assert.deepEqual([vm.create.box, vm.join.box, vm.back.box], ['lobby-create', 'lobby-join', 'lobby-back']);
  assert.equal(vm.hint, onlineSameBrowserOnly(config) ? STRINGS.lobbySameBrowserHint : null);
  assert.equal(lobbyViewModel({ config: { ONLINE_TRANSPORT: 'broadcast' } }).hint, STRINGS.lobbySameBrowserHint);
  assert.equal(lobbyViewModel({ config: { ONLINE_TRANSPORT: 'websocket' } }).hint, null);
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
  assert.deepEqual({ ...app.getFlow() }, { screen: 'menu', overlay: 'none', mode: null, role: null, notice: null, seats: null });
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
  host.app.createRoom();
  guest.app.openJoin();
  guest.app.joinRoom('ABCD5');
  assert.equal(guest.app.getScreen(), WAITING_SCREEN);
  host.app.close();
  assert.equal(guest.app.getFlow().notice, 'host-left');
  assert.equal(guest.app.getScreen(), JOIN);
  assert.equal(guest.app.getView().joinError, STRINGS.noticeHostLeft);
  guest.app.clearJoinError();
  assert.equal(guest.app.getView().joinError, null);
  clock.advance(60000);
  guest.app.close();
});

test('Leave in the waiting room closes the transport, stops every timer and the code can no longer be joined', () => {
  const { network, clock, window } = makeWorld();
  const host = window();
  host.app.createRoom();
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

test('Leave stays on while the room is starting; both players enter the game only on the host start', () => {
  const { window } = makeWorld();
  const host = window();
  const guest = window();
  host.app.createRoom();
  guest.app.openJoin();
  guest.app.joinRoom('ABCD5');
  for (const win of [host, guest]) {
    assert.equal(win.app.getScreen(), WAITING_SCREEN);
    assert.equal(win.app.getView().waiting.leave.enabled, true);
  }
  assert.equal(guest.app.pick(WIND_RABBIT), true);
  assert.equal(host.app.pick(WIND_RABBIT), false, 'taken by the guest');
  assert.equal(host.app.pick(EARTH_BEAR), true);
  assert.equal(guest.app.ready(), true);
  assert.equal(guest.app.getFlow().screen, SCREENS.STARTING, 'the guest waits for the host');
  assert.equal(guest.app.getView().waiting.startingText, STRINGS.selectWaitingOther);
  assert.equal(host.app.ready(), true);
  assert.equal(host.app.getFlow().screen, SCREENS.GAME);
  assert.equal(guest.app.getFlow().screen, SCREENS.GAME);
  assert.equal(guest.app.getGame().getView().you, 'X', 'the first pick plays X');
  host.app.close();
  guest.app.close();
});

// --- waitingViewModel and the character select ---

const flowOf = (...events) => events.reduce(flowReducer, initialFlow());
const hostWaiting = flowOf(FLOW_EVENTS.PLAY_ONLINE, FLOW_EVENTS.ROOM_CREATED);
const hostStarting = flowReducer(hostWaiting, FLOW_EVENTS.OPPONENT_JOINED);
const guestStarting = flowOf(FLOW_EVENTS.PLAY_ONLINE, FLOW_EVENTS.JOINED);
const roomSeats = (...steps) => steps.reduce((seats, [seat, character]) => (
  character === 'ready' ? setReady(seats, seat).seats : pickCharacter(seats, seat, character).seats
), createSeats(ROOM_SEATS));

test('waitingViewModel in phase waiting: title, code, hint, the guest seat a Waiting placeholder, Leave enabled', () => {
  const seats = roomSeats([HOST, WIND_RABBIT]);
  const vm = waitingViewModel(hostWaiting, { code: 'ABCD5', seats, seat: HOST });
  assert.equal(vm.title, 'Waiting for opponent');
  assert.equal(vm.code, 'ABCD5');
  assert.equal(vm.hint, STRINGS.waitingHintRelay, 'the relay of ONLINE_TRANSPORT websocket');
  assert.equal(vm.lead, 'The first to pick plays X and moves first.');
  assert.equal(vm.starting, false);
  assert.equal(vm.startingText, null);
  const [mine, other] = vm.cards;
  assert.equal(mine.box, 'card-host');
  assert.equal(mine.you, true);
  assert.equal(mine.youText, 'You');
  assert.equal(mine.character, WIND_RABBIT);
  assert.equal(mine.stone, X);
  assert.equal(mine.portrait, PORTRAIT_ART[WIND_RABBIT], 'the portrait of the picked character');
  assert.equal(mine.choices.length, SELECT_CHARACTERS.length, 'the host may pick before the guest comes');
  assert.equal(other.box, 'card-guest');
  assert.equal(other.placeholder, true);
  assert.equal(other.placeholderText, 'Waiting');
  assert.deepEqual(other.choices, []);
  assert.equal(other.readyButton, null);
  assert.equal(vm.leave.enabled, true);
  assert.equal(vm.copy.enabled, true);
  assert.equal(vm.leave.label, 'Leave');
});

test('waitingViewModel in phase starting: both seats, only the own seat can pick, a taken character is disabled', () => {
  const seats = roomSeats([GUEST, EARTH_BEAR]);
  const vm = waitingViewModel(hostStarting, { code: 'ABCD5', seats, seat: HOST });
  assert.equal(vm.title, 'Pick your character');
  assert.equal(vm.starting, true);
  assert.equal(vm.leave.enabled, true, 'no start on a timer, so Leave is always there');
  assert.ok(vm.cards.every((card) => !card.placeholder));
  const [mine, other] = vm.cards;
  assert.deepEqual(mine.choices.map((choice) => choice.character), [WIND_RABBIT, EARTH_BEAR, JADE_SERPENT, CLOUD_EAGLE]);
  assert.deepEqual(mine.choices.map((choice) => choice.disabled), [false, true, false, false]);
  assert.equal(mine.choices[1].taken, true);
  assert.equal(mine.choices[1].takenText, 'Taken');
  assert.equal(mine.readyButton.disabled, true, 'Ready needs a pick');
  assert.equal(mine.stone, null);
  assert.equal(other.stone, X, 'the guest picked first');
  assert.equal(other.name, CHARACTERS[EARTH_BEAR].name);
  assert.deepEqual(other.choices, [], 'the other seat is not this window\'s');
  const picked = waitingViewModel(hostStarting, { code: 'ABCD5', seats: roomSeats([GUEST, EARTH_BEAR], [HOST, JADE_SERPENT]), seat: HOST });
  assert.equal(picked.cards[0].readyButton.disabled, false);
  assert.equal(picked.cards[0].stone, O);
  const ready = waitingViewModel(hostStarting, { code: 'ABCD5', seats: roomSeats([GUEST, EARTH_BEAR], [HOST, JADE_SERPENT], [HOST, 'ready']), seat: HOST });
  assert.deepEqual(ready.cards[0].readyButton, { label: STRINGS.selectUnready, disabled: false, unready: true, box: 'ready-host' }, 'Ready turns into Unready');
  assert.ok(ready.cards[0].choices.every((choice) => choice.disabled), 'the pick is locked once Ready');
  assert.equal(ready.startingText, STRINGS.selectWaitingOther);
});

test('the joiner sees the same room in phase starting, with its own seat tagged You', () => {
  assert.equal(guestStarting.role, ROLES.GUEST);
  const seats = roomSeats([HOST, WIND_RABBIT]);
  const guest = waitingViewModel(guestStarting, { code: 'ABCD5', seats, seat: GUEST });
  const host = waitingViewModel(hostStarting, { code: 'ABCD5', seats, seat: HOST });
  assert.equal(guest.title, host.title);
  assert.equal(guest.code, host.code);
  assert.deepEqual(guest.cards.map((card) => card.box), host.cards.map((card) => card.box));
  assert.deepEqual(guest.cards.map((card) => card.you), [false, true]);
  assert.deepEqual(guest.cards[1].choices.map((choice) => choice.disabled), [true, false, false, false]);
  assert.equal(waitingViewModel(initialFlow(), { code: 'ABCD5', seats, seat: HOST }), null);
});

test('characterSelectViewModel: four characters, Ready enabled only after a pick', () => {
  assert.deepEqual([...SELECT_CHARACTERS], [WIND_RABBIT, EARTH_BEAR, JADE_SERPENT, CLOUD_EAGLE]);
  const labels = { [HOST]: 'A', [GUEST]: 'B' };
  const empty = characterSelectViewModel({ seats: createSeats(ROOM_SEATS), labels, editable: [HOST, GUEST] });
  for (const card of empty.seats) {
    assert.equal(card.choices.length, 4);
    assert.ok(card.choices.every((choice) => !choice.disabled && !choice.selected));
    assert.equal(card.readyButton.disabled, true);
    assert.equal(card.statusText, 'Choosing');
  }
  const vm = characterSelectViewModel({ seats: roomSeats([HOST, JADE_SERPENT]), labels, editable: [HOST, GUEST] });
  assert.equal(vm.seats[0].readyButton.disabled, false);
  assert.equal(vm.seats[0].choices[2].selected, true);
  assert.equal(vm.seats[1].choices[2].disabled, true);
  assert.equal(vm.seats[1].readyButton.disabled, true);
  assert.equal(vm.seats[0].choices[0].box, 'pick-host-wind-rabbit');
  assert.equal(vm.seats[0].readyButton.box, 'ready-host');
});

test('localSelectViewModel: Player 1 and Player 2 both pick on the game screen of Play on this computer', () => {
  const flow = flowReducer(initialFlow(), FLOW_EVENTS.PLAY_LOCAL);
  const vm = localSelectViewModel(flow);
  assert.equal(vm.title, 'Choose your character');
  assert.deepEqual(vm.cards.map((card) => card.label), ['Player 1', 'Player 2']);
  assert.deepEqual(vm.cards.map((card) => card.seat), [...LOCAL_SEATS]);
  assert.ok(vm.cards.every((card) => card.choices.length === 4 && card.readyButton));
  assert.equal(vm.back.box, 'select-back');
  assert.equal(localSelectViewModel(initialFlow()), null);
});

test('the local app: a character picked in one seat is disabled for the other, the first pick gets X, and the game starts when both are Ready', () => {
  const app = createApp({ openTransport: () => assert.fail('no network'), clock: createFakeClock(), local: true });
  assert.equal(app.getScreen(), SELECT);
  const [one, two] = LOCAL_SEATS;
  assert.equal(app.pick(JADE_SERPENT, two), true, 'Player 2 picks first');
  assert.equal(app.pick(JADE_SERPENT, one), false, 'taken by Player 2');
  assert.equal(app.getView().select.cards[0].choices[2].disabled, true);
  assert.equal(app.ready(one), false, 'Ready needs a pick');
  assert.equal(app.pick(WIND_RABBIT, one), true);
  assert.equal(app.ready(two), true);
  assert.equal(app.getGame(), null);
  assert.equal(app.getScreen(), SELECT);
  assert.equal(app.ready(one), true);
  assert.equal(app.getScreen(), GAME);
  const state = app.getGame().getState();
  assert.deepEqual(state.characters, { [X]: JADE_SERPENT, [O]: WIND_RABBIT });
  assert.equal(state.currentPlayer, X, 'the first pick moves first');
  assert.equal(app.getView().select, null);
  assert.equal(app.pick(EARTH_BEAR, one), false, 'no pick during the game');
  // Rematch keeps the same characters and sides.
  app.getGame().click({ x: 0, y: 0 });
  assert.equal(app.restartLocal(), true);
  assert.deepEqual(app.getGame().getState().characters, { [X]: JADE_SERPENT, [O]: WIND_RABBIT });
  assert.equal(app.getGame().getState().board[0][0], EMPTY, 'a clean board');
});

test('Back on the local character select returns to the menu', () => {
  const app = createApp({ openTransport: () => assert.fail('no network'), clock: createFakeClock(), local: true });
  app.pick(WIND_RABBIT, LOCAL_SEATS[0]);
  assert.equal(app.leaveRoom(), true);
  assert.equal(app.getScreen(), MENU);
  assert.equal(app.getFlow().seats, null);
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
  assert.equal(SHOT_ROOM.code, 'ABCD5');
  assert.equal(SHOT_ROOM.seat, HOST);
  assert.equal(SHOT_ROOM.seats.picks[HOST], WIND_RABBIT);
  const waiting = shotRoomView('waiting');
  assert.equal(waiting.screen, WAITING_SCREEN);
  assert.equal(waiting.flow.role, ROLES.HOST);
  assert.equal(waiting.waiting.title, 'Waiting for opponent');
  assert.equal(waiting.waiting.code, 'ABCD5');
  const starting = shotRoomView('starting');
  assert.equal(starting.flow.screen, SCREENS.STARTING);
  assert.equal(starting.waiting.leave.enabled, true);
  assert.equal(starting.waiting.title, 'Pick your character');
  assert.equal(shotRoomView('menu'), null);
  assert.equal(shotRoomView('field'), null);
});

test('index.html names a data-hud-box for every lobby and waiting room button and card', () => {
  const html = read('index.html');
  for (const name of ['lobby-panel', 'lobby-create', 'lobby-join', 'lobby-back', 'join-code', 'join-submit', 'join-back',
    'waiting-panel', 'waiting-code', 'waiting-copy', 'waiting-leave', 'select-panel', 'select-back']) {
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

test('room.css: no colour literal outside the token block, and every token colour is an Ivory or character colour', () => {
  const css = read('src/ui/room.css');
  const known = read('src/ui/screens.css') + read('src/ui/hud.css') + read('src/render3d/character-look.js');
  const blocks = cssBlocks(css);
  const isTokens = ([selector, body]) => selector === '#screens' && body.trim().startsWith('--');
  assert.equal(blocks.filter(isTokens).length, 1, 'one token block');
  for (const block of blocks) {
    const [selector, body] = block;
    if (isTokens(block)) {
      for (const declaration of body.split(';').map((d) => d.trim()).filter(Boolean)) {
        assert.ok(declaration.startsWith('--'), `only tokens in the token block: ${declaration}`);
        const value = declaration.slice(declaration.indexOf(':') + 1).trim();
        if (value.match(COLOUR)) assert.ok(known.includes(value), `${declaration} is an Ivory palette or character colour`);
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

// --- the character select look (Game v5 part 3, docs/reference/v5) ---

test('characterSelectViewModel characters: four cards with emblem, tagline, no initials and skill rest turns from COOLDOWN_SHORT and COOLDOWN_LONG', () => {
  const labels = { [HOST]: 'A', [GUEST]: 'B' };
  const vm = characterSelectViewModel({ seats: createSeats(ROOM_SEATS), labels, editable: [HOST], you: HOST });
  assert.equal(vm.active, HOST);
  assert.equal(vm.characters.length, 4);
  assert.deepEqual(vm.characters.map((card) => card.character), [WIND_RABBIT, EARTH_BEAR, JADE_SERPENT, CLOUD_EAGLE]);
  assert.ok(vm.characters.every((card) => !('seal' in card)), 'no seal initials on the cards (owner)');
  assert.deepEqual(vm.characters.map((card) => card.emblem), ['cross', 'bloom', 'leaf', 'cloud']);
  assert.deepEqual(vm.characters.map((card) => card.colour), ['blue', 'red', 'jade', 'gold']);
  assert.deepEqual(vm.characters.map((card) => card.box), [
    'pick-host-wind-rabbit', 'pick-host-earth-bear', 'pick-host-jade-serpent', 'pick-host-cloud-eagle',
  ]);
  // Cloud Eagle: Sky Watch is passive (Always on, no timer), Cloud rests COOLDOWN_LONG turns.
  const eagle = vm.characters[3];
  assert.deepEqual(eagle.skills.map((skill) => skill.rest), [0, COOLDOWN_LONG]);
  assert.deepEqual(eagle.skills.map((skill) => skill.restText), [STRINGS.skillAlwaysOn, `${COOLDOWN_LONG} turns`]);
  assert.equal(eagle.portrait, ART.cloudEagle.avatar);
  for (const card of vm.characters.slice(0, 3)) {
    assert.equal(card.name, CHARACTERS[card.character].name);
    assert.equal(card.tagline, CHARACTER_LOOKS[card.character].tagline);
    assert.ok(card.tagline.length > 0);
    assert.deepEqual(card.skills.map((skill) => skill.rest), [COOLDOWN_SHORT, COOLDOWN_LONG]);
    assert.deepEqual(card.skills.map((skill) => skill.restText), [`${COOLDOWN_SHORT} turns`, `${COOLDOWN_LONG} turns`]);
    assert.deepEqual(card.skills.map((skill) => skill.id), CHARACTERS[card.character].skills);
    assert.equal(card.selected, false);
    assert.equal(card.taken, false);
    assert.equal(card.disabled, false);
  }
  assert.equal(restText(COOLDOWN_LONG), `${COOLDOWN_LONG} turns`);
  assert.deepEqual(vm.readyButton, { seat: HOST, label: 'Ready', disabled: true, box: 'ready-host' }, 'Ready is disabled until a pick');
});

test('characterSelectViewModel characters: the taken state, Ready enabled only after a pick and locked once Ready', () => {
  const labels = { [HOST]: 'A', [GUEST]: 'B' };
  const view = (seats) => characterSelectViewModel({ seats, labels, editable: [GUEST], you: GUEST });
  const taken = view(roomSeats([HOST, EARTH_BEAR]));
  assert.deepEqual(taken.characters.map((card) => card.taken), [false, true, false, false]);
  assert.deepEqual(taken.characters.map((card) => card.disabled), [false, true, false, false]);
  assert.equal(taken.characters[1].takenText, 'Taken');
  assert.equal(taken.characters[0].takenText, null);
  assert.equal(taken.readyButton.disabled, true);
  const picked = view(roomSeats([HOST, EARTH_BEAR], [GUEST, JADE_SERPENT]));
  assert.equal(picked.characters[2].selected, true);
  assert.equal(picked.readyButton.disabled, false, 'Ready after a pick');
  assert.equal(picked.readyButton.box, 'ready-guest');
  const ready = view(roomSeats([HOST, EARTH_BEAR], [GUEST, JADE_SERPENT], [GUEST, 'ready']));
  assert.equal(ready.readyButton.unready, true, 'Unready takes it back');
  assert.equal(ready.readyButton.label, STRINGS.selectUnready);
  assert.ok(ready.characters.every((card) => card.disabled), 'the pick is locked while Ready');
  assert.equal(ready.characters[2].selected, true);
});

test('the local select: by default the cards pick for Player 1, then for Player 2 once Player 1 is Ready', () => {
  const [one, two] = LOCAL_SEATS;
  let flow = flowReducer(initialFlow(), FLOW_EVENTS.PLAY_LOCAL);
  let vm = localSelectViewModel(flow);
  assert.equal(vm.readyButton.seat, one);
  assert.deepEqual(vm.cards.map((card) => card.active), [true, false]);
  flow = flowReducer(flow, { type: FLOW_EVENTS.PICK, seat: one, character: WIND_RABBIT });
  assert.equal(localSelectViewModel(flow).readyButton.disabled, false);
  flow = flowReducer(flow, { type: FLOW_EVENTS.READY, seat: one });
  vm = localSelectViewModel(flow);
  assert.equal(vm.readyButton.seat, two);
  assert.equal(vm.readyButton.disabled, true);
  assert.equal(vm.characters[0].taken, true, 'Player 1 took Wind Rabbit');
  assert.equal(vm.characters[0].box, `pick-${two}-wind-rabbit`);
  assert.deepEqual(vm.cards.map((card) => card.active), [false, true]);
});

test('the local select: either seat may pick first, by a press on its seat card', () => {
  const [one, two] = LOCAL_SEATS;
  let flow = flowReducer(initialFlow(), FLOW_EVENTS.PLAY_LOCAL);
  let vm = localSelectViewModel(flow);
  assert.deepEqual(vm.cards.map((card) => card.choosable), [false, true], 'Player 2 can take the cards');
  vm = localSelectViewModel(flow, { seat: two });
  assert.equal(vm.readyButton.seat, two);
  assert.deepEqual(vm.cards.map((card) => card.active), [false, true]);
  assert.deepEqual(vm.cards.map((card) => card.choosable), [true, false]);
  assert.equal(vm.characters[1].box, `pick-${two}-earth-bear`);
  flow = flowReducer(flow, { type: FLOW_EVENTS.PICK, seat: two, character: EARTH_BEAR });
  flow = flowReducer(flow, { type: FLOW_EVENTS.READY, seat: two });
  vm = localSelectViewModel(flow);
  assert.equal(vm.readyButton.seat, one, 'a Ready seat hands the cards to the other');
  assert.equal(vm.characters[1].taken, true);
  assert.deepEqual(vm.cards.map((card) => card.choosable), [false, true], 'a Ready seat stays choosable, to Unready');
  vm = localSelectViewModel(flow, { seat: two });
  assert.equal(vm.readyButton.seat, two, 'a press on the Ready seat takes the cards back');
  assert.equal(vm.readyButton.unready, true);
  assert.equal(vm.readyButton.disabled, false);
});

test('characterSelectViewModel online: one editable seat, no choosable seat card', () => {
  const vm = characterSelectViewModel({ seats: createSeats(ROOM_SEATS), labels: { [HOST]: 'Host', [GUEST]: 'Guest' }, editable: [GUEST], you: GUEST, prefer: HOST });
  assert.equal(vm.active, GUEST);
  assert.ok(vm.seats.every((card) => !card.choosable));
});

test('the local app: chooseSeat lets Player 2 pick and get Ready first with the shared cards', () => {
  const app = createApp({ openTransport: () => assert.fail('no network'), clock: createFakeClock(), local: true });
  const [one, two] = LOCAL_SEATS;
  assert.equal(app.getView().select.readyButton.seat, one);
  assert.equal(app.chooseSeat(two), true);
  const vm = app.getView().select;
  assert.equal(vm.readyButton.seat, two);
  assert.equal(app.pick(JADE_SERPENT, vm.readyButton.seat), true);
  assert.equal(app.ready(two), true);
  assert.equal(app.chooseSeat(two), true, 'a Ready seat may be chosen to take its Ready back');
  assert.equal(app.getView().select.readyButton.unready, true);
  assert.equal(app.unready(two), true);
  assert.equal(app.ready(two), true);
  assert.equal(app.chooseSeat(one), true);
  assert.equal(app.getView().select.readyButton.seat, one);
  assert.equal(app.pick(WIND_RABBIT, one), true);
  assert.equal(app.ready(one), true);
  assert.equal(app.getScreen(), GAME);
  assert.deepEqual(app.getGame().getState().characters, { [X]: JADE_SERPENT, [O]: WIND_RABBIT });
});

test('the select shot scene: the local character select, Player 1 Ready on Wind Rabbit, Player 2 to pick', () => {
  assert.ok(SHOT_SCENES.includes('select'));
  const view = shotRoomView('select');
  assert.equal(view.screen, SELECT);
  assert.equal(view.waiting, null);
  assert.equal(view.select.readyButton.seat, LOCAL_SEATS[1]);
  assert.equal(view.select.characters[0].taken, true);
});

test('index.html: the character select panels have the character cards, the seats and a Ready button', () => {
  const html = read('index.html');
  for (const id of ['waiting-characters', 'waiting-cards', 'waiting-ready', 'select-characters', 'select-cards', 'select-ready']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  const css = read('src/ui/room.css');
  assert.match(css, /#screens \.select-back \{[^}]*min-height:\s*44px/);
  assert.match(css, /#screens \.select-ready \{[^}]*min-height:\s*max\(44px,/);
});
