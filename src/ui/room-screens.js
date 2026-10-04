// The lobby and the waiting room (docs/flow-design.md sections 3.4 and
// 3.5). Pure (no DOM): the view models below give src/ui/screens.js every
// string, box name and state it draws, so node tests and shot mode see the
// same screens. Text comes from strings.js, numbers from src/config.js.

import { ONLINE_SAME_BROWSER_ONLY, ROOM_CODE_LENGTH } from '../config.js';
import { X } from '../logic/board.js';
import { CHARACTERS, EARTH_BEAR, WIND_RABBIT, stoneForCharacter } from '../logic/characters.js';
import { otherCharacter } from '../net/room.js';
import { normalizeRoomCode } from '../net/room-code.js';
import { ROLES, SCREENS } from './flow.js';
import { PORTRAIT_ART } from './hud-view.js';
import { STRINGS } from './strings.js';

// The two waiting room cards, left to right: the same order as the game
// HUD (Wind Rabbit with X on the left, Earth Bear with O on the right).
export const WAITING_CARD_ORDER = Object.freeze([WIND_RABBIT, EARTH_BEAR]);

// The lobby's own panel: the hint line shows only while online play is
// limited to one browser (ONLINE_SAME_BROWSER_ONLY, or options.sameBrowserOnly).
export function lobbyViewModel({ sameBrowserOnly = ONLINE_SAME_BROWSER_ONLY } = {}) {
  return {
    lead: STRINGS.lobbyLead,
    hint: sameBrowserOnly ? STRINGS.lobbySameBrowserHint : null,
    create: { label: STRINGS.lobbyCreate, box: 'lobby-create' },
    join: { label: STRINGS.lobbyJoin, box: 'lobby-join' },
    back: { label: STRINGS.back, box: 'lobby-back' },
  };
}

// The Join Room code box. text is what the box holds, joining is true
// while the room's answer is pending, error the inline error or null.
// The box shows the normalized code; Join stays disabled until it holds
// ROOM_CODE_LENGTH characters, and while a join is pending it reads
// Joining.
export function joinViewModel({ text = '', joining = false, error = null } = {}) {
  const value = normalizeRoomCode(text);
  return {
    value,
    inputDisabled: joining,
    joinLabel: joining ? STRINGS.lobbyJoining : STRINGS.lobbyJoinButton,
    joinDisabled: joining || value.length !== ROOM_CODE_LENGTH,
    error: error ?? null,
  };
}

// The waiting room for a flow state (flow.js; screen waiting or starting)
// and this window's room ({ code, character }: the room view, character
// being this window's own). In phase waiting the other player's card is a
// dimmed placeholder and Leave is enabled; in phase starting both cards
// are filled, Leave is disabled and Starting shows. null off those screens.
export function waitingViewModel(flow, room) {
  const starting = flow.screen === SCREENS.STARTING;
  if (!starting && flow.screen !== SCREENS.WAITING) return null;
  const mine = room?.character ?? null;
  const hostCharacter = flow.role === ROLES.GUEST && mine ? otherCharacter(mine) : mine;
  return {
    phase: flow.screen,
    title: starting ? STRINGS.startingTitle : STRINGS.waitingTitle,
    code: room?.code ?? '',
    hint: STRINGS.waitingHint,
    starting,
    startingText: starting ? STRINGS.waitingStarting : null,
    cards: WAITING_CARD_ORDER.map((id) => {
      const character = CHARACTERS[id];
      const stone = stoneForCharacter(id);
      const you = id === mine;
      return {
        character: id,
        name: character.name,
        stone,
        team: stone === X ? 'blue' : 'red',
        portrait: PORTRAIT_ART[stone],
        note: stone === X ? STRINGS.waitingMovesFirst : null,
        you,
        youText: you ? STRINGS.waitingYou : null,
        placeholder: !you && !starting,
        placeholderText: !you && !starting ? STRINGS.waitingPlaceholder : null,
        box: id === hostCharacter ? 'card-host' : 'card-guest',
      };
    }),
    copy: { label: STRINGS.waitingCopy, enabled: true, box: 'waiting-copy' },
    leave: { label: STRINGS.waitingLeave, enabled: !starting, box: 'waiting-leave' },
  };
}

// The Copy button: writes the code through clipboard (navigator.clipboard
// or a stand-in) and resolves to 'copied', or to 'manual' when the
// clipboard API is missing or rejects (the page then selects the code text
// and asks for Ctrl+C).
export async function copyRoomCode(code, clipboard) {
  if (typeof clipboard?.writeText !== 'function') return 'manual';
  try {
    await clipboard.writeText(code);
    return 'copied';
  } catch {
    return 'manual';
  }
}

// The text shown after a copy result of copyRoomCode.
export function copyFeedbackText(result) {
  return result === 'copied' ? STRINGS.waitingCopied : STRINGS.waitingPressCtrlC;
}
