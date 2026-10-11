import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME_OVER_DELAY_MS, HEARTBEAT_INTERVAL_MS, JOIN_TIMEOUT_MS, LEAVE_COUNTDOWN_S, PEER_TIMEOUT_MS } from '../src/config.js';
import { X, O, ROCK, EMPTY } from '../src/logic/board.js';
import { EARTH_BEAR, JADE_SERPENT, WIND_RABBIT } from '../src/logic/characters.js';
import { createInitialState } from '../src/logic/game.js';
import { WIND_DASH, TORNADO_ZONE, MUD_TRAP, PETRIFICATION, HISS, VENOM } from '../src/logic/skills.js';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { BAD_CODE_ERROR, GAME, GAME_OVER, JOIN, LOBBY, MENU, WAITING_SCREEN, createApp } from '../src/ui/app.js';
import { gameOutcome, statusLine } from '../src/ui/online-game.js';
import { STRINGS } from '../src/ui/strings.js';
import { pickAndReady } from './room-start.js';

// Windows that share one fake network (one room) and one fake clock. Each
// window records the transports it opened.
function makeWorld({ random = () => 0 } = {}) {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const window = (options = {}) => {
    const transports = [];
    const app = createApp({
      openTransport: () => {
        const transport = network.connect();
        transports.push(transport);
        return transport;
      },
      clock,
      random,
      makeCode: () => 'AB2C9',
      ...options,
    });
    app.playOnline(); // the app starts on the menu
    let changes = 0;
    app.onChange(() => changes++);
    return { app, transports, get changes() { return changes; } };
  };
  return { network, clock, window };
}

// A host window that created a room and a guest window that joined it;
// the host picked `character`, the guest the other one, and both pressed
// Ready (both are in the game).
function startGame(character = WIND_RABBIT) {
  const world = makeWorld();
  const host = world.window();
  const guest = world.window();
  assert.equal(host.app.createRoom(), true);
  guest.app.openJoin();
  assert.equal(guest.app.joinRoom('AB2C9'), true);
  pickAndReady(host.app, guest.app, character);
  return { ...world, host, guest };
}

const status = (win) => win.app.getGame().getView().status;

// --- Lobby, Create Room, Waiting ---

test('Create Room on the lobby opens the room at once with the code and two empty seats; the pick is made inside', () => {
  const { window } = makeWorld();
  const host = window();
  assert.equal(host.app.getScreen(), LOBBY);
  assert.equal(host.app.createRoom(), true, 'no character is chosen in the lobby');
  assert.equal(host.app.getScreen(), WAITING_SCREEN);
  let view = host.app.getView();
  assert.equal(view.code, 'AB2C9');
  assert.equal(view.character, null);
  assert.deepEqual(view.waiting.cards.map((card) => card.character), [null, null], 'two empty seats');
  assert.equal(host.app.pick('nobody'), false);
  assert.equal(host.app.pick(EARTH_BEAR), true);
  view = host.app.getView();
  assert.equal(view.character, EARTH_BEAR);
  assert.equal(view.characterName, 'Earth Bear');
  assert.equal(view.waiting.cards[0].stone, X, 'the first pick plays X');
  assert.equal(host.transports.length, 1);
  assert.equal(host.app.getGame(), null);
  assert.equal(host.app.createRoom(), false, 'a room is only made from the lobby');
});

test('Back from Join returns to the lobby, and Leave in the waiting room leaves the room for the menu', () => {
  const { window, clock } = makeWorld();
  const host = window();
  host.app.openJoin();
  host.app.backToLobby();
  assert.equal(host.app.getScreen(), LOBBY);
  host.app.createRoom();
  host.app.backToLobby();
  assert.equal(host.app.getScreen(), WAITING_SCREEN, 'the waiting room has Leave, not Back');
  assert.equal(host.app.leaveRoom(), true);
  assert.equal(host.app.getScreen(), MENU);
  assert.equal(host.transports[0].closed, true);
  assert.equal(host.app.getView().code, null);

  // Nobody hosts the room any more, so a joiner finds nothing.
  const guest = window();
  guest.app.openJoin();
  guest.app.joinRoom('AB2C9');
  clock.advance(JOIN_TIMEOUT_MS);
  assert.equal(guest.app.getView().joinError, 'No room found with code AB2C9.');
});

// --- Join Room ---

test('Join Room checks the code before looking for the room', () => {
  const { window } = makeWorld();
  const guest = window();
  guest.app.openJoin();
  assert.equal(guest.app.getScreen(), JOIN);
  assert.equal(guest.app.joinRoom('   '), false);
  assert.equal(guest.app.getView().joinError, 'Enter a room code.');
  for (const bad of ['AB2C', 'AB0C9', 'ABOC9', 'AB1C9', 'ABIC9', 'AB-C9']) {
    assert.equal(guest.app.joinRoom(bad), false, bad);
    assert.equal(guest.app.getView().joinError, BAD_CODE_ERROR, bad);
  }
  assert.equal(guest.transports.length, 0, 'no room was looked for');
  assert.equal(guest.app.getScreen(), JOIN);
});

test('joining a room nobody hosts shows an error after the join timeout', () => {
  const { window, clock } = makeWorld();
  const guest = window();
  guest.app.openJoin();
  assert.equal(guest.app.joinRoom('zz zzz'), true);
  assert.equal(guest.app.getView().joining, true);
  assert.equal(guest.app.getView().joiningCode, 'ZZZZZ');
  assert.equal(guest.app.joinRoom('ZZZZZ'), false, 'one join at a time');
  clock.advance(JOIN_TIMEOUT_MS);
  const view = guest.app.getView();
  assert.equal(view.screen, JOIN);
  assert.equal(view.joining, false);
  assert.equal(view.joinError, 'No room found with code ZZZZZ.');
  assert.equal(guest.transports[0].closed, true);
  assert.equal(clock.pending, 0);
});

test('joining a full room shows an error and the two players keep playing', () => {
  const { window, host, guest } = startGame();
  const third = window();
  third.app.openJoin();
  third.app.joinRoom('AB2C9');
  assert.equal(third.app.getScreen(), JOIN);
  assert.equal(third.app.getView().joinError, 'Room AB2C9 is full.');
  assert.equal(third.app.getView().joining, false);
  assert.equal(third.transports[0].closed, true);
  assert.equal(host.app.getScreen(), GAME);
  assert.equal(guest.app.getScreen(), GAME);
});

test('a typed code is cleaned up, and the joiner who picks first plays X', () => {
  const { window } = makeWorld();
  const host = window();
  host.app.createRoom();
  const guest = window();
  guest.app.openJoin();
  assert.equal(guest.app.joinRoom(' ab2 c9 '), true);
  pickAndReady(host.app, guest.app, EARTH_BEAR); // the guest picks Wind Rabbit first
  assert.equal(host.app.getScreen(), GAME);
  assert.equal(guest.app.getScreen(), GAME);
  assert.equal(guest.app.getView().character, WIND_RABBIT);
  assert.equal(guest.app.getGame().getView().you, X);
  assert.equal(host.app.getGame().getView().you, O);
  assert.ok(guest.changes > 0 && host.changes > 0, 'the screens were told to update');
});

// --- Game screen ---

test('each window plays only its own side: turns, stones and skills', () => {
  const { host, guest } = startGame(WIND_RABBIT); // host X, guest O
  const hostGame = host.app.getGame();
  const guestGame = guest.app.getGame();
  assert.equal(status(host), 'Your turn');
  assert.equal(status(guest), "Opponent's turn");

  assert.equal(guestGame.click({ x: 7, y: 7 }), false);
  assert.equal(guestGame.getView().message, "It is your opponent's turn.");
  assert.equal(guestGame.clickSkill(O, MUD_TRAP), false);
  assert.equal(guestGame.getView().message, "It is your opponent's turn.");
  assert.equal(hostGame.clickSkill(O, MUD_TRAP), false);
  assert.equal(hostGame.getView().message, "That is your opponent's skill.");

  const view = hostGame.getView();
  assert.deepEqual(view.panels.map((p) => p.you), [true, false], 'the You tag is on the local panel');

  assert.equal(hostGame.click({ x: 7, y: 7 }), true);
  assert.equal(guest.app.getGame().getView().state.board[7][7], X);
  assert.equal(status(host), "Opponent's turn");
  assert.equal(status(guest), 'Your turn');
  assert.equal(guestGame.click({ x: 7, y: 7 }), true, 'sent; the host checks it');
  assert.equal(guestGame.getView().message, 'That cell is not empty.', 'the host rejected a taken cell');
  assert.equal(guestGame.click({ x: 8, y: 7 }), true, 'the guest can try again');
  assert.equal(host.app.getGame().getView().state.board[7][8], O);
});

test('the guest waits for the host after sending an action', () => {
  const { clock, host, guest } = startGame(EARTH_BEAR); // guest X moves first
  const guestGame = guest.app.getGame();
  host.transports[0].setMuted(true); // the host's answer is lost
  assert.equal(guestGame.click({ x: 7, y: 7 }), true);
  assert.equal(guestGame.click({ x: 8, y: 7 }), false);
  assert.equal(guestGame.getView().message, 'Waiting for the host...');
  host.transports[0].setMuted(false);
  clock.advance(HEARTBEAT_INTERVAL_MS); // the host's ping shows a newer state and the guest resyncs
  assert.equal(guestGame.getView().state.board[7][7], X);
  assert.equal(status(guest), "Opponent's turn");
});

test('a lost guest action does not stall the game: it is sent again and the guest can keep playing', () => {
  const { clock, host, guest } = startGame(EARTH_BEAR); // guest X moves first
  const guestGame = guest.app.getGame();
  guest.transports[0].setMuted(true); // the action request is lost
  assert.equal(guestGame.click({ x: 7, y: 7 }), true);
  guest.transports[0].setMuted(false);
  assert.equal(guestGame.click({ x: 8, y: 7 }), false);
  assert.equal(guestGame.getView().message, 'Waiting for the host...');
  clock.advance(HEARTBEAT_INTERVAL_MS);
  assert.equal(host.app.getGame().getView().state.board[7][7], X);
  assert.equal(status(guest), "Opponent's turn");
  assert.equal(host.app.getGame().click({ x: 8, y: 8 }), true);
  assert.equal(guestGame.click({ x: 6, y: 6 }), true);
  assert.equal(host.app.getGame().getView().state.board[6][6], X);

  host.transports[0].setMuted(true); // the rejection of a taken cell is lost
  assert.equal(guestGame.click({ x: 7, y: 7 }), false, 'not the guest turn');
  host.app.getGame().click({ x: 9, y: 9 });
  assert.equal(guestGame.click({ x: 9, y: 9 }), false, 'the host move was lost too');
  host.transports[0].setMuted(false);
  clock.advance(HEARTBEAT_INTERVAL_MS);
  assert.equal(status(guest), 'Your turn');
  assert.equal(guestGame.click({ x: 9, y: 9 }), true, 'sent; the host checks it');
  assert.equal(guestGame.getView().message, 'That cell is not empty.');
  host.transports[0].setMuted(true);
  assert.equal(guestGame.click({ x: 5, y: 5 }), true);
  assert.equal(guestGame.click({ x: 4, y: 4 }), false);
  host.transports[0].setMuted(false);
  clock.advance(HEARTBEAT_INTERVAL_MS);
  assert.equal(guestGame.getView().state.board[5][5], X);
  assert.equal(status(guest), "Opponent's turn");
});

test('online: a guest playing Jade Serpent uses Hiss and Venom through the host', () => {
  const world = makeWorld();
  const host = world.window();
  const guest = world.window();
  host.app.createRoom();
  guest.app.openJoin();
  guest.app.joinRoom('AB2C9');
  pickAndReady(host.app, guest.app, WIND_RABBIT, JADE_SERPENT, false); // the guest picks first: X
  const serpent = guest.app.getGame();
  const rabbit = host.app.getGame();
  const state = () => host.app.getGame().getView().state;

  assert.equal(serpent.click({ x: 7, y: 7 }), true); // X
  assert.equal(rabbit.click({ x: 8, y: 8 }), true); // O
  assert.equal(serpent.clickSkill(X, HISS), true);
  assert.equal(serpent.getTargeting(), null);
  assert.equal(state().skillLock?.player, O);
  // A skill does not end the turn: the serpent is still to move and plants.
  assert.equal(state().currentPlayer, X);
  assert.equal(serpent.getView().status, STRINGS.plantToEndTurn);
  assert.equal(serpent.clickSkill(X, VENOM), false, 'one skill per turn');
  assert.equal(serpent.getView().message, STRINGS.skillAlreadyUsedError);
  assert.equal(rabbit.clickSkill(O, WIND_DASH), false);
  assert.equal(rabbit.getView().message, "It is your opponent's turn.");
  assert.equal(serpent.click({ x: 0, y: 14 }), true); // X plants, which ends the turn
  assert.equal(rabbit.clickSkill(O, WIND_DASH), false);
  assert.equal(rabbit.getView().message, 'Hiss: you cannot use a skill this turn.');
  assert.equal(rabbit.click({ x: 0, y: 0 }), true); // O
  assert.equal(serpent.clickSkill(X, VENOM), true);
  assert.equal(serpent.click({ x: 8, y: 8 }), true);
  assert.equal(state().board[8][8], O, 'Venom keeps the plant on the board');
  assert.equal(state().poison.cells.length, 9, 'the poison zone reaches the other window');
  assert.equal(rabbit.getView().state.poison.cells.length, 9);
  assert.equal(state().currentPlayer, X, 'Venom does not end the turn either');
  assert.equal(serpent.click({ x: 1, y: 14 }), true);
  assert.equal(state().currentPlayer, O);
  assert.deepEqual(serpent.getView().state, rabbit.getView().state);
});

test('a full game between two windows with all four skills ends on the Game over screen', () => {
  // Host plays Earth Bear (O), the guest plays Wind Rabbit (X) and moves first.
  const { clock, host, guest } = startGame(EARTH_BEAR);
  const bear = host.app.getGame();
  const rabbit = guest.app.getGame();
  const board = () => host.app.getGame().getView().state.board;
  const same = () => assert.deepEqual(rabbit.getView().state, bear.getView().state);

  assert.equal(rabbit.click({ x: 7, y: 7 }), true); // turn 1
  assert.equal(bear.click({ x: 0, y: 0 }), true); // turn 2
  assert.equal(rabbit.click({ x: 8, y: 7 }), true); // turn 3

  // Turn 4: Mud Trap, then a planting (a skill does not end the turn).
  assert.equal(bear.clickSkill(O, MUD_TRAP), true);
  assert.equal(status(host), 'Mud Trap: choose an empty cell');
  assert.equal(bear.click({ x: 9, y: 7 }), true);
  assert.equal(board()[7][9], EMPTY, 'a puddle is no stone');
  assert.deepEqual(rabbit.getView().state.mud.map(({ x, y }) => [x, y]), [[9, 7]], 'both windows see the puddle');
  assert.equal(rabbit.getView().message, 'Mud Trap! A mud puddle.');
  assert.equal(bear.click({ x: 3, y: 0 }), true, 'the bear plants, which ends the turn');
  same();

  // Turn 5: the rabbit plants into the puddle: the seed is sunk, in both windows.
  assert.equal(rabbit.click({ x: 9, y: 7 }), true);
  assert.equal(board()[7][9], X);
  assert.deepEqual(bear.getView().state.sunk.map(({ x, y, player }) => [x, y, player]), [[9, 7, X]]);
  assert.equal(bear.getView().message, 'The seed sank in the mud.');
  same();

  // Turn 6: Petrification turns a rabbit plant to stone; the sunk seed cannot be picked.
  assert.equal(bear.clickSkill(O, PETRIFICATION), true);
  assert.equal(bear.click({ x: 9, y: 7 }), false);
  assert.equal(bear.getView().message, 'That plant is sunk in mud.');
  assert.equal(bear.click({ x: 8, y: 7 }), true);
  assert.equal(board()[7][8], ROCK);
  assert.deepEqual(rabbit.getView().state.rocks, [{ x: 8, y: 7 }], 'the rock is permanent');
  assert.equal(bear.click({ x: 5, y: 0 }), true);
  assert.deepEqual(rabbit.getView().state.sunk, [], 'the seed surfaced at the end of the bear turn');
  same();

  // Turn 7: Tornado Zone, the guest's skill flow runs through the host.
  assert.equal(rabbit.clickSkill(X, TORNADO_ZONE), true);
  assert.equal(rabbit.click({ x: 5, y: 5 }), true);
  assert.equal(rabbit.click({ x: 12, y: 12 }), true);
  assert.equal(rabbit.getView().state.tornado.cells.length, 5, 'the rabbit sees its cross');
  assert.deepEqual(Object.keys(bear.getView().state.tornado).sort(), ['endsAfterTurn', 'hidden', 'player'], 'the bear never sees where');

  // Turn 8: the bear plants on the cross: the trap fires and the host throws the seed to a random plot of the field.
  assert.equal(bear.click({ x: 5, y: 5 }), true);
  assert.equal(board()[5][5], EMPTY);
  assert.equal(rabbit.getView().state.tornado, null);
  assert.equal(board()[7][9], X, 'the surfaced seed stays');
  assert.equal(board()[7][8], ROCK, 'a rock never breaks');
  same();

  // Turn 9: Wind Dash, resolved after the bear's turn 10.
  assert.equal(rabbit.clickSkill(X, WIND_DASH), true);
  assert.equal(rabbit.click({ x: 7, y: 7 }), false); // choose the stone
  assert.equal(rabbit.click({ x: 7, y: 10 }), true); // choose the target
  assert.equal(rabbit.click({ x: 13, y: 12 }), true); // plant, which ends the turn
  assert.deepEqual(bear.getView().state.pendingDash.to, { x: 7, y: 10 });
  assert.equal(bear.click({ x: 1, y: 1 }), true); // turn 10
  assert.equal(board()[7][7], EMPTY);
  assert.equal(board()[10][7], X);
  same();

  // The rabbit makes five in a row on row 3; the bear plays far away.
  const bearMoves = [[0, 14], [2, 14], [4, 14], [6, 14]];
  for (let x = 10; x <= 14; x++) {
    assert.equal(rabbit.click({ x, y: 3 }), true, `rabbit ${x}`);
    if (x < 14) assert.equal(bear.click({ x: bearMoves[x - 10][0], y: bearMoves[x - 10][1] }), true);
  }
  same();
  assert.equal(status(guest), 'You win!');
  assert.equal(status(host), 'You lose.');
  assert.equal(host.app.getScreen(), GAME, 'the final board stays visible for a moment');

  clock.advance(GAME_OVER_DELAY_MS);
  assert.equal(host.app.getScreen(), GAME_OVER);
  assert.equal(guest.app.getScreen(), GAME_OVER);
  assert.equal(guest.app.getView().outcome.title, 'You win!');
  assert.equal(host.app.getView().outcome.title, 'You lose.');
  assert.equal(host.app.getView().outcome.detail, 'Wind Rabbit made five in a row.');

  // Back to Menu leaves the room; the other window stays on Game over.
  guest.app.backToMenu();
  assert.equal(guest.app.getScreen(), MENU);
  assert.equal(guest.app.getGame(), null);
  assert.equal(guest.transports[0].closed, true);
  clock.advance(LEAVE_COUNTDOWN_S * 1000 + PEER_TIMEOUT_MS);
  assert.equal(host.app.getScreen(), GAME_OVER);
  assert.equal(host.app.getView().outcome.title, 'You lose.', 'leaving after the end does not change the result');
  assert.equal(host.app.getView().gameOver.rematch.hint, 'Opponent left');
  host.app.backToMenu();
  assert.equal(clock.pending, 0, 'every timer stopped');
});

// --- Leaving ---

test('when the opponent closes the window the countdown shows, then "opponent left, you win"', () => {
  const { clock, host, guest } = startGame(WIND_RABBIT);
  host.app.getGame().click({ x: 7, y: 7 });
  guest.app.close(); // the page closed
  assert.equal(status(host), 'Opponent left. You win in 10');
  assert.equal(host.app.getGame().getView().peerCountdown, 10);
  clock.advance(1000);
  assert.equal(status(host), 'Opponent left. You win in 9');
  clock.advance((LEAVE_COUNTDOWN_S - 2) * 1000);
  assert.equal(status(host), 'Opponent left. You win in 1');
  assert.equal(host.app.getScreen(), GAME);
  clock.advance(1000);
  assert.equal(host.app.getScreen(), GAME_OVER, 'no extra delay after a leave');
  const { outcome } = host.app.getView();
  assert.equal(outcome.title, 'Opponent left, you win!');
  assert.equal(outcome.reason, 'opponentLeft');
  assert.equal(outcome.youWin, true);
  assert.equal(host.app.getGame().getView().marker, X);
});

test('silence starts the countdown and hearing the opponent again cancels it', () => {
  const { clock, host, guest } = startGame(WIND_RABBIT);
  guest.transports[0].setMuted(true);
  clock.advance(PEER_TIMEOUT_MS);
  assert.equal(status(host), 'Opponent left. You win in 10');
  clock.advance(4000);
  assert.equal(status(host), 'Opponent left. You win in 6');
  guest.transports[0].setMuted(false);
  clock.advance(HEARTBEAT_INTERVAL_MS);
  assert.equal(status(host), 'Your turn');
  clock.advance(60000);
  assert.equal(host.app.getScreen(), GAME);
});

test('a skill prompt still shows under the countdown', () => {
  const { host, guest } = startGame(WIND_RABBIT);
  const game = host.app.getGame();
  game.click({ x: 7, y: 7 });
  guest.app.getGame().click({ x: 0, y: 0 });
  game.clickSkill(X, WIND_DASH);
  guest.app.close();
  const view = game.getView();
  assert.equal(view.status, 'Opponent left. You win in 10');
  assert.equal(view.message, 'Wind Dash: choose one of your stones');
});

test('the Game over screen shows the host result when both sides counted down at once', () => {
  const { clock, host, guest } = startGame(EARTH_BEAR); // host O, guest X
  host.transports[0].setMuted(true);
  guest.transports[0].setMuted(true);
  clock.advance(PEER_TIMEOUT_MS + LEAVE_COUNTDOWN_S * 1000);
  assert.equal(guest.app.getScreen(), GAME_OVER);
  assert.equal(guest.app.getView().outcome.title, 'Opponent left, you win!');
  const changes = guest.changes;
  host.transports[0].setMuted(false);
  guest.transports[0].setMuted(false);
  clock.advance(HEARTBEAT_INTERVAL_MS);
  assert.ok(guest.changes > changes, 'the Game over screen is told to update');
  const { outcome } = guest.app.getView();
  assert.equal(outcome.winner, O);
  assert.equal(outcome.youWin, false);
  assert.equal(outcome.title, 'You left, you lose.');
  assert.equal(host.app.getView().outcome.title, 'Opponent left, you win!');
});

test('the Game over screen drops a leave win when the game had already ended on the board', () => {
  const { clock, host, guest } = startGame(WIND_RABBIT); // host X, guest O
  for (let i = 0; i < 4; i++) {
    host.app.getGame().click({ x: i, y: 0 });
    guest.app.getGame().click({ x: i, y: 1 });
  }
  host.transports[0].setMuted(true);
  host.app.getGame().click({ x: 4, y: 0 }); // the winning move never reaches the guest
  clock.advance(PEER_TIMEOUT_MS + LEAVE_COUNTDOWN_S * 1000);
  assert.equal(guest.app.getScreen(), GAME_OVER);
  assert.equal(guest.app.getView().outcome.title, 'Opponent left, you win!');
  const changes = guest.changes;
  host.transports[0].setMuted(false);
  clock.advance(HEARTBEAT_INTERVAL_MS);
  assert.ok(guest.changes > changes, 'the Game over screen is told to update');
  const { outcome } = guest.app.getView();
  assert.equal(outcome.reason, 'five');
  assert.equal(outcome.winner, X);
  assert.equal(outcome.title, 'You lose.');
  assert.equal(guest.app.getGame().getView().marker, X);
});

// --- Status and outcome text ---

test('statusLine and gameOutcome', () => {
  const state = createInitialState();
  assert.equal(statusLine({ state, you: X, yourTurn: true }), 'Your turn');
  assert.equal(statusLine({ state, you: O, yourTurn: false }), "Opponent's turn");
  assert.equal(statusLine({ state, you: X, yourTurn: true, targeting: { skill: TORNADO_ZONE, from: null } }), 'Tornado Zone: choose the trap centre');
  assert.equal(statusLine({ state, you: X, yourTurn: true, peerCountdown: 3 }), 'Opponent left. You win in 3');
  assert.equal(gameOutcome(state, X), null);

  const left = gameOutcome(state, O, { winner: O, reason: 'opponentLeft' });
  assert.equal(left.title, 'Opponent left, you win!');
  const cut = gameOutcome(state, X, { winner: O, reason: 'opponentLeft' });
  assert.equal(cut.youWin, false);
  assert.equal(cut.title, 'You left, you lose.');

  const won = { ...state, winner: O };
  assert.equal(gameOutcome(won, O).title, 'You win!');
  assert.equal(gameOutcome(won, X).title, 'You lose.');
  assert.equal(gameOutcome(won, X).detail, 'Earth Bear made five in a row.');
  assert.equal(gameOutcome({ ...state, draw: true }, X).title, 'Draw!');
  assert.equal(statusLine({ state: won, you: O, peerCountdown: 5 }), 'You win!', 'the result beats the countdown');
});
