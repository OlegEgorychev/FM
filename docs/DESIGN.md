# Youth Academy Manager — design notes (current: v1.5)

Single-file game built from `src/` (see README / CLAUDE.md). EN/RU, Win98/CRT look, PT Sans (PT Mono in ReadMe). Static scanlines + soft vignette always on; rain/glare via "Screen effects" in the Start menu. Save: localStorage `yam_save_v1` (save format `v: 4` + `seasonStats`); last seen app version `yam_seen_version`.

## Versioning (strict)
`APP_VERSION` in `src/js/08-version-patch-notes.js` is the single source of truth → `<title>` (injected by `build.js`), `document.title`, taskbar `#app-title`, tray badge, ReadMe.txt. Newest `PATCH_NOTES` entry must match (build fails otherwise). Every change = new version + EN/RU notes + git tag.

Version map: v0.1 MVP · v0.2 Russian + readability · v0.3 roles/shouts/energy · v0.4 formations + radar + speeds · v0.5 league/calendar/dashboard · v0.6 Team Management + modals + Win98 polish · v0.7 60 FPS live pitch · v0.8 Smart Swap · v0.9 Game Feel + ReadMe · v1.0 Coach's Notebook 2.0 · v1.1 Touchline · v1.2 GitHub, modules, WebP · v1.3 softer vignette, Match icon above ReadMe. (Git history starts at v0.3; v0.1–v0.2 were not archived.)

## Navigation & loop
Main nav: Dashboard | Team Management | League Table. Match and Notebook appear only while the calendar unlocks them. ReadMe.txt: desktop icon / Start menu / tray badge.
Loop: Dashboard (calendar) → matchday modal → Team Management → Match (half-time pause, subs) → full-time modal → Notebook (roles) → Return to Dashboard → next matchday. 18 matchdays → season end → new season.

## Systems (00-utils-data.js, 05-game-state.js)
- Hidden attributes 1–20: Speed, Pass, Dribble, Shoot, Tackle, Save — never displayed.
- Roles (one per player, set in Notebook): Aggressive (Tackle ×1.5; lost visible duel → foul + yellow, 2nd = red), Playmaker (Pass ×1.5, passes more), Selfish (Dribble/Shoot ×1.5, rarely passes).
- Energy: in-match live drain 30–40% over 90'; under 30% → ×0.8; starting/subbed on under 50% → ×0.5; half-time +4; after match players keep real energy, unused subs +6; rest day +4. Squad 16 (11 + bench GK, DEF, MID, MID, FWD).
- Formations (10): slot lines DEF/MID/ATT decide who contests each third; `presence()` → line superiority ±4 (normalised: 4-4-2 vs 4-4-2 = 0); out of natural line ×0.85.
- Shouts: Attack/Defend ±3 to our attacking/defending rolls.

## League & calendar (04-league-calendar.js)
10 teams, double round-robin (circle method), Saturdays from 7 Sep 2002. AI strengths [3,2,1,1,0,0,−1,−2,−3] (hidden), AI rosters generated once per club. AI-vs-AI: Poisson, λ_home = 1.1 + Δ·0.035, λ_away = 0.85 − Δ·0.035 (rating = 50 + strength·4) ≈ 1.9 goals/game. `CalendarEngine.registerType(type, {blocking, label, onArrive})` + `onDay(fn)`.

## Match engine (06-match-engine.js)
- One headline action per minute (pass / dribble / shot = aim → strike → outcome), roll = (attr·multipliers + rand·10 + mods) vs (defender attr + rand·10 + mods).
- `ambient()` background play per minute (stats only): pass chance GK .05 / DEF .09 / MID .17 / ATT .07, take-on DEF .02 / MID .08 / ATT .15, rand·16 spread. Per match ≈ MID 17 passes, DEF 11 duels, ATT 14 dribbles. Results unchanged by it.
- Half-time: pause at 45' (`halfTime()`, `pause()`, `resume()`).
- Live subs: `substitute(outId, player)`, max 5, same slot, GK rules, no return.
- Tempo: 1×/2×/5× = 900/450/180 ms per minute; shot beats 1200/900/650 ms.

## Live pitch (09-live-pitch.js)
`MatchEngine` (events, `evLog`) → `PitchModel` (data: positions, targets, facing, ball path, trail/power, zoom hint, fx queue) → `PitchRenderer` (translate3d, camera 130% world + lazy lerp + push-in, trails, barks, facing notches, sub swap) → `MatchView` (one rAF loop, ≈0.05–0.3 ms/frame). Shake + CRT surge via UI hooks; reduced-motion respected.

## Screens (12-ui.js)
- Team Management: roster left, tactics board right; click/drag swaps; Smart Swap Highlighting (same position green, others dimmed but clickable).
- Match: three columns — live roster & subs | scoreboard, pitch (`.cam-holder` size container), log, shouts, speed | assistant coach (`assistantMessages`) & live stats.
- Notebook: 3 random players who played; "ok/total (rate%) (Season Avg)", colours >75% green / <40% red, `coachNote()` hint (11-notebook-helpers.js).

## Known balance observations
- Defend shout slightly better net than Attack.
- Fatigue ×0.5 is harsh: no rotation → bottom of the table.
- Correct roles are strong (×1.5). Background duels never produce cards.

## Portraits (v1.4)
- `PortraitGenerator` (top of `src/js/03-player.js`): 32x32 SVG, `shape-rendering="crispEdges"`, layers = background (+rain specks), jersey (home / away / GK kit), head (3 shapes) & skin (5), eyes/brows (neutral, tired, angry), mouth (neutral, smirk, grit), hair (messy, short, long, bald) & hair colour (4).
- `player.face` = 7 trait indices, rolled in `Player.generate()` and saved. `player.portraitSvg` is rebuilt in the constructor and dropped by `toJSON()`, so saves stay small. Saves from before v1.4 get a face hashed from id+name (stable).
- Mood comes from CSS (`src/css/12-portraits.css`): desaturate filter, scanlines, dark corner vignette. 40px in the live roster, 100px on Notebook cards.

## Player Profile Card (v1.5)
- `ProfileCard` in `src/js/11a-profile-card.js`, DOM `#pinfo-layer` in `src/index.html`, styles `src/css/13-profile-card.css` (z-index 75, above `Modal` at 70; `ui.alert()` closes it first).
- Triggers (all in `UIController.bind()`): document `contextmenu` on any `[data-pid]` (tactics board + live pitch tokens, Notebook cards) or roster `.r-row`; `[data-info]` "i" buttons (capture-phase click, `stopPropagation`) so click-to-swap / subs are never triggered.
- Shows: portrait (100px), name, number, `player.age` (14–16, rolled in `Player.generate()`, hashed for old saves), position, status, energy (live engine value during a match), role tag, season totals from `state.seasonOf()` (apps, goals, shots/on target, tackles won/duels, pass %), plus a live "today" column while a match runs (season totals are only added at full time).
- Coach's Note: `state.coachNotes[id]` keeps the last note shown in the Notebook (only the 3 players per match the Notebook covers — scarcity is intentional). Opponents get a card with today's numbers only.
- Hidden attributes are never rendered; smoke test checks the card text for attribute-like output.

## Club emblems + Calendar dashboard (v1.6)
- `EmblemGenerator` (04-league-calendar.js): crest = `[shape, pattern, primary, secondary]` (shield/circle/hexagon × solid/stripes/halved). Rasterised on a 32x32 grid, one `<path>` per colour + 1px dark outline, letter = first letter of the localized name. No `<clipPath>` ids. SVG strings cached per crest+letter.
- `team.crest` is saved; `team.emblemSvg` is a non-enumerable getter (never saved, follows the language). Old saves get a crest hashed from the name. `League.create(name, prevTeams)` keeps crests across seasons; the user club is always shield/halved academy blue.
- Dashboard = 3 panes: left (next event + 64px badge, main button, legend, club), centre (Sun–Sat month grid, `calMonth` = null follows the date, arrows browse the season; cells clickable → status bar text; diary below), right (latest played matchday with badges, top-5 mini table + user row if outside). Badges also in the League table and every fixture list (`fixtureHTML`).
