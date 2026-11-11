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

const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');
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
  const shot = async name => { if (SHOTS) { fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true }); await page.screenshot({ path: path.join(__dirname, 'shots', name + '.png') }); } };
  const modalOpen = () => page.evaluate(() => !document.getElementById('modal-layer').hidden);
  const closeModal = async () => { if (await modalOpen()) await page.keyboard.press('Escape'); };

  try {
    await page.goto(FILE);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => window.YAM && window.YAM.ui);

    const ver = await page.evaluate(() => APP_VERSION);
    const title = await page.title();
    check('version in <title> and taskbar', title.endsWith('v' + ver) && (await page.textContent('#app-title')).includes('v' + ver), `${title}`);
    check('update notice shown once', await modalOpen());
    check('dashboard backdrop visible', await page.evaluate(() => document.getElementById('scene-office').classList.contains('active')));
    await closeModal();

    // fast match for testing
    await page.evaluate(() => { for (const k of [1, 2, 5]) { YAM.MatchEngine.SPEED[k] = 6; YAM.MatchEngine.HIGHLIGHT[k] = 12; } });

    // calendar → matchday
    await page.click('#btn-sim');
    await page.waitForFunction(() => YAM.game.phase === 'matchday', null, { timeout: 20000 });
    check('calendar stops on matchday', true, await page.evaluate(() => YAM.ui.cal.date));
    await shot('1-dashboard');
    await closeModal();
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
      const inn = YAM.game.squad.find(p => !e.sides[0].players.includes(p) && p.position === 'MID');
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
    await shot('3-fulltime');

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
