// Test helper (not a test file): the character select of an online room,
// played the way two players do it. Works with the room controllers of
// src/net/room.js and with the apps of src/ui/app.js (both have pick and
// ready). Wind Rabbit picks first, so it plays X and Earth Bear plays O.

import { EARTH_BEAR, WIND_RABBIT } from '../src/logic/characters.js';

// The host plays hostCharacter, the guest guestCharacter (by default the
// other one of Wind Rabbit and Earth Bear). The host picks first when it
// plays Wind Rabbit (or hostFirst is set); both press Ready, so the host
// starts the game.
export function pickAndReady(host, guest, hostCharacter = WIND_RABBIT, guestCharacter, hostFirst = hostCharacter === WIND_RABBIT) {
  guestCharacter ??= hostCharacter === WIND_RABBIT ? EARTH_BEAR : WIND_RABBIT;
  if (hostFirst) {
    host.pick(hostCharacter);
    guest.pick(guestCharacter);
  } else {
    guest.pick(guestCharacter);
    host.pick(hostCharacter);
  }
  host.ready();
  guest.ready();
}
