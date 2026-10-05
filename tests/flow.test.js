import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLOW_EVENTS, LOCAL_SEATS, MODES, NOTICE_HOST_LEFT, NOTICE_ROOM_CLOSED, OVERLAYS, ROLES, SCREENS, flowReducer, initialFlow, isSelecting,
  isSpectating, screenOf,
} from '../src/ui/flow.js';
import { EARTH_BEAR, WIND_RABBIT } from '../src/logic/characters.js';

const E = FLOW_EVENTS;
const state = (screen, overlay, mode, role, notice = null, seats = null) => Object.freeze({ screen, overlay, mode, role, notice, seats });

// The seats of the local character select, written out: Player 1's and
// Player 2's pick and Ready, and the pick order (the first plays X).
const [P1, P2] = ['player1', 'player2'];
const R = WIND_RABBIT;
const B = EARTH_BEAR;
const seats = (pick1, pick2, ready1, ready2, order) => ({
  names: [P1, P2], picks: { [P1]: pick1, [P2]: pick2 }, ready: { [P1]: ready1, [P2]: ready2 }, order,
});
const EMPTY = seats(null, null, false, false, []);
const ONE = seats(R, null, false, false, [P1]);
const BOTH = seats(R, B, false, false, [P1, P2]);
const ONE_READY = seats(R, B, true, false, [P1, P2]);
const ALL_READY = seats(R, B, true, true, [P1, P2]);
const local = (screen, s) => state(screen, 'none', 'local', null, null, s);

// Every screen and overlay state: the menu with each overlay, every other
// screen in the modes and roles it can be in, and the local game screen
// in each step of its character select. The notice is set where it may
// be, so the table shows which events clear it.
const STATES = {
  'menu': state('menu', 'none', null, null),
  'menu+howto': state('menu', 'howto', null, null),
  'menu+settings': state('menu', 'settings', null, null),
  'lobby': state('lobby', 'none', 'online', null, NOTICE_HOST_LEFT),
  'waiting': state('waiting', 'none', 'online', 'host'),
  'starting/host': state('starting', 'none', 'online', 'host'),
  'starting/guest': state('starting', 'none', 'online', 'guest'),
  'game/online': state('game', 'none', 'online', 'guest'),
  'select/empty': local('game', EMPTY),
  'select/one': local('game', ONE),
  'select/both': local('game', BOTH),
  'select/one-ready': local('game', ONE_READY),
  'game/local': local('game', ALL_READY),
  'gameover/online': state('gameover', 'none', 'online', 'host'),
  'gameover/local': local('gameover', ALL_READY),
  // Watch a match: the spectator's screens (sections 3.8 and 3.9).
  'spectate': state('spectate', 'none', 'online', 'spectator'),
  'spectate-waiting': state('spectate-waiting', 'none', 'online', 'spectator'),
  'spectate-game': state('spectate-game', 'none', 'online', 'spectator'),
  'room-closed': state('room-closed', 'none', 'online', 'spectator', NOTICE_ROOM_CLOSED),
};

// The events: every event of FLOW_EVENTS as a bare name, and PICK and
// READY also with their payloads.
const EVENTS = {
  ...Object.fromEntries([...Object.values(E), 'NOT_AN_EVENT'].map((name) => [name, name])),
  'PICK 1 rabbit': { type: E.PICK, seat: P1, character: R },
  'PICK 1 bear': { type: E.PICK, seat: P1, character: B },
  'PICK 2 rabbit': { type: E.PICK, seat: P2, character: R },
  'PICK 2 bear': { type: E.PICK, seat: P2, character: B },
  'PICK 1 nobody': { type: E.PICK, seat: P1, character: 'nobody' },
  'PICK 3 rabbit': { type: E.PICK, seat: 'player3', character: R },
  'READY 1': { type: E.READY, seat: P1 },
  'READY 2': { type: E.READY, seat: P2 },
  'READY 3': { type: E.READY, seat: 'player3' },
};

const MENU = state('menu', 'none', null, null);

// docs/flow-design.md section 4, written out in full: the result of each
// allowed event, by state. Every pair missing here must return the same
// object.
const ALLOWED = {
  'menu': {
    PLAY_ONLINE: state('lobby', 'none', 'online', null),
    PLAY_LOCAL: local('game', EMPTY),
    OPEN_HOWTO: state('menu', 'howto', null, null),
    OPEN_SETTINGS: state('menu', 'settings', null, null),
    WATCH: state('spectate', 'none', 'online', 'spectator'),
  },
  'menu+howto': {
    CLOSE_OVERLAY: MENU,
    BACK: MENU,
  },
  'menu+settings': {
    CLOSE_OVERLAY: MENU,
    BACK: MENU,
  },
  'lobby': {
    BACK: MENU,
    ROOM_CREATED: state('waiting', 'none', 'online', 'host'),
    JOINED: state('starting', 'none', 'online', 'guest'),
  },
  'waiting': {
    OPPONENT_JOINED: state('starting', 'none', 'online', 'host'),
    LEAVE: MENU,
  },
  'starting/host': {
    START: state('game', 'none', 'online', 'host'),
    OPPONENT_LEFT: state('waiting', 'none', 'online', 'host'),
    LEAVE: MENU,
  },
  'starting/guest': {
    START: state('game', 'none', 'online', 'guest'),
    OPPONENT_LEFT: state('lobby', 'none', 'online', null, NOTICE_HOST_LEFT),
    LEAVE: MENU,
  },
  'game/online': { GAME_OVER: state('gameover', 'none', 'online', 'guest') },
  'select/empty': {
    'PICK 1 rabbit': local('game', ONE),
    'PICK 1 bear': local('game', seats(B, null, false, false, [P1])),
    'PICK 2 rabbit': local('game', seats(null, R, false, false, [P2])),
    'PICK 2 bear': local('game', seats(null, B, false, false, [P2])),
    LEAVE: MENU,
  },
  'select/one': {
    'PICK 1 bear': local('game', seats(B, null, false, false, [P1])),
    'PICK 2 bear': local('game', BOTH),
    'READY 1': local('game', seats(R, null, true, false, [P1])),
    LEAVE: MENU,
  },
  'select/both': {
    'READY 1': local('game', ONE_READY),
    'READY 2': local('game', seats(R, B, false, true, [P1, P2])),
    LEAVE: MENU,
  },
  'select/one-ready': {
    'READY 2': local('game', ALL_READY),
    LEAVE: MENU,
  },
  'game/local': { GAME_OVER: local('gameover', ALL_READY) },
  'gameover/online': {
    LEAVE: MENU,
    REMATCH_STARTED: state('game', 'none', 'online', 'host'),
  },
  'gameover/local': {
    LEAVE: MENU,
    REMATCH_STARTED: local('game', ALL_READY),
  },
  'spectate': {
    BACK: MENU,
    SPECTATOR_JOINED: state('spectate-waiting', 'none', 'online', 'spectator'),
  },
  'spectate-waiting': {
    START: state('spectate-game', 'none', 'online', 'spectator'),
    ROOM_CLOSED: state('room-closed', 'none', 'online', 'spectator', NOTICE_ROOM_CLOSED),
    LEAVE: MENU,
  },
  'spectate-game': {
    ROOM_CLOSED: state('room-closed', 'none', 'online', 'spectator', NOTICE_ROOM_CLOSED),
    LEAVE: MENU,
  },
  'room-closed': { LEAVE: MENU },
};

test('the table names every screen, overlay and event of section 4', () => {
  assert.deepEqual(Object.values(SCREENS), [
    'menu', 'lobby', 'waiting', 'starting', 'game', 'gameover', 'spectate', 'spectate-waiting', 'spectate-game', 'room-closed',
  ]);
  assert.deepEqual(Object.values(OVERLAYS), ['none', 'howto', 'settings']);
  assert.deepEqual(Object.values(MODES), ['online', 'local']);
  assert.deepEqual(Object.values(ROLES), ['host', 'guest', 'spectator']);
  assert.deepEqual([...LOCAL_SEATS], [P1, P2]);
  assert.deepEqual(Object.values(E).sort(), [
    'BACK', 'CLOSE_OVERLAY', 'GAME_OVER', 'JOINED', 'LEAVE', 'OPEN_HOWTO', 'OPEN_SETTINGS', 'OPPONENT_JOINED',
    'OPPONENT_LEFT', 'PICK', 'PLAY_LOCAL', 'PLAY_ONLINE', 'READY', 'REMATCH_STARTED', 'ROOM_CLOSED', 'ROOM_CREATED',
    'SPECTATOR_JOINED', 'START', 'WATCH',
  ]);
  // Every screen of SCREENS has a state in the table.
  for (const screen of Object.values(SCREENS)) assert.ok(Object.values(STATES).some((flow) => flow.screen === screen), screen);
  for (const [name, events] of Object.entries(ALLOWED)) {
    assert.ok(STATES[name], name);
    for (const event of Object.keys(events)) assert.ok(EVENTS[event], `${name}: ${event}`);
  }
});

test('flowReducer: every state times every event gives exactly the table result', () => {
  let allowed = 0;
  for (const [name, flow] of Object.entries(STATES)) {
    for (const [eventName, event] of Object.entries(EVENTS)) {
      const expected = ALLOWED[name]?.[eventName];
      const forms = typeof event === 'string' ? [event, { type: event }] : [event];
      for (const form of forms) {
        const result = flowReducer(flow, form);
        const label = `${name} + ${eventName}`;
        if (expected) {
          assert.notEqual(result, flow, `${label} makes a new object`);
          assert.deepEqual(result, expected, label);
          assert.ok(Object.isFrozen(result), `${label} is frozen`);
          if (result.seats && result.seats !== flow.seats) assert.ok(Object.isFrozen(result.seats) && Object.isFrozen(result.seats.picks), `${label} new seats are frozen`);
        } else {
          assert.equal(result, flow, `${label} returns the same object`);
        }
      }
      if (expected) allowed++;
    }
  }
  assert.equal(allowed, 48);
  assert.equal(flowReducer(STATES.menu, null), STATES.menu);
  assert.equal(flowReducer(STATES.menu, {}), STATES.menu);
});

test('isSelecting: only the local game screen before both seats are Ready', () => {
  const selecting = Object.entries(STATES).filter(([, flow]) => isSelecting(flow)).map(([name]) => name);
  assert.deepEqual(selecting, ['select/empty', 'select/one', 'select/both', 'select/one-ready']);
});

test('isSpectating: only the spectator inside a room (waiting room or live game)', () => {
  const spectating = Object.entries(STATES).filter(([, flow]) => isSpectating(flow)).map(([name]) => name);
  assert.deepEqual(spectating, ['spectate-waiting', 'spectate-game']);
});

test('the spectate transitions: Watch a match, the waiting room, the live game, Room closed and back to the menu', () => {
  const walk = (events) => events.reduce(flowReducer, initialFlow());
  const watching = walk([E.WATCH, E.SPECTATOR_JOINED, E.START]);
  assert.deepEqual(watching, state('spectate-game', 'none', 'online', 'spectator'));
  // A spectator never reaches the players' screens: no game over, no
  // rematch, no pick or Ready, no opponent events.
  for (const event of [E.GAME_OVER, E.REMATCH_STARTED, E.OPPONENT_LEFT, E.OPPONENT_JOINED, E.JOINED, E.ROOM_CREATED,
    { type: E.PICK, seat: P1, character: R }, { type: E.READY, seat: P1 }]) {
    assert.equal(flowReducer(watching, event), watching, String(event.type ?? event));
  }
  const closed = flowReducer(watching, E.ROOM_CLOSED);
  assert.equal(closed.screen, SCREENS.ROOM_CLOSED);
  assert.equal(closed.notice, NOTICE_ROOM_CLOSED);
  assert.deepEqual(flowReducer(closed, E.LEAVE), MENU);
  // The connection refused on the code box changes no screen.
  assert.equal(flowReducer(walk([E.WATCH]), E.ROOM_CLOSED).screen, SCREENS.SPECTATE);
});

test('flowReducer never changes a deeply frozen input', () => {
  const deepFreeze = (value) => {
    if (value && typeof value === 'object') {
      for (const inner of Object.values(value)) deepFreeze(inner);
      Object.freeze(value);
    }
    return value;
  };
  for (const flow of Object.values(STATES)) {
    deepFreeze(flow);
    const copy = JSON.stringify(flow);
    for (const event of Object.values(EVENTS)) {
      const frozenEvent = deepFreeze(typeof event === 'string' ? { type: event } : { ...event });
      assert.doesNotThrow(() => flowReducer(flow, frozenEvent));
    }
    assert.equal(JSON.stringify(flow), copy);
  }
});

test('initialFlow: the menu by default, local starts the local game', () => {
  const menu = initialFlow();
  assert.deepEqual(menu, state('menu', 'none', null, null));
  assert.ok(Object.isFrozen(menu));
  const localFlow = initialFlow({ local: true });
  assert.deepEqual(localFlow, local('game', EMPTY), 'the game screen opens on the character select');
  assert.ok(Object.isFrozen(localFlow));
  assert.equal(isSelecting(localFlow), true);
  assert.equal(screenOf(localFlow), 'game');
  assert.equal(screenOf(menu), 'menu');
});

// Runs events from a start and returns the screens passed.
const walk = (flow, events) => {
  const screens = [screenOf(flow)];
  for (const event of events) {
    const next = flowReducer(flow, event);
    assert.notEqual(next, flow, `${event} is allowed on ${screenOf(flow)}`);
    flow = next;
    screens.push(screenOf(flow));
  }
  return { flow, screens };
};

test('happy path, host: menu, lobby, waiting, starting, game, gameover, menu', () => {
  const { flow, screens } = walk(initialFlow(), [E.PLAY_ONLINE, E.ROOM_CREATED, E.OPPONENT_JOINED, E.START, E.GAME_OVER, E.LEAVE]);
  assert.deepEqual(screens, ['menu', 'lobby', 'waiting', 'starting', 'game', 'gameover', 'menu']);
  assert.deepEqual(flow, MENU);
});

test('happy path, guest: menu, lobby, starting, game, gameover, menu', () => {
  const { flow, screens } = walk(initialFlow(), [E.PLAY_ONLINE, E.JOINED, E.START, E.GAME_OVER, E.LEAVE]);
  assert.deepEqual(screens, ['menu', 'lobby', 'starting', 'game', 'gameover', 'menu']);
  assert.deepEqual(flow, MENU);
});

test('happy path with a rematch: gameover, game, gameover', () => {
  const start = walk(initialFlow(), [E.PLAY_ONLINE, E.ROOM_CREATED, E.OPPONENT_JOINED, E.START, E.GAME_OVER]).flow;
  const { flow, screens } = walk(start, [E.REMATCH_STARTED, E.GAME_OVER]);
  assert.deepEqual(screens, ['gameover', 'game', 'gameover']);
  assert.equal(flow.role, 'host');
  assert.equal(flow.mode, 'online');
});

test('local path: menu, game (the character select, then the game), gameover, game by rematch with the same seats, menu', () => {
  const picks = [
    { type: E.PICK, seat: P2, character: B }, // Player 2 picks first: X
    { type: E.PICK, seat: P1, character: R },
    { type: E.READY, seat: P1 },
    { type: E.READY, seat: P2 },
  ];
  const selected = walk(initialFlow(), [E.PLAY_LOCAL, ...picks]);
  assert.deepEqual(selected.screens, ['menu', 'game', 'game', 'game', 'game', 'game']);
  assert.deepEqual(selected.flow.seats, seats(R, B, true, true, [P2, P1]));
  assert.equal(isSelecting(selected.flow), false);
  const { flow, screens } = walk(selected.flow, [E.GAME_OVER, E.REMATCH_STARTED, E.GAME_OVER, E.LEAVE]);
  assert.deepEqual(screens, ['game', 'gameover', 'game', 'gameover', 'menu']);
  assert.deepEqual(flow, MENU);
  const rematch = walk(selected.flow, [E.GAME_OVER, E.REMATCH_STARTED]).flow;
  assert.equal(rematch.seats, selected.flow.seats, 'a rematch keeps the same characters and sides');
});

test('the local character select: no game over before both are Ready, and Back (LEAVE) returns to the menu', () => {
  const flow = initialFlow({ local: true });
  assert.equal(flowReducer(flow, E.GAME_OVER), flow);
  assert.deepEqual(flowReducer(flow, E.LEAVE), MENU);
});

test('the opponent leaving while starting: the host waits again, the guest returns to the lobby with a notice', () => {
  const host = walk(initialFlow(), [E.PLAY_ONLINE, E.ROOM_CREATED, E.OPPONENT_JOINED, E.OPPONENT_LEFT]);
  assert.deepEqual(host.screens, ['menu', 'lobby', 'waiting', 'starting', 'waiting']);
  const guest = walk(initialFlow(), [E.PLAY_ONLINE, E.JOINED, E.OPPONENT_LEFT]);
  assert.deepEqual(guest.flow, state('lobby', 'none', 'online', null, NOTICE_HOST_LEFT));
  assert.deepEqual(walk(guest.flow, [E.BACK]).flow, MENU, 'Back clears the notice');
});

test('overlays only open on top of the menu', () => {
  const { screens, flow } = walk(initialFlow(), [E.OPEN_HOWTO, E.CLOSE_OVERLAY, E.OPEN_SETTINGS, E.BACK]);
  assert.deepEqual(screens, ['menu', 'menu', 'menu', 'menu', 'menu']);
  assert.equal(flow.overlay, 'none');
  const howto = flowReducer(initialFlow(), E.OPEN_HOWTO);
  assert.equal(flowReducer(howto, E.OPEN_SETTINGS), howto);
  assert.equal(flowReducer(howto, E.PLAY_ONLINE), howto);
});
