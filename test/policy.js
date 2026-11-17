#!/usr/bin/env node
/*
 * v3.21 — POLICY HARNESS: scripted coaches play the real game and are compared.
 *   node test/policy.js                      20 seeds × 8 weeks per policy (run `node build.js` first)
 *   node test/policy.js --seeds 10 --weeks 6
 *   node test/policy.js --log out.csv        one row per seed × policy (+ out.weeks.csv: one row per match)
 *   node test/policy.js --baseline           v3.20 behaviour for the "before" table: cohesion has no effect (COH.MAX 0,
 *                                            no knock term), the empty-week penalty stays flat −2, no low-training fee rule.
 *                                            Gates are reported but never fail the run in this mode.
 *   node test/policy.js --json
 *   node test/policy.js --no-force           v3.22: don't force the money offers (see below); --offers K = their chances × K
 *   node test/policy.js --file other.html    run against another build (v3.22 "before" table: the v3.21 index.html; the v3.22
 *                                            money picks + `greedy` are shimmed in when the build lacks them)
 *
 * Headless like test/smoke.js (Playwright + the built index.html): the full day loop, events, the cash desk, the locker,
 * Quick Sim and the post-match windows all run through the game's own code. Every choice goes through ui.policyPick().
 * Each seed reloads the page with Math.random seeded (mulberry32, from ?seed=N) → one seed = the same world, the same draft
 * (the first 15 kids of the Yard Match pool) and, until the policies diverge, the same random stream for every policy.
 *   first     — every window: the first enabled button; the week confirmed as it stands (empty); no reminders, no office,
 *               Quick Sim never opens the Match Summary (no Coach's Word). The playtest script.
 *   empty     — 0 trainings, every other choice as `reference`.
 *   reference — Tue + Thu Match Practice, "Remind all", Coach's Word fits the result, REVIEW takes a card whose role a
 *               ✓ confirmed clue points to (else the first), AFTER_GAME: the first remark + "Keep as is" (draw: praise).
 *               Event dialogues: the first enabled button, except (v3.22) money offers: refuses the dad and the pool, takes the
 *               scout's kit money and the showcase, at `scoutpoach` talks to the family if AP > 0 (else keeps him); promise card: keep.
 *   overload  — Mon–Fri, 5 trainings; every other choice as `reference`.
 *   greedy    — (v3.22) takes every money offer (dad, scout, pool), keeps every promise, accepts the showcase, lets a poached kid go;
 *               everything else as `reference`.
 * v3.22 FORCED OFFERS (harness only, the same for every policy): each money offer (dad, scout, pool) fires at least once in
 *   weeks 1–3 — from a target day picked from the seed (dad: day 2–14 of the run, scout / pool: day 3–18) its chance is 1 on
 *   every roll until it has fired; the event's own conditions still apply (scout / pool after matchday 1, the 6-day cooldown).
 *   Chosen over a ×4 chance boost: the boost fills the event cooldown with offers and crowds out knocks / ultimatums, and moved
 *   `empty` wk 3–8 from ≈ 30 % to 38–42 % (a v3.21 gate) for reasons that have nothing to do with money.
 *   The report counts the offers fired / taken per run (wrapped EventEngine.choose).
 * Gates (exit 1): win share reference − first ≥ 15 pp; empty weeks 3–8 win share ≤ 35 %; overload win share < reference;
 *   (v3.22) greedy (Parents + Squad + Board) Δ ≤ reference Δ − 8; greedy win share ≤ reference; first ΔBudget ≤ reference + $200.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const SEEDS = parseInt(flag('--seeds', 20), 10);
const WEEKS = parseInt(flag('--weeks', 8), 10);
const LOG = flag('--log', null);
const BASELINE = argv.includes('--baseline');
const JSON_OUT = argv.includes('--json');
const POLICIES = (flag('--policies', 'first,empty,reference,overload,greedy')).split(',');
const OFFERS = parseFloat(flag('--offers', 1));
const FORCE = !argv.includes('--no-force');
const FILE = 'file://' + path.resolve(flag('--file', path.resolve(__dirname, '..', 'index.html')));
const MONEY_IDS = ['dad', 'scout', 'pool'], TAKE = { dad: 'ev.dad.a', scout: 'ev.scout.a', pool: 'ev.pool.a' };

/** One seed of one policy: returns the run's numbers (or throws). */
async function playOne(page, policy, seed) {
  await page.goto(`${FILE}?noboot&seed=${seed}&offers=${OFFERS}${FORCE ? '&force' : ''}${BASELINE ? '&baseline' : ''}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.YAM && window.YAM.ui);
  await page.evaluate(() => {
    const s = YAM.game, ui = YAM.ui;
    ui.modal.close();
    // the same sensible draft for every policy: the best of the pool by hidden overall, 2 GK / 5 DEF / 5 MID / 3 FWD by the hidden
    // archetype, then the XI by archetype (a coach who reads the yard notes well) — the policies differ only in what they do afterwards
    const want = { GK: 2, DEF: 5, MID: 5, FWD: 3 }, pick = [];
    const pool = s.draft.pool.map(id => s.globalPlayers.find(p => p.id === id)).sort((a, b) => b.overall - a.overall || (a.id < b.id ? -1 : 1));
    for (const p of pool) if (pick.length < WORLD.DRAFT_SIGN && want[p.archetype] > 0) { want[p.archetype]--; pick.push(p); }
    for (const p of pool) if (pick.length < WORLD.DRAFT_SIGN && !pick.includes(p)) pick.push(p);
    for (const p of pick) s.toggleDraft(p.id);
    ui.draft.start();
    ui.modal.close();
    const free = [...s.squad], xi = s.slots().map(sl => { const i = free.findIndex(p => NATURAL_LINE[p.archetype] === sl.line); return free.splice(i < 0 ? 0 : i, 1)[0]; });
    s.lineup = xi.map(p => p.id); s.save(); ui.prepareMatch();
    window.__trn = []; window.__m = [];
    const orig = s.dayRoutine.bind(s);
    s.dayRoutine = (...a) => { const r = orig(...a); if (r.training) window.__trn.push({ date: a[0], att: r.attended, n: s.squad.length }); return r; };
    window.__start = { budget: s.budget, rep: { ...s.rep }, coh: s.cohesion };
    window.__ch = [];   // v3.22: every answered dialogue choice ({ id, key }) — offers fired / taken, promise cards, poach outcomes
    const ev = ui.events, ch = ev.choose.bind(ev);
    ev.choose = c => { const pe = s.pendingEvent; if (pe && c && !c.next) window.__ch.push({ id: pe.id, key: c.key }); return ch(c); };
  });
  const startDate = await page.evaluate(() => YAM.game.calendar.date);
  for (let guard = 0; guard < WEEKS * 12; guard++) {
    const st = await page.evaluate(() => ({ phase: YAM.game.phase, md: YAM.game.league.playedMatchdays() }));
    if (st.phase === 'seasonEnd' || (st.md >= WEEKS && st.phase === 'calendar')) break;
    await page.evaluate(p => {
      const s = YAM.game, before = s.lastReport;
      YAM.ui.autoSim({ policy: p });
      if (s.lastReport && s.lastReport !== before) window.__m.push({ md: s.lastReport.md, r: s.lastReport.result, gf: s.lastReport.gf, ga: s.lastReport.ga, coh: s.lastReport.coh });
    }, policy);
    await page.waitForFunction(() => { const s = YAM.game, ui = YAM.ui;
      return !ui.cal.running && !ui.events.view.autoT && (s.phase !== 'calendar' || !s.pendingEvent); }, null, { timeout: 60000, polling: 20 });
  }
  return page.evaluate(({ policy, seed, startDate }) => {
    const s = YAM.game, st = window.__start, led = {};
    for (const m of Object.values(s.ledger || {})) for (const [k, v] of Object.entries(m)) led[k] = (led[k] || 0) + v;
    const att = window.__trn.filter(t => t.n), weeks = Math.max(1, s.league.playedMatchdays());
    const a = s.attentionSummary('season');
    return { policy, seed, startDate, end: s.calendar.date, matches: window.__m, trainings: att.length, perWeek: att.length / weeks,
      attend: att.length ? att.reduce((x, t) => x + t.att / t.n, 0) / att.length : null,
      dParents: s.rep.parents - st.rep.parents, dSquad: s.rep.squad - st.rep.squad, dBoard: s.rep.board - st.rep.board,
      dBudget: s.budget - st.budget, ledger: led, cohEnd: s.cohesion,
      money: s.eventLog.filter(e => /\.a$/.test(e.choice) && ['dad', 'scout', 'pool', 'ulti'].includes(e.id)).map(e => e.id),   // the money offers taken
      choices: window.__ch, leaks: s.eventLog.filter(e => e.id === 'poolleak').length,
      firstShare: a ? a.first : null, clicks: a ? a.clicks : 0 };
  }, { policy, seed, startDate });
}

function summarise(runs) {
  const all = runs.flatMap(r => r.matches), late = all.filter(m => m.md >= 3);
  const share = (list, k) => list.length ? list.filter(m => m.r === k).length / list.length : 0;
  const avg = f => runs.length ? runs.reduce((a, r) => a + (f(r) ?? 0), 0) / runs.length : 0;
  const led = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.ledger)) led[k] = (led[k] || 0) + v / runs.length;
  const money = {};
  for (const r of runs) for (const id of r.money || []) money[id] = (money[id] || 0) + 1 / runs.length;
  const offers = {};   // v3.22: per run — fired / taken per money offer, promise cards (keep / break), poach outcomes, pool leaks
  const inc = (k, v = 1) => { offers[k] = (offers[k] || 0) + v / runs.length; };
  for (const r of runs) {
    for (const c of r.choices || []) {
      if (MONEY_IDS.includes(c.id)) { inc(c.id + '.fired'); if (c.key === TAKE[c.id]) inc(c.id + '.taken'); }
      if (c.id === 'promise') inc(/keep/.test(c.key) ? 'promise.keep' : 'promise.break');
      if (c.id === 'scoutpoach') inc({ 'ev.scoutpoach.a': 'poach.keep', 'ev.scoutpoach.c': 'poach.letGo', 'ev.scoutpoach.stayOk': 'poach.talkStay', 'ev.scoutpoach.leaveOk': 'poach.talkLeave' }[c.key] || 'poach.other');
    }
    inc('pool.leak', r.leaks || 0);
  }
  return { n: runs.length, matches: all.length, W: share(all, 'W'), D: share(all, 'D'), L: share(all, 'L'),
    W38: share(late, 'W'), D38: share(late, 'D'), L38: share(late, 'L'),
    gf: all.length ? all.reduce((a, m) => a + m.gf, 0) / all.length : 0, ga: all.length ? all.reduce((a, m) => a + m.ga, 0) / all.length : 0,
    dParents: avg(r => r.dParents), dSquad: avg(r => r.dSquad), dBoard: avg(r => r.dBoard), dBudget: avg(r => r.dBudget),
    perWeek: avg(r => r.perWeek), attend: avg(r => r.attend), coh: all.length ? all.reduce((a, m) => a + (m.coh ?? 50), 0) / all.length : 0,
    ledger: led, money, offers, firstShare: avg(r => r.firstShare), dRep: avg(r => r.dParents + r.dSquad + r.dBoard) };
}

(async () => {
  const t0 = Date.now();
  const browser = await chromium.launch();
  const runs = Object.fromEntries(POLICIES.map(p => [p, []]));
  const errors = [];
  await Promise.all(POLICIES.map(async policy => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => {
      window.YAM_SKIP_REPORTS = true;
      const q = new URLSearchParams(location.search), seed = parseInt(q.get('seed'), 10);
      if (Number.isFinite(seed)) {   // mulberry32 — the whole page's Math.random is reproducible per seed
        let a = (seed * 2654435761) >>> 0;
        Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      }
      const boost = parseFloat(q.get('offers'));
      window.addEventListener('DOMContentLoaded', () => {
        if (boost > 0 && boost !== 1) for (const k of ['DAD_CHANCE', 'SCOUT_CHANCE', 'POOL_CHANCE']) EVENTS_CFG[k] *= boost;   // v3.22 offer boost
        if (q.has('force') && Number.isFinite(seed)) {   // v3.22 forced offers (see the header); target days from the seed, not Math.random
          let h = (seed * 2246822519) >>> 0; const r = (a, b) => { h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0; h = (h ^ (h >>> 16)) >>> 0; return a + h % (b - a + 1); };
          const want = { DAD_CHANCE: ['dad', r(2, 14)], SCOUT_CHANCE: ['scout', r(3, 18)], POOL_CHANCE: ['pool', r(3, 18)] }, fired = {};
          const orig = EventEngine.prototype.roll;
          EventEngine.prototype.roll = function (date, opts) {
            const t0 = (window.__forceFrom ||= date), saved = {};
            for (const [k, [id, d]] of Object.entries(want)) if (!fired[id] && isoDays(t0, date) >= d) { saved[k] = EVENTS_CFG[k]; EVENTS_CFG[k] = 1; }
            const out = orig.call(this, date, opts);
            Object.assign(EVENTS_CFG, saved);
            const id = this.state.pendingEvent?.id; if (id) fired[id] = true;
            return out;
          };
        }
        if (!POLICY.NAMES.includes('greedy')) {   // an older build ("before" table): the v3.22 coaches' money picks, shimmed in
          POLICY.NAMES.push('greedy'); POLICY.DAYS.greedy = POLICY.DAYS.reference;
          const by = k => o => o.findIndex(x => x.key === k);
          const R = { 'talk:dad': by('ev.dad.b'), 'talk:pool': by('ev.pool.b'), 'talk:scout': by('ev.scout.a'), 'talk:scoutvisit': by('ev.scoutvisit.a') };
          const G = { 'talk:dad': by('ev.dad.a'), 'talk:pool': by('ev.pool.a'), 'talk:poolloss': by('ev.poolloss.a') };
          for (const w of new Set([...Object.keys(R), ...Object.keys(G)]))
            UIController.POLICY_PICK[w] = (o, st) => ((window.YAM.ui.autoPolicy === 'greedy' && G[w]) || R[w])?.(o, st) ?? null;
        }
      });
      if (q.has('baseline')) window.addEventListener('DOMContentLoaded', () => {   // v3.20 behaviour (see the header)
        COH.MAX = 0; COH.MAX_UP = 0; COH.KNOCK_DIV = 1e12; WEEK.EMPTY_CAP = WEEK.EMPTY_BOARD; FINANCE.LOW_TRAINING_PAY = 1;
      });
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${policy}: ${e.message}`));
    page.on('dialog', d => { errors.push(`${policy}: native dialog ${d.message()}`); d.dismiss(); });
    for (let seed = 1; seed <= SEEDS; seed++) {
      try { runs[policy].push(await playOne(page, policy, seed)); }
      catch (e) { errors.push(`${policy} seed ${seed}: ${e.message.split('\n')[0]}`); }
    }
    await ctx.close();
  }));
  await browser.close();

  const sum = Object.fromEntries(POLICIES.map(p => [p, summarise(runs[p])]));
  const pct = v => (v * 100).toFixed(1).padStart(5) + '%';
  const sg = (v, d = 1) => (v >= 0 ? '+' : '') + v.toFixed(d);
  const gates = [];
  if (sum.reference && sum.first) gates.push({ name: 'win share reference − first ≥ 15 pp', v: (sum.reference.W - sum.first.W) * 100, ok: sum.reference.W - sum.first.W >= 0.15 });
  if (sum.empty) gates.push({ name: 'empty: win share weeks 3–8 ≤ 35 %', v: sum.empty.W38 * 100, ok: sum.empty.W38 <= 0.35 });
  if (sum.overload && sum.reference) gates.push({ name: 'overload win share < reference', v: (sum.overload.W - sum.reference.W) * 100, ok: sum.overload.W < sum.reference.W });
  if (sum.greedy && sum.reference) {   // v3.22: money has a bill
    gates.push({ name: 'greedy Δ(Parents+Squad+Board) ≤ reference − 8', v: sum.greedy.dRep - sum.reference.dRep, ok: sum.greedy.dRep <= sum.reference.dRep - 8 });
    gates.push({ name: 'greedy win share ≤ reference (pp)', v: (sum.greedy.W - sum.reference.W) * 100, ok: sum.greedy.W <= sum.reference.W });
  }
  if (sum.first && sum.reference) gates.push({ name: 'first ΔBudget ≤ reference + $200', v: sum.first.dBudget - sum.reference.dBudget, ok: sum.first.dBudget <= sum.reference.dBudget + 200 });
  if (LOG) {
    const rows = ['policy,seed,matches,W,D,L,trainings,per_week,attendance,d_parents,d_squad,d_board,d_budget,fee,grant,donation,rent,event,coh_end,first_share'];
    const wrows = ['policy,seed,md,result,gf,ga,cohesion'];
    for (const p of POLICIES) for (const r of runs[p]) {
      const c = k => r.matches.filter(m => m.r === k).length;
      rows.push([p, r.seed, r.matches.length, c('W'), c('D'), c('L'), r.trainings, r.perWeek.toFixed(2), r.attend == null ? '' : r.attend.toFixed(3), r.dParents, r.dSquad, r.dBoard, r.dBudget,
        ...['fee', 'grant', 'donation', 'rent', 'event'].map(k => r.ledger[k] || 0), r.cohEnd.toFixed(1), r.firstShare == null ? '' : r.firstShare.toFixed(3)].join(','));
      for (const m of r.matches) wrows.push([p, r.seed, m.md, m.r, m.gf, m.ga, m.coh ?? ''].join(','));
    }
    fs.writeFileSync(LOG, rows.join('\n') + '\n');
    fs.writeFileSync(LOG.replace(/(\.csv)?$/, '.weeks.csv'), wrows.join('\n') + '\n');
  }
  if (JSON_OUT) console.log(JSON.stringify({ seeds: SEEDS, weeks: WEEKS, baseline: BASELINE, summary: sum, gates, errors }, null, 1));
  else {
    console.log(`Policy harness${BASELINE ? ' (BASELINE = v3.20 behaviour)' : ''}: ${SEEDS} seeds × ${WEEKS} weeks per policy, offers ${FORCE ? 'forced once' : 'not forced'}${OFFERS !== 1 ? ' ×' + OFFERS : ''}, ${FILE.split('/').slice(-2).join('/')}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    console.log('Policy     | W      D      L     | W wk3-8 D wk3-8 L wk3-8 | GF   GA   | ΔParents ΔSquad ΔBoard  ΣRep | ΔBudget | Trn/wk Attend | Cohesion');
    for (const p of POLICIES) { const x = sum[p];
      console.log(`${p.padEnd(10)} | ${pct(x.W)} ${pct(x.D)} ${pct(x.L)} | ${pct(x.W38)}  ${pct(x.D38)}  ${pct(x.L38)}  | ${x.gf.toFixed(2)} ${x.ga.toFixed(2)} | ${sg(x.dParents).padStart(8)} ${sg(x.dSquad).padStart(6)} ${sg(x.dBoard).padStart(6)} ${sg(x.dRep).padStart(6)} | ${sg(x.dBudget, 0).padStart(7)} | ${x.perWeek.toFixed(2).padStart(6)} ${x.attend ? pct(x.attend) : '    —'} | ${x.coh.toFixed(1)}`); }
    console.log('\nMoney offers per run (fired / taken), promise cards, the scout\'s return, pool leaks:');
    for (const p of POLICIES) { const o = sum[p].offers, f = k => (o[k] || 0).toFixed(2);
      console.log(`${p.padEnd(10)} | ` + MONEY_IDS.map(id => `${id} ${f(id + '.fired')}/${f(id + '.taken')}`).join(' · ')
        + ` | promise keep ${f('promise.keep')} break ${f('promise.break')} | poach keep ${f('poach.keep')} talk→stay ${f('poach.talkStay')} talk→leave ${f('poach.talkLeave')} let go ${f('poach.letGo')} | leaks ${f('pool.leak')}`); }
    console.log('\nMoney by ledger category (average per run, $):');
    for (const p of POLICIES) console.log(`${p.padEnd(10)} | ` + ['fee', 'grant', 'donation', 'rent', 'event'].map(k => `${k} ${sg(sum[p].ledger[k] || 0, 0)}`).join(' · ')
      + ' | money offers taken per run: ' + (Object.entries(sum[p].money).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ') || '—'));
    console.log('');
    for (const g of gates) console.log(`${g.ok ? 'OK  ' : 'FAIL'} ${g.name}: ${g.v.toFixed(1)}`);
    if (errors.length) console.log('\nErrors:\n' + errors.slice(0, 20).join('\n'));
  }
  const fail = errors.length > 0 || (!BASELINE && gates.some(g => !g.ok));
  process.exit(fail ? 1 : 0);
})();
