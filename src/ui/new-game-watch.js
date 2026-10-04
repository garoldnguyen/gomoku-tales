// Tells the page when a new game is shown, so the old game's visuals go
// (src/main.js calls the renderer's reset). Pure (no DOM): a new game is a
// different game controller, or the same one with a new game number from
// the app (app.js getGameNumber: a start, a rematch or a local restart).
// Leaving the game (no controller) also counts, so nothing of the old game
// is left behind the menu.

// onNewGame() is called once per change. check(game, number) returns true
// when it called it.
export function watchNewGame(onNewGame) {
  let shownGame = null;
  let shownNumber = null;
  return {
    check(game, number) {
      if (game === shownGame && (game === null || number === shownNumber)) return false;
      const hadGame = shownGame !== null;
      shownGame = game;
      shownNumber = number;
      if (game === null && !hadGame) return false;
      onNewGame();
      return true;
    },
  };
}
