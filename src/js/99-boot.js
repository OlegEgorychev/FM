/* =========================================================
   BOOT
   ========================================================= */
const game = new GameState();
const ui = new UIController(game);
window.YAM = { game, ui, MatchEngine, League, CalendarEngine, L, ENERGY, FORMATIONS }; // handy for debugging in DevTools

