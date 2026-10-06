// The lobby and the waiting room (docs/flow-design.md sections 3.4 and
// 3.5). Pure (no DOM): the view models below give src/ui/screens.js every
// string, box name and state it draws, so node tests and shot mode see the
// same screens. Text comes from strings.js, numbers from src/config.js.

import * as CONFIG from '../config.js';
import {
  ROOM_CODE_LENGTH, SELECT_BLUR_PX, SELECT_CARD_OPACITY, SELECT_PANEL_OPACITY,
  SELECT_PORTRAIT_SCALE, SELECT_SCRIM_OPACITY,
} from '../config.js';
import { O, X } from '../logic/board.js';
import { onlineSameBrowserOnly } from '../net/transport.js';
import { CHARACTERS, CLOUD_EAGLE, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT } from '../logic/characters.js';
import { createSeats, otherSeat, seatStone } from '../logic/seats.js';
import { cooldownTurns, isPassiveSkill } from '../logic/skills.js';
import { GUEST, HOST, ROOM_SEATS } from '../net/room.js';
import { normalizeRoomCode } from '../net/room-code.js';
import { ART, AVATAR_PX } from '../render3d/art-assets.js';
import { LOCAL_SEATS, ROLES, SCREENS, isSelecting } from './flow.js';
import { PORTRAIT_ART } from './hud-view.js';
import { SKILL_INFO } from './skill-info.js';
import { spectatorName, spectatorStatus } from './spectator-game.js';
import { STRINGS, fillText, withCode } from './strings.js';

// The characters of the character select, in table order.
export const SELECT_CHARACTERS = Object.freeze(Object.keys(CHARACTERS));

// How each character looks on the character select: the card colour (a
// glass token of room.css), the owner's pixel portrait (its asset key, the
// one place the select names it), the emblem shown while the portrait is
// missing (the blue four-petal cross, the red round bloom, the jade circle
// with a leaf, the pale yellow cloud with a feather), the seal initials and
// the tagline of strings.js. A card shows its emblem while the portrait
// file is missing.
export const CHARACTER_LOOKS = Object.freeze({
  [WIND_RABBIT]: Object.freeze({
    colour: 'blue', portrait: ART.avatar[WIND_RABBIT], emblem: 'cross', seal: 'GH', tagline: STRINGS.selectTaglineWindRabbit,
  }),
  [EARTH_BEAR]: Object.freeze({
    colour: 'red', portrait: ART.avatar[EARTH_BEAR], emblem: 'bloom', seal: 'MB', tagline: STRINGS.selectTaglineEarthBear,
  }),
  [JADE_SERPENT]: Object.freeze({
    colour: 'jade', portrait: ART.avatar[JADE_SERPENT], emblem: 'leaf', seal: 'JS', tagline: STRINGS.selectTaglineJadeSerpent,
  }),
  [CLOUD_EAGLE]: Object.freeze({
    colour: 'gold', portrait: ART.cloudEagle.avatar, emblem: 'cloud', seal: 'CE', tagline: STRINGS.selectTaglineCloudEagle,
  }),
});

// What the stage of a character card shows: its portrait when the asset
// store holds a loaded image with a src for the card's portrait key, else
// its emblem. assets is the asset store (render/assets.js) or null.
//   { kind: 'portrait', src } or { kind: 'emblem', emblem }
export function characterStage(card, assets) {
  const image = card.portrait ? assets?.get(card.portrait) ?? null : null;
  return image?.src ? { kind: 'portrait', src: image.src } : { kind: 'emblem', emblem: card.emblem };
}

// The room the character select leaves a portrait, in internal pixels (one
// --u of index.html: the window's 16:9 box over 960): the panel's height
// without the card stage plus the window padding (measured on the waiting
// room, the taller panel: its title and code share a row, room.css), the
// room a stage needs around its portrait, and the inner width of one of
// the four character cards (the 860 wide panel, room.css, less its
// padding, three gaps and each card's padding and border). Phones (PHONE_MAX_WIDTH and narrower, room.css) always
// show scale 1.
export const SELECT_INTERNAL_WIDTH = 960;
export const SELECT_REST_HEIGHT_U = 334;
export const SELECT_STAGE_PAD_U = 8;
export const SELECT_CARD_INNER_U = 172;
export const PHONE_MAX_WIDTH = 600;

// The whole-number scale of the 128 px portraits on the character cards:
// SELECT_PORTRAIT_SCALE when it fits the window of width by height CSS
// pixels, else the largest smaller whole number that fits, at least 1. A
// whole number keeps every art pixel a square of screen pixels.
export function portraitScale(width, height) {
  if (width <= PHONE_MAX_WIDTH) return 1;
  const u = Math.min(width, (height * 16) / 9) / SELECT_INTERNAL_WIDTH;
  for (let scale = SELECT_PORTRAIT_SCALE; scale > 1; scale--) {
    const side = AVATAR_PX * scale;
    const fitsHeight = side + SELECT_STAGE_PAD_U * u <= height - SELECT_REST_HEIGHT_U * u;
    const fitsWidth = side + SELECT_STAGE_PAD_U * u <= SELECT_CARD_INNER_U * u;
    if (fitsHeight && fitsWidth) return scale;
  }
  return 1;
}

// The see-through glass of the character select (room.css): the panel,
// the character cards and the scrim behind the panel are the dark
// --card-solid glass token of hud.css (alpha GLASS_SOLID_ALPHA) mixed with
// transparent, so they reach SELECT_PANEL_OPACITY, SELECT_CARD_OPACITY and
// SELECT_SCRIM_OPACITY with no new colour. The panel blurs the map behind
// it by SELECT_BLUR_PX when frosted (Medium and High), not at all on Low.
// Returns the CSS custom properties screens.js sets on #screens.
export const GLASS_SOLID_ALPHA = 0.92;
const mix = (opacity) => `${Math.round((opacity / GLASS_SOLID_ALPHA) * 1000) / 10}%`;
export function selectGlassStyle({ frosted = true } = {}) {
  return {
    '--panel-mix': mix(SELECT_PANEL_OPACITY),
    '--character-mix': mix(SELECT_CARD_OPACITY),
    '--scrim-mix': mix(SELECT_SCRIM_OPACITY),
    '--select-blur': `${frosted ? SELECT_BLUR_PX : 0}px`,
  };
}

// The rest turns text of a skill row, from COOLDOWN_SHORT or COOLDOWN_LONG
// (logic/skills.js cooldownTurns).
export const restText = (turns) => STRINGS.selectRestTurns.replace('{turns}', String(turns));

// The rest text of a skill: Always on for a passive skill (Sky Watch, no
// timer), else its rest turns.
export const skillRestText = (skillId) => (isPassiveSkill(skillId) ? STRINGS.skillAlwaysOn : restText(cooldownTurns(skillId)));

// windRabbit -> wind-rabbit, for data-hud-box names.
const slug = (id) => id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// The lobby's own panel: the hint line shows only while online play is
// limited to one browser (onlineSameBrowserOnly of config, the broadcast
// transport). connecting is true while a new room's relay connection
// opens (Create reads Connecting and is disabled), error the connection
// error or null.
export function lobbyViewModel({ config = CONFIG, connecting = false, error = null } = {}) {
  return {
    lead: STRINGS.lobbyLead,
    hint: onlineSameBrowserOnly(config) ? STRINGS.lobbySameBrowserHint : null,
    error,
    create: { label: connecting ? STRINGS.lobbyConnecting : STRINGS.lobbyCreate, disabled: connecting, box: 'lobby-create' },
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
// has the portrait key (characterStage: the emblem while it is missing), the seal, the tagline and one row per skill with its
// rest turns and its SKILL_INFO description (the skill row's tooltip, the
// same text as the in-game HUD); a card taken by the other seat is
// disabled and says Taken.
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
        portrait: look.portrait,
        emblem: look.emblem,
        seal: look.seal,
        skills: CHARACTERS[id].skills.map((skillId) => {
          const rest = cooldownTurns(skillId);
          const info = SKILL_INFO[skillId];
          return { id: skillId, name: info.title, rest, restText: skillRestText(skillId), description: info.description };
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
        portrait: stone && pick ? PORTRAIT_ART[pick] : null,
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

// The waiting room for a flow state (flow.js; screen waiting, starting or
// spectate-waiting) and this window's room ({ code, seats, seat }: the room
// view). Two seats, the host's on the left: this window picks a character
// for its own seat and presses Ready; the other seat shows the other
// player's pick. In phase waiting nobody sits in the guest seat yet (a
// dimmed placeholder). Leave is always enabled. The hint names a second
// window of this browser for the broadcast transport and sending the code
// for the relay (config). A spectator (spectate-waiting) sees the same
// room with the seats Host and Guest and no seat of its own: every
// character card is disabled and there is no Ready; Leave reads Stop
// watching. null off those screens.
export function waitingViewModel(flow, room, { config = CONFIG } = {}) {
  if (flow.screen === SCREENS.SPECTATE_WAITING) return spectatorWaitingViewModel(room);
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
    hint: onlineSameBrowserOnly(config) ? STRINGS.waitingHint : STRINGS.waitingHintRelay,
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

// The waiting room a spectator sees (spectate-waiting): the host's seats,
// nothing editable, no Ready. The guest seat is a placeholder until a
// guest is known (room.guestPresent of net/spectator-room.js).
function spectatorWaitingViewModel(room) {
  const seats = room?.seats ?? createSeats(ROOM_SEATS);
  const select = characterSelectViewModel({
    seats,
    labels: { [HOST]: STRINGS.spectateHost, [GUEST]: STRINGS.spectateGuest },
    editable: [],
    absent: room?.guestPresent ? [] : [GUEST],
  });
  return {
    phase: SCREENS.SPECTATE_WAITING,
    title: STRINGS.spectateWaitingTitle,
    code: room?.code ?? '',
    hint: STRINGS.spectateWaitingHint,
    starting: false,
    startingText: null,
    lead: select.lead,
    cards: select.seats,
    characters: select.characters,
    readyButton: null,
    copy: { label: STRINGS.waitingCopy, enabled: true, box: 'waiting-copy' },
    leave: { label: STRINGS.spectateLeave, enabled: true, box: 'waiting-leave' },
  };
}

// The room code screen of Watch a match (flow screen spectate), like the
// Join Room box: text is what the box holds, connecting is true while the
// relay connection opens (the box and Watch are disabled, Watch reads
// Connecting), error the inline error or null.
export function spectateViewModel({ text = '', connecting = false, error = null } = {}) {
  const value = normalizeRoomCode(text);
  return {
    title: STRINGS.spectateTitle,
    lead: STRINGS.spectateLead,
    label: STRINGS.lobbyCodeLabel,
    value,
    inputDisabled: connecting,
    watch: {
      label: connecting ? STRINGS.spectateConnecting : STRINGS.spectateWatchButton,
      disabled: connecting || value.length !== ROOM_CODE_LENGTH,
      box: 'spectate-submit',
    },
    error: error ?? null,
    back: { label: STRINGS.back, box: 'spectate-back' },
  };
}

// The card of the live game a spectator watches (flow screen
// spectate-game), a small card in the lower left corner, off the board: the room, the two
// players (their characters and stones) and the phase line (whose turn,
// or how the game ended), and Stop watching. code is the room code, state
// the game state and result the leave result.
export function watchViewModel({ code = '', state = null, result = null } = {}) {
  return {
    title: withCode(STRINGS.watchingRoom, code),
    players: state ? fillText(STRINGS.watchingVersus, { x: spectatorName(X, state), o: spectatorName(O, state) }) : '',
    status: spectatorStatus(state, result),
    leave: { label: STRINGS.spectateLeave, box: 'watch-leave' },
  };
}

// The Room closed notice (flow screen room-closed): the host left, and the
// spectator goes back to the menu.
export function roomClosedViewModel() {
  return {
    title: STRINGS.roomClosed,
    detail: STRINGS.roomClosedDetail,
    back: { label: STRINGS.gameOverBackToMenu, box: 'room-closed-menu' },
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
