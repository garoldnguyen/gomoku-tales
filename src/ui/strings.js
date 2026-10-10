// All English text of the menu, How to Play, Settings, lobby, waiting room
// and Game over screens
// (docs/flow-design.md sections 3 and 8): ONE flat object, the single place
// to change or translate a sentence. Numbers in the text come from
// src/config.js, and skill and character names from SKILL_INFO and the
// character table, never typed twice. Pure (no DOM).

import { COOLDOWN_LONG, COOLDOWN_SHORT, MUD_LIFETIME_TURNS, MUD_SINK_TURNS, ROOM_CODE_LENGTH, WIN_LENGTH } from '../config.js';
import { CHARACTERS, EARTH_BEAR, WIND_RABBIT } from '../logic/characters.js';
import { SKILL_ALREADY_USED_ERROR } from '../logic/game.js';
import { MUD_TRAP, PETRIFICATION, TORNADO_ZONE, WIND_DASH } from '../logic/skills.js';
import { SKILL_INFO } from './skill-info.js';

const rabbit = CHARACTERS[WIND_RABBIT].name;
const bear = CHARACTERS[EARTH_BEAR].name;
const skill = (id) => SKILL_INFO[id].title;

// The six rules lines of How to Play (section 3.2) with the numbers of
// `config` (src/config.js or a test's own values). Each sentence was
// checked against src/logic: a mud puddle dries after MUD_LIFETIME_TURNS
// turns of the game, both players' turns counted, and a seed planted in it
// stays sunk for MUD_SINK_TURNS (earth-bear-skills.js), a petrified plant is
// a rock for good, so line 5 says so, and line 6 takes WIN_LENGTH like line 3.
export function howToRules({ COOLDOWN_LONG, COOLDOWN_SHORT, MUD_LIFETIME_TURNS, MUD_SINK_TURNS, WIN_LENGTH }) {
  return [
    `Two players take turns. ${rabbit} plants X and always goes first. ${bear} plants O.`,
    'On your turn you may use one skill that is ready. Then you must plant a seed on an empty plot to end your turn.',
    `${WIN_LENGTH} or more of your plants in an unbroken row, across, down or diagonally, win the game.`,
    `After you use a skill it rests for your next ${COOLDOWN_SHORT} turns (${skill(WIND_DASH)}, ${skill(MUD_TRAP)}) or your next ${COOLDOWN_LONG} turns (${skill(TORNADO_ZONE)}, ${skill(PETRIFICATION)}).`,
    `A mud puddle dries after ${MUD_LIFETIME_TURNS} turns, counting both players' turns. A seed planted in it counts for no row for ${MUD_SINK_TURNS} ${MUD_SINK_TURNS === 1 ? 'turn' : 'turns'}. A rock blocks a plot for both players for good.`,
    `If the board fills up and nobody has ${WIN_LENGTH} in a row, the game is a draw.`,
  ];
}

// A text of STRINGS with its {code} filled in by a room code.
export function withCode(text, code) {
  return text.replace('{code}', code ?? '');
}

// A text of STRINGS with each {key} filled in from values.
export function fillText(text, values) {
  return text.replace(/\{(\w+)\}/g, (whole, key) => (Object.hasOwn(values, key) ? String(values[key]) : whole));
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
  menuPlace: 'Colorful Garden', // the pill under the title
  // The muted second line of each menu button.
  menuPlayOnlineHint: 'Create a room or join one',
  menuPlayLocalHint: 'Two players, one window',
  menuHowToHint: 'Rules and skills',
  menuSettingsHint: 'Graphics quality and full screen',
  menuKeysHint: 'Up, Down to choose, Enter to select', // the hint bar

  // How to Play (section 3.2).
  howToTitle: 'How to Play',
  ...rulesEntries(howToRules({ COOLDOWN_LONG, COOLDOWN_SHORT, MUD_LIFETIME_TURNS, MUD_SINK_TURNS, WIN_LENGTH })),
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
  lobbyConnecting: 'Connecting',
  connectionError: 'Could not reach the game server. Check your connection and try again.',
  lobbyJoin: 'Join Room',
  lobbyCodeLabel: 'Room code',
  nameLabel: 'Your name',

  // Room chat (section 3.12).
  chatTitle: 'Chat',
  chatOpen: 'Chat',
  chatHide: 'Hide chat',
  chatPlaceholder: 'Say something',
  chatSend: 'Send',
  chatEmpty: 'Messages show here for everyone in the room. They are cleared when a new game starts or you leave.',
  chatYou: 'You',
  chatSomeone: 'Someone',
  chatNew: 'New message', // the popup of a new message (screen readers)
  // Who watches (section 3.9): the spectators, shown to everyone in the room.
  audienceSomeone: 'A spectator',
  audienceJoined: '{name} is watching',
  audienceLeft: '{name} stopped watching',
  audienceCount: '{count} watching', // the watchers button; {count} spectators
  audienceTitle: 'Watching',
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
  waitingHintRelay: 'Send this code to your opponent so they can join.',
  waitingPlaceholder: 'Waiting',
  waitingYou: 'You',
  waitingYouNamed: '{name} (you)',
  waitingCopy: 'Copy',
  waitingCopied: 'Copied',
  waitingInvite: 'Copy invite link',
  waitingLinkCopied: 'Link copied',
  waitingPressCtrlC: 'Press Ctrl+C',
  waitingLeave: 'Leave',
  waitingMovesFirst: 'Moves first',
  waitingOpponent: 'Opponent',

  // Character select (sections 3.5 and 3.6): the room's seats online, and
  // Player 1 and Player 2 on the game screen of Play on this computer.
  selectLocalTitle: 'Choose your character',
  selectLead: 'The first to pick plays X and moves first.',
  selectPlayer1: 'Player 1',
  selectPlayer2: 'Player 2',
  selectReady: 'Ready',
  selectUnready: 'Unready',
  selectIsReady: 'Ready',
  selectChoosing: 'Choosing',
  selectTaken: 'Taken',
  selectWaitingOther: 'Waiting for the other player',
  selectRestTurns: '{turns} turns', // a skill's rest turns, {turns} is COOLDOWN_SHORT or COOLDOWN_LONG
  selectTaglineWindRabbit: 'Fast and hard to read.',
  selectTaglineEarthBear: 'Slow and steady.',
  selectTaglineJadeSerpent: 'Patient, then sudden.',
  selectTaglineCloudEagle: 'Sees far, hides much.',
  skillAlwaysOn: 'Always on', // a passive skill (Sky Watch): no rest turns, no timer
  skillSilenced: 'Silenced by Hiss', // a skill the opponent's Hiss locks for this turn
  // Free Action (docs/free-action-design.md section 1): one skill per turn, then plant.
  skillAlreadyUsedError: SKILL_ALREADY_USED_ERROR, // the rules' refusal of a second skill, shown when a locked row is clicked
  skillUsedHint: 'Already used a skill this turn.', // the hint of every skill row after a skill
  skillUsedState: 'Next turn', // a ready skill row that cannot be used because a skill was used this turn
  plantToEndTurn: 'Now plant a seed to end your turn.', // the turn pill hint, status line and banner after a skill
  // The turn banner of a game on one screen and the first-game hints (src/ui/announce.js).
  turnBannerKicker: 'To play',
  hintWinTitle: 'Five in a row wins',
  hintWinText: 'Plant five of your flowers in an unbroken line: across, down or diagonally.',
  hintTouchTitle: 'Tap again to plant',
  hintTouchText: 'The first tap only shows where your seed would go, so a slip of the finger never costs a move.',
  hintCancel: 'Choose it again, press Esc or right click to cancel.',
  hintGotIt: 'Got it',
  cloudTargetPrompt: 'Cloud: choose the cloud centre', // the target step of Cloud Eagle's Cloud

  // Watch a match (sections 3.8 and 3.9): the spectator's room code
  // screen, the waiting room it sees, the live game card and the Room
  // closed notice.
  menuWatch: 'Watch a match',
  menuWatchHint: 'Follow a game with its room code',
  spectateTitle: 'Watch a match',
  spectateLead: 'Enter the code of a room to watch its game. Spectators cannot play or pick.',
  spectateWatchButton: 'Watch',
  spectateConnecting: 'Connecting',
  spectateWaitingTitle: 'Waiting for the game',
  spectateWaitingHint: 'You are watching. The game shows here when both players are Ready.',
  spectateHost: 'Host',
  spectateGuest: 'Guest',
  spectateLeave: 'Stop watching',
  watchingRoom: 'Watching room {code}',
  watchingHint: 'You are watching', // the HUD turn pill of a spectator
  watchingVersus: '{x} (X) vs {o} (O)',
  watchingTurn: "{name}'s turn",
  watchingWins: '{name} wins',
  watchingDraw: 'Draw, the board is full',
  watchingForfeit: '{name} wins, the opponent left',
  roomClosed: 'Room closed',
  roomClosedDetail: 'The host left, so the room is closed.',

  // Leave match on the game screen (section 3.13).
  leaveMatch: 'Leave',
  leaveMatchLabel: 'Leave match',
  leaveMatchTitle: 'Leave the match?',
  leaveMatchOnline: 'Your opponent wins this game, and the room closes.',
  leaveMatchLocal: 'This game ends and you go back to the menu.',
  leaveMatchConfirm: 'Leave match',
  leaveMatchStay: 'Keep playing',

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
  gameOverViewBoard: 'View board',
  gameOverShowResult: 'Show result',
});
