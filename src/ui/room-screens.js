// The lobby and the waiting room (docs/flow-design.md sections 3.4 and
// 3.5). Pure (no DOM): the view models below give src/ui/screens.js every
// string, box name and state it draws, so node tests and shot mode see the
// same screens. Text comes from strings.js, numbers from src/config.js.

import { ONLINE_SAME_BROWSER_ONLY, ROOM_CODE_LENGTH } from '../config.js';
import { O, X } from '../logic/board.js';
import { CHARACTERS, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT } from '../logic/characters.js';
import { createSeats, otherSeat, seatStone } from '../logic/seats.js';
import { cooldownTurns } from '../logic/skills.js';
import { GUEST, HOST, ROOM_SEATS } from '../net/room.js';
import { normalizeRoomCode } from '../net/room-code.js';
import { LOCAL_SEATS, ROLES, SCREENS, isSelecting } from './flow.js';
import { PORTRAIT_ART } from './hud-view.js';
import { SKILL_INFO } from './skill-info.js';
import { STRINGS } from './strings.js';

// The characters of the character select, in table order.
export const SELECT_CHARACTERS = Object.freeze(Object.keys(CHARACTERS));

// How each character looks on the character select (placeholder art until
// the owner's portraits come): the card colour (a glass token of room.css),
// the emblem (the blue four-petal cross, the red round bloom, the jade
// circle with a leaf), the seal initials and the tagline of strings.js.
export const CHARACTER_LOOKS = Object.freeze({
  [WIND_RABBIT]: Object.freeze({ colour: 'blue', emblem: 'cross', seal: 'GH', tagline: STRINGS.selectTaglineWindRabbit }),
  [EARTH_BEAR]: Object.freeze({ colour: 'red', emblem: 'bloom', seal: 'MB', tagline: STRINGS.selectTaglineEarthBear }),
  [JADE_SERPENT]: Object.freeze({ colour: 'jade', emblem: 'leaf', seal: 'JS', tagline: STRINGS.selectTaglineJadeSerpent }),
});

// The rest turns text of a skill row, from COOLDOWN_SHORT or COOLDOWN_LONG
// (logic/skills.js cooldownTurns).
export const restText = (turns) => STRINGS.selectRestTurns.replace('{turns}', String(turns));

// windRabbit -> wind-rabbit, for data-hud-box names.
const slug = (id) => id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

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

// The character select of two seats (logic/seats.js), left to right in
// the seats' own order. labels names each seat; editable lists the seats
// this window may pick for (online its own, local both); you is this
// window's seat online; absent lists seats nobody sits in yet (a dimmed
// Waiting placeholder). An editable seat gets one choice per character
// (disabled when the other seat took it, or once the seat is Ready) and a
// Ready button (enabled only after a pick, until Ready). The stone shows
// once the seat picked: the first pick plays X and moves first.
//
// The three character cards and the one Ready button of the screen act for
// the active seat: online this window's own seat; on this computer the
// seat the players chose (prefer, by a press on its seat card) while it is
// not Ready, else the first seat that is not Ready yet. So either local
// seat may pick first. A local seat card that is not active and not Ready
// is choosable: pressing it makes that seat the active one. Each card
// has the emblem, the seal, the tagline and one row per skill with its
// rest turns; a card taken by the other seat is disabled and says Taken.
export function characterSelectViewModel({ seats, labels, editable = [], you = null, absent = [], prefer = null }) {
  const open = editable.filter((seat) => !absent.includes(seat));
  const preferred = open.includes(prefer) && !seats.ready[prefer] ? prefer : null;
  const active = preferred ?? open.find((seat) => !seats.ready[seat]) ?? open.at(-1) ?? null;
  const activePick = active ? seats.picks[active] : null;
  const activeReady = active ? seats.ready[active] : false;
  const activeOther = active ? seats.picks[otherSeat(seats, active)] : null;
  return {
    lead: STRINGS.selectLead,
    active,
    characters: SELECT_CHARACTERS.map((id) => {
      const look = CHARACTER_LOOKS[id];
      const taken = active !== null && activeOther === id;
      return {
        character: id,
        box: active ? `pick-${active}-${slug(id)}` : `pick-${slug(id)}`,
        name: CHARACTERS[id].name,
        tagline: look.tagline,
        colour: look.colour,
        emblem: look.emblem,
        seal: look.seal,
        skills: CHARACTERS[id].skills.map((skillId) => {
          const rest = cooldownTurns(skillId);
          return { id: skillId, name: SKILL_INFO[skillId].title, rest, restText: restText(rest) };
        }),
        selected: active !== null && activePick === id,
        taken,
        takenText: taken ? STRINGS.selectTaken : null,
        disabled: active === null || activeReady || taken,
      };
    }),
    readyButton: active
      ? { seat: active, label: STRINGS.selectReady, disabled: activeReady || activePick === null, box: `ready-${active}` }
      : null,
    seats: seats.names.map((seat) => {
      const pick = seats.picks[seat];
      const ready = seats.ready[seat];
      const empty = absent.includes(seat);
      const mine = editable.includes(seat) && !empty;
      const otherPick = seats.picks[otherSeat(seats, seat)];
      const stone = seatStone(seats, seat);
      return {
        seat,
        box: `card-${seat}`,
        label: labels[seat],
        you: seat === you,
        active: seat === active,
        choosable: open.length > 1 && open.includes(seat) && seat !== active && !ready,
        youText: seat === you ? STRINGS.waitingYou : null,
        placeholder: empty,
        placeholderText: empty ? STRINGS.waitingPlaceholder : null,
        character: pick,
        name: pick ? CHARACTERS[pick].name : null,
        stone,
        team: stone === X ? 'blue' : stone === O ? 'red' : null,
        portrait: stone ? PORTRAIT_ART[stone] : null,
        note: stone === X ? STRINGS.waitingMovesFirst : null,
        ready,
        statusText: empty ? null : ready ? STRINGS.selectIsReady : STRINGS.selectChoosing,
        choices: mine
          ? SELECT_CHARACTERS.map((id) => {
            const taken = otherPick === id;
            return {
              character: id,
              name: CHARACTERS[id].name,
              selected: pick === id,
              taken,
              takenText: taken ? STRINGS.selectTaken : null,
              disabled: ready || taken,
              box: `pick-${seat}-${slug(id)}`,
            };
          })
          : [],
        readyButton: mine ? { label: STRINGS.selectReady, disabled: ready || pick === null, box: `ready-${seat}` } : null,
      };
    }),
  };
}

// The waiting room for a flow state (flow.js; screen waiting or starting)
// and this window's room ({ code, seats, seat }: the room view). Two seats,
// the host's on the left: this window picks a character for its own seat
// and presses Ready; the other seat shows the other player's pick. In
// phase waiting nobody sits in the guest seat yet (a dimmed placeholder).
// Leave is always enabled. null off those screens.
export function waitingViewModel(flow, room) {
  const starting = flow.screen === SCREENS.STARTING;
  if (!starting && flow.screen !== SCREENS.WAITING) return null;
  const seats = room?.seats ?? createSeats(ROOM_SEATS);
  const you = room?.seat ?? (flow.role === ROLES.GUEST ? GUEST : HOST);
  const other = you === HOST ? GUEST : HOST;
  const select = characterSelectViewModel({
    seats,
    labels: { [you]: STRINGS.waitingYou, [other]: STRINGS.waitingOpponent },
    editable: [you],
    you,
    absent: starting ? [] : [GUEST],
  });
  return {
    phase: flow.screen,
    title: starting ? STRINGS.startingTitle : STRINGS.waitingTitle,
    code: room?.code ?? '',
    hint: STRINGS.waitingHint,
    starting,
    startingText: starting && seats.ready[you] ? STRINGS.selectWaitingOther : null,
    lead: select.lead,
    cards: select.seats,
    characters: select.characters,
    readyButton: select.readyButton,
    copy: { label: STRINGS.waitingCopy, enabled: true, box: 'waiting-copy' },
    leave: { label: STRINGS.waitingLeave, enabled: true, box: 'waiting-leave' },
  };
}

// The character select on the game screen of Play on this computer, while
// the flow is selecting (flow.js isSelecting): Player 1 and Player 2 both
// pick on this window; seat is the seat the players chose to act for
// (characterSelectViewModel prefer). null otherwise.
export function localSelectViewModel(flow, { seat = null } = {}) {
  if (!isSelecting(flow)) return null;
  const [one, two] = LOCAL_SEATS;
  const select = characterSelectViewModel({
    seats: flow.seats,
    labels: { [one]: STRINGS.selectPlayer1, [two]: STRINGS.selectPlayer2 },
    editable: LOCAL_SEATS,
    prefer: seat,
  });
  return {
    title: STRINGS.selectLocalTitle,
    lead: select.lead,
    cards: select.seats,
    characters: select.characters,
    readyButton: select.readyButton,
    back: { label: STRINGS.back, box: 'select-back' },
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
