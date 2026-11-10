# Youth Academy Manager — design notes (current: v1.3)

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
