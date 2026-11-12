#!/usr/bin/env node
/*
 * Youth Academy Manager — match engine balance harness (v3.3, no dependencies).
 * Loads the real engine (src/js/00-utils-data.js, 03-player.js, 06-match-engine.js) into a vm context,
 * builds two fixed teams and plays N instant matches (MatchEngine.runInstant()) per shout setup,
 * mirrored: team A / team B and home / away alternate, so squad and home-side effects cancel out.
 * Math.random is seeded → every run with the same arguments prints the same table.
 *
 *   node test/balance.js              500 matches per setup, seed 33
 *   node test/balance.js 2000 7       2000 matches, seed 7
 *   node test/balance.js --pairs 8    also average over 8 different random team pairs (robustness)
 *   node test/balance.js --json       machine-readable output
 *   node test/balance.js --log out.csv  v3.4: also write the duel-by-duel match log (MatchEngine.traceCsv) of the
 *                                     first 20 matches of every setup + one summary row per match (out.matches.csv)
 *
 * Table 3 (v3.4) — fatigue: one squad starts at 75/60/50/40/25% energy against a fresh one (live drain included).
 * Table 1 — whole-match shouts.  Table 2 — game states: neutral until 60', then the team that leads by one
 *   (LEAD) or trails by one (CHASE) switches to a shout; we report how often the leader still wins / the
 *   trailer avoids defeat.
 * Exit code 1 if the Attack-vs-Defense win share (wins / (wins + losses)) is outside 45–55%.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const argv = process.argv.slice(2);
const flag = k => { const i = argv.indexOf(k); return i < 0 ? null : argv[i + 1]; };
const nums = argv.filter((a, i) => /^\d+$/.test(a) && !['--pairs', '--log'].includes(argv[i - 1]));
const N = Math.max(4, parseInt(nums[0], 10) || 500);
const SEED = parseInt(nums[1], 10) || 33;
const PAIRS = parseInt(flag('--pairs'), 10) || 0;
const JSON_OUT = argv.includes('--json');
const LOG_FILE = flag('--log');
const LOG = LOG_FILE ? { rows: [], matches: [] } : null;
const TEAM_SEED = 5;   // a pair of equal-level (mod 0) 4-4-2 squads whose Neutral-vs-Neutral scoring ≈ the league average (~2.3)

function mulberry32(a) {
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Fresh engine context whose Math.random is a re-seedable mulberry32. */
function loadEngine(seed) {
  const SeededMath = Object.create(Math);
  let gen = mulberry32(seed);
  SeededMath.random = () => gen();
  const ctx = vm.createContext({ Math: SeededMath, console, setInterval, clearInterval });
  for (const f of ['00-utils-data.js', '03-player.js', '06-match-engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'js', f), 'utf8'), ctx, { filename: f });
  }
  const api = vm.runInContext('({ MatchEngine, Player, formationSlots, LINE_POS, SHOUT: typeof SHOUT === "undefined" ? null : SHOUT, fatigueMult: typeof fatigueMult === "function" ? fatigueMult : null })', ctx);
  return Object.assign(api, { reseed: s => { gen = mulberry32(s); } });
}

/** Two teams of equal level (mod 0), 4-4-2, everyone fresh. */
function makeTeams(E) {
  const used = new Set();
  const build = (name, base) => ({ name, formation: '4-4-2',
    players: E.formationSlots('4-4-2').map((s, i) => E.Player.generate(base + i, E.LINE_POS[s.line], used, 0, false, i + 1)) });
  return [build('A', 100), build('B', 200)];
}

const MENT = { Attack: 'attack', Defense: 'defend', Neutral: 'balanced' };
const SETUPS = [['Attack', 'Neutral'], ['Defense', 'Neutral'], ['Attack', 'Defense'], ['Neutral', 'Neutral']];
const HOOKS = { onUpdate() {}, onEnd() {}, onLog() {}, onSpeed() {} };

/** Match i of a mirrored series: which squad / which side carries the first shout. */
function fixture(i, A, B) {
  const xTeam = i % 2 === 0 ? A : B, yTeam = i % 2 === 0 ? B : A, swap = (i >> 1) % 2 === 1;
  return { home: swap ? yTeam : xTeam, away: swap ? xTeam : yTeam, xs: swap ? 1 : 0 };
}
const setShout = (eng, side, m) => { if (side === 0) eng.mentality = m; else eng.oppMentality = m; };

function runSetup(E, A, B, x, y, n, seed) {
  E.reseed(seed);
  const r = { setup: `${x} vs ${y}`, n, w: 0, d: 0, l: 0, gf: 0, ga: 0, shF: 0, shA: 0, otF: 0, otA: 0 };
  for (let i = 0; i < n; i++) {
    const { home, away, xs } = fixture(i, A, B), ys = 1 - xs;
    const eng = new E.MatchEngine(home, away, HOOKS, {});
    setShout(eng, xs, MENT[x]); setShout(eng, ys, MENT[y]);
    eng.runInstant();
    const gx = eng.sides[xs].score, gy = eng.sides[ys].score, tx = eng.teamTotals(xs), ty = eng.teamTotals(ys);
    if (LOG && E === LOG.E) {
      const names = [`${eng.sides[0].name}:${[x, y][xs === 0 ? 0 : 1]}`, `${eng.sides[1].name}:${[x, y][xs === 1 ? 0 : 1]}`];
      LOG.matches.push([`${x} vs ${y}`, i, names[0], names[1], eng.sides[0].score, eng.sides[1].score, eng.teamTotals(0).shots, eng.teamTotals(1).shots, eng.trace.length].join(','));
      if (i < 20) LOG.rows.push(E.MatchEngine.traceCsv(eng.trace, names, { setup: `${x} vs ${y}`, match: i }).split('\n').slice(LOG.rows.length ? 1 : 0).join('\n'));
    }
    r.gf += gx; r.ga += gy; r.shF += tx.shots; r.shA += ty.shots; r.otF += tx.onTarget; r.otA += ty.onTarget;
    if (gx > gy) r.w++; else if (gx === gy) r.d++; else r.l++;
  }
  r.winShare = r.w + r.l ? r.w / (r.w + r.l) : 0.5;
  return r;
}

/** Neutral to 60', then the side leading (or trailing) by exactly one goal switches to `shout`. */
function runState(E, A, B, mode, shout, n, seed) {
  E.reseed(seed);
  const r = { state: `${mode} + ${shout}`, n: 0, w: 0, d: 0, l: 0 };
  for (let i = 0; r.n < n && i < n * 20; i++) {
    const { home, away } = fixture(i, A, B);
    const eng = new E.MatchEngine(home, away, HOOKS, {});
    eng.instant = true; eng.begin();
    while (!eng.finished && (eng.minute < 60 || eng.pendingShot)) eng.tick();
    const diff = eng.sides[0].score - eng.sides[1].score;
    if (Math.abs(diff) !== 1) continue;
    const lead = diff > 0 ? 0 : 1, me = mode === 'LEAD' ? lead : 1 - lead;
    setShout(eng, me, MENT[shout]);
    eng.runInstant();
    const g = eng.sides[me].score - eng.sides[1 - me].score;
    r.n++; if (g > 0) r.w++; else if (g === 0) r.d++; else r.l++;
  }
  return r;
}

/** v3.4: one squad starts every match at `energy`, the other fresh (both drain live). Mirrored: the tired squad
    alternates A / B and home / away, so squad quality cancels out. */
function runFatigue(E, A, B, energy, n, seed) {
  E.reseed(seed);
  let gf = 0, ga = 0;
  for (let i = 0; i < n; i++) {
    const { home, away, xs } = fixture(i, A, B), tiredTeam = xs === 0 ? home : away, fresh = xs === 0 ? away : home;
    tiredTeam.players.forEach(p => { p.energy = energy; }); fresh.players.forEach(p => { p.energy = 100; });
    const eng = new E.MatchEngine(home, away, HOOKS, {});
    eng.runInstant();
    gf += eng.sides[xs].score; ga += eng.sides[1 - xs].score;
  }
  [A, B].forEach(t => t.players.forEach(p => { p.energy = 100; }));
  return { energy, gf: gf / n, ga: ga / n, diff: (gf - ga) / n };
}

function runAll(teamSeed, n, seed, main = false) {
  const E = loadEngine(teamSeed);
  const [A, B] = makeTeams(E);
  if (main && LOG) LOG.E = E;
  const setups = SETUPS.map(([x, y], k) => runSetup(E, A, B, x, y, n, seed + k * 1000));
  const states = [];
  for (const mode of ['LEAD', 'CHASE']) for (const s of ['Neutral', 'Attack', 'Defense']) states.push(runState(E, A, B, mode, s, Math.round(n / 2), seed + 7));
  const fatigue = main ? [75, 60, 50, 40, 25].map(en => runFatigue(E, A, B, en, n, seed + 11)) : [];
  return { setups, states, fatigue, E };
}

const pct = v => (v * 100).toFixed(1).padStart(5) + '%';
const per = (v, n) => (v / n).toFixed(2).padStart(5);
const rowSetup = r => `${r.setup.padEnd(20)} | ${pct(r.w / r.n)} ${pct(r.d / r.n)} ${pct(r.l / r.n)} | ${pct(r.winShare)}   | ${per(r.gf, r.n)} ${per(r.ga, r.n)} ${per(r.gf + r.ga, r.n)} | ${per(r.shF, r.n)} ${per(r.shA, r.n)} | ${per(r.otF, r.n)} ${per(r.otA, r.n)}`;

const main = runAll(TEAM_SEED, N, SEED, true);
if (LOG) {
  fs.writeFileSync(LOG_FILE, LOG.rows.join('\n') + '\n');
  fs.writeFileSync(LOG_FILE.replace(/(\.csv)?$/, '.matches.csv'), ['setup,match,home,away,home_goals,away_goals,home_shots,away_shots,duels', ...LOG.matches].join('\n') + '\n');
}
let pairs = null;
if (PAIRS) {
  const sum = SETUPS.map(([x, y]) => ({ setup: `${x} vs ${y}`, n: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, shF: 0, shA: 0, otF: 0, otA: 0 }));
  for (let k = 1; k <= PAIRS; k++) runAll(TEAM_SEED * 100 + k, N, SEED + k).setups.forEach((r, j) => { for (const f of ['n', 'w', 'd', 'l', 'gf', 'ga', 'shF', 'shA', 'otF', 'otA']) sum[j][f] += r[f]; });
  sum.forEach(r => { r.winShare = r.w / (r.w + r.l); });
  pairs = sum;
}

if (JSON_OUT) console.log(JSON.stringify({ setups: main.setups, states: main.states, fatigue: main.fatigue, pairs }, null, 1));
else {
  const head = 'Setup                | Win    Draw   Loss  | WinShare | GF/m  GA/m  Tot/m | ShF   ShA   | OnTgF OnTgA';
  console.log(`Balance: ${N} instant matches per setup, seed ${SEED}, team seed ${TEAM_SEED}, mirrored (first team's view)`);
  console.log(head); main.setups.forEach(r => console.log(rowSetup(r)));
  console.log('\nGame state at 60\' (±1 goal), then a shout     | Win    Draw   Loss  | n');
  for (const r of main.states) console.log(`${r.state.padEnd(46)} | ${pct(r.w / r.n)} ${pct(r.d / r.n)} ${pct(r.l / r.n)} | ${r.n}`);
  if (pairs) { console.log(`\nAveraged over ${PAIRS} other random team pairs (${N} matches each)`); console.log(head); pairs.forEach(r => console.log(rowSetup(r))); }
  console.log('\nFatigue: squad starts at X% vs a fresh squad   | GF/m  GA/m  Diff');
  for (const r of main.fatigue) console.log(`${(r.energy + '%').padEnd(46)} | ${r.gf.toFixed(2).padStart(5)} ${r.ga.toFixed(2).padStart(5)} ${r.diff.toFixed(2).padStart(5)}`);
  if (LOG) console.log(`\nMatch log written: ${LOG_FILE} (+ .matches.csv)`);
  if (main.E.fatigueMult) console.log('\nfatigueMult: ' + [100, 75, 50, 25, 0].map(e => `${e}%→${main.E.fatigueMult(e).toFixed(3)}`).join('  '));
}
const avd = main.setups.find(r => r.setup === 'Attack vs Defense');
const ok = avd.winShare >= 0.45 && avd.winShare <= 0.55;
if (!JSON_OUT) console.log(ok ? `OK: Attack vs Defense win share ${pct(avd.winShare).trim()} (target 45–55%)` : `FAIL: Attack vs Defense win share ${pct(avd.winShare).trim()} outside 45–55%`);
process.exit(ok ? 0 : 1);
