// Leave match on the game screen (docs/flow-design.md section 3.13): only
// on the game screen, online the opponent wins at once (no leave
// countdown), on this computer the game ends; both go to the menu.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WIND_RABBIT } from '../src/logic/characters.js';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { GAME, GAME_OVER, MENU, createApp } from '../src/ui/app.js';
import { FLOW_EVENTS, flowReducer, initialFlow, SCREENS } from '../src/ui/flow.js';
import { STRINGS } from '../src/ui/strings.js';
import { pickAndReady } from './room-start.js';

function onlinePair() {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const window = () => {
    const app = createApp({ openTransport: () => network.connect(), clock, random: () => 0, makeCode: () => 'AB2C9' });
    app.playOnline();
    return app;
  };
  const host = window();
  const guest = window();
  host.createRoom();
  guest.openJoin();
  guest.joinRoom('AB2C9');
  pickAndReady(host, guest, WIND_RABBIT);
  return { host, guest, clock };
}

test('Leave match shows on the game screen only, and says what leaving costs', () => {
  const { host, guest } = onlinePair();
  assert.deepEqual(host.getView().leaveMatch, { online: true });
  assert.equal(STRINGS.leaveMatchOnline.length > 0 && STRINGS.leaveMatchLocal.length > 0, true);
  const local = createApp({ openTransport: () => assert.fail('no network'), clock: createFakeClock(), local: true });
  assert.equal(local.getView().leaveMatch, null, 'not on the character select');
  assert.equal(local.leaveMatch(), false);
  for (const app of [host, guest]) app.close();
});

test('online: Leave match gives the opponent the win at once and takes the leaver to the menu', () => {
  const { host, guest } = onlinePair();
  assert.equal(guest.getScreen(), GAME);
  assert.equal(guest.leaveMatch(), true);
  assert.equal(guest.getScreen(), MENU);
  assert.equal(guest.getView().leaveMatch, null);
  assert.equal(host.getScreen(), GAME_OVER, 'no leave countdown: the host wins now');
  assert.equal(host.getView().gameOver.headline, STRINGS.gameOverYouWin);
  assert.equal(host.getView().gameOver.subline, STRINGS.gameOverOpponentLeft);
  host.close();
});

test('the flow: LEAVE from the game screen goes to the menu; a spectator leaves with Stop watching instead', () => {
  let flow = flowReducer(initialFlow({ local: true }), FLOW_EVENTS.LEAVE);
  assert.equal(flow.screen, SCREENS.MENU, 'the local select');
  flow = { ...initialFlow(), screen: SCREENS.GAME, mode: 'online', role: 'host' };
  assert.equal(flowReducer(flow, FLOW_EVENTS.LEAVE).screen, SCREENS.MENU);
});
