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

    // v3.1: a new academy starts with the Yard Match draft (world of 100 kids, 30 on the pitch, sign 15)
    const dr0 = await page.evaluate(() => {
      const s = YAM.game, w = s.globalPlayers, g = document.getElementById('dr-grid'), card = g.querySelector('.dr-card');
      return { open: !document.getElementById('intro-draft-view').hidden, phase: s.phase, world: w.length, free: w.filter(p => p.teamId === 'free_agent').length,
        rivals: w.filter(p => /^rival_/.test(p.teamId)).length, squad: s.squad.length, cards: g.querySelectorAll('.dr-card').length,
        allFree: s.draft.pool.every(id => w.find(p => p.id === id).teamId === 'free_agent'), notes: !!card.querySelector('.dr-notes li') && !card.querySelector('.dr-stars') && !/★/.test(g.textContent), face: !!card.querySelector('svg'),
        noPos: !card.querySelector('.pos'), bio: (card.querySelector('.dr-bio').textContent.match(/\d+/g) || []).length === 3, start: document.getElementById('dr-start').disabled };
    });
    for (let i = 0; i < 16; i++) await page.click(`#dr-grid .dr-card:nth-child(${i + 1}) [data-sign]`, { force: true });   // the 16th must be refused
    await page.evaluate(() => YAM.game.save());
    await page.reload();   // the draft survives a reload
    await page.waitForFunction(() => window.YAM && window.YAM.ui);
    await closeModal();
    const dr1 = await page.evaluate(() => ({ signed: YAM.game.draftSigned().length, open: !document.getElementById('intro-draft-view').hidden, start: !document.getElementById('dr-start').disabled,
      off: document.querySelectorAll('#dr-grid .dr-card:not(.on) [data-sign]:disabled').length }));
    const picked = await page.evaluate(() => [...YAM.game.draftSigned()]);
    await page.click('#dr-start');
    const dr2 = await page.evaluate(ids => { const s = YAM.game; return { phase: s.phase, n: s.squad.length, same: s.squad.every(p => ids.includes(p.id)) && ids.length === 15,
      team: s.squad.every(p => p.teamId === 'player_team'), free: s.globalPlayers.filter(p => p.teamId === 'free_agent').length, world: s.globalPlayers.length,
      xi: s.lineup.length === 11 && s.lineup.every(id => ids.includes(id)), closed: document.getElementById('intro-draft-view').hidden, nums: s.squad.map(p => p.number).sort((a, b) => a - b).join() }; }, picked);
    check('Yard Match draft: 100-kid world (40 at rivals, 60 free), 30 free agents shown with face/age/height/weight + yard notes only (no stars); exactly 15 signed (16th refused, survives reload); START SEASON → squad = those 15',
      dr0.open && dr0.phase === 'draft' && dr0.world === 100 && dr0.free === 60 && dr0.rivals === 40 && dr0.squad === 0 && dr0.cards === 30 && dr0.allFree && dr0.notes && dr0.face && dr0.noPos && dr0.bio && dr0.start
      && dr1.signed === 15 && dr1.open && dr1.start && dr1.off === 15 && dr2.phase === 'calendar' && dr2.n === 15 && dr2.same && dr2.team && dr2.free === 45 && dr2.world === 100 && dr2.xi && dr2.closed
      && dr2.nums === Array.from({ length: 15 }, (_, i) => i + 1).join(), JSON.stringify({ dr0, dr1, dr2 }));

    // fast match for testing
    await page.evaluate(() => { for (const k of [1, 2, 5]) { YAM.MatchEngine.SPEED[k] = 6; YAM.MatchEngine.HIGHLIGHT[k] = 12; } });

    // calendar → matchday (random narrative events off here; they are tested at the end)
    await page.evaluate(() => { YAM.ui.events.enabled = false; YAM.game.excusesOff = true; YAM.game.squad.forEach(p => { p.psych.discipline = 20; }); });   // v2.6: everyone turns up (deterministic)
    await page.evaluate(() => YAM.ui.autoSim());   // v2.5: END DAY is manual; debug auto-sim to the match
    await page.waitForFunction(() => YAM.game.phase === 'matchday', null, { timeout: 20000 });
    check('calendar stops on matchday', true, await page.evaluate(() => YAM.ui.cal.date));
    // v3.4: the briefing tells the opponent's condition (AI clubs live by the same energy rules)
    const opp0 = await page.evaluate(() => { YAM.ui.briefing.render(); const ctx = YAM.game.matchContext();
      return { agenda: document.getElementById('mb-agenda').textContent, sq: ctx.opp.squad.length, xi: ctx.team.players.length, en: ctx.opp.squad.map(k => k.en), name: ctx.opp.name }; });
    check('AI fatigue: 15-kid AI squads with energy, XI of 11, briefing scout line', opp0.sq === 15 && opp0.xi === 11 && opp0.en.every(e => e === 100) && /100%/.test(opp0.agenda), opp0.agenda);
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
    // v3.4: match log — every duel with its terms (they add up to the total), CSV / JSON export buttons
    const lg = await page.evaluate(() => {
      const g = YAM.ui.lastMatchLog, sum = x => x.stat + x.mood + x.rand + Object.values(x.flat).reduce((a, b) => a + b, 0) + x.shout + x.rep + x.cap + x.cheat;
      const csv = MatchEngine.traceCsv(g.trace, g.teams.map(t => t.name)).split('\n');
      return { n: g.trace.length, sums: g.trace.every(t => Math.abs(sum(t.A) - t.A.total) < 0.05 && Math.abs(sum(t.D) - t.D.total) < 0.05),
        goals: g.trace.filter(t => t.out === 'goal').length, score: g.teams[0].score + g.teams[1].score, kinds: [...new Set(g.trace.map(t => t.kind))].length,
        csvRows: csv.length - 1, head: csv[0].startsWith('minute,kind,team,zone,atk_name'), players: g.teams[0].players.every(p => 'energyStart' in p && 'fatigueEnd' in p),
        btn: !document.getElementById('msum-csv').disabled && !document.getElementById('msum-json').disabled };
    });
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('#msum-csv')]);
    const dlName = dl.suggestedFilename(), dlText = fs.readFileSync(await dl.path(), 'utf8');
    check('match log: duels add up, goals = score, CSV header + 1 row per duel, download works', lg.n > 50 && lg.sums && lg.goals === lg.score && lg.kinds >= 4
      && lg.csvRows === lg.n && lg.head && lg.players && lg.btn && /^yam-log-md1-.*\.csv$/.test(dlName) && dlText.split('\n').length - 1 === lg.n, JSON.stringify({ ...lg, dlName }));
    const aiAfter = await page.evaluate(n => { const t = YAM.game.league.teams.find(x => x.name === n), e = YAM.ui.engine;
      return t.squad.map(k => ({ en: k.en, played: e.sides[1].all.some(p => p.id === k.id), end: Math.round(e.energy.get(k.id) ?? -1) })); }, opp0.name);
    check('AI fatigue: the opponent XI keeps its end-of-match energy, the rest +6 (capped)', aiAfter.filter(k => k.played).length === 11
      && aiAfter.every(k => k.played ? k.en === Math.max(0, Math.min(100, k.end)) && k.en < 100 : k.en === 100), JSON.stringify(aiAfter.map(k => k.en)));
    // v3.5: Match Summary = blocking modal until the team talk; then Coach's Word unlocks Proceed
    const lock = await page.evaluate(() => {
      const ui = YAM.ui, view0 = ui.view, id = YAM.game.squad[0].id;
      document.querySelector('.tk[data-view=table]').click();
      document.getElementById('btn-startmenu').click();
      ui.show('team'); ui.profile.open(id); ui.teamCard.open(1); ui.debug.open(); ui.locker.open();
      document.getElementById('btn-ver').click(); document.getElementById('btn-debug').click();   // v3.9: ReadMe + DEBUG from the tray
      document.querySelector('#roster .r-row')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.getElementById('msum-go').click(); document.getElementById('msum-x').click();
      return { view: ui.view === view0, lock: ui.modalLock, cls: document.body.classList.contains('modal-lock'),
        inert: ['desktop', 'taskbar', 'startmenu'].every(i => document.getElementById(i).inert),
        start: !document.getElementById('startmenu').classList.contains('open'),
        others: ['pinfo-layer', 'troster-layer', 'debug-layer', 'locker-room-view'].every(i => document.getElementById(i).hidden),
        table: !document.getElementById('win-table').classList.contains('open'), open: !document.getElementById('msum-layer').hidden,
        goOff: document.getElementById('msum-go').disabled && document.getElementById('msum-x').disabled,
        btns: document.querySelectorAll('#msum-body .ms-talk-btn:not([disabled])').length,
        tags: [...document.querySelectorAll('#msum-body .ms-talk-btn')].every(b => b.querySelector('.fx i')),
        pending: YAM.game.lastReport.talk === null && /"talk":null/.test(localStorage.getItem('yam_save_v1')),
        readme: !document.getElementById('win-readme').classList.contains('open'),
        lockTip: (() => { const b = document.getElementById('msum-lockbar'), r = b.getBoundingClientRect(), t = document.getElementById('taskbar').getBoundingClientRect();
          return b.title === L.t('lock.tipTalk') && !!b.textContent && Math.abs(r.bottom - t.bottom) < 2 && r.height >= t.height - 2; })(),
        greyTk: getComputedStyle(document.querySelector('.tk[data-view=table]')).color === 'rgb(124, 128, 122)' };
    });
    await page.keyboard.press('Escape');
    lock.escKept = await page.evaluate(() => !document.getElementById('msum-layer').hidden);
    check('v3.5 modal lock: Match Summary blocks taskbar / Start / views / profile / roster / debug / locker; Esc, × and Proceed refused before the team talk',
      Object.values(lock).every(Boolean) && lock.btns === 3, JSON.stringify(lock));
    const before = await page.evaluate(() => ({ m: YAM.game.squad.map(p => p.dyn.morale), rep: { ...YAM.game.rep }, d: YAM.game.diary.length }));
    await page.click('#msum-body [data-talk="praise"]');
    await shot('3b-teamtalk');
    const tt = await page.evaluate(b => {
      const s = YAM.game, fx = talkEffects('praise', s.lastReport), cl = v => Math.max(0, Math.min(100, v));
      return { fx: !!fx, talk: s.lastReport.talk === 'praise', saved: /"talk":"praise"/.test(localStorage.getItem('yam_save_v1')),
        morale: s.squad.every((p, i) => p.dyn.morale === cl(b.m[i] + fx.morale)),
        rep: ['board', 'parents', 'squad'].every(k => s.rep[k] === cl(b.rep[k] + (fx[k] || 0))),
        diary: s.diary.length === Math.min(80, b.d + 1) && s.diary[s.diary.length - 1].key === 'tt.diary',
        diaryReact: (d => d.vars.r.talkReact === 'praise.' + talkOutcome(s.lastReport) && YAM.ui.entryText({ ...d, r: 0 }).includes(L.t('tt.react.' + d.vars.r.talkReact))
          && YAM.ui.entryText({ ...d, r: 0 }).includes(L.t('tt.name.praise')))(s.diary[s.diary.length - 1]),
        sayByResult: document.querySelector('#msum-body [data-talk="praise"] .q').textContent === L.t('tt.say.praise.' + (s.lastReport.result)),
        react: !!document.querySelector('#msum-body .ms-talk-react:not(.wait)'),
        locked: document.querySelectorAll('#msum-body .ms-talk-btn:not([disabled])').length === 0 && !!document.querySelector('#msum-body .ms-talk-btn.chosen'),
        go: !document.getElementById('msum-go').disabled, stillLocked: YAM.ui.modalLock };
    }, before);
    await page.click('#msum-go');
    tt.unlocked = await page.evaluate(() => !YAM.ui.modalLock && YAM.ui.view === 'notes' && !document.getElementById('taskbar').inert && !document.body.classList.contains('modal-lock'));
    check('v3.5 team talk: praise applies morale + factions once, diary + save, reaction line, buttons locked, Proceed enabled → Notebook unlocks the desktop',
      Object.values(tt).every(Boolean), JSON.stringify(tt));

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
      return { squads: ai.every(t => t.squad.length === League.SQUAD_SIZE), mp: ai.every(t => t.squad.filter(k => k.mp === 1).length === 11),
        fxGoals, kidGoals, ast: kidAst <= kidGoals, scorers: document.querySelectorAll('#top-scorers tbody tr').length,
        assists: document.querySelectorAll('#top-assists tbody tr').length, nav: document.querySelector('.tk[data-view="table"] .lbl').textContent };
    });
    check('league stats: 15-kid AI squads, goals add up, leaders tables', ls.squads && ls.mp && ls.fxGoals === ls.kidGoals && ls.ast
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
    check('team roster modal: click row, emblem, position, 15 rows sorted by goals, Esc closes', tr.open && /_ROSTER\.EXE$/.test(tr.title)
      && tr.rows === 15 && tr.sorted && tr.badge && tr.place && closed, JSON.stringify({ ...tr, closed }));
    // v1.8: attribute structure + DEBUG.EXE (database + god mode); hidden attrs never on the Profile Card
    const at = await page.evaluate(() => {
      const sq = YAM.game.squad, G = { physical: 5, technical: 7, tactical: 3, psych: 4 };
      const okRange = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
      return { groups: sq.every(p => Object.entries(G).every(([g, n]) => Object.keys(p[g]).length === n)),
        skills: sq.every(p => ['physical', 'technical', 'tactical'].every(g => Object.values(p[g]).every(v => okRange(v, 1, 20)))),
        pa: sq.every(p => okRange(p.psych.potential, 1, 10) && Number.isInteger(p.psych.potential) && p.gains && typeof p.gains === 'object'), bio: sq.every(p => okRange(p.bio.age, 13, 16) && 'LR'.includes(p.bio.strongFoot) && okRange(p.bio.weakFoot, 1, 5) && p.bio.height > 130),
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
    const hdr0 = await page.evaluate(() => ({ b: YAM.game.budget, txt: document.getElementById('hdr-budget').textContent,   // v3.15: $500 + this month's fees (every change is in the ledger)
      led: Object.values(YAM.game.ledger).reduce((a, m) => a + Object.values(m).reduce((x, y) => x + y, 0), 0), fee: YAM.game.ledger['2002-09']?.fee || 0 }));
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
    check('budget in header = $500 + the ledger (September fees); Torn Boots: snitch face, unaffordable choice disabled, Esc blocked, "no" = agility −2',
      hdr0.b === 500 + hdr0.led && hdr0.fee > 0 && hdr0.txt.includes('$' + hdr0.b) && bt.n === 2 && bt.dis && bt.en && bt.face && /\$100/.test(bt.hdr) && still
      && bt2.agi === Math.max(1, bt.agi - 2) && bt2.closed && !bt2.pe && bt2.b === 100 && bt2.diary === 'ev.boots.b.diary', JSON.stringify({ hdr0, bt, still, bt2 }));
    await page.evaluate(() => YAM.ui.events.fire('dad'));
    await page.waitForTimeout(100);
    const dd = await page.evaluate(() => ({ kid: YAM.game.pendingEvent.cast.kid, worst: (w => (w('rich') || w('middle') || w(null)).id)(w => [...YAM.game.squad].filter(p => !w || p.wealth === w).sort((a, b) => a.overall - b.overall)[0]),   // v3.15: the weakest RICH kid
      sil: document.querySelector('#talk-face svg rect:nth-of-type(2)') !== null }));
    await page.click('#talk-choices .talk-btn[data-i="0"]');
    const dd2 = await page.evaluate(k => ({ b: YAM.game.budget, flag: YAM.game.player(k).flags.includes('Promised_Start'), hdr: document.getElementById('hdr-budget').textContent,
      chip: !!document.querySelector(`#roster .r-row[data-id="${k}"] .tag.flag`) }), dd.kid);
    check("Rich Kid's Dad: the weakest kid of a rich family (v3.15), take money = +$300 + Promised_Start chip", dd.kid === dd.worst && dd.sil && dd2.b === 400 && dd2.flag && /\$400/.test(dd2.hdr) && dd2.chip, JSON.stringify({ dd, dd2 }));
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

    // v3.13: weekly loop — Monday briefing (AP line) → PLANNER.EXE → [ CONFIRM WEEK ] → [ CONTINUE ] skips quiet days, stops on trainings
    await page.evaluate(() => { YAM.ui.events.enabled = false; YAM.ui.show('dash'); });
    const dl0 = await page.evaluate(() => ({ date: YAM.game.calendar.date, ap: document.getElementById('hdr-ap').textContent, btn: document.getElementById('btn-sim').disabled,
      today: !!document.querySelector('#today-box .td-ap'), strip: document.querySelectorAll('#today-box .td-wd').length, blk: YAM.ui.dayBlockers()[0], label: document.getElementById('btn-sim').textContent }));
    const dayOf = d => new Date(d + 'T00:00:00Z').getUTCDay();
    const days = (a, b) => (new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5;
    const ofPre = await page.evaluate(() => { const p = YAM.game.squad.find(x => x.available); return { blk: YAM.ui.officeBlock(p.id), dow: new Date(YAM.game.calendar.date + 'T00:00:00Z').getUTCDay() }; });
    await page.click('#btn-sim');   // Sunday: [ CONTINUE ] → Monday (the week is not planned yet) → the morning briefing opens by itself
    // v3.14/v3.15: this week's seeded world event (if any — per-game salt) is cleared — the v3.13 checks below pin exact numbers; world events have their own checks
    await page.evaluate(() => { YAM.game.worldEvent = null; YAM.ui.briefing.render(); });
    const mb = await page.evaluate(() => ({ open: !document.getElementById('morning-briefing-view').hidden, z: +getComputedStyle(document.getElementById('morning-briefing-view')).zIndex,
      date: document.getElementById('mb-date').textContent, wx: document.getElementById('mb-weather').textContent.trim(), news: document.querySelectorAll('#mb-news li').length,
      rep: document.querySelectorAll('#mb-rep .rep-row .rep-bar').length, btn: document.getElementById('mb-go').textContent, kind: YAM.ui.dayInfo(YAM.game.calendar.date).kind,
      ap: document.getElementById('mb-ap').hidden ? '' : document.getElementById('mb-ap').textContent, src: YAM.game.weekState().apSources, last: YAM.game.lastResult(),
      away: document.querySelectorAll('#mb-away li').length }));
    await shot('11-briefing');
    await page.click('#mb-go');   // → PLANNER.EXE
    const wp0 = await page.evaluate(() => {
      const s = YAM.game, g = document.getElementById('pl-grid');
      const r = { open: !document.getElementById('planner-view').hidden, z: +getComputedStyle(document.getElementById('planner-view')).zIndex, cols: g.querySelectorAll('.pl-col').length,
        fixed: g.querySelectorAll('.pl-col.fixed').length, match: !!g.querySelector('.pl-col.fixed.m'), opts: g.querySelectorAll('.pl-opt:not(:disabled)').length, blk: YAM.ui.dayBlockers()[0],
        label: document.getElementById('btn-sim').textContent, date: s.calendar.date, confirmed: s.weekState().confirmed, top: YAM.ui.topLayer()?.el.id };
      YAM.ui.continueDays(); r.stuck = s.calendar.date === r.date && !s.weekState().confirmed;   // the blocker holds the calendar
      return r;
    });
    await shot('12-planner');
    // v3.13: the office is open on Monday for every kid (here: over the planner), 1 AP from the weekly wallet
    const ofPost = await page.evaluate(() => YAM.ui.officeBlock(YAM.game.squad.find(x => x.available).id));
    const kidO = await page.evaluate(() => { const s = YAM.game, p = s.squad.find(x => x.available && x.archetype !== 'GK'); s.weekState().ap = 1; p.dyn.sharpness = 30; p.dyn.morale = 60;
      if (s.fees?.status[p.id]) s.fees.status[p.id] = 'paid';   // v3.15: a kid who owes gets a 5th line ("About the fee") — tested separately
      YAM.ui.renderBudget(); YAM.ui.profile.open(p.id); return p.id; });
    const of0 = await page.evaluate(() => ({ vis: !document.getElementById('pinfo-office').hidden, dis: document.getElementById('pinfo-office').disabled }));
    await page.click('#pinfo-office');
    const of1 = await page.evaluate(() => ({ ap: YAM.game.ap, open: !document.getElementById('talk-layer').hidden, n: document.querySelectorAll('#talk-choices .talk-btn').length, chip: document.getElementById('hdr-ap').className }));
    await talk(0);   // praise — he is out of form → backfire
    const of2 = await page.evaluate(() => ({ step: YAM.game.pendingEvent?.step }));
    await talk(0);
    const of3 = await page.evaluate(k => { YAM.ui.profile.open(k); return { m: YAM.game.player(k).dyn.morale, dis: document.getElementById('pinfo-office').disabled, closed: !YAM.game.pendingEvent,
      planner: !document.getElementById('planner-view').hidden }; }, kidO);
    await page.keyboard.press('Escape');   // closes only the profile; the planner stays
    // planner: 5 trainings → words-only warnings on the 3rd and the 4th–5th; then Tue cardio + Thu match practice, confirm
    for (const k of ['mon', 'tue', 'wed', 'thu', 'fri']) await page.click(`#pl-grid [data-day="${k}"][data-reg="tech"]`);
    const wp1 = await page.evaluate(() => ({ n: YAM.game.trainingsPlanned(), warn: [...document.querySelectorAll('#pl-grid .pl-warn')].map(x => x.textContent.trim()),
      over: document.querySelectorAll('#pl-grid .pl-warn.over').length, sum: document.getElementById('pl-sum').textContent, planner: !document.getElementById('planner-view').hidden }));
    for (const k of ['mon', 'wed', 'fri']) await page.click(`#pl-grid [data-day="${k}"][data-reg="rest"]`);
    await page.click('#pl-grid [data-day="tue"][data-reg="cardio"]'); await page.click('#pl-grid [data-day="thu"][data-reg="match"]');
    await page.click('#pl-confirm');
    const wp2 = await page.evaluate(() => { const s = YAM.game, w = s.weekState();
      return { closed: document.getElementById('planner-view').hidden, confirmed: w.confirmed, plan: WEEK.PLAN_KEYS.map(k => w.plan[k] || '-').join(), blk: YAM.ui.dayBlockers().length,
        label: document.getElementById('btn-sim').textContent, dis: document.getElementById('btn-sim').disabled, monTr: s.isOurTraining(s.calendar.date), aiTue: isTrainingDay(isoAdd(w.start, 1)) }; });
    check('v3.13 planner: Monday briefing shows the AP make-up, then PLANNER.EXE (z 50, 7 columns, Sat match + Sun rest fixed, Rest + 4 regimes Mon–Fri); [ CONFIRM WEEK ] blocks CONTINUE; 3rd = heavy, 4th–5th = overload (words only); confirm → CONTINUE',
      dl0.today && dl0.strip === 7 && dayOf(dl0.date) === 0 && !dl0.blk && /ПРОДОЛЖИТЬ|CONTINUE/.test(dl0.label) && !dl0.btn && days(dl0.date, wp0.date) === 1 && mb.open && mb.z === 50 && mb.date.length > 6 && mb.wx.length > 2 && mb.news >= 1 && mb.news <= 2 && mb.rep === 3
      && /PLANNER/.test(mb.btn) && mb.kind === 'rest' && mb.src.total === Math.min(7, 4 + mb.src.carry + (mb.last === 'W' ? 1 : 0)) && mb.ap.includes(String(mb.src.total)) && /4/.test(mb.ap)
      && wp0.open && wp0.z === 50 && wp0.cols === 7 && wp0.fixed === 2 && wp0.match && wp0.opts === 25 && wp0.blk === 'week' && /ПЛАН|PLAN/.test(wp0.label) && wp0.stuck && wp0.top === 'planner-view'
      && wp1.n === 5 && wp1.warn.length === 5 && !wp1.warn[0] && !wp1.warn[1] && /Тяжеловат|Heavy/.test(wp1.warn[2]) && /Перегруз|Overload/.test(wp1.warn[3]) && wp1.over === 2 && !/\d\s*%/.test(wp1.warn.join() + wp1.sum)
      && wp2.closed && wp2.confirmed && wp2.plan === '-,cardio,-,match,-' && wp2.blk === 0 && /ПРОДОЛЖИТЬ|CONTINUE/.test(wp2.label) && !wp2.dis && !wp2.monTr && wp2.aiTue,
      JSON.stringify({ dl0, mb, wp0, wp1, wp2 }));
    // [ CONTINUE ] on Monday → Tuesday (planned training): the briefing opens by itself
    await page.click('#btn-sim');
    const ct1 = await page.evaluate(() => ({ date: YAM.game.calendar.date, brief: !document.getElementById('morning-briefing-view').hidden, ap: YAM.game.ap, away: document.querySelectorAll('#mb-away li').length }));
    // v2.6: training day → locker room (forced absences) → roll call → Proceed → regime (from the plan) → CONTINUE
    const lr0 = await page.evaluate(() => {
      const s = YAM.game, fit = s.squad.filter(p => p.available && p.archetype !== 'GK' && !(p.suspensionMatches > 0));
      for (const p of s.squad) { p.energy = 50; p.dyn.morale = 60; p.psych.discipline = 15; p.injuryDays = 0; p.awayDays = 0; }
      const [tired, lazy, hurt, keep] = [fit[0], fit[1], fit[2], fit[3]];
      tired.energy = 10; lazy.psych.discipline = 1; hurt.injuryDays = 5;
      if (!s.isStarter(lazy.id)) { const i = s.lineup.findIndex((id, k) => k > 0 && ![tired.id, hurt.id].includes(id)); s.lineup[i] = lazy.id; }
      s.weekState().ap = 1;
      s.save(); YAM.ui.renderAll();
      return { pre: s.squad.filter(p => p.suspensionMatches > 0).length, date: s.calendar.date, tired: tired.id, lazy: lazy.id, hurt: hurt.id, keep: keep.id, lazyStarter: s.isStarter(lazy.id),
        btn: document.getElementById('btn-sim').disabled, label: document.getElementById('btn-sim').textContent, need: !!document.querySelector('#today-box .td-req.need'),
        plans: document.querySelectorAll('#today-box .plan-btn').length };
    });
    await page.evaluate(() => { window.__R = Math.random; Math.random = () => 0.99; });
    await page.click('#mb-go');     // HEAD TO THE CLUB → locker room (arrivals rolled here)
    await page.evaluate(() => { Math.random = window.__R; });
    await page.waitForTimeout(250);
    const lr1 = await page.evaluate(ids => {
      const g = document.getElementById('lr-grid'), lk = YAM.game.dayState().locker;
      return { n: YAM.game.squad.length, open: !document.getElementById('locker-room-view').hidden, cells: g.querySelectorAll('.lk').length, empty: [...g.querySelectorAll('.lk.empty')].map(x => x.dataset.pid).sort(),
        faces: g.querySelectorAll('.lk.here .lk-face svg').length, why: [lk.absent[ids.tired], lk.absent[ids.lazy], lk.absent[ids.hurt]], skipFlag: YAM.game.player(ids.lazy).skipped_training };
    }, lr0);
    await shot('10-locker');
    // v3.2 → v3.13: in the locker room the office is open only for kids who turned up
    const ofLk = await page.evaluate(ids => {
      const ui = YAM.ui, here = YAM.game.squad.find(p => !YAM.game.dayState().locker.absent[p.id]);
      ui.profile.open(ids.lazy); const absentBtn = { dis: document.getElementById('pinfo-office').disabled, t: document.getElementById('pinfo-office').textContent }; ui.profile.close();
      ui.profile.open(here.id); const hereBtn = !document.getElementById('pinfo-office').disabled; ui.profile.close();
      return { absent: ui.officeBlock(ids.lazy), absentBtn, here: ui.officeBlock(here.id), hereBtn };
    }, lr0);
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
      swap: YAM.game.swapPlayers(YAM.game.lineup[1], id), on: document.querySelector('#today-box .plan-btn.on')?.dataset.plan,
      need: !!document.querySelector('#today-box .td-req.need'), plans: document.querySelectorAll('#today-box .plan-btn').length }), lr0.lazy);
    check('locker room: START DAY opens it, absences = exhausted / skipped / injured (empty lockers), absent kids locked out, roll call = 1 AP + fine, Proceed → today\'s regime from the plan, CONTINUE ready',
      !lr0.btn && lr0.need && lr0.plans === 0 && lr0.lazyStarter && lr1.open && lr1.cells === lr1.n && lr1.empty.length === 3 + lr0.pre && lr1.faces === lr1.n - 3 - lr0.pre
      && lr1.why.join() === 'exhausted,skipped,injury' && lr1.skipFlag && lr4.swap === 'unavail_absent' && lr2.ap === 0 && lr2.talk && lr2.n === 2
      && lr3.b === lr2.b - 10 && lr3.disc === disc0 + 2 && lr3.still && lr3.noAp && lr3.note && !lr4.open && !lr4.lazyStarter && !lr4.btn && !lr4.need && lr4.plans === 4 && lr4.on === 'cardio',
      JSON.stringify({ lr0, lr1, lr2, lr3, lr4 }));
    // today's regime can still change on the day (not Rest ↔ Training); past days are locked, future days re-plannable
    await page.click('#today-box .plan-btn[data-plan="tech"]');
    const rg = await page.evaluate(() => { const s = YAM.game, w = s.weekState(), r = { tech: w.plan.tue };
      r.monLocked = !s.setWeekPlan('mon', 'match'); r.todayRest = !s.setWeekPlan('tue', null); r.wedOk = s.setWeekPlan('wed', 'tech') && s.setWeekPlan('wed', null); return r; });
    await page.click('#today-box .plan-btn[data-plan="cardio"]');
    const dl2 = await page.evaluate(() => ({ btn: document.getElementById('btn-sim').disabled, plan: YAM.game.todayPlan() }));
    await page.evaluate(() => { window.__R = Math.random; Math.random = () => 0.99; });
    await page.click('#btn-sim');   // [ CONTINUE ]: Tuesday's training, Wednesday passes by itself, stop on Thursday (planned)
    await page.evaluate(() => { Math.random = window.__R; });
    const dl3 = await page.evaluate(ids => { const s = YAM.game, p = s.player(ids.keep), L2 = s.player(ids.lazy), T = s.player(ids.tired), wed = isoAdd(ids.date, 1);
      return { date: s.calendar.date, e: p.energy, m: p.dyn.morale, plan: s.todayPlan(), tue: s.diary.some(d => d.date === ids.date && d.key === 'cal.training'),
        wed: s.diary.some(d => d.date === wed && d.key === 'cal.rest'), lazyE: L2.energy, tiredE: T.energy, cleared: !L2.absentToday && !T.absentToday && L2.available,
        brief: !document.getElementById('morning-briefing-view').hidden, away: [...document.querySelectorAll('#mb-away li')].map(x => x.textContent), apHidden: document.getElementById('mb-ap').hidden,
        ap: s.ap, done: s.weekState().trainingsDone }; }, lr0);
    check('v3.13 CONTINUE: Sunday → stops on the unplanned Monday; Monday → stops on Tuesday\'s planned training (briefing opens itself); Tuesday → Wednesday (rest) passes by itself → stops on Thursday; "while you were away" lists the skipped days',
      dayOf(wp0.date) === 1 && mb.away >= 1 && days(wp0.date, ct1.date) === 1 && ct1.brief && ct1.away >= 1 && dayOf(lr0.date) === 2
      && days(lr0.date, dl3.date) === 2 && dayOf(dl3.date) === 4 && dl3.brief && dl3.away.length >= 2 && dl3.wed && dl3.tue && dl3.apHidden && dl3.done === 1,
      JSON.stringify({ dl0: dl0.date, ct1, dl3: { date: dl3.date, brief: dl3.brief, away: dl3.away, wed: dl3.wed } }));
    check('training regime from the plan: cardio for those present (+5 energy, −4 morale, +1 drift ×2), skipper unchanged, exhausted kid rested, absences cleared; regime changeable on the day, Mon locked, no Rest today, Wed re-plannable',
      !dl2.btn && dl2.plan === 'cardio' && rg.tech === 'tech' && rg.monLocked && rg.todayRest && rg.wedOk
      && dl3.e === 65 && dl3.m === 58 && dl3.plan === 'match' && dl3.lazyE === 60 && dl3.tiredE === 30 && dl3.cleared, JSON.stringify({ dl2, rg, dl3 }));
    await page.evaluate(id => { YAM.game.player(id).injuryDays = 0; }, lr0.hurt);
    await page.evaluate(() => { YAM.ui.events.enabled = true; });
    check('Call into office (weekly AP): costs 1, praise backfires when out of form, button disabled at 0 AP — the wallet is NOT refilled the next morning',
      of0.vis && !of0.dis && of1.ap === 0 && of1.open && of1.n === 4 && /spent/.test(of1.chip) && of2.step === 'praiseBad' && of3.m === 52 && of3.dis && of3.closed && of3.planner && ct1.ap === 0,
      JSON.stringify({ of0, of1, of2, of3, ct1 }));

    // v2.9: office buttons show the coach's lines (not the kid's reactions) + KICK OUT OF THE ACADEMY
    // (Thursday = training day: the office is reachable from the locker room)
    await page.evaluate(() => YAM.ui.show('team'));
    await toLocker(); await page.waitForTimeout(1400);
    const kick = await page.evaluate(() => {
      const s = YAM.game, p = s.starters().find(x => x.archetype !== 'GK' && x.available);
      s.weekState().ap = 1; s.rep.parents = 50; s.rep.squad = 50; if (s.fees?.status[p.id]) s.fees.status[p.id] = 'paid';   // (v3.15: no fee line here)
      YAM.ui.profile.open(p.id);
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
        rep: [s.rep.parents, s.rep.squad], closed: document.getElementById('talk-layer').hidden, row: !!document.querySelector(`#roster .r-row[data-id="${k.id}"]`)
          || !!document.querySelector(`#lr-grid .lk[data-pid="${k.id}"]`) || document.querySelectorAll('#lr-grid .lk').length !== s.squad.length,
        saved: !JSON.parse(localStorage.getItem('yam_save_v1')).squad.some(p => p.id === k.id) };
    }, kick);
    check('office: 4 coach lines (no reaction text / no {k}); KICK OUT (red) asks once, then removes the kid for good: squad −1, XI refilled, Parents −10, Squad −5',
      kb.length === 4 && kb.every(b => !/\{k\}|«|"/.test(b.t)) && kb[3].red && !kb[3].dis && kc.step === 'kickConfirm' && kc.n === 2
      && ka.gone && ka.n === kick.n0 - 1 && ka.xi && ka.rep.join() === '40,45' && ka.closed && !ka.row && ka.saved, JSON.stringify({ kb, kc, ka }));
    const ofNo = await page.evaluate(() => { const s = YAM.game, lk = s.dayState().locker, p = s.squad.find(x => !lk.absent[x.id]); s.weekState().ap = 0; YAM.ui.profile.open(p.id);
      const b = document.getElementById('pinfo-office'), r = { blk: YAM.ui.officeBlock(p.id), dis: b.disabled, t: b.textContent }; YAM.ui.profile.close(); return r; });
    await page.evaluate(() => { YAM.ui.locker.close(); YAM.game.rep.parents = 50; YAM.game.rep.squad = 50; YAM.ui.show('dash'); });
    const ofSat = await page.evaluate(() => { const s = YAM.game, d = s.calendar.date; s.weekState().ap = 1;
      // simulate a Saturday / Sunday at the club: never allowed outside the locker room
      const sat = ['2002-09-14', '2002-09-15'].map(x => { s.calendar.date = x; s.dayState().briefed = true; return YAM.ui.officeBlock(s.squad[0].id); });
      s.calendar.date = d; return sat; });
    check('office access (v3.13): Monday after briefing ✓ for everyone (a quiet Sunday: not at the club); locker: present ✓ / absent ✗ "NOT AT FACILITY"; 0 AP → "NO ACTION POINTS"; weekend ✗',
      ofPre.dow === 0 && ofPre.blk === 'office.blk.notHere' && ofPost === null && ofLk.absent === 'office.blk.absent' && ofLk.absentBtn.dis && /FACILITY|НЕТ В КЛУБЕ/.test(ofLk.absentBtn.t)
      && ofLk.here === null && ofLk.hereBtn && ofNo.blk === 'office.blk.noAp' && ofNo.dis && /ACTION POINTS|ОЧКОВ/.test(ofNo.t) && ofSat.every(x => x === 'office.blk.notHere'),
      JSON.stringify({ ofPre, ofPost, ofLk, ofNo, ofSat }));

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
    await page.waitForSelector('#talk-layer:not([hidden]) .talk-btn');   // v3.8: the armband opens the reaction dialogue
    await page.click('#talk-choices .talk-btn.tone-green');
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
      if ([a, b, c].includes(s.lineup[0])) { const j = s.lineup.findIndex((x, k) => k > 0 && ![a, b, c].includes(x)); [s.lineup[0], s.lineup[j]] = [s.lineup[j], s.lineup[0]]; }   // v3.4: takers must not be in goal (draft-order dependent)
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
    check('calendar: Monday-first header, Sep 2002 lead 6 (1st = Sunday), Oct 2002 lead 1 (1st = Tuesday), training cells = the plan / diary (Tue/Thu here)',
      cg.mon && cg.sun && cg.sep.lead === 6 && cg.oct.lead === 1 && cg.sep.ok && cg.oct.ok && cg.sep.tr >= 4 && cg.sep.cone && cg.oct.cols === 0, JSON.stringify(cg));
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
      return { starter, refund: b0 - YAM.game.budget, morale: p.dyn.morale < m0 || m0 === 0, cleared: !p.flags.includes('Promised_Start') };
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
      const s = YAM.game, b0 = s.budget, lg0 = JSON.stringify(s.ledger['2002-10'] || {}); s.rep.board = 75; s.rep.parents = 80;
      const got = c => s.ledger['2002-10']?.[c] || 0;
      s.repDaily('2002-10-01'); const grant = got('grant'), rent = got('rent'), net = s.budget - b0;   // v3.15: the rent is booked next to the grant
      const rentLine = s.diary.some(d => d.date === '2002-10-01' && d.key === 'fin.rent');
      const b1 = s.budget; s.repDaily('2002-10-06'); const gift = s.budget - b1, don = got('donation');
      // overdue rent: the budget below $0 after the rent → Board −3 + diary line (no other penalty)
      s.budget = 50; s.rep.board = 30; const bd0 = s.rep.board; /* board 30 → no grant */ s.repDaily('2002-11-01'); const late = { b: s.budget, board: s.rep.board - bd0, line: s.diary.some(d => d.date === '2002-11-01' && d.key === 'fin.rentLate') };
      if (lg0 === '{}') delete s.ledger['2002-10']; else s.ledger['2002-10'] = JSON.parse(lg0);
      delete s.ledger['2002-11'];
      const e = new YAM.MatchEngine(YAM.ui.homeTeam(), s.matchContext().team, { onLog() {}, onUpdate() {}, onEnd() {} }, { squadRep: 100 });
      s.rep.board = 50; s.rep.parents = 55; s.budget = b0;
      return { grant, rent, net, rentLine, gift, don, late, bonus: e.repBonus, mod: e.mod(0, 'atk') - e.mod(1, 'atk') };
    });
    check('reputation: board grant on the 1st ($50 + (75−50)×4 = $150), happy parents donate on Sunday, squad rep 100 → +2 on our rolls',
      rp.grant === 150 && rp.gift > 0 && rp.don === rp.gift && rp.bonus === 2 && rp.mod === 2, JSON.stringify(rp));
    check('v3.15 rent: −$100 booked under "rent" on the 1st next to the grant (net +$50) + diary; overdue (below $0 after the rent) → Board −3 + "The pitch rent is overdue"',
      rp.rent === -100 && rp.net === 50 && rp.rentLine && rp.late.b === -50 && rp.late.board === -3 && rp.late.line, JSON.stringify(rp));
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
    // v3.9: Quick Sim no longer forces the modal — Notebook first, the Match Summary (+ talk) opens from the Notebook on request
    const qsum0 = await page.evaluate(() => ({ closed: document.getElementById('msum-layer').hidden, free: !YAM.ui.modalLock && !document.getElementById('taskbar').inert,
      notes: YAM.ui.view === 'notes', pending: YAM.game.talkPending, nbBtn: !!document.querySelector('#notes-body #btn-nb-msum'), nbHint: !!document.querySelector('#notes-body .nb-talk.pending') }));
    await page.click('#btn-nb-msum');
    const qsum = await page.evaluate(() => ({ open: !document.getElementById('msum-layer').hidden, quick: /QUICK|БЫСТР/.test(document.getElementById('msum-body').textContent),
      goals: document.querySelectorAll('#msum-body .ms-ev.goal').length, total: YAM.game.lastReport.gf + YAM.game.lastReport.ga,
      lock: YAM.ui.modalLock && document.getElementById('msum-go').disabled }));
    await page.click('#msum-body [data-talk="excuse"]');
    await page.click('#msum-go');
    check('Quick Sim → Notebook directly (no forced modal); [ MATCH SUMMARY ] opens it on request (same event list), locked until the talk',
      Object.values(qsum0).every(Boolean) && qsum.open && qsum.quick && qsum.goals === qsum.total && qsum.lock, JSON.stringify({ qsum0, qsum }));
    const qs = await page.evaluate(e0 => ({ ms: YAM.ui.lastSimMs, view: YAM.ui.view, cards: document.querySelectorAll('#notes-body .card').length,
      md2: YAM.game.league.fixturesOf(2).every(f => f.hg !== null), modal: !document.getElementById('modal-layer').hidden,
      apps: Object.values(YAM.game.seasonStats).reduce((a, s) => a + s.apps, 0), tired: YAM.game.lastReport && YAM.game.starters().some((p, i) => p.energy < e0[i]),
      score: document.getElementById('sb-score').textContent, rep: YAM.game.lastReport.gf + '-' + YAM.game.lastReport.ga }), qs0.energy);
    const after = await page.evaluate(([t, u]) => ({ showcase: t.some(id => YAM.game.player(id).hasFlag('Showcase')), sus: YAM.game.player(u).suspensionMatches,
      diary: YAM.game.diary.filter(d => /^scout\.(done|hurt)$/.test(d.key)).length }), [fv.top, ul]);
    check('after the match: showcase cleared (+ diary per kid), suspension served (2 → 1)', !after.showcase && after.sus === 1 && after.diary === fv.top.filter(id => id !== ex0.kid).length, JSON.stringify(after));
    check('Quick Sim: button → result in ms, Notebook opens, stats/energy/fixtures recorded', qs0.btn && qs.ms < 250 && qs.view === 'notes' && qs.cards === 3 && qs.md2 && !qs.modal
      && qs.apps >= qs0.apps + 11 && qs.tired && qs.score.replace(/\s/g, '') === qs.rep, JSON.stringify(qs));
    // v3.5: reload before the team talk → straight back to the locked Match Summary; tough love = discipline + Board, Parents −3 after a win
    await page.evaluate(() => { const s = YAM.game; s.lastReport.talk = null; s.lastReport.instant = false; s.lastReport.result = 'W'; s.lastReport.gf = Math.max(s.lastReport.gf, s.lastReport.ga + 1);
      s.squad.forEach(p => { p.dyn.morale = 50; p.psych.discipline = Math.min(p.psych.discipline, 10); }); s.rep.board = 50; s.rep.parents = 50; s.save(); });
    await page.reload();
    await page.waitForFunction(() => window.YAM && window.YAM.ui);
    await page.evaluate(() => { YAM.game.excusesOff = true; });
    const rl = await page.evaluate(() => ({ open: !document.getElementById('msum-layer').hidden, lock: YAM.ui.modalLock && document.getElementById('taskbar').inert,
      go: document.getElementById('msum-go').disabled, csv: document.getElementById('msum-csv').disabled,
      disc: YAM.game.squad.map(p => p.psych.discipline) }));
    await page.click('#msum-body [data-talk="tough"]');
    const rl2 = await page.evaluate(d => ({ talk: YAM.game.lastReport.talk, board: YAM.game.rep.board, parents: YAM.game.rep.parents,
      morale: YAM.game.squad.every(p => p.dyn.morale === 44), disc: YAM.game.squad.every((p, i) => p.psych.discipline === d[i] + 1) }), rl.disc);
    await page.click('#msum-go');
    rl2.notes = await page.evaluate(() => YAM.ui.view === 'notes' && !YAM.ui.modalLock);
    check('v3.5 save: reload before the talk re-opens the locked Match Summary; tough love after a win = discipline +1, morale −6, Board +2, Parents −3',
      rl.open && rl.lock && rl.go && rl.csv && rl2.talk === 'tough' && rl2.board === 52 && rl2.parents === 47 && rl2.morale && rl2.disc && rl2.notes, JSON.stringify({ rl, rl2 }));
    // v3.3: smooth fatigue curve + asymmetric shouts
    const fm = await page.evaluate(() => {
      const pts = [[100, 1.00], [75, 0.994], [50, 0.975], [25, 0.944], [0, 0.90]].map(([e, t]) => ({ e, v: fatigueMult(e), ok: Math.abs(fatigueMult(e) - t) <= 0.005 }));
      let mono = true; for (let e = 1; e <= 100; e++) if (fatigueMult(e) <= fatigueMult(e - 1)) mono = false;
      return { pts, mono, clamp: fatigueMult(-20) === 0.9 && fatigueMult(140) === 1, shout: SHOUT.attack.atk > 0 && SHOUT.attack.def < 0 && SHOUT.defend.atk < 0 && SHOUT.defend.def > 0,
        stepGone: typeof ENERGY.EXHAUSTED_MULT === 'undefined' };
    });
    check('fatigueMult (v3.4 curve): monotonic, hits 100/75/50/25/0 targets, old ×0.5/×0.8 steps gone', fm.mono && fm.clamp && fm.stepGone && fm.shout && fm.pts.every(p => p.ok), JSON.stringify(fm.pts.map(p => p.e + ':' + p.v.toFixed(3))));
    // v3.4: short-handed kick-off no longer crashes; AI rotation + daily rest
    const v34 = await page.evaluate(() => {
      const lg = YAM.game.league, t = lg.teams.find(x => !x.user), hooks = { onUpdate() {}, onEnd() {}, onLog() {} };
      const pool = lg.roster(t, new Set()), mine = { name: 'X', formation: '4-4-2', players: YAM.game.squad.slice(0, 11) };
      let short = 'ok';
      try { const miss = [mine.players[3].id, mine.players[7].id], e = new MatchEngine(mine, { name: t.name, formation: t.formation, players: pool.slice(0, 11) }, hooks, { missing: miss }); e.runInstant();
        const reds = mine.players.filter(p => !miss.includes(p.id) && e.sentOff.has(p.id)).length;   // v3.13: a red card in the match is not the bug under test
        if (e.active(0).length + reds !== 9 || !e.finished || miss.some(id => e.everPlayed.has(id))) short = 'wrong:' + e.active(0).length + '+' + reds; } catch (err) { short = err.message; }
      const keep = t.squad.map(k => k.en);
      t.squad.forEach(k => { k.en = 100; }); pool.slice(0, 11).forEach(p => { lg.kid(p.id).en = 30; });
      const xi = lg.matchXI(t, new Set()), rotated = xi.filter((p, i) => p !== pool[i]).length, bench = pool.length - 11;
      t.squad.forEach(k => { k.en = 50; }); lg.aiDay(false); const rest = t.squad.every(k => k.en === 60); lg.aiDay(true); const train = t.squad.every(k => k.en === 50);
      t.squad.forEach((k, i) => { k.en = keep[i]; });
      return { short, rotated, bench, rest, train, gk2: xi[0] !== pool[0] && xi[0].archetype === 'GK' };
    });
    check('short-handed kick-off runs (v2.6 crash fixed); AI rotates tired starters (incl. 2nd keeper); AI rest +10 / training −10', v34.short === 'ok' && v34.rotated === v34.bench && v34.gk2 && v34.rest && v34.train, JSON.stringify(v34));
    // v3.6: position discovery — Practice Match observations, out-of-position streak + reset, seeded locker request, dialogue choices
    const v36 = await page.evaluate(() => {
      const s = YAM.game, sq = s.squad, date = s.calendar.date, out = {};
      // save migration: old kids get 0 / 0, values survive a JSON round trip
      const raw = JSON.parse(JSON.stringify(sq[0])); delete raw.outOfPositionMatches; delete raw.positionHintCooldown;
      const old = new Player({ ...raw, tags: [] });
      const rt = new Player({ ...JSON.parse(JSON.stringify(Object.assign(sq[0], { outOfPositionMatches: 4, positionHintCooldown: 1 }))), tags: [] });
      out.migrate = old.outOfPositionMatches === 0 && old.positionHintCooldown === 0 && rt.outOfPositionMatches === 4 && rt.positionHintCooldown === 1;
      sq[0].outOfPositionMatches = 0; sq[0].positionHintCooldown = 0;
      // helper: slots / lines / tags → archetypes
      // (squad mix depends on the draft: pick two outfield kids with different hidden archetypes)
      const mid = sq.find(p => p.archetype !== 'GK'), def = sq.find(p => p.archetype !== 'GK' && p.archetype !== mid.archetype);
      const lineOfA = { GK: 'GK', DEF: 'DEF', MID: 'MID', FWD: 'ATT' }, other = ['DEF', 'MID', 'FWD'].find(a => a !== mid.archetype);
      out.helper = isPlayingNaturalPosition(mid, mid.archetype) && isPlayingNaturalPosition(mid, { line: lineOfA[mid.archetype] }) && !isPlayingNaturalPosition(mid, lineOfA[other])
        && !isPlayingNaturalPosition(mid, null) && isPlayingNaturalPosition({ archetype: 'FWD' }, 'ATT') && !isPlayingNaturalPosition({ archetype: 'GK' }, 'MID');
      // Feature A: Practice Match observations (tag vs hidden archetype; words only)
      const keepTags = sq.map(p => p.tag);
      mid.tag = mid.archetype; def.tag = def.archetype === 'FWD' ? 'DEF' : 'FWD';
      const obs = s.practiceObservations(date, sq, [mid.id, def.id]);
      const rnd1 = s.practiceObservations(date, sq, []), rnd2 = s.practiceObservations(date, sq, []);
      out.obs = obs.length === 2 && /^obs\.ok\.[01]$/.test(obs[0].key) && obs[0].ok && obs[1].key.startsWith('obs.hint.' + def.archetype + '.') && !obs[1].ok
        && rnd1.length >= 1 && rnd1.length <= 2 && JSON.stringify(rnd1) === JSON.stringify(rnd2)
        && !/\d/.test(L.t(obs[1].key, { k: 'X' })) && I18N.ru[obs[1].key] && I18N.ru[obs[0].key];
      // marking: max 2, only present kids
      s.dayState().observe = [];
      const fit = sq.filter(p => p.available);
      out.mark = s.toggleObserve(fit[0].id) && s.toggleObserve(fit[1].id) && !s.toggleObserve(fit[2].id) && s.dayState().observe.length === 2
        && (YAM.ui.observeHTML(s.dayState()).match(/data-observe=/g) || []).length === fit.length;
      // dayRoutine with Match Practice returns the observed kids (training regime effects unchanged)
      const before = fit[0].energy;
      s.dayState().locker = null;
      sq.forEach(p => { p.psych.discipline = 20; if (p.energy < 40) p.energy = 80; });
      const e0 = fit[0].energy, r = s.dayRoutine(date, true, 'match');
      out.routine = r.observed.length === 2 && r.observed.map(o => o.pid).sort().join() === [fit[0].id, fit[1].id].sort().join()
        && (fit[0].injuryDays > 0 || fit[0].energy === Math.max(0, e0 - 10));
      s.dayState().observe = [];
      sq.forEach((p, i) => { p.tag = keepTags[i]; });
      // Feature B: streak counter — mismatch +1, natural line resets to 0, cooldown ticks down
      const gk = sq.find(p => ![mid, def].includes(p));   // only used for the cooldown tick
      const IDX = { GK: 0, DEF: 1, MID: 5, FWD: 9 }, slotA = i => LINE_POS[formationSlots('4-4-2')[i].line];
      const wrongIdx = [1, 5, 9].find(i => slotA(i) !== mid.archetype && i !== IDX[def.archetype]);
      const xi = Array(11).fill(null); xi[IDX[def.archetype]] = def; xi[wrongIdx] = mid;   // def: natural line, mid: out of position
      const rest = sq.filter(p => p !== mid && p !== def);
      for (let i = 0; i < 11; i++) if (!xi[i]) xi[i] = rest.shift();
      out.wrongA = slotA(wrongIdx); out.defA = def.archetype;
      mid.outOfPositionMatches = 2; def.outOfPositionMatches = 5; gk.positionHintCooldown = 2;
      const lg = s.league, t = lg.teams.find(x => !x.user), hooks = { onUpdate() {}, onEnd() {}, onLog() {} };
      const eng = new MatchEngine({ name: 'X', formation: '4-4-2', players: xi }, { name: t.name, formation: t.formation, players: lg.roster(t, new Set()).slice(0, 11) }, hooks, {});
      eng.runInstant();
      const benchKid = sq.find(p => !xi.includes(p) && !eng.everPlayed.has(p.id));
      const benchOop = benchKid ? benchKid.outOfPositionMatches : 0;
      s.trackPositions(eng);
      out.streak = { mid: mid.outOfPositionMatches, def: def.outOfPositionMatches, cd: gk.positionHintCooldown, bench: benchKid ? benchKid.outOfPositionMatches === benchOop : true,
        slotMid: eng.slotArchetypes().get(mid.id), slotDef: eng.slotArchetypes().get(def.id) };
      // request: chance curve, seeded per date + id (same day → same answer), cooldown blocks it
      out.curve = [2, 3, 4, 5, 6, 7, 12].map(positionRequestChance).join();
      const keepEx = s.excusesOff; s.excusesOff = false;
      sq.forEach(p => { p.outOfPositionMatches = 0; p.positionHintCooldown = 0; });
      mid.outOfPositionMatches = 12;
      let day = date, hit = null;
      for (let i = 0; i < 30 && !hit; i++) { day = isoAdd(date, i); hit = s.rollPositionRequest({}, day); }
      out.roll = !!hit && hit.pid === mid.id && JSON.stringify(s.rollPositionRequest({}, day)) === JSON.stringify(hit)
        && s.rollPositionRequest({ [mid.id]: 'skipped' }, day) === null;
      mid.positionHintCooldown = 1; out.cooldown = s.rollPositionRequest({}, day) === null; mid.positionHintCooldown = 0;
      s.excusesOff = keepEx;
      window.__v36 = { mid: mid.id, morale: mid.dyn.morale, disc: mid.psych.discipline };
      mid.tag = mid.archetype === 'FWD' ? 'DEF' : 'FWD';
      mid.dyn.morale = 50; mid.psych.discipline = 10;
      return out;
    });
    await page.evaluate(() => YAM.ui.events.fire('posreq', YAM.game.calendar.date, { cast: { kid: window.__v36.mid } }));
    const v36d = await page.evaluate(() => ({ open: !document.getElementById('talk-layer').hidden, n: document.querySelectorAll('#talk-choices .talk-btn').length,
      tones: [...document.querySelectorAll('#talk-choices .talk-btn')].map(b => b.className.match(/tone-(\w+)/)[1]).join() }));
    await page.click('#talk-choices .talk-btn.tone-green');
    Object.assign(v36d, await page.evaluate(() => { const p = YAM.game.player(window.__v36.mid);
      return { yesTag: p.tag === p.archetype, yesOop: p.outOfPositionMatches, yesMorale: p.dyn.morale, diary: YAM.game.diary.slice(-6).some(d => d.key === 'pr.yes.diary') ? 'pr.yes.diary' : YAM.game.diary.slice(-1)[0].key }; }));
    await page.evaluate(() => { const p = YAM.game.player(window.__v36.mid); p.outOfPositionMatches = 4; YAM.ui.events.fire('posreq', YAM.game.calendar.date, { cast: { kid: p.id } }); });
    await page.click('#talk-choices .talk-btn.tone-red');
    Object.assign(v36d, await page.evaluate(() => { const p = YAM.game.player(window.__v36.mid);
      const r = { ordMorale: p.dyn.morale, ordDisc: p.psych.discipline, ordCd: p.positionHintCooldown, ordDiary: YAM.game.diary.slice(-6).some(d => d.key === 'pr.order.diary') ? 'pr.order.diary' : '', closed: document.getElementById('talk-layer').hidden };
      p.dyn.morale = window.__v36.morale; p.psych.discipline = window.__v36.disc; p.outOfPositionMatches = 0; p.positionHintCooldown = 0; return r; }));
    check('v3.6 practice scouting: save migration 0/0, slot/tag helper, observation lines (ok vs archetype hint, seeded, no numbers, EN+RU), mark ≤ 2, dayRoutine observes the marked kids',
      v36.migrate && v36.helper && v36.obs && v36.mark && v36.routine, JSON.stringify(v36));
    check('v3.6 out of position: streak +1 out of line, reset in natural line, cooldown −1, chance curve 25/40/55/75 → cap 85, seeded locker request, cooldown blocks',
      v36.streak.mid === 3 && v36.streak.def === 0 && v36.streak.cd === 1 && v36.streak.bench && v36.streak.slotMid === v36.wrongA && v36.streak.slotDef === v36.defA
      && v36.curve === '0,0.25,0.4,0.55,0.75,0.8,0.85' && v36.roll && v36.cooldown, JSON.stringify(v36.streak) + ' ' + v36.curve);
    check('v3.6 request dialogue: 3 choices (green/gray/red); yes = tag → archetype, streak 0, morale +5, diary; order = discipline +1, morale −8, cooldown 2',
      v36d.open && v36d.n === 3 && v36d.tones === 'green,gray,red' && v36d.yesTag && v36d.yesOop === 0 && v36d.yesMorale === 55 && v36d.diary === 'pr.yes.diary'
      && v36d.ordMorale === 47 && v36d.ordDisc === 11 && v36d.ordCd === 2 && v36d.ordDiary === 'pr.order.diary' && v36d.closed, JSON.stringify(v36d));
    // v3.7: hidden captain traits — seeded generation + save migration, engine modifiers, Notebook / diary clues, DEBUG column
    const v37 = await page.evaluate(() => {
      const s = YAM.game, sq = s.squad, out = {}, T = ['leader', 'anxious', 'normal'];
      const k = sq.find(p => p.available) || sq[0];
      const raw = JSON.parse(JSON.stringify(k)); delete raw.captainTrait;
      const keep = new Player({ ...raw, captainTrait: 'leader', tags: [] }); delete raw.leadership;   // v3.8: leadership wins over a stored trait
      out.migrate = new Player({ ...raw, tags: [] }).captainTrait === k.captainTrait && new Player({ ...raw, captainTrait: 'boss', tags: [] }).captainTrait === k.captainTrait
        && keep.captainTrait === k.captainTrait && T.includes(k.captainTrait) && JSON.parse(localStorage.getItem('yam_save_v1') || '{}').squad?.every(p => T.includes(p.captainTrait));
      out.world = [...sq, ...(s.globalPlayers || []), ...s.league.teams.filter(t => !t.user).flatMap(t => s.league.roster(t, new Set()))].every(p => T.includes(p.captainTrait));
      out.det = Player.rollCaptainTrait('id7', 'Tommy Smith', k.psych) === Player.rollCaptainTrait('id7', 'Tommy Smith', k.psych);
      const share = (ps, t) => { let n = 0; for (let i = 0; i < 400; i++) n += Player.rollCaptainTrait('t' + i, 'N' + i, ps) === t; return n / 400; };
      const hi = { composure: 18, passion: 17, discipline: 17 }, lo = { composure: 3, passion: 8, discipline: 8 };
      out.psych = [share(hi, 'leader'), share(lo, 'leader'), share(hi, 'anxious'), share(lo, 'anxious')].map(v => +v.toFixed(2));
      // engine: captain bonus / rally / stress / breakdown (forced roll), normal = plain bonus
      const keepTrait = k.captainTrait, keepMor = k.dyn.morale, keepCap = s.duties.captain;
      const lg = s.league, t = lg.teams.find(x => !x.user), logs = [];
      const xi = [k, ...sq.filter(p => p !== k).slice(0, 10)];
      const mk = trait => { k.captainTrait = trait; const e = new MatchEngine({ name: 'X', formation: '4-4-2', players: xi }, { name: t.name, formation: t.formation, players: lg.roster(t, new Set()).slice(0, 11) },
        { onUpdate() {}, onEnd() {}, onLog(x) { logs.push(x.key); } }, { duties: { captain: k.id }, md: 3 }); e.started = true; e.minute = 30; return e; };
      const base = 0.5 + k.psych.passion / 20, eq = (a, b) => Math.abs(a - b) < 1e-9;
      let e = mk('normal'); e.capRng = () => 0;
      e.captainMoment('concede'); e.captainMoment('mistake');
      out.normal = eq(e.captainBonus(), base) && e.captainStress(k) === 0 && e.cap.broken === null && !logs.length;
      e = mk('leader'); const b0 = e.captainBonus(); e.captainMoment('concede');
      out.leader = eq(b0, base) && eq(e.captainBonus(), base + 1) && logs.includes('cap.rally') && e.capBarks.length === 1 && e.captainStress(k) === 0
        && (e.minute = 41, eq(e.captainBonus(), base)) && e.captainReport().rallies === 1;
      e = mk('anxious'); const st = e.captainStress(k), other = e.captainStress(xi[3]);
      const r1 = e.rs(k, 'Pass', 0, 'atk');
      e.capRng = () => 0; k.dyn.morale = 60; e.captainMoment('mistake');
      out.anxious = st <= -1.5 && other === 0 && r1.flat.stress === st && eq(e.cap.breakdown, 30) && e.captainBonus() === 0 && e.captainStress(k) === 0
        && k.dyn.morale === 40 && logs.includes('cap.breakdown') && e.captainReport().breakdown === 30;
      // determinism: same match twice (visual & Quick Sim share tick()) → same captain stream
      const d1 = mk('anxious'); d1.started = false; d1.minute = 0; const r = [];
      for (let i = 0; i < 2; i++) { const m = mk('anxious'); r.push([m.capRng(), m.capRng()].join()); }
      out.seeded = r[0] === r[1];
      // a full Quick Sim with a captain runs and post-match leader morale +3
      k.captainTrait = 'leader'; k.dyn.morale = keepMor;
      const full = mk('leader'); full.started = false; full.minute = 0; full.runInstant();
      const rep = full.captainReport(), before = xi.map(p => p.dyn.morale);
      out.full = full.finished && rep && rep.id === k.id && rep.trait === 'leader' && rep.minutes > 0;
      // Notebook / diary clues: words only (no trait names, no numbers), EN + RU
      const keys = [captainObservation({ ...rep, rallies: 1 }, 3).key, captainObservation({ ...rep, trait: 'anxious', breakdown: 50 }, 3).key, captainObservation({ ...rep, trait: 'anxious', breakdown: null, nerves: 0, mistakes: 0 }, 3).key,
        captainObservation({ ...rep, trait: 'normal' }, 3).key, 'note.vocal.0', 'note.nervy.1', 'obs.cap.leader.0', 'obs.cap.anxious.1'];
      out.keys = keys.join();
      out.words = /^cap\.obs\.rally\.[01],cap\.obs\.tears\.[01],cap\.obs\.tense\.[01],cap\.obs\.steady\.[01]/.test(out.keys)
        && keys.every(x => I18N.en[x] && I18N.ru[x] && !/\d|leader|anxious|лидер|тревожн/i.test(I18N.en[x] + I18N.ru[x]));
      const html = YAM.ui.captainNoteHTML({ capObs: { pid: k.id, key: keys[0] } });
      out.nb = html.includes('nb-captain') && html.includes(L.name(k.name)) && !/leader|anxious/.test(html);
      const pc = sq.map(p => psychClue(p, 4, null)), pc2 = sq.map(p => psychClue(p, 4, null));
      out.clue = JSON.stringify(pc) === JSON.stringify(pc2) && sq.every((p, i) => !pc[i] || (p.captainTrait === 'leader' ? /^note\.vocal/ : /^note\.nervy/).test(pc[i]))
        && sq.filter(p => p.captainTrait === 'normal').every(p => psychClue(p, 4, null) === null) && psychClue(k, 4, k.id) === null;
      const obs = s.practiceObservations(s.calendar.date, sq, sq.slice(0, 2).map(p => p.id));
      out.practice = obs.length === 2 && obs.every(o => !o.capKey || o.capKey.startsWith('obs.cap.' + s.player(o.pid).captainTrait + '.'));
      // post-match morale: leader +3 on top of the result
      s.duties.captain = k.id;
      const m0 = xi.map(p => p.dyn.morale); s.applyMatchDynamics(full, 'D', { trait: 'leader' }); const mL = xi.map(p => p.dyn.morale);
      xi.forEach((p, i) => { p.dyn.morale = m0[i]; }); s.applyMatchDynamics(full, 'D', { trait: 'normal' }); const mN = xi.map(p => p.dyn.morale);
      out.post = xi.every((p, i) => mL[i] - mN[i] === (mN[i] + 3 > 100 ? 100 - mN[i] : 3) || mN[i] === 100);
      xi.forEach((p, i) => { p.dyn.morale = before[i]; });
      // DEBUG.EXE column
      out.debug = DebugConsole.COLS.some(c => c.h === 'CAPT' && c.g === 'PSYCH') && /dbg|лидер|leader|anxious|normal|обычный|тревожный/.test(DebugConsole.COLS.find(c => c.h === 'CAPT').v(k));
      k.captainTrait = keepTrait; k.dyn.morale = keepMor; s.duties.captain = keepCap; s.save();
      return out;
    });
    check('v3.7 captain traits: seeded trait + save migration (whole world), psychology bias, DEBUG column',
      v37.migrate && v37.world && v37.det && v37.psych[0] > v37.psych[1] && v37.psych[3] > v37.psych[2] && v37.debug, JSON.stringify({ m: v37.migrate, w: v37.world, d: v37.det, p: v37.psych, dbg: v37.debug }));
    check('v3.7 captain in the engine: normal = plain bonus; leader rally +1 for 10 min after a goal against + post-match +3 morale; anxious stress on his own rolls, breakdown = −20 morale + no bonus; seeded stream; Quick Sim',
      v37.normal && v37.leader && v37.anxious && v37.seeded && v37.full && v37.post, JSON.stringify(v37));
    check('v3.7 fog of war: armband Notebook line + sampled-kid / practice clues are words only (EN + RU), seeded, trait-consistent',
      v37.words && v37.nb && v37.clue && v37.practice, v37.keys);
    // v3.8: hidden leadership — generation + migration, armband reactions + cooldown, captain initiatives, promise to play, resignation
    const v38 = await page.evaluate(() => {
      const s = YAM.game, sq = s.squad, out = {}, Ld = LEADERSHIP, T = { leader: [14, 20], normal: [8, 13], anxious: [1, 7] };
      const world = [...sq, ...(s.globalPlayers || []), ...s.league.teams.filter(t => !t.user).flatMap(t => s.league.roster(t, new Set()))];
      out.gen = world.every(p => Number.isInteger(p.leadership) && p.leadership >= 1 && p.leadership <= 20 && p.captainTrait === leadershipTrait(p.leadership));
      const k = sq[0], raw = JSON.parse(JSON.stringify(k)); delete raw.leadership;
      const mig = t => new Player({ ...raw, captainTrait: t, tags: [] }).leadership;
      out.migrate = Object.keys(T).every(t => mig(t) >= T[t][0] && mig(t) <= T[t][1] && mig(t) === mig(t))
        && (() => { const r2 = { ...raw }; delete r2.captainTrait; const a = new Player({ ...r2, tags: [] }), b = new Player({ ...r2, tags: [] });
          return a.leadership === b.leadership && a.captainTrait === Player.rollCaptainTrait(r2.id, r2.name, a.psych); })()
        && new Player({ ...raw, leadership: 17, tags: [] }).captainTrait === 'leader' && new Player({ ...JSON.parse(JSON.stringify(k)), tags: [] }).leadership === k.leadership
        && JSON.parse(localStorage.getItem('yam_save_v1') || '{}').squad?.every(p => Number.isInteger(p.leadership) && p.captainTrait === leadershipTrait(p.leadership))
        && k.captainReactionCooldown >= 0 && k.benchStreak >= 0 && k.promisedPitchTime === false;
      out.debug = DebugConsole.COLS.some(c => c.h === 'LDR' && c.g === 'PSYCH' && c.v(k) === k.leadership);
      // armband reactions (state level) + anti-farming cooldown
      const keep = sq.map(p => ({ id: p.id, l: p.leadership, m: p.dyn.morale, d: p.psych.discipline, cd: p.captainReactionCooldown, tag: p.tag, oop: p.outOfPositionMatches, bs: p.benchStreak }));
      const keepCap = s.duties.captain, keepRep = s.rep.squad, keepEx = s.excusesOff;
      const av = sq.filter(p => p.available), [a, b, c, k4] = av.slice(1, 5);
      s.duties.captain = null; [a, b, c].forEach(p => { p.captainReactionCooldown = 0; p.dyn.morale = 50; });
      a.leadership = 16; b.leadership = 5; c.leadership = 10;
      const r = [];
      r.push(s.confirmCaptain(a.id), a.dyn.morale, a.captainReactionCooldown, s.duties.captain === a.id);   // +5, cd 14
      s.setDuty('captain', a.id); r.push(a.dyn.morale, s.duties.captain);                                   // strip within cooldown → no −3
      for (let i = 0; i < 14; i++) s.captainDaily();
      r.push(a.captainReactionCooldown);
      s.duties.captain = a.id; s.setDuty('captain', a.id); r.push(a.dyn.morale);                           // strip → −3
      r.push(s.confirmCaptain(b.id, false), s.duties.captain);                                             // "pick someone else": nothing
      r.push(s.confirmCaptain(b.id, true), b.dyn.morale);                                                  // keep: −2
      b.captainReactionCooldown = 0; s.setDuty('captain', c.id); r.push(b.dyn.morale, s.duties.captain === c.id);   // relieve anxious +2, armband moves
      out.react = JSON.stringify(r);
      out.reactOk = JSON.stringify(r) === JSON.stringify([5, 55, 14, true, 55, null, 0, 52, 0, null, -2, 48, 50, true]);
      // tiers / lines
      out.tiers = [s.captainTier(a), s.captainTier(b), s.captainTier(c)].join() === 'high,low,mid' && s.captainLine(a.id) === s.captainLine(a.id)
        && ['high', 'mid', 'low'].every(t => [0, 1, 2, 3].every(i => I18N.en['ca.' + t + '.' + i] && I18N.ru['ca.' + t + '.' + i] && !/\d|leader|leadership|лидерств/i.test(I18N.en['ca.' + t + '.' + i] + I18N.ru['ca.' + t + '.' + i])));
      // promise to play + bench streak (live and Quick Sim share trackCaptaincy)
      s.duties.captain = a.id; s.captaincy.id = null;
      a.promisedPitchTime = true; c.promisedPitchTime = true; a.dyn.morale = 50; c.dyn.morale = 50; s.rep.squad = 50;
      const bench = av.find(p => ![a, b, c].includes(p)); bench.benchStreak = 1;
      s.trackCaptaincy({ everPlayed: new Set([a.id]) }, 'L', null);
      out.promise = [a.dyn.morale, c.dyn.morale, s.rep.squad, a.promisedPitchTime, c.promisedPitchTime, bench.benchStreak, a.benchStreak, s.capt.matches, s.capt.shock].join();
      out.promiseOk = out.promise === '56,40,49,false,false,2,0,1,true' && s.diary.slice(-3).some(d => d.key === 'cb.kept') && s.diary.slice(-3).some(d => d.key === 'cb.broken');
      // locker rolls (seeded, reload-proof), priorities and cooldowns
      s.excusesOff = false;
      const date = s.calendar.date, find = (want, n = 60) => { for (let i = 0; i < n; i++) { const d = isoAdd(date, i), q = s.rollCaptainRequest({}, d); if (q && q.kind === want) return { d, q }; } return null; };
      sq.forEach(p => { p.outOfPositionMatches = 0; p.benchStreak = 0; p.promisedPitchTime = false; if (p !== b) p.leadership = 10; });
      s.duties.captain = b.id; s.capt.matches = 0; s.capt.shock = false;
      out.resignWait = find('resign') === null;                                       // < 2 matches, no shock → never
      s.capt.matches = 2; const rs = find('resign');
      a.leadership = 18; const rh = find('resign');
      out.resign = !!rs && !rs.q.hint && !!rh && rh.q.hint === a.id && JSON.stringify(s.rollCaptainRequest({}, rh.d)) === JSON.stringify(rh.q)
        && s.rollCaptainRequest({ [a.id]: 'skipped' }, rh.d)?.hint === null;
      s.capt.hold = 1; out.hold = find('resign') === null; s.capt.hold = 0;
      out.curve = [0, 1, 2, 3].map(m => { s.capt.matches = 2 + m; let n = 0; for (let i = 0; i < 400; i++) n += !!s.rollCaptainRequest({}, isoAdd(date, i)); return +(n / 400).toFixed(2); });
      s.duties.captain = a.id; c.benchStreak = 2; c.dyn.morale = 40;
      const rb = find('bench'); out.bench = !!rb && rb.q.mate === c.id;
      s.capt.initUntil = isoAdd(date, 400); out.initCd = find('bench') === null; s.capt.initUntil = null;
      c.benchStreak = 0; c.dyn.morale = 50; s.duties.captain = k4.id; k4.leadership = 9; b.outOfPositionMatches = 3;
      const ro = find('obs'); out.obs = !!ro && ro.q.mate === b.id;
      k4.leadership = 7; out.obsLow = find('obs') === null;
      k4.leadership = 9; s.capt.pauseUntil = isoAdd(date, 400); out.pause = find('obs') === null; s.capt.pauseUntil = null;
      s.excusesOff = true; out.off = find('obs') === null;
      // engine: refused resignation → breakdown ×1.5 next match
      const lg = s.league, t = lg.teams.find(x => !x.user), xi = [b, ...sq.filter(p => p !== b).slice(0, 10)];
      const mk = () => { const e = new MatchEngine({ name: 'X', formation: '4-4-2', players: xi }, { name: t.name, formation: t.formation, players: lg.roster(t, new Set()).slice(0, 11) },
        { onUpdate() {}, onEnd() {}, onLog() {} }, { duties: { captain: b.id }, md: 3 }); e.started = true; e.minute = 30; e.capRng = () => 0.1; return e; };
      b.capPressure = 0; let e = mk(); e.captainMoment('mistake'); const calm = e.cap.broken;
      b.capPressure = 1; e = mk(); e.captainMoment('mistake'); const press = e.cap.broken;
      out.pressure = calm === null && press === b.id;
      window.__v38 = { keep, keepCap, keepRep, keepEx, a: a.id, b: b.id, c: c.id, k4: k4.id }; out.aName = L.name(a.name);
      b.capPressure = 0; b.dyn.morale = 50; b.psych.discipline = 10; s.duties.captain = b.id;
      return out;
    });
    // dialogues: resignation (green / red), initiative A (green), initiative B (green), armband assignment via the UI (mid tier, low tier → other)
    const v38d = {};
    const talk38 = () => page.evaluate(() => (YAM.ui.events.view.finishTyping(), { open: !document.getElementById('talk-layer').hidden, tones: [...document.querySelectorAll('#talk-choices .talk-btn')].map(b => b.className.match(/tone-(\w+)/)[1]).join(),
      text: document.getElementById('talk-text').textContent }));
    await page.evaluate(() => YAM.ui.events.fire('capresign', YAM.game.calendar.date, { cast: { kid: window.__v38.b, hint: window.__v38.a } }));
    v38d.resign = await talk38();
    await page.click('#talk-choices .talk-btn.tone-green');
    Object.assign(v38d, await page.evaluate(() => { const s = YAM.game, b = s.player(window.__v38.b);
      const r = { yesCap: s.duties.captain, yesMor: b.dyn.morale, yesDiary: s.diary.slice(-4).some(d => d.key === 'cr.yes.diary') };
      s.duties.captain = b.id; b.dyn.morale = 50; YAM.ui.events.fire('capresign', s.calendar.date, { cast: { kid: b.id } }); return r; }));
    await page.click('#talk-choices .talk-btn.tone-red');
    Object.assign(v38d, await page.evaluate(() => { const s = YAM.game, b = s.player(window.__v38.b);
      const r = { noCap: s.duties.captain === b.id, noMor: b.dyn.morale, noDisc: b.psych.discipline, noPress: b.capPressure, noHold: s.capt.hold };
      const a = s.player(window.__v38.a), m = s.player(window.__v38.k4);   // initiative A: captain k4 (leadership 9) about b
      s.duties.captain = m.id; m.dyn.morale = 50; b.dyn.morale = 50; b.outOfPositionMatches = 3; b.tag = b.archetype === 'FWD' ? 'DEF' : 'FWD';
      YAM.ui.events.fire('capobs', s.calendar.date, { cast: { kid: m.id, mate: b.id } }); return r; }));
    v38d.obsDlg = await talk38();
    await page.click('#talk-choices .talk-btn.tone-green');
    Object.assign(v38d, await page.evaluate(() => { const s = YAM.game, b = s.player(window.__v38.b), m = s.player(window.__v38.k4), a = s.player(window.__v38.a), c = s.player(window.__v38.c);
      const r = { obsTag: b.tag === b.archetype, obsOop: b.outOfPositionMatches, obsMor: [m.dyn.morale, b.dyn.morale].join(), obsCd: s.capt.initUntil === isoAdd(s.calendar.date, 7) };
      s.duties.captain = a.id; YAM.ui.events.fire('capbench', s.calendar.date, { cast: { kid: a.id, mate: c.id } }); return r; }));
    v38d.benchDlg = await talk38();
    await page.click('#talk-choices .talk-btn.tone-green');
    Object.assign(v38d, await page.evaluate(() => { const s = YAM.game, c = s.player(window.__v38.c);
      const r = { promised: c.promisedPitchTime === true }; c.promisedPitchTime = false;
      c.leadership = 10; c.captainReactionCooldown = 0; c.dyn.morale = 50; s.duties.captain = null;
      r.fired = YAM.ui.assignDuty('captain', c.id); return r; }));
    v38d.midDlg = await talk38();
    await page.click('#talk-choices .talk-btn.tone-green');
    Object.assign(v38d, await page.evaluate(() => { const s = YAM.game, c = s.player(window.__v38.c), b = s.player(window.__v38.b);
      const r = { midCap: s.duties.captain === c.id, midMor: c.dyn.morale };
      b.leadership = 4; b.captainReactionCooldown = 0; b.dyn.morale = 50; YAM.ui.assignDuty('captain', b.id); return r; }));
    v38d.lowDlg = await talk38();
    await page.click('#talk-choices .talk-btn.tone-gray');
    Object.assign(v38d, await page.evaluate(() => { const s = YAM.game, w = window.__v38, b = s.player(w.b);
      const r = { lowCap: s.duties.captain === w.c, lowMor: b.dyn.morale, closed: document.getElementById('talk-layer').hidden };
      for (const k of w.keep) { const p = s.player(k.id); Object.assign(p, { leadership: k.l, captainReactionCooldown: k.cd, tag: k.tag, outOfPositionMatches: k.oop, benchStreak: k.bs, capPressure: 0, promisedPitchTime: false });
        p.dyn.morale = k.m; p.psych.discipline = k.d; p.refreshPortrait(); }
      s.duties.captain = w.keepCap; s.rep.squad = w.keepRep; s.excusesOff = w.keepEx; Object.assign(s.captaincy, { hold: 0, initUntil: null, pauseUntil: null }); s.save();
      return r; }));
    check('v3.8 leadership: seeded 1–20 for the whole world, trait derived (≥14 leader, ≤7 anxious), save migration inside the stored trait\'s band, DEBUG column LDR',
      v38.gen && v38.migrate && v38.debug, JSON.stringify({ g: v38.gen, m: v38.migrate, d: v38.debug }));
    check('v3.8 armband reactions: +5 / +2 / −2 (keep) / 0 (pick another), strip leader −3, relieve anxious +2, 14-day cooldown blocks farming, 4 lines per tier (EN + RU, words only)',
      v38.reactOk && v38.tiers, v38.react);
    check('v3.8 promise to play + bench streak: played → +6 & squad +2, unused → −10 & squad −3, flag cleared, armband tenure / loss shock',
      v38.promiseOk, v38.promise);
    check('v3.8 captain requests: resignation after 2 matches (25/45/65 % curve, hint at a present leader, hold blocks), bench ask (leader), position tip (≥ 8), 7-day + advice-pause cooldowns, seeded; refusal → breakdown ×1.5',
      v38.resignWait && v38.resign && v38.hold && v38.curve[0] > 0.15 && v38.curve[0] < 0.35 && v38.curve[1] > 0.35 && v38.curve[2] > 0.55 && v38.curve[3] > 0.55
      && v38.bench && v38.initCd && v38.obs && v38.obsLow && v38.pause && v38.off && v38.pressure, JSON.stringify(v38));
    check('v3.8 dialogues: resignation (hint names the leader; yes = armband off +8; no = disc +1, −10, pressure), captain tip (tag → archetype, +3 both, 7-day cooldown), bench promise, armband via PLAYER_INFO (mid +2; low → pick another keeps the old captain)',
      v38d.resign.open && v38d.resign.tones === 'green,gray,red' && v38d.resign.text.includes(v38.aName) && v38d.yesCap === null && v38d.yesMor === 58 && v38d.yesDiary
      && v38d.noCap && v38d.noMor === 40 && v38d.noDisc === 11 && v38d.noPress === 1 && v38d.noHold === 1
      && v38d.obsDlg.tones === 'green,gray,red' && v38d.obsTag && v38d.obsOop === 0 && v38d.obsMor === '53,53' && v38d.obsCd
      && v38d.benchDlg.tones === 'green,gray,red' && v38d.promised && v38d.fired && v38d.midDlg.tones === 'green' && v38d.midCap && v38d.midMor === 52
      && v38d.lowDlg.tones === 'green,gray' && v38d.lowCap && v38d.lowMor === 50 && v38d.closed, JSON.stringify(v38d));
    // v3.9: a Quick Sim talk still owed survives a reload WITHOUT a forced modal, and closing the matchday skips it (no effects, no soft-lock)
    await page.evaluate(() => { const s = YAM.game; s.lastReport.talk = null; s.lastReport.instant = true; s.save(); });
    await page.reload();
    await page.waitForFunction(() => window.YAM && window.YAM.ui);
    await page.evaluate(() => { YAM.game.excusesOff = true; });
    const sk0 = await page.evaluate(() => ({ closed: document.getElementById('msum-layer').hidden, free: !YAM.ui.modalLock, pending: YAM.game.talkPending,
      rep: JSON.stringify([YAM.game.rep.board, YAM.game.rep.parents]), m: YAM.game.squad.map(p => p.dyn.morale).join() }));
    await page.evaluate(() => YAM.ui.closeMatchday());
    const sk = await page.evaluate(k => ({ talk: YAM.game.lastReport.talk === 'none' || YAM.game.phase !== 'post', phase: YAM.game.phase !== 'post',
      closed: document.getElementById('msum-layer').hidden, diary: YAM.game.diary.some(d => d.key === 'tt.skipped'), rep: JSON.stringify([YAM.game.rep.board, YAM.game.rep.parents]) === k.rep }), sk0);
    check('v3.9 Quick Sim talk: reload keeps it pending without a modal; closing the matchday skips it (diary line, no effects) → next matchday',
      sk0.closed && sk0.free && sk0.pending && Object.values(sk).every(Boolean), JSON.stringify({ sk0, sk }));
    // v3.10: swap hover target — list ↔ board sync, bench = list only, self ignored, Smart Swap kept, cleared on leave / Esc / swap / screen change; drag-over too
    await page.evaluate(() => { YAM.ui.selected = null; YAM.ui.show('team'); YAM.ui.renderTeam(); });
    await page.waitForTimeout(150);
    const ids = await page.evaluate(() => ({ xi: YAM.game.lineup.filter(Boolean).filter(id => YAM.game.player(id)), bench: YAM.game.bench().filter(p => p.available).map(p => p.id) }));
    const [a, c, d] = ids.xi, b = ids.bench[0];
    const hv = {};
    const hl = () => page.evaluate(() => ({ rows: [...document.querySelectorAll('#roster .r-row.swap-hover-target')].map(r => r.dataset.id),
      dots: [...document.querySelectorAll('#tac-board .pl.swap-hover-target')].map(x => x.dataset.pid) }));
    await page.hover(`#roster .r-row[data-id="${c}"]`);
    hv.idle = JSON.stringify(await hl()) === '{"rows":[],"dots":[]}';                    // nothing selected → no target
    await page.click(`#roster .r-row[data-id="${a}"]`);
    hv.selected = await page.evaluate(x => YAM.ui.selected === x, a);
    await page.hover(`#roster .r-row[data-id="${c}"]`);
    let h = await hl(); hv.rowToDot = h.rows.join() === c && h.dots.join() === c;
    await shot('12-swap-hover');
    hv.smart = await page.evaluate(x => { const r = document.querySelector(`#roster .r-row[data-id="${x}"]`), dd = document.querySelector(`#tac-board .pl[data-pid="${x}"]`);
      const cls = YAM.ui.swapClass(YAM.game.player(x)); return !!cls && r.classList.contains(cls) && dd.classList.contains(cls)
        && document.querySelector(`#tac-board .pl[data-pid="${YAM.ui.selected}"]`).classList.contains('sel'); }, c);
    hv.rowEl = await page.evaluate(x => document.querySelector(`#roster .r-row[data-id="${x}"]`) === window.__hvRow || (window.__hvRow = document.querySelector(`#roster .r-row[data-id="${x}"]`), true), c);
    if (b) { await page.hover(`#roster .r-row[data-id="${b}"]`); h = await hl(); hv.bench = h.rows.join() === b && h.dots.length === 0; } else hv.bench = true;
    await page.hover(`#roster .r-row[data-id="${a}"]`); h = await hl(); hv.self = !h.rows.length && !h.dots.length;
    await page.hover(`#tac-board .pl[data-pid="${d}"]`); h = await hl(); hv.dotToRow = h.rows.join() === d && h.dots.join() === d;
    hv.noRerender = await page.evaluate(x => document.querySelector(`#roster .r-row[data-id="${x}"]`) === window.__hvRow, c);   // hovering never rebuilt the list
    await page.mouse.move(2, 2); h = await hl(); hv.leave = !h.rows.length && !h.dots.length;
    await page.hover(`#roster .r-row[data-id="${c}"]`);
    await page.keyboard.press('Escape'); h = await hl(); hv.esc = !h.rows.length && !h.dots.length && await page.evaluate(() => !YAM.ui.selected);
    await page.click(`#roster .r-row[data-id="${a}"]`); await page.hover(`#tac-board .pl[data-pid="${c}"]`);
    await page.evaluate(() => YAM.ui.show('dash')); h = await hl(); hv.screen = !h.rows.length && !h.dots.length;
    await page.evaluate(() => YAM.ui.show('team'));
    // click swap still works and leaves no target behind
    await page.click(`#tac-board .pl[data-pid="${c}"]`);
    h = await hl(); hv.clickSwap = await page.evaluate(([x, y]) => YAM.game.lineup.indexOf(x) !== -1 && YAM.game.lineup.indexOf(y) !== -1 && !YAM.ui.selected, [a, c]) && !h.rows.length && !h.dots.length;
    // drag: dragstart on a list row, dragover a dot → target on, drop → swap + cleared
    const pos0 = await page.evaluate(([x, y]) => [YAM.game.lineup.indexOf(x), YAM.game.lineup.indexOf(y)], [a, d]);
    hv.drag = await page.evaluate(([x, y]) => {
      const dt = new DataTransfer(), row = document.querySelector(`#roster .r-row[data-id="${x}"]`), dot = document.querySelector(`#tac-board .pl[data-pid="${y}"]`);
      row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      dot.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const on = dot.classList.contains('swap-hover-target') && document.querySelector(`#roster .r-row[data-id="${y}"]`).classList.contains('swap-hover-target');
      dot.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return on && !document.querySelector('.swap-hover-target') && !YAM.ui.swapDragId;
    }, [a, d]);
    hv.dragSwap = await page.evaluate(([x, y, p]) => YAM.game.lineup.indexOf(x) === p[1] && YAM.game.lineup.indexOf(y) === p[0], [a, d, pos0]);
    check('v3.10 swap hover: list ↔ board target sync (bench = list only, self ignored), Smart Swap + selection kept, no re-render; cleared on leave / Esc / screen / click swap; drag-over target + drop swap',
      Object.values(hv).every(Boolean), JSON.stringify(hv));
    await page.evaluate(() => YAM.ui.show('dash'));
    // v3.12: potential = growth room (1–10, +points per skill above its start, max 20); old ceilings convert; growth skips maxed skills; plateau once per group; yard notes
    const pot = await page.evaluate(() => {
      const G = YAM.game, sq = G.squad, p = sq.find(k => k.available) || sq[0];
      const js = JSON.parse(JSON.stringify(p)); delete js.gains;
      const v311 = new Player({ ...js, psych: { ...p.psych, potential: 16 } }), v310 = new Player({ ...js, psych: { ...p.psych, potential: 70 } });
      const keep = new Player(JSON.parse(JSON.stringify(p)));
      const tac = { ...p.tactical }, gains = { ...p.gains }, plat = [...(p.plateau || [])], mem = p.psych.potential;
      p.psych.potential = 3; p.gains = { positioning: 3, vision: 1 }; p.tactical = { positioning: 12, vision: 18, decisions: 19 };
      let grew = 0; for (let i = 0; i < 20; i++) if (G.growSkill(p, REGIMES.tactics.grow) === true) grew++;
      const t = p.tactical, room = t.positioning === 12 && t.vision === 20 && t.decisions === 20 && grew === 3 && p.gains.vision === 3 && p.gains.decisions === 1;
      const flat = G.growSkill(p, REGIMES.tactics.grow) === 'plateau';
      p.tactical = tac; p.gains = gains; p.plateau = plat; p.psych.potential = mem;
      const pool = G.globalPlayers.slice(0, 60), notes = pool.map(k => DraftView.notes(k));
      const okNotes = notes.every(n => n.length >= 1 && n.length <= 2 && n.every(k => k === 'quiet' || YARD.TRAITS[k]))
        && JSON.stringify(DraftView.notes(pool[0])) === JSON.stringify(notes[0]) && notes.some(n => n[0] !== 'quiet');
      const conv = k => k.psych.potential === clamp(Math.round(16 - k.overall), 2, 10);
      return { v311: conv(v311), v310: conv(v310), kept: keep.psych.potential === mem && JSON.stringify(keep.gains) === JSON.stringify(p.gains), room, flat, okNotes,
        dbg: /ROOM 1–10/.test(L.t('dbg.dbHint')), text: L.t('tr.plateau.technical', { s: 'X' }).includes('X'), noStars: typeof DraftView.stars === 'undefined' };
    });
    check('v3.12 growth room: v3.11 / PA saves convert (ceiling − overall), saves keep room + gains, growth = start + room (max 20), plateau, seeded yard notes, no stars', Object.values(pot).every(Boolean), JSON.stringify(pot));
    // v3.13: weekly AP formula — base 4 + carry (≤ 2, only from the previous week) + 1 after a win, max 7; spending; briefing line
    const apf = await page.evaluate(() => {
      const s = YAM.game, keep = { date: s.calendar.date, week: s.week, base: WEEK.AP_BASE, we: s.worldEvent, wl: s.worldLast }, out = {};
      const mk = (left, res, gap = 7) => { s.week = { ...keep.week, start: '2003-03-03', ap: left }; s.calendar.date = isoAdd('2003-03-03', gap); s.lastResult = () => res;
        const w = s.weekState(); return [w.ap, w.carry, w.apSources.win, w.apSources.total].join(); };
      out.base = mk(0, 'L') === '4,0,0,4'; out.carry1 = mk(1, 'D') === '5,1,0,5'; out.carryCap = mk(5, 'L') === '6,2,0,6';
      out.win = mk(0, 'W') === '5,0,1,5'; out.all = mk(2, 'W') === '7,2,1,7'; out.gap = mk(3, 'W', 14) === '5,0,1,5';
      WEEK.AP_BASE = 6; out.max = mk(2, 'W') === '7,2,1,7'; WEEK.AP_BASE = keep.base;
      out.noBack = (() => { const w = s.week; s.calendar.date = '2003-03-04'; return s.weekState() === w; })();   // a debug jump back never rolls the week
      s.week.ap = 1; out.spend = s.spendAP() && s.week.ap === 0 && !s.spendAP() && s.week.ap === 0;
      delete s.lastResult;
      out.real = [null, 'W', 'D', 'L'].includes(s.lastResult());
      const line = MorningBriefing.apLine({ base: 4, carry: 1, win: 1, total: 6 });
      out.line = line === 'Base 4 · Carried 1 · Win +1 = 6 AP' || line === 'База 4 · Перенос 1 · Победа +1 = 6 ОД';
      const m = GameState.migrateWeek('2002-09-12', 'cardio');   // pre-v3.13 save on a Thursday with today's plan picked
      out.migrate = m.confirmed && m.plan.tue === WEEK.DEFAULT_REGIME && m.plan.thu === 'cardio' && !m.plan.mon && m.ap === WEEK.AP_BASE && m.trainingsDone === 1 && m.start === '2002-09-09';
      out.noCoachAp = !('AP' in COACH);
      s.week = keep.week; s.calendar.date = keep.date; s.worldEvent = keep.we; s.worldLast = keep.wl;
      return { out, line };
    });
    check('v3.13 weekly AP: base 4 / carry ≤ 2 (previous week only) / win +1 / max 7, spend to 0, briefing line "Base 4 · Carried 1 · Win +1 = 6 AP", old-save migration (Tue + Thu, confirmed, base AP), COACH.AP gone',
      Object.values(apf.out).every(Boolean), JSON.stringify(apf));
    // v3.13: a 5-training week → 'overload' absences from the 3rd training (seeded, not truancy, no roll call), Sunday: Parents −2
    const ov = await page.evaluate(() => {
      const s = YAM.game, keep = { date: s.calendar.date, week: s.week, today: s.today, ex: s.excusesOff, rep: { ...s.rep }, we: s.worldEvent, wl: s.worldLast, kids: s.squad.map(p => [p.energy, p.psych.discipline, p.injuryDays, p.suspensionMatches, p.awayDays, p.dyn.morale]) };
      s.calendar.date = '2003-03-03'; s.week = null; s.today = null; s.excusesOff = true;
      s.weekState(); s.worldEvent = null;   // v3.14: no school / city event in this synthetic week
      for (const k of WEEK.PLAN_KEYS) s.setWeekPlan(k, 'tech'); s.confirmWeek();
      s.squad.forEach(p => { p.injuryDays = 0; p.suspensionMatches = 0; p.awayDays = 0; p.psych.discipline = 20; });   // nobody skips: only the curve
      const truant = NARRATIVE_EVENTS.find(e => e.id === 'truant'), per = [];
      for (let i = 0; i < 5; i++) {
        s.squad.forEach(p => { p.energy = 80; });
        const date = s.calendar.date, lk = s.runLocker(), why = Object.values(lk.absent), first = JSON.stringify(lk.absent);
        const pid = Object.keys(lk.absent).find(id => lk.absent[id] === 'overload'), ap0 = s.ap;
        if (pid) YAM.ui.locker.investigate(pid);   // no roll call for 'overload'
        s.today.locker = null; const again = JSON.stringify(s.runLocker().absent) === first;   // seeded: same arrivals on a re-roll
        per.push({ k: s.trainingIndex(date), over: why.filter(x => x === 'overload').length, other: why.filter(x => x !== 'overload').length,
          skip: s.squad.some(p => p.skipped_training), truant: truant.trigger(s, date), unavail: s.squad.filter(p => p.absentToday === 'overload').every(p => p.unavailableReason === 'absent'),
          noCall: !pid || (s.ap === ap0 && !YAM.game.pendingEvent), again });
        s.dayRoutine(date); s.today = null; s.calendar.date = isoAdd(date, 1);
      }
      const p0 = s.rep.parents, b0 = s.rep.board; s.calendar.date = '2003-03-09';
      const review = s.weekReview('2003-03-09'), heavy = { r: review, parents: s.rep.parents - p0, board: s.rep.board - b0, diary: s.diary.at(-1)?.key };
      const ch = [attendChance({ psych: { discipline: 10 }, energy: 80 }, 2), attendChance({ psych: { discipline: 10 }, energy: 40 }, 2), attendChance({ psych: { discipline: 20 }, energy: 80 }, 3),
        attendChance({ psych: { discipline: 1 }, energy: 10 }, 4), attendChance({ psych: { discipline: 10 }, energy: 80 }, 0)].map(v => +v.toFixed(3));
      const done = s.week.trainingsDone;
      s.squad.forEach((p, i) => { [p.energy, p.psych.discipline, p.injuryDays, p.suspensionMatches, p.awayDays, p.dyn.morale] = keep.kids[i]; p.absentToday = null; p.skipped_training = false; });
      Object.assign(s.rep, keep.rep); s.week = keep.week; s.today = keep.today; s.calendar.date = keep.date; s.excusesOff = keep.ex; s.worldEvent = keep.we; s.worldLast = keep.wl;
      return { per, heavy, ch, done, label: L.t('lr.short.overload') };
    });
    check('v3.13 attendance curve: 5 trainings → no overload on the 1st–2nd, \'overload\' absences on the 3rd–5th (curve 0.7/0.5/0.3 ± discipline / tiredness, clamp 0.05), seeded, unavailable, no skipped_training / truant / roll call; Sunday ≥ 4 trainings → Parents −2',
      ov.per.length === 5 && ov.per.map(x => x.k).join() === '0,1,2,3,4' && ov.per[0].over === 0 && ov.per[1].over === 0 && ov.per.slice(2).reduce((a, x) => a + x.over, 0) > 0
      && ov.per[4].over >= 1 && ov.per.every(x => !x.skip && !x.truant && x.unavail && x.noCall && x.again && x.other === 0) && ov.done === 5
      && ov.ch.join() === '0.7,0.55,0.65,0.05,1' && ov.heavy.r === 'heavy' && ov.heavy.parents === -2 && ov.heavy.board === 0 && ov.heavy.diary === 'week.heavy' && /уроков|school/.test(ov.label),
      JSON.stringify(ov));
    // v3.13: a week with no training at all → Sunday (through the real daily hook): Board −2, Parents −2, "the gym stood empty"
    const ew = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, keep = { date: s.calendar.date, week: s.week, today: s.today, rep: { ...s.rep }, we: s.worldEvent, wl: s.worldLast, kids: s.squad.map(p => [p.energy, p.dyn.sharpness, p.dyn.morale, p.injuryDays, p.awayDays]) };
      s.calendar.date = '2003-03-10'; s.week = null; s.today = null; s.rep.parents = 50; s.rep.board = 50;
      s.weekState(); s.worldEvent = null; s.confirmWeek();   // empty plan (v3.14: and no world event)
      const b0 = s.rep.board, p0 = s.rep.parents, R = Math.random; Math.random = () => 0.5;
      let tr = 0;
      for (let i = 0; i < 7; i++) { const d = isoAdd('2003-03-10', i); s.calendar.date = d; if (ui.cal.dailyHooks[0](d)?.key !== 'cal.rest') tr++; }
      Math.random = R;
      const r = { tr, board: s.rep.board - b0, parents: s.rep.parents - p0, diary: s.diary.some(d => d.key === 'week.empty' && d.date === '2003-03-16'), text: L.t('week.empty'), both: !!(I18N.en['week.empty'] && I18N.ru['week.empty'] && I18N.en['pl.warn.heavy'] && I18N.ru['pl.warn.over']) };
      s.squad.forEach((p, i) => { [p.energy, p.dyn.sharpness, p.dyn.morale, p.injuryDays, p.awayDays] = keep.kids[i]; });
      Object.assign(s.rep, keep.rep); s.week = keep.week; s.today = keep.today; s.calendar.date = keep.date; s.worldEvent = keep.we; s.worldLast = keep.wl;
      return r;
    });
    check('v3.13 Sunday review: 0 trainings all week → Board −2, Parents −2, diary "The gym stood empty all week" (EN + RU)',
      ew.tr === 0 && ew.board === -2 && ew.parents === -2 && ew.diary && ew.both && /Зал пустовал всю неделю|The gym stood empty all week/.test(ew.text),
      JSON.stringify(ew));
    // v3.14: WORLD EVENTS — (1) DEBUG force on a Monday → briefing news without names + planner marker
    await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui;
      if (ui.locker.isOpen) ui.locker.close(); if (ui.planner.isOpen) ui.planner.close(); if (ui.briefing.isOpen) ui.briefing.close();
      s.phase = 'calendar'; s.calendar.date = '2002-12-02'; s.week = null; s.today = null; s.away = null; s.excusesOff = true;
      if (s.kassaDue()) s.confirmKassa('normal');   // v3.15: December's cash desk out of the way
      s.weekState(); ui.show('dash'); ui.renderAll();
      ui.debug.open(); ui.debug.tab = 'god'; ui.debug.render();
    });
    await page.selectOption('#dbg-world', 'athletics');
    await page.click('#debug-body [data-cheat="world"]');
    const w1 = await page.evaluate(() => {
      const s = YAM.game, e = s.worldEvent, msg = document.getElementById('debug-status')?.textContent || '';
      YAM.ui.debug.close(); YAM.ui.briefing.open();
      const news = [...document.querySelectorAll('#mb-news li')].map(x => x.textContent), all = document.querySelector('#mb-news li.mb-world')?.textContent || '';   // (the old flavour news may name any kid)
      const re = s.buildWorldEvent(s.worldRow('athletics'), e.weekStart), re2 = s.buildWorldEvent(s.worldRow('athletics'), e.weekStart);   // (3) seeded: same week + squad → same picks
      const elig = s.squad.filter(p => !(p.injuryDays > 0) && !(p.suspensionMatches > 0) && !(p.awayDays > 0)), sp = p => p.physical.speed + p.physical.acceleration;
      const top = [...elig].sort((a, b) => sp(b) - sp(a) || a.id.localeCompare(b.id)).slice(0, 4).map(p => p.id);
      return { e, msg, open: YAM.ui.briefing.isOpen, news, world: document.querySelectorAll('#mb-news li.mb-world').length, dayWord: L.t('world.on.' + weekKey(e.days[0])),
        noNames: e.playerIds.every(id => { const p = s.player(id); return !all.includes(p.surname) && !all.includes(L.name(p.surname)); }),
        same: JSON.stringify(re) === JSON.stringify(e) && JSON.stringify(re2) === JSON.stringify(e), wrongAtMost1: e.playerIds.filter(id => !top.includes(id)).length <= 1 };
    });
    await page.click('#mb-go');   // → PLANNER.EXE (the week is not confirmed yet)
    const w2 = await page.evaluate(() => ({ open: YAM.ui.planner.isOpen, cols: [...document.querySelectorAll('#pl-grid .pl-col.we')].map(c => c.dataset.date),
      tip: document.querySelector('#pl-grid .pl-col.we .pl-we')?.title || '' }));
    check('v3.14 world events: DEBUG forces "athletics" this week (one day Tue–Thu, top 4 by speed + acceleration, ≤ 1 wrong pick); Monday briefing news names the day but nobody; PLANNER.EXE marks the day (✦ + tooltip)',
      w1.e?.id === 'athletics' && w1.e.tier === 2 && w1.e.days.length === 1 && [2, 3, 4].includes(new Date(w1.e.days[0] + 'T00:00:00Z').getUTCDay()) && w1.e.playerIds.length === 4
      && w1.e.weekStart === '2002-12-02' && w1.wrongAtMost1 && /athletics|спартакиад/i.test(w1.msg) && w1.open && w1.world === 1 && w1.news[0].includes(w1.dayWord) && w1.noNames
      && w2.open && w2.cols.length === 1 && w2.cols[0] === w1.e.days[0] && w2.tip.length > 10, JSON.stringify({ w1, w2 }));
    // (2) on that day: the picked kids are away ('world:athletics'), not truants, rested, no roll call, no office, rep unchanged, diary names them
    const w3 = await page.evaluate(d => {
      const s = YAM.game, e = s.worldEvent;
      s.setWeekPlan(weekKey(d), 'match'); s.confirmWeek(); YAM.ui.planner.close();
      s.calendar.date = d; s.today = null; s.dayState().briefed = true; s.weekState().ap = 2;
      s.squad.forEach(p => { p.energy = 60; });
      const rep0 = JSON.stringify(s.rep), lk = s.runLocker(), away = e.playerIds.map(id => lk.absent[id]);
      const kids = e.playerIds.map(id => s.player(id)), here = s.squad.find(p => !lk.absent[p.id]);
      const truant = NARRATIVE_EVENTS.find(x => x.id === 'truant').trigger(s, d);
      const ap0 = s.ap; YAM.ui.locker.investigate(e.playerIds[0]);
      const noCall = s.ap === ap0 && !s.pendingEvent && !lk.checked.includes(e.playerIds[0]);
      const office = [YAM.ui.officeBlock(e.playerIds[0]), YAM.ui.officeBlock(here.id)];
      YAM.ui.locker.open();
      const label = document.querySelector(`#lr-grid .lk.load[data-pid="${e.playerIds[0]}"] .lk-note.open`)?.textContent || '';
      YAM.ui.locker.close();
      s.dayRoutine(d); s.worldDaily(d);
      const last = s.diary[s.diary.length - 1], txt = YAM.ui.entryText({ ...last, r: 0 });
      return { away, flags: kids.map(p => [p.absentToday, p.skipped_training, p.unavailableReason]), truant, noCall, office, label, want: L.t('lr.short.world:athletics'),
        rested: kids.every(p => p.energy === 70), hereE: here.energy, rep: JSON.stringify(s.rep) === rep0, diary: last.key, named: kids.every(p => txt.includes(L.name(p.surname))) };
    }, w1.e.days[0]);
    check('v3.14 event day: picked kids absent as world:athletics (unavailable, no skipped_training, no truant, no roll call, office "not at the club"), rested +10, rep unchanged, locker label, diary names them',
      w3.away.every(x => x === 'world:athletics') && w3.flags.every(f => f[0] === 'world:athletics' && f[1] === false && f[2] === 'absent') && !w3.truant && w3.noCall
      && w3.office[0] === 'office.blk.notHere' && w3.office[1] === null && w3.label.includes(w3.want) && w3.rested && w3.rep && w3.diary === 'world.athletics.diary' && w3.named, JSON.stringify(w3));
    // (4) quarter tests: fewer kids at a Mon–Thu training than with the same seed and no event; trainees −5 extra condition
    const w4 = await page.evaluate(() => {
      const s = YAM.game, keepEv = s.worldEvent, keepPlan = { ...s.week.plan }, ev = s.buildWorldEvent(s.worldRow('tests'), s.week.start);
      const elig = s.squad.filter(p => !(p.injuryDays > 0) && !(p.suspensionMatches > 0) && !(p.awayDays > 0)).map(p => p.id).sort();
      const out = { noAbs: 0, withAbs: 0, allTests: true, skip: false, again: true, idx: [] };
      const run = (we, d) => { s.worldEvent = we; s.today = null; s.squad.forEach(p => { p.energy = 80; p.injuryDays = 0; p.suspensionMatches = 0; p.awayDays = 0; p.psych.discipline = 20; });
        return s.runLocker(true, d); };
      for (const d of ev.days) {   // each Mon–Thu day as the week's only (1st) training: base chance 1, so only the tests can keep a kid away
        s.calendar.date = d; s.week.plan = { mon: null, tue: null, wed: null, thu: null, fri: null, [weekKey(d)]: 'match' }; out.idx.push(s.trainingIndex(d));
        out.noAbs += Object.keys(run(null, d).absent).length;
        const b = run(ev, d), why = Object.values(b.absent);
        out.withAbs += why.length; out.allTests = out.allTests && why.every(x => x === 'world:tests'); out.skip = out.skip || s.squad.some(p => p.skipped_training);
        out.again = out.again && JSON.stringify(run(ev, d).absent) === JSON.stringify(b.absent);
      }
      const d = ev.days[1];   // condition: Match Practice −10, the tests week −5 more for the trainees
      s.calendar.date = d; s.week.plan = { mon: null, tue: 'match', wed: null, thu: null, fri: null };
      const a = run(null, d), fresh = s.squad.find(p => !a.absent[p.id]); s.dayRoutine(d); out.eNo = fresh.energy;
      const b = run(ev, d), hereT = s.squad.find(p => !b.absent[p.id]); s.dayRoutine(d); out.eT = hereT.energy;
      Object.assign(out, { all: JSON.stringify([...ev.playerIds].sort()) === JSON.stringify(elig), days: ev.days.join(), label: L.t('lr.short.world:tests') });
      s.worldEvent = keepEv; s.week.plan = keepPlan; s.today = null;
      return out;
    });
    check('v3.14 quarter tests (Mon–Thu, everyone): a 1st-training-of-the-week roll call loses kids (×0.75, seeded, label "world:tests") vs none with the same seed and no event; trainees −5 extra condition',
      w4.idx.join() === '0,0,0,0' && w4.noAbs === 0 && w4.withAbs > 0 && w4.allTests && !w4.skip && w4.eNo === 70 && w4.eT === 65 && w4.all && w4.days === '2002-12-02,2002-12-03,2002-12-04,2002-12-05'
      && /school|контрольн/i.test(w4.label) && w4.again, JSON.stringify(w4));
    // (5) the weekly roll: seeded, ~half the weeks, never two weeks running (CHANCE 1 → every other week), never in the season's first week
    const w5 = await page.evaluate(() => {
      const s = YAM.game, keep = { we: s.worldEvent, wl: s.worldLast, ch: WORLD.CHANCE }, out = {};
      const run = () => { s.worldLast = null; const seq = []; for (let i = 0; i < 40; i++) { const e = s.rollWorldEvent(isoAdd('2002-09-09', 7 * i)); seq.push(e ? e.id : ''); } return seq; };
      const a = run(); out.n = a.filter(Boolean).length;
      out.noRow = a.every((x, i) => !(x && a[i - 1]));
      out.det = JSON.stringify(run()) === JSON.stringify(a);
      WORLD.CHANCE = 1; const b = run(); WORLD.CHANCE = keep.ch;
      out.alt = b.every((x, i) => !!x === (i % 2 === 0)); out.rows = new Set(b.filter(Boolean)).size;
      s.worldLast = null;
      out.first = !s.rollWorldEvent(weekStartOf(s.calendar.events.find(e => e.type === 'match').date)) && !s.rollWorldEvent('2002-08-26');
      out.noRandom = !/Math\.random/.test(GameState.prototype.rollWorldEvent.toString() + GameState.prototype.buildWorldEvent.toString());
      out.council = (() => { const r = s.worldRow('council'), all = s.squad.slice(0, 6); const keepD = all.map(p => p.psych.discipline);
        all.forEach((p, i) => { p.psych.discipline = i < 2 ? 5 : 12; }); const two = r.pick.n(all); all[1].psych.discipline = 12; const one = r.pick.n(all);
        all.forEach((p, i) => { p.psych.discipline = keepD[i]; }); return two === 2 && one === 1; })();
      s.worldEvent = keep.we; s.worldLast = keep.wl;
      return { out, a: a.join('|') };
    });
    check('v3.14 weekly roll: seeded (same sequence twice), roughly every other week at 50 %, never two weeks in a row (100 % → exactly every other week), none in the season\'s first week, no Math.random; council picks 2 only when two kids have discipline ≤ 7',
      w5.out.n >= 6 && w5.out.n <= 20 && w5.out.noRow && w5.out.det && w5.out.alt && w5.out.rows >= 3 && w5.out.first && w5.out.noRandom && w5.out.council, JSON.stringify(w5));
    // (3) the event survives a save / reload unchanged (picks fixed for the week)
    const w6a = await page.evaluate(() => { YAM.game.save(); return JSON.stringify(YAM.game.worldEvent); });
    await page.reload();
    await page.waitForFunction(() => window.YAM && window.YAM.ui);
    const w6b = await page.evaluate(() => ({ e: JSON.stringify(YAM.game.worldEvent), last: YAM.game.worldLast, wk: YAM.game.week?.start }));
    check('v3.14 deterministic picks: same week + squad → same playerIds (recomputed twice), and the saved event comes back unchanged after a reload',
      w1.same && w6a === w6b.e && JSON.parse(w6b.e).id === 'athletics' && w6b.last === '2002-12-02' && w6b.wk === '2002-12-02', JSON.stringify({ w6a, w6b }));
    // v3.15 CASH DESK — (1) KASSA.EXE opens at the first stop of a new month (before the briefing / PLANNER.EXE) with last month's ledger
    const k0 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui;
      for (const v of ['locker', 'planner', 'briefing', 'kassa']) if (ui[v].isOpen) ui[v].layer.hidden = true;
      ui.events.enabled = false; s.excusesOff = true; s.pendingEvent = null;
      s.phase = 'calendar'; s.calendar.date = '2002-11-03'; s.week = null; s.today = null; s.away = null; s.worldEvent = null;   // Sunday (quiet) → Monday 4 Nov
      s.weekState(); s.weekState().confirmed = true;
      const ids = s.squad.map(p => p.id);
      s.fees = { month: '2002-10', level: 'normal', amount: 10, started: true, status: Object.fromEntries(ids.map((id, i) => [id, i < 2 ? 'owed' : i === 2 ? 'half' : 'paid'])),
        reminded: {}, reason: {}, carry: {}, next: {}, got: { [ids[2]]: 5 } };
      s.ledger['2002-10'] = { fee: 120, grant: 50, donation: 20, rent: -100, event: -30 };
      s.budget = 400; s.rep.parents = 50; s.save(); ui.show('dash'); ui.renderAll();
      return { ids, label: document.getElementById('btn-sim').textContent };
    });
    await page.click('#btn-sim');   // [ CONTINUE ] → Monday 4 Nov: the month's first stop
    const k1 = await page.evaluate(() => {
      const t = [...document.querySelectorAll('#ks-report tr')].map(r => [r.dataset.cat, r.querySelector('td + td').textContent.trim()]);
      return { date: YAM.game.calendar.date, kassa: YAM.ui.kassa.isOpen, brief: YAM.ui.briefing.isOpen, planner: YAM.ui.planner.isOpen, blk: YAM.ui.dayBlockers()[0],
        z: +getComputedStyle(document.getElementById('kassa-view')).zIndex, rows: Object.fromEntries(t), radios: document.querySelectorAll('#ks-levels input[type=radio]').length,
        checked: document.querySelector('#ks-levels input:checked')?.value, budget: document.getElementById('ks-report').textContent.includes('$400'), top: YAM.ui.topLayer()?.el.id,
        title: document.getElementById('ks-title').textContent, parents: YAM.game.rep.parents };
    });
    await page.click('#ks-levels input[value="high"]');
    await page.click('#ks-confirm');
    const k2 = await page.evaluate(ids => { const s = YAM.game, f = s.fees;
      return { kassa: YAM.ui.kassa.isOpen, brief: YAM.ui.briefing.isOpen, month: f.month, level: f.level, amount: f.amount, parents: s.rep.parents, owed: ids.every(id => f.status[id] === 'owed'),
        carry: f.carry[ids[2]], due: s.feeDue(ids[2]), lost: s.diary.some(d => d.key === 'fee.lost' && d.date === '2002-10-31' && d.vars.n === 2), blk: YAM.ui.dayBlockers()[0] }; }, k0.ids);
    await page.click('#mb-go');   // the briefing → PLANNER.EXE (Monday, week not planned)
    const k3 = await page.evaluate(() => ({ planner: YAM.ui.planner.isOpen }));
    check('v3.15 KASSA.EXE: the first stop of a new month opens the cash desk first (z 50, Esc layer), last month\'s ledger rows + total + budget, Low / Normal (default) / High; confirm → level + Parents −3 once, everyone owes, Oct unpaid lost (diary count), half carried; then briefing → PLANNER.EXE',
      /CONTINUE|ПРОДОЛЖИТЬ/.test(k0.label) && k1.date === '2002-11-04' && k1.kassa && !k1.brief && !k1.planner && k1.blk === 'kassa' && k1.z === 50 && k1.top === 'kassa-view' && /KASSA/.test(k1.title)
      && k1.rows.fee === '+$120' && k1.rows.grant === '+$50' && k1.rows.donation === '+$20' && k1.rows.rent === '−$100' && k1.rows.event === '−$30' && k1.rows.total === '+$60' && k1.budget
      && k1.radios === 3 && k1.checked === 'normal' && !k2.kassa && k2.brief && k2.month === '2002-11' && k2.level === 'high' && k2.amount === 15 && k2.parents === k1.parents - 3 && k2.owed
      && k2.carry === 5 && k2.due === 20 && k2.lost && k2.blk === 'briefing' && k3.planner, JSON.stringify({ k0: k0.label, k1, k2, k3 }));
    // (3) the fee day = the first training of the month: briefing line, Fees panel, paid kids add 'fee' money, free [ Remind ]
    await page.evaluate(() => { YAM.game.setWeekPlan('tue', 'match'); });
    await page.click('#pl-confirm');
    await page.click('#btn-sim');   // → Tuesday 5 Nov (training) — the briefing opens by itself
    const f0 = await page.evaluate(() => ({ date: YAM.game.calendar.date, brief: YAM.ui.briefing.isOpen, agenda: document.getElementById('mb-agenda').textContent, started: YAM.game.fees.started,
      fee0: YAM.game.ledger['2002-11']?.fee || 0 }));
    await page.click('#mb-go'); await page.waitForTimeout(300);
    const f1 = await page.evaluate(() => {
      const s = YAM.game, f = s.fees, lk = s.dayState().locker, box = document.getElementById('lr-fees');
      const paid = s.squad.filter(p => f.status[p.id] === 'paid'), here = s.squad.filter(p => !lk.absent[p.id]);
      const owesHere = here.filter(p => s.feeOwes(p.id));
      return { open: YAM.ui.locker.isOpen, panel: !box.hidden, rows: box.querySelectorAll('.lrf-row').length, n: s.squad.length, started: f.started,
        paid: paid.length, paidAbsent: paid.some(p => lk.absent[p.id]), fee: s.ledger['2002-11']?.fee || 0, want: paid.reduce((a, p) => a + f.got[p.id], 0),
        sum: box.querySelector('.lrf-head').textContent, btns: box.querySelectorAll('[data-remind]').length, owesHere: owesHere.map(p => p.id), firstOwes: owesHere[0]?.id || null };
    });
    if (f1.firstOwes) await page.click(`#lr-fees [data-remind="${f1.firstOwes}"]`);
    const f2 = await page.evaluate(id => ({ rem: id ? !!YAM.game.fees.reminded[id] : true, label: id ? !!document.querySelector('#lr-fees .lrf-rem') : true, ap: YAM.game.ap }), f1.firstOwes);
    check('v3.15 fee day (1st training of the month): briefing line, Fees panel in the Locker Room (one row per kid, ✓ / ✗), only present kids pay, paid fees booked under "fee", free [ Remind ] for present kids who owe',
      f0.date === '2002-11-05' && f0.brief && /\$15/.test(f0.agenda) && !f0.started && f0.fee0 === 0 && f1.open && f1.panel && f1.rows === f1.n && f1.started && f1.paid > 0 && !f1.paidAbsent
      && f1.fee === f1.want && f1.fee >= f1.paid * 15 && f1.btns === f1.owesHere.length && f2.rem && f2.label, JSON.stringify({ f0, f1, f2 }));
    // (5) the fee talk: nomoney only for poor kids (fixed per month, saved); Waive → waived, morale +8, Squad +2, no rep penalty
    const t0 = await page.evaluate(() => {
      const s = YAM.game, f = s.fees, keep = JSON.stringify(f.reason), out = {};
      out.reasons = s.squad.map(p => { delete f.reason[p.id]; return [p.wealth, s.feeReason(p.id)]; });
      out.poorOnly = out.reasons.every(([w, r]) => (r === 'nomoney') === (w === 'poor'));
      out.stable = s.squad.every(p => s.feeReason(p.id) === f.reason[p.id]);
      f.reason = JSON.parse(keep);
      // a present kid who owes, from a poor family (hidden — set for the test), 1 AP for the office
      const lk = s.dayState().locker, kid = s.squad.find(p => !lk.absent[p.id] && p.archetype !== 'GK') || s.squad.find(p => !lk.absent[p.id]);
      out.keepW = kid.wealth; kid.wealth = 'poor'; f.status[kid.id] = 'owed'; delete f.reason[kid.id]; s.weekState().ap = 1;
      out.kid = kid.id; out.m0 = kid.dyn.morale = 50; out.rep0 = { ...s.rep };
      YAM.ui.locker.layer.hidden = true;   // (the office talk also works over the room; closed for a clean dialogue)
      return out;
    });
    await page.evaluate(id => YAM.ui.callIntoOffice(id), t0.kid);
    const t1 = await page.evaluate(() => [...document.querySelectorAll('#talk-choices .talk-btn')].map(b => b.querySelector('.tb-label').textContent));
    const feeIdx = await page.evaluate(() => [...document.querySelectorAll('#talk-choices .talk-btn')].findIndex(b => b.querySelector('.tb-label').textContent === L.t('office.btn.fee')));
    await talk(feeIdx);
    const t2 = await page.evaluate(() => ({ step: YAM.game.pendingEvent?.step, text: document.getElementById('talk-text')?.textContent || '', n: document.querySelectorAll('#talk-choices .talk-btn').length,
      labels: [...document.querySelectorAll('#talk-choices .talk-btn .tb-label')].map(b => b.textContent) }));
    await talk(0);   // Waive it this month
    const t3 = await page.evaluate(([id, w]) => { const s = YAM.game, k = s.player(id), r = { st: s.fees.status[id], m: k.dyn.morale, rep: { ...s.rep }, reason: s.fees.reason[id],
      closed: !s.pendingEvent, diary: s.diary.slice(-4).some(d => d.key === 'office.fee.waive.diary') ? 'office.fee.waive.diary' : s.diary[s.diary.length - 1].key, owes: s.feeOwes(id), ap: s.ap }; k.wealth = w; return r; }, [t0.kid, t0.keepW]);
    check('v3.15 fee talk (office, no extra AP): "About the fee" only for a kid who owes; nomoney only for poor kids (seeded, saved per month); Waive → waived, morale +8, Squad +2, Board / Parents unchanged',
      t0.poorOnly && t0.stable && t1.length === 5 && feeIdx === 3 && t2.step === 'fee' && t2.n === 2 && t3.st === 'waived' && t3.m === 58
      && t3.rep.squad === Math.min(100, t0.rep0.squad + 2) && t3.rep.parents === t0.rep0.parents && t3.rep.board === t0.rep0.board && t3.reason === 'nomoney' && t3.closed
      && t3.diary === 'office.fee.waive.diary' && !t3.owes && t3.ap === 0, JSON.stringify({ t0: { poorOnly: t0.poorOnly, stable: t0.stable, kid: t0.kid }, t1, feeIdx, t2, t3 }));
    // (6) High lowers poor kids' payment rate vs Normal on the same seeds; (4) wealth: seeded per id, 20/60/20, no link to skills, hidden
    const hw = await page.evaluate(() => {
      const s = YAM.game, keep = { fees: s.fees, ledger: JSON.stringify(s.ledger), budget: s.budget, w: s.squad.map(p => p.wealth) }, out = {};
      s.squad.forEach(p => { p.wealth = 'poor'; });
      const rate = level => { let paid = 0, n = 0;
        for (let i = 0; i < 12; i++) { const date = isoAdd('2002-11-05', i); s.calendar.date = date;
          s.fees = { month: '2002-11', level, amount: FINANCE.FEES[level].fee, started: false, status: Object.fromEntries(s.squad.map(p => [p.id, 'owed'])), reminded: {}, reason: {}, carry: {}, next: {}, got: {} };
          paid += s.collectFees(date, {}).length; n += s.squad.length; }
        return paid / n; };
      out.normal = +rate('normal').toFixed(2); out.high = +rate('high').toFixed(2); out.low = +rate('low').toFixed(2);
      out.chances = [feeChance('poor', 'first', 'normal'), feeChance('poor', 'first', 'high'), feeChance('rich', 'reminded', 'low'), feeChance('middle', 'later', 'high')].map(v => +v.toFixed(3));
      s.squad.forEach((p, i) => { p.wealth = keep.w[i]; }); s.fees = keep.fees; s.ledger = JSON.parse(keep.ledger); s.budget = keep.budget; s.calendar.date = '2002-11-05';
      // wealth: same id → same value; distribution; independent of skills; old saves / AI / pool all have one
      const ids = Array.from({ length: 4000 }, (_, i) => 'w' + i), ws = ids.map(id => Player.rollWealth(id));
      out.share = WEALTH.KEYS.map(k => +(ws.filter(w => w === k).length / ids.length).toFixed(2));
      out.det = ids.slice(0, 50).every((id, i) => Player.rollWealth(id) === ws[i]);
      out.all = [...s.globalPlayers, ...s.league.teams.filter(t => !t.user).flatMap(t => s.league.roster(t, new Set()))].every(p => WEALTH.KEYS.includes(p.wealth) && p.wealth === Player.rollWealth(p.id));
      const raw = JSON.parse(JSON.stringify(s.squad[0])); delete raw.wealth; out.migrate = new Player({ ...raw, tags: [] }).wealth === s.squad[0].wealth;
      out.kept = new Player({ ...JSON.parse(JSON.stringify(s.squad[0])), wealth: 'rich', tags: [] }).wealth === 'rich';
      const gp = s.globalPlayers, avg = w => { const l = gp.filter(p => p.wealth === w); return l.reduce((a, p) => a + p.overall, 0) / Math.max(1, l.length); };
      out.gap = +Math.abs(avg('rich') - avg('poor')).toFixed(2);
      YAM.ui.profile.open(s.squad[0].id); const txt = document.getElementById('pinfo-body').textContent; YAM.ui.profile.close();
      out.hidden = !/rich|poor|wealth|богат|бедн|достат/i.test(txt);
      YAM.ui.debug.open(); YAM.ui.debug.tab = 'db'; YAM.ui.debug.render(); out.debug = /WLTH/.test(document.getElementById('debug-body').textContent); YAM.ui.debug.close();
      out.snap = JSON.stringify(s.squad.map(p => [p.id, p.wealth]));
      s.save();
      return out;
    });
    await page.reload();
    await page.waitForFunction(() => window.YAM && window.YAM.ui);
    const hw2 = await page.evaluate(() => JSON.stringify(YAM.game.squad.map(p => [p.id, p.wealth])));
    check('v3.15 High fee lowers poor kids\' payment rate vs Normal on the same seeds (Low raises it); chances: poor 40 → 24 %, rich reminded +10 pp capped at 100 %, middle later ×0.9',
      hw.high < hw.normal && hw.low > hw.normal && hw.chances.join() === '0.4,0.24,1,0.405', JSON.stringify({ normal: hw.normal, high: hw.high, low: hw.low, chances: hw.chances }));
    check('v3.15 wealth: seeded per id (same after save / reload, old saves migrate, a saved value is kept), ≈ 20 / 60 / 20 %, world + AI rosters covered, not tied to skill, shown only in DEBUG.EXE (WLTH)',
      hw.det && hw.all && hw.migrate && hw.kept && hw.snap === hw2 && Math.abs(hw.share[0] - 0.2) <= 0.03 && Math.abs(hw.share[1] - 0.6) <= 0.03 && Math.abs(hw.share[2] - 0.2) <= 0.03
      && hw.gap < 2 && hw.hidden && hw.debug, JSON.stringify({ share: hw.share, gap: hw.gap, det: hw.det, all: hw.all, migrate: hw.migrate, kept: hw.kept, hidden: hw.hidden, debug: hw.debug, same: hw.snap === hw2 }));
    // follow-up: per-game world salt (saved, never recomputed) + ✦ in the TODAY week strip
    const sl = await page.evaluate(() => {
      const s = YAM.game, salt = s.worldSalt, out = { salt: typeof salt === 'string' && salt.length > 0 };
      out.fromSquad = salt === GameState.worldSaltOf(s.squad) || !!s.expelled?.length;   // computed from the starting squad (a later kick-out does not change it)
      const other = [...s.squad]; other.pop(); out.differs = GameState.worldSaltOf(other) !== GameState.worldSaltOf(s.squad);
      const keep = { we: s.worldEvent, wl: s.worldLast };
      s.worldEvent = keep.we; s.worldLast = keep.wl;
      s.forceWorldEvent('olympiad'); YAM.ui.renderAll();
      const day = s.worldEvent.days[0], cell = [...document.querySelectorAll('#today-box .td-wd')][WEEK.KEYS.indexOf(weekKey(day))];
      out.mark = !!cell?.querySelector('.td-we') && cell.classList.contains('we') && cell.title.includes(L.t('world.tip.olympiad'));
      out.only = document.querySelectorAll('#today-box .td-we').length === 1;
      return out;
    });
    check('v3.14 follow-ups: world seed salted per academy (from the squad ids, saved), ✦ + the planner tooltip on event days in the TODAY week strip',
      sl.salt && sl.fromSquad && sl.differs && sl.mark && sl.only, JSON.stringify(sl));
    const bal = require('child_process').spawnSync(process.execPath, [require('path').join(__dirname, 'balance.js')], { encoding: 'utf8' });
    check('balance.js: Attack vs Defense win share within 45–55%', bal.status === 0, (bal.stdout.trim().split('\n').pop() || bal.stderr).slice(0, 120));
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
