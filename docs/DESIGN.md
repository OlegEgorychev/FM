# Youth Academy Manager — design notes (current: v2.2)

Single-file game built from `src/` (see README / CLAUDE.md). EN/RU, Win98/CRT look, PT Sans (PT Mono in ReadMe). Static scanlines + soft vignette always on; rain/glare via "Screen effects" in the Start menu. Save: localStorage `yam_save_v1` (save format `v: 4` + `seasonStats`); last seen app version `yam_seen_version`.

## Versioning (strict)
`APP_VERSION` in `src/js/08-version-patch-notes.js` is the single source of truth → `<title>` (injected by `build.js`), `document.title`, taskbar `#app-title`, tray badge, ReadMe.txt. Newest `PATCH_NOTES` entry must match (build fails otherwise). Every change = new version + EN/RU notes + git tag.

Version map: v0.1 MVP · v0.2 Russian + readability · v0.3 roles/shouts/energy · v0.4 formations + radar + speeds · v0.5 league/calendar/dashboard · v0.6 Team Management + modals + Win98 polish · v0.7 60 FPS live pitch · v0.8 Smart Swap · v0.9 Game Feel + ReadMe · v1.0 Coach's Notebook 2.0 · v1.1 Touchline · v1.2 GitHub, modules, WebP · v1.3 softer vignette, Match icon above ReadMe. (Git history starts at v0.3; v0.1–v0.2 were not archived.)

## Navigation & loop
Main nav: Dashboard | Team Management | League Table. Match and Notebook appear only while the calendar unlocks them. ReadMe.txt: desktop icon / Start menu / tray badge.
Loop: Dashboard (calendar) → matchday modal → Team Management → Match (half-time pause, subs) → full-time modal → Notebook (roles) → Return to Dashboard → next matchday. 18 matchdays → season end → new season.

## Systems (00-utils-data.js, 05-game-state.js)
- Hidden attributes: see "Attribute system (v1.8)" below — never displayed outside DEBUG.EXE.
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

## League statistics (v1.7)
- Assists: `MatchEngine.lastPass` = last completed pass of the side in possession (reset on turnover/kick-off). A goal credits it unless it was a free kick or the passer is the shooter. `blankStats()` now has `assists`.
- Every AI club has `team.squad`: 14 lightweight kids `{ id, name, pos, mp, goals, assists }` (no attrs, no faces). Ids are `t{teamId}_{i}`; the full match roster (`League.roster`) is built FROM this squad, so names and ids match.
- Background match (`simulateFixture` → `distributeStats`): GK + 10 random outfielders get `mp++`; each goal goes to a weighted scorer (`GOAL_W`: FWD 5, MID 2.2, DEF 0.6), 72% get a weighted assister (`ASSIST_W`: MID 3.6, FWD 2.4, DEF 1.1).
- User match: opponent kids are credited from live engine stats (`League.recordKids`); our kids use `seasonStats` (now with `assists`).
- UI: League tab = standings + results (left), Top Scorers / Top Assists top-7 (right, `renderLeaders`). Clicking a club opens `TeamRosterCard` (`11b-team-roster.js`, reuses the `.pinfo` chrome): badge, position, W-D-L, MP/G/A sorted by goals.
- Old saves: missing `squad` is generated on load, keeping the names of an already generated match roster.

## Attribute system (v1.8)
- `Player` (03-player.js) carries nested groups: `bio` {age 13–15, height, weight, strongFoot L/R, weakFoot 1–5} (position stays `p.position`), `physical` {acceleration, speed, agility, strength, baseStamina}, `technical` {firstTouch, dribbling, passing, crossing, shooting, tackling, goalkeeping*}, `tactical` {positioning, vision, decisions}, `psych` {passion, discipline, composure, potential 1–100}, `dyn` {condition, sharpness, morale 0–100}. *`goalkeeping` was added on top of the brief so keepers have their own skill.
- `p.energy` is a getter/setter for `dyn.condition`; `p.age` reads `bio.age`. Old `attrs` are gone; `AttrGen.fromLegacy()` derives stable values from pre-v1.8 saves (seeded by id+name). Ranges per position: `PROFILES` in 00-utils-data.js; AI clubs add `team.strength` to every skill.
- Engine composites (`COMPOSITE`, `p.rating(key)`): Pass = passing+vision · Mark = positioning+2·tackling (reads passes, blocks shots) · Dribble = dribbling+agility+firstTouch · Speed = acceleration+speed · Tackle = 2·tackling+strength+positioning · Shoot = 2·shooting+composure · Save = 2·goalkeeping+agility+positioning.
- Global modifiers: sharpness < 50 → every technical skill −2 (`p.skill()`); condition = live energy (×0.5 / ×0.8 as before); `moodBonus` = (morale−50)/25 × (0.55+passion/20), capped ±2.5, added to every roll. Pass also gets receiver firstTouch ±1.5 and crossing ±1 for balls into the final third. Decisions ≤7 → extra long shots from midfield, ≥15 → more passing. Drain × (1.15 − baseStamina·0.015).
- Dynamics: rest day −1 sharpness (floor 20), morale drifts 1 toward 60. After a match (`applyMatchDynamics`): sharpness full game +12, sub +6, unused −2; morale W +8 / D +1 / L −6, +5 per goal, −10 red, unused −2, × (0.6 + passion/25). Discipline is stored but not yet used.
- Balance check (600 sims, 6 random squads): win% 34 vs 36 in v1.7, pass % 68 vs 70, goals similar.

## DEBUG.EXE (v1.8)
- `DebugConsole` (11c-debug.js), DOM `#debug-layer`, styles `16-debug.css`, tray button `#btn-debug`.
- DATABASE: every academy kid × 39 columns (ID, BIO, PHYSICAL, TECHNICAL, TACTICAL, PSYCH, DYNAMIC, ENGINE composites + mood + role), sortable, heat colours, averages row.
- GOD MODE: restore condition 100 (also live engine), morale & sharpness 100, Force Win toggle (`state.cheats.forceWin`, saved; engine `mod()` +8 for us / −5 for them; cleared at full time). The only UI allowed to show hidden attributes.

## Club economy + narrative events (v1.9)
- `state.budget` (the user club's money, $500 at a new academy and for pre-v1.9 saves; carried across seasons; never below 0). Change it only via `state.addMoney(delta)` → `onBudget` hook flashes the taskbar `#hdr-budget` (green up / red down). Also in the Dashboard club summary.
- `EventEngine` + `DialogueView` + `NARRATIVE_EVENTS` in `src/js/11d-events.js`, styles `src/css/17-dialogue.css`, DOM `#talk-layer` (z 90, covers the taskbar too).
- Event = `{ id, trigger(state, date) → bool, cast(state) → {role: playerId} | null, execute(ctx) }`; `execute` calls `ctx.show({ face, name, role, text, choices })`, choice = `{ key, tone red|gray|green, cost?, gain?, who, run() → diary vars }`. Texts are i18n keys `ev.<id>.*` (+ `.diary`).
- Flow: `UIController.runCalendar()` → after every simulated non-match day `events.roll(date)` (cooldown 6 days, each event 5%/day) → `fire()` saves `state.pendingEvent {id, date, cast, resume}` and opens the dialogue; calendar stops, sim button disabled. `choose()` applies money + effect, logs `state.eventLog`, writes a diary line, then resumes the calendar if `resume`. A reload re-opens the pending dialogue; Esc / backdrop never close it. Choices with `cost > budget` are rendered `disabled`.
- Torn Boots: snitch = random kid (his portrait), talented kid = one of the 6 highest potentials (not twice per season). A: −$150, morale 100. B: agility −2 (permanent).
- Rich Kid's Dad: silhouette portrait (`PortraitGenerator.silhouette()`), son = lowest hidden `player.overall`. A: +$300 and story flag `Promised_Start` (`player.flags`, separate from the role tag, shown as a "$ PROMISED START" chip). B: his morale −20. At kick-off `checkPromises()`: starter → kept; not starting → morale −30 and the father takes back $150. Pre-match log warns either way.
- DEBUG.EXE GOD MODE: +$500, fire any event, toggle random events. DATABASE: OVR + FLAGS columns.

## Quick Sim (v2.0)
- `MatchEngine.tick()` is the whole match maths for one beat (minute, drain, action, ambient, half/full time). Drivers: `start()` = setInterval paced by SPEED/HIGHLIGHT with `notify()` → `hooks.onUpdate` each beat; `runInstant()` = synchronous loop over the same `tick()` (≈110 iterations, ~2 ms), `instant = true` → no timers, no onUpdate/onGoal, half-time gives the same +4% without pausing. `onLog`, `onEnd` still fire.
- UI: `createEngine()` shared by Start and `#btn-instant` (`onInstantSim()`): pre-match → whole match; half-time / mid-match → "SIM TO FULL TIME" plays the rest (subs + shouts kept). `onMatchEnd` records everything as usual; with `eng.instant` it skips the full-time dialog and opens the Notebook.
- Smoke test: with a seeded `Math.random` the visual and instant drivers produce identical scores, stats and energy (3 seeds).

## Boot screen + Match Summary (v2.1)
- `#loading-overlay` (z 9999) is static markup at the top of `<body>`; `BootScreen` (02a-boot-screen.js) starts first in 99-boot.js. Scene A = credits art `assets/boot-credits.webp` (CSS chrome "CREATED BY / EGORYCHEV OLEG" fallback if the asset is missing), scene B (after 42%) = `PixelFont.svg()` 5x7 chrome/red pixel logo + sparks. Bar fills in random 5–8 s (chunky steps + ASCII bar), `boot.phases` (EN/RU) change every second, then an 0.8 s fade and removal (`yam:booted` event). Click / any key skips; `?noboot` disables (smoke test).
- `MatchEngine.matchEvents` `{ minute, type goal|yellow|red|injury, playerName, playerId, isHomeTeam (= our side), side, assist? }`, filled inside tick() → identical in visual and instant mode. `htScore` at half-time.
- Knocks: failed dribble (tackled) → `maybeInjure()`: 3% × (1.4 − strength·0.04), once per player per match, −25 energy, log `eng.injury`. No long-term absence yet.
- `lastReport` now carries `events`, `ht`, `totals`, `poss`, `instant`. `MatchSummary` (11e-match-summary.js, `#msum-layer`) opens at full time (0.7 s after the whistle; at once after Quick Sim): score + badges, W/D/L, venue, HT; two-column timeline (our club left), formatted `45' ⚽ L. Smith (A. Jones)`; possession / shots / pass % / cards; "[ Proceed to Coach's Notebook ]". × / Esc keeps you on the match screen.

## Consequences: queue, steps, match-day events, injuries & suspensions (v2.2)
- Event fields: `when: 'day' | 'matchday' | 'scheduled'`. `trigger(state, date, ctx)` (`ctx` = matchContext on match days). Choice extras: `next: '<step>'` (multi-step: same event re-executes with `ctx.step`, saved in `pendingEvent.step`), `debt: n` (forced payment, never disabled, may push the budget below $0), `ctx.schedule(id, { days | date, matchDay })` inside `run()`.
- `state.eventQueue` `[{ id, due, matchDay, from }]` (saved). `roll()` (non-match day) first fires a due non-matchDay item, then random `day` events (cooldown, `enabled`). `rollMatchDay()` runs in `onMatchdayArrived` BEFORE the matchday dialog: due matchDay items first, then random `matchday` events; `pendingEvent.after = 'matchday'` → `afterMatchdayEvent()` shows the matchday dialog. Queue items ignore `enabled` and the cooldown. A matchDay item due on a non-match day waits for the next match day.
- `player.injuryDays` (calendar days; `tickInjuries()` on every rest day AND on the match day in `closeMatchday`) and `player.suspensionMatches` (−1 after every match he did not play). `player.available` = no injury, no ban, no `Benched` flag. `swapPlayers` returns `unavail_inj|sus|deal`; `MatchEngine.substitute` returns `unavail`; `ensureAvailableXI()` replaces unavailable starters (same position, best overall) after every event choice, on match-day arrival and in `createEngine()`. Badges: `UIController.statusBadge()` (✚ days / red card matches / $ deal).
- After a match (`applyAvailabilityAfterMatch`): bans tick, `Benched` cleared, red card → 1-match ban, a knock becomes an injury 35% of the time (4–12 days).
- Events: `bus` (match day, away only, 20%: −$50 / condition ×0.7), `knock` (4%: −$200 → 3 days / 14 days), `sponsor` (budget < $300, 6%, once per season: +$500 → schedules `favor` 14 days later on a match day), `favor` (scheduled only: bench top 3 by overall with `Benched` + team morale −20 / forced −$500, if the budget goes negative team morale −30), `ulti` (discipline < 8, 5%: fine +$20 & morale −10 / office → step 2: 2-match ban or discipline −2 & morale +5).
