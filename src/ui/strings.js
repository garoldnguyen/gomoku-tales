// All English text of the menu, How to Play, Settings and Game over screens
// (docs/flow-design.md sections 3 and 8): ONE flat object, the single place
// to change or translate a sentence. Numbers in the text come from
// src/config.js, and skill and character names from SKILL_INFO and the
// character table, never typed twice. Pure (no DOM).

import { COOLDOWN_LONG, COOLDOWN_SHORT, ROCK_LIFETIME_TURNS, WIN_LENGTH } from '../config.js';
import { CHARACTERS, EARTH_BEAR, WIND_RABBIT } from '../logic/characters.js';
import { STONE_CONVERSION, TERRAIN_CREATION, TORNADO_ZONE, WIND_DASH } from '../logic/skills.js';
import { SKILL_INFO } from './skill-info.js';

const rabbit = CHARACTERS[WIND_RABBIT].name;
const bear = CHARACTERS[EARTH_BEAR].name;
const skill = (id) => SKILL_INFO[id].title;

export const STRINGS = Object.freeze({
  // Menu (section 3.1).
  gameTitle: 'Gomoku Tales',
  menuPlayOnline: 'Play Online',
  menuPlayLocal: 'Play on this computer',
  menuHowTo: 'How to Play',
  menuSettings: 'Settings',

  // How to Play (section 3.2).
  howToTitle: 'How to Play',
  howToRule1: `Two players take turns. ${rabbit} plants X and always goes first. ${bear} plants O.`,
  howToRule2: 'On your turn do one thing: plant on an empty plot, or use a skill. A skill takes your whole turn.',
  howToRule3: `${WIN_LENGTH} or more of your plants in an unbroken row, across, down or diagonally, win the game.`,
  howToRule4: `After you use a skill it rests for your next ${COOLDOWN_SHORT} turns (${skill(WIND_DASH)}, ${skill(TERRAIN_CREATION)}) or your next ${COOLDOWN_LONG} turns (${skill(TORNADO_ZONE)}, ${skill(STONE_CONVERSION)}).`,
  howToRule5: `A rock blocks a plot for both players and crumbles after ${ROCK_LIFETIME_TURNS} turns.`,
  howToRule6: 'If the board fills up and nobody has five in a row, the game is a draw.',
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

  // Game over (section 3.7).
  gameOverYouWin: 'You win',
  gameOverYouLose: 'You lose',
  gameOverWins: 'wins', // after the winning character's name in a local game
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
