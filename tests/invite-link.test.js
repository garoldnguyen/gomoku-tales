// The invite link of an online room (docs/flow-design.md section 3.10):
// the link a host copies, the code read back from it, and the join it
// starts through the flow (Play Online, Join Room, the join).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeClock } from '../src/net/clock.js';
import { createFakeNetwork } from '../src/net/fake-transport.js';
import { JOIN, LOBBY, MENU, WAITING_SCREEN, createApp } from '../src/ui/app.js';
import { inviteFeedbackText, inviteLink, joinCodeFromSearch } from '../src/ui/room-screens.js';
import { STRINGS } from '../src/ui/strings.js';

test('the invite link is this page with ?join=CODE, other parameters kept, ?local and the hash dropped', () => {
  assert.equal(inviteLink('https://gomoku.example/', 'AB2C9'), 'https://gomoku.example/?join=AB2C9');
  assert.equal(inviteLink('http://localhost:8000/index.html?quality=low&local=1#x', 'AB2C9'),
    'http://localhost:8000/index.html?quality=low&join=AB2C9');
  assert.equal(inviteLink('https://gomoku.example/?join=OLD11', 'AB2C9'), 'https://gomoku.example/?join=AB2C9');
});

test('the code of a link is read back normalised; no or an empty parameter is null', () => {
  assert.equal(joinCodeFromSearch('?join=ab2c9'), 'AB2C9');
  assert.equal(joinCodeFromSearch('?quality=low&join=AB2C9'), 'AB2C9');
  assert.equal(joinCodeFromSearch('?quality=low'), null);
  assert.equal(joinCodeFromSearch('?join='), null);
  assert.equal(inviteFeedbackText('copied', 'L'), STRINGS.waitingLinkCopied);
  assert.equal(inviteFeedbackText('manual', 'L'), 'L', 'no clipboard: the link itself to copy by hand');
});

function makeWorld() {
  const network = createFakeNetwork();
  const clock = createFakeClock();
  const window = () => createApp({ openTransport: () => network.connect(), clock, random: () => 0, makeCode: () => 'AB2C9' });
  return { window };
}

test('opening the link on the menu opens Join Room with the code filled in; the player then joins', () => {
  const { window } = makeWorld();
  const host = window();
  host.playOnline();
  host.createRoom();
  assert.equal(host.getView().waiting.invite.label, STRINGS.waitingInvite, 'the host alone has the invite link');
  const guest = window();
  assert.equal(guest.getScreen(), MENU);
  assert.equal(guest.joinFromLink('ab2c9'), true);
  assert.equal(guest.getScreen(), JOIN, 'not joined yet: the name comes first');
  assert.equal(guest.getView().joinPrefill, 'AB2C9');
  guest.setPlayerName('Bo');
  assert.equal(guest.joinRoom(guest.getView().joinPrefill), true);
  assert.equal(guest.getScreen(), WAITING_SCREEN);
  assert.equal(guest.getView().joinPrefill, null);
  assert.equal(host.getView().waiting.invite, null, 'the room is full: no invite link');
  assert.equal(host.getView().waiting.cards[1].label, 'Bo');
});

test('off the menu the link does nothing', () => {
  const { window } = makeWorld();
  const other = window();
  other.playOnline();
  assert.equal(other.joinFromLink('AB2C9'), false);
  assert.equal(other.getScreen(), LOBBY);
});
