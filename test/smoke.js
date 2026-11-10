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
    check('profile card: notebook right-click, season stats + note + 96px face', pc3.open && pc3.apps === 1 && pc3.age >= 14 && pc3.age <= 16 && pc3.txt && pc3.note && pc3.svg >= 90, JSON.stringify(pc3));
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
