import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLOW_EVENTS, MODES, NOTICE_HOST_LEFT, OVERLAYS, ROLES, SCREENS, flowReducer, initialFlow, screenOf,
} from '../src/ui/flow.js';

const E = FLOW_EVENTS;
const state = (screen, overlay, mode, role, notice = null) => Object.freeze({ screen, overlay, mode, role, notice });

// Every screen and overlay state: the menu with each overlay, and every
// other screen in the modes and roles it can be in. The notice is set
// where it may be, so the table shows which events clear it.
const STATES = {
  'menu': state('menu', 'none', null, null),
  'menu+howto': state('menu', 'howto', null, null),
  'menu+settings': state('menu', 'settings', null, null),
  'lobby': state('lobby', 'none', 'online', null, NOTICE_HOST_LEFT),
  'waiting': state('waiting', 'none', 'online', 'host'),
  'starting/host': state('starting', 'none', 'online', 'host'),
  'starting/guest': state('starting', 'none', 'online', 'guest'),
  'game/online': state('game', 'none', 'online', 'guest'),
  'game/local': state('game', 'none', 'local', null),
  'gameover/online': state('gameover', 'none', 'online', 'host'),
  'gameover/local': state('gameover', 'none', 'local', null),
};

// docs/flow-design.md section 4, written out in full: the result of each
// allowed event, by state. Every pair missing here must return the same
// object.
const ALLOWED = {
  'menu': {
    PLAY_ONLINE: state('lobby', 'none', 'online', null),
    PLAY_LOCAL: state('game', 'none', 'local', null),
    OPEN_HOWTO: state('menu', 'howto', null, null),
    OPEN_SETTINGS: state('menu', 'settings', null, null),
  },
  'menu+howto': {
    CLOSE_OVERLAY: state('menu', 'none', null, null),
    BACK: state('menu', 'none', null, null),
  },
  'menu+settings': {
    CLOSE_OVERLAY: state('menu', 'none', null, null),
    BACK: state('menu', 'none', null, null),
  },
  'lobby': {
    BACK: state('menu', 'none', null, null),
    ROOM_CREATED: state('waiting', 'none', 'online', 'host'),
    JOINED: state('starting', 'none', 'online', 'guest'),
  },
  'waiting': {
    OPPONENT_JOINED: state('starting', 'none', 'online', 'host'),
    LEAVE: state('menu', 'none', null, null),
  },
  'starting/host': {
    START: state('game', 'none', 'online', 'host'),
    OPPONENT_LEFT: state('waiting', 'none', 'online', 'host'),
  },
  'starting/guest': {
    START: state('game', 'none', 'online', 'guest'),
    OPPONENT_LEFT: state('lobby', 'none', 'online', null, NOTICE_HOST_LEFT),
  },
  'game/online': { GAME_OVER: state('gameover', 'none', 'online', 'guest') },
  'game/local': { GAME_OVER: state('gameover', 'none', 'local', null) },
  'gameover/online': {
    LEAVE: state('menu', 'none', null, null),
    REMATCH_STARTED: state('game', 'none', 'online', 'host'),
  },
  'gameover/local': {
    LEAVE: state('menu', 'none', null, null),
    REMATCH_STARTED: state('game', 'none', 'local', null),
  },
};

const EVENT_NAMES = [...Object.values(E), 'NOT_AN_EVENT'];

test('the table names every screen, overlay and event of section 4', () => {
  assert.deepEqual(Object.values(SCREENS), ['menu', 'lobby', 'waiting', 'starting', 'game', 'gameover']);
  assert.deepEqual(Object.values(OVERLAYS), ['none', 'howto', 'settings']);
  assert.deepEqual(Object.values(MODES), ['online', 'local']);
  assert.deepEqual(Object.values(ROLES), ['host', 'guest']);
  assert.deepEqual(Object.values(E).sort(), [
    'BACK', 'CLOSE_OVERLAY', 'GAME_OVER', 'JOINED', 'LEAVE', 'OPEN_HOWTO', 'OPEN_SETTINGS', 'OPPONENT_JOINED',
    'OPPONENT_LEFT', 'PLAY_LOCAL', 'PLAY_ONLINE', 'REMATCH_STARTED', 'ROOM_CREATED', 'START',
  ]);
  for (const name of Object.keys(ALLOWED)) assert.ok(STATES[name], name);
});

test('flowReducer: every state times every event gives exactly the table result', () => {
  let allowed = 0;
  for (const [name, flow] of Object.entries(STATES)) {
    for (const event of EVENT_NAMES) {
      const expected = ALLOWED[name]?.[event];
      for (const form of [event, { type: event }]) {
        const result = flowReducer(flow, form);
        const label = `${name} + ${event}`;
        if (expected) {
          assert.notEqual(result, flow, `${label} makes a new object`);
          assert.deepEqual(result, expected, label);
          assert.ok(Object.isFrozen(result), `${label} is frozen`);
        } else {
          assert.equal(result, flow, `${label} returns the same object`);
        }
      }
      if (expected) allowed++;
    }
  }
  assert.equal(allowed, 23);
  assert.equal(flowReducer(STATES.menu, null), STATES.menu);
  assert.equal(flowReducer(STATES.menu, {}), STATES.menu);
});

test('flowReducer never changes a deeply frozen input', () => {
  for (const flow of Object.values(STATES)) {
    const copy = { ...flow };
    for (const event of EVENT_NAMES) {
      const frozenEvent = Object.freeze({ type: event });
      assert.doesNotThrow(() => flowReducer(flow, frozenEvent));
    }
    assert.deepEqual(flow, copy);
  }
});

test('initialFlow: the menu by default, local starts the local game', () => {
  const menu = initialFlow();
  assert.deepEqual(menu, state('menu', 'none', null, null));
  assert.ok(Object.isFrozen(menu));
  const local = initialFlow({ local: true });
  assert.deepEqual(local, state('game', 'none', 'local', null));
  assert.ok(Object.isFrozen(local));
  assert.equal(screenOf(local), 'game');
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
  assert.deepEqual(flow, state('menu', 'none', null, null));
});

test('happy path, guest: menu, lobby, starting, game, gameover, menu', () => {
  const { flow, screens } = walk(initialFlow(), [E.PLAY_ONLINE, E.JOINED, E.START, E.GAME_OVER, E.LEAVE]);
  assert.deepEqual(screens, ['menu', 'lobby', 'starting', 'game', 'gameover', 'menu']);
  assert.deepEqual(flow, state('menu', 'none', null, null));
});

test('happy path with a rematch: gameover, game, gameover', () => {
  const start = walk(initialFlow(), [E.PLAY_ONLINE, E.ROOM_CREATED, E.OPPONENT_JOINED, E.START, E.GAME_OVER]).flow;
  const { flow, screens } = walk(start, [E.REMATCH_STARTED, E.GAME_OVER]);
  assert.deepEqual(screens, ['gameover', 'game', 'gameover']);
  assert.equal(flow.role, 'host');
  assert.equal(flow.mode, 'online');
});

test('local path: menu, game, gameover, game by rematch, menu', () => {
  const { flow, screens } = walk(initialFlow(), [E.PLAY_LOCAL, E.GAME_OVER, E.REMATCH_STARTED, E.GAME_OVER, E.LEAVE]);
  assert.deepEqual(screens, ['menu', 'game', 'gameover', 'game', 'gameover', 'menu']);
  assert.deepEqual(flow, state('menu', 'none', null, null));
});

test('the opponent leaving while starting: the host waits again, the guest returns to the lobby with a notice', () => {
  const host = walk(initialFlow(), [E.PLAY_ONLINE, E.ROOM_CREATED, E.OPPONENT_JOINED, E.OPPONENT_LEFT]);
  assert.deepEqual(host.screens, ['menu', 'lobby', 'waiting', 'starting', 'waiting']);
  const guest = walk(initialFlow(), [E.PLAY_ONLINE, E.JOINED, E.OPPONENT_LEFT]);
  assert.deepEqual(guest.flow, state('lobby', 'none', 'online', null, NOTICE_HOST_LEFT));
  assert.deepEqual(walk(guest.flow, [E.BACK]).flow, state('menu', 'none', null, null), 'Back clears the notice');
});

test('overlays only open on top of the menu', () => {
  const { screens, flow } = walk(initialFlow(), [E.OPEN_HOWTO, E.CLOSE_OVERLAY, E.OPEN_SETTINGS, E.BACK]);
  assert.deepEqual(screens, ['menu', 'menu', 'menu', 'menu', 'menu']);
  assert.equal(flow.overlay, 'none');
  const howto = flowReducer(initialFlow(), E.OPEN_HOWTO);
  assert.equal(flowReducer(howto, E.OPEN_SETTINGS), howto);
  assert.equal(flowReducer(howto, E.PLAY_ONLINE), howto);
});
