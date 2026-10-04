// The game over card and the rematch wiring (docs/flow-design.md sections
// 3.7, 4 and 6): the pure view models, Back to Menu (the event LEAVE),
// Rematch online and local, and the clean board of the new game.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAME_OVER_DELAY_MS, LEAVE_COUNTDOWN_S, PEER_TIMEOUT_MS } from '../src/config.js';
import { EMPTY, O, X } from '../src/logic/board.js';
import { EARTH_BEAR, WIND_RABBIT } from '../src/logic/characters.js';
import { newGame } from '../src/logic/game.js';
import { WIND_DASH } from '../src/logic/skills.js';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { GAME, GAME_OVER, MENU, createApp } from '../src/ui/app.js';
import { MODES } from '../src/ui/flow.js';
import { gameOverViewModel, rematchViewModel } from '../src/ui/game-over.js';
import { hudViewModel } from '../src/ui/hud-view.js';
import { watchNewGame } from '../src/ui/new-game-watch.js';
import { SHOT_SCENES, shotGameOverView } from '../src/ui/shot-mode.js';
import { STRINGS } from '../src/ui/strings.js';
import { pickAndReady } from './room-start.js';

// --- rematchViewModel ---

test('rematchViewModel: all 16 combinations of mode, mine, theirs and gone', () => {
  const idle = { state: 'idle', label: 'Rematch', disabled: false, hint: null };
  const mine = { state: 'mine', label: 'Waiting for opponent', disabled: true, hint: 'Your request was sent' };
  const theirs = { state: 'theirs', label: 'Rematch', disabled: false, hint: 'Opponent wants a rematch' };
  const gone = { state: 'gone', label: 'Rematch', disabled: true, hint: 'Opponent left' };
  const expected = (mode, m, t, g) => {
    if (mode === MODES.LOCAL) return idle;
    if (g) return gone;
    if (m) return mine;
    if (t) return theirs;
    return idle;
  };
  let count = 0;
  for (const mode of [MODES.ONLINE, MODES.LOCAL]) {
    for (const m of [false, true]) {
      for (const t of [false, true]) {
        for (const g of [false, true]) {
          assert.deepEqual(rematchViewModel({ mode, mine: m, theirs: t, gone: g }), expected(mode, m, t, g),
            `${mode} mine ${m} theirs ${t} gone ${g}`);
          count++;
        }
      }
    }
  }
  assert.equal(count, 16);
  // The texts come from strings.js.
  assert.equal(STRINGS.gameOverRematch, 'Rematch');
  assert.equal(STRINGS.rematchWaiting, 'Waiting for opponent');
  assert.equal(STRINGS.rematchSentHint, 'Your request was sent');
  assert.equal(STRINGS.rematchTheirsHint, 'Opponent wants a rematch');
  assert.equal(STRINGS.rematchGoneHint, 'Opponent left');
});

// --- gameOverViewModel ---

test('gameOverViewModel: every outcome', () => {
  const online = MODES.ONLINE;
  assert.deepEqual(gameOverViewModel({ mode: online, winner: X, reason: 'five', you: X }),
    { headline: 'You win', subline: 'Wind Rabbit won' });
  assert.deepEqual(gameOverViewModel({ mode: online, winner: O, reason: 'five', you: O }),
    { headline: 'You win', subline: 'Earth Bear won' });
  assert.equal(gameOverViewModel({ mode: online, winner: X, reason: 'five', you: O }).headline, 'You lose');
  assert.equal(gameOverViewModel({ mode: online, winner: O, reason: 'five', you: X }).headline, 'You lose');
  assert.deepEqual(gameOverViewModel({ mode: online, winner: X, reason: 'opponentLeft', you: X }),
    { headline: 'You win', subline: 'Opponent left' });
  assert.deepEqual(gameOverViewModel({ mode: online, winner: null, reason: 'draw', you: X }),
    { headline: 'Draw', subline: 'The board is full' });
  assert.equal(gameOverViewModel({ mode: MODES.LOCAL, winner: X, reason: 'five' }).headline, 'Wind Rabbit wins');
  assert.equal(gameOverViewModel({ mode: MODES.LOCAL, winner: O, reason: 'five' }).headline, 'Earth Bear wins');
  assert.deepEqual(gameOverViewModel({ mode: MODES.LOCAL, winner: null, reason: 'draw' }),
    { headline: 'Draw', subline: 'The board is full' });
});

// --- The app: online ---

// A host (Wind Rabbit, X) and a guest in one fake room, in the game.
function startOnline() {
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
      random: () => 0,
      makeCode: () => 'AB2C9',
    });
    app.playOnline();
    return { app, transports };
  };
  const host = window();
  const guest = window();
  assert.equal(host.app.createRoom(), true);
  guest.app.openJoin();
  assert.equal(guest.app.joinRoom('AB2C9'), true);
  pickAndReady(host.app, guest.app, WIND_RABBIT);
  assert.equal(host.app.getScreen(), GAME);
  assert.equal(guest.app.getScreen(), GAME);
  return { network, clock, host, guest };
}

// X makes five on row 0 (with one Wind Dash on the way, so a skill of the
// old game is on cooldown); O plays row 1. Ends on the Game over screen.
function playToWin({ clock, host, guest }) {
  const x = host.app.getGame();
  const o = guest.app.getGame();
  for (let i = 0; i < 4; i++) {
    assert.equal(x.click({ x: i, y: 0 }), true);
    assert.equal(o.click({ x: i, y: 2 + (i % 2) * 2 }), true);
  }
  assert.equal(x.click({ x: 4, y: 0 }), true);
  clock.advance(GAME_OVER_DELAY_MS);
  assert.equal(host.app.getScreen(), GAME_OVER);
  assert.equal(guest.app.getScreen(), GAME_OVER);
}

test('online game over card: the winner and the loser, Rematch idle, Back to Menu always there', () => {
  const world = startOnline();
  playToWin(world);
  const win = world.host.app.getView().gameOver;
  assert.equal(win.headline, 'You win');
  assert.equal(win.subline, 'Wind Rabbit won');
  assert.deepEqual(win.rematch, rematchViewModel({ mode: MODES.ONLINE }));
  assert.equal(win.backToMenu, 'Back to Menu');
  assert.equal(world.guest.app.getView().gameOver.headline, 'You lose');
});

test('Back to Menu online (LEAVE): leave sent, transport closed, no timer pending, nothing sent afterwards', () => {
  const world = startOnline();
  playToWin(world);
  const { clock, host, guest } = world;
  // The guest leaves first, so the host's room is the last one open.
  assert.equal(guest.app.backToMenu(), true);
  assert.equal(guest.app.getScreen(), MENU);
  assert.equal(guest.app.getGame(), null);
  const guestEnd = guest.transports[0];
  assert.equal(guestEnd.closed, true);
  assert.equal(guestEnd.sent.at(-1).type, 'leave');

  // The host stays on the card: Opponent left, Rematch disabled, and no countdown ever.
  for (let t = 0; t < LEAVE_COUNTDOWN_S * 1000 + PEER_TIMEOUT_MS * 2; t += 500) {
    clock.advance(500);
    assert.equal(host.app.getScreen(), GAME_OVER);
    assert.equal(host.app.getGame().getView().peerCountdown, null, 'no Opponent left countdown after the game');
  }
  const card = host.app.getView().gameOver;
  assert.equal(card.headline, 'You win', 'leaving after the end does not change the result');
  assert.equal(card.rematch.hint, 'Opponent left');
  assert.equal(card.rematch.disabled, true);
  assert.equal(host.app.rematch(), false, 'a disabled Rematch does nothing');

  const hostEnd = host.transports[0];
  assert.equal(host.app.backToMenu(), true);
  assert.equal(host.app.getScreen(), MENU);
  assert.equal(hostEnd.closed, true);
  assert.equal(clock.pending, 0, 'heartbeat, countdown and every other timer stopped');
  const sent = [guestEnd.sent.length, hostEnd.sent.length];
  clock.advance(60_000);
  assert.deepEqual([guestEnd.sent.length, hostEnd.sent.length], sent, 'nothing is sent after LEAVE');
  assert.equal(world.network.size, 0);
});

test('Rematch online: mine then both, the new game starts with a clean board and no stale card', () => {
  const world = startOnline();
  playToWin(world);
  const { host, guest } = world;
  const numbers = [host.app.getGameNumber(), guest.app.getGameNumber()];

  assert.equal(guest.app.rematch(), true);
  assert.equal(guest.app.getView().gameOver.rematch.state, 'mine');
  assert.equal(guest.app.getView().gameOver.rematch.label, 'Waiting for opponent');
  assert.equal(host.app.getView().gameOver.rematch.state, 'theirs');
  assert.equal(host.app.getView().gameOver.rematch.hint, 'Opponent wants a rematch');

  assert.equal(host.app.rematch(), true);
  for (const win of [host, guest]) {
    assert.equal(win.app.getScreen(), GAME, 'REMATCH_STARTED returns to the game');
    assert.equal(win.app.getView().gameOver, null, 'no game over card during the new game');
    const game = win.app.getGame();
    const state = game.getView().state;
    assert.deepEqual(state, newGame());
    assert.ok(state.board.flat().every((cell) => cell === EMPTY));
    assert.deepEqual(game.takeEvents(), [], 'no event of the old game is replayed');
    assert.equal(game.getOutcome(), null);
    const hud = hudViewModel(state, {}, game.getView().you);
    for (const card of hud.cards) for (const skill of card.skills) assert.equal(skill.cooldownTurns, 0, skill.id);
  }
  assert.deepEqual([host.app.getGameNumber(), guest.app.getGameNumber()], numbers.map((n) => n + 1),
    'the page is told to clear the old board');

  // The second game ends too: a fresh card with Rematch idle again.
  playToWin(world);
  assert.equal(host.app.getView().gameOver.rematch.state, 'idle');
  assert.equal(guest.app.getView().gameOver.rematch.state, 'idle');
});

// The host's messages are lost long enough that the guest counts the host
// gone in over; then the connection comes back.
function loseHostThenRecover(world) {
  const { clock, host, guest } = world;
  host.transports[0].setMuted(true);
  clock.advance(PEER_TIMEOUT_MS + 1000);
  assert.equal(guest.app.getView().gameOver.rematch.state, 'gone');
  host.transports[0].setMuted(false);
}

test('network recovery: a side that counted the peer gone in over makes Rematch disabled on both sides', () => {
  const world = startOnline();
  playToWin(world);
  const { clock, host, guest } = world;
  loseHostThenRecover(world);
  for (let t = 0; t < LEAVE_COUNTDOWN_S * 1000 + PEER_TIMEOUT_MS * 2; t += 500) {
    clock.advance(500);
    assert.equal(host.app.getScreen(), GAME_OVER);
    assert.equal(host.app.getGame().getView().peerCountdown, null, 'no countdown after the game');
  }
  for (const win of [host, guest]) {
    const rematch = win.app.getView().gameOver.rematch;
    assert.equal(rematch.state, 'gone');
    assert.equal(rematch.disabled, true);
    assert.equal(rematch.hint, 'Opponent left');
    assert.equal(win.app.rematch(), false);
  }
  assert.equal(host.app.getView().gameOver.headline, 'You win', 'the result stays');
});

test('network recovery: a rematch the host starts before it hears the guest gave up is not taken by the guest', () => {
  const world = startOnline();
  playToWin(world);
  const { clock, host, guest } = world;
  assert.equal(guest.app.rematch(), true);
  // The host's messages drop until the guest counts the host gone; then
  // the guest's messages drop too, so its gone pings are lost.
  host.transports[0].setMuted(true);
  while (guest.app.getView().gameOver.rematch.state !== 'gone') clock.advance(50);
  guest.transports[0].setMuted(true);
  assert.ok(!guest.transports[0].sent.some((message) => message.gone), 'no gone ping got through');
  assert.equal(host.app.getView().gameOver.rematch.state, 'theirs', 'the host has not noticed yet');
  const guestCard = { headline: guest.app.getView().gameOver.headline, subline: guest.app.getView().gameOver.subline };
  const guestWinner = guest.app.getGame().getView().state.winner;
  host.transports[0].setMuted(false);
  // The host presses before any gone ping arrives: its new game begins alone.
  assert.equal(host.app.rematch(), true);
  guest.transports[0].setMuted(false);
  assert.equal(host.app.getScreen(), GAME);
  assert.equal(guest.app.getScreen(), GAME_OVER, 'the guest ignores new-game once the host is gone');
  assert.equal(guest.app.getView().gameOver.rematch.disabled, true);
  const joins = guest.transports[0].sent.filter((message) => message.type === 'join').length;
  clock.advance(LEAVE_COUNTDOWN_S * 1000 + PEER_TIMEOUT_MS * 2);
  assert.equal(guest.transports[0].sent.filter((message) => message.type === 'join').length, joins, 'no resync to the later round');
  assert.equal(guest.app.getScreen(), GAME_OVER);
  assert.equal(guest.app.getView().gameOver.rematch.state, 'gone');
  // The host's forfeit result of the later round never replaces the
  // finished game's winner on the guest.
  assert.equal(guest.app.getGame().getOutcome().reason, 'five', 'no forfeit result of the later round');
  assert.equal(guest.app.getGame().getView().state.winner, guestWinner);
  assert.equal(guest.app.getView().gameOver.headline, guestCard.headline);
  assert.equal(guest.app.getView().gameOver.subline, guestCard.subline);
  // The host hears the guest gave up: the leave rules of playing apply.
  assert.equal(host.app.getView().gameOver.subline, 'Opponent left');
  assert.equal(host.app.getView().gameOver.rematch.disabled, true);
});

// --- The app: local ---

// The local character select: Player 1 picks Wind Rabbit first (X), Player
// 2 Earth Bear (O), and both press Ready.
function pickLocal(app) {
  assert.equal(app.pick(WIND_RABBIT, 'player1'), true);
  assert.equal(app.pick(EARTH_BEAR, 'player2'), true);
  assert.equal(app.ready('player1'), true);
  assert.equal(app.getGame(), null, 'no game before both are Ready');
  assert.equal(app.ready('player2'), true);
}

test('local mode: game over card, Rematch starts a clean game at once, Back to Menu returns to the menu', () => {
  const clock = createFakeClock();
  const app = createApp({ openTransport: () => assert.fail('local mode opens no transport'), clock, local: true });
  pickLocal(app);
  assert.equal(app.getScreen(), GAME);
  const game = app.getGame();
  assert.equal(game.clickSkill(X, WIND_DASH), true); // a skill of the old game
  game.cancel();
  for (let i = 0; i < 4; i++) {
    assert.equal(game.click({ x: i, y: 0 }), true);
    assert.equal(game.click({ x: i, y: 1 }), true);
  }
  assert.equal(game.click({ x: 4, y: 0 }), true);
  assert.equal(app.getView().gameOver, null, 'the final move shows first');
  clock.advance(GAME_OVER_DELAY_MS);
  assert.equal(app.getScreen(), GAME_OVER);
  const card = app.getView().gameOver;
  assert.equal(card.headline, 'Wind Rabbit wins');
  assert.deepEqual(card.rematch, rematchViewModel({ mode: MODES.LOCAL }));

  const number = app.getGameNumber();
  assert.equal(app.rematch(), true);
  assert.equal(app.getScreen(), GAME);
  assert.equal(app.getView().gameOver, null);
  assert.equal(app.getGameNumber(), number + 1);
  assert.deepEqual(app.getGame().getState(), newGame(), 'the same characters on the same sides');
  assert.deepEqual(app.getGame().takeEvents(), []);
  clock.advance(GAME_OVER_DELAY_MS * 2);
  assert.equal(app.getScreen(), GAME, 'no stale game over timer');

  // Win again, then Back to Menu.
  for (let i = 0; i < 4; i++) {
    app.getGame().click({ x: i, y: 0 });
    app.getGame().click({ x: i, y: 1 });
  }
  app.getGame().click({ x: 4, y: 0 });
  clock.advance(GAME_OVER_DELAY_MS);
  assert.equal(app.backToMenu(), true);
  assert.equal(app.getScreen(), MENU);
  assert.equal(app.getGame(), null);
  assert.equal(clock.pending, 0);
});

test('local mode: R (restartLocal) during a game starts a clean game and tells the page', () => {
  const app = createApp({ openTransport: () => null, clock: createFakeClock(), local: true });
  assert.equal(app.restartLocal(), false, 'nothing to restart on the character select');
  pickLocal(app);
  app.getGame().click({ x: 7, y: 7 });
  const number = app.getGameNumber();
  assert.equal(app.restartLocal(), true);
  assert.equal(app.getGameNumber(), number + 1);
  assert.deepEqual(app.getGame().getState(), newGame());
});

// --- watchNewGame (main.js calls the renderer reset through it) ---

test('watchNewGame: reset once per new game, rematch or leave, never on an ordinary frame', () => {
  let resets = 0;
  const watch = watchNewGame(() => resets++);
  assert.equal(watch.check(null, 0), false, 'the menu with no game before');
  const a = {};
  assert.equal(watch.check(a, 1), true, 'a game starts');
  for (let i = 0; i < 5; i++) assert.equal(watch.check(a, 1), false, 'ordinary frames');
  assert.equal(watch.check(a, 2), true, 'a rematch on the same controller');
  assert.equal(watch.check(null, 2), true, 'back to the menu');
  assert.equal(watch.check(null, 2), false);
  assert.equal(watch.check({}, 3), true, 'another game');
  assert.equal(resets, 4);
});

// --- Markup, style and shot scenes ---

test('index.html: the game over card, its two buttons with data-hud-box names and the hint in an aria-live region', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-screen="gameOver" data-hud-box="gameover-card"/);
  assert.match(html, /id="over-rematch"[^>]*data-action="rematch"[^>]*data-hud-box="gameover-rematch"/);
  assert.match(html, /id="over-menu"[^>]*data-action="backToMenu"[^>]*data-hud-box="gameover-menu"/);
  assert.match(html, /id="over-hint" aria-live="polite"/);
});

test('room.css: the card sits 96 px from the top, at most 480 px wide, buttons at least 44 px high', () => {
  const css = readFileSync(new URL('../src/ui/room.css', import.meta.url), 'utf8');
  assert.match(css, /#screens\.over \{\s*padding-top: 96px;/);
  assert.match(css, /max-width: 480px;/);
  assert.match(css, /\.over-actions button \{[^}]*min-height: 44px;/);
});

test('the gameover shot scenes: Wind Rabbit wins for the online viewer, Rematch idle or mine', () => {
  assert.ok(SHOT_SCENES.includes('gameover') && SHOT_SCENES.includes('gameover-pending'));
  const idle = shotGameOverView('gameover');
  assert.equal(idle.screen, GAME_OVER);
  assert.equal(idle.gameOver.headline, 'You win');
  assert.equal(idle.gameOver.subline, 'Wind Rabbit won');
  assert.equal(idle.gameOver.rematch.state, 'idle');
  assert.equal(shotGameOverView('gameover-pending').gameOver.rematch.state, 'mine');
  assert.equal(shotGameOverView('field'), null);
  assert.equal(shotGameOverView('menu'), null);
});
