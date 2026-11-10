# Youth Academy Manager

A retro youth football manager: a rainy Sunday league on a CRT monitor, Windows 98 style.

**▶ Play:** https://olegegorychev.github.io/FM/

Runs in any modern browser. Your save is stored in the browser (localStorage).

## What's inside

- Hidden player attributes: the coach only sees match stats and decides which role to give each player.
- A 10-team league, 18 matchdays, a day-by-day calendar and a league table.
- Team management: 10 formations, drag-and-drop swaps, position hints.
- A live 2D match at 60 FPS: camera, player shouts, half-time, live substitutions, an assistant coach.
- English and Russian, switchable in the game.
- Patch notes are in the game, in the **ReadMe.txt** file on the desktop.

## Structure

```
index.html            ← the playable game (built from src/, do not edit by hand)
assets/               ← background art (WebP)
src/index.html        ← template: markup + {{CSS}}, {{JS}}, {{VERSION}} placeholders
src/css/NN-*.css      ← styles, concatenated in file-name order
src/js/NN-*.js        ← code, concatenated in file-name order (shared global scope)
build.js              ← builds src/ → index.html (no dependencies)
test/smoke.js         ← quick test: a full matchday in the browser, ~10 seconds
docs/DESIGN.md        ← design notes: mechanics, formulas, balance
CLAUDE.md             ← instructions for the AI assistant (how to make changes)
```

| Module | Contents |
|---|---|
| `00-utils-data.js` | utilities, constants, formations, energy |
| `01-i18n.js` | all texts (EN/RU) |
| `02-lang.js`, `03-player.js` | language, player |
| `04-league-calendar.js` | league, fixtures, event calendar |
| `05-game-state.js` | game state, saving, line-ups |
| `06-match-engine.js` | match simulation |
| `07-tactics-board.js` | tactics board |
| `08-version-patch-notes.js` | **version and patch notes** |
| `09-live-pitch.js` | live pitch: model, rendering, camera, effects |
| `10-modal.js`, `11-notebook-helpers.js` | dialog windows, notebook logic |
| `12-ui.js`, `99-boot.js` | interface and start-up |

## Development

```bash
node build.js          # build index.html
node build.js --check  # check that index.html is up to date
npm i && npm test      # quick test (Playwright)
```

## Versioning rule

Every change: bump `APP_VERSION` in `src/js/08-version-patch-notes.js`, add an entry at the top of `PATCH_NOTES` (EN + RU), build, test, and commit with a `vX.Y` tag. The build injects the version into `<title>` automatically and fails if the version and the patch notes don't match.
