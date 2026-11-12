#!/usr/bin/env node
/*
 * Smoke test: plays one full matchday in a headless browser and prints a short report.
 *   node test/smoke.js            (run `node build.js` first)
 *   node test/smoke.js --shots    also saves screenshots to test/shots/
 * Exit code 1 on any failure. Requires Playwright (npm i, or a global install).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const FILE = BASE + '?noboot';   // v2.1: the boot screen is tested once, separately
const SHOTS = process.argv.includes('--shots');
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok, info }); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => { errors.push('native dialog: ' + d.message()); d.dismiss(); });
  // v2.8: START DAY → morning briefing → [ HEAD TO THE CLUB ] → locker room
  const toLocker = async () => {
    await page.evaluate(() => YAM.ui.locker.open());
    if (await page.evaluate(() => !document.getElementById('morning-briefing-view').hidden)) await page.click('#mb-go');
    await page.waitForTimeout(60);
  };
  const shot = async name => { if (SHOTS) { fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true }); await page.screenshot({ path: path.join(__dirname, 'shots', name + '.png') }); } };
  const modalOpen = () => page.evaluate(() => !document.getElementById('modal-layer').hidden);
  const closeModal = async () => { if (await modalOpen()) await page.keyboard.press('Escape'); };

  try {
    // v2.1: boot screen — visible at once, phases change, bar 5–8 s, then fades out and is removed
    const bp = await browser.newPage({ viewport: { width: 1440, height: 860 } });
    bp.on('pageerror', e => errors.push('boot: ' + e.message));
    await bp.goto(BASE);
    const b1 = await bp.evaluate(() => ({ vis: !!document.getElementById('loading-overlay'), z: getComputedStyle(document.getElementById('loading-overlay')).zIndex,
      dur: BootScreen.duration, phase: document.querySelector('.boot-phase').textContent, logo: !!document.querySelector('.boot-logo svg') }));
    await bp.waitForTimeout(1600);
    const b2 = await bp.evaluate(() => ({ phase: document.querySelector('.boot-phase').textContent, w: parseFloat(document.querySelector('.boot-fill').style.width) }));
    if (SHOTS) { fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true }); await bp.screenshot({ path: path.join(__dirname, 'shots', '0-boot-a.png') }); }
    await bp.waitForTimeout(Math.max(0, b1.dur * 0.55 - 1600));
    if (SHOTS) await bp.screenshot({ path: path.join(__dirname, 'shots', '0-boot-b.png') });
    await bp.waitForFunction(() => !document.getElementById('loading-overlay'), null, { timeout: 10000 });
    const b3 = await bp.evaluate(() => ({ el: Math.round(BootScreen.elapsed), ui: !!(window.YAM && YAM.ui) }));
    await bp.close();
    check('boot screen: z 9999, logo, phases cycle, 5–8 s bar, then removed', b1.vis && b1.z === '9999' && b1.logo && b1.dur >= 5000 && b1.dur <= 8000
      && b2.phase !== b1.phase && b2.w > 0 && b2.w < 100 && b3.el >= 5000 && b3.el < 8600 && b3.ui, JSON.stringify({ b1, b2, b3 }));

    await page.goto(FILE);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => window.YAM && window.YAM.ui);
    await page.evaluate(() => { YAM.game.excusesOff = true; });

    const ver = await page.evaluate(() => APP_VERSION);
    const title = await page.title();
    check('version in <title> and taskbar', title.endsWith('v' + ver) && (await page.textContent('#app-title')).includes('v' + ver), `${title}`);
    check('update notice shown once', await modalOpen());
    check('dashboard backdrop visible', await page.evaluate(() => document.getElementById('scene-office').classList.contains('active')));
    await closeModal();

    // fast match for testing
    await page.evaluate(() => { for (const k of [1, 2, 5]) { YAM.MatchEngine.SPEED[k] = 6; YAM.MatchEngine.HIGHLIGHT[k] = 12; } });

    // calendar → matchday (random narrative events off here; they are tested at the end)
    await page.evaluate(() => { YAM.ui.events.enabled = false; YAM.game.excusesOff = true; YAM.game.squad.forEach(p => { p.psych.discipline = 20; }); });   // v2.6: everyone turns up (deterministic)
    await page.evaluate(() => YAM.ui.autoSim());   // v2.5: END DAY is manual; debug auto-sim to the match
    await page.waitForFunction(() => YAM.game.phase === 'matchday', null, { timeout: 20000 });
    check('calendar stops on matchday', true, await page.evaluate(() => YAM.ui.cal.date));
    await shot('1-dashboard');
    await closeModal();
    await toLocker(); await page.click('#lr-proceed');   // v2.6: roll call before kick-off
    await page.click('.tk[data-view=match]');

    // layout: three columns, no scrolling
    const lay = await page.evaluate(() => {
      const b = document.querySelector('#win-match .match-body');
      const ctrl = document.querySelector('.mc-controls').getBoundingClientRect().bottom;
      const status = document.querySelector('#win-match .statusbar').getBoundingClientRect().top;
      return { scroll: b.scrollHeight > b.clientHeight + 1, fits: ctrl <= status };
    });
    check('match layout fits (1440x860)', !lay.scroll && lay.fits);

    // match → half-time pause → substitution → resume → full-time
    await page.click('#btn-start');
    await page.waitForFunction(() => YAM.ui.engine && YAM.ui.engine.paused, null, { timeout: 60000 });
    check('half-time pause at 45\'', await page.evaluate(() => YAM.ui.engine.minute === 45 && !document.getElementById('ht-banner').hidden));
    await shot('2-halftime');
    const sub = await page.evaluate(() => {
      const e = YAM.ui.engine;
      const out = e.sides[0].entries.find(x => x.line === 'MID').p;
      const inn = YAM.game.squad.find(p => !e.sides[0].players.includes(p) && p.archetype === 'MID' && p.available)
        || YAM.game.squad.find(p => !e.sides[0].players.includes(p) && p.archetype !== 'GK' && p.available);
      return { out: out.id, in: inn.id };
    });
    // v1.5: profile card during the match (right-click a pitch token, [i] in the roster) must not touch the swap
    await page.dispatchEvent(`#radar .pl[data-pid="${sub.out}"]`, 'contextmenu');
    const pc1 = await page.evaluate(() => ({ open: !document.getElementById('pinfo-layer').hidden, live: !!document.querySelector('#pinfo-body th.live'),
      sel: YAM.ui.liveSel, attrs: /\b(pace|shooting|passing|tackling)\b\s*[:=]?\s*\d/i.test(document.getElementById('pinfo-body').textContent) }));
    await page.keyboard.press('Escape');
    await page.click(`#live-roster .info-btn[data-info="${sub.in}"]`);
    const pc2 = await page.evaluate(() => ({ open: !document.getElementById('pinfo-layer').hidden, sel: YAM.ui.liveSel }));
    await page.click('#pinfo-x');
    check('profile card: right-click pitch + [i], live column, no swap side-effects', pc1.open && pc1.live && !pc1.sel && !pc1.attrs && pc2.open && !pc2.sel, JSON.stringify({ pc1, pc2 }));
    await page.click(`#live-roster .r-row[data-id="${sub.out}"]`);
    await page.click(`#live-roster .r-row[data-id="${sub.in}"]`);
    check('live substitution', await page.evaluate(s => YAM.ui.engine.sides[0].players.some(p => p.id === s.in) && YAM.ui.radar.renderer.nodes.has(s.in), sub));
    await page.click('#btn-resume');
    await page.waitForFunction(() => YAM.game.phase === 'post', null, { timeout: 120000 });
    const fin = await page.evaluate(() => ({ score: YAM.ui.engine.sides.map(s => s.score).join('-'), md: YAM.game.league.fixturesOf(1).every(f => f.hg !== null) }));
    check('full-time + all 5 fixtures resolved', fin.md, fin.score);
    // v2.1: Match Summary before the Notebook — goals in the timeline match the score
    await page.waitForFunction(() => !document.getElementById('msum-layer').hidden, null, { timeout: 5000 });
    const ms = await page.evaluate(() => {
      const e = YAM.ui.engine, ev = e.matchEvents, rep = YAM.game.lastReport;
      const g = side => ev.filter(x => x.type === 'goal' && x.isHomeTeam === (side === 0)).length;
      return { goals: [g(0), g(1)].join('-'), score: e.sides.map(s => s.score).join('-'), saved: rep.events.length === ev.length,
        homeRows: document.querySelectorAll('#msum-body .ms-col.home .ms-ev.goal').length, awayRows: document.querySelectorAll('#msum-body .ms-col.away .ms-ev.goal').length,
        cards: ev.filter(x => x.type === 'yellow').length === e.teamTotals(0).yellow + e.teamTotals(1).yellow,
        board: document.querySelector('#msum-body .ms-score').textContent.replace(/\s/g, ''), fields: ev.every(x => 'minute' in x && 'type' in x && 'playerName' in x && 'isHomeTeam' in x) };
    });
    await shot('3-fulltime');
    check('match summary: opens at full time, goals/cards = engine, timeline 2 columns', ms.goals === ms.score && ms.saved && ms.cards && ms.fields
      && `${ms.homeRows}-${ms.awayRows}` === ms.score && ms.board === ms.score, JSON.stringify(ms));
    await page.click('#msum-go');

    // notebook
    await closeModal();
    await page.click('.tk[data-view=notes]');
    const nb = await page.evaluate(() => ({ cards: document.querySelectorAll('.card').length, notes: document.querySelectorAll('.coach-note').length }));
    check('notebook: 3 cards with coach notes', nb.cards === 3 && nb.notes === 3);
    const pt = await page.evaluate(() => ({
      nb: [...document.querySelectorAll('.card .portrait.lg svg')].map(s => s.getBoundingClientRect().width),
      lr: document.querySelectorAll('#live-roster .portrait.sm svg').length,
      uniq: new Set(YAM.game.squad.map(p => p.portraitSvg)).size, n: YAM.game.squad.length,
      saved: !/portraitSvg/.test(localStorage.getItem('yam_save_v1') || ''),
    }));
    check('portraits: roster + notebook, unique, not saved as SVG', pt.nb.length === 3 && pt.nb.every(w => w >= 95) && pt.lr === pt.n && pt.uniq >= pt.n - 1 && pt.saved, JSON.stringify(pt.nb) + ' uniq ' + pt.uniq + '/' + pt.n);
    await page.click('#notes-body .card', { button: 'right' });
    await page.waitForTimeout(250);   // window-open animation
    const pc3 = await page.evaluate(() => {
      const id = document.querySelector('#notes-body .card').dataset.pid, b = document.getElementById('pinfo-body');
      const p = YAM.game.player(id), st = YAM.game.seasonOf(id);
      return { open: !document.getElementById('pinfo-layer').hidden, apps: st.apps, age: p.age,
        txt: b.textContent.includes(String(p.age)) && /1/.test(b.querySelector('.pi-stats td').textContent),
        note: !!b.querySelector('.pi-note-h'), svg: b.querySelector('.portrait.xl svg').getBoundingClientRect().width };
    });
    await shot('5-profile');
    await page.keyboard.press('Escape');
    check('profile card: notebook right-click, season stats + note + 96px face', pc3.open && pc3.apps === 1 && pc3.age >= 13 && pc3.age <= 16 && pc3.txt && pc3.note && pc3.svg >= 90, JSON.stringify(pc3));
    await page.click('#notes-body [data-tag]');
    await shot('4-notebook');
    await page.click('#btn-back');
    check('return to dashboard queues next matchday', await page.evaluate(() => YAM.game.phase === 'calendar' && YAM.ui.cal.nextEvent().md === 2));

    // persistence + language switch
    const facesBefore = await page.evaluate(() => JSON.stringify(YAM.game.squad.map(p => p.face)));
    await page.reload();
    await page.waitForFunction(() => window.YAM && window.YAM.ui);
    await page.evaluate(() => { YAM.game.excusesOff = true; });
    check('save survives reload', await page.evaluate(() => YAM.game.league.playedMatchdays() === 1 && Object.keys(YAM.game.seasonStats).length >= 11));
    check('faces stable after reload', await page.evaluate(f => JSON.stringify(YAM.game.squad.map(p => p.face)) === f, facesBefore));
    // v1.6: club badges + calendar dashboard
    const cal = await page.evaluate(() => {
      const t = YAM.game.league.teams, raw = localStorage.getItem('yam_save_v1') || '';
      return { svgs: new Set(t.map(x => x.emblemSvg)).size, crests: t.every(x => Array.isArray(x.crest)), saved: !raw.includes('emblem-svg'),
        today: document.querySelectorAll('#cal-grid .cal-day.today').length, played: document.querySelectorAll('#cal-grid .cal-day.match.r-W, #cal-grid .cal-day.match.r-D, #cal-grid .cal-day.match.r-L').length,
        badges: document.querySelectorAll('#cal-grid .cal-day.match .emblem svg').length, mini: document.querySelectorAll('#mini-table tr:not(.hd):not(.gap)').length,
        res: document.querySelectorAll('#md-fixtures .fx .emblem').length, table: document.querySelectorAll('#table-body .emblem').length,
        big: document.querySelector('#next-event .emblem.lg')?.getBoundingClientRect().width || 0 };
    });
    check('emblems: 10 unique badges, not saved as SVG; calendar grid + mini table', cal.svgs === 10 && cal.crests && cal.saved && cal.today === 1
      && cal.played === 1 && cal.badges >= 2 && cal.mini >= 5 && cal.res === 10 && cal.table === 10 && cal.big >= 60, JSON.stringify(cal));
    await shot('5-calendar');
    // v1.7: league stats + TEAM_ROSTER.EXE
    await page.evaluate(() => YAM.ui.show('table'));
    const ls = await page.evaluate(() => {
      const lg = YAM.game.league, ai = lg.teams.filter(t => !t.user);
      const fxGoals = lg.fixtures.filter(f => f.hg !== null).reduce((a, f) => a + f.hg + f.ag, 0);
      const kidGoals = ai.reduce((a, t) => a + t.squad.reduce((b, k) => b + k.goals, 0), 0)
        + Object.values(YAM.game.seasonStats).reduce((a, s) => a + (s.goals || 0), 0);
      const kidAst = ai.reduce((a, t) => a + t.squad.reduce((b, k) => b + k.assists, 0), 0);
      return { squads: ai.every(t => t.squad.length === 14), mp: ai.every(t => t.squad.filter(k => k.mp === 1).length === 11),
        fxGoals, kidGoals, ast: kidAst <= kidGoals, scorers: document.querySelectorAll('#top-scorers tbody tr').length,
        assists: document.querySelectorAll('#top-assists tbody tr').length, nav: document.querySelector('.tk[data-view="table"] .lbl').textContent };
    });
    check('league stats: 14-kid AI squads, goals add up, leaders tables', ls.squads && ls.mp && ls.fxGoals === ls.kidGoals && ls.ast
      && ls.scorers >= 1 && ls.assists >= 1 && /League|Лига/.test(ls.nav), JSON.stringify(ls));
    const aiRow = await page.evaluate(() => [...document.querySelectorAll('#table-body tr')].findIndex(tr => tr.dataset.team !== '0'));
    await page.click(`#table-body tr:nth-child(${aiRow + 1})`);
    const tr = await page.evaluate(() => {
      const g = [...document.querySelectorAll('#troster-body .tr-table tbody tr .g')].map(x => +x.textContent);
      return { open: !document.getElementById('troster-layer').hidden, title: document.getElementById('troster-title').textContent,
        rows: g.length, sorted: g.every((v, i) => !i || g[i - 1] >= v), badge: !!document.querySelector('#troster-body .emblem.xl svg'),
        place: /\d/.test(document.querySelector('#troster-body .tr-place')?.textContent || '') };
    });
    await shot('6-league');
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => document.getElementById('troster-layer').hidden && YAM.ui.view === 'table');
    check('team roster modal: click row, emblem, position, 14 rows sorted by goals, Esc closes', tr.open && /_ROSTER\.EXE$/.test(tr.title)
      && tr.rows === 14 && tr.sorted && tr.badge && tr.place && closed, JSON.stringify({ ...tr, closed }));
    // v1.8: attribute structure + DEBUG.EXE (database + god mode); hidden attrs never on the Profile Card
    const at = await page.evaluate(() => {
      const sq = YAM.game.squad, G = { physical: 5, technical: 7, tactical: 3, psych: 4 };
      const okRange = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
      return { groups: sq.every(p => Object.entries(G).every(([g, n]) => Object.keys(p[g]).length === n)),
        skills: sq.every(p => ['physical', 'technical', 'tactical'].every(g => Object.values(p[g]).every(v => okRange(v, 1, 20)))),
        pa: sq.every(p => okRange(p.psych.potential, 1, 100)), bio: sq.every(p => okRange(p.bio.age, 13, 16) && 'LR'.includes(p.bio.strongFoot) && okRange(p.bio.weakFoot, 1, 5) && p.bio.height > 130),
        dyn: sq.every(p => ['condition', 'sharpness', 'morale'].every(k => okRange(p.dyn[k], 0, 100)) && p.energy === p.dyn.condition),
        saved: /"technical":\{/.test(localStorage.getItem('yam_save_v1') || '') && !/"attrs"/.test(localStorage.getItem('yam_save_v1') || '') };
    });
    check('v1.8 attributes: nested groups, ranges, condition = energy, saved', Object.values(at).every(Boolean), JSON.stringify(at));
    await page.click('#btn-debug');
    const db = await page.evaluate(() => ({ open: !document.getElementById('debug-layer').hidden,
      rows: document.querySelectorAll('#debug-body .dbg-table tbody tr').length, cols: document.querySelectorAll('#debug-body .dbg-table thead tr:nth-child(2) th').length,
      n: YAM.game.squad.length }));
    await shot('7-debug-db');
    await page.click('#debug-layer [data-dtab="god"]');
    await page.evaluate(() => { for (const p of YAM.game.squad) { p.energy = 31; p.dyn.morale = 20; p.dyn.sharpness = 10; } });
    await page.click('[data-cheat="energy"]'); await page.click('[data-cheat="maxms"]'); await page.click('[data-cheat="force"]');
    await shot('8-debug-god');
    const gm = await page.evaluate(() => ({ e: YAM.game.squad.every(p => p.energy === 100), m: YAM.game.squad.every(p => p.dyn.morale === 100 && p.dyn.sharpness === 100),
      f: YAM.game.cheats.forceWin === true, armed: !!document.querySelector('[data-cheat="force"].armed') }));
    await page.keyboard.press('Escape');
    const dbClosed = await page.evaluate(() => document.getElementById('debug-layer').hidden);
    check('DEBUG.EXE: database lists every kid + all columns, god mode cheats work, Esc closes', db.open && db.rows === db.n && db.cols >= 35 && Object.values(gm).every(Boolean) && dbClosed, JSON.stringify({ db, gm }));
    // Force Win: a headless engine run with the flag must beat a far stronger side
    const fw = await page.evaluate(() => {
      const home = YAM.ui.homeTeam(), ctx = YAM.game.matchContext();
      let wins = 0;
      for (let i = 0; i < 10; i++) {
        const e = new YAM.MatchEngine(home, ctx.team, { onLog() {}, onUpdate() {}, onEnd() {}, onHalfTime: x => { x.paused = false; } }, { forceWin: true });
        e.started = true; e.kickoff(0); e.stop = () => {}; e.updateSpeed = () => {};
        while (!e.finished) { e.paused = false; e.tick(); }
        if (e.sides[0].score > e.sides[1].score) wins++;
      }
      return wins;
    });
    check('force win flag: user wins >= 9/10 engine runs', fw >= 9, fw + '/10');
    // v1.9: budget + narrative events + locker room dialogue
    const talkOpen = () => page.evaluate(() => !document.getElementById('talk-layer').hidden);
    const hdr0 = await page.evaluate(() => ({ b: YAM.game.budget, txt: document.getElementById('hdr-budget').textContent }));
    await page.evaluate(() => { YAM.game.budget = 100; YAM.ui.renderBudget(); YAM.ui.events.fire('boots'); });
    await page.waitForTimeout(150);
    const bt = await page.evaluate(() => {
      const pe = YAM.game.pendingEvent, kid = YAM.game.player(pe.cast.kid), btns = [...document.querySelectorAll('#talk-choices .talk-btn')];
      return { kid: kid.id, agi: kid.physical.agility, n: btns.length, dis: btns[0].disabled, en: !btns[1].disabled, face: !!document.querySelector('#talk-face svg'),
        hdr: document.getElementById('hdr-budget').textContent };
    });
    await page.click('#talk-choices .talk-btn[data-i="0"]', { force: true });   // disabled: must do nothing
    await page.keyboard.press('Escape');                                         // forced choice: Esc does nothing
    const still = await talkOpen();
    await page.click('#talk-choices .talk-btn[data-i="1"]');
    const bt2 = await page.evaluate(k => ({ agi: YAM.game.player(k).physical.agility, closed: document.getElementById('talk-layer').hidden, pe: YAM.game.pendingEvent, b: YAM.game.budget,
      diary: YAM.game.diary[YAM.game.diary.length - 1].key }), bt.kid);
    check('budget $500 in header; Torn Boots: snitch face, unaffordable choice disabled, Esc blocked, "no" = agility −2',
      hdr0.b === 500 && /\$500/.test(hdr0.txt) && bt.n === 2 && bt.dis && bt.en && bt.face && /\$100/.test(bt.hdr) && still
      && bt2.agi === Math.max(1, bt.agi - 2) && bt2.closed && !bt2.pe && bt2.b === 100 && bt2.diary === 'ev.boots.b.diary', JSON.stringify({ hdr0, bt, still, bt2 }));
    await page.evaluate(() => YAM.ui.events.fire('dad'));
    await page.waitForTimeout(100);
    const dd = await page.evaluate(() => ({ kid: YAM.game.pendingEvent.cast.kid, worst: [...YAM.game.squad].sort((a, b) => a.overall - b.overall)[0].id,
      sil: document.querySelector('#talk-face svg rect:nth-of-type(2)') !== null }));
    await page.click('#talk-choices .talk-btn[data-i="0"]');
    const dd2 = await page.evaluate(k => ({ b: YAM.game.budget, flag: YAM.game.player(k).flags.includes('Promised_Start'), hdr: document.getElementById('hdr-budget').textContent,
      chip: !!document.querySelector(`#roster .r-row[data-id="${k}"] .tag.flag`) }), dd.kid);
    check("Rich Kid's Dad: worst player, take money = +$300 + Promised_Start chip", dd.kid === dd.worst && dd.sil && dd2.b === 400 && dd2.flag && /\$400/.test(dd2.hdr) && dd2.chip, JSON.stringify({ dd, dd2 }));
    // v2.2/2.3: injuries, multi-step dialogue + suspension, match-day bus, dads' pool → losing dad, scout → showcase
    const talk = async i => { await page.click(`#talk-choices .talk-btn[data-i="${i}"]`); await page.waitForTimeout(30); };
    await page.evaluate(() => { YAM.game.budget = 1000; YAM.ui.events.fire('knock'); });
    const kn = await page.evaluate(() => YAM.game.pendingEvent.cast.kid);
    await page.evaluate(k => { const s = YAM.game; if (!s.isStarter(k)) s.swapPlayers(k, s.starters().find(p => p.archetype === s.player(k).archetype && p.archetype !== 'GK')?.id || s.lineup[1]); }, kn);
    await talk(1);   // ice → 14 days
    const kn2 = await page.evaluate(k => {
      const s = YAM.game, p = s.player(k), slot = s.lineup[p.archetype === 'GK' ? 0 : 1];
      const err = s.swapPlayers(slot === k ? s.lineup[2] : slot, k);
      return { days: p.injuryDays, starter: s.isStarter(k), err, badge: !!document.querySelector(`#roster .r-row[data-id="${k}"].unavail .st-badge.inj`) };
    }, kn);
    await page.evaluate(() => YAM.game.restDay());
    const kn3 = await page.evaluate(k => YAM.game.player(k).injuryDays, kn);
    check('injury: ice = 14 days, auto-benched, red-cross badge, swap into XI blocked, heals daily', kn2.days === 14 && !kn2.starter && kn2.err === 'unavail_inj' && kn2.badge && kn3 === 13, JSON.stringify({ kn2, kn3 }));
    await page.evaluate(() => { const p = YAM.game.squad.find(x => x.archetype === 'MID' && x.available); p.psych.discipline = 5; YAM.game.squad.forEach(x => { if (x !== p && x.psych.discipline < 8) x.psych.discipline = 8; }); YAM.ui.events.fire('ulti'); });
    const ul = await page.evaluate(() => YAM.game.pendingEvent.cast.kid);
    await talk(1);   // call him into the office → step 2
    const ul2 = await page.evaluate(() => ({ open: !document.getElementById('talk-layer').hidden, step: YAM.game.pendingEvent?.step, n: document.querySelectorAll('#talk-choices .talk-btn').length }));
    await talk(0);   // suspend 2 matches
    const ul3 = await page.evaluate(k => ({ sus: YAM.game.player(k).suspensionMatches, starter: YAM.game.isStarter(k), closed: !YAM.game.pendingEvent }), ul);
    check('multi-step Ultimatum: step 2 "office", suspend = 2 matches, out of the XI', ul2.open && ul2.step === 'office' && ul2.n === 2 && ul3.sus === 2 && !ul3.starter && ul3.closed, JSON.stringify({ ul2, ul3 }));
    await page.evaluate(() => { YAM.game.squad.forEach(p => { p.energy = 80; }); YAM.ui.events.fire('bus'); });
    await talk(1);   // jog
    const bus = await page.evaluate(() => YAM.game.squad.every(p => p.energy === 56));
    const plus14 = d0 => { const d = new Date(d0 + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 14); return d.toISOString().slice(0, 10); };
    // v2.3: the dads' pool → a losing dad 14 days later (the actor is chosen NOW and carried by the queue)
    await page.evaluate(() => { YAM.game.budget = 100; YAM.ui.renderBudget(); YAM.ui.events.fire('pool'); });
    const loser = await page.evaluate(() => YAM.game.pendingEvent.cast.loser);
    await talk(0);   // accept the donation
    const pl = await page.evaluate(() => ({ b: YAM.game.budget, q: JSON.parse(JSON.stringify(YAM.game.eventQueue)), date: YAM.game.calendar.date }));
    await page.evaluate(() => { const q = YAM.game.eventQueue.splice(0, 1)[0]; YAM.ui.events.fire(q.id, undefined, { cast: q.cast }); });
    const pl2 = await page.evaluate(() => ({ id: YAM.game.pendingEvent?.id, kid: YAM.game.pendingEvent?.cast.kid }));
    await talk(1);   // "he plays when he earns it" → kept at home 10 days
    const pl3 = await page.evaluate(k => { const p = YAM.game.player(k), r = { away: p.awayDays, avail: p.available, starter: YAM.game.isStarter(k) };
      YAM.game.restDay(); r.after = p.awayDays; p.awayDays = 0; return r; }, loser);
    await page.evaluate(k => YAM.ui.events.fire('poolloss', undefined, { cast: { kid: k } }), loser);
    await talk(0);   // promise the start
    const pl4 = await page.evaluate(k => { const p = YAM.game.player(k), r = { flag: p.hasFlag('Promised_Start'), by: p.promiseBy };
      p.flags = p.flags.filter(f => f !== 'Promised_Start'); p.promiseBy = null; return r; }, loser);
    check("Dads' pool: +$200, schedules the losing dad 14 days later with the SAME kid; refuse = kept home 10 days; promise = pool start",
      pl.b === 300 && pl.q.length === 1 && pl.q[0].id === 'poolloss' && !pl.q[0].matchDay && pl.q[0].due === plus14(pl.date) && pl.q[0].cast?.kid === loser
      && pl2.id === 'poolloss' && pl2.kid === loser && pl3.away === 10 && !pl3.avail && !pl3.starter && pl3.after === 9 && pl4.flag && pl4.by === 'pool', JSON.stringify({ pl, pl2, pl3, pl4 }));
    // v2.3: the scout → showcase on a match day 14 days later
    await page.evaluate(() => { YAM.game.budget = 100; YAM.ui.renderBudget(); YAM.ui.events.fire('scout'); });
    await talk(0);   // accept the kit money → time bomb
    const sp = await page.evaluate(() => ({ b: YAM.game.budget, q: JSON.parse(JSON.stringify(YAM.game.eventQueue)), date: YAM.game.calendar.date }));
    check('Broken Bus jog = condition ×0.7; Scout +$500 schedules "scoutvisit" 14 days later (match day)', bus && sp.b === 600 && sp.q.length === 1 && sp.q[0].id === 'scoutvisit'
      && sp.q[0].matchDay && sp.q[0].due === plus14(sp.date), JSON.stringify(sp));
    await page.evaluate(d => { YAM.game.eventQueue[0].due = d; YAM.game.save(); }, sp.date);   // fast-forward the bomb: due today → next match day

    // v2.5: END DAY loop, mandatory training plan, regimes, action points + call into office
    await page.evaluate(() => { YAM.ui.events.enabled = false; YAM.ui.show('dash'); });
    const dl0 = await page.evaluate(() => ({ date: YAM.game.calendar.date, ap: document.getElementById('hdr-ap').textContent, btn: document.getElementById('btn-sim').disabled, today: !!document.querySelector('#today-box .td-ap') }));
    const endDay = async () => {   // v2.8: a fresh day starts with the briefing (rest days go back to the Dashboard)
      if (await page.evaluate(() => YAM.ui.dayBlockers()[0] === 'briefing')) { await page.click('#btn-sim'); await page.click('#mb-go'); await page.waitForTimeout(30); }
      await page.click('#btn-sim'); await page.waitForTimeout(40);
    };
    // v2.8: morning briefing on a plain day
    await page.click('#btn-sim');
    const mb = await page.evaluate(() => ({ open: !document.getElementById('morning-briefing-view').hidden, z: +getComputedStyle(document.getElementById('morning-briefing-view')).zIndex,
      date: document.getElementById('mb-date').textContent, wx: document.getElementById('mb-weather').textContent.trim(), news: document.querySelectorAll('#mb-news li').length,
      rep: document.querySelectorAll('#mb-rep .rep-row .rep-bar').length, btn: document.getElementById('mb-go').textContent, kind: YAM.ui.dayInfo(YAM.game.calendar.date).kind }));
    await shot('11-briefing');
    await page.click('#mb-go');
    const mb2 = await page.evaluate(() => ({ briefed: YAM.game.dayState().briefed, locker: !document.getElementById('locker-room-view').hidden, endDay: !document.getElementById('btn-sim').disabled }));
    check('morning briefing: START DAY opens it (z 50), date + weather + 1–2 news + 3 reputation bars; HEAD TO THE CLUB on a rest day → Dashboard, END DAY ready',
      mb.open && mb.z === 50 && mb.date.length > 6 && mb.wx.length > 2 && mb.news >= 1 && mb.news <= 2 && mb.rep === 3 && /CLUB|КЛУБ/.test(mb.btn) && mb.kind === 'rest'
      && mb2.briefed && !mb2.locker && mb2.endDay, JSON.stringify({ mb, mb2 }));
    const dayOf = d => new Date(d + 'T00:00:00Z').getUTCDay();
    let guard = 0;
    while (!(await page.evaluate(() => isTrainingDay(YAM.game.calendar.date))) && guard++ < 7) await endDay();
    // v2.6: training day → START DAY → locker room (forced absences) → roll call → Proceed → plan → END DAY
    const lr0 = await page.evaluate(() => {
      const s = YAM.game, fit = s.squad.filter(p => p.available && p.archetype !== 'GK' && !(p.suspensionMatches > 0));
      for (const p of s.squad) { p.energy = 50; p.dyn.morale = 60; p.psych.discipline = 15; p.injuryDays = 0; p.awayDays = 0; }
      const [tired, lazy, hurt, keep] = [fit[0], fit[1], fit[2], fit[3]];
      tired.energy = 10; lazy.psych.discipline = 1; hurt.injuryDays = 5;
      if (!s.isStarter(lazy.id)) { const i = s.lineup.findIndex((id, k) => k > 0 && ![tired.id, hurt.id].includes(id)); s.lineup[i] = lazy.id; }
      s.save(); YAM.ui.renderAll();
      return { pre: s.squad.filter(p => p.suspensionMatches > 0).length, date: s.calendar.date, tired: tired.id, lazy: lazy.id, hurt: hurt.id, keep: keep.id, lazyStarter: s.isStarter(lazy.id),
        btn: document.getElementById('btn-sim').disabled, label: document.getElementById('btn-sim').textContent, need: !!document.querySelector('#today-box .td-req.need'),
        plans: document.querySelectorAll('#today-box .plan-btn').length };
    });
    await page.evaluate(() => { window.__R = Math.random; Math.random = () => 0.99; });
    await page.click('#btn-sim');   // START DAY → morning briefing
    await page.click('#mb-go');     // HEAD TO THE CLUB → locker room (arrivals rolled here)
    await page.evaluate(() => { Math.random = window.__R; });
    await page.waitForTimeout(250);
    const lr1 = await page.evaluate(ids => {
      const g = document.getElementById('lr-grid'), lk = YAM.game.dayState().locker;
      return { open: !document.getElementById('locker-room-view').hidden, cells: g.querySelectorAll('.lk').length, empty: [...g.querySelectorAll('.lk.empty')].map(x => x.dataset.pid).sort(),
        faces: g.querySelectorAll('.lk.here .lk-face svg').length, why: [lk.absent[ids.tired], lk.absent[ids.lazy], lk.absent[ids.hurt]], skipFlag: YAM.game.player(ids.lazy).skipped_training };
    }, lr0);
    await shot('10-locker');
    // v2.7: profile over the locker room (right-click + [i]), backdrop between them, Esc closes only the top layer
    const here = await page.evaluate(() => document.querySelector('#lr-grid .lk.here').dataset.pid);
    await page.waitForTimeout(1300);   // let the doors finish opening
    await page.click(`#lr-grid .lk.here[data-pid="${here}"] .lk-in`, { button: 'right' });
    await page.waitForTimeout(250);
    const zz = await page.evaluate(() => {
      const z = id => +getComputedStyle(document.getElementById(id)).zIndex;
      const win = document.querySelector('#pinfo-layer .pinfo').getBoundingClientRect(), hit = document.elementFromPoint(win.left + win.width / 2, win.top + 20);
      const g = document.getElementById('lr-grid').getBoundingClientRect(), edge = document.elementFromPoint(g.left + 8, g.top + 8);   // a locker corner, outside the card
      return { open: !document.getElementById('pinfo-layer').hidden, onTop: !!hit?.closest('#pinfo-layer .pinfo'), backdrop: edge?.id === 'pinfo-layer',
        z: [z('desktop'), z('locker-room-view'), z('pinfo-layer'), z('talk-layer'), z('modal-layer')] };
    });
    await page.keyboard.press('Escape');
    const esc1 = await page.evaluate(() => ({ profile: !document.getElementById('pinfo-layer').hidden, locker: !document.getElementById('locker-room-view').hidden }));
    await page.click(`#lr-grid .lk.here[data-pid="${here}"] .info-btn`);
    const viaI = await page.evaluate(() => !document.getElementById('pinfo-layer').hidden && YAM.ui.topLayer().el.id === 'pinfo-layer');
    await page.keyboard.press('Escape');
    check('z-order: profile (right-click / [i]) opens ABOVE the locker room with its backdrop between; Esc closes only the top layer',
      zz.open && zz.onTop && zz.backdrop && zz.z.join() === '10,50,100,200,210' && !esc1.profile && esc1.locker && viaI
      && (await page.evaluate(() => !document.getElementById('locker-room-view').hidden)), JSON.stringify({ zz, esc1, viaI }));
    await page.click(`#lr-grid .lk.empty[data-pid="${lr0.lazy}"]`);   // roll call: 1 AP
    const lr2 = await page.evaluate(() => ({ ap: YAM.game.ap, talk: !document.getElementById('talk-layer').hidden, n: document.querySelectorAll('#talk-choices .talk-btn').length, b: YAM.game.budget }));
    const disc0 = await page.evaluate(id => YAM.game.player(id).psych.discipline, lr0.lazy);
    await talk(0);   // fine him
    const lr3 = await page.evaluate(([id, t]) => ({ b: YAM.game.budget, disc: YAM.game.player(id).psych.discipline, still: !document.getElementById('locker-room-view').hidden,
      noAp: !document.querySelector(`#lr-grid .lk.empty[data-pid="${t}"]`).classList.contains('can'), note: !!document.querySelector(`#lr-grid .lk.empty[data-pid="${id}"] .lk-note.open`) }), [lr0.lazy, lr0.tired]);
    await page.click('#lr-proceed');
    const lr4 = await page.evaluate(id => ({ open: !document.getElementById('locker-room-view').hidden, lazyStarter: YAM.game.isStarter(id), btn: document.getElementById('btn-sim').disabled,
      swap: YAM.game.swapPlayers(YAM.game.lineup[1], id),
      need: !!document.querySelector('#today-box .td-req.need'), plans: document.querySelectorAll('#today-box .plan-btn').length }), lr0.lazy);
    check('locker room: START DAY opens it, absences = exhausted / skipped / injured (empty lockers), absent kids locked out, roll call = 1 AP + fine, Proceed → plan',
      !lr0.btn && lr0.need && lr0.plans === 0 && lr0.lazyStarter && lr1.open && lr1.cells === 16 && lr1.empty.length === 3 + lr0.pre && lr1.faces === 13 - lr0.pre
      && lr1.why.join() === 'exhausted,skipped,injury' && lr1.skipFlag && lr4.swap === 'unavail_absent' && lr2.ap === 0 && lr2.talk && lr2.n === 2
      && lr3.b === lr2.b - 10 && lr3.disc === disc0 + 2 && lr3.still && lr3.noAp && lr3.note && !lr4.open && !lr4.lazyStarter && lr4.btn && lr4.need && lr4.plans === 4,
      JSON.stringify({ lr0, lr1, lr2, lr3, lr4 }));
    const dl1 = { date: lr0.date };
    await page.click('#today-box .plan-btn[data-plan="cardio"]');
    const dl2 = await page.evaluate(() => ({ btn: document.getElementById('btn-sim').disabled, plan: YAM.game.dayState().plan }));
    await page.evaluate(() => { window.__R = Math.random; Math.random = () => 0.99; });
    await endDay();
    await page.evaluate(() => { Math.random = window.__R; });
    const dl3 = await page.evaluate(ids => { const p = YAM.game.player(ids.keep), L2 = YAM.game.player(ids.lazy), T = YAM.game.player(ids.tired);
      return { date: YAM.game.calendar.date, e: p.energy, m: p.dyn.morale, plan: YAM.game.dayState().plan, diary: YAM.game.diary.slice(-4).some(d => d.key === 'cal.training'),
        lazyE: L2.energy, tiredE: T.energy, cleared: !L2.absentToday && !T.absentToday && L2.available }; }, lr0);
    const oneDay = (a, b) => (new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5 === 1;
    check('END DAY after the locker: cardio for those present (+5 energy, −4 morale +1 drift), skipper unchanged, exhausted kid rested, absences cleared next morning',
      dl0.today && /1\/1/.test(dl0.ap) && !dl0.btn && [2, 4].includes(dayOf(dl1.date)) && !dl2.btn && dl2.plan === 'cardio'
      && oneDay(dl1.date, dl3.date) && dl3.e === 55 && dl3.m === 57 && dl3.plan === null && dl3.diary && dl3.lazyE === 50 && dl3.tiredE === 20 && dl3.cleared, JSON.stringify({ dl0, dl1, dl2, dl3 }));
    await page.evaluate(id => { YAM.game.player(id).injuryDays = 0; }, lr0.hurt);
    const kidO = await page.evaluate(() => { const p = YAM.game.squad.find(x => x.available && x.archetype !== 'GK'); p.dyn.sharpness = 30; p.dyn.morale = 60; YAM.ui.profile.open(p.id); return p.id; });
    const of0 = await page.evaluate(() => ({ vis: !document.getElementById('pinfo-office').hidden, dis: document.getElementById('pinfo-office').disabled }));
    await page.click('#pinfo-office');
    const of1 = await page.evaluate(() => ({ ap: YAM.game.ap, open: !document.getElementById('talk-layer').hidden, n: document.querySelectorAll('#talk-choices .talk-btn').length, chip: document.getElementById('hdr-ap').className }));
    await talk(0);   // praise — he is out of form → backfire
    const of2 = await page.evaluate(() => ({ step: YAM.game.pendingEvent?.step }));
    await talk(0);
    const of3 = await page.evaluate(k => { YAM.ui.profile.open(k); return { m: YAM.game.player(k).dyn.morale, dis: document.getElementById('pinfo-office').disabled, closed: !YAM.game.pendingEvent }; }, kidO);
    await page.keyboard.press('Escape');
    await endDay();
    const of4 = await page.evaluate(() => YAM.game.ap);
    await page.evaluate(() => { YAM.ui.events.enabled = true; });
    check('Call into office: costs 1 AP, praise backfires when out of form, button disabled until the next morning (AP refilled)',
      of0.vis && !of0.dis && of1.ap === 0 && of1.open && of1.n === 4 && /spent/.test(of1.chip) && of2.step === 'praiseBad' && of3.m === 52 && of3.dis && of3.closed && of4 === 1,
      JSON.stringify({ of0, of1, of2, of3, of4 }));

    // v2.9: office buttons show the coach's lines (not the kid's reactions) + KICK OUT OF THE ACADEMY
    const kick = await page.evaluate(() => {
      const s = YAM.game, p = s.starters().find(x => x.archetype !== 'GK' && x.available);
      s.dayState().ap = 1; s.rep.parents = 50; s.rep.squad = 50; YAM.ui.show('team'); YAM.ui.profile.open(p.id);
      return { id: p.id, n0: s.squad.length, slot: s.lineup.indexOf(p.id) };
    });
    await page.click('#pinfo-office');
    const kb = await page.evaluate(() => [...document.querySelectorAll('#talk-choices .talk-btn')].map(b => ({ t: b.querySelector('.tb-label').textContent, red: b.classList.contains('tone-red'), dis: b.disabled })));
    await talk(3);   // kick out → confirm step
    const kc = await page.evaluate(() => ({ step: YAM.game.pendingEvent?.step, n: document.querySelectorAll('#talk-choices .talk-btn').length }));
    await talk(0);   // yes
    const ka = await page.evaluate(k => {
      const s = YAM.game;
      return { gone: !s.player(k.id) && !s.squad.some(p => p.id === k.id), n: s.squad.length, xi: s.lineup.length === 11 && s.lineup.every(id => s.player(id)) && !s.lineup.includes(k.id),
        rep: [s.rep.parents, s.rep.squad], closed: document.getElementById('talk-layer').hidden, row: !!document.querySelector(`#roster .r-row[data-id="${k.id}"]`),
        saved: !JSON.parse(localStorage.getItem('yam_save_v1')).squad.some(p => p.id === k.id) };
    }, kick);
    check('office: 4 coach lines (no reaction text / no {k}); KICK OUT (red) asks once, then removes the kid for good: squad −1, XI refilled, Parents −10, Squad −5',
      kb.length === 4 && kb.every(b => !/\{k\}|«|"/.test(b.t)) && kb[3].red && !kb[3].dis && kc.step === 'kickConfirm' && kc.n === 2
      && ka.gone && ka.n === kick.n0 - 1 && ka.xi && ka.rep.join() === '40,45' && ka.closed && !ka.row && ka.saved, JSON.stringify({ kb, kc, ka }));
    await page.evaluate(() => { YAM.game.rep.parents = 50; YAM.game.rep.squad = 50; YAM.ui.show('dash'); });

    // v3.0: fog of war — no native positions, coach's tags, exclusive duties, set-piece takers, captain
    const fg = await page.evaluate(() => {
      const s = YAM.game, ids = s.squad.map(p => p.id), [a, b, c] = [s.squad[3], s.squad[6], s.squad[9]];
      a.tag = null; YAM.ui.profile.open(a.id);
      const body = document.getElementById('pinfo-body'), txt = body.textContent;
      return { ids, a: a.id, b: b.id, c: c.id, posGetter: a.position === null && !!a.archetype,
        noFoot: !/Нога|Foot/.test(txt), bio: /см|cm/.test(txt) && /кг|kg/.test(txt), morale: !!body.querySelector('.energy.morale'),
        tagBtns: body.querySelectorAll('[data-postag]').length, dutyBtns: body.querySelectorAll('[data-duty]').length,
        noNums: !/\b(passing|tackling|vision|discipline|composure)\b\s*[:=]?\s*\d/i.test(txt) };
    });
    await page.click('#pinfo-body [data-postag="FWD"]');
    await page.click('#pinfo-body [data-duty="captain"]');
    const fg1 = await page.evaluate(k => ({ tag: YAM.game.player(k).tag, cap: YAM.game.duties.captain, rowChip: document.querySelector(`#roster .r-row[data-id="${k}"] .pos`)?.textContent,
      badge: !!document.querySelector(`#roster .r-row[data-id="${k}"] .duty-badge.d-captain`) }), fg.a);
    await page.keyboard.press('Escape');
    const fg2 = await page.evaluate(([a, b, c]) => {
      const s = YAM.game;
      s.setDuty('captain', b);                         // exclusive: moves from a to b
      s.setDuty('penalty', c); s.setDuty('corner', a);
      const cap = s.duties.captain, aDuties = s.dutiesOf(a).join();
      // anyone can go in goal: an outfield-archetype kid into slot 0
      const out = s.squad.find(p => p.archetype === 'FWD' && !s.isStarter(p.id) && p.available) || s.squad.find(p => p.archetype !== 'GK' && !s.isStarter(p.id) && p.available);
      const keep0 = s.lineup[0], sw = out ? s.swapPlayers(keep0, out.id) : 'none';
      if (out) s.lineup[0] = keep0;
      // engine: takers + captain + no out-of-position penalty
      for (const id of [a, b, c]) if (!s.isStarter(id)) { const i = s.lineup.findIndex((x, k) => k > 0 && ![a, b, c].includes(x)); s.lineup[i] = id; }
      const e = new YAM.MatchEngine(YAM.ui.homeTeam(), s.matchContext() ? s.matchContext().team : { name: 'X', players: YAM.game.league.roster(YAM.game.league.teams[1], new Set()), formation: '4-4-2' },
        { onLog() {}, onUpdate() {}, onEnd() {} }, { duties: () => s.duties });
      e.started = true; e.kickoff(0); e.poss = 0; e.zone = 2;
      e.penalty(0); const pen = e.pendingShot?.shooter?.id, penFlag = !!e.pendingShot?.penalty;
      e.pendingShot = null;
      const ck = e.taker(0, 'corner').id, capB = e.captainBonus();
      const P = s.player(b), line0 = e.lineOf.get(P.id); const v1 = e.eff(P, 'Pass'); e.lineOf.set(P.id, line0 === 'ATT' ? 'DEF' : 'ATT'); const v2 = e.eff(P, 'Pass');
      e.sentOff.add(b); const capOff = e.captainBonus();
      return { cap, aDuties, sw, pen, penFlag, ck, capB, capOff, oop: v1 === v2 };
    }, [fg.a, fg.b, fg.c]);
    check('fog of war: profile = age/height/weight + energy & morale (no foot, no native position, no numbers); untagged kids show "—"; tag + exclusive duties; anyone in goal; takers & captain in the engine; no out-of-position penalty',
      fg.posGetter && fg.noFoot && fg.bio && fg.morale && fg.tagBtns === 4 && fg.dutyBtns === 3 && fg.noNums && fg1.tag === 'FWD' && fg1.cap === fg.a && fg1.badge
      && fg2.cap === fg.b && fg2.aDuties === 'corner' && fg2.sw === null && fg2.pen === fg.c && fg2.penFlag && fg2.ck === fg.a && fg2.capB > 0.5 && fg2.capOff === 0 && fg2.oop,
      JSON.stringify({ fg, fg1, fg2 }));
    await page.evaluate(() => { for (const k in YAM.game.duties) YAM.game.duties[k] = null; YAM.game.save(); YAM.ui.renderAll(); });

    // v2.4: Monday-first calendar grid + training days + The Truant
    await page.evaluate(() => { YAM.ui.calMonth = '2002-09'; YAM.ui.renderDash(); });
    const cg = await page.evaluate(() => {
      const grid = () => [...document.querySelectorAll('#cal-grid > div')];
      const wd = [...document.querySelectorAll('#cal-grid .cal-wd')].map(x => x.textContent);
      const lead = () => grid().filter(x => !x.classList.contains('cal-wd')).findIndex(x => !x.classList.contains('out'));
      const trOk = () => [...document.querySelectorAll('#cal-grid .cal-day.training')].every(x => [2, 4].includes(new Date(x.dataset.date + 'T00:00:00Z').getUTCDay()));
      const sep = { lead: lead(), tr: document.querySelectorAll('#cal-grid .cal-day.training').length, ok: trOk(), cone: !!document.querySelector('#cal-grid .cal-day.training .cd-cone') };
      YAM.ui.calMonth = '2002-10'; YAM.ui.renderDash();
      const oct = { lead: lead(), ok: trOk(), cols: (grid().length) % 7 };
      YAM.ui.calMonth = null; YAM.ui.renderDash();
      return { mon: wd[0] === fmtDate('2002-09-02', { weekday: 'short' }), sun: wd[6] === fmtDate('2002-09-08', { weekday: 'short' }), sep, oct };
    });
    check('calendar: Monday-first header, Sep 2002 lead 6 (1st = Sunday), Oct 2002 lead 1 (1st = Tuesday), training cells only Tue/Thu',
      cg.mon && cg.sun && cg.sep.lead === 6 && cg.oct.lead === 1 && cg.sep.ok && cg.oct.ok && cg.sep.tr >= 6 && cg.sep.cone && cg.oct.cols === 0, JSON.stringify(cg));
    const trn = await page.evaluate(() => {
      const s = YAM.game, fit = s.squad.filter(p => p.available), lazy = fit[3];
      for (const p of s.squad) { p.energy = 80; p.dyn.sharpness = 50; p.psych.discipline = 15; }
      lazy.psych.discipline = 1;
      const R = Math.random; Math.random = () => 0.99;   // v2.6: arrival skip = random·20 > discipline + 8
      const r = s.dayRoutine('2002-09-10', true, 'cardio');   // Tuesday, v2.5 regime: cardio
      Math.random = R;
      const other = fit.find(p => p !== lazy);
      const out = { training: r.training, skipped: r.skipped.map(p => p.id), lazy: [lazy.energy, lazy.dyn.sharpness, lazy.skipped_training], other: [other.energy, other.dyn.sharpness, other.skipped_training] };
      const r2 = s.dayRoutine('2002-09-11');  // Wednesday = rest
      out.rest = { training: r2.training, other: [other.energy, other.dyn.sharpness], flag: lazy.skipped_training };
      lazy.skipped_training = true;   // keep him as today's truant for the event test
      out.id = lazy.id;
      return out;
    });
    check('training day (cardio regime): discipline roll → skipper unchanged + skipped_training; attendees +5 condition +2 sharpness; rest day +10 / −2 and flag cleared',
      trn.training && trn.skipped.length === 1 && trn.skipped[0] === trn.id && trn.lazy.join() === '80,50,true' && trn.other.join() === '85,52,false'
      && !trn.rest.training && trn.rest.other.join() === '95,50' && trn.rest.flag === false, JSON.stringify(trn));
    await page.evaluate(() => { YAM.game.budget = 10; YAM.ui.renderBudget(); YAM.ui.events.fire('truant'); });
    const tu = await page.evaluate(() => ({ kid: YAM.game.pendingEvent?.cast.kid, n: document.querySelectorAll('#talk-choices .talk-btn').length, fineOff: document.querySelector('#talk-choices .talk-btn[data-i="0"]').disabled,
      face: !!document.querySelector('#talk-face svg rect') }));
    const d0 = await page.evaluate(k => YAM.game.player(k).psych.discipline, tu.kid);
    await page.evaluate(() => { window.__R = Math.random; Math.random = () => 0.1; });
    await talk(2);   // call him → rolled step "sorry"
    await page.evaluate(() => { Math.random = window.__R; });
    const tu2 = await page.evaluate(() => ({ step: YAM.game.pendingEvent?.step, n: document.querySelectorAll('#talk-choices .talk-btn').length }));
    await talk(0);
    const tu3 = await page.evaluate(k => ({ disc: YAM.game.player(k).psych.discipline, closed: !YAM.game.pendingEvent }), tu.kid);
    await page.evaluate(k => { YAM.game.budget = 300; YAM.game.player(k).skipped_training = true; YAM.ui.events.fire('truant'); }, tu.kid);   // the evening event led to a new morning
    await talk(1);   // suspend for the next match
    const tu4 = await page.evaluate(k => ({ sus: YAM.game.player(k).suspensionMatches, starter: YAM.game.isStarter(k) }), tu.kid);
    await page.evaluate(k => { YAM.game.player(k).suspensionMatches = 0; YAM.game.player(k).skipped_training = false; }, tu.kid);
    check('The Truant: skipper\'s portrait, fine disabled under $20, "call him" rolls a saved step (sorry → +2 discipline), suspend = 1 match',
      trn.id === tu.kid && tu.n === 3 && tu.fineOff && tu.face && tu2.step === 'sorry' && tu2.n === 1 && tu3.disc === Math.min(20, d0 + 2) && tu3.closed && tu4.sus === 1 && !tu4.starter,
      JSON.stringify({ tu, tu2, tu3, tu4 }));

    // a dilemma survives a reload, then the calendar pauses on a random event and resumes after the choice
    await page.evaluate(() => YAM.ui.events.fire('boots'));
    await page.reload();
    await page.waitForFunction(() => window.YAM && window.YAM.ui);
    await page.evaluate(() => { YAM.game.excusesOff = true; });
    const re = await page.evaluate(() => ({ open: !document.getElementById('talk-layer').hidden, b: YAM.game.budget, kid: YAM.game.pendingEvent?.cast.kid }));
    await page.click('#talk-choices .talk-btn[data-i="0"]');
    const re2 = await page.evaluate(k => ({ b: YAM.game.budget, mor: YAM.game.player(k).dyn.morale }), re.kid);
    await closeModal();
    const qPersist = await page.evaluate(() => YAM.game.eventQueue.length === 1 && YAM.game.eventQueue[0].id === 'scoutvisit');
    await page.evaluate(() => { Object.assign(EVENTS_CFG, { DAD_CHANCE: 0, KNOCK_CHANCE: 0, SCOUT_CHANCE: 0, POOL_CHANCE: 0, ULTI_CHANCE: 0, BUS_CHANCE: 0, TRUANT_CHANCE: 0, BOOTS_CHANCE: 1 }); YAM.game.eventLog = []; });
    await page.evaluate(() => YAM.ui.autoSim());   // v2.5: END DAY is manual; debug auto-sim to the match
    await page.waitForFunction(() => !document.getElementById('talk-layer').hidden, null, { timeout: 10000 });
    const paused = await page.evaluate(() => ({ running: YAM.ui.cal.running, date: YAM.ui.cal.date, btn: document.getElementById('btn-sim').disabled }));
    await page.waitForTimeout(900); await shot('9-talk');
    await page.evaluate(() => { EVENTS_CFG.BOOTS_CHANCE = 0; });
    await page.click('#talk-choices .talk-btn[data-i="1"]');
    const resumed = await page.evaluate(() => YAM.ui.cal.running);
    await page.waitForFunction(() => YAM.game.phase === 'matchday', null, { timeout: 20000 });
    // the time bomb goes off on the match day, BEFORE kick-off
    await page.waitForFunction(() => !document.getElementById('talk-layer').hidden, null, { timeout: 3000 });
    const fv = await page.evaluate(() => ({ id: YAM.game.pendingEvent?.id, top: YAM.game.pendingEvent?.cast.top, q: YAM.game.eventQueue.length, modal: !document.getElementById('modal-layer').hidden }));
    await talk(0);   // they start and play the full match
    const fv2 = await page.evaluate(t => {
      const s = YAM.game, bench = s.bench().find(b => b.available && b.archetype !== 'GK');
      return { showcase: t.every(id => s.isStarter(id) && s.player(id).hasFlag('Showcase')), modal: !document.getElementById('modal-layer').hidden,
        lock: bench ? s.swapPlayers(t.find(id => s.player(id).archetype !== 'GK') || t[0], bench.id) : 'showcase' };
    }, fv.top);
    check('scheduled scout visit: queue persisted (reload), fires on match day before the matchday dialog, top 3 start and are locked in', qPersist && fv.id === 'scoutvisit' && fv.top.length === 3 && fv.q === 0
      && !fv.modal && fv2.showcase && fv2.modal && fv2.lock === 'showcase', JSON.stringify({ qPersist, fv, fv2 }));
    await closeModal();
    const pr = await page.evaluate(() => {
      const p = YAM.game.squad.find(x => x.flags.includes('Promised_Start'));
      if (YAM.game.isStarter(p.id)) { const fit = YAM.game.bench(); /* v3.0: no position rules */ const i = YAM.game.lineup.indexOf(p.id); if (fit.length) YAM.game.lineup[i] = (fit.find(b => b.archetype === p.archetype) || fit[0]).id; else window.__noFit = YAM.game.bench().map(b => [b.id, b.archetype, b.available]); }
      const b0 = YAM.game.budget, m0 = p.dyn.morale, starter = YAM.game.isStarter(p.id);
      YAM.ui.checkPromises();
      return { starter, refund: b0 - YAM.game.budget, morale: p.dyn.morale < m0 || m0 === 0, cleared: !p.flags.length };
    });
    check('event persists over reload; random event pauses + resumes calendar; broken promise refunds $150',
      re.open && re2.b === re.b - 150 && re2.mor === 100 && !paused.running && paused.btn && resumed && pr.refund === 150 && pr.morale && pr.cleared && !pr.starter,
      JSON.stringify({ re, re2, paused, resumed, pr }));
    // v2.0: Quick Sim — same tick() maths: seeded runs give identical results in visual and instant mode
    const same = await page.evaluate(async () => {
      const seeded = s => () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const R = Math.random, home = YAM.ui.homeTeam(), opp = YAM.game.matchContext().team, out = [];
      const sig = e => JSON.stringify([e.sides.map(x => x.score), [...e.stats.values()], [...e.energy.values()].map(v => v.toFixed(3))]);
      for (const seed of [7, 42, 2002]) {
        Math.random = seeded(seed);
        const a = new YAM.MatchEngine(home, opp, { onLog() {}, onUpdate() {}, onEnd() {} }, {}).runInstant();
        Math.random = seeded(seed);
        const b = await new Promise(res => {
          const e = new YAM.MatchEngine(home, opp, { onLog() {}, onUpdate() {}, onEnd: x => res(x), onHalfTime: x => setTimeout(() => x.resume(), 0) }, { speed: 5 });
          e.start();
        });
        out.push(sig(a) === sig(b));
      }
      Math.random = R;
      return out;
    });
    check('Quick Sim: instant and visual drivers give identical results (3 seeds)', same.every(Boolean), JSON.stringify(same));
    // v2.8: an immediate request in the match-day locker room (forced: every present kid asks) → "Go home"
    await page.evaluate(() => { YAM.game.squad.forEach(p => { p.psych.discipline = 20; if (p.energy < 30) p.energy = 60; }); YAM.game.excusesOff = false; window.__EB = EXCUSE.BASE; EXCUSE.BASE = 1;
      YAM.game.rep.parents = 50; });
    await toLocker();
    await page.waitForFunction(() => !document.getElementById('talk-layer').hidden, null, { timeout: 4000 });
    const ex0 = await page.evaluate(() => ({ id: YAM.game.pendingEvent?.id, kid: YAM.game.pendingEvent?.cast.kid, n: document.querySelectorAll('#talk-choices .talk-btn').length,
      blocked: (YAM.ui.locker.proceed(), !document.getElementById('locker-room-view').hidden) }));
    await talk(0);   // go home
    const ex1 = await page.evaluate(k => ({ parents: YAM.game.rep.parents, absent: YAM.game.player(k).absentToday, slot: !!document.querySelector(`#lr-grid .lk.empty.checked[data-pid="${k}"]`),
      done: YAM.game.dayState().locker.request.done }), ex0.kid);
    await page.evaluate(() => { EXCUSE.BASE = window.__EB; YAM.game.excusesOff = true; });
    check('immediate request: a present kid interrupts the locker room (Proceed blocked); "Go home" → out of today\'s squad, Parents +5',
      ex0.id === 'excuse' && ex0.n === 2 && ex0.blocked && ex1.parents === 55 && ex1.absent === 'excused' && ex1.slot && ex1.done, JSON.stringify({ ex0, ex1 }));
    const rp = await page.evaluate(() => {
      const s = YAM.game, b0 = s.budget; s.rep.board = 75; s.rep.parents = 80;
      s.repDaily('2002-10-01'); const grant = s.budget - b0;
      const b1 = s.budget; s.repDaily('2002-10-06'); const gift = s.budget - b1;
      const e = new YAM.MatchEngine(YAM.ui.homeTeam(), s.matchContext().team, { onLog() {}, onUpdate() {}, onEnd() {} }, { squadRep: 100 });
      s.rep.board = 50; s.rep.parents = 55; s.budget = b0;
      return { grant, gift, bonus: e.repBonus, mod: e.mod(0, 'atk') - e.mod(1, 'atk') };
    });
    check('reputation: board grant on the 1st ($50 + (75−50)×4 = $150), happy parents donate on Sunday, squad rep 100 → +2 on our rolls',
      rp.grant === 150 && rp.gift > 0 && rp.bonus === 2 && rp.mod === 2, JSON.stringify(rp));
    await page.evaluate(() => YAM.ui.locker.open());
    const lrMatch = await page.evaluate(() => ({ open: !document.getElementById('locker-room-view').hidden, kind: !!document.querySelector('#lr-head .k-match'),
      btn: document.getElementById('lr-proceed').textContent }));
    await page.click('#lr-proceed');
    check('match day: locker room before the match (Proceed → match prep)', lrMatch.open && lrMatch.kind && (await page.evaluate(() => YAM.ui.view === 'match')), JSON.stringify(lrMatch));
    await page.click('.tk[data-view=match]');
    const qs0 = await page.evaluate(() => ({ btn: !document.getElementById('btn-instant').disabled, apps: Object.values(YAM.game.seasonStats).reduce((a, s) => a + s.apps, 0),
      energy: YAM.game.starters().map(p => p.energy) }));
    await page.click('#btn-instant');
    await page.waitForFunction(() => YAM.game.phase === 'post', null, { timeout: 5000 });
    const qsum = await page.evaluate(() => ({ open: !document.getElementById('msum-layer').hidden, quick: /QUICK|БЫСТР/.test(document.getElementById('msum-body').textContent),
      goals: document.querySelectorAll('#msum-body .ms-ev.goal').length, total: YAM.game.lastReport.gf + YAM.game.lastReport.ga }));
    await page.click('#msum-go');
    check('Quick Sim → Match Summary first (same event list), then Notebook', qsum.open && qsum.quick && qsum.goals === qsum.total, JSON.stringify(qsum));
    const qs = await page.evaluate(e0 => ({ ms: YAM.ui.lastSimMs, view: YAM.ui.view, cards: document.querySelectorAll('#notes-body .card').length,
      md2: YAM.game.league.fixturesOf(2).every(f => f.hg !== null), modal: !document.getElementById('modal-layer').hidden,
      apps: Object.values(YAM.game.seasonStats).reduce((a, s) => a + s.apps, 0), tired: YAM.game.lastReport && YAM.game.starters().some((p, i) => p.energy < e0[i]),
      score: document.getElementById('sb-score').textContent, rep: YAM.game.lastReport.gf + '-' + YAM.game.lastReport.ga }), qs0.energy);
    const after = await page.evaluate(([t, u]) => ({ showcase: t.some(id => YAM.game.player(id).hasFlag('Showcase')), sus: YAM.game.player(u).suspensionMatches,
      diary: YAM.game.diary.filter(d => /^scout\.(done|hurt)$/.test(d.key)).length }), [fv.top, ul]);
    check('after the match: showcase cleared (+ diary per kid), suspension served (2 → 1)', !after.showcase && after.sus === 1 && after.diary === fv.top.filter(id => id !== ex0.kid).length, JSON.stringify(after));
    check('Quick Sim: button → result in ms, Notebook opens, stats/energy/fixtures recorded', qs0.btn && qs.ms < 250 && qs.view === 'notes' && qs.cards === 3 && qs.md2 && !qs.modal
      && qs.apps >= qs0.apps + 11 && qs.tired && qs.score.replace(/\s/g, '') === qs.rep, JSON.stringify(qs));
    await page.click('#btn-lang'); await page.click('#btn-lang');
    check('frame loop cost < 2 ms', await page.evaluate(() => (YAM.ui.radar.frameCost ?? 0) < 2), (await page.evaluate(() => (YAM.ui.radar.frameCost ?? 0).toFixed(2))) + ' ms');
  } catch (e) {
    check('no exception during run', false, e.message.split('\n')[0]);
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();

  const failed = results.filter(r => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.info ? '  (' + r.info + ')' : ''}`);
  console.log(failed.length ? `\n${failed.length} check(s) failed` : `\nAll ${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
