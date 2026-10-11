// Playing on a phone (docs/mobile.md): the page shell, the guards that stop what a phone's browser
// does by itself, the screen wake lock, the Back button guard, the long press, the invite share
// sheet and the away status line.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { installMobileGuards } from '../src/ui/mobile-guards.js';
import { createWakeLock } from '../src/ui/wake-lock.js';
import { BACK_TARGETS, createBackGuard, pickBackTarget } from '../src/ui/back-guard.js';
import { TOUCH_ACT, TOUCH_PREVIEW, attachGameInput, createTouchConfirm } from '../src/ui/input.js';
import { shareInvite } from '../src/ui/room-screens.js';
import { statusLine } from '../src/ui/online-game.js';
import { STRINGS } from '../src/ui/strings.js';
import { newGame } from '../src/logic/game.js';
import { X } from '../src/logic/board.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const screensCss = readFileSync(new URL('../src/ui/screens.css', import.meta.url), 'utf8');
const chatCss = readFileSync(new URL('../src/ui/chat.css', import.meta.url), 'utf8');
const hudSource = readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');

// A tiny event target: listeners by type, dispatch with a cancelable event.
function fakeTarget(extra = {}) {
  const listeners = new Map();
  return {
    addEventListener(type, fn, options) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ fn, options });
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry.fn !== fn));
    },
    count(type) {
      return (listeners.get(type) ?? []).length;
    },
    fire(type, props = {}) {
      const event = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...props };
      for (const { fn } of [...(listeners.get(type) ?? [])]) fn(event);
      return event;
    },
    ...extra,
  };
}

// --- The page shell ---------------------------------------------------------------------------

test('index.html: pinch zoom stays, a dynamic height, no pull to refresh, no selection, no double tap zoom', () => {
  const viewport = html.match(/<meta name="viewport" content="([^"]*)"/)?.[1] ?? '';
  for (const part of ['width=device-width', 'initial-scale=1', 'interactive-widget=resizes-visual']) {
    assert.ok(viewport.includes(part), `viewport has ${part}`);
  }
  assert.doesNotMatch(viewport, /maximum-scale|user-scalable/, 'the player can pinch zoom');
  assert.match(html, /:root \{ --vh100: 100vh; \}/, 'the plain height first');
  assert.match(html, /@supports \(height: 100dvh\) \{ :root \{ --vh100: 100dvh; \} \}/, 'the dynamic height where it exists');
  assert.match(html, /overscroll-behavior: none/);
  assert.match(html, /html, body \{[^}]*touch-action: manipulation/s, 'pan and pinch, but no double tap zoom');
  assert.doesNotMatch(html, /touch-action: (none|pan-x pan-y)/, 'nothing takes the pinch away');
  assert.match(html, /-webkit-touch-callout: none/);
  assert.match(html, /user-select: none/);
  assert.match(html, /#world \{[^}]*touch-action: pinch-zoom/s, 'one finger on the board is the game\'s, two fingers still pinch');
});

test('index.html: installable on a phone (manifest, theme colour, home screen icon)', () => {
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<meta name="theme-color" content="#14121c">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<link rel="apple-touch-icon" href="assets\/app-icon-192\.png">/);
});

test('manifest.webmanifest: standalone, and every icon file exists at its stated size', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    const url = new URL(`../${icon.src}`, import.meta.url);
    assert.ok(existsSync(url), `${icon.src} exists`);
    const png = readFileSync(url);
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(png.readUInt32BE(16), size, `${icon.src} width`);
    assert.equal(png.readUInt32BE(20), size, `${icon.src} height`);
  }
  assert.doesNotMatch(JSON.stringify(manifest), /https?:\/\//, 'no remote address');
});

test('style sheets: a phone floor for the screen unit, and text boxes of at least 16 px', () => {
  assert.match(screensCss, /@media \(max-width: 600px\) \{\s*#screens \{\s*--u: max\(/, 'phone width floor');
  assert.match(screensCss, /@media \(max-height: 500px\) and \(pointer: coarse\)/, 'phone landscape floor');
  assert.match(screensCss, /#join-code[^{]*\{[^}]*font-size: max\(16px,/s, 'the join code box');
  assert.match(screensCss, /\.name-input \{[^}]*font-size: max\(16px,/s, 'the name box');
  assert.match(chatCss, /#chat \.chat-input \{[^}]*font-size: 16px/s, 'the chat box');
  assert.match(screensCss, /var\(--vh100\)/, 'the screens use the dynamic height too');
});

// --- Guards --------------------------------------------------------------------------------

test('installMobileGuards: the long press menu is cancelled, pinch gestures are left alone', () => {
  const doc = fakeTarget();
  const off = installMobileGuards({ document: doc }, doc);
  assert.equal(doc.fire('contextmenu', { target: { tagName: 'CANVAS' } }).defaultPrevented, true);
  assert.equal(doc.fire('contextmenu', { target: { tagName: 'INPUT' } }).defaultPrevented, false, 'a text box keeps its paste menu');
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    assert.equal(doc.count(type), 0, `${type} is not taken: the page zooms`);
  }
  assert.equal(doc.count('touchmove'), 0, 'two fingers are not taken either');
  off();
  assert.equal(doc.count('contextmenu'), 0);
  assert.equal(doc.fire('contextmenu', { target: { tagName: 'CANVAS' } }).defaultPrevented, false, 'taken off');
});

// --- Long press ----------------------------------------------------------------------------

function withFakeWindow(run) {
  const previous = globalThis.window;
  globalThis.window = fakeTarget();
  try {
    return run(globalThis.window);
  } finally {
    globalThis.window = previous;
  }
}

test('long press: a resting finger never cancels the preview, a mouse right click does', () => {
  withFakeWindow(() => {
    const canvas = fakeTarget({ width: 960, height: 540, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }) });
    let cancels = 0;
    const off = attachGameInput(canvas, { onHover() {}, onClick() {}, onCancel: () => { cancels += 1; } });
    canvas.fire('pointerdown', { pointerType: 'touch', isPrimary: true });
    const press = canvas.fire('contextmenu');
    assert.equal(press.defaultPrevented, true, 'the menu itself is always suppressed');
    assert.equal(cancels, 0, 'a finger resting on the board is aiming');
    canvas.fire('pointerdown', { pointerType: 'mouse', isPrimary: true });
    canvas.fire('contextmenu');
    assert.equal(cancels, 1, 'a right click cancels');
    off();
  });
});

test('long press: a second finger does not change what kind of pointer pressed', () => {
  withFakeWindow(() => {
    const canvas = fakeTarget({ width: 960, height: 540, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }) });
    let cancels = 0;
    const clicks = [];
    attachGameInput(canvas, { onHover() {}, onClick: (point) => clicks.push(point.pointerType), onCancel: () => { cancels += 1; } });
    canvas.fire('pointerdown', { pointerType: 'touch', isPrimary: true });
    canvas.fire('pointerdown', { pointerType: 'mouse', isPrimary: false }); // a stray second pointer
    canvas.fire('contextmenu');
    assert.equal(cancels, 0);
    canvas.fire('click', { button: 0, clientX: 10, clientY: 10 });
    assert.deepEqual(clicks, ['touch'], 'the tap still counts as a finger tap');
  });
});

test('Safari on iOS 18.2 says "mouse" on a finger\'s click: the press that came first decides, so the first tap only previews', () => {
  withFakeWindow(() => {
    const canvas = fakeTarget({ width: 960, height: 540, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }) });
    const confirm = createTouchConfirm();
    const seen = [];
    attachGameInput(canvas, {
      onHover() {},
      onClick: ({ pointerType }) => seen.push(confirm.decide(pointerType, { x: 3, y: 4 })),
      onCancel() {},
    });
    for (let tap = 0; tap < 2; tap += 1) {
      canvas.fire('pointerdown', { pointerType: 'touch', isPrimary: true });
      canvas.fire('pointerup', { pointerType: 'touch', isPrimary: true });
      canvas.fire('click', { button: 0, clientX: 10, clientY: 10, pointerType: 'mouse' }); // WebKit bug 282988
    }
    assert.deepEqual(seen, [TOUCH_PREVIEW, TOUCH_ACT], 'preview on the first tap, plant on the second');
  });
});

test('a click takes the kind of pointer of the press before it: a mouse after a finger acts at once, and a click with no press falls back to its own', () => {
  withFakeWindow(() => {
    const canvas = fakeTarget({ width: 960, height: 540, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }) });
    const types = [];
    attachGameInput(canvas, { onHover() {}, onClick: (point) => types.push(point.pointerType), onCancel() {} });
    canvas.fire('click', { button: 0, clientX: 1, clientY: 1 });
    canvas.fire('click', { button: 0, clientX: 1, clientY: 1, pointerType: 'pen' });
    canvas.fire('pointerdown', { pointerType: 'touch', isPrimary: true });
    canvas.fire('click', { button: 0, clientX: 1, clientY: 1 });
    canvas.fire('pointerdown', { pointerType: 'mouse', isPrimary: true });
    canvas.fire('click', { button: 0, clientX: 1, clientY: 1, pointerType: 'touch' });
    assert.deepEqual(types, ['mouse', 'pen', 'touch', 'mouse']);
  });
});

test('the HUD gives a finger the same long press rule as the board', () => {
  assert.match(hudSource, /lastPointerType === 'touch'/);
  assert.match(hudSource, /event\.isPrimary !== false/);
});

// --- Wake lock -----------------------------------------------------------------------------

function wakeSetup({ supported = true, refuse = false } = {}) {
  const document = fakeTarget({ visibilityState: 'visible' });
  const locks = [];
  const navigator = supported
    ? {
        wakeLock: {
          request: async () => {
            if (refuse) throw new Error('NotAllowedError');
            const lock = fakeTarget({ released: false });
            lock.release = async () => {
              lock.released = true;
              lock.fire('release');
            };
            locks.push(lock);
            return lock;
          },
        },
      }
    : {};
  const wake = createWakeLock({ navigator, document });
  return { wake, document, locks };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('wake lock: held while a game or room is open, released on the menu', async () => {
  const { wake, locks } = wakeSetup();
  assert.equal(wake.supported, true);
  wake.setWanted(true);
  await settle();
  assert.equal(wake.active, true);
  assert.equal(locks.length, 1);
  wake.setWanted(true);
  await settle();
  assert.equal(locks.length, 1, 'asked once');
  wake.setWanted(false);
  await settle();
  assert.equal(wake.active, false);
  assert.equal(locks[0].released, true);
});

test('wake lock: not asked while the page is hidden, asked again when it shows', async () => {
  const { wake, document, locks } = wakeSetup();
  document.visibilityState = 'hidden';
  wake.setWanted(true);
  await settle();
  assert.equal(locks.length, 0, 'a hidden page cannot hold it');
  document.visibilityState = 'visible';
  document.fire('visibilitychange');
  await settle();
  assert.equal(wake.active, true);
});

test('wake lock: the browser taking it back (page hidden) lets the next show take it again', async () => {
  const { wake, document, locks } = wakeSetup();
  wake.setWanted(true);
  await settle();
  locks[0].fire('release'); // the system released it when the page was hidden
  assert.equal(wake.active, false);
  document.fire('visibilitychange');
  await settle();
  assert.equal(wake.active, true);
  assert.equal(locks.length, 2);
});

test('wake lock: a touch nudge asks again only when wanted and not held', async () => {
  const { wake, locks } = wakeSetup();
  wake.nudge();
  await settle();
  assert.equal(locks.length, 0, 'not wanted on the menu');
  wake.setWanted(true);
  await settle();
  wake.nudge();
  await settle();
  assert.equal(locks.length, 1, 'already held');
});

test('wake lock: a refusal or a missing API is safe and the game goes on', async () => {
  const refused = wakeSetup({ refuse: true });
  refused.wake.setWanted(true);
  await settle();
  assert.equal(refused.wake.active, false);
  assert.equal(refused.wake.wanted, true);
  const none = wakeSetup({ supported: false });
  assert.equal(none.wake.supported, false);
  assert.doesNotThrow(() => {
    none.wake.setWanted(true);
    none.wake.nudge();
    none.wake.setWanted(false);
  });
});

test('wake lock: unwanted while it was being given, it is given back at once', async () => {
  const { wake, locks } = wakeSetup();
  wake.setWanted(true);
  wake.setWanted(false); // before the browser answered
  await settle();
  assert.equal(wake.active, false);
  assert.equal(locks[0].released, true);
});

// --- Back button guard -----------------------------------------------------------------------

function fakeButton(name, { hidden = false, parent = null } = {}) {
  return { name, hidden, parent, clicks: 0, click() { this.clicks += 1; } };
}
function fakeDoc(map) {
  return { querySelectorAll: (selector) => map[selector] ?? [] };
}

test('back guard targets: the leave card, the panels, the room screens, then the Leave match door', () => {
  assert.deepEqual(BACK_TARGETS.slice(0, 3), ['.leave-confirm .leave-stay', '#howto-close', '#settings-close']);
  assert.equal(BACK_TARGETS.at(-1), '.leave-button');
  assert.ok(BACK_TARGETS.some((s) => s.includes('data-action="leaveRoom"')));
});

test('pickBackTarget: the first shown button wins and a hidden ancestor hides it', () => {
  const stay = fakeButton('stay');
  const leave = fakeButton('leave');
  const back = fakeButton('back');
  const hiddenCard = { hidden: true, parent: null };
  const inHidden = fakeButton('inHidden', { parent: hiddenCard });
  const doc = fakeDoc({
    '.leave-confirm .leave-stay': [stay],
    '#screens [data-action="back"]': [inHidden, back],
    '.leave-button': [leave],
  });
  assert.equal(pickBackTarget(doc), stay);
  stay.hidden = true;
  assert.equal(pickBackTarget(doc), back, 'skips the one inside a hidden card');
  back.hidden = true;
  assert.equal(pickBackTarget(doc), leave);
  leave.hidden = true;
  assert.equal(pickBackTarget(doc), null);
});

function guardSetup() {
  const win = fakeTarget();
  const entries = [];
  const history = {
    pushState(state) { entries.push(state); },
    back() { entries.pop(); win.fire('popstate'); },
  };
  const button = fakeButton('leave');
  const doc = fakeDoc({ '.leave-button': [button] });
  const guard = createBackGuard({ history, location: { href: 'https://example.test/' }, win, doc });
  return { guard, win, entries, button };
}

test('back guard: past the menu one history entry is kept, and Back presses the screen\'s own button', () => {
  const { guard, win, entries, button } = guardSetup();
  guard.sync(true);
  guard.sync(true);
  assert.equal(entries.length, 1, 'pushed once');
  assert.equal(guard.armed, true);
  entries.pop(); // the player pressed Back: the browser took the entry away
  win.fire('popstate');
  assert.equal(button.clicks, 1);
  assert.equal(guard.armed, false);
  guard.sync(true); // still in the game: the entry is put back
  assert.equal(entries.length, 1);
  assert.equal(guard.armed, true);
});

test('back guard: back on the menu takes the entry away without pressing anything', () => {
  const { guard, entries, button } = guardSetup();
  guard.sync(true);
  guard.sync(false);
  assert.equal(entries.length, 0, 'history.back() ran');
  assert.equal(guard.armed, false);
  assert.equal(button.clicks, 0, 'our own popstate is not a press');
  guard.sync(false);
  assert.equal(entries.length, 0, 'nothing to undo twice');
});

test('back guard: a popstate while not armed is the browser\'s own move and is left alone', () => {
  const { guard, win, button } = guardSetup();
  win.fire('popstate');
  assert.equal(button.clicks, 0);
  guard.close();
  assert.equal(win.count('popstate'), 0);
});

// --- Invite share sheet ------------------------------------------------------------------------

test('shareInvite: shared, cancelled by the player, or failed (so the link is copied instead)', async () => {
  let sent = null;
  assert.equal(await shareInvite(async (data) => { sent = data; }, 'https://x.test/?join=ABCD'), 'shared');
  assert.deepEqual(sent, { title: STRINGS.shareTitle, text: STRINGS.shareText, url: 'https://x.test/?join=ABCD' });
  assert.equal(await shareInvite(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }, 'u'), 'cancelled');
  assert.equal(await shareInvite(async () => { throw new Error('nope'); }, 'u'), 'failed');
  assert.equal(await shareInvite(undefined, 'u'), 'failed');
});

// --- Status line of an away opponent -------------------------------------------------------------

test('statusLine: an away opponent is waited for, only while it is their turn', () => {
  const state = newGame();
  assert.equal(statusLine({ state, you: X, yourTurn: false, peerAway: true }), STRINGS.peerAway);
  assert.equal(statusLine({ state, you: X, yourTurn: true, peerAway: true }), 'Your turn', 'your own turn comes first');
  assert.equal(statusLine({ state, you: X, yourTurn: false, peerAway: false }), "Opponent's turn");
  assert.match(STRINGS.peerAway, /away/i);
});
