# Working on this repo (for AI assistants)

Read `docs/DESIGN.md` first (mechanics, formulas, balance). Do NOT read whole files: grep for what you need.

## Rules
- Never edit `index.html` at the root by hand — it is built from `src/`.
- Every change = new version:
  1. bump `APP_VERSION` in `src/js/08-version-patch-notes.js`,
  2. add a new entry at the TOP of `PATCH_NOTES` (EN + RU, 3–6 short bullets),
  3. `node build.js` (injects the version into `<title>`; fails if version and notes differ),
  4. `node test/smoke.js` (must print "All N checks passed"; add a check for new features),
  5. commit `vX.Y: <summary>` + annotated tag `vX.Y`, push `main` and the tag.
- All player-facing text goes through `I18N` (EN + RU) in `src/js/01-i18n.js`; Russian lines keep player names in the nominative case.
- Hidden player attributes are never shown in the UI (only DEBUG.EXE).
- Money changes go through `state.addMoney()`; narrative events live in `src/js/11d-events.js` (`NARRATIVE_EVENTS`).
- Keep the 2000s Win98 / CRT look; no native `alert()` — use `Modal` (`this.alert(...)` in the UI).

## Where things live
- Constants (energy, formations, speeds): `src/js/00-utils-data.js`, `MatchEngine.SPEED/HIGHLIGHT/AMBIENT/MAX_SUBS` in `06-match-engine.js`.
- Match maths: `MatchEngine.eff()` (multipliers), `mod()` (shouts), `sup()` (line superiority), `ambient()` (background stats).
- Live pitch: `PitchModel` (data) → `PitchRenderer` (DOM) → `MatchView` (rAF loop) in `09-live-pitch.js`.
- UI: `UIController` in `12-ui.js` (search `/* ---------- SECTION`).
- Styles: one file per feature in `src/css/`, `99-responsive.css` last.

## Cheap workflow
`grep -n "keyword" src -r` → edit the few lines → build → smoke test → commit. Screenshots only for visual changes (`node test/smoke.js --shots` → `test/shots/`).
