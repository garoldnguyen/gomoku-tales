// The main menu and its two overlays, How to Play and Settings
// (docs/flow-design.md sections 3.1 to 3.3). Pure (no DOM): the view
// models below give src/ui/menu-dom.js every string, event and state it
// draws, so node tests and shot mode see the same screens.

import * as CONFIG from '../config.js';
import { X } from '../logic/board.js';
import { CHARACTERS, EARTH_BEAR, WIND_RABBIT } from '../logic/characters.js';
import { LONG, getSkill } from '../logic/skills.js';
import { QUALITY_LEVELS } from '../render3d/quality.js';
import { FLOW_EVENTS, OVERLAYS, SCREENS } from './flow.js';
import { fullscreenViewModel } from './fullscreen.js';
import { PORTRAIT_ART, SKILL_ICON_ART } from './hud-view.js';
import { SKILL_INFO } from './skill-info.js';
import { STRINGS, howToRules } from './strings.js';

// The four menu buttons in their visual (and Tab) order. box is the
// data-hud-box name of the screenshot self-check (docs/shots.md).
export const MENU_BUTTONS = Object.freeze([
  Object.freeze({ id: 'play-online', label: STRINGS.menuPlayOnline, event: FLOW_EVENTS.PLAY_ONLINE, box: 'menu-play-online' }),
  Object.freeze({ id: 'play-local', label: STRINGS.menuPlayLocal, event: FLOW_EVENTS.PLAY_LOCAL, box: 'menu-play-local' }),
  Object.freeze({ id: 'howto', label: STRINGS.menuHowTo, event: FLOW_EVENTS.OPEN_HOWTO, box: 'menu-howto' }),
  Object.freeze({ id: 'settings', label: STRINGS.menuSettings, event: FLOW_EVENTS.OPEN_SETTINGS, box: 'menu-settings' }),
]);

// The events the menu screen may send to the flow (the buttons above, and
// Close or Escape on an overlay).
export const MENU_EVENTS = Object.freeze([...MENU_BUTTONS.map((button) => button.event), FLOW_EVENTS.CLOSE_OVERLAY]);

// The menu button that opens each overlay, so closing it gives that button
// the focus back.
export const OVERLAY_OPENER = Object.freeze({ [OVERLAYS.HOWTO]: 'howto', [OVERLAYS.SETTINGS]: 'settings' });

// The six rules lines of How to Play with the numbers of `config` (the
// game's src/config.js unless a test injects its own).
export function rulesLines(config = CONFIG) {
  return howToRules(config);
}

// How to Play: the rules lines, then each character with its skills. The
// skill text is SKILL_INFO's own, never a copy.
export function howToViewModel(config = CONFIG) {
  return {
    title: STRINGS.howToTitle,
    close: STRINGS.close,
    rules: rulesLines(config),
    skillsTitle: STRINGS.howToSkillsTitle,
    characters: [WIND_RABBIT, EARTH_BEAR].map((id) => {
      const character = CHARACTERS[id];
      return {
        id,
        name: character.name,
        stone: character.stone,
        team: character.stone === X ? 'blue' : 'red',
        portrait: PORTRAIT_ART[character.stone],
        skills: character.skills.map((skillId) => {
          const turns = getSkill(skillId).cooldownClass === LONG ? config.COOLDOWN_LONG : config.COOLDOWN_SHORT;
          return {
            id: skillId,
            icon: SKILL_ICON_ART[skillId],
            title: SKILL_INFO[skillId].title,
            cooldown: turns,
            cooldownText: `${STRINGS.howToCooldown} ${turns} ${STRINGS.howToTurns}`,
            description: SKILL_INFO[skillId].description,
          };
        }),
      };
    }),
  };
}

// The quality level names in table order (low, medium, high: the key order
// of QUALITY_LEVELS). No level name is written here.
export function qualityLevelNames() {
  return Object.keys(QUALITY_LEVELS).map((key) => QUALITY_LEVELS[key].name);
}

const capitalized = (word) => word.charAt(0).toUpperCase() + word.slice(1);

// Settings. env.quality is the level this window draws at, or null when
// there is no 3D renderer to switch (the 2D renderer); env.fullscreen is
// { supported, active } for fullscreenViewModel.
export function settingsViewModel({ quality = null, fullscreen = { supported: false, active: false } } = {}) {
  const fs = fullscreenViewModel(fullscreen);
  return {
    title: STRINGS.settingsTitle,
    close: STRINGS.close,
    qualityTitle: STRINGS.settingsQuality,
    qualityVisible: quality !== null,
    levels: qualityLevelNames().map((level) => ({
      level,
      label: capitalized(level),
      help: STRINGS[`settingsQualityHelp${capitalized(level)}`] ?? QUALITY_LEVELS[level].goal,
      current: level === quality,
      box: `settings-quality-${level}`,
    })),
    fullscreenTitle: STRINGS.settingsFullscreen,
    fullscreen: { visible: fs.visible, label: fs.ariaLabel, pressed: fs.pressed },
  };
}

// The whole menu layer for a flow state (flow.js). env: { quality,
// fullscreen } for Settings and config for How to Play. visible is false
// off the menu screen; howto and settings are null unless that overlay is
// open. focus names the button that gets the focus: the first menu button
// on the plain menu, an overlay's Close button while it is open.
export function menuViewModel(flow, env = {}) {
  const visible = flow.screen === SCREENS.MENU;
  const overlay = visible ? flow.overlay : OVERLAYS.NONE;
  return {
    visible,
    title: STRINGS.gameTitle,
    buttons: MENU_BUTTONS,
    overlay,
    howto: overlay === OVERLAYS.HOWTO ? howToViewModel(env.config) : null,
    settings: overlay === OVERLAYS.SETTINGS ? settingsViewModel(env) : null,
    focus: overlay === OVERLAYS.NONE ? MENU_BUTTONS[0].id : `${overlay}-close`,
  };
}
