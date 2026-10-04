// All English text of the menu, How to Play, Settings, lobby, waiting room
// and Game over screens
// (docs/flow-design.md sections 3 and 8): ONE flat object, the single place
// to change or translate a sentence. Numbers in the text come from
// src/config.js, and skill and character names from SKILL_INFO and the
// character table, never typed twice. Pure (no DOM).

import { COOLDOWN_LONG, COOLDOWN_SHORT, ROCK_LIFETIME_TURNS, ROOM_CODE_LENGTH, WIN_LENGTH } from '../config.js';
import { CHARACTERS, EARTH_BEAR, WIND_RABBIT } from '../logic/characters.js';
import { STONE_CONVERSION, TERRAIN_CREATION, TORNADO_ZONE, WIND_DASH } from '../logic/skills.js';
import { SKILL_INFO } from './skill-info.js';

const rabbit = CHARACTERS[WIND_RABBIT].name;
const bear = CHARACTERS[EARTH_BEAR].name;
const skill = (id) => SKILL_INFO[id].title;

// The six rules lines of How to Play (section 3.2) with the numbers of
// `config` (src/config.js or a test's own values). Each sentence was
// checked against src/logic: a rock lasts ROCK_LIFETIME_TURNS turns of the
// game, both players' turns counted (earth-bear-skills.js), so line 5 says
// so, and line 6 takes WIN_LENGTH like line 3.
export function howToRules({ COOLDOWN_LONG, COOLDOWN_SHORT, ROCK_LIFETIME_TURNS, WIN_LENGTH }) {
  return [
    `Two players take turns. ${rabbit} plants X and always goes first. ${bear} plants O.`,
    'On your turn do one thing: plant on an empty plot, or use a skill. A skill takes your whole turn.',
    `${WIN_LENGTH} or more of your plants in an unbroken row, across, down or diagonally, win the game.`,
    `After you use a skill it rests for your next ${COOLDOWN_SHORT} turns (${skill(WIND_DASH)}, ${skill(TERRAIN_CREATION)}) or your next ${COOLDOWN_LONG} turns (${skill(TORNADO_ZONE)}, ${skill(STONE_CONVERSION)}).`,
    `A rock blocks a plot for both players and crumbles after ${ROCK_LIFETIME_TURNS} turns, counting both players' turns.`,
    `If the board fills up and nobody has ${WIN_LENGTH} in a row, the game is a draw.`,
  ];
}

// A text of STRINGS with its {code} filled in by a room code.
export function withCode(text, code) {
  return text.replace('{code}', code ?? '');
}

// howToRule1 to howToRule6 of STRINGS.
function rulesEntries(lines) {
  return Object.fromEntries(lines.map((line, i) => [`howToRule${i + 1}`, line]));
}

export const STRINGS = Object.freeze({
  // Menu (section 3.1).
  gameTitle: 'Gomoku Tales',
  menuPlayOnline: 'Play Online',
  menuPlayLocal: 'Play on this computer',
  menuHowTo: 'How to Play',
  menuSettings: 'Settings',
  menuPlace: 'Windy Spring Breeze Hill', // the pill under the title
  // The muted second line of each menu button.
  menuPlayOnlineHint: 'Create a room or join one',
  menuPlayLocalHint: 'Two players, one window',
  menuHowToHint: 'Rules and skills',
  menuSettingsHint: 'Graphics quality and full screen',
  menuKeysHint: 'Up, Down to choose, Enter to select', // the hint bar

  // How to Play (section 3.2).
  howToTitle: 'How to Play',
  ...rulesEntries(howToRules({ COOLDOWN_LONG, COOLDOWN_SHORT, ROCK_LIFETIME_TURNS, WIN_LENGTH })),
  howToSkillsTitle: 'Skills',
  howToCooldown: 'Rests',
  howToTurns: 'turns',
  close: 'Close',

  // Settings (section 3.3). One help line per quality level.
  settingsTitle: 'Settings',
  settingsQuality: 'Graphics quality',
  settingsQualityHelpLow: 'Clear and easy to play. The plain field and sky, fastest.',
  settingsQualityHelpMedium: 'Soft shadows, the forest and a lived-in farm.',
  settingsQualityHelpHigh: 'Everything: depth, moving clouds and wind.',
  settingsFullscreen: 'Fullscreen',

  // Lobby (section 3.4). Join errors show inline under the code box; the
  // host-left one is the lobby notice of section 6 (the host left while the
  // room was starting).
  lobbyLead: 'Five in a row, with wind and earth skills.',
  lobbySameBrowserHint: 'Online play works between two windows of this browser on this computer.',
  lobbyCreate: 'Create Room',
  lobbyJoin: 'Join Room',
  lobbyCodeLabel: 'Room code',
  lobbyJoinButton: 'Join',
  lobbyJoining: 'Joining',
  back: 'Back',
  joinErrorEmpty: 'Enter a room code.',
  joinErrorBadCode: `Room codes are ${ROOM_CODE_LENGTH} letters and digits (no 0, O, 1 or I).`,
  joinErrorNotFound: 'No room found with code {code}.',
  joinErrorFull: 'Room {code} is full.',
  noticeHostLeft: 'The host left the room.',

  // Waiting room (section 3.5), phases waiting and starting.
  waitingTitle: 'Waiting for opponent',
  startingTitle: 'Pick your character',
  waitingHint: 'Open a second window of this browser and join with this code.',
  waitingPlaceholder: 'Waiting',
  waitingYou: 'You',
  waitingCopy: 'Copy',
  waitingCopied: 'Copied',
  waitingPressCtrlC: 'Press Ctrl+C',
  waitingLeave: 'Leave',
  waitingMovesFirst: 'Moves first',
  waitingOpponent: 'Opponent',

  // Character select (sections 3.5 and 3.6): the room's seats online, and
  // Player 1 and Player 2 on the game screen of Play on this computer.
  selectLocalTitle: 'Pick your characters',
  selectLead: 'The first to pick plays X and moves first.',
  selectPlayer1: 'Player 1',
  selectPlayer2: 'Player 2',
  selectReady: 'Ready',
  selectIsReady: 'Ready',
  selectChoosing: 'Choosing',
  selectTaken: 'Taken',
  selectWaitingOther: 'Waiting for the other player',

  // Game over (section 3.7).
  gameOverYouWin: 'You win',
  gameOverYouLose: 'You lose',
  gameOverWins: 'wins', // after the winning character's name in a local game
  gameOverWon: 'won', // after the winning character's name online
  gameOverDraw: 'Draw',
  gameOverBoardFull: 'The board is full',
  gameOverOpponentLeft: 'Opponent left',
  gameOverRematch: 'Rematch',
  gameOverBackToMenu: 'Back to Menu',
  rematchWaiting: 'Waiting for opponent',
  rematchSentHint: 'Your request was sent',
  rematchTheirsHint: 'Opponent wants a rematch',
  rematchGoneHint: 'Opponent left',
});
