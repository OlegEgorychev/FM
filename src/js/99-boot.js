/* =========================================================
   BOOT
   ========================================================= */
BootScreen.start();   // v2.1: fake loading screen first (the game builds underneath it)
const game = new GameState();
const ui = new UIController(game);
window.YAM = { game, ui, MatchEngine, League, CalendarEngine, L, ENERGY, FORMATIONS }; // handy for debugging in DevTools

