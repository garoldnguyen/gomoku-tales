# Playing on a phone

Owner request, October 2026: the game was a little hard to play on a phone. The look, the flow and the rules
were fine; the trouble was how the phone's browser behaves around the page. This note lists each edge case,
what the game does about it, and where the code lives. Nothing here changes a rule or a screen's design.

## Edge cases and answers

| What the phone does | What went wrong | What the game does | Where |
|---|---|---|---|
| Double tap zooms the page | The second tap of tap to preview, tap to plant zoomed the page instead of planting | `touch-action: manipulation` on the page (pan and pinch, no double tap zoom) and `pinch-zoom` on the 3D view (one finger is the game's, two fingers pinch). Pinch zoom stays on purpose (the owner wants to zoom in on the board); the viewport has no `maximum-scale` or `user-scalable=no`, and no gesture is cancelled | `index.html`, `src/ui/mobile-guards.js` |
| Pull down to refresh, rubber band scroll | A drag on the board could reload the page and lose the match | `overscroll-behavior: none`, body `position: fixed` | `index.html` |
| Address bar slides in and out | `100vh` is taller than what is visible, the bottom of the screen was cut | `--vh100` is `100dvh` where the browser has it, `100vh` elsewhere; the stage and the 3D view use it | `index.html` |
| Soft keyboard opens | The layout jumped and the game shrank | `interactive-widget=resizes-visual`: the keyboard shrinks only the visible area | `index.html` |
| Tap on a text box under 16 px | iOS zooms into the box and does not zoom back | Join code, name and chat boxes are at least 16 px | `src/ui/screens.css`, `src/ui/chat.css` |
| Long press | The browser's menu (copy, share, save image) opened over the board; the contextmenu event was also read as a right click and cancelled the preview or the skill | The menu is always suppressed (except in a text box); a finger never counts as a right click on the board or the HUD; a second finger (not primary) is not a press | `src/ui/mobile-guards.js`, `src/ui/input.js`, `src/ui/hud.js` |
| Safari on iOS 18.2 and later: a finger's click says it is a mouse | The board takes a tap as a preview (first tap) and a plant (second tap) by the kind of pointer. Safari sends the click of a finger as a PointerEvent with `pointerType: "mouse"` (WebKit bug 282988) while its pointerdown says `touch`, so every tap planted at once with no preview, on iPhone only | The kind of pointer comes from the pointerdown before the click, never from the click's own `pointerType` (which is used only when no press was seen) | `src/ui/input.js` (`attachGameInput`) |
| Text selection, tap highlight, callout | Blue selection on cards, grey flash on taps | `user-select: none` (text boxes keep selection), transparent tap highlight, `-webkit-touch-callout: none` | `index.html` |
| Browser toolbars take the screen (Safari, in-app browsers) | A phone screen of 844 px shows about 690 px of page. The character select and the waiting room are 805 px tall and were centred, so the top and the bottom were cut off with no way to scroll: Ready and Leave were out of the window, and the Chat button lay over Copy | On a window narrower than 600 px or shorter than 600 px the panel scrolls inside the window and its seats, Ready and Back or Leave stay at the bottom on a solid bar (the bar takes the panel's padding, so the panel's height does not change); a tall window looks as before | `src/ui/room.css` (end of file) |
| Menus too small | The screens are drawn in a 960 x 540 unit (`--u`), which is tiny on a 390 px wide phone, and the lobby card was wider than the window | A floor for `--u` on narrow windows and on short touch windows; the lobby, join, watch and closed cards fit the width | `src/ui/screens.css` |
| Screen dims and locks during a slow turn | The lock closes the page's connection: the opponent sees an empty room and the game ends | Screen Wake Lock while past the menu (a game or a room); asked again when the page shows again and on a touch; a refusal or a missing API is ignored | `src/ui/wake-lock.js` |
| Back button or edge swipe | Left the page and lost the match without a word | One extra history entry while past the menu; Back presses the button the screen shows (Stay of the Leave card, Close of a panel, Back / Leave room / Back to menu, Leave match). On the menu Back leaves as usual | `src/ui/back-guard.js` |
| Page hidden (another app, lock button) | After 3 seconds of silence the other player saw "opponent left" and a 10 second countdown | The hidden page sends a ping that says it is away; the other side waits `PEER_AWAY_TIMEOUT_MS` (45 s) before the countdown and shows "Opponent is away. Waiting for them." | `src/net/presence.js`, `src/net/room.js`, `src/ui/app.js` |
| Page frozen and woken | The frozen page had heard nothing for a long time and blamed the other player at once | A pause longer than `SUSPEND_GAP_MS` between presence checks gives the peer a new window (`resumePresence`); an explicit Leave and a peer already gone are not forgiven | `src/net/presence.js`, `src/net/room.js` |
| Typing the invite link by hand | Hard on a phone | The invite button opens the system share sheet on a touch device that has one; if the player cancels, nothing more; if it fails, the link is copied as before | `src/ui/screens.js`, `src/ui/room-screens.js` |
| Open from the browser every time | Address bar, tabs, less room | `manifest.webmanifest` (standalone, icons 192 and 512, maskable) and the apple meta tags: "Add to Home Screen" opens the game full screen | `manifest.webmanifest`, `index.html`, `assets/app-icon-*.png` |

The wake lock and the back guard are driven by `app.onChange` (`syncMobile` in `src/main.js`), never by the
frame loop, so the frame path stays free of allocation (the FRAME_PATH test of `tests/render3d-high-polish.test.js`).
`visibilitychange` and `pageshow` call `app.setAway(document.hidden)`.

## Not done on purpose

- Reconnecting the WebSocket after the phone's system kills it (an iOS lock longer than the wake lock can
  prevent). The room ends as it does today. A future task could resume the room with the same code.
- Safe area insets (`viewport-fit=cover`): the page stays inside the safe area, so a notch never covers a card.
- Reading the Battery Status API to pick the frame rate: `docs/performance.md` already paces by touch device.

## How to check by hand

Open the game on a phone (or Chrome's device mode with touch) and try, in this order:

1. Menu: pinch zooms in and out, double tap does nothing, pull down does not reload.
2. Create Room, then Back on the phone: the Leave card or the lobby, never the page's previous site.
3. Join Room: tap the code box. The page does not jump in; the keyboard does not push the cards off screen.
4. In a game: press and hold on a plot (the preview stays), then tap again to plant.
5. Leave the page for 20 seconds from one phone: the other phone says "Opponent is away. Waiting for them."
   and does not count down. Come back: the game goes on.
6. Wait two minutes without touching: the screen does not dim (Chrome and Safari 16.4 and later).

Shot shapes `phone-bar` (390 x 690, the phone in Safari) and `phone-land` (844 x 390) show these cases: `bash tools/shots.sh --scene waiting --shape phone-bar`. In a scrolling panel the tool measures each box as the player sees it (cut to the panel, and to what the sticky bar leaves), because a box out of sight is reachable by scrolling.

Not covered: the game over card and the watched game on a phone turned sideways (844 x 390) still lie over the HUD cards.

Tests: `tests/mobile.test.js` (shell, guards, long press, wake lock, back guard, share, status line) and the
"away" tests at the end of `tests/net.test.js`.
