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
const BAL_V324_COH = 'f0a0e298d0c0044c';   // v3.25: sha256 (16) of the v3.24 `balance.js --cohesion` tables + OK lines (must not change)

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const errors = [];
  await page.addInitScript(() => { window.YAM_SKIP_REPORTS = true; window.YAM_AUTO_REVIEW = true; });   // v3.17: the training report has its own check (it would pause CONTINUE); v3.19: REVIEW.EXE takes the first card (own checks at the end)
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => { errors.push('native dialog: ' + d.message()); d.dismiss(); });
  // v2.8: START DAY → morning briefing → [ HEAD TO THE CLUB ] → locker room
  const toLocker = async () => {
    await page.evaluate(() => YAM.ui.locker.open());
    if (await page.evaluate(() => !document.getElementById('morning-briefing-view').hidden)) {
      await page.click('#mb-go');
      // v3.24: on a match day the briefing is followed by the "Match day" dialog → its [ TO THE LOCKER ROOM ]
      await page.evaluate(() => { if (YAM.game.phase === 'matchday' && !YAM.ui.locker.isOpen && !YAM.ui.events.active) { YAM.ui.modal.close(); YAM.ui.locker.open(); } });
    }
    await page.waitForTimeout(60);
  };
  // v3.17: dialogue choices are disabled until the line is fully typed → skip the typewriter first
  const finishTyping = () => page.evaluate(() => YAM.ui.events.view.finishTyping());
  const talkClick = async (sel, opts) => { await finishTyping(); await page.click(sel, opts); };
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
    // v3.23: signing writes the yard notes as clues — exactly the mapped ones, source 'yard', ref 'draft', the draft date, the signal from YARD.SIGNAL
    const yc = await page.evaluate(() => { const s = YAM.game, out = { n: 0, exact: true, mapped: 0, none: 0, seen: true };
      for (const p of s.squad) {
        const want = DraftView.notes(p).filter(k => YARD.SIGNAL[k]), got = p.clues || [];
        out.n++; out.mapped += want.length; if (!want.length) out.none++;
        if (got.length !== want.length || want.some((k, i) => got[i].source !== 'yard' || got[i].ref !== 'draft' || got[i].date !== s.calendar.date || got[i].signal !== YARD.SIGNAL[k] || got[i].textKey !== 'clue.yard.' + k)) out.exact = false;
        if (got.some(c => !c.seen)) out.seen = false;
      }
      out.flag = s.squad.every(p => p.yardDone); return out; });
    check('v3.23 START SEASON writes every signed kid\'s yard notes as clues (only traits with a role signal, draft date, read), nothing for pace / strong / hands / quiet',
      yc.n === 15 && yc.exact && yc.seen && yc.flag && yc.mapped > 0, JSON.stringify(yc));

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
    // v3.24 (2): match day = morning briefing → (match-day event) → "Match day" dialog → locker room
    const md0 = await page.evaluate(() => ({ brief: YAM.ui.briefing.isOpen, modal: !document.getElementById('modal-layer').hidden, wait: !!YAM.game.dayState().mdWait, kassa: YAM.ui.kassa.isOpen }));
    if (md0.brief) await page.click('#mb-go');
    const md1 = await page.evaluate(() => ({ brief: YAM.ui.briefing.isOpen, modal: !document.getElementById('modal-layer').hidden, briefed: !!YAM.game.dayState().briefed, wait: !!YAM.game.dayState().mdWait,
      title: document.getElementById('modal-layer').textContent.includes(L.t('dlg.matchdayTitle')) }));
    check('v3.24 match day with news: the morning briefing opens first (no "Match day" dialog, no cash desk), the "Match day" dialog only after [ HEAD TO THE CLUB ]',
      md0.brief && !md0.modal && md0.wait && !md0.kassa && !md1.brief && md1.modal && md1.title && md1.briefed && !md1.wait, JSON.stringify({ md0, md1 }));
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
      const g = YAM.ui.lastMatchLog, sum = x => x.stat + x.mood + x.rand + Object.values(x.flat).reduce((a, b) => a + b, 0) + x.shout + x.rep + x.cap + (x.coh || 0) + (x.bond || 0) + x.cheat;   // v3.21: + cohesion; v3.25: + bonds
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
    // v3.18 clues in the real post-match Notebook: no role names in the coach's note (EN + RU), one clue per outfield card,
    // stored in p.clues, unique phrasing, a Clues block on every card, opening the Notebook marks them read
    const cl0 = await page.evaluate(() => {
      const s = YAM.game, rep = s.lastReport, ui = YAM.ui, code = L.code, txt = {};
      const names = ROLE_IDS.flatMap(id => [I18N.en['role.' + id], I18N.ru['role.' + id]]).map(x => x.toLowerCase());   // v3.19: names live in I18N
      for (const c of ['en', 'ru']) { L.code = c; ui.renderNotebook(); txt[c] = [...document.querySelectorAll('#notes-body .coach-note')].map(x => x.textContent.toLowerCase()).join(' | '); }
      L.code = code; ui.renderNotebook();
      const out = rep.players.filter(pr => !pr.gk);
      return { clean: ['en', 'ru'].every(c => txt[c].length > 20 && !names.some(n => txt[c].includes(n))), txt: txt.en.slice(0, 160),
        stored: out.every(pr => /^clue\.(pass|duel|solo|run|screen|finish|none)\.\d$/.test(pr.clue) && s.player(pr.id).clues.some(c => c.textKey === pr.clue && c.source === 'match' && c.ref === rep.md)),
        uniq: new Set(out.map(pr => pr.clue)).size === out.length, blocks: document.querySelectorAll('#notes-body .card .nb-clues').length === 3,
        seen: rep.players.every(pr => !unseenClues(s.player(pr.id))) };
    });
    check('v3.18 Notebook: the coach\'s note is an episode with no role names (EN + RU), one stored clue per outfield card (unique phrasing), Clues block on each card, read once the Notebook is open',
      cl0.clean && cl0.stored && cl0.uniq && cl0.blocks && cl0.seen, JSON.stringify(cl0));
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
    await finishTyping();
    const bt = await page.evaluate(() => {
      const pe = YAM.game.pendingEvent, kid = YAM.game.player(pe.cast.kid), btns = [...document.querySelectorAll('#talk-choices .talk-btn')];
      return { kid: kid.id, agi: kid.physical.agility, n: btns.length, dis: btns[0].disabled, en: !btns[1].disabled, face: !!document.querySelector('#talk-face svg'),
        hdr: document.getElementById('hdr-budget').textContent };
    });
    await talkClick('#talk-choices .talk-btn[data-i="0"]', { force: true });   // disabled: must do nothing
    await page.keyboard.press('Escape');                                         // forced choice: Esc does nothing
    const still = await talkOpen();
    await talkClick('#talk-choices .talk-btn[data-i="1"]');
    const bt2 = await page.evaluate(k => ({ agi: YAM.game.player(k).physical.agility, closed: document.getElementById('talk-layer').hidden, pe: YAM.game.pendingEvent, b: YAM.game.budget,
      diary: YAM.game.diary[YAM.game.diary.length - 1].key, tail: YAM.game.diary.slice(-4).map(d => d.key + ':' + JSON.stringify(d.vars || {})) }), bt.kid);
    check('budget in header = $500 + the ledger (September fees); Torn Boots: snitch face, unaffordable choice disabled, Esc blocked, "no" = agility −2',
      hdr0.b === 500 + hdr0.led && hdr0.fee > 0 && hdr0.txt.includes('$' + hdr0.b) && bt.n === 3 && bt.dis && bt.en && bt.face && /\$100/.test(bt.hdr) && still
      && bt2.agi === Math.max(1, bt.agi - 2) && bt2.closed && !bt2.pe && bt2.b === 100 && bt2.tail.some(x => x.startsWith('ev.boots.b.diary:')), JSON.stringify({ hdr0, bt, still, bt2 }));   // v3.24: an injured starter's xi.auto may follow
    // v3.22: money offers open with the refusal (dad / scout / pool); the dad's refusal costs the kid only −5 morale
    const firstBtns = async id => { await page.evaluate(i => YAM.ui.events.fire(i), id); await finishTyping();
      const r = await page.evaluate(() => [...document.querySelectorAll('#talk-choices .talk-btn')].map(b => b.className.match(/tone-(\w+)/)[1] + (b.querySelector('.tb-money') ? '$' : '')));
      return r; };
    const offerBtns = {};
    await page.evaluate(() => { window.__R = Math.random; Math.random = () => 0.5; });   // (the pool's cast shuffles: keep the page's random stream untouched)
    for (const id of ['scout', 'pool']) { offerBtns[id] = await firstBtns(id); await page.evaluate(() => { YAM.game.pendingEvent = null; YAM.ui.events.view.close(); }); }
    await page.evaluate(() => { Math.random = window.__R; });
    offerBtns.dad = await firstBtns('dad');
    const dadR0 = await page.evaluate(() => { const k = YAM.game.player(YAM.game.pendingEvent.cast.kid); k.dyn.morale = 60; return k.id; });
    await talkClick('#talk-choices .talk-btn[data-i="0"]');
    const dadR1 = await page.evaluate(k => ({ mor: YAM.game.player(k).dyn.morale, flag: YAM.game.player(k).hasFlag('Promised_Start'), diary: YAM.game.diary.at(-1).key }), dadR0);
    check('v3.22 money offers: dad / scout / pool — the first button is the refusal (gray), the money option second (green, +$); dad refusal → kid morale −5',
      ['dad', 'scout', 'pool'].every(id => offerBtns[id].join() === 'gray,green$') && dadR1.mor === 55 && !dadR1.flag && dadR1.diary === 'ev.dad.b.diary', JSON.stringify({ offerBtns, dadR1 }));
    await page.evaluate(() => YAM.ui.events.fire('dad'));
    await page.waitForTimeout(100);
    const dd = await page.evaluate(() => ({ kid: YAM.game.pendingEvent.cast.kid, worst: (w => (w('rich') || w('middle') || w(null)).id)(w => [...YAM.game.squad].filter(p => !w || p.wealth === w).sort((a, b) => a.overall - b.overall)[0]),   // v3.15: the weakest RICH kid
      sil: document.querySelector('#talk-face svg rect:nth-of-type(2)') !== null, sq: YAM.game.rep.squad }));
    await talkClick('#talk-choices .talk-btn[data-i="1"]');   // v3.22: the money is the second button
    const dd2 = await page.evaluate(k => ({ b: YAM.game.budget, flag: YAM.game.player(k).flags.includes('Promised_Start'), by: YAM.game.player(k).promiseBy, hdr: document.getElementById('hdr-budget').textContent,
      chip: !!document.querySelector(`#roster .r-row[data-id="${k}"] .tag.flag`), sq: YAM.game.rep.squad, rumour: YAM.game.diary.slice(-2).some(d => d.key === 'ev.dad.rumour.diary') }), dd.kid);
    check("Rich Kid's Dad: the weakest kid of a rich family (v3.15), take money = +$300 + Promised_Start chip", dd.kid === dd.worst && dd.sil && dd2.b === 400 && dd2.flag && /\$400/.test(dd2.hdr) && dd2.chip, JSON.stringify({ dd, dd2 }));
    check('v3.22 taking the dad\'s money: promiseBy = dad, the rumour at once (Squad −2 + diary "a starting spot can be bought")',
      dd2.by === 'dad' && dd2.sq === Math.max(0, dd.sq - 2) && dd2.rumour, JSON.stringify({ dd, dd2 }));
    // v2.2/2.3: injuries, multi-step dialogue + suspension, match-day bus, dads' pool → losing dad, scout → showcase
    const talk = async i => { await talkClick(`#talk-choices .talk-btn[data-i="${i}"]`); await page.waitForTimeout(30); };
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
    await page.evaluate(() => { window.__leak = EVENTS_CFG.POOL_LEAK_CHANCE; EVENTS_CFG.POOL_LEAK_CHANCE = 0; });   // (the leak has its own v3.22 check)
    await talk(1);   // accept the donation (v3.22: second button)
    await page.evaluate(() => { EVENTS_CFG.POOL_LEAK_CHANCE = window.__leak; });
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
    await talk(1);   // accept the kit money → time bomb (v3.22: second button)
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
    await page.click('#btn-sim');   // Sunday: [ CONTINUE ] → Monday (the week is not planned yet) → v3.17: ONE window — PLANNER.EXE with the briefing inside
    // v3.14/v3.15: this week's seeded world event (if any — per-game salt) is cleared — the v3.13 checks below pin exact numbers; world events have their own checks
    await page.evaluate(() => { YAM.game.worldEvent = null; YAM.ui.planner.render(); });
    const mb = await page.evaluate(() => ({ open: !document.getElementById('morning-briefing-view').hidden, pl: !document.getElementById('planner-view').hidden,
      kind: YAM.ui.dayInfo(YAM.game.calendar.date).kind, ap: document.getElementById('pl-head').textContent, src: YAM.game.weekState().apSources, last: YAM.game.lastResult(),
      away: document.querySelectorAll('#pl-brief li').length, briefed: !!YAM.game.dayState().briefed }));
    await shot('11-briefing');
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
    check('v3.13 planner (v3.17: Monday = one window, the AP make-up in PLANNER.EXE): PLANNER.EXE (z 50, 7 columns, Sat match + Sun rest fixed, Rest + 4 regimes Mon–Fri); [ CONFIRM WEEK ] blocks CONTINUE; 3rd = heavy, 4th–5th = overload (words only); confirm → CONTINUE',
      dl0.today && dl0.strip === 7 && dayOf(dl0.date) === 0 && !dl0.blk && /ПРОДОЛЖИТЬ|CONTINUE/.test(dl0.label) && !dl0.btn && days(dl0.date, wp0.date) === 1 && !mb.open && mb.pl && !mb.briefed
      && mb.kind === 'rest' && mb.src.total === Math.min(7, 4 + mb.src.carry + (mb.last === 'W' ? 1 : 0)) && mb.ap.includes(String(mb.src.total)) && /4/.test(mb.ap)
      && wp0.open && wp0.z === 50 && wp0.cols === 7 && wp0.fixed === 2 && wp0.match && wp0.opts === 25 && wp0.blk === 'week' && /ПЛАН|PLAN/.test(wp0.label) && wp0.stuck && wp0.top === 'planner-view'
      && wp1.n === 5 && wp1.warn.length === 5 && !wp1.warn[0] && !wp1.warn[1] && /Тяжеловат|Heavy/.test(wp1.warn[2]) && /Перегруз|Overload/.test(wp1.warn[3]) && wp1.over === 2 && !/\d\s*%/.test(wp1.warn.join() + wp1.sum)
      && wp2.closed && wp2.confirmed && wp2.plan === '-,cardio,-,match,-' && wp2.blk === 0 && /ПРОДОЛЖИТЬ|CONTINUE/.test(wp2.label) && !wp2.dis && !wp2.monTr && wp2.aiTue,
      JSON.stringify({ dl0, mb, wp0, wp1, wp2 }));
    // [ CONTINUE ] on Monday → Tuesday (planned training): the briefing opens by itself (v3.17: only with news → one important line is planted)
    await page.evaluate(() => { YAM.game.away = [{ date: YAM.game.calendar.date, key: 'week.empty', cls: 'ev' }]; });
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
    await page.evaluate(() => { YAM.game.away = [{ date: YAM.game.calendar.date, key: 'week.empty', cls: 'ev' }]; });   // v3.17: news → Thursday's briefing opens
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
      const s = YAM.game, p = s.starters().find(x => x.archetype !== 'GK' && x.available && !x.flags.includes('Promised_Start'));   // (v3.15+: the dad's son may be a starter — he is needed later)
      s.weekState().ap = 1; s.rep.parents = 50; s.rep.squad = 50; if (s.fees?.status[p.id]) s.fees.status[p.id] = 'paid';   // (v3.15: no fee line here)
      YAM.ui.profile.open(p.id);
      return { id: p.id, n0: s.squad.length, slot: s.lineup.indexOf(p.id) };
    });
    await page.click('#pinfo-office');
    await finishTyping();
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
    await talkClick('#talk-choices .talk-btn.tone-green');
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
    await finishTyping();
    const tu = await page.evaluate(() => ({ kid: YAM.game.pendingEvent?.cast.kid, n: document.querySelectorAll('#talk-choices .talk-btn').length, fineOff: document.querySelector('#talk-choices .talk-btn[data-i="0"]').disabled, fineTag: document.querySelector('#talk-choices .talk-btn[data-i="0"] .tb-money')?.textContent || '',
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
    check('The Truant: skipper\'s portrait, the fine is paid by his family (v3.24: enabled even with $10, tag +$20), "call him" rolls a saved step (sorry → +2 discipline), suspend = 1 match',
      trn.id === tu.kid && tu.n === 4 && !tu.fineOff && tu.fineTag === '+$20' && tu.face && tu2.step === 'sorry' && tu2.n === 1 && tu3.disc === Math.min(20, d0 + 2) && tu3.closed && tu4.sus === 1 && !tu4.starter,
      JSON.stringify({ tu, tu2, tu3, tu4 }));

    // a dilemma survives a reload, then the calendar pauses on a random event and resumes after the choice
    await page.evaluate(() => YAM.ui.events.fire('boots'));
    await page.reload();
    await page.waitForFunction(() => window.YAM && window.YAM.ui);
    await page.evaluate(() => { YAM.game.excusesOff = true; });
    const re = await page.evaluate(() => ({ open: !document.getElementById('talk-layer').hidden, b: YAM.game.budget, kid: YAM.game.pendingEvent?.cast.kid }));
    await talkClick('#talk-choices .talk-btn[data-i="0"]');
    const re2 = await page.evaluate(k => ({ b: YAM.game.budget, mor: YAM.game.player(k).dyn.morale }), re.kid);
    await closeModal();
    const qPersist = await page.evaluate(() => YAM.game.eventQueue.length === 1 && YAM.game.eventQueue[0].id === 'scoutvisit');
    await page.evaluate(() => { Object.assign(EVENTS_CFG, { DAD_CHANCE: 0, KNOCK_CHANCE: 0, SCOUT_CHANCE: 0, POOL_CHANCE: 0, ULTI_CHANCE: 0, BUS_CHANCE: 0, TRUANT_CHANCE: 0, BOOTS_CHANCE: 1 }); YAM.game.eventLog = []; });
    await page.evaluate(() => YAM.ui.autoSim());   // v2.5: END DAY is manual; debug auto-sim to the match
    await page.waitForFunction(() => !document.getElementById('talk-layer').hidden, null, { timeout: 10000 });
    const paused = await page.evaluate(() => ({ running: YAM.ui.cal.running, date: YAM.ui.cal.date, btn: document.getElementById('btn-sim').disabled }));
    await page.waitForTimeout(900); await shot('9-talk');
    await page.evaluate(() => { EVENTS_CFG.BOOTS_CHANCE = 0; });
    await talkClick('#talk-choices .talk-btn[data-i="1"]');
    const resumed = await page.evaluate(() => YAM.ui.cal.running);
    await page.waitForFunction(() => YAM.game.phase === 'matchday', null, { timeout: 20000 });
    // the time bomb goes off on the match day, BEFORE kick-off (v3.24: right after the morning briefing)
    const mdBrief = await page.evaluate(() => ({ brief: YAM.ui.briefing.isOpen, talk: !document.getElementById('talk-layer').hidden, wait: !!YAM.game.dayState().mdWait }));
    if (mdBrief.brief) await page.click('#mb-go');
    await page.waitForFunction(() => !document.getElementById('talk-layer').hidden, null, { timeout: 3000 });
    const fv = await page.evaluate(() => ({ id: YAM.game.pendingEvent?.id, top: YAM.game.pendingEvent?.cast.top, q: YAM.game.eventQueue.length, modal: !document.getElementById('modal-layer').hidden }));
    await talk(0);   // they start and play the full match
    const fv2 = await page.evaluate(t => {
      const s = YAM.game, bench = s.bench().find(b => b.available && b.archetype !== 'GK');
      return { showcase: t.every(id => s.isStarter(id) && s.player(id).hasFlag('Showcase')), modal: !document.getElementById('modal-layer').hidden,
        lock: bench ? s.swapPlayers(t.find(id => s.player(id).archetype !== 'GK') || t[0], bench.id) : 'showcase' };
    }, fv.top);
    check('scheduled scout visit: queue persisted (reload), fires on match day after the morning briefing (v3.24) and before the matchday dialog, top 3 start and are locked in', qPersist && fv.id === 'scoutvisit' && fv.top.length === 3 && fv.q === 0
      && mdBrief.brief && !mdBrief.talk && mdBrief.wait && !fv.modal && fv2.showcase && fv2.modal && fv2.lock === 'showcase', JSON.stringify({ qPersist, mdBrief, fv, fv2 }));
    await closeModal();
    // v3.22: the promise is decided on the card — break = out of the XI, full refund $300, morale −30, Parents −3
    const pr0 = await page.evaluate(() => {
      const s = YAM.game, p = s.squad.find(x => x.flags.includes('Promised_Start'));
      p.injuryDays = 0; p.awayDays = 0; p.suspensionMatches = 0; p.absentToday = null; p.dyn.morale = 60; s.rep.parents = 50;
      if (!s.isStarter(p.id)) { const sl = s.lineSwapSlot(p); if (sl) s.lineup[sl.i] = p.id; }   // he starts → the break must bench him
      s.budget = Math.max(s.budget, 400);
      const r = { id: p.id, b0: s.budget, starter: s.isStarter(p.id) };
      YAM.ui.events.fire('promise', s.calendar.date, { cast: { kid: p.id } });
      return r;
    });
    await talk(1);   // break
    const pr = await page.evaluate(k => {
      const s = YAM.game, p = s.player(k), r = { starter: s.isStarter(k), choice: p.promiseChoice, mor: p.dyn.morale, par: s.rep.parents, b: s.budget,
        diary: s.diary.some(d => d.key === 'ev.promise.break.diary'), led: Object.values(s.ledger).reduce((a, m) => a + (m.donation || 0), 0) };
      YAM.ui.checkPromises(); r.cleared = !p.flags.includes('Promised_Start') && !p.promiseChoice && !p.promiseBy;
      return r;
    }, pr0.id);
    check('event persists over reload; random event pauses + resumes calendar; v3.22 break the promise → out of the XI, refund $300 (ledger: donation), morale −30, Parents −3; flag cleared at kick-off',
      re.open && re2.b === re.b - 150 && re2.mor === 100 && !paused.running && paused.btn && resumed && pr0.starter && !pr.starter && pr.choice === 'break'
      && pr0.b0 - pr.b === 300 && pr.mor === 30 && pr.par === 47 && pr.diary && pr.led <= -300 && pr.cleared,
      JSON.stringify({ re, re2, paused, resumed, pr0, pr }));
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
      ex0.id === 'excuse' && ex0.n === 3 /* v3.25: + "While he's here: ask about…" */ && ex0.blocked && ex1.parents === 55 && ex1.absent === 'excused' && ex1.slot && ex1.done, JSON.stringify({ ex0, ex1 }));
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
      diary: YAM.game.diary.filter(d => /^scout\.(done|hurt)$/.test(d.key)).length}), [fv.top, ul]);
    check('after the match: showcase cleared (+ diary per kid), suspension served (2 → 1)', !after.showcase && after.sus === (ul === pr0.id ? 0 : 1)   /* v3.24: the promise test clears the promised kid's ban when he is the same kid */ && after.diary === fv.top.filter(id => id !== ex0.kid).length, JSON.stringify(after));
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
    await talkClick('#talk-choices .talk-btn.tone-green');
    Object.assign(v36d, await page.evaluate(() => { const p = YAM.game.player(window.__v36.mid);
      return { yesTag: p.tag === p.archetype, yesOop: p.outOfPositionMatches, yesMorale: p.dyn.morale, diary: YAM.game.diary.slice(-6).some(d => d.key === 'pr.yes.diary') ? 'pr.yes.diary' : YAM.game.diary.slice(-1)[0].key }; }));
    await page.evaluate(() => { const p = YAM.game.player(window.__v36.mid); p.outOfPositionMatches = 4; YAM.ui.events.fire('posreq', YAM.game.calendar.date, { cast: { kid: p.id } }); });
    await talkClick('#talk-choices .talk-btn.tone-red');
    Object.assign(v36d, await page.evaluate(() => { const p = YAM.game.player(window.__v36.mid);
      const r = { ordMorale: p.dyn.morale, ordDisc: p.psych.discipline, ordCd: p.positionHintCooldown, ordDiary: YAM.game.diary.slice(-6).some(d => d.key === 'pr.order.diary') ? 'pr.order.diary' : '', closed: document.getElementById('talk-layer').hidden };
      p.dyn.morale = window.__v36.morale; p.psych.discipline = window.__v36.disc; p.outOfPositionMatches = 0; p.positionHintCooldown = 0; return r; }));
    check('v3.6 practice scouting: save migration 0/0, slot/tag helper, observation lines (ok vs archetype hint, seeded, no numbers, EN+RU), mark ≤ 2, dayRoutine observes the marked kids',
      v36.migrate && v36.helper && v36.obs && v36.mark && v36.routine, JSON.stringify(v36));
    check('v3.6 out of position: streak +1 out of line, reset in natural line, cooldown −1, chance curve 25/40/55/75 → cap 85, seeded locker request, cooldown blocks',
      v36.streak.mid === 3 && v36.streak.def === 0 && v36.streak.cd === 1 && v36.streak.bench && v36.streak.slotMid === v36.wrongA && v36.streak.slotDef === v36.defA
      && v36.curve === '0,0.25,0.4,0.55,0.75,0.8,0.85' && v36.roll && v36.cooldown, JSON.stringify(v36.streak) + ' ' + v36.curve);
    check('v3.6 request dialogue: 3 choices (green/gray/red); yes = tag → archetype, streak 0, morale +5, diary; order = discipline +1, morale −8, cooldown 2',
      v36d.open && v36d.n === 4 && v36d.tones === 'green,gray,red,gray' /* v3.25: + the free question */ && v36d.yesTag && v36d.yesOop === 0 && v36d.yesMorale === 55 && v36d.diary === 'pr.yes.diary'
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
    await talkClick('#talk-choices .talk-btn.tone-green');
    Object.assign(v38d, await page.evaluate(() => { const s = YAM.game, b = s.player(window.__v38.b);
      const r = { yesCap: s.duties.captain, yesMor: b.dyn.morale, yesDiary: s.diary.slice(-4).some(d => d.key === 'cr.yes.diary') };
      s.duties.captain = b.id; b.dyn.morale = 50; YAM.ui.events.fire('capresign', s.calendar.date, { cast: { kid: b.id } }); return r; }));
    await talkClick('#talk-choices .talk-btn.tone-red');
    Object.assign(v38d, await page.evaluate(() => { const s = YAM.game, b = s.player(window.__v38.b);
      const r = { noCap: s.duties.captain === b.id, noMor: b.dyn.morale, noDisc: b.psych.discipline, noPress: b.capPressure, noHold: s.capt.hold };
      const a = s.player(window.__v38.a), m = s.player(window.__v38.k4);   // initiative A: captain k4 (leadership 9) about b
      s.duties.captain = m.id; m.dyn.morale = 50; b.dyn.morale = 50; b.outOfPositionMatches = 3; b.tag = b.archetype === 'FWD' ? 'DEF' : 'FWD';
      YAM.ui.events.fire('capobs', s.calendar.date, { cast: { kid: m.id, mate: b.id } }); return r; }));
    v38d.obsDlg = await talk38();
    await talkClick('#talk-choices .talk-btn.tone-green');
    Object.assign(v38d, await page.evaluate(() => { const s = YAM.game, b = s.player(window.__v38.b), m = s.player(window.__v38.k4), a = s.player(window.__v38.a), c = s.player(window.__v38.c);
      const r = { obsTag: b.tag === b.archetype, obsOop: b.outOfPositionMatches, obsMor: [m.dyn.morale, b.dyn.morale].join(), obsCd: s.capt.initUntil === isoAdd(s.calendar.date, 7) };
      s.duties.captain = a.id; YAM.ui.events.fire('capbench', s.calendar.date, { cast: { kid: a.id, mate: c.id } }); return r; }));
    v38d.benchDlg = await talk38();
    await talkClick('#talk-choices .talk-btn.tone-green');
    Object.assign(v38d, await page.evaluate(() => { const s = YAM.game, c = s.player(window.__v38.c);
      const r = { promised: c.promisedPitchTime === true }; c.promisedPitchTime = false;
      c.leadership = 10; c.captainReactionCooldown = 0; c.dyn.morale = 50; s.duties.captain = null;
      r.fired = YAM.ui.assignDuty('captain', c.id); return r; }));
    v38d.midDlg = await talk38();
    await talkClick('#talk-choices .talk-btn.tone-green');
    Object.assign(v38d, await page.evaluate(() => { const s = YAM.game, c = s.player(window.__v38.c), b = s.player(window.__v38.b);
      const r = { midCap: s.duties.captain === c.id, midMor: c.dyn.morale };
      b.leadership = 4; b.captainReactionCooldown = 0; b.dyn.morale = 50; YAM.ui.assignDuty('captain', b.id); return r; }));
    v38d.lowDlg = await talk38();
    await talkClick('#talk-choices .talk-btn.tone-gray');
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
      v38d.resign.open && v38d.resign.tones === 'green,gray,red,gray' /* v3.25: + the free question */ && v38d.resign.text.includes(v38.aName) && v38d.yesCap === null && v38d.yesMor === 58 && v38d.yesDiary
      && v38d.noCap && v38d.noMor === 40 && v38d.noDisc === 11 && v38d.noPress === 1 && v38d.noHold === 1
      && v38d.obsDlg.tones === 'green,gray,red,gray' && v38d.obsTag && v38d.obsOop === 0 && v38d.obsMor === '53,53' && v38d.obsCd
      && v38d.benchDlg.tones === 'green,gray,red,gray' && v38d.promised && v38d.fired && v38d.midDlg.tones === 'green' && v38d.midCap && v38d.midMor === 52
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
      const s = YAM.game, keep = { date: s.calendar.date, week: s.week, today: s.today, ex: s.excusesOff, rep: { ...s.rep }, we: s.worldEvent, wl: s.worldLast, coh: s.cohesion, kids: s.squad.map(p => [p.energy, p.psych.discipline, p.injuryDays, p.suspensionMatches, p.awayDays, p.dyn.morale]) };
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
      Object.assign(s.rep, keep.rep); s.week = keep.week; s.today = keep.today; s.calendar.date = keep.date; s.excusesOff = keep.ex; s.worldEvent = keep.we; s.worldLast = keep.wl; s.cohesion = keep.coh;
      return { per, heavy, ch, done, label: L.t('lr.short.overload') };
    });
    check('v3.13 attendance curve: 5 trainings → no overload on the 1st–2nd, \'overload\' absences on the 3rd–5th (curve 0.7/0.5/0.3 ± discipline / tiredness, clamp 0.05), seeded, unavailable, no skipped_training / truant / roll call; Sunday ≥ 4 trainings → Parents −2',
      ov.per.length === 5 && ov.per.map(x => x.k).join() === '0,1,2,3,4' && ov.per[0].over === 0 && ov.per[1].over === 0 && ov.per.slice(2).reduce((a, x) => a + x.over, 0) > 0
      && ov.per[4].over >= 1 && ov.per.every(x => !x.skip && !x.truant && x.unavail && x.noCall && x.again && x.other === 0) && ov.done === 5
      && ov.ch.join() === '0.7,0.55,0.65,0.05,1' && ov.heavy.r === 'heavy' && ov.heavy.parents === -2 && ov.heavy.board === 0 && ov.heavy.diary === 'week.heavy' && /уроков|school/.test(ov.label),
      JSON.stringify(ov));
    // v3.13: a week with no training at all → Sunday (through the real daily hook): Board −2, Parents −2, "the gym stood empty"
    const ew = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, keep = { date: s.calendar.date, week: s.week, today: s.today, rep: { ...s.rep }, we: s.worldEvent, wl: s.worldLast, coh: s.cohesion, kids: s.squad.map(p => [p.energy, p.dyn.sharpness, p.dyn.morale, p.injuryDays, p.awayDays]) };
      s.calendar.date = '2003-03-10'; s.week = null; s.today = null; s.rep.parents = 50; s.rep.board = 50;
      s.weekState(); s.worldEvent = null; s.confirmWeek();   // empty plan (v3.14: and no world event)
      const b0 = s.rep.board, p0 = s.rep.parents, R = Math.random; Math.random = () => 0.5;
      let tr = 0;
      for (let i = 0; i < 7; i++) { const d = isoAdd('2003-03-10', i); s.calendar.date = d; if (ui.cal.dailyHooks[0](d)?.key !== 'cal.rest') tr++; }
      Math.random = R;
      const r = { tr, board: s.rep.board - b0, parents: s.rep.parents - p0, diary: s.diary.some(d => d.key === 'week.empty' && d.date === '2003-03-16'), text: L.t('week.empty'), both: !!(I18N.en['week.empty'] && I18N.ru['week.empty'] && I18N.en['pl.warn.heavy'] && I18N.ru['pl.warn.over']) };
      s.squad.forEach((p, i) => { [p.energy, p.dyn.sharpness, p.dyn.morale, p.injuryDays, p.awayDays] = keep.kids[i]; });
      Object.assign(s.rep, keep.rep); s.week = keep.week; s.today = keep.today; s.calendar.date = keep.date; s.worldEvent = keep.we; s.worldLast = keep.wl; s.cohesion = keep.coh;
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
      YAM.ui.debug.close(); YAM.ui.briefing.open();   // v3.17: on Monday this is PLANNER.EXE with the briefing block inside
      const news = [...document.querySelectorAll('#pl-brief .pl-world')].map(x => x.textContent), all = news[0] || '';
      const re = s.buildWorldEvent(s.worldRow('athletics'), e.weekStart), re2 = s.buildWorldEvent(s.worldRow('athletics'), e.weekStart);   // (3) seeded: same week + squad → same picks
      const elig = s.squad.filter(p => !(p.injuryDays > 0) && !(p.suspensionMatches > 0) && !(p.awayDays > 0)), sp = p => p.physical.speed + p.physical.acceleration;
      const top = [...elig].sort((a, b) => sp(b) - sp(a) || a.id.localeCompare(b.id)).slice(0, 4).map(p => p.id);
      return { e, msg, open: YAM.ui.planner.isOpen && !YAM.ui.briefing.isOpen, news, world: news.length, dayWord: L.t('world.on.' + weekKey(e.days[0])),
        noNames: e.playerIds.every(id => { const p = s.player(id); return !all.includes(p.surname) && !all.includes(L.name(p.surname)); }),
        same: JSON.stringify(re) === JSON.stringify(e) && JSON.stringify(re2) === JSON.stringify(e), wrongAtMost1: e.playerIds.filter(id => !top.includes(id)).length <= 1 };
    });
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
    await page.click('#btn-sim');   // [ CONTINUE ] → Monday 4 Nov: the month's first stop — v3.17: ONE window, PLANNER.EXE with the cash block
    const k1 = await page.evaluate(() => {
      const t = [...document.querySelectorAll('#pl-ks-report tr')].map(r => [r.dataset.cat, r.querySelector('td + td').textContent.trim()]);
      return { date: YAM.game.calendar.date, kassa: YAM.ui.kassa.isOpen, brief: YAM.ui.briefing.isOpen, planner: YAM.ui.planner.isOpen, blk: YAM.ui.dayBlockers()[0],
        z: +getComputedStyle(document.getElementById('planner-view')).zIndex, rows: Object.fromEntries(t), radios: document.querySelectorAll('#pl-ks-levels input[type=radio]').length,
        checked: document.querySelector('#pl-ks-levels input:checked')?.value, budget: document.getElementById('pl-ks-report').textContent.includes('$400'), top: YAM.ui.topLayer()?.el.id,
        title: document.getElementById('pl-kassa-h').textContent, block: !document.getElementById('pl-kassa').hidden, parents: YAM.game.rep.parents };
    });
    await page.click('#pl-ks-levels input[value="high"]');
    await page.evaluate(() => { YAM.game.setWeekPlan('tue', 'match'); YAM.ui.planner.render(); });
    await page.click('#pl-confirm');   // one button: the fee level + the plan
    const k2 = await page.evaluate(ids => { const s = YAM.game, f = s.fees;
      return { kassa: YAM.ui.kassa.isOpen, brief: YAM.ui.briefing.isOpen, planner: YAM.ui.planner.isOpen, confirmed: s.weekState().confirmed, plan: s.weekState().plan.tue,
        month: f.month, level: f.level, amount: f.amount, parents: s.rep.parents, owed: ids.every(id => f.status[id] === 'owed'),
        carry: f.carry[ids[2]], due: s.feeDue(ids[2]), lost: s.diary.some(d => d.key === 'fee.lost' && d.date === '2002-10-31' && d.vars.n === 2), blk: YAM.ui.dayBlockers()[0] || null }; }, k0.ids);
    check('v3.15 → v3.17 cash desk on a Monday: the month\'s first stop is ONE window — PLANNER.EXE (z 50, Esc layer) with the cash block (last month\'s ledger rows + total + budget, Low / Normal (default) / High); one [ CONFIRM WEEK ] → level + Parents −3 once, everyone owes, Oct unpaid lost (diary count), half carried, plan saved',
      /CONTINUE|ПРОДОЛЖИТЬ/.test(k0.label) && k1.date === '2002-11-04' && !k1.kassa && !k1.brief && k1.planner && k1.block && k1.blk === 'week' && k1.z === 50 && k1.top === 'planner-view' && /Касса|Cash/.test(k1.title)
      && k1.rows.fee === '+$120' && k1.rows.grant === '+$50' && k1.rows.donation === '+$20' && k1.rows.rent === '−$100' && k1.rows.event === '−$30' && k1.rows.total === '+$60' && k1.budget
      && k1.radios === 3 && k1.checked === 'normal' && !k2.kassa && !k2.brief && !k2.planner && k2.confirmed && k2.plan === 'match' && k2.month === '2002-11' && k2.level === 'high' && k2.amount === 15 && k2.parents === k1.parents - 3 && k2.owed
      && k2.carry === 5 && k2.due === 20 && k2.lost && k2.blk === null, JSON.stringify({ k0: k0.label, k1, k2 }));
    // (3) the fee day = the first training of the month: briefing line, Fees panel, paid kids add 'fee' money, free [ Remind ]
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
          s.fees = { month: '2002-11', level, amount: FINANCE.FEES[level].fee, started: false, status: Object.fromEntries(s.squad.map(p => [p.id, 'owed'])), reminded: {}, reason: {}, carry: {}, next: {}, got: {}, trn: FINANCE.MIN_TRAININGS };   // v3.21: a month with enough trainings (the level is measured, not the training rule)
          paid += s.collectFees(date, {}).length; n += s.squad.length; }
        return paid / n; };
      out.normal = +rate('normal').toFixed(2); out.high = +rate('high').toFixed(2); out.low = +rate('low').toFixed(2);
      out.chances = [feeChance('poor', 'first', 'normal'), feeChance('poor', 'first', 'high'), feeChance('rich', 'reminded', 'low'), feeChance('middle', 'later', 'high')].map(v => +v.toFixed(3));
      s.squad.forEach((p, i) => { p.wealth = keep.w[i]; }); s.fees = keep.fees; s.ledger = JSON.parse(keep.ledger); s.budget = keep.budget; s.calendar.date = '2002-11-05';
      // wealth: same id → same value; distribution; independent of skills; old saves / AI / pool all have one
      const ids = Array.from({ length: 4000 }, (_, i) => 'w' + i), ws = ids.map(id => Player.rollWealth(id));
      out.share = WEALTH.KEYS.map(k => +(ws.filter(w => w === k).length / ids.length).toFixed(2));
      out.det = ids.slice(0, 50).every((id, i) => Player.rollWealth(id) === ws[i]);
      out.all = [...s.globalPlayers, ...s.league.teams.filter(t => !t.user).flatMap(t => s.league.roster(t, new Set()))].every(p => WEALTH.KEYS.includes(p.wealth) && (p.wealth === Player.rollWealth(p.id) || (p.twinId && p.wealth === Player.rollWealth(p.twinId))));   // v3.25: a twin shares his brother's family
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
    // v3.16 LESSONS — (1) planning reserves 1 AP, clearing refunds it, one lesson per kid a week, none on a training day / without AP
    const ls0 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui;
      for (const v of ['locker', 'planner', 'briefing', 'kassa']) if (ui[v].isOpen) ui[v].layer.hidden = true;
      ui.events.enabled = false; s.excusesOff = true; s.pendingEvent = null; ui.modal.close();
      s.phase = 'calendar'; s.calendar.date = '2002-11-11'; s.week = null; s.today = null; s.away = null;   // a fresh Monday
      if (s.kassaDue()) s.confirmKassa('normal');
      s.weekState(); s.worldEvent = null; s.dayState().briefed = true;
      const w = s.week; w.ap = 3;
      const [a, b, c] = s.squad.filter(p => p.archetype !== 'GK').map(p => p.id);
      s.setWeekPlan('tue', 'match');
      const out = { ap0: w.ap };
      out.r1 = s.setLesson('wed', a, 'technical'); out.ap1 = w.ap;
      out.same = s.setLesson('thu', a, 'physical'); out.apSame = w.ap;                 // same kid twice → refused
      out.train = s.setLesson('tue', b, 'tactical');                                   // team training that day → refused
      out.r2 = s.setLesson('thu', b, 'tactical'); out.ap2 = w.ap;
      out.focus = s.setLesson('thu', b, 'physical') === null && w.lessons.thu.focus === 'physical' && w.ap === out.ap2;   // changing the focus is free
      out.clear = s.setLesson('thu', null); out.ap3 = w.ap; out.thu = w.lessons.thu;   // re-planned away → refund
      w.ap = 0; out.noAp = s.setLesson('fri', c, 'technical'); w.ap = out.ap3;
      out.trRefund = (() => { s.setLesson('fri', c, 'technical'); const x = w.ap; s.setWeekPlan('fri', 'tech'); const r = w.ap === x + 1 && !w.lessons.fri; s.setWeekPlan('fri', null); return r; })();
      ui.planner.open();   // the planner shows the slot + "left after the plan"
      out.ui = { slots: document.querySelectorAll('#pl-grid .pl-lesson').length, on: document.querySelectorAll('#pl-grid .pl-lesson.on').length,
        left: document.querySelector('#pl-head .pl-apleft')?.textContent || '', tag: !!document.querySelector('#pl-grid .pl-lesson .tb-ap') };
      ui.planner.layer.hidden = true;
      s.confirmWeek();
      out.locked = s.setLesson('mon', c, 'technical');   // today after confirming → locked (same rule as trainings)
      return { out, a, b, c };
    });
    const L0 = ls0.out;
    check('v3.16 lessons: planning reserves 1 AP, clearing refunds it, focus change free, same kid twice / training day / 0 AP refused, a training replacing a lesson refunds it; the planner shows the slots + AP left after the plan',
      L0.r1 === null && L0.ap1 === L0.ap0 - 1 && L0.same === 'perKid' && L0.apSame === L0.ap1 && L0.train === 'training' && L0.r2 === null && L0.ap2 === L0.ap1 - 1 && L0.focus
      && L0.clear === null && L0.ap3 === L0.ap2 + 1 && L0.thu === null && L0.noAp === 'noAp' && L0.trRefund && L0.locked === 'locked'
      && L0.ui.slots === 4 && L0.ui.on === 1 && L0.ui.left.includes(String(L0.ap3)) && L0.ui.tag, JSON.stringify(L0));
    // (2) cancelled for an injured / world-event-away kid → AP refunded + diary; (3) a lesson: diary, condition −5, growth only in the chosen group
    const ls1 = await page.evaluate(({ a, b, c }) => {
      const s = YAM.game, w = s.week, out = {};
      // injured kid on Wednesday
      s.calendar.date = '2002-11-11'; w.confirmed = false; w.lessons = GameState.noLessons(); w.ap = 5;
      s.setLesson('wed', a, 'technical'); s.setLesson('thu', b, 'tactical'); s.setLesson('fri', c, 'technical'); w.confirmed = true;
      const ap0 = w.ap, A = s.player(a), B = s.player(b), C = s.player(c);
      A.injuryDays = 3; s.worldEvent = { id: 'athletics', tier: 2, days: ['2002-11-14'], playerIds: [b], weekStart: '2002-11-11' };
      s.calendar.date = '2002-11-13'; s.today = null; const r1 = s.dayRoutine('2002-11-13'), apAfter1 = w.ap;
      s.calendar.date = '2002-11-14'; s.today = null; const r2 = s.dayRoutine('2002-11-14');
      out.inj = { res: r1.lesson, ap: apAfter1 === ap0 + 1, diary: s.diary.some(d => d.date === '2002-11-13' && d.key === 'lesson.cancel') };
      out.away = { res: r2.lesson, ap: w.ap === ap0 + 2, diary: s.diary.some(d => d.date === '2002-11-14' && d.key === 'lesson.cancel') };
      s.worldEvent = null; A.injuryDays = 0;
      // Friday: C's technique lesson with a forced seed (growth roll always succeeds), room left everywhere
      const keep = { tac: { ...C.tactical }, phy: { ...C.physical }, tech: { ...C.technical }, gains: { ...C.gains }, pot: C.psych.potential, energy: C.energy };
      C.gains = {}; C.psych.potential = 10; for (const k in C.technical) C.technical[k] = Math.min(C.technical[k], 12);
      const MULT = LESSON.MULT; LESSON.MULT = 1000;   // forced: the growth roll always succeeds (the skill pick stays seeded)
      C.energy = 60; s.calendar.date = '2002-11-15'; s.today = null;
      const tech0 = JSON.stringify(C.technical), r3 = s.dayRoutine('2002-11-15');
      LESSON.MULT = MULT;
      const grown = Object.keys(C.technical).filter(k => C.technical[k] !== JSON.parse(tech0)[k]);
      out.lesson = { res: r3.lesson, energy: C.energy, grown, gain: Object.values(C.gains).reduce((x, y) => x + y, 0),
        others: JSON.stringify(C.tactical) === JSON.stringify(keep.tac) && JSON.stringify(C.physical) === JSON.stringify(keep.phy),
        diary: s.diary.some(d => d.date === '2002-11-15' && d.key === 'lesson.done'), improved: s.diary.some(d => d.date === '2002-11-15' && d.key === 'lesson.improved'),
        text: YAM.ui.entryText({ ...s.diary.find(d => d.date === '2002-11-15' && d.key === 'lesson.done'), r: 0 }), done: w.lessons.fri.done, noNum: true };
      const clue = s.diary.find(d => d.key === 'lesson.clue');
      if (clue) out.lesson.noNum = !/\d/.test(YAM.ui.entryText({ ...clue, r: 0 }).replace(/^\S+\s/, ''));
      Object.assign(C, { tactical: keep.tac, physical: keep.phy, technical: keep.tech, gains: keep.gains }); C.psych.potential = keep.pot; C.energy = keep.energy;
      out.det = (() => { const x = []; for (let i = 0; i < 2; i++) x.push(seeded('2002-11-15#lesson#' + c)()); return x[0] === x[1]; })();
      out.noRandom = !/Math\.random/.test(GameState.prototype.runLesson.toString() + GameState.prototype.setLesson.toString());
      return out;
    }, ls0);
    check('v3.16 lesson cancelled for an injured kid / a kid away at a world event → AP refunded + diary line (no CONTINUE stop)',
      ls1.inj.res === 'cancel' && ls1.inj.ap && ls1.inj.diary && ls1.away.res === 'cancel' && ls1.away.ap && ls1.away.diary, JSON.stringify({ inj: ls1.inj, away: ls1.away }));
    check('v3.16 lesson on the day: diary "Evening lesson with <name> (technique)", condition −5 (after the +10 rest), forced seed → +1 in ONE technical skill, other groups untouched; seeded, no Math.random, clues without numbers',
      ls1.lesson.res === 'grew' && ls1.lesson.energy === 65 && ls1.lesson.grown.length === 1 && ls1.lesson.gain === 1 && ls1.lesson.others && ls1.lesson.diary && ls1.lesson.improved
      && /\(.+\)/.test(ls1.lesson.text) && ls1.lesson.done && ls1.lesson.noNum && ls1.det && ls1.noRandom, JSON.stringify(ls1.lesson));
    // (4) boots via DEBUG: 0 AP → the [1 AP] option is disabled; ≥ 1 AP → exactly 1 AP, $0, morale +5 (no agility loss)
    await page.evaluate(() => { const s = YAM.game; s.weekState().ap = 0; s.budget = 300; s.eventLog = []; YAM.ui.debug.open(); YAM.ui.debug.tab = 'god'; YAM.ui.debug.render(); });
    await page.click('#debug-body [data-cheat="fire:boots"]');
    await page.waitForSelector('#talk-layer:not([hidden]) .talk-btn');
    await finishTyping();
    const ap0 = await page.evaluate(() => { const b = document.querySelector('#talk-choices .talk-btn[data-i="2"]');
      return { n: document.querySelectorAll('#talk-choices .talk-btn').length, dis: b.disabled, tag: b.querySelector('.tb-ap')?.textContent, why: b.querySelector('.tb-why')?.textContent || '' }; });
    await page.evaluate(() => { YAM.game.weekState().ap = 2; YAM.ui.events.open(); });   // the wallet refilled → re-render the open dialogue
    await finishTyping();
    const ap1 = await page.evaluate(() => { const pe = YAM.game.pendingEvent, k = YAM.game.player(pe.cast.kid); k.dyn.morale = 40;
      return { dis: document.querySelector('#talk-choices .talk-btn[data-i="2"]').disabled, kid: k.id, agi: k.physical.agility, b: YAM.game.budget }; });
    await talk(2);
    const apM = await page.evaluate(() => ({ step: YAM.game.pendingEvent?.step, n: document.querySelectorAll('#talk-choices .talk-btn').length, ap: YAM.game.ap }));   // v3.24: the result line first
    await talk(0);
    const ap2 = await page.evaluate(k => { const s = YAM.game, p = s.player(k); return { ap: s.ap, b: s.budget, m: p.dyn.morale, agi: p.physical.agility, closed: !s.pendingEvent,
      diary: s.diary.slice(-3).some(d => d.key === 'ev.boots.c.diary') }; }, ap1.kid);
    check('v3.16 [1 AP] in Torn Boots (fired via DEBUG): 0 AP → disabled with a reason; with AP → exactly 1 AP, $0, morale +5, no agility loss',
      ap0.n === 3 && ap0.dis && /AP|ОД/.test(ap0.tag) && ap0.why.length > 5 && !ap1.dis && ap2.ap === 1 && ap2.b === ap1.b && ap2.m === 45 && ap2.agi === ap1.agi && ap2.closed && ap2.diary
      && apM.step === 'seniors' && apM.n === 1 && apM.ap === 1,
      JSON.stringify({ ap0, ap1, apM, ap2 }));
    // (5) knock [1 AP] → −$35, injury 8 days, 1 AP
    await page.evaluate(() => { const s = YAM.game; s.weekState().ap = 1; s.budget = 300; s.squad.forEach(p => { p.injuryDays = 0; p.suspensionMatches = 0; p.awayDays = 0; p.absentToday = null; }); YAM.ui.events.fire('knock'); });
    await page.waitForSelector('#talk-layer:not([hidden]) .talk-btn');
    const kn0 = await page.evaluate(() => ({ kid: YAM.game.pendingEvent?.cast.kid, n: document.querySelectorAll('#talk-choices .talk-btn').length }));
    await talk(2);
    const knM = await page.evaluate(() => ({ step: YAM.game.pendingEvent?.step, n: document.querySelectorAll('#talk-choices .talk-btn').length, ap: YAM.game.ap }));   // v3.24: the result line first
    await talk(0);
    const kn1 = await page.evaluate(k => ({ b: YAM.game.budget, days: YAM.game.player(k).injuryDays, ap: YAM.game.ap, ledger: YAM.game.ledger[YAM.game.calendar.date.slice(0, 7)]?.event }), kn0.kid);
    check('v3.16 [1 AP] in Knock: −$35 (booked as event), injury 8 days, 1 AP spent',
      kn0.n === 3 && kn1.b === 265 && kn1.days === 8 && kn1.ap === 0 && knM.step === 'medic' && knM.n === 1, JSON.stringify({ kn0, knM, kn1 }));
    /* ---------- v3.17 "SILENCE" ---------- */
    // (1) typewriter: while the line types every choice is disabled; a (forced) click picks nothing; Space finishes the line only
    await page.evaluate(() => { const s = YAM.game; s.weekState().ap = 1; s.budget = 300; s.eventLog = []; s.squad.forEach(p => { p.injuryDays = 0; p.suspensionMatches = 0; p.awayDays = 0; p.absentToday = null; }); YAM.ui.events.fire('knock'); });
    await page.waitForSelector('#talk-layer:not([hidden]) .talk-btn');
    const ty0 = await page.evaluate(() => { const v = YAM.ui.events.view, bs = [...document.querySelectorAll('#talk-choices .talk-btn')];
      return { typing: !!v.typer, cls: document.getElementById('talk-layer').classList.contains('talk-typing'), dis: bs.every(b => b.disabled), n: bs.length,
        full: document.getElementById('talk-text').textContent === v.full }; });
    await page.click('#talk-choices .talk-btn[data-i="1"]', { force: true });   // must do nothing
    const ty1 = await page.evaluate(() => ({ still: !!YAM.game.pendingEvent && !document.getElementById('talk-layer').hidden }));
    await page.keyboard.press(' ');
    const ty2 = await page.evaluate(() => { const v = YAM.ui.events.view, pe = YAM.game.pendingEvent, kid = YAM.game.player(pe.cast.kid), snitch = YAM.game.player(pe.cast.snitch);
      return { typing: !!v.typer, still: !!pe, en: [...document.querySelectorAll('#talk-choices .talk-btn')].filter(b => !b.disabled).length,
        full: document.getElementById('talk-text').textContent === v.full, name: document.getElementById('talk-name').textContent, kid: L.name(kid.name), snitch: L.name(snitch.name),
        text: document.getElementById('talk-text').textContent }; });
    await talk(1);   // ice
    check('v3.17 typewriter: choices disabled (Win98 grey) while the line types, a forced click picks nothing, Space only finishes the line → then all choices active',
      ty0.typing && ty0.cls && ty0.dis && ty0.n === 3 && !ty0.full && ty1.still && !ty2.typing && ty2.still && ty2.en === 3 && ty2.full, JSON.stringify({ ty0, ty1, ty2 }));
    check('v3.17 bug: the injury event shows the injured kid himself (portrait + name match the text); the teammate who helped is named in the text',
      ty2.name === ty2.kid && ty2.text.includes(ty2.kid) && ty2.text.includes(ty2.snitch), JSON.stringify(ty2));
    // (2) bugs: match-day excuse wording, ulti [1 AP] family visit, namesakes in the match log, interceptions in the coach's note
    const bg = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, kid = s.squad.find(p => p.archetype !== 'GK'), out = {};
      const ph = s.phase; s.phase = 'matchday';
      ui.events.fire('excuse', undefined, { cast: { kid: kid.id } }); ui.events.view.finishTyping();
      out.matchStay = [...document.querySelectorAll('#talk-choices .tb-label')].map(x => x.textContent).includes(L.t('ex.stayMatch'));
      ui.events.choose(ui.events.view.choices[0]);   // go home
      s.phase = ph;
      ui.events.fire('excuse', undefined, { cast: { kid: kid.id } }); ui.events.view.finishTyping();
      out.trainStay = [...document.querySelectorAll('#talk-choices .tb-label')].map(x => x.textContent).includes(L.t('ex.stay'));
      ui.events.choose(ui.events.view.choices[0]);
      kid.absentToday = null;
      // namesakes: surname alone → initial + surname → + the club's first word
      const eng0 = ui.engine, P = (id, name) => ({ id, name, surname: name.split(' ').pop() });
      const a = P('t1', 'Callum Fletcher'), b = P('t2', 'Jake Fletcher'), c = P('t3', 'Jordan Dunn'), d = P('t4', 'Jamie Dunn'), e = P('t5', 'Ethan Walsh');
      ui.engine = { sides: [{ name: 'Ashford Rovers', all: [a, c] }, { name: 'Canal Street Youth', all: [b, d, e] }] };
      out.names = [a, b, c, d, e].map(p => ui.logName(p));
      ui.engine = eng0;
      // v3.18: interceptions are evidence for a "duel" clue (the note no longer says "nothing stood out" after 23 of them)
      out.note = clueEvidence('duel', { passOk: 5, passFail: 3, tackles: 0, tacklesLost: 2, dribbleOk: 0, dribbleFail: 0, intercepts: 23, goals: 0, saves: 0 });
      out.noteLow = clueEvidence('duel', { passOk: 5, passFail: 3, tackles: 0, tacklesLost: 2, dribbleOk: 0, dribbleFail: 0, intercepts: 0, goals: 0, saves: 0 });
      return out;
    });
    await page.evaluate(() => { const s = YAM.game; s.weekState().ap = 1; const k = s.squad.find(p => p.archetype !== 'GK'); k.psych.discipline = 5; k.dyn.morale = 50; s.eventLog = []; YAM.ui.events.fire('ulti', undefined, { cast: { kid: k.id } }); });
    await page.waitForSelector('#talk-layer:not([hidden]) .talk-btn');
    await finishTyping();
    const ul0 = await page.evaluate(() => { const b = document.querySelector('#talk-choices .talk-btn[data-i="2"]'), k = YAM.game.player(YAM.game.pendingEvent.cast.kid);
      return { n: document.querySelectorAll('#talk-choices .talk-btn').length, tag: b?.querySelector('.tb-ap')?.textContent || '', dis: b?.disabled, kid: k.id, d: k.psych.discipline, m: k.dyn.morale }; });
    await talk(2);
    const ulM = await page.evaluate(() => ({ step: YAM.game.pendingEvent?.step, n: document.querySelectorAll('#talk-choices .talk-btn').length, ap: YAM.game.ap }));   // v3.24: the result line first
    await talk(0);
    const ul1 = await page.evaluate(k => { const s = YAM.game, p = s.player(k); return { ap: s.ap, d: p.psych.discipline, m: p.dyn.morale, sus: p.suspensionMatches, diary: s.diary.slice(-3).some(x => x.key === 'ev.ulti.e.diary') }; }, ul0.kid);
    check('v3.17 bugs: match-day excuse says "Stay and play" (training days keep "Stay and train"); the assistant\'s truancy report has the [1 AP] family visit (discipline +1, morale +3, no ban); namesakes in the match log get an initial (and the club when even that clashes); 23 interceptions → "read the game" note',
      bg.matchStay && bg.trainStay && ul0.n === 3 && /AP|ОД/.test(ul0.tag) && !ul0.dis && ul1.ap === 0 && ul1.d === ul0.d + 1 && ul1.m === ul0.m + 3 && !ul1.sus && ul1.diary && ulM.step === 'visit' && ulM.n === 1
      && /^\S\. /.test(bg.names[0]) && /^\S\. /.test(bg.names[1]) && bg.names[0] !== bg.names[1] && /\(/.test(bg.names[2]) && /\(/.test(bg.names[3]) && bg.names[2] !== bg.names[3] && !/[.(]/.test(bg.names[4])
      && bg.note === true && bg.noteLow === false, JSON.stringify({ bg, ul0, ul1 }));
    // (3) the match window at ~800 px: [ START MATCH ] visible (not under the pitch)
    await page.setViewportSize({ width: 800, height: 600 });
    await page.evaluate(() => { document.getElementById('win-match').classList.add('open'); });   // (no match today: just lay the window out)
    await page.waitForTimeout(200);
    const narrow = await page.evaluate(() => { const b = document.getElementById('btn-start'), r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { w: Math.round(r.width), top: hit === b || b.contains(hit), cols: getComputedStyle(document.querySelector('#win-match .match-body')).gridTemplateColumns.split(' ').length }; });
    await page.setViewportSize({ width: 1440, height: 860 });
    await page.evaluate(() => { document.getElementById('win-match').classList.remove('open'); YAM.ui.show('dash'); });
    check('v3.17 bug: at 800×600 the match window is one column and [ START MATCH ] is visible on top', narrow.top && narrow.w > 60 && narrow.cols === 1, JSON.stringify(narrow));
    // (4) the briefing: only with news; important first, routine collapsed; 14-day mute (never for money / rep / injuries…)
    const nw = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, out = {};
      for (const v of ['locker', 'planner', 'briefing', 'kassa']) if (ui[v].isOpen) ui[v].layer.hidden = true;
      ui.events.enabled = false; s.excusesOff = true; s.pendingEvent = null; s.phase = 'calendar';
      s.calendar.date = '2002-11-19'; s.week = null; s.today = null; s.worldEvent = null; s.weekState();   // Tuesday 19 Nov
      s.setWeekPlan('tue', 'match'); s.setWeekPlan('thu', 'match'); s.confirmWeek();
      const k = s.squad[1], date = s.calendar.date;
      s.newsSeen = {}; s.away = [{ date: '2002-11-18', key: 'cal.rest', vars: { n: 10 } }];
      out.quiet = !ui.briefing.hasNews();
      ui.briefing.open();
      out.silent = { brief: ui.briefing.isOpen, briefed: !!s.dayState().briefed, locker: ui.locker.isOpen, away: s.away };
      ui.locker.layer.hidden = true; s.today = null;
      s.away = [{ date: '2002-11-18', key: 'cal.rest', vars: { n: 10 } }, { date: '2002-11-18', key: 'tr.hurt', vars: { s: { list: [{ pid: k.id }] } }, cls: 'ev' }, { date: '2002-11-18', key: 'cal.rest', vars: { n: 10 } }];
      out.news = ui.briefing.hasNews();
      ui.briefing.open();
      const ul = document.getElementById('mb-away');
      out.open = ui.briefing.isOpen;
      out.first = ul.firstElementChild?.textContent || '';
      out.routine = { n: ul.querySelectorAll('.mb-routine li').length, closed: !!ul.querySelector('.mb-routine details:not([open])'), label: ul.querySelector('.mb-routine summary')?.textContent || '' };
      ui.briefing.go();   // marks what he read
      out.after = { locker: ui.locker.isOpen, seen: Object.keys(s.newsSeen) };
      ui.locker.layer.hidden = true;
      const obs = { date, key: 'obs.ok.0', vars: { k: { pid: k.id } } }, rep = { date, key: 'rep.parentsGift', vars: { m: '$5' } };
      s.markNews([obs, rep], '2002-11-01');
      out.mute = { d13: s.newsFresh(obs, '2002-11-14'), d14: s.newsFresh(obs, '2002-11-15'), rep: s.newsFresh(rep, '2002-11-02'), other: s.newsFresh({ ...obs, vars: { k: { pid: s.squad[2].id } } }, '2002-11-02') };
      s.save(); out.saved = JSON.parse(localStorage.getItem(GameState.KEY)).newsSeen && true;
      return out;
    });
    check('v3.17 briefing: routine alone → no window (briefed, straight to the locker); an injury line → the window opens, important first, routine collapsed "[+] Routine (N)"; what he read is muted 14 days (another kid / money / rep never muted), saved',
      nw.quiet && !nw.silent.brief && nw.silent.briefed && nw.silent.locker && !nw.silent.away && nw.news && nw.open && !/[Оо]тдых|[Rr]est/.test(nw.first) && nw.routine.n === 2 && nw.routine.closed && /2/.test(nw.routine.label)
      && nw.after.locker && nw.after.seen.length >= 1 && nw.mute.d13 === false && nw.mute.d14 && nw.mute.rep && nw.mute.other && nw.saved, JSON.stringify(nw));
    // (5) the training report right after the training day; not repeated the next morning; [ Remind everyone ]
    await page.evaluate(() => { const s = YAM.game, f = s.fees, ids = s.squad.map(p => p.id);
      f.month = s.monthOf(); f.started = true; f.closed = false; ids.forEach((id, i) => { f.status[id] = i < 3 ? 'owed' : i === 3 ? 'half' : i === 4 ? 'waived' : 'paid'; }); f.reminded = {}; f.got = {}; f.next = {};
      s.today = null; s.dayState().briefed = true; YAM.ui.locker.open(); });
    await page.waitForTimeout(300);
    const rm0 = await page.evaluate(() => ({ btn: !!document.getElementById('lrf-all'), dis: document.getElementById('lrf-all')?.disabled }));
    await page.click('#lrf-all');
    const rm1 = await page.evaluate(() => { const s = YAM.game, f = s.fees, ids = s.squad.map(p => p.id);
      return { owed: ids.filter(id => f.status[id] === 'owed').every(id => f.reminded[id]), others: ids.filter(id => f.status[id] !== 'owed').some(id => f.reminded[id]),
        dis: document.getElementById('lrf-all').disabled, st: ids.map(id => f.status[id]).join() }; });
    await page.click('#lr-proceed');
    await page.evaluate(() => { YAM.ui.skipReports = false; YAM.ui.continueDays(); });
    await page.waitForTimeout(200);
    const tr0 = await page.evaluate(() => { const s = YAM.game, L1 = document.getElementById('morning-briefing-view');
      return { open: !L1.hidden, report: L1.classList.contains('mb-report'), date: s.calendar.date, title: document.getElementById('mb-date').textContent,
        lines: [...document.querySelectorAll('#mb-away li')].map(x => x.textContent), news: getComputedStyle(document.querySelector('#morning-briefing-view .mb-news')).display,
        awayTue: (s.away || []).some(e => e.date === '2002-11-19') }; });
    await page.click('#mb-go');
    await page.waitForTimeout(200);
    const tr1 = await page.evaluate(() => { const s = YAM.game; YAM.ui.skipReports = undefined;
      return { report: document.getElementById('morning-briefing-view').classList.contains('mb-report'), date: s.calendar.date, awayTue: (s.away || []).some(e => e.date === '2002-11-19'),
        seen: Object.keys(s.newsSeen).some(k => k.startsWith('cal.') || k.startsWith('tr.') || k.startsWith('obs.')) }; });
    check('v3.17 [ Remind everyone ]: reminds every plain debtor (not half / waived / paid), free, then disabled; training report opens right after the training day (who came / why not, same window in report mode), [ OK ] → CONTINUE goes on and Tuesday\'s lines are not repeated',
      rm0.btn && !rm0.dis && rm1.owed && !rm1.others && rm1.dis && tr0.open && tr0.report && tr0.date === '2002-11-20' && /19/.test(tr0.title) && tr0.lines.length >= 1 && /\d+/.test(tr0.lines[0]) && tr0.news === 'none'
      && !tr1.report && tr1.date >= '2002-11-20' && !tr1.awayTue, JSON.stringify({ rm0, rm1, tr0, tr1 }));
    // v3.18 CLUES: truth vs WRONG, no contradiction with stats, confirmation, cap + migration, role-change cost, 📝 badge
    const cl1 = await page.evaluate(async () => {
      const s = YAM.game, ui = YAM.ui, sq = s.squad.filter(p => p.archetype !== 'GK'), out = {}, W = CLUES.WRONG, days = [];
      for (let i = 0; i < 40; i++) days.push('2003-0' + (1 + i % 9) + '-' + String(10 + i).slice(-2));
      const roll = (stats = null) => sq.flatMap(p => days.map(d => ({ p, c: rollClue(p, { date: d, source: 'match', ref: 1, stats }) })));
      CLUES.WRONG = 0; out.true0 = roll().every(({ p, c }) => trueSignals(p).includes(c.signal));
      CLUES.WRONG = 1; out.wrong1 = roll().every(({ p, c }) => trueSignals(p).length === Object.keys(CLUE_SIGNALS).length || !trueSignals(p).includes(c.signal));
      CLUES.WRONG = W;
      const share = roll(); out.mix = share.filter(({ p, c }) => !trueSignals(p).includes(c.signal)).length / share.length;
      // a kid with 0 tackles / 0 interceptions never gets a "duel" clue (whatever WRONG is); no evidence at all → neutral
      const noDuel = { passOk: 6, passFail: 2, tackles: 0, tacklesLost: 3, intercepts: 0, dribbleOk: 2, dribbleFail: 1, shots: 1 };
      out.noDuel = [0, W, 1].every(w => { CLUES.WRONG = w; return roll(noDuel).every(({ c }) => c.signal !== 'duel'); });
      CLUES.WRONG = W;
      out.neutral = roll(MatchEngine.blankStats()).every(({ c }) => c.signal === null && /^clue\.none\./.test(c.textKey));
      // one event: unique phrasing for every kid
      const used = new Set(); out.uniq = new Set(sq.slice(0, 3).map(p => rollClue(p, { date: '2003-02-01', source: 'match', ref: 9, used }).textKey)).size === Math.min(3, sq.length);
      // confirmation: same signal from different events → both ✓; from the same event → no
      const a = { date: '2002-10-05', source: 'match', ref: 3, signal: 'pass' }, b = { date: '2002-10-08', source: 'training', ref: '2002-10-08', signal: 'pass' };
      const a2 = { ...a }, n = { ...a, signal: null }, n2 = { ...b, signal: null }, d = { ...b, signal: 'duel' };
      out.confirm = clueConfirmed([a, b], a) && clueConfirmed([a, b], b) && !clueConfirmed([a, a2], a) && !clueConfirmed([a, a2], a2)
        && !clueConfirmed([n, n2], n) && !clueConfirmed([a, d], a);
      // cap + migration (old save without clues / roleMatches)
      const k = sq[0], keep = k.clues.slice();
      for (let i = 0; i < 12; i++) s.addClue(k, { date: '2003-03-' + (10 + i), source: 'training', ref: '2003-03-' + (10 + i), signal: 'solo', textKey: 'clue.solo.0' });
      out.cap = k.clues.length === CLUES.MAX_PER_KID && k.clues[k.clues.length - 1].date === '2003-03-21';
      const raw = JSON.parse(JSON.stringify(k)); delete raw.clues; delete raw.roleMatches;
      const old = new Player({ ...raw, tags: [] }), rt = new Player({ ...JSON.parse(JSON.stringify(k)), tags: [] });
      out.migrate = Array.isArray(old.clues) && old.clues.length === 0 && Array.isArray(old.roles) && rt.clues.length === CLUES.MAX_PER_KID;
      // 📝: a new clue shows on the roster row (+ the board dot for a starter) with a tooltip; opening his card in the Notebook clears it
      k.clues = keep.map(c => ({ ...c, seen: true }));
      const st = s.starters().find(p => p.archetype !== 'GK') || k;
      st.clues = (st.clues || []).map(c => ({ ...c, seen: true }));
      s.addClue(st, { date: '2003-03-30', source: 'training', ref: '2003-03-30', signal: 'pass', textKey: 'clue.pass.1' });
      ui.renderTeam();
      const badge = document.querySelector(`#roster .r-row[data-id="${st.id}"] .clue-badge`);
      out.badge = !!badge && badge.title.includes(L.t('clue.pass.1')) && !!document.querySelector(`#tac-board .pl[data-pid="${st.id}"] .clue-badge`)
        && document.querySelectorAll('#roster .clue-badge').length === s.squad.filter(p => unseenClues(p)).length;
      const pi = ui.profile; pi.open?.(st.id); await new Promise(r => setTimeout(r, 50));
      out.pinfo = !!document.querySelector('#pinfo-body .nb-clues li') && unseenClues(st) === 1;   // read-only: does not mark them read
      pi.close?.();
      const keepRep = s.lastReport, keepUnl = s.notebookUnlocked, keepPh = s.phase;
      s.lastReport = { ...keepRep, players: keepRep.players.filter(pr => pr.id !== st.id) }; s.notebookUnlocked = true; s.phase = 'post';
      ui.renderNotebook();
      const det = document.querySelector(`#notes-body details[data-cluekid="${st.id}"]`);
      out.nbBadge = !!det?.querySelector('summary .clue-badge');
      det.open = true; await new Promise(r => setTimeout(r, 50));
      out.gone = unseenClues(st) === 0 && !document.querySelector(`#roster .r-row[data-id="${st.id}"] .clue-badge`) && !document.querySelector(`#tac-board .pl[data-pid="${st.id}"] .clue-badge`);
      s.lastReport = keepRep; s.notebookUnlocked = keepUnl; s.phase = keepPh; ui.renderNotebook();
      // v3.19: roles come from REVIEW.EXE; removing one is free before it has played a match, then −3 morale + diary; free flag → 0
      const r = sq[1], m0 = 60; r.roles = [{ id: 'Playmaker', level: 1, m: 0 }]; r.dyn.morale = m0;
      out.btnFree = s.roleChangeCost(r, false, 'Playmaker') === 0;
      s.trackRoles(new Set([r.id]));
      out.btnCost = s.roleChangeCost(r, false, 'Playmaker') === ROLES.CHANGE_MORALE && s.roleChangeCost(r, true, 'Playmaker') === 0;
      const dl = s.diary.length;
      s.removeRole(r.id, 'Playmaker');
      out.paid = r.roles.length === 0 && r.dyn.morale === m0 + ROLES.CHANGE_MORALE && s.diary.length === Math.min(80, dl + 1) && s.diary[s.diary.length - 1].key === 'role.drop'
        && /\d/.test(ui.entryText({ ...s.diary[s.diary.length - 1], r: 0 }));
      out.freshFree = (() => { r.roles = [{ id: 'Engine', level: 1, m: 0 }]; const m = r.dyn.morale; s.removeRole(r.id, 'Engine'); return r.roles.length === 0 && r.dyn.morale === m; })();
      out.freeFlag = (() => { r.roles = [{ id: 'Selfish', level: 2, m: 2 }]; const m = r.dyn.morale; s.removeRole(r.id, 'Selfish', { free: true }); return r.dyn.morale === m; })();
      // Match Practice: position line kept, + one role clue; two kids with the same hidden archetype never share a template that day
      const arch = ['DEF', 'MID', 'FWD'].find(a => s.squad.filter(p => p.archetype === a).length >= 2), pair = s.squad.filter(p => p.archetype === arch).slice(0, 2);
      const tg = pair.map(p => p.tag); pair.forEach(p => { p.tag = arch === 'FWD' ? 'DEF' : 'FWD'; });
      out.practice = [...Array(12).keys()].every(i => { const date = '2003-04-' + (10 + i), o = s.practiceObservations(date, s.squad, pair.map(p => p.id));
        return o.length === 2 && o.every(x => x.key.startsWith('obs.hint.' + arch + '.') && x.clue?.source === 'training' && x.clue.ref === date && x.clue.signal)
          && o[0].key !== o[1].key && o[0].clue.textKey !== o[1].clue.textKey; });
      pair.forEach((p, i) => { p.tag = tg[i]; });
      // every clue text exists in EN + RU and names no role
      const names = ROLE_IDS.flatMap(id => [I18N.en['role.' + id], I18N.ru['role.' + id]]).map(x => x.toLowerCase());
      const keys = [...Object.keys(CLUE_SIGNALS).map(g => 'clue.like.' + g), ...Object.keys(CLUE_SIGNALS).flatMap(g => [...Array(CLUES.PHRASES).keys()].map(i => `clue.${g}.${i}`)), ...[...Array(CLUES.NEUTRAL).keys()].map(i => 'clue.none.' + i)];
      out.texts = keys.every(k => I18N.en[k] && I18N.ru[k] && !names.some(n => (I18N.en[k] + I18N.ru[k]).toLowerCase().includes(n)));
      // v3.18.1 keeper line: goals against count (0-8 with 2 saves is not "solid"); the engine books them on the keeper
      const kn = (sv, c) => keeperNote({ saves: sv, conceded: c });
      out.keeper = kn(2, 8) === 'note.gkRough' && kn(5, 4) === 'note.gkRough' && kn(2, 3) === 'note.gkShaky' && kn(4, 2) === 'note.gkMixed' && kn(4, 1) === 'note.gkBusy'
        && kn(2, 0) === 'note.gkOk' && kn(0, 1) === 'note.gkBeaten' && kn(0, 0) === 'note.gkQuiet' && keeperNote({ saves: 2 }) === 'note.gkOk'
        && ['gkRough', 'gkShaky', 'gkMixed', 'gkBeaten'].every(k => I18N.en['note.' + k] && I18N.ru['note.' + k]);
      const row = s.league.table().find(x => x.team.user);
      out.conceded = Object.values(s.seasonStats).reduce((a, st) => a + (st.conceded || 0), 0) === row.ga && row.ga > 0;
      if (!out.conceded) out.concededWhy = Object.values(s.seasonStats).reduce((a, st) => a + (st.conceded || 0), 0) + ' vs ' + row.ga + ' md ' + s.league.playedMatchdays();   // (smoke swaps kids in and out: count every kid with season stats)
      s.save();
      return out;
    });
    check('v3.18 clues: WRONG = 0 → always a true signal, WRONG = 1 → never; 0 tackles/interceptions → never "duel"; nothing on the card → neutral; unique phrasing per event; ✓ only across different events; ≤ 8 per kid, old saves load; 📝 on roster + board with tooltip, PLAYER_INFO list read-only, gone after opening his card in the Notebook; role removal free before a match, then −3 morale + diary; texts EN + RU without role names',
      Object.entries(cl1).every(([k, v]) => k === 'mix' ? v > 0.05 && v < 0.4 : k === 'concededWhy' || v === true), JSON.stringify(cl1));
    // ===== v3.19 GROWTH: REVIEW.EXE after a win / draw, roles with levels + two slots, 3 new roles =====
    {   // block scope: the v3.19 names never clash with older checks
    const v319calm = () => page.evaluate(() => { const s = YAM.game, ui = YAM.ui; ui.autoReview = false; ui.events.enabled = false; s.excusesOff = true;
      s.eventQueue = []; s.pendingEvent = null; ui.events.view?.layer && (ui.events.view.layer.hidden = true); ui.modal.close(); ui.profile.close(); ui.debug.close(); ui.locker.close?.(); });
    const v319toPost = async (force = true) => {   // the next league match, played by Quick Sim (Force Win optional)
      await v319calm();
      await page.evaluate(() => { const s = YAM.game, ui = YAM.ui;
        if (s.phase === 'post') { if (s.reviewPending) s.reviewPick(0); if (s.talkPending) s.applyTeamTalk('praise'); ui.closeMatchday(); }
        if (s.phase === 'seasonEnd') ui.onDashAction();
        if (s.phase === 'calendar') ui.autoSim(); });
      await page.waitForFunction(() => YAM.game.phase === 'matchday' || (YAM.game.pendingEvent && !document.getElementById('talk-layer').hidden), null, { timeout: 30000 });
      await page.evaluate(f => { const s = YAM.game, ui = YAM.ui; ui.modal.close(); ui.locker.close?.(); ui.briefing.close?.();
        s.dayState().locker = { done: true, absent: {}, checked: [] }; s.cheats.forceWin = f; ui.onInstantSim(); }, force);
      await page.waitForFunction(() => YAM.game.phase === 'post', null, { timeout: 10000 });
      await page.evaluate(() => { YAM.ui.modal.close(); YAM.ui.summary.close?.(); });
    };
    const rvOpen = () => page.evaluate(() => !document.getElementById('review-view').hidden);

    // 1. a win → REVIEW.EXE for the best-rated kid; [ CONTINUE ] / Return to Dashboard blocked until a choice; no OK / ×; Esc does nothing
    await page.evaluate(() => { YAM.game.lossStreak = 0; });
    await v319toPost(true);
    const w1 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, e = ui.engine, rv = s.review;
      const played = e.sides[0].all.filter(p => e.everPlayed.has(p.id) && s.player(p.id)), best = Math.max(...played.map(p => matchRating(e.st(p))));
      const out = { res: s.lastReport.result, mode: rv?.mode, n: rv?.cards.length, best: !!rv && matchRating(e.st(s.player(rv.pid))) === best && played.some(p => p.id === rv.pid) };
      ui.closeMatchday();
      out.open = !document.getElementById('review-view').hidden; out.still = s.phase === 'post';
      ui.onDashAction(); ui.continueDays();
      out.blocked = s.phase === 'post' && s.reviewPending && !document.getElementById('review-view').hidden;
      const L2 = document.getElementById('review-view');
      out.noClose = !L2.querySelector('.tb-btn, #rv-x') && ![...L2.querySelectorAll('button')].some(b => /^\s*(ok|close|next|закрыть|далее)\s*$/i.test(b.textContent));
      out.cards = L2.querySelectorAll('.rv-card').length; out.kid = L2.querySelector('#rv-kid').textContent.includes(L.name(s.player(rv.pid).name));
      return out;
    });
    await page.keyboard.press('Escape');
    w1.esc = await rvOpen();
    await page.evaluate(() => YAM.ui.reviewView.close()); w1.closeNoop = await rvOpen();
    await shot('19-review');
    check('v3.19 win → REVIEW.EXE for the best match rating among our kids, 3 cards; Return / [ CONTINUE ] blocked until a choice; no OK / × button; Escape does not close it',
      w1.res === 'W' && w1.mode === 'win' && w1.n === 3 && w1.best && w1.open && w1.still && w1.blocked && w1.noClose && w1.cards === 3 && w1.kid && w1.esc && w1.closeNoop, JSON.stringify(w1));

    // 2. Reroll: 1 AP, once; disabled at 0 AP. Banish: role → p.banned, card removed (no refill), max 1. Then a card → applied, diary, window closes, next day.
    const rr = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, w = s.weekState(); w.ap = 1; ui.reviewView.render();
      const btn = document.getElementById('rv-reroll'), out = { en: !btn.disabled && !btn.hidden };
      btn.click();
      out.spent = w.ap === 0 && s.review.rerolled && s.review.cards.length === 3; out.dis = btn.disabled && !s.reviewReroll();
      s.review.rerolled = false; w.ap = 0; ui.reviewView.render(); out.dis0 = btn.disabled && !s.reviewReroll();
      w.ap = 1; s.review.rerolled = true; ui.reviewView.render();
      const p = s.player(s.review.pid), i = s.review.cards.findIndex(c => c.type !== 'up'), role = s.review.cards[i]?.role;
      if (i >= 0) document.querySelector(`#rv-cards [data-ban="${i}"]`).click();
      out.ban = i < 0 || (p.banned.includes(role) && !s.review.cards.some(c => c.role === role) && s.review.cards.length === 2 && s.review.banished);
      out.ban1 = !s.reviewBanish(0) && [...document.querySelectorAll('#rv-cards [data-ban]')].every(b => b.disabled) && document.querySelectorAll('#rv-cards .rv-card').length === s.review.cards.length;
      out.banTwice = p.banned.filter(x => x === role).length <= 1;
      const c = s.review.cards[0], before = JSON.stringify(p.roles), md = s.lastReport.md;
      document.querySelector('#rv-cards [data-pick="0"]').click();
      out.applied = c.type === 'new' ? p.roles.some(r => r.id === c.role && r.level === 1) : c.type === 'up' ? JSON.stringify(p.roles) !== before : p.roles.some(r => r.id === c.role) && !p.roles.some(r => r.id === c.replaces);
      out.diary = s.diary.some(d => d.key === 'rv.' + c.type && d.vars?.k?.pid === p.id);
      out.closed = document.getElementById('review-view').hidden && s.review === null && s.phase !== 'post' && ui.cal.nextEvent()?.md === md + 1;
      out.free = c.type === 'up' || s.roleChangeCost(p, false, c.role) === 0;   // misclick protection until his next match
      out.saved = JSON.parse(localStorage.getItem('yam_save_v1')).review === null;
      return out;
    });
    check('v3.19 REVIEW: Reroll costs 1 AP, once per window, disabled at 0 AP; Banish → p.banned, card gone without refill, only once; a card applies at once (diary), the window closes, the matchday closes; a new role is free to remove until his next match',
      Object.values(rr).every(Boolean), JSON.stringify(rr));

    // 3. Skip → +2 morale; draw → 2 cards, no reroll, no mark; loss → nothing; Quick Sim and the visual match share the same path (onMatchEnd)
    await v319toPost(true);
    const sk = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, p = s.player(s.review.pid), m = p.dyn.morale = 50;
      ui.closeMatchday(); document.getElementById('rv-skip').click();
      return { morale: p.dyn.morale === m + REVIEW.SKIP_MORALE, closed: document.getElementById('review-view').hidden && s.phase !== 'post', diary: s.diary.some(d => d.key === 'rv.skip.diary') };
    });
    await v319toPost(false);
    const dr = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, e = ui.engine, played = e.sides[0].all.filter(p => e.everPlayed.has(p.id)).map(p => [p.id, { ...e.st(p) }]);
      const keep = { ...REVIEW }; REVIEW.LIKE_HINT = 1;
      s.startReview('D', played, s.calendar.date, s.lastReport.md);
      REVIEW.LIKE_HINT = keep.LIKE_HINT;
      ui.closeMatchday();
      const L2 = document.getElementById('review-view'), out = { open: !L2.hidden, mode: s.review?.mode === 'draw', n: L2.querySelectorAll('.rv-card').length === REVIEW.CARDS_DRAW,
        noReroll: document.getElementById('rv-reroll').hidden && !s.reviewReroll(), noMark: !s.review.cards.some(c => c.like) && !L2.querySelector('.rv-like') };
      const i = s.review.cards.findIndex(c => c.type !== 'up'); if (i >= 0) out.ban = s.reviewBanish(i); else out.ban = true;
      document.getElementById('rv-skip').click(); out.skip = s.review === null && s.phase !== 'post';
      return out;
    });
    await v319toPost(false);
    const ls = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, e = ui.engine, played = e.sides[0].all.filter(p => e.everPlayed.has(p.id)).map(p => [p.id, { ...e.st(p) }]);
      s.startReview('L', played, s.calendar.date, s.lastReport.md);
      const none = s.review === null; ui.closeMatchday();
      return { none, notOpen: document.getElementById('review-view').hidden, closed: s.phase !== 'post' };
    });
    check('v3.19 Skip → morale +2 and the window closes; a draw opens REVIEW.EXE with 2 cards, no reroll, no "he lit up" mark (skip + banish still work); a loss opens nothing',
      Object.values(sk).every(Boolean) && Object.values(dr).every(Boolean) && Object.values(ls).every(Boolean), JSON.stringify({ sk, dr, ls }));

    // 4. card rules (rolled over many dates + 4 cards): no "new" with full slots, no level-up at 3, no clashing pair, no banished role
    const cr = await page.evaluate(() => {
      const s = YAM.game, k = s.squad[2], keep = { roles: k.roles, banned: k.banned };
      const setups = [[[], []], [[{ id: 'Playmaker', level: 3, m: 0 }], ['Engine']], [[{ id: 'Playmaker', level: 3, m: 0 }, { id: 'Engine', level: 1, m: 0 }], []],
        [[{ id: 'Anchor', level: 2, m: 0 }, { id: 'Aggressive', level: 3, m: 0 }], ['Selfish', 'Finisher']], [[{ id: 'Finisher', level: 3, m: 0 }, { id: 'Selfish', level: 3, m: 0 }], ['Playmaker']]];
      const bad = [];
      setups.forEach(([roles, banned], j) => {
        for (let d = 0; d < 40; d++) {
          k.roles = roles.map(r => ({ ...r })); k.banned = [...banned];
          const rv = { date: '2003-01-' + String(d + 1).padStart(2, '0'), md: 1, pid: k.id, n: 4, stats: { passOk: d, tackles: d % 5, intercepts: d % 3, dribbleOk: d % 7, shots: d % 4, onTarget: d % 2 } };
          const cards = s.rollReviewCards(k, rv);
          for (const c of cards) {
            const held = k.roles.map(r => r.id);
            const after = c.type === 'new' ? [...held, c.role] : c.type === 'swap' ? held.map(h => h === c.replaces ? c.role : h) : held;
            if ((c.type === 'new' && held.length >= ROLES.SLOTS) || (c.type === 'up' && (k.roleLevel(c.role) >= ROLES.LEVELS || !held.includes(c.role)))
              || (c.type === 'swap' && (held.length < ROLES.SLOTS || !held.includes(c.replaces))) || k.banned.includes(c.role) && c.type !== 'up'
              || after.some(a => after.some(b => a !== b && roleClash(a, b))) || (c.type !== 'up' && held.includes(c.role))) bad.push(j + ':' + JSON.stringify(c));
          }
          if (new Set(cards.map(c => c.type + c.role + (c.replaces || ''))).size !== cards.length) bad.push(j + ':dup');
          if (j === 4 && cards.some(c => c.type === 'up')) bad.push('up at 3');
        }
      });
      const seeded1 = JSON.stringify(s.rollReviewCards(k, { date: '2003-02-01', md: 2, pid: k.id, n: 3, stats: {} })) === JSON.stringify(s.rollReviewCards(k, { date: '2003-02-01', md: 2, pid: k.id, n: 3, stats: {} }));
      // weights: lots of passes → a pass role shows up more often (base weight 1 keeps everything possible)
      k.roles = []; k.banned = [];
      let pm = 0, pm0 = 0;
      for (let d = 0; d < 200; d++) { const date = '2004-' + d;
        if (s.rollReviewCards(k, { date, md: 1, pid: k.id, n: 1, stats: { passOk: 30 } })[0].role === 'Playmaker') pm++;
        if (s.rollReviewCards(k, { date, md: 1, pid: k.id, n: 1, stats: {} })[0].role === 'Playmaker') pm0++; }
      Object.assign(k, keep);
      return { bad: bad.slice(0, 4), seeded1, pm, pm0 };
    });
    check('v3.19 card rules over 200 rolled windows: no "new role" with full slots, no level-up at 3, no Playmaker+Selfish / Anchor+Finisher, no banished role, no duplicates; seeded; a match full of passes weighs the pass role up (base 1 keeps every card possible)',
      cr.bad.length === 0 && cr.seeded1 && cr.pm > cr.pm0 * 1.6 && cr.pm0 > 0, JSON.stringify(cr));

    // 5. loss streak: 2+ losses in a row → the next win shows 4 cards; a draw resets it. "He lit up" = a clue (WRONG rules), banish clue (source 'review')
    const st = await page.evaluate(() => {
      const s = YAM.game, k = s.squad.find(p => p.position !== 'GK') || s.squad[3], played = [[k.id, { passOk: 20, tackles: 3, intercepts: 2, dribbleOk: 4, shots: 2, onTarget: 1 }]];
      const keepR = { ...REVIEW }, keepW = CLUES.WRONG, keepRoles = k.roles, keepBan = k.banned, keepClues = k.clues;
      const md = 30, out = {};
      s.lossStreak = 0; k.roles = []; k.banned = [];
      s.startReview('L', played, '2005-01-01', md); s.startReview('L', played, '2005-01-08', md);
      out.streak = s.lossStreak === 2;
      out.four = s.startReview('W', played, '2005-01-15', md).cards.length === REVIEW.CARDS_STREAK && s.lossStreak === 0;
      s.startReview('L', played, '2005-01-22', md); s.startReview('L', played, '2005-01-29', md); s.startReview('D', played, '2005-02-05', md);
      out.drawReset = s.lossStreak === 0 && s.startReview('W', played, '2005-02-12', md).cards.length === REVIEW.CARDS;
      REVIEW.LIKE_HINT = 1; CLUES.WRONG = 0; k.clues = [];
      let okFit = 0, n = 0;
      for (let d = 1; d <= 20; d++) { const rv = s.startReview('W', played, '2005-03-' + String(d).padStart(2, '0'), md); const c = rv.cards.find(x => x.like);
        if (c) { n++; if (roleFits(k, c.role)) okFit++; } }
      out.like = n > 0 && okFit === n && k.clues.length > 0 && k.clues.every(c => c.source === 'review' && c.textKey === 'clue.like.' + c.signal);
      CLUES.WRONG = 1; let wrong = 0, wn = 0;
      for (let d = 1; d <= 20; d++) { const rv = s.startReview('W', played, '2005-04-' + String(d).padStart(2, '0'), md); const c = rv.cards.find(x => x.like);
        if (c) { wn++; if (!roleFits(k, c.role)) wrong++; } }
      out.wrong = wn > 0 && wrong === wn;
      CLUES.WRONG = keepW; REVIEW.LIKE_HINT = 0; REVIEW.BANISH_CLUE = 1; k.clues = [];
      const rv = s.startReview('W', played, '2005-05-01', md), bi = rv.cards.findIndex(c => c.type !== 'up');
      out.banClue = bi >= 0 && s.reviewBanish(bi) && k.clues.length === 1 && k.clues[0].source === 'review' && !!I18N.en[k.clues[0].textKey] && YAM.ui.clueLine(k, k.clues[0]).includes('☆');
      Object.assign(REVIEW, keepR); s.review = null; s.lossStreak = 0; k.roles = keepRoles; k.banned = keepBan; k.clues = keepClues;
      return out;
    });
    check('v3.19 loss streak: after 2 losses in a row the next win shows 4 cards, a draw resets it; "he lit up" marks a fitting role (WRONG → a non-fitting one) and is stored as a clue (source review); a banish may write a clue too',
      Object.values(st).every(Boolean), JSON.stringify(st));

    // 6. levels: LEVEL_MULT 1.2 / 1.35 / 1.5 in a fixed seeded duel (level 1 weaker than level 3), downsides flat; Engine drain; Finisher only in the box
    const lv = await page.evaluate(() => {
      const s = YAM.game, e = YAM.ui.engine || null, k = s.squad.find(p => p.position !== 'GK'), keep = k.roles, R = Math.random;
      const eng = e || { energy: new Map(), effParts: MatchEngine.prototype.effParts, rs: MatchEngine.prototype.rs, modParts: () => ({ cheat: 0, rep: 0, cap: 0, shout: 0, v: 0 }), captainStress: () => 0 };
      Math.random = () => 0.5;
      const duel = lvl => { k.roles = lvl ? [{ id: 'Playmaker', level: lvl, m: 0 }] : []; return MatchEngine.prototype.rs.call(eng, k, 'Pass', 0, 'atk'); };
      const d0 = duel(0), d1 = duel(1), d2 = duel(2), d3 = duel(3);
      k.roles = [{ id: 'Engine', level: 1, m: 0 }]; const dr1 = MatchEngine.drainOf(k); k.roles = [{ id: 'Engine', level: 3, m: 0 }]; const dr3 = MatchEngine.drainOf(k); k.roles = []; const dr0 = MatchEngine.drainOf(k);
      k.roles = [{ id: 'Engine', level: 3, m: 0 }]; const engDown = roleAttrMult(k, 'Dribble') === ROLE_BY_ID.Engine.down.attrs.Dribble;
      k.roles = [{ id: 'Engine', level: 1, m: 0 }]; const engDown1 = roleAttrMult(k, 'Dribble') === ROLE_BY_ID.Engine.down.attrs.Dribble;
      k.roles = [{ id: 'Finisher', level: 3, m: 0 }]; const fin = roleAttrMult(k, 'Shoot', 'box') === ROLE_BY_ID.Finisher.boost.mult && roleAttrMult(k, 'Shoot', 'long') === 1 && roleAttrMult(k, 'Pass') === 0.85;
      k.roles = [{ id: 'Aggressive', level: 3, m: 0 }, { id: 'Anchor', level: 3, m: 0 }]; const both = Math.abs(roleAttrMult(k, 'Mark') - 1.5 * ROLE_BY_ID.Anchor.boost.mult) < 1e-9;
      Math.random = R; k.roles = keep;
      return { tags: [d1.tag, d2.tag, d3.tag].map(x => +x.toFixed(2)).join(), order: d0.total < d1.total && d1.total < d2.total && d2.total < d3.total,
        drain: Math.abs(dr1 / dr0 - 0.92) < 1e-9 && Math.abs(dr3 / dr0 - 0.8) < 1e-9, engDown, engDown1, fin, both };
    });
    check('v3.19 LEVEL_MULT: Playmaker level 1/2/3 = ×1.2/1.35/1.5 in a fixed seeded duel (level 1 < level 3); Engine drain ×0.92 → ×0.8, downsides never scale; Finisher only for shots in the box; two roles on one action multiply',
      lv.tags === '1.2,1.35,1.5' && lv.order && lv.drain && lv.engDown && lv.engDown1 && lv.fin && lv.both, JSON.stringify(lv));

    // 7. Notebook: no role-assign buttons; Remove role −3 after a played match (free right after REVIEW); old save: single role → level 2
    const nb19 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, rep = s.lastReport, k = s.player(rep.players[0].id), keepPh = s.phase, keepUnl = s.notebookUnlocked;
      s.phase = 'post'; s.notebookUnlocked = true; k.roles = [{ id: 'Anchor', level: 2, m: 1 }, { id: 'Engine', level: 1, m: 0 }]; k.dyn.morale = 50;
      ui.show('notes'); ui.renderNotebook();
      const body = document.getElementById('notes-body'), out = { noAssign: !body.querySelector('[data-tag]') && !/notes\.add|Role: “/.test(body.innerHTML),
        rm: body.querySelectorAll(`[data-rmrole][data-id="${k.id}"]`).length === 2, pips: body.innerHTML.includes('●●○') };
      body.querySelector(`[data-rmrole="Engine"][data-id="${k.id}"]`).click(); out.free = k.dyn.morale === 50 && k.roles.length === 1;
      body.querySelector(`[data-rmrole="Anchor"][data-id="${k.id}"]`).click(); out.paid = k.dyn.morale === 50 + ROLES.CHANGE_MORALE && k.roles.length === 0;
      out.hint = !/ONE role|ОДНУ роль/i.test(I18N.en['notes.hint'] + I18N.ru['notes.hint']) && /REVIEW\.EXE/.test(I18N.en['notes.hint']) && /REVIEW\.EXE/.test(I18N.ru['notes.hint']);
      s.phase = keepPh; s.notebookUnlocked = keepUnl;
      const raw = JSON.parse(JSON.stringify(k)); delete raw.roles; raw.roleMatches = 3;
      const old = new Player({ ...raw, tags: ['Playmaker'] });
      out.migrate = JSON.stringify(old.roles) === JSON.stringify([{ id: 'Playmaker', level: 2, m: 3 }]) && Array.isArray(old.banned);
      const both = new Player({ ...raw, roles: [{ id: 'Playmaker', level: 9 }, { id: 'Selfish', level: 1 }, { id: 'Engine', level: 0 }], tags: [] });
      out.clean = JSON.stringify(both.roles.map(r => r.id + r.level)) === '["Playmaker3","Engine1"]';
      // squad screen + PLAYER_INFO + DEBUG: short tags with pips, ROLES column id:level fit/misfit
      k.roles = [{ id: 'Playmaker', level: 2, m: 0 }]; ui.show('team'); ui.renderTeam();
      out.roster = (document.querySelector(`#roster .r-row[data-id="${k.id}"] .r-tags`)?.textContent || '').includes(L.t('role.Playmaker.s') + '●●○');
      ui.profile.open(k.id); out.pinfo = (document.getElementById('pinfo-body')?.textContent || '').includes('●●○'); ui.profile.close();
      ui.debug.tab = 'db'; ui.debug.render(); const db = ui.debug.body;
      out.debug = [...db.querySelectorAll('th')].some(t => t.textContent === 'ROLES') && /Playmaker:2 (fit|MISFIT)/.test(db.textContent);
      return out;
    });
    await page.evaluate(() => { const s = YAM.game, d = JSON.parse(localStorage.getItem('yam_save_v1')); d.squad[0].tags = ['Selfish']; delete d.squad[0].roles; d.squad[0].roleMatches = 2; delete d.review; delete d.lossStreak; localStorage.setItem('yam_save_v1', JSON.stringify(d)); });
    await page.reload();
    await page.waitForFunction(() => window.YAM && window.YAM.ui);
    nb19.reload = await page.evaluate(() => { const k = YAM.game.squad[0]; return JSON.stringify(k.roles) === JSON.stringify([{ id: 'Selfish', level: 2, m: 2 }]) && YAM.game.lossStreak === 0 && YAM.game.review === null; });
    check('v3.19 Notebook: no role-assign buttons, Remove per role (free right after REVIEW, −3 after a played match), new intro text; old save: a single role loads as level 2; roles cleaned (≤ 2, no clash, levels 1–3); roster / PLAYER_INFO pips, DEBUG ROLES',
      Object.values(nb19).every(Boolean), JSON.stringify(nb19));

    // 8. texts + role data: 6 roles, every name / description / short tag / clue in EN + RU; the new roles plug into the v3.18 truth
    const tx = await page.evaluate(() => {
      const keys = ROLE_IDS.flatMap(id => ['role.' + id, 'role.' + id + '.d', 'role.' + id + '.s']).concat(Object.keys(CLUE_SIGNALS).flatMap(g => ['clue.like.' + g, ...[0, 1, 2, 3].map(i => `clue.${g}.${i}`)]),
        ['rv.lead.win', 'rv.lead.draw', 'rv.type.new', 'rv.type.up', 'rv.type.swap', 'rv.like', 'rv.ban', 'rv.reroll', 'rv.skip', 'rv.new', 'rv.up', 'rv.swap', 'rv.skip.diary', 'rv.ban.diary', 'role.drop', 'clue.src.review']);
      return { n: ROLES_DEF.length === 6 && ['Engine', 'Anchor', 'Finisher'].every(id => ROLE_BY_ID[id] && CLUE_SIGNALS[ROLE_BY_ID[id].signal]?.role === id),
        truth: ROLES_DEF.every(d => CLUE_SIGNALS[d.signal].role === d.id), missing: keys.filter(k => !I18N.en[k] || !I18N.ru[k]),
        desc: !/\{m\}|\{d\}/.test(L.tagDesc('Anchor') + L.tagDesc('Engine')) && L.tagDesc('Playmaker').includes('1.2 / 1.35 / 1.5') };
    });
    check('v3.19 roles as data: 6 rows in ROLES_DEF, each tied to its CLUE_SIGNALS row (one truth); names, descriptions (numbers from the table), short tags, clues, "he lit up" lines and REVIEW texts in EN + RU',
      tx.n && tx.truth && tx.missing.length === 0 && tx.desc, JSON.stringify(tx));

    // 9. auto-sim plays a whole season with REVIEW (first card) without getting stuck
    await v319calm();
    await page.evaluate(() => { const s = YAM.game, ui = YAM.ui; if (s.phase === 'post') { if (s.reviewPending) s.reviewPick(0); if (s.talkPending) s.applyTeamTalk('praise'); ui.closeMatchday(); }
      s.newSeason(s.season + 1); ui.cal.attach(s.calendar); ui.engine = null; ui.prepareMatch(); ui.renderAll();
      window.__rv = { picks: 0, opened: 0 }; const pick = s.reviewPick.bind(s); s.reviewPick = i => { window.__rv.picks++; return pick(i); };
      const op = ui.reviewView.open.bind(ui.reviewView); ui.reviewView.open = () => { window.__rv.opened++; return op(); }; });
    let guard = 0, owed = 0;
    while (guard++ < 25) {
      const ph = await page.evaluate(() => YAM.game.phase);
      if (ph === 'seasonEnd') break;
      await page.evaluate(() => { YAM.ui.events.enabled = false; YAM.game.eventQueue = []; YAM.ui.autoSim(); });
      await page.waitForFunction(() => ['matchday', 'seasonEnd'].includes(YAM.game.phase) || YAM.game.pendingEvent, null, { timeout: 30000 });
      if (await page.evaluate(() => YAM.game.phase === 'seasonEnd')) break;
      owed += await page.evaluate(() => { const s = YAM.game, ui = YAM.ui; ui.modal.close(); s.dayState().locker = { done: true, absent: {}, checked: [] }; ui.onInstantSim();
        const o = s.reviewPending ? 1 : 0; ui.autoSim(); if (s.talkPending) s.applyTeamTalk('praise'); ui.closeMatchday(); return o; });
    }
    const as = await page.evaluate(() => ({ phase: YAM.game.phase, md: YAM.game.league.playedMatchdays(), picks: window.__rv.picks, opened: window.__rv.opened, review: YAM.game.review, roles: YAM.game.squad.reduce((a, p) => a + p.roles.length, 0) }));
    check('v3.19 auto-sim: a whole season with REVIEW.EXE (auto mode takes the first card, never opens the window), no soft-lock',
      as.phase === 'seasonEnd' && as.md === 18 && as.picks === owed && owed > 0 && as.opened === 0 && as.review === null && as.roles > 0, JSON.stringify({ ...as, owed, guard }));
    }
    // ===== v3.20 AFTER THE GAME: AFTER_GAME.EXE after a loss, praise / listen after a draw, voice clues =====
    {   // block scope: the v3.20 names never clash with older checks
    const v320calm = () => page.evaluate(() => { const s = YAM.game, ui = YAM.ui; ui.autoReview = false; ui.autoAfter = false;
      if (!s.__spy) { s.__spy = true; const ac = s.addClue.bind(s); window.__clues = []; s.addClue = (p, c) => { window.__clues.push([p?.id, c?.source]); return ac(p, c); }; } ui.events.enabled = false; s.excusesOff = true;
      s.eventQueue = []; s.pendingEvent = null; ui.events.view?.layer && (ui.events.view.layer.hidden = true); ui.modal.close(); ui.profile.close(); ui.debug.close(); ui.locker.close?.(); });
    // the next league match by Quick Sim: 'win' = Force Win, 'loss' = the same bonus turned around for this one match (our kids' hidden truth untouched)
    const v320toPost = async mode => {
      for (let t = 0; t < 4; t++) {
        await v320calm();
        await page.evaluate(() => { const s = YAM.game, ui = YAM.ui;
          if (s.phase === 'post') { s.afterAuto(); if (s.reviewPending) s.reviewPick(0); if (s.talkPending) s.applyTeamTalk('praise'); ui.closeMatchday(); }
          if (s.phase === 'seasonEnd') ui.onDashAction();
          if (s.phase === 'calendar') ui.autoSim(); });
        await page.waitForFunction(() => YAM.game.phase === 'matchday' || (YAM.game.pendingEvent && !document.getElementById('talk-layer').hidden), null, { timeout: 30000 });
        const res = await page.evaluate(m => { const s = YAM.game, ui = YAM.ui, ME = YAM.MatchEngine, orig = ME.prototype.modParts;
          ui.modal.close(); ui.locker.close?.(); ui.briefing.close?.();
          s.dayState().locker = { done: true, absent: {}, checked: [] }; s.cheats.forceWin = m === 'win';
          if (m === 'loss') ME.prototype.modParts = function (side, role) { const o = orig.call(this, side, role), c = side === 0 ? -8 : 5; return { ...o, cheat: c, v: o.v + c }; };
          try { ui.onInstantSim(); } finally { ME.prototype.modParts = orig; }
          ui.modal.close(); ui.summary.close?.();
          return s.lastReport?.result; }, mode);
        if (mode !== 'loss' || res === 'L') return res;
      }
      return null;
    };
    const afOpen = () => page.evaluate(() => !document.getElementById('after-view').hidden);
    const voiceN = 'p => window.__clues.filter(x => x[0] === p.id && x[1] === "voice").length';   // addClue calls (the 8-clue cap may drop an old voice clue)

    // 1. a real loss → AFTER_GAME.EXE with 3 remark cards; Return / [ CONTINUE ] blocked; no OK / ×; Esc does nothing; buttons wait for the typewriter
    const res1 = await v320toPost('loss');
    const a1 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, af = s.after, L2 = document.getElementById('after-view');
      const out = { res: s.lastReport.result === 'L', mode: af?.mode === 'loss', n: af?.remarks.length === AFTER.SPEAKERS, review: s.review === null };
      ui.closeMatchday();
      out.open = !L2.hidden; out.cards = L2.querySelectorAll('.af-card').length === 3; out.title = document.getElementById('af-title').textContent === L.t('af.title');
      out.typing = L2.classList.contains('af-typing') && [...L2.querySelectorAll('button[data-act]')].every(b => b.disabled);
      out.noOk = !L2.querySelector('.tb-btn') && ![...L2.querySelectorAll('button')].some(b => /^\s*(ok|close|next|закрыть|далее)\s*$/i.test(b.textContent));
      const before = JSON.stringify(s.after);
      L2.querySelector('.af-card').click(); out.clickNoop = JSON.stringify(s.after) === before;
      ui.onDashAction(); ui.continueDays();
      out.blocked = s.phase === 'post' && s.afterPending && !L2.hidden;
      out.gist = [...L2.querySelectorAll('.af-gist')].every(g => g.textContent.trim().length > 5 && !/[{}%]|true|false/.test(g.textContent)) && [...L2.querySelectorAll('.af-say')].every(g => !/[{}]/.test(g.textContent));
      return out;
    });
    await page.keyboard.press('Escape');
    a1.esc = await afOpen();
    await page.keyboard.press(' ');
    a1.space = await page.evaluate(() => { const L2 = document.getElementById('after-view'); return !L2.hidden && !L2.classList.contains('af-typing') && [...L2.querySelectorAll('button[data-act]')].every(b => !b.disabled); });
    await shot('20-after-game');
    check('v3.20 a loss → AFTER_GAME.EXE "After the game", 3 remark cards; Return / [ CONTINUE ] blocked until a choice; no OK / × button; Escape does not close it; the cards wait for the typewriter (Space finishes it)',
      Object.values(a1).every(Boolean), JSON.stringify({ res1, ...a1 }));

    // 2. listen to a kid → exactly one 🗣 clue about the kid the remark is about (unchosen remarks write nothing), his morale +3; then the free rethink, once
    const a2 = await page.evaluate(n => {
      const s = YAM.game, ui = YAM.ui, af = s.after, vn = eval(n), i = af.remarks.findIndex(r => !r.parent), rm = af.remarks[i], kid = s.player(rm.pid), about = s.player(rm.about);
      s.squad.forEach(p => { p.dyn.morale = 50; });
      const v0 = s.squad.map(vn), rep0 = { ...s.rep };
      document.querySelector(`#af-body .af-card[data-i="${i}"]`).click();
      const diff = s.squad.map((p, j) => vn(p) - v0[j]), last = about.clues[about.clues.length - 1];
      const box = document.getElementById('af-kid');
      return { one: diff.reduce((a, b) => a + b, 0) === 1 && diff[s.squad.indexOf(about)] === 1, src: last.source === 'voice' && last.ref === af.md && last.date === af.date && !last.seen,
        kind: last.kind === rm.kind && (rm.kind !== 'role' || last.signal === rm.signal), morale: kid.dyn.morale === 50 + AFTER.LISTEN_MORALE && s.squad.filter(p => p !== kid).every(p => p.dyn.morale === 50),
        rep: s.rep.parents === rep0.parents && s.rep.squad === rep0.squad, stage: s.after?.stage === 'rethink' && s.afterKid?.id === about.id,
        shown: !box.hidden && box.textContent.includes(L.name(about.name)) && !!document.querySelector('#af-body [data-do="keep"]'),
        again: !s.afterPick(i) && !s.afterSkip(), icon: ui.clueLine(about, last).includes('\u{1F5E3}'),
        by: rm.about === rm.pid ? !last.by : clueText(last).startsWith(L.t('clue.by.kid', { k: L.name(kid.name) })),
        diary: s.diary.some(d => d.key === 'af.heard.kid' && d.vars?.k?.pid === kid.id) };
    }, voiceN);
    // the rethink itself: slots, clashing pairs and p.banned respected; swap = max(1, level − 1); free; once
    const a3 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, p = s.afterKid;
      p.roles = [{ id: 'Playmaker', level: 3, m: 4 }, { id: 'Engine', level: 1, m: 2 }]; p.banned = ['Anchor']; p.dyn.morale = 50; ui.afterView.render(); ui.afterView.finishTyping();
      const o = s.rethinkOptions(p), btns = [...document.querySelectorAll('#af-body [data-act="rethink"]')];
      const out = { remove: JSON.stringify(o.remove) === '["Playmaker","Engine"]' && btns.filter(b => b.dataset.do === 'remove').length === 2,
        noBanned: !o.swap.some(x => x.to === 'Anchor') && !btns.some(b => b.dataset.to === 'Anchor'), noHeld: !o.swap.some(x => ['Playmaker', 'Engine'].includes(x.to)),
        clash: o.swap.some(x => x.from === 'Playmaker' && x.to === 'Selfish') && !o.swap.some(x => x.from === 'Engine' && x.to === 'Selfish'),
        noGive: o.give.length === 0 && !btns.some(b => b.dataset.do === 'give'), keep: btns.some(b => b.dataset.do === 'keep') };
      document.querySelector('#af-body [data-do="swap"][data-role="Playmaker"][data-to="Finisher"]').click();
      out.swap = JSON.stringify(p.roles.map(r => [r.id, r.level, r.m])) === '[["Finisher",2,0],["Engine",1,2]]' && p.dyn.morale === 50;
      out.diary = s.diary.some(d => d.key === 'af.rd.swap' && d.vars?.k?.pid === p.id);
      out.closed = document.getElementById('after-view').hidden && s.after === null && s.phase !== 'post';
      out.once = !s.afterRethink('remove', 'Engine') && p.roles.length === 2;
      out.saved = JSON.parse(localStorage.getItem('yam_save_v1')).after === null;
      return out;
    });
    // remove / give at no cost (synthetic rethink stage — the same state path)
    const a4 = await page.evaluate(() => {
      const s = YAM.game, p = s.squad[3], fake = (kid) => { s.after = { mode: 'loss', date: s.calendar.date, md: 1, played: [], inv: {}, bench: [],
        remarks: [{ pid: kid.id, parent: null, type: 'self', about: kid.id, kind: 'role', signal: 'pass', role: null, claim: null, ok: true, phr: 0 }], picked: 0, stage: 'rethink' }; };
      p.roles = [{ id: 'Aggressive', level: 2, m: 6 }]; p.banned = ['Selfish']; p.dyn.morale = 40; fake(p);
      const out = { removeFree: s.afterRethink('remove', 'Aggressive') && p.roles.length === 0 && p.dyn.morale === 40 && s.after === null };
      fake(p);
      const o = s.rethinkOptions(p);
      out.giveOpts = o.give.length === ROLE_IDS.length - 1 && !o.give.includes('Selfish') && o.swap.length === 0 && o.remove.length === 0;
      out.noBanned = !s.afterRethink('give', null, 'Selfish') && s.after !== null;
      out.give = s.afterRethink('give', null, 'Anchor') && JSON.stringify(p.roles) === JSON.stringify([{ id: 'Anchor', level: 1, m: 0 }]) && p.dyn.morale === 40;
      p.roles = [{ id: 'Engine', level: 1, m: 3 }]; fake(p);
      out.swapMin1 = s.afterRethink('swap', 'Engine', 'Playmaker') && p.roles[0].id === 'Playmaker' && p.roles[0].level === 1 && p.dyn.morale === 40;
      p.roles = []; p.banned = [];
      return out;
    });
    check('v3.20 listen to a kid → exactly one clue (source "voice", 🗣, "from …" when about a teammate) about the kid the remark is about, unchosen remarks write nothing, his morale +3; then one free rethink: remove / swap (level max(1, level − 1)) / give at no morale cost, slots + clashing pairs + p.banned respected, offered once, then the matchday closes',
      Object.values(a2).every(Boolean) && Object.values(a3).every(Boolean) && Object.values(a4).every(Boolean), JSON.stringify({ a2, a3, a4 }));

    // 3. a parent heard → Parents +1 (no morale); Skip → Squad −1, nothing written; a win opens nothing
    await v320toPost('loss');
    const a5 = await page.evaluate(n => {
      const s = YAM.game, ui = YAM.ui, vn = eval(n), af = s.after, kid = s.squad.find(p => af.played.includes(p.id));
      af.remarks = [{ pid: kid.id, parent: 'dad', type: 'parentOwn', about: kid.id, kind: 'role', signal: 'duel', role: null, claim: null, ok: true, phr: 2 }];
      kid.dyn.morale = 60; const rep0 = s.rep.parents, v0 = vn(kid);
      const out = { pick: s.afterPick(0), rep: s.rep.parents === Math.min(100, rep0 + AFTER.PARENT_REP), morale: kid.dyn.morale === 60, clue: vn(kid) === v0 + 1,
        by: clueText(kid.clues[kid.clues.length - 1]).startsWith(L.t('clue.by.dad', { k: L.name(kid.name) })), diary: s.diary.some(d => d.key === 'af.heard.dad') };
      s.endAfter(); ui.closeMatchday();
      return out;
    }, voiceN);
    await v320toPost('loss');
    const a6 = await page.evaluate(n => {
      const s = YAM.game, ui = YAM.ui, vn = eval(n), v0 = s.squad.map(vn);
      s.skipTeamTalk();   // v3.23: a Quick Sim day closed without the word costs Squad −1 on its own (checked in the v3.23 block)
      const sq0 = s.rep.squad = 50;
      ui.closeMatchday(); ui.afterView.finishTyping();
      document.querySelector('#af-foot [data-act="skip"]').click();
      return { squad: s.rep.squad === sq0 + AFTER.SKIP_SQUAD, none: s.squad.every((p, j) => vn(p) === v0[j]), closed: document.getElementById('after-view').hidden && s.after === null && s.phase !== 'post',
        diary: s.diary.some(d => d.key === 'af.skip.diary') };
    }, voiceN);
    await v320toPost('win');
    const a7 = await page.evaluate(() => { const s = YAM.game, ui = YAM.ui, out = { res: s.lastReport.result === 'W', none: s.after === null };
      ui.closeMatchday(); out.notOpen = document.getElementById('after-view').hidden && !document.getElementById('review-view').hidden; return out; });
    check('v3.20 a parent heard → Parents +1 and no morale change ("Dad of …" clue); "Not now, go home" → Squad −1, no clue, the window closes; a win opens no AFTER_GAME.EXE (REVIEW.EXE instead)',
      Object.values(a5).every(Boolean) && Object.values(a6).every(Boolean) && Object.values(a7).every(Boolean), JSON.stringify({ a5, a6, a7 }));

    // 4. a draw → one small window: Praise (REVIEW draw mode, 2 cards) or Listen (1 remark, no speaker choice, no rethink)
    const drawPrep = () => page.evaluate(() => { const s = YAM.game, ui = YAM.ui, e = ui.engine;
      if (s.reviewPending) s.reviewPick(0); ui.reviewView.layer.hidden = true;
      const played = e.sides[0].all.filter(p => e.everPlayed.has(p.id)).map(p => [p.id, { ...e.st(p) }]);
      s.startReview('D', played, s.calendar.date, s.lastReport.md); s.startAfter('D', played, e.matchEvents, s.calendar.date, s.lastReport.md); });
    await drawPrep();
    const d1 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, L2 = document.getElementById('after-view');
      ui.closeMatchday();
      const opts = [...L2.querySelectorAll('#af-body [data-act]')].map(b => b.dataset.act);
      const out = { open: !L2.hidden, opts: JSON.stringify(opts) === '["praise","listen"]', noCards: !L2.querySelector('.af-card'), noSkip: !L2.querySelector('[data-act="skip"]'),
        rvHidden: document.getElementById('review-view').hidden, typing: [...L2.querySelectorAll('button[data-act]')].every(b => b.disabled) };
      ui.afterView.finishTyping();
      L2.querySelector('[data-act="praise"]').click();
      const R = document.getElementById('review-view');
      out.praise = L2.hidden && s.after === null && !R.hidden && s.review?.mode === 'draw' && R.querySelectorAll('.rv-card').length === REVIEW.CARDS_DRAW && s.phase === 'post';
      document.querySelector('#rv-cards [data-pick="0"]').click();
      out.closed = R.hidden && s.phase !== 'post';
      return out;
    });
    await v320toPost('win');
    await drawPrep();
    const d2 = await page.evaluate(n => {
      const s = YAM.game, ui = YAM.ui, vn = eval(n), L2 = document.getElementById('after-view'), v0 = s.squad.map(vn);
      ui.closeMatchday(); ui.afterView.finishTyping();
      L2.querySelector('[data-act="listen"]').click();
      const out = { one: s.after?.mode === 'listen' && s.after.remarks.length === 1 && L2.querySelectorAll('.af-card').length === 1, noSkip: !L2.querySelector('[data-act="skip"]'), noReview: s.review === null };
      ui.afterView.finishTyping();
      L2.querySelector('.af-card').click();
      out.clue = s.squad.reduce((a, p, j) => a + vn(p) - v0[j], 0) === 1;
      out.noRethink = s.after === null && L2.hidden && document.getElementById('review-view').hidden && s.phase !== 'post';
      return out;
    }, voiceN);
    check('v3.20 a draw → praise / listen (no OK, buttons wait for the typewriter): Praise opens REVIEW.EXE in draw mode with 2 cards; Listen gives 1 remark (no speaker choice, no skip), its clue, no rethink, the matchday closes',
      Object.values(d1).every(Boolean) && Object.values(d2).every(Boolean), JSON.stringify({ d1, d2 }));

    // 5. speakers + hidden reliability over many rolled evenings (seeded, no Math.random): never a kid and his own parent;
    //    "other" names a kid who played; kids from the key moments first; parent ≈ 40 %; reliability 1 → every clue true, 0 → none
    const rl = await page.evaluate(() => {
      const s = YAM.game, sq = s.squad, played = sq.slice(0, 11), roleIds = ROLE_IDS;
      const keep = sq.map(p => JSON.stringify(p.roles));
      sq.forEach((p, i) => { p.roles = i % 3 === 0 ? [] : [{ id: roleIds[i % roleIds.length], level: 1, m: 0 }]; });
      const stats = played.map((p, i) => [p.id, { ...YAM.MatchEngine.blankStats(), shots: i < 4 ? 3 : 0, dribbleFail: i === 5 ? 2 : 0 }]);   // 5 kids involved
      const involved = stats.filter(([, st]) => afterInvolvement([[0, st]])[0] >= AFTER.INVOLVE_MIN).map(([id]) => id);
      const truth = rm => { const a = s.player(rm.about);
        if (rm.kind === 'role') return trueSignals(a).includes(rm.signal);
        if (rm.kind === 'misfit') return !roleFits(a, rm.role) && rolesOf(a).some(r => r.id === rm.role);
        const b = leadershipTrait(a.leadership); return rm.claim === (b === 'leader' ? 'high' : b === 'anxious' ? 'low' : 'x'); };
      const out = { pair: true, other: true, parent: 0, n: 0, kidsInvolved: true, three: true, allTrue: true, noneTrue: true, types: {}, seeded: true, rnd: 0, rel: true };
      const rnd = Math.random; Math.random = () => { out.rnd++; return rnd(); };
      try {
        for (const force of [1, 0]) {
          AFTER.FORCE_REL = force;
          for (let i = 0; i < 150; i++) {
            const af = s.startAfter('L', stats, [], isoAdd('2002-09-07', i * 3), 1);
            const sp = af.remarks.map(r => r.pid), kids = af.remarks.filter(r => !r.parent);
            if (new Set(sp).size !== sp.length) out.pair = false;
            if (af.remarks.length !== 3) out.three = false;
            for (const rm of af.remarks) {
              out.types[rm.type] = (out.types[rm.type] || 0) + 1;
              if (rm.type === 'other' && (!af.played.includes(rm.about) || rm.about === rm.pid)) out.other = false;
              if (rm.parent && ![...af.played, ...af.bench].includes(rm.pid)) out.other = false;
              if (rm.ok !== !!force) out.rel = false;
              if (force && !truth(rm)) out.allTrue = false;
              if (!force && truth(rm)) out.noneTrue = false;
            }
            if (force) { out.n++; if (af.remarks.some(r => r.parent)) out.parent++; }
            if (kids.filter(r => involved.includes(r.pid)).length !== Math.min(kids.length, involved.length)) out.kidsInvolved = false;
            if (JSON.stringify(s.startAfter('L', stats, [], isoAdd('2002-09-07', i * 3), 1).remarks) !== JSON.stringify(af.remarks)) out.seeded = false;
          }
        }
      } finally { Math.random = rnd; AFTER.FORCE_REL = null; }
      // the formula itself: kid 0.7 + (disc + comp − 20)/40 × 0.2, clamped 0.5–0.9; parents 0.65 / 0.85
      const k = sq[0], d0 = k.psych.discipline, c0 = k.psych.composure;
      k.psych.discipline = 10; k.psych.composure = 10; const mid = kidReliability(k); k.psych.discipline = 20; k.psych.composure = 20; const hi = kidReliability(k);
      k.psych.discipline = 1; k.psych.composure = 1; const lo = kidReliability(k); k.psych.discipline = d0; k.psych.composure = c0;
      out.formula = Math.abs(mid - 0.7) < 1e-9 && Math.abs(hi - 0.8) < 1e-9 && Math.abs(lo - 0.61) < 1e-9 && AFTER.PARENT_OWN === 0.65 && AFTER.PARENT_MISFIT === 0.85;
      out.share = out.parent / out.n;
      out.allTypes = ['self', 'other', 'blame', 'excuse', 'parentOwn', 'parentCoach'].every(t => out.types[t] > 0);
      sq.forEach((p, i) => { p.roles = JSON.parse(keep[i]); });
      s.after = null;
      return out;
    });
    check('v3.20 remarks over 300 rolled evenings: 3 speakers, never a kid and his own parent, "other" names a teammate who played, a parent is of a kid who played / sat on the bench, kids from the key moments first, parent ≈ 40 %, all 6 types; seeded, no Math.random; reliability forced 1 → every remark true, 0 → none; kid formula 0.7 ± (disc + comp)',
      rl.pair && rl.other && rl.three && rl.kidsInvolved && rl.allTrue && rl.noneTrue && rl.rel && rl.seeded && rl.rnd === 0 && rl.formula && rl.allTypes && rl.share > 0.25 && rl.share < 0.55, JSON.stringify(rl));

    // 6. a parent's "wrong role" complaint: ignored for 3 matches → Parents −2 + an important briefing line; changing the role clears it; save + old save
    const pc = await page.evaluate(() => {
      const s = YAM.game, k = s.squad[2], fake = () => { s.after = { mode: 'loss', date: s.calendar.date, md: 5, played: [k.id], inv: {}, bench: [],
        remarks: [{ pid: k.id, parent: 'mum', type: 'parentCoach', about: k.id, kind: 'misfit', signal: null, role: 'Aggressive', claim: 'misfit:Aggressive', ok: true, phr: 1 }], picked: null, stage: 'pick' }; };
      k.roles = [{ id: 'Aggressive', level: 2, m: 3 }]; s.parentComplaints = []; s.rep.parents = 50; fake();
      const out = { pick: s.afterPick(0) && s.rep.parents === 51 && s.parentComplaints.length === 1 && s.parentComplaints[0].role === 'Aggressive' };
      const misfitClue = k.clues[k.clues.length - 1]; out.claim = misfitClue.claim === 'misfit:Aggressive' && clueText(misfitClue).includes(L.tag('Aggressive'));
      s.endAfter(); s.save();
      out.saved = JSON.parse(localStorage.getItem('yam_save_v1')).parentComplaints.length === 1;
      s.tickComplaints(); s.tickComplaints(); out.wait = s.rep.parents === 51 && s.parentComplaints.length === 1;
      s.away = []; s.tickComplaints();
      const line = s.diary[s.diary.length - 1];
      out.fired = s.rep.parents === 51 + AFTER.COMPLAINT_REP && s.parentComplaints.length === 0 && line.key === 'af.complaint.mum' && line.vars.k.pid === k.id;
      out.important = newsMatch(line.key, NEWS.IMPORTANT) && newsMatch(line.key, NEWS.NEVER_MUTE) && MorningBriefing.awayLines(s).imp.some(e => e.key === 'af.complaint.mum');
      out.text = YAM.ui.entryText({ ...line, r: 0 }).includes(L.name(k.name));
      fake(); s.afterPick(0); s.endAfter(); s.removeRole(k.id, 'Aggressive');   // removing (paid or free) clears it
      out.cleared = s.parentComplaints.length === 0;
      k.roles = [{ id: 'Aggressive', level: 2, m: 3 }]; fake(); s.afterPick(0); s.endAfter(); s.changeRole(k.id, 'Aggressive', 'Engine', { free: true });
      const r0 = s.rep.parents; s.tickComplaints(); s.tickComplaints(); s.tickComplaints();
      out.swapClears = s.parentComplaints.length === 0 && s.rep.parents === r0;
      k.roles = [];
      return out;
    });
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('yam_save_v1')); delete d.parentComplaints; delete d.after; localStorage.setItem('yam_save_v1', JSON.stringify(d)); });
    await page.reload();
    await page.waitForFunction(() => window.YAM && window.YAM.ui);
    pc.oldSave = await page.evaluate(() => Array.isArray(YAM.game.parentComplaints) && YAM.game.parentComplaints.length === 0 && YAM.game.after === null);
    check('v3.20 parent\'s "wrong role" heard → Parents +1 + a complaint (saved); left alone for 3 matches → Parents −2 + an important, never-muted briefing line; removing / swapping the role clears it; an old save without complaints loads',
      Object.values(pc).every(Boolean), JSON.stringify(pc));

    // 7. voice clues follow the v3.18 rules: confirmed by a match / training / review clue or a voice clue of ANOTHER evening, never by one of the same evening; Notebook marks
    const vc = await page.evaluate(() => {
      const s = YAM.game, k = s.squad[4], keep = k.clues;
      const v = (date, ref, extra) => ({ date, source: 'voice', ref, signal: null, textKey: 'clue.voice.role', kind: 'role', claim: null, role: null, by: null, seen: true, ...extra });
      const a = v('2002-10-05', 5, { signal: 'pass' }), b = v('2002-10-05', 5, { signal: 'pass', by: { pid: 'x', name: k.name, parent: 'mum' } }), m = { date: '2002-10-05', source: 'match', ref: 5, signal: 'pass', textKey: 'clue.pass.0', seen: true };
      k.clues = [a, b];
      const out = { sameEvening: !clueConfirmed(k.clues, a) && !clueConfirmed(k.clues, b) };
      k.clues = [a, m]; out.withMatch = clueConfirmed(k.clues, a) && clueConfirmed(k.clues, m);
      const c = v('2002-10-12', 6, { signal: 'pass' }); k.clues = [a, c]; out.otherEvening = clueConfirmed(k.clues, a);
      const f1 = v('2002-10-05', 5, { kind: 'misfit', claim: 'misfit:Engine', role: 'Engine', textKey: 'clue.voice.misfit' }), f2 = v('2002-10-19', 7, { kind: 'misfit', claim: 'misfit:Engine', role: 'Engine', textKey: 'clue.voice.misfit' });
      const l1 = v('2002-10-05', 5, { kind: 'leadership', claim: 'lead:high', textKey: 'clue.voice.lead.high' });
      k.clues = [f1, f2, l1]; out.misfit = clueConfirmed(k.clues, f1) && !clueConfirmed(k.clues, l1);
      k.clues = [b]; s.save();
      const d = JSON.parse(localStorage.getItem('yam_save_v1')), back = new Player({ ...d.squad.find(p => p.id === k.id), tags: [] });
      out.load = back.clues[0].by?.parent === 'mum' && back.clues[0].kind === 'role' && back.clues[0].signal === 'pass';
      const html = YAM.ui.clueLine(k, b);
      out.mark = html.includes('\u{1F5E3}') && html.includes(esc(L.t('clue.by.mum', { k: L.name(k.name) }))) && html.includes(esc(L.t('clue.src.voice', { r: 5 })));
      k.clues = keep;
      return out;
    });
    check('v3.20 voice clues: same claim from a match clue or another evening → ✓ confirmed, never by a voice clue of the same evening; misfit / leadership claims too; saved with the speaker; 🗣 + "Sasha\'s mum thinks" + source in the Notebook line',
      Object.values(vc).every(Boolean), JSON.stringify(vc));

    // 8. texts: every AFTER_GAME string and clue in EN + RU, 4 phrasings per remark, a phrase per signal; RU keeps names in the nominative (no case endings added)
    const tx = await page.evaluate(() => {
      const types = ['self', 'other', 'otherMisfit', 'blame', 'excuse', 'parentOwn', 'parentCoach'];
      const keys = types.flatMap(t => ['af.gist.' + t, ...[0, 1, 2, 3].map(i => `af.say.${t}.${i}`)]).concat(Object.keys(CLUE_SIGNALS).map(g => 'af.sig.' + g),
        ['af.title', 'af.lead.loss', 'af.lead.draw', 'af.lead.listen', 'af.lead.rethink', 'af.skip', 'af.praise', 'af.listen', 'af.who.mum', 'af.who.dad', 'af.re.remove', 'af.re.swap', 'af.re.give', 'af.re.keep',
          'af.heard.kid', 'af.heard.mum', 'af.heard.dad', 'af.skip.diary', 'af.rd.remove', 'af.rd.swap', 'af.rd.give', 'af.complaint.mum', 'af.complaint.dad', 'clue.src.voice', 'clue.by.kid', 'clue.by.mum', 'clue.by.dad',
          'clue.voice.self', 'clue.voice.role', 'clue.voice.misfit', 'clue.voice.lead.high', 'clue.voice.lead.low', 'notes.backAfter']);
      const ru = Object.keys(I18N.ru).filter(k => /^(af\.|clue\.voice|clue\.by)/.test(k)).map(k => I18N.ru[k]).join(' ');
      return { missing: keys.filter(k => !I18N.en[k] || !I18N.ru[k]), noCase: !/\{[ktw]\}(а|у|е|ом|ой|ы)(?![а-яё])/.test(ru), noPct: !/%|достоверн|надёжн|ложн|reliab|\btrue\b|\bfalse\b/i.test(Object.keys(I18N.en).filter(k => /^af\./.test(k)).map(k => I18N.en[k]).join(' ') + ru),
        source: CLUES.SOURCES.voice === '\u{1F5E3}' };
    });
    check('v3.20 texts: every AFTER_GAME.EXE line, remark (4 phrasings each), signal phrase and voice clue in EN + RU; no reliability wording; RU names stay in the nominative',
      tx.missing.length === 0 && tx.noCase && tx.noPct && tx.source, JSON.stringify(tx));

    // 9. auto-sim plays a whole season with AFTER_GAME.EXE (auto: first remark + keep after a loss, praise after a draw), never opens the window, no soft-lock
    await v320calm();
    await page.evaluate(() => { const s = YAM.game, ui = YAM.ui; ui.autoAfter = null; ui.autoReview = null; delete ui._autoAfter; delete ui._autoReview;
      if (s.phase === 'post') { s.afterAuto(); if (s.reviewPending) s.reviewPick(0); if (s.talkPending) s.applyTeamTalk('praise'); ui.closeMatchday(); }
      s.newSeason(s.season + 1); ui.cal.attach(s.calendar); ui.engine = null; ui.prepareMatch(); ui.renderAll();
      window.__af = { auto: 0, opened: 0, L: 0, D: 0, voice: 0 }; const auto = s.afterAuto.bind(s); s.afterAuto = () => { if (s.after) window.__af.auto++; return auto(); };
      const op = ui.afterView.open.bind(ui.afterView); ui.afterView.open = () => { window.__af.opened++; return op(); }; });
    let guard = 0, owed = 0;
    while (guard++ < 25) {
      const ph = await page.evaluate(() => YAM.game.phase);
      if (ph === 'seasonEnd') break;
      await page.evaluate(() => { YAM.ui.events.enabled = false; YAM.game.eventQueue = []; YAM.ui.autoSim(); });
      await page.waitForFunction(() => ['matchday', 'seasonEnd'].includes(YAM.game.phase) || YAM.game.pendingEvent, null, { timeout: 30000 });
      if (await page.evaluate(() => YAM.game.phase === 'seasonEnd')) break;
      owed += await page.evaluate(() => { const s = YAM.game, ui = YAM.ui; ui.modal.close(); s.dayState().locker = { done: true, absent: {}, checked: [] }; ui.onInstantSim();
        const r = s.lastReport.result; if (r !== 'W') window.__af[r]++; const o = s.afterPending ? 1 : 0; ui.autoSim(); if (s.talkPending) s.applyTeamTalk('praise'); ui.closeMatchday(); return o; });
    }
    const as = await page.evaluate(() => ({ phase: YAM.game.phase, md: YAM.game.league.playedMatchdays(), ...window.__af, after: YAM.game.after, review: YAM.game.review,
      voice: YAM.game.squad.reduce((a, p) => a + (p.clues || []).filter(c => c.source === 'voice').length, 0) }));
    check('v3.20 auto-sim: a whole season with AFTER_GAME.EXE (auto: first remark + "Keep as is" after a loss, Praise after a draw), never opens the window, no soft-lock',
      as.phase === 'seasonEnd' && as.md === 18 && as.auto === owed && owed === as.L + as.D && as.opened === 0 && as.after === null && as.review === null && (as.L === 0 || as.voice > 0), JSON.stringify({ ...as, owed, guard }));
    }
    // ===== v3.21 COHESION: team value, pass-duel hook, empty-week streak, band words, DEBUG attention, policy auto-sim =====
    {   // block scope
    const v321calm = () => page.evaluate(() => { const s = YAM.game, ui = YAM.ui; ui.autoPolicy = null; ui.events.enabled = false; s.excusesOff = true;
      s.eventQueue = []; s.pendingEvent = null; ui.events.view?.layer && (ui.events.view.layer.hidden = true); ui.modal.close(); ui.profile.close(); ui.debug.close(); ui.locker.close?.();
      if (s.phase === 'post') { s.afterAuto(); if (s.reviewPending) s.reviewPick(0); if (s.talkPending) s.applyTeamTalk('praise'); ui.closeMatchday(); }
      if (s.phase === 'seasonEnd') ui.onDashAction(); });
    await v321calm();
    // 1. Sunday formula through the real daily hook: an empty week → C × 0.7; two full trainings → C × 0.7 + 12 × T_eff (rises)
    const c1 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, keep = { date: s.calendar.date, week: s.week, today: s.today, rep: { ...s.rep }, coh: s.cohesion, we: s.worldEvent, wl: s.worldLast, fees: s.fees,
        kids: s.squad.map(p => [p.energy, p.dyn.sharpness, p.dyn.morale, p.injuryDays, p.awayDays, p.suspensionMatches, p.psych.discipline]) };
      const week = (mon, days) => {
        s.calendar.date = mon; s.week = null; s.today = null; s.weekState(); s.worldEvent = null;
        const free = WEEK.PLAN_KEYS.filter((k, i) => !s.matchOn(isoAdd(mon, i)));   // (the match weekday moves with the season)
        for (const k of free.slice(0, days)) s.setWeekPlan(k, 'cardio'); s.confirmWeek();
        s.squad.forEach(p => { p.injuryDays = 0; p.awayDays = 0; p.suspensionMatches = 0; p.psych.discipline = 20; p.energy = 100; });
        const c0 = s.cohesion;
        for (let i = 0; i < 7; i++) { const d = isoAdd(mon, i); s.calendar.date = d; s.today = null; ui.cal.dailyHooks[0](d); }
        return { c0, c: s.cohesion, teff: s.week.teff, present: s.week.present };
      };
      const R = Math.random, b = isoAdd(weekStartOf(s.calendar.date), 7), money = { budget: s.budget, ledger: JSON.stringify(s.ledger || {}), dn: s.diary.length };   // weeks inside this season
      Math.random = () => 0.5;
      const kb = s.bonds; s.bonds = {};   // v3.25: ATMOS = 0 → exactly the v3.21 numbers (ATMOS has its own check)
      s.cohesion = 50; const e = week(b, 0);
      s.cohesion = 50; const t = week(isoAdd(b, 7), 2);
      s.cohesion = 50; const e2 = week(isoAdd(b, 14), 0), e3 = week(isoAdd(b, 21), 0), e4 = week(isoAdd(b, 28), 0);
      s.budget = money.budget; s.ledger = JSON.parse(money.ledger); s.diary.length = money.dn;
      Math.random = R; s.bonds = kb;
      s.squad.forEach((p, i) => { [p.energy, p.dyn.sharpness, p.dyn.morale, p.injuryDays, p.awayDays, p.suspensionMatches, p.psych.discipline] = keep.kids[i]; p.absentToday = null; p.skipped_training = false; });
      Object.assign(s.rep, keep.rep); s.week = keep.week; s.today = keep.today; s.calendar.date = keep.date; s.cohesion = keep.coh; s.worldEvent = keep.we; s.worldLast = keep.wl; s.fees = keep.fees; s.save();
      const near = (a, b) => Math.abs(a - b) < 1e-9;
      return { e, t, seq: [e2.c, e3.c, e4.c].map(v => +v.toFixed(1)),
        ok: { empty: near(e.c, 35) && e.teff === 0, train: t.teff > 1.8 && t.teff <= 2 && near(t.c, 50 * 0.7 + 12 * t.teff) && t.c > 50,
          decay: near(e2.c, 35) && near(e3.c, 24.5) && near(e4.c, 17.15) } };
    });
    check('v3.21 cohesion (Sunday, real daily hook): an empty week 50 → 35 (× 0.7), two full trainings → 50 × 0.7 + 12 × T_eff (> 50), empty weeks 50 → 35 → 24.5 → 17.2',
      Object.values(c1.ok).every(Boolean), JSON.stringify(c1));
    // 2. the match hook: C = 0 vs C = 100, seeded — pass / passFwd duels carry ±bonus on both sides, every other duel kind 0; no cohesion = no term
    const c2 = await page.evaluate(() => {
      const s = YAM.game, lg = s.league, t = lg.teams.find(x => !x.user), us = s.starters(), them = lg.roster(t, new Set()).slice(0, 11), R = Math.random;
      const play = coh => { let a = 7; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
        const e = new MatchEngine({ name: 'U', formation: s.formation, players: us }, { name: t.name, formation: t.formation, players: them }, { onUpdate() {}, onEnd() {}, onLog() {} }, { md: 1, ...(coh ? { cohesion: coh } : {}) });
        e.runInstant(); Math.random = R; return e; };
      const e = play([0, 100]), n = play(null), lo = cohBonus(0), hi = cohBonus(100), PASS = ['pass', 'passFwd'];
      const passes = e.trace.filter(x => PASS.includes(x.kind)), other = e.trace.filter(x => !PASS.includes(x.kind));
      const csv = MatchEngine.traceCsv(e.trace.slice(0, 3), ['U', 'T']);
      return { n: passes.length, other: other.length, kinds: [...new Set(other.map(x => x.kind))].join(' '), lo, hi,
        ok: { pass: passes.length > 20 && passes.every(x => Math.abs(x.A.coh - (x.side === 0 ? lo : hi)) < 1e-9 && Math.abs(x.D.coh - (x.side === 0 ? hi : lo)) < 1e-9),
          shots: other.length > 5 && other.some(x => /shot|Shot|header|penalty|freekick/.test(x.kind)) && other.every(x => x.A.coh === 0 && x.D.coh === 0),
          signs: lo < 0 && hi > 0 && Math.abs(lo + COH.MAX) < 1e-9 && Math.abs(hi - COH.MAX_UP) < 1e-9, none: n.trace.every(x => x.A.coh === 0 && x.D.coh === 0),
          csv: csv.split('\n')[0].includes('atk_coh') && csv.split('\n')[0].includes('def_coh'), log: Array.isArray(e.logData({}).cohesion) && e.knockMult === 1.5 && n.knockMult === 1 } };
    });
    check('v3.21 match hook: C = 0 vs C = 100 (seeded) → every pass / passFwd duel has the bonus on both sides (passer + receiver vs interceptor), shots / dribbles / blocks / the keeper none; no cohesion → no term; CSV + JSON log carry it; knock ×1.5 at C = 0',
      Object.values(c2.ok).every(Boolean), JSON.stringify(c2));
    // 3. empty weeks in a row: −2, −4, −6, −6 (cap) for Board and Parents; a training with a kid in it resets the streak
    const c3 = await page.evaluate(() => {
      const s = YAM.game, keep = { date: s.calendar.date, week: s.week, today: s.today, rep: { ...s.rep }, coh: s.cohesion, we: s.worldEvent, fees: s.fees, diaryN: s.diary.length,
        kids: s.squad.map(p => [p.energy, p.dyn.sharpness, p.dyn.morale, p.injuryDays, p.awayDays, p.suspensionMatches, p.psych.discipline]) };
      const R = Math.random; Math.random = () => 0.5;
      const kb = s.bonds; s.bonds = {};   // v3.25: ATMOS = 0 → the v3.21 cohesion path (and its diary lines) exactly
      s.week = null; const out = [];
      const week = (mon, days) => {
        s.calendar.date = mon; s.today = null; s.weekState(); s.worldEvent = null;
        for (const k of WEEK.PLAN_KEYS.filter((k, i) => !s.matchOn(isoAdd(mon, i))).slice(0, days)) s.setWeekPlan(k, 'cardio'); s.confirmWeek();
        s.squad.forEach(p => { p.injuryDays = 0; p.awayDays = 0; p.suspensionMatches = 0; p.psych.discipline = 20; p.energy = 100; });
        for (let i = 0; i < 6; i++) { const d = isoAdd(mon, i); s.calendar.date = d; s.today = null; s.dayRoutine(d); }
        const sun = isoAdd(mon, 6); s.calendar.date = sun; s.rep.board = 50; s.rep.parents = 50;
        const r = s.weekReview(sun); out.push({ r, b: s.rep.board - 50, p: s.rep.parents - 50, k: s.week.emptyStreak, key: s.diary.at(-1)?.key });
      };
      const b = isoAdd(weekStartOf(keep.date), 7), money = { budget: s.budget, ledger: JSON.stringify(s.ledger || {}) };   // weeks inside this season
      [0, 7, 14, 21].forEach(k => week(isoAdd(b, k), 0));
      week(isoAdd(b, 28), 1); week(isoAdd(b, 35), 0);
      s.budget = money.budget; s.ledger = JSON.parse(money.ledger);
      Math.random = R; s.bonds = kb;
      s.squad.forEach((p, i) => { [p.energy, p.dyn.sharpness, p.dyn.morale, p.injuryDays, p.awayDays, p.suspensionMatches, p.psych.discipline] = keep.kids[i]; p.absentToday = null; p.skipped_training = false; });
      Object.assign(s.rep, keep.rep); s.week = keep.week; s.today = keep.today; s.calendar.date = keep.date; s.cohesion = keep.coh; s.worldEvent = keep.we; s.fees = keep.fees; s.diary.length = keep.diaryN; s.save();
      const keys = ['week.empty', 'week.empty2', 'week.empty3'];
      return { out, ok: out.slice(0, 4).map(x => x.b).join() === '-2,-4,-6,-6' && out.slice(0, 4).map(x => x.p).join() === '-2,-4,-6,-6'
        && out[4].r !== 'empty' && out[4].k === 0 && out[4].b === 0 && out[5].b === -2 && out[5].k === 1
        && out.map(x => x.key).filter(k => /^week\.empty/.test(k)).join() === 'week.empty,week.empty2,week.empty3,week.empty3,week.empty'
        && keys.every(k => I18N.en[k] && I18N.ru[k]) };
    });
    check('v3.21 empty-week streak: Board / Parents −2, −4, −6, −6 (capped), the diary line escalates; a training with a kid present resets it (next empty week −2 again)', c3.ok, JSON.stringify(c3.out));
    // 4. the band word (no digits) in PLANNER.EXE (top line + Monday block), the Monday briefing and the Match Summary (+ the cause line)
    const c4 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, w = s.weekState(), keep = { coh: s.cohesion, conf: w.confirmed, date: s.calendar.date };
      s.cohesion = 22;
      ui.planner.render(); const plHead = document.querySelector('#pl-head .pl-coh')?.textContent || '';
      w.confirmed = false; ui.planner.render(); const plBrief = document.getElementById('pl-brief').textContent; w.confirmed = keep.conf;
      s.calendar.date = w.start; ui.briefing.report = null; ui.briefing.render();
      const mbAp = document.querySelector('#mb-ap .mb-coh')?.textContent || '', mbNews = document.getElementById('mb-news').textContent; s.calendar.date = keep.date;
      const rep = { ...(s.lastReport || {}), md: 3, opponent: s.league.teams.find(t => !t.user).name, venue: 'home', gf: 0, ga: 2, result: 'L', events: [], totals: [{}, {}], coh: 22, talk: 'praise' };
      ui.summary.open(rep); const ms = document.querySelector('#msum-body .ms-coh, .ms-coh')?.textContent || '', cause = document.querySelector('.ms-cause')?.textContent || '';
      ui.summary.open({ ...rep, result: 'W', gf: 2, ga: 0 }); const causeW = !!document.querySelector('.ms-cause');
      ui.summary.open({ ...rep, coh: 85 }); const ms85 = document.querySelector('.ms-coh')?.textContent || '', cause85 = !!document.querySelector('.ms-cause');
      ui.summary.close(); s.cohesion = keep.coh; ui.planner.layer.hidden = true; ui.briefing.close(); ui.renderAll();
      const weak = L.t('coh.band.weak'), lows = [0, 1, 2].map(i => L.t('coh.low.' + i));
      const bands = COH.BANDS.map(b => b.key), words = bands.every(k => I18N.en['coh.band.' + k] && I18N.ru['coh.band.' + k]);
      const n = d => Math.floor(isoDays('2000-01-03', d) / 7) % 3, d0 = weekStartOf(keep.date);
      return { plHead, plBrief: plBrief.slice(0, 90), mbAp, ms, cause, ms85,
        ok: { planner: plHead.includes(weak) && !/\d/.test(plHead), monday: lows.some(x => plBrief.includes(x)), briefing: mbAp.includes(weak) && !/\d/.test(mbAp) && lows.some(x => mbNews.includes(x)),
          summary: ms.includes(weak) && !/\d/.test(ms) && cause === L.t('coh.cause') && !causeW && ms85.includes(L.t('coh.band.clock')) && !cause85,
          words, ru: ['развалена', 'слабая', 'обычная', 'хорошая', 'как часы'].every((x, i) => I18N.ru['coh.band.' + ['apart', 'weak', 'normal', 'good', 'clock'][i]] === x),
          noRepeat: n(d0) !== n(isoAdd(d0, 7)) && n(isoAdd(d0, 7)) !== n(isoAdd(d0, 14)), noNum: lows.concat(L.t('coh.cause')).every(x => !/\d|%/.test(x)) } };
    });
    check('v3.21 the cause is visible: the band word (EN + RU, no digits) in PLANNER.EXE, the Monday block / briefing (+ "Passes aren\'t connecting…" below 35, never the same phrasing two weeks running) and the Match Summary (+ the cause line only for a non-win below 35)',
      Object.values(c4.ok).every(Boolean), JSON.stringify(c4));
    // 5. DEBUG.EXE: COH, TRN-SKIP (was SKIP%), the Attention block (clicks, first-button share, median after the text, < 0.5 s)
    const c5 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, keep = JSON.stringify(s.stats || {});
      s.stats = {};
      s.noteAttention({ first: true, dt: 300 }); s.noteAttention({ first: false, dt: 1200 }); s.noteAttention({ first: true, dt: null });
      const a = s.attentionSummary('week'), se = s.attentionSummary('season');
      ui.debug.tab = 'db'; ui.debug.open();
      const head = [...document.querySelectorAll('#debug-body th[data-col]')].map(th => th.textContent), coh = document.getElementById('dbg-coh')?.textContent, att = document.getElementById('dbg-att')?.textContent || '';
      ui.debug.close(); s.stats = JSON.parse(keep); s.save();
      return { a, se, head: head.filter(h => /SKIP/.test(h)), coh, att: att.slice(0, 160),
        ok: a.clicks === 3 && Math.abs(a.first - 2 / 3) < 1e-9 && Math.abs(a.median - 0.75) < 1e-9 && a.fast === 0.5 && a.timed === 2 && se.clicks === 3
          && head.includes('TRN-SKIP') && !head.includes('SKIP%') && String(Math.round(s.cohesion)) === coh && /67%/.test(att) && /0\.75 s/.test(att) && /50%/.test(att) };
    });
    check('v3.21 DEBUG.EXE: COH (the number), TRN-SKIP (renamed from SKIP%), the Attention block — clicks, first-button share, median time after the text, share under 0.5 s (state.stats.attention)', c5.ok, JSON.stringify(c5));
    // 6. an old save without cohesion / emptyStreak / stats.attention loads (C = 50)
    const c6 = await page.evaluate(() => {
      const raw = localStorage.getItem('yam_save_v1'), d = JSON.parse(raw);
      delete d.cohesion; delete d.stats; if (d.week) { delete d.week.emptyStreak; delete d.week.teff; delete d.week.present; }
      localStorage.setItem('yam_save_v1', JSON.stringify(d));
      const g = new YAM.game.constructor(), w = g.weekState();
      localStorage.setItem('yam_save_v1', raw);
      return { coh: g.cohesion, streak: w.emptyStreak, teff: w.teff, stats: JSON.stringify(g.stats), sum: g.attentionSummary('week'), phase: g.phase };
    });
    check('v3.21 old save without cohesion / emptyStreak / stats loads: C = 50, streak 0, T_eff from the trainings done, attention lazy',
      c6.coh === 50 && c6.streak === 0 && Number.isFinite(c6.teff) && c6.stats === '{}' && c6.sum === null && c6.phase !== 'draft', JSON.stringify(c6));
    // 7. autoSim({ policy: 'first' }) plays 4 weeks without getting stuck (empty weeks, no reminders, no fee without a training);
    //    autoSim() without a policy is the old one (Tue + Thu, no autoPolicy)
    await v321calm();
    const p0 = await page.evaluate(() => { const s = YAM.game; YAM.ui.events.enabled = true; s.excusesOff = false;
      const fee = Object.values(s.ledger || {}).reduce((a, m) => a + (m.fee || 0), 0); return { md: s.league.playedMatchdays(), coh: s.cohesion, fee, trn: s.diary.filter(e => /^cal\.training/.test(e.key)).length }; });
    let stuck = 0;
    for (let i = 0; i < 60; i++) {
      const st = await page.evaluate(() => ({ phase: YAM.game.phase, md: YAM.game.league.playedMatchdays() }));
      if (st.md >= p0.md + 4 && st.phase === 'calendar') break;
      if (st.phase === 'seasonEnd') break;
      await page.evaluate(() => YAM.ui.autoSim({ policy: 'first' }));
      try { await page.waitForFunction(() => !YAM.ui.cal.running && !YAM.ui.events.view.autoT && (YAM.game.phase !== 'calendar' || !YAM.game.pendingEvent), null, { timeout: 20000, polling: 20 }); }
      catch (e) { stuck++; break; }
    }
    const p1 = await page.evaluate(() => { const s = YAM.game, ui = YAM.ui, w = s.weekState();
      const fee = Object.values(s.ledger || {}).reduce((a, m) => a + (m.fee || 0), 0);
      return { md: s.league.playedMatchdays(), phase: s.phase, coh: s.cohesion, fee, trn: s.diary.filter(e => /^cal\.training/.test(e.key)).length, planned: s.trainingsPlanned(), pol: ui.autoPolicy,
        att: s.attentionSummary('season') }; });
    const p2 = await page.evaluate(() => { const s = YAM.game, ui = YAM.ui, calls = [], w = s.weekState();
      w.confirmed = false; for (const k of WEEK.PLAN_KEYS) w.plan[k] = null;   // an unplanned week: the old auto-sim fills it with Tue + Thu
      s.setWeekPlan = (k, r) => { calls.push(k + ':' + r); return GameState.prototype.setWeekPlan.call(s, k, r); };
      ui.events.enabled = false; s.excusesOff = true; s.eventQueue = []; ui.autoSim(); ui.cal.stop(); delete s.setWeekPlan;
      return { pol: ui.autoPolicy, calls: calls.slice(0, 2).join() }; });
    check('v3.21 autoSim({ policy: "first" }) plays 4 weeks (match days, post-match windows, events through policyPick) without getting stuck: no trainings, no fee money, cohesion falls; autoSim() without a policy = the old Tue + Thu',
      !stuck && p1.md >= p0.md + 4 && p1.trn === p0.trn && p1.fee === p0.fee && p1.coh < p0.coh && p1.att?.clicks > 0 && p2.pol === null
      && p2.calls === 'tue:match,thu:match', JSON.stringify({ p0, p1, p2, stuck }));
    await page.evaluate(() => { YAM.ui.autoPolicy = null; YAM.ui.cal.stop(); });
    // 8. the fee rule: a month that cannot reach 4 trainings → every fee chance × 0.5 + one diary line
    const c8 = await page.evaluate(() => {
      const s = YAM.game, keep = { date: s.calendar.date, week: s.week, today: s.today, fees: s.fees, budget: s.budget, ledger: JSON.stringify(s.ledger), diaryN: s.diary.length, we: s.worldEvent };
      const d0 = new Date(s.calendar.date + 'T00:00:00Z'); d0.setUTCMonth(d0.getUTCMonth() + 2); d0.setUTCDate(1);
      const m1 = d0.toISOString().slice(0, 10), month = m1.slice(0, 7), next = new Date(d0); next.setUTCMonth(next.getUTCMonth() + 1);
      let mon = m1; while (weekKey(mon) !== 'mon') mon = isoAdd(mon, 1);   // the month's first Monday
      let last = mon; while (isoAdd(last, 8).startsWith(month)) last = isoAdd(last, 7);   // its last Monday whose Tuesday is in the month
      const fees = trn => ({ month, level: 'normal', amount: 10, started: true, status: Object.fromEntries(s.squad.map(p => [p.id, 'owed'])), reminded: {}, reason: {}, carry: {}, next: {}, got: {}, trn });
      const wk = (m, n) => { s.calendar.date = m; s.week = null; s.today = null; s.weekState(); s.worldEvent = null;
        for (const k of WEEK.PLAN_KEYS.filter((k, i) => i >= 1 && !s.matchOn(isoAdd(m, i))).slice(0, n)) s.setWeekPlan(k, 'match'); s.confirmWeek(); };
      wk(mon, 2); s.fees = fees(0); const early = s.lowTrainingMonth(isoAdd(mon, 1));   // two a week, weeks left → fine
      wk(last, 1); s.fees = fees(0); const lowLate = s.lowTrainingMonth(isoAdd(last, 1));   // nothing so far, this week's one at most → under 4
      s.fees = fees(4); const okLate = s.lowTrainingMonth(isoAdd(last, 1));   // 4 already (today included) → fine
      const id = s.squad[0].id, day = isoAdd(last, 1); s.fees = fees(0); s.fees.next[id] = 0.6;   // a fixed chance: 0.6 → 0.3 under the rule
      const x = seeded(month + '#fee#' + id + '#' + day)(), absent = Object.fromEntries(s.squad.filter(p => p.id !== id).map(p => [p.id, 'x']));
      const paid = s.collectFees(day, absent).includes(id), line = s.diary.some(e => e.key === 'fee.lowTraining' && e.date === day);
      s.calendar.date = keep.date; s.week = keep.week; s.today = keep.today; s.fees = keep.fees; s.budget = keep.budget; s.ledger = JSON.parse(keep.ledger); s.diary.length = keep.diaryN; s.worldEvent = keep.we; s.save();
      return { month, mon, last, early, lowLate, okLate, x: +x.toFixed(3), paid, line, ok: !early && lowLate && !okLate && paid === (x < 0.3) && line && !!I18N.ru['fee.lowTraining'] };
    });
    check('v3.21 fees: a month projected under 4 trainings (done + rest of this week + this week\'s pace) → fee chances × 0.5 + diary "Parents ask what they\'re paying for"', c8.ok, JSON.stringify(c8));
    }
    // ===== v3.22 MONEY WITH STRINGS: the promise card, the scout's return, the pool leak, greedy auto-sim =====
    {   // block scope
    const calm = () => page.evaluate(() => { const s = YAM.game, ui = YAM.ui; ui.autoPolicy = null; ui.events.enabled = false; s.excusesOff = true;
      s.eventQueue = []; s.pendingEvent = null; ui.events.view?.layer && (ui.events.view.layer.hidden = true); ui.modal.close(); ui.profile.close(); ui.debug.close(); ui.locker.close?.();
      if (s.phase === 'post') { s.afterAuto(); if (s.reviewPending) s.reviewPick(0); if (s.talkPending) s.applyTeamTalk('praise'); ui.closeMatchday(); }
      if (s.phase === 'seasonEnd') ui.onDashAction(); });
    const talkUp = () => page.waitForFunction(() => !document.getElementById('talk-layer').hidden && YAM.game.pendingEvent, null, { timeout: 8000 });
    const pick = async i => { await finishTyping(); await page.click(`#talk-choices .talk-btn[data-i="${i}"]`); await page.waitForTimeout(40); };
    await calm();
    // to the next match day (old auto-sim, no events), every kid fit and keen so nobody misses the roll call
    await page.evaluate(() => { YAM.game.squad.forEach(p => { p.injuryDays = 0; p.awayDays = 0; p.suspensionMatches = 0; p.energy = 100; p.psych.discipline = 20; });
      YAM.game.squad.forEach(p => { p.flags = p.flags.filter(f => f !== 'Promised_Start'); p.promiseBy = null; p.promiseChoice = null; }); YAM.ui.autoSim(); });
    await page.waitForFunction(() => YAM.game.phase === 'matchday' && !YAM.ui.cal.running, null, { timeout: 30000 });
    const setup = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui; ui.modal.close();
      s.squad.forEach(p => { p.injuryDays = 0; p.awayDays = 0; p.suspensionMatches = 0; p.energy = 100; p.psych.discipline = 20; p.dyn.morale = 60; });
      const a = s.bench().find(p => p.position !== 'GK' && s.lineSwapSlot(p));   // a benched outfield kid (a tag or none)
      a.flags.push('Promised_Start'); a.promiseBy = 'dad'; a.promiseChoice = null; s.rep.parents = 50; s.budget = Math.max(s.budget, 1000); s.save();
      const out = s.lineSwapSlot(a).q;
      return { a: a.id, aName: L.name(a.name), out: out.id, outName: L.name(out.name), outMor: out.dyn.morale };
    });
    for (let g = 0; g < 6 && !(await page.evaluate(() => YAM.ui.locker.isOpen)); g++) {   // cash desk / briefing first, then the locker room
      await page.evaluate(() => { const s = YAM.game, ui = YAM.ui; if (s.kassaDue()) { s.confirmKassa(); ui.kassa?.close?.(); } ui.locker.open(); });
      if (await page.evaluate(() => !document.getElementById('morning-briefing-view').hidden)) await page.click('#mb-go');
      await page.waitForTimeout(80);
    }
    await talkUp();
    for (let g = 0; g < 4 && (await page.evaluate(() => YAM.game.pendingEvent?.id)) !== 'promise'; g++) { await pick(0); await page.waitForTimeout(400); await talkUp(); }   // other locker requests first
    const c1 = await page.evaluate(() => { const ui = YAM.ui, btns = [...document.querySelectorAll('#talk-choices .talk-btn')];
      return { id: YAM.game.pendingEvent?.id, typing: document.getElementById('talk-layer').classList.contains('talk-typing'), dis: btns.every(b => b.disabled), n: btns.length,
        face: !!document.querySelector('#talk-face svg') }; });
    await page.keyboard.press('Escape');
    await finishTyping();
    const c1b = await page.evaluate(() => { const s = YAM.game, ui = YAM.ui, lk = s.dayState().locker;
      ui.locker.proceed(); const eng = ui.createEngine(); ui.events.view.finishTyping();
      return { open: !document.getElementById('talk-layer').hidden, done: !!lk.done, eng: !!eng || !!ui.engine, text: document.getElementById('talk-text').textContent,
        btns: [...document.querySelectorAll('#talk-choices .talk-btn .tb-label')].map(b => b.textContent), ok: [...document.querySelectorAll('#talk-choices .talk-btn')].some(b => /OK/.test(b.textContent)) }; });
    check('v3.22 match day with Promised_Start: the promise card in the locker room (portrait, 2 choices, no OK); buttons inactive while typing; Esc does not close it; Proceed and kick-off blocked until answered',
      c1.id === 'promise' && c1.typing && c1.dis && c1.n === 2 && c1.face && c1b.open && !c1b.done && !c1b.eng && !c1b.ok && c1b.text.includes(setup.outName)
      && c1b.btns[0].includes(setup.aName), JSON.stringify({ c1, c1b, setup }));

    // keep (benched kid) → he starts, the weakest starter of his line drops out (−6), Parents −2
    await pick(0);
    const c2 = await page.evaluate(({ a, out }) => { const s = YAM.game, p = s.player(a), o = s.player(out);
      return { starter: s.isStarter(a), outStarter: s.isStarter(out), outMor: o.dyn.morale, par: s.rep.parents, choice: p.promiseChoice, flag: p.hasFlag('Promised_Start'),
        diary: s.diary.some(d => d.key === 'ev.promise.keepSwap.diary'), open: !document.getElementById('talk-layer').hidden, req: YAM.ui.locker.requestPending,
        }; }, setup);
    // keep (already in the XI) → no displacement, Parents −2 all the same
    const c2b0 = await page.evaluate(() => { const s = YAM.game, b = s.starters().find(p => p.position !== 'GK' && !p.hasFlag('Promised_Start'));
      b.flags.push('Promised_Start'); b.promiseBy = 'dad'; b.promiseChoice = null;
      const r = { b: b.id, xi: s.lineup.join(), mor: s.squad.map(p => p.dyn.morale).join(), par: s.rep.parents };
      YAM.ui.events.fire('promise', s.calendar.date, { cast: { kid: b.id } }); return r; });
    await talkUp(); await pick(0);
    const c2b = await page.evaluate(r => { const s = YAM.game; return { same: s.lineup.join() === r.xi, mor: s.squad.map(p => p.dyn.morale).join() === r.mor, par: s.rep.parents - r.par,
      diary: s.diary.at(-1).key }; }, c2b0);
    check('v3.22 keep: the promised kid starts, the weakest starter of his line drops out with morale −6, Parents −2; already in the XI → no displacement, Parents −2',
      c2.starter && !c2.outStarter && c2.outMor === setup.outMor - 6 && c2.par === 48 && c2.choice === 'keep' && c2.flag && c2.diary && !c2.open && !c2.req
      && c2b.same && c2b.mor && c2b.par === -2 && c2b.diary === 'ev.promise.keep.diary', JSON.stringify({ c2, c2b }));
    // ensureAvailableXI never adds a promised kid; an unavailable promised kid gets no card: refund, no morale / Parents penalty
    const c3 = await page.evaluate(() => {
      const s = YAM.game, keepXI = [...s.lineup];
      const st = s.starters().find(p => p.position !== 'GK' && !p.hasFlag('Promised_Start'));
      const c = s.bench().find(p => p.position === st.position && !p.hasFlag('Promised_Start')) || s.bench().find(p => p.position !== 'GK' && !p.hasFlag('Promised_Start'));
      c.flags.push('Promised_Start'); c.promiseBy = 'dad'; c.promiseChoice = null; const ov = c.overall; c.overall = 99;   // the best bench kid by far
      st.injuryDays = 5; const fixes = s.ensureAvailableXI(); const added = s.isStarter(c.id); const card = s.promiseCardKid()?.id === c.id;
      st.injuryDays = 0; c.overall = ov; s.lineup = keepXI;
      c.injuryDays = 3;   // now he can't play: no card at all
      const r = { added, fixes: fixes.length, card, noCard: s.promiseCardKid() === null, b0: s.budget, mor0: c.dyn.morale, par0: s.rep.parents, kept: s.squad.filter(p => p.promiseChoice === 'keep').map(p => p.id) };
      YAM.ui.checkPromises();
      Object.assign(r, { refund: r.b0 - s.budget, mor: c.dyn.morale - r.mor0, par: s.rep.parents - r.par0, flags: s.squad.filter(p => p.hasFlag('Promised_Start')).length,
        diary: s.diary.slice(-4).map(d => d.key) });
      c.injuryDays = 0; s.save();
      return r;
    });
    check('v3.22 ensureAvailableXI() never moves a promised kid into the XI; promised kid unavailable → no card, refund $300, no morale / Parents penalty; kick-off clears every flag',
      !c3.added && c3.fixes === 1 && c3.card && c3.noCard && c3.refund === 300 && c3.mor === 0 && c3.par === 0 && c3.flags === 0 && c3.kept.length === 2
      && c3.diary.includes('ev.promise.excused') && c3.diary.includes('ev.promise.kept'), JSON.stringify(c3));
    // the pool dad's promise: same card, other words; keep → no Parents −2; break → kept at home HOME_DAYS, no refund. Quick Sim is blocked too.
    const c4a = await page.evaluate(() => { const s = YAM.game, p = s.bench().find(x => x.position !== 'GK' && !x.hasFlag('Promised_Start') && s.lineSwapSlot(x));
      p.flags.push('Promised_Start'); p.promiseBy = 'pool'; p.promiseChoice = null; const r = { p: p.id, par: s.rep.parents, b: s.budget };
      YAM.ui.events.fire('promise', s.calendar.date, { cast: { kid: p.id } }); YAM.ui.events.view.finishTyping(); r.text = document.getElementById('talk-text').textContent; return r; });
    await talkUp(); await pick(0);
    const c4b = await page.evaluate(r => { const s = YAM.game, q = s.starters().find(x => x.position !== 'GK' && !x.hasFlag('Promised_Start'));
      const o = { starter: s.isStarter(r.p), par: s.rep.parents - r.par, q: q.id, b: s.budget };
      q.flags.push('Promised_Start'); q.promiseBy = 'pool'; q.promiseChoice = null; s.dayState().locker.done = true;
      YAM.ui.onInstantSim();   // Quick Sim: the card must be answered first
      o.blocked = !YAM.ui.engine && s.pendingEvent?.id === 'promise' && s.phase === 'matchday'; o.full = L.t('ev.promise.textPool', { k: L.name(s.player(r.p).name) });
      return o; }, c4a);
    await talkUp(); await pick(1);
    const c4c = await page.evaluate(r => { const s = YAM.game, q = s.player(r.q);
      const o = { away: q.awayDays, starter: s.isStarter(r.q), par: s.rep.parents, b: s.budget, choice: q.promiseChoice, diary: s.diary.some(d => d.key === 'ev.promise.breakPool.diary') };
      YAM.ui.checkPromises(); q.awayDays = 0; s.save(); return o; }, c4b);
    check('v3.22 pool promise card: "…that his son would play"; keep → he starts, no Parents −2; Quick Sim blocked until answered; break → kept at home 10 days, out of the XI, no refund',
      c4a.text.startsWith(c4b.full) && c4b.starter && c4b.par === 0 && c4b.blocked && c4c.away === 10 && !c4c.starter && c4c.par === c4a.par && c4c.b === c4b.b && c4c.choice === 'break' && c4c.diary,
      JSON.stringify({ c4a: { ...c4a, text: c4a.text.slice(0, 60) }, c4b, c4c }));
    // after a showcase match the scout's return is queued (chance forced to 1): the best showcased kid who played, 28–42 days later
    const c5 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, keep = EVENTS_CFG.POACH_CHANCE; EVENTS_CFG.POACH_CHANCE = 1; EVENTS_CFG.SHOWCASE_INJURY = 0;
      const show = s.starters().filter(p => p.position !== 'GK').slice(0, 3); show.forEach(p => { if (!p.hasFlag('Showcase')) p.flags.push('Showcase'); });
      s.eventLog = s.eventLog.filter(e => e.id !== 'scoutpoach'); s.eventQueue = [];
      const date = s.calendar.date; ui.onInstantSim(); EVENTS_CFG.POACH_CHANCE = keep;
      const q = s.eventQueue.find(x => x.id === 'scoutpoach'), played = show.filter(p => s.lastReport?.players?.some(r => r.id === p.id && r.min > 0) || true);
      const best = [...show].sort((a, b) => b.overall - a.overall)[0];
      return { phase: s.phase, q, best: best.id, gap: q ? isoDays(date, q.due) : null };
    });
    await calm();
    check('v3.22 after a showcase match "scoutpoach" is queued (chance forced to 1) for the best showcased kid who played, 28–42 days later',
      !!c5.q && c5.q.cast?.kid === c5.best && !c5.q.matchDay && c5.gap >= 28 && c5.gap <= 42, JSON.stringify(c5));
    // the poach dialogue: refusal first (morale −10, Parents −2); let go (leaves the squad, +$150, Parents +3, Squad −2); talk [1 AP] (inactive at 0 AP, the outcome shown before moving on)
    const poach = async (fn, arg) => { const r = await page.evaluate(fn, arg); await talkUp(); return r; };
    const p1 = await poach(() => { const s = YAM.game, k = [...s.squad].sort((a, b) => b.overall - a.overall).find(p => p.position !== 'GK'); k.dyn.morale = 60; s.rep.parents = 50; s.rep.squad = 50;
      YAM.ui.events.fire('scoutpoach', s.calendar.date, { cast: { kid: k.id } }); return { k: k.id, n: s.squad.length,
        btns: [...document.querySelectorAll('#talk-choices .talk-btn')].map(b => b.className.match(/tone-(\w+)/)[1]) }; });
    await pick(0);
    const p1b = await page.evaluate(k => ({ mor: YAM.game.player(k)?.dyn.morale, par: YAM.game.rep.parents, here: !!YAM.game.player(k), closed: !YAM.game.pendingEvent }), p1.k);
    const p2 = await poach(() => { const s = YAM.game, k = s.bench().find(p => p.position !== 'GK') || s.squad.find(p => p.position !== 'GK' && p.id !== s.lineup[0]);
      s.rep.parents = 50; s.rep.squad = 50; const r = { k: k.id, n: s.squad.length, b: s.budget, blk: s.expelBlock(k.id) };
      YAM.ui.events.fire('scoutpoach', s.calendar.date, { cast: { kid: k.id } }); return r; });
    await pick(2);
    const p2b = await page.evaluate(r => { const s = YAM.game, g = s.globalPlayers.find(p => p.id === r.k);
      return { gone: !s.player(r.k), n: s.squad.length, b: s.budget - r.b, par: s.rep.parents, sq: s.rep.squad, team: g?.teamId, xi: s.lineup.length === 11 && s.lineup.every(id => s.player(id)),
        diary: s.diary.at(-1).key }; }, p2);
    const p3 = await poach(() => { const s = YAM.game, k = s.squad.find(p => p.position !== 'GK' && p.id !== s.lineup[0]); s.weekState().ap = 0;
      YAM.ui.events.fire('scoutpoach', s.calendar.date, { cast: { kid: k.id } }); return { k: k.id }; });
    await finishTyping();
    const p3a = await page.evaluate(() => { const b = document.querySelector('#talk-choices .talk-btn[data-i="1"]'); return { dis: b.disabled, ap: !!b.querySelector('.tb-ap') }; });
    await page.click('#talk-choices .talk-btn[data-i="1"]', { force: true }); await page.waitForTimeout(40);   // disabled: nothing happens
    const p3b = await page.evaluate(() => ({ step: YAM.game.pendingEvent?.step, open: !document.getElementById('talk-layer').hidden }));
    await page.evaluate(() => { const s = YAM.game; s.pendingEvent = null; YAM.ui.events.view.close(); s.weekState().ap = 1; });
    const p4 = await poach(k => { const s = YAM.game, p = s.player(k); p.dyn.morale = 70; s.rep.parents = 50; s.rep.squad = 50;
      YAM.ui.events.fire('scoutpoach', s.calendar.date, { cast: { kid: k } }); return { k, b: s.budget, n: s.squad.length }; }, p3.k);
    await pick(1);
    await finishTyping();
    const p4a = await page.evaluate(() => ({ step: YAM.game.pendingEvent?.step, ap: YAM.game.ap, open: !document.getElementById('talk-layer').hidden,
      n: document.querySelectorAll('#talk-choices .talk-btn').length, text: document.getElementById('talk-text').textContent.length }));
    await pick(0);
    const p4b = await page.evaluate(r => { const s = YAM.game, p = s.player(r.k);
      return { closed: !s.pendingEvent, here: !!p, mor: p?.dyn.morale, b: s.budget - r.b, par: s.rep.parents, sq: s.rep.squad }; }, p4);
    const talkOk = p4a.step === 'stay' ? p4b.here && p4b.mor === 75 && p4b.b === 0 : !p4b.here && p4b.b === 150 && p4b.par === 50 && p4b.sq === 48;
    check('v3.22 scoutpoach: refusal first → morale −10, Parents −2; let go → leaves the squad (big club), +$150, Parents +3, Squad −2, XI repaired; talk = [1 AP], inactive at 0 AP, the family\'s answer shown before moving on',
      p1.btns.join() === 'gray,green,green' && p1b.mor === 50 && p1b.par === 48 && p1b.here && p1b.closed && p2.blk === null && p2b.gone && p2b.n === p2.n - 1 && p2b.b === 150 && p2b.par === 53
      && p2b.sq === 48 && p2b.team === 'big_club' && p2b.xi && p2b.diary === 'ev.scoutpoach.c.diary' && p3a.dis && p3a.ap && p3b.step === 'start' && p3b.open
      && ['stay', 'leave'].includes(p4a.step) && p4a.ap === 0 && p4a.open && p4a.n === 1 && p4a.text > 20 && p4b.closed && talkOk, JSON.stringify({ p1, p1b, p2, p2b, p3a, p3b, p4a, p4b }));
    // the pub pool gets found out (leak forced): Board −4, Parents −2, an IMPORTANT briefing line + diary — no dialogue
    await page.evaluate(() => { const s = YAM.game; EVENTS_CFG.__leak = EVENTS_CFG.POOL_LEAK_CHANCE; EVENTS_CFG.POOL_LEAK_CHANCE = 1; s.eventQueue = []; YAM.ui.events.fire('pool'); });
    await talkUp(); await pick(1);
    const c7 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, q = s.eventQueue.find(x => x.id === 'poolleak'), gap = q ? isoDays(s.calendar.date, q.due) : null;
      EVENTS_CFG.POOL_LEAK_CHANCE = EVENTS_CFG.__leak;
      s.eventQueue = q ? [{ ...q, due: s.calendar.date }] : []; s.rep.board = 50; s.rep.parents = 50; s.away = [];
      const paused = ui.events.roll(s.calendar.date, { resume: false });
      const a = MorningBriefing.awayLines(s, s.calendar.date), line = s.diary.at(-1);
      const r = { gap, paused, board: s.rep.board, par: s.rep.parents, key: line.key, imp: a.imp.some(e => e.key === 'ev.poolleak.diary'), dlg: !!s.pendingEvent, q: s.eventQueue.length,
        ru: I18N.ru['ev.poolleak.diary'] };
      s.away = null; s.save(); return r;
    });
    check('v3.22 pool money with the leak forced: queued 5–14 days later; then Board −4, Parents −2, an important briefing line + diary, no dialogue',
      c7.gap >= 5 && c7.gap <= 14 && !c7.paused && c7.board === 46 && c7.par === 48 && c7.key === 'ev.poolleak.diary' && c7.imp && !c7.dlg && c7.q === 0 && /тотализатор/.test(c7.ru), JSON.stringify(c7));
    // old saves: Promised_Start + promiseBy (no promiseChoice) → the card on the next match day; a queued scoutvisit survives the load
    const c8 = await page.evaluate(() => {
      const s = YAM.game; s.save();
      const raw = localStorage.getItem('yam_save_v1'), d = JSON.parse(raw), k = d.squad.find(p => p.id !== d.lineup[0]);
      k.flags = [...(k.flags || []), 'Promised_Start']; k.promiseBy = 'dad'; delete k.promiseChoice;
      d.eventQueue = [{ id: 'scoutvisit', due: d.calendar.date, matchDay: true, from: 'scout' }];
      localStorage.setItem('yam_save_v1', JSON.stringify(d));
      const g = new YAM.game.constructor(); localStorage.setItem('yam_save_v1', raw);
      const p = g.player(k.id), r = { flag: p.hasFlag('Promised_Start'), by: p.promiseBy, choice: p.promiseChoice, q: g.eventQueue.map(x => x.id).join() };
      g.phase = 'matchday'; p.injuryDays = 0; p.awayDays = 0; p.suspensionMatches = 0; p.absentToday = null; r.card = g.promiseCardKid()?.id === k.id;
      return r;
    });
    const c8b = await page.evaluate(() => { const s = YAM.game; s.eventQueue = [{ id: 'scoutvisit', due: s.calendar.date, matchDay: true, from: 'scout' }];
      const due = YAM.ui.events.takeDue(s.calendar.date, true), ok = YAM.ui.events.fire(due.id, s.calendar.date, { cast: due.cast });
      return { ok, id: s.pendingEvent?.id, tones: [...document.querySelectorAll('#talk-choices .talk-btn')].map(b => b.className.match(/tone-(\w+)/)[1]).join() }; });
    await page.evaluate(() => { const s = YAM.game; s.pendingEvent = null; YAM.ui.events.view.close(); s.save(); });
    check('v3.22 old save with Promised_Start + promiseBy loads and gets the card on the next match day; an old queued scoutvisit still fires (showcase first, refusal = debt second)',
      c8.flag && c8.by === 'dad' && c8.choice === null && c8.q === 'scoutvisit' && c8.card && c8b.ok && c8b.id === 'scoutvisit' && c8b.tones === 'gray,red', JSON.stringify({ c8, c8b }));
    // autoSim({ policy: 'greedy' }) plays 8 weeks without getting stuck (money offers boosted ×4, events on)
    await calm();
    const g0 = await page.evaluate(() => { const s = YAM.game; YAM.ui.events.enabled = true; s.excusesOff = false; window.__ec = { ...EVENTS_CFG };
      for (const k of ['DAD_CHANCE', 'SCOUT_CHANCE', 'POOL_CHANCE']) EVENTS_CFG[k] *= 4; s.eventLog = [];
      return { md: s.league.playedMatchdays(), b: s.budget }; });
    let gstuck = 0, gi = 0;
    for (; gi < 120; gi++) {
      const st = await page.evaluate(() => ({ phase: YAM.game.phase, md: YAM.game.league.playedMatchdays() }));
      if ((st.md >= g0.md + 8 && st.phase === 'calendar') || st.phase === 'seasonEnd') break;
      await page.evaluate(() => YAM.ui.autoSim({ policy: 'greedy' }));
      try { await page.waitForFunction(() => !YAM.ui.cal.running && !YAM.ui.events.view.autoT && (YAM.game.phase !== 'calendar' || !YAM.game.pendingEvent), null, { timeout: 20000, polling: 20 }); }
      catch (e) { gstuck++; break; }
    }
    const g1 = await page.evaluate(() => { const s = YAM.game; Object.assign(EVENTS_CFG, window.__ec); YAM.ui.autoPolicy = null;
      return { md: s.league.playedMatchdays(), phase: s.phase, taken: s.eventLog.filter(e => ['ev.dad.a', 'ev.scout.a', 'ev.pool.a'].includes(e.choice)).length,
        flags: s.squad.filter(p => p.hasFlag('Promised_Start') && p.promiseChoice).length }; });
    check('v3.22 autoSim({ policy: "greedy" }) plays 8 weeks (offers ×4) without getting stuck, takes the money offers, answers the promise cards',
      !gstuck && (g1.md >= g0.md + 8 || g1.phase === 'seasonEnd') && g1.taken > 0, JSON.stringify({ g0, g1, gi, gstuck }));
    await calm();
    }
    // ===== v3.23 NOT BLIND: the man of the match in the Notebook, keepers keep their gloves, yard clues, a skipped Coach's Word, windows that open by themselves =====
    {   // block scope: the v3.23 names never clash with older checks
    const v323calm = () => page.evaluate(() => { const s = YAM.game, ui = YAM.ui; ui.autoReview = false; ui.autoAfter = false; ui.events.enabled = false; s.excusesOff = true;
      s.eventQueue = []; s.pendingEvent = null; ui.events.view?.layer && (ui.events.view.layer.hidden = true); ui.modal.close(); ui.profile.close(); ui.debug.close(); ui.locker.close?.();
      ui.afterView.layer.hidden = true; ui.reviewView.layer.hidden = true; });
    // the next league match by Quick Sim: 'win' = Force Win, 'loss' = the same bonus turned around for this one match (our kids' hidden truth untouched)
    const v323toPost = async mode => {
      for (let t = 0; t < 4; t++) {
        await v323calm();
        await page.evaluate(() => { const s = YAM.game, ui = YAM.ui;
          if (s.phase === 'post') { s.afterAuto(); if (s.reviewPending) s.reviewPick(0); if (s.talkPending) s.applyTeamTalk('praise'); ui.closeMatchday(); }
          if (s.phase === 'seasonEnd') ui.onDashAction();
          if (s.phase === 'calendar') ui.autoSim(); });
        await page.waitForFunction(() => YAM.game.phase === 'matchday' || (YAM.game.pendingEvent && !document.getElementById('talk-layer').hidden), null, { timeout: 30000 });
        const res = await page.evaluate(m => { const s = YAM.game, ui = YAM.ui, ME = YAM.MatchEngine, orig = ME.prototype.modParts;
          ui.modal.close(); ui.locker.close?.(); ui.briefing.close?.();
          s.dayState().locker = { done: true, absent: {}, checked: [] }; s.cheats.forceWin = m === 'win';
          if (m === 'loss') ME.prototype.modParts = function (side, role) { const o = orig.call(this, side, role), c = side === 0 ? -8 : 5; return { ...o, cheat: c, v: o.v + c }; };
          window.__armed = true;   // 1st pickMotm of this match = the report's (see the shuffle rig below)
          try { ui.onInstantSim(); } finally { ME.prototype.modParts = orig; }
          ui.modal.close(); ui.summary.close?.();
          return s.lastReport?.result; }, mode);
        if (mode !== 'loss' || res === 'L') return res;
      }
      return null;
    };
    const rvShown = () => page.evaluate(() => !document.getElementById('review-view').hidden);
    const afShown = () => page.evaluate(() => !document.getElementById('after-view').hidden);

    // the rig: for the report-building window (pickMotm → recordMatchClues) Math.random returns ≈1 → shuffle(played) is the identity
    // → the Notebook's three are the first three of `played`; consumption is counted (new code must add none)
    await page.evaluate(() => {
      const R = Math.random; let cnt = 0, fix = false, c0 = 0;
      Math.random = () => { cnt++; return fix ? 0.9999999 : R(); };
      window.__rnd = { pick: [], win: [] }; window.__armed = false;
      const pm = GameState.prototype.pickMotm, rm = GameState.prototype.recordMatchClues;
      GameState.prototype.pickMotm = function (...a) { const b = cnt, r = pm.apply(this, a); window.__rnd.pick.push(cnt - b); if (window.__armed) { window.__armed = false; fix = true; c0 = cnt; } return r; };
      GameState.prototype.recordMatchClues = function (...a) { if (fix) { fix = false; window.__rnd.win.push(cnt - c0); } return rm.apply(this, a); };
    });

    // 1. a win: the man of the match is one of the Notebook's three whatever the shuffle did, ☆ on his card, a clue from THIS match; REVIEW goes to him
    let m1 = null;
    for (let t = 0; t < 6; t++) {
      const res = await v323toPost('win');
      m1 = await page.evaluate(() => {
        const s = YAM.game, ui = YAM.ui, e = ui.engine, rep = s.lastReport;
        const played = e.sides[0].all.filter(p => e.everPlayed.has(p.id)), ids = rep.players.map(p => p.id), sample = played.slice(0, 3).map(p => p.id);
        const p = s.player(rep.motm), c = p?.clues.at(-1), mc = p?.clues.find(x => x.source === 'match' && x.ref === rep.md && x.date === s.calendar.date);   // (c can be the "he lit up" review clue written after it)
        const out = { forced: !!rep.motm && !sample.includes(rep.motm), motm: !!rep.motm, three: ids.length === 3, last: ids[2] === rep.motm, keep2: ids[0] === sample[0] && ids[1] === sample[1],
          rnd: window.__rnd.win.at(-1) === played.length - 1, pick0: window.__rnd.pick.every(d => d === 0),   // the shuffle used exactly n − 1 numbers; pickMotm none
          outfield: e.lineOf.get(rep.motm) !== 'GK' && !GameState.isKeeper(p), rv: s.review?.pid === rep.motm, clue: !!mc,
          pr: !!rep.players.find(x => x.id === rep.motm)?.clue, played: played.length };
        ui.show('notes'); ui.renderNotebook();
        const card = document.querySelector(`#notes-body .card[data-pid="${rep.motm}"]`), marks = document.querySelectorAll('#notes-body .card .motm');
        out.star = marks.length === 1 && !!card?.querySelector('.motm') && /☆/.test(card.querySelector('.motm').textContent) && card.querySelector('.motm').textContent.includes(L.t('nb.motm'));
        out.ru = I18N.ru['nb.motm'] === 'Лучший в матче' && !!I18N.ru['nb.cluesKeeper'];
        out.shown = !!c && card?.querySelector('.nb-clues li .cl-t')?.textContent === clueText(c);   // newest clue first = this match's
        out.noAuto = document.getElementById('review-view').hidden;   // Quick Sim with the word still owed: nothing pops up over the chance to give it
        ui.reviewView.open();
        out.rvClue = !!mc && [...document.querySelectorAll('#rv-kid .rv-clues li .cl-t')].some(x => x.textContent === clueText(mc)) && document.querySelector('#rv-kid .rv-clues li .cl-t')?.textContent === clueText(c) && document.getElementById('rv-kid').textContent.includes(L.name(p.name));   // this match's line is in REVIEW's clue block
        ui.reviewView.layer.hidden = true;
        out.res = rep.result;
        return out;
      });
      if (res === 'W' && m1.forced) break;
    }
    await shot('23-motm');
    check('v3.23 the man of the match is always one of the Notebook\'s three (he replaces the last), marked ☆, with a clue from this match; REVIEW goes to the same kid; the shuffle used exactly n−1 random numbers and pickMotm none',
      m1.res === 'W' && m1.forced && m1.motm && m1.three && m1.last && m1.keep2 && m1.rnd && m1.pick0 && m1.outfield && m1.rv && m1.clue && m1.pr && m1.star && m1.ru && m1.shown && m1.rvClue, JSON.stringify(m1));

    // 2. REVIEW after a win opens by itself once the word is given and the Notebook shows; a Quick Sim with the word owed waits; the word costs / pays as before, no extra −1 later; a reload does not re-open it, the Notebook button does
    const w1 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, rep = s.lastReport, sq0 = s.rep.squad, out = { pending: s.talkPending, hidden: document.getElementById('review-view').hidden };
      s.applyTeamTalk('praise'); out.fx = s.rep.squad === Math.min(100, sq0 + TEAM_TALK.praise.W.squad);
      ui.autoOpenedFor = null; ui.show('notes');
      out.open = !document.getElementById('review-view').hidden && s.reviewPending && !s.afterPending && s.review.mode === 'win';
      out.once = ui.autoOpenedFor === rep;
      ui.reviewView.layer.hidden = true; ui.show('notes');   // minimised, the Notebook shown again: not re-opened by itself
      out.notTwice = document.getElementById('review-view').hidden;
      ui.renderNotebook(); { const tmp = document.createElement('div'); tmp.innerHTML = L.t('notes.backReview'); out.label = document.getElementById('btn-back')?.textContent.includes(tmp.textContent.trim()); }
      return out;
    });
    await page.reload();
    await page.waitForFunction(() => window.YAM && YAM.ui);
    await page.evaluate(() => { YAM.ui.autoReview = false; YAM.ui.autoAfter = false; YAM.ui.events.enabled = false; });
    const w2 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, out = { post: s.phase === 'post' && s.reviewPending };
      ui.show('notes'); ui.renderNotebook();
      out.notAuto = document.getElementById('review-view').hidden;   // a reload never re-opens it by itself
      document.getElementById('btn-back').click();   // the Notebook button = the way back
      out.btn = !document.getElementById('review-view').hidden;
      const sq = s.rep.squad;
      s.reviewSkip(); ui.reviewView.layer.hidden = true; ui.closeMatchday();   // the word was given: closing the day takes nothing more
      out.noMinus = s.rep.squad === sq && s.phase !== 'post';
      return out;
    });
    check('v3.23 win → REVIEW.EXE opens by itself when the Notebook first shows after the Coach\'s Word (not while a Quick Sim\'s word is still owed), once; after a reload it stays closed and the Notebook button opens it; a given word is never charged the −1',
      w1.pending && w1.hidden && w1.fx && w1.open && w1.once && w1.notTwice && w1.label && w2.post && w2.notAuto && w2.btn && w2.noMinus, JSON.stringify({ w1, w2 }));

    // 3. a loss: Quick Sim + closing the matchday without the word → Squad −1 and the new diary line; AFTER_GAME opens by itself after the word on the next loss
    const l1res = await v323toPost('loss');
    const l1 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, rep = s.lastReport, sq0 = s.rep.squad, out = { res: rep.result === 'L', instant: rep.instant, owed: s.talkPending, af: s.afterPending };
      ui.show('notes'); out.noAuto = document.getElementById('after-view').hidden;
      out.nb = !!document.querySelector('#notes-body .nb-talk.pending') && document.querySelector('#notes-body .nb-talk').textContent.includes(L.t('tt.nbPending')) && !/\d/.test(L.t('tt.nbPending'));
      ui.closeMatchday();   // the word never given
      out.minus = s.rep.squad === sq0 + TEAM_TALK.SKIP_SQUAD && rep.talk === 'none' && TEAM_TALK.SKIP_SQUAD === -1;
      out.diary = s.diary.some(d => d.key === 'tt.skipped') && I18N.en['tt.skipped'] === 'You went home without a word to the boys.' && I18N.ru['tt.skipped'] === 'Ты ушёл, не сказав ребятам ни слова.';
      out.still = s.phase === 'post' && !document.getElementById('after-view').hidden;   // [ CONTINUE ] still stops at AFTER_GAME
      return out;
    });
    check('v3.23 Quick Sim without the Coach\'s Word: closing the matchday costs Squad −1 and writes "You went home without a word to the boys"; the Notebook reminder says the boys are waiting (no numbers); the loss window still waits at [ CONTINUE ]',
      l1res === 'L' && l1.res && l1.instant && l1.owed && l1.af && l1.noAuto && l1.nb && l1.minus && l1.diary && l1.still, JSON.stringify(l1));
    const l2res = await v323toPost('loss');
    const l2 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, rep = s.lastReport, out = { res: rep.result === 'L', af: s.after?.mode === 'loss' };
      s.applyTeamTalk('tough'); ui.autoOpenedFor = null; ui.show('notes');
      out.open = !document.getElementById('after-view').hidden && document.getElementById('review-view').hidden && s.afterPending;
      out.cards = document.querySelectorAll('#after-view .af-card').length === 3;
      return out;
    });
    check('v3.23 loss → AFTER_GAME.EXE opens by itself at the same moment as REVIEW after a win (Notebook first shown after the word)', l2res === 'L' && l2.res && l2.af && l2.open && l2.cards, JSON.stringify(l2));

    // 4. a draw (the v3.20 way: the post-match state rebuilt as a draw) → the praise / listen window opens by itself
    await v323calm();
    const d1 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, e = ui.engine, rep = s.lastReport;
      s.afterAuto(); ui.afterView.layer.hidden = true; s.after = null; s.review = null;   // (the loss's window is done)
      rep.result = 'D'; rep.gf = rep.ga;
      const played = e.sides[0].all.filter(p => e.everPlayed.has(p.id)).map(p => [p.id, { ...e.st(p) }]);
      s.startReview('D', played.filter(([id]) => !GameState.isKeeper(s.player(id)) && e.lineOf.get(id) !== 'GK'), s.calendar.date, rep.md); s.startAfter('D', played, e.matchEvents, s.calendar.date, rep.md);
      ui.autoOpenedFor = null; ui.show('notes');
      return { open: !document.getElementById('after-view').hidden, mode: s.after?.mode === 'draw', rv: s.review?.mode === 'draw', rvHidden: document.getElementById('review-view').hidden,
        opts: JSON.stringify([...document.querySelectorAll('#after-view #af-body [data-act]')].map(b => b.dataset.act)) === '["praise","listen"]' };
    });
    check('v3.23 draw → the praise / listen window opens by itself (REVIEW draw mode waits behind it), no hunting for the "After the game" button', d1.open && d1.mode && d1.rv && d1.rvHidden && d1.opts, JSON.stringify(d1));
    await page.evaluate(() => { const s = YAM.game, ui = YAM.ui; s.afterAuto(); if (s.reviewPending) s.reviewPick(0); ui.afterView.layer.hidden = true; ui.reviewView.layer.hidden = true; ui.closeMatchday(); });

    // 5. keepers keep their gloves: REVIEW never goes to a kid tagged GK, reviewPool is empty for him (a held role stays), his Notebook card says so, no free "give / swap"
    const k1 = await page.evaluate(() => {
      const s = YAM.game, ui = YAM.ui, [g, a, b] = s.squad.filter(p => p.tag !== 'GK'), keep = { tag: g.tag, roles: g.roles, clues: g.clues, review: s.review, loss: s.lossStreak, aRoles: a.roles, aClues: a.clues, nb: s.notebookUnlocked };
      g.tag = 'GK'; g.roles = []; g.clues = []; a.roles = [];
      const big = { passOk: 30, saves: 12, goals: 0 }, mid = { passOk: 20, tackles: 4 }, low = { passOk: 4 };
      const out = {};
      const rv = s.startReview('W', [[g.id, big], [a.id, mid], [b.id, low]], '2005-03-01', 7);   // (he is the best rated of them all)
      out.pid = rv?.pid === a.id && matchRating(big) > matchRating(mid);
      out.noGK = !s.startReview('W', [[g.id, big]], '2005-03-02', 8);   // only the keeper played → no REVIEW
      out.pool = s.reviewPool(g).length === 0 && s.reviewPool(a).length > 0;
      g.roles = [{ id: 'Playmaker', level: 1, m: 0 }];   // an old save: a keeper who already holds a role
      const o = s.rethinkOptions(g);
      out.held = rolesOf(g).length === 1 && s.reviewPool(g).length === 0 && o.remove.length === 1 && o.swap.length === 0 && o.give.length === 0;
      g.roles = [];
      const o2 = s.rethinkOptions(g); out.give = o2.give.length === 0 && s.rethinkOptions(a).give.length > 0;
      // his Notebook card
      const rep = s.lastReport, was = rep.players; rep.players = [{ id: g.id, stats: { passOk: 1, passFail: 0, tackles: 0, tacklesLost: 0, dribbleOk: 0, dribbleFail: 0, intercepts: 0, shots: 0, onTarget: 0, goals: 0, saves: 3, yellow: 0, red: 0 }, gk: true, roles: [] },
        { id: a.id, stats: { passOk: 1, passFail: 0, tackles: 0, tacklesLost: 0, dribbleOk: 0, dribbleFail: 0, intercepts: 0, shots: 0, onTarget: 0, goals: 0, saves: 0, yellow: 0, red: 0 }, gk: false, roles: [] }];
      a.clues = [];
      s.notebookUnlocked = true; const ph = s.phase; s.phase = 'post'; ui.renderNotebook();
      const cards = [...document.querySelectorAll('#notes-body .card')], gc = cards.find(c => c.dataset.pid === g.id), ac = cards.find(c => c.dataset.pid === a.id);
      out.card = !!gc && gc.querySelector('.nb-clues').textContent.includes(L.t('nb.cluesKeeper')) && !gc.querySelector('.nb-clues').textContent.includes(L.t('nb.cluesNone'))
        && gc.textContent.includes(L.t('nb.saves', { a: 3, b: s.seasonOf(g.id).saves })) && !!ac && ac.querySelector('.nb-clues').textContent.includes(L.t('nb.cluesNone'));
      rep.players = was; s.phase = ph; s.notebookUnlocked = keep.nb; g.tag = keep.tag; g.roles = keep.roles; g.clues = keep.clues; s.review = keep.review; s.lossStreak = keep.loss; a.roles = keep.aRoles; a.clues = keep.aClues;
      ui.renderNotebook();
      return out;
    });
    check('v3.23 keepers: a kid tagged GK is never the man of the match for REVIEW (the best outfield kid is), reviewPool is empty for him, a role he already holds stays (Remove still works), no free give / swap, his Notebook card shows "Keeper — roles aren\'t for him yet" instead of "No clues yet" (saves line stays)',
      k1.pid && k1.noGK && k1.pool && k1.held && k1.give && k1.card, JSON.stringify(k1));

    // 6. yard clues: signed kids carry their notes as clues (mapping in YARD.SIGNAL), only role signals write one; confirmation rules; old saves get them once, cap respected
    const y1 = await page.evaluate(() => {
      const s = YAM.game, out = {};
      out.map = JSON.stringify(YARD.SIGNAL) === JSON.stringify({ pass: 'pass', tackle: 'duel', dribble: 'solo', shot: 'finish', engine: 'run' }) && ['pace', 'strong', 'hands', 'quiet'].every(k => !YARD.SIGNAL[k]);
      out.texts = Object.keys(YARD.SIGNAL).every(k => I18N.en['clue.yard.' + k] && I18N.ru['clue.yard.' + k]) && !!I18N.en['clue.src.yard'] && !!I18N.ru['clue.src.yard'] && !!CLUES.SOURCES.yard;
      out.draft = /addYardClues/.test(GameState.prototype.finishDraft.toString());
      // free agents stand in for the signed kids: the same function finishDraft calls
      const pool = s.globalPlayers.filter(p => p.teamId === 'free_agent').slice(0, 40), date = '2002-09-01';
      let withNote = 0, none = 0, exact = true, flags = true, born = true;
      for (const p of pool) {
        p.clues = []; p.yardDone = false; s.addYardClues(p, date);
        const want = DraftView.notes(p).filter(k => YARD.SIGNAL[k]), got = p.clues;
        if (want.length) withNote++; else none++;
        if (got.length !== want.length || want.some((k, i) => got[i].source !== 'yard' || got[i].ref !== 'draft' || got[i].date !== date || got[i].signal !== YARD.SIGNAL[k] || got[i].textKey !== 'clue.yard.' + k)) exact = false;
        if (!p.yardDone || !got.every(c => c.seen)) born = false;
        s.addYardClues(p, date); if (p.clues.length !== got.length) flags = false;   // one-shot
      }
      out.exact = exact && born && flags; out.mix = withNote > 0 && none >= 0 && pool.length === 40;
      // confirmation: yard ↔ match with the same signal → both ✓; two yard clues of one kid are one event
      const mk = (source, ref, date, signal) => ({ source, ref, date, signal, textKey: 'x', seen: true });
      const yy = [mk('yard', 'draft', date, 'pass'), mk('yard', 'draft', date, 'pass')], ym = [mk('yard', 'draft', date, 'pass'), mk('match', 3, '2002-09-20', 'pass'), mk('match', 4, '2002-09-27', 'duel')];
      out.conf = !clueConfirmed(yy, yy[0]) && !clueConfirmed(yy, yy[1]) && clueConfirmed(ym, ym[0]) && clueConfirmed(ym, ym[1]) && !clueConfirmed(ym, ym[2]);
      return out;
    });
    // the same, through the real draft: at its start every signed kid carries exactly his mapped notes (checked in the draft check above)
    // old saves: a squad without yard clues (or the flag) gets them on load, once; no duplicates on the second load; the cap drops the oldest (yard) first
    const o1 = await page.evaluate(() => {
      const s = YAM.game, [a, b, c] = s.squad, season = `${s.season}-${SEASON.START_MONTH_DAY}`, out = {};
      const wantN = p => DraftView.notes(p).filter(k => YARD.SIGNAL[k]).length;
      // find kids with ≥ 1 mapped note so the check means something (the squad is the same 15 as the draft)
      const withNote = s.squad.filter(p => wantN(p) > 0);
      for (const p of s.squad) { p.yardDone = false; p.clues = p.clues.filter(x => x.source !== 'yard'); }
      const before = Object.fromEntries(s.squad.map(p => [p.id, p.clues.length]));
      s.save(); out.saved = /"yardDone":false/.test(localStorage.getItem('yam_save_v1'));
      return { withNote: withNote.map(p => p.id), before, season, wantN: Object.fromEntries(s.squad.map(p => [p.id, wantN(p)])), out };
    });
    await page.reload();
    await page.waitForFunction(() => window.YAM && YAM.ui);
    await page.evaluate(() => { YAM.ui.autoReview = false; YAM.ui.autoAfter = false; });
    const o2 = await page.evaluate(o1 => {
      const s = YAM.game, out = { ok: true, dated: true, cap: true, oldest: true }, cl = Object.fromEntries(s.squad.map(p => [p.id, p.clues.length]));
      for (const p of s.squad) {
        const yard = p.clues.filter(c => c.source === 'yard'), want = o1.wantN[p.id], room = CLUES.MAX_PER_KID;
        if (p.clues.length > room) out.cap = false;
        if (!p.yardDone) out.ok = false;
        if (yard.some(c => c.date !== o1.season || c.ref !== 'draft')) out.dated = false;
        if (o1.before[p.id] + want <= room ? yard.length !== want : p.clues.length !== room) out.ok = false;   // everything fits, or the cap trimmed the yard clues (the oldest)
        if (p.clues.some((c, i) => c.source === 'yard' && p.clues.slice(0, i).some(x => x.source !== 'yard'))) out.oldest = false;   // yard clues sit at the old end
      }
      out.snapshot = JSON.stringify(Object.entries(cl).map(([k, v]) => [k, v, s.player(k).clues.map(c => c.textKey).join()]));
      return out;
    }, o1);
    await page.reload();   // a second load: no duplicates
    await page.waitForFunction(() => window.YAM && YAM.ui);
    await page.evaluate(() => { YAM.ui.autoReview = false; YAM.ui.autoAfter = false; });
    const o3 = await page.evaluate(snap => JSON.stringify(Object.entries(Object.fromEntries(YAM.game.squad.map(p => [p.id, p.clues.length]))).map(([k, v]) => [k, v, YAM.game.player(k).clues.map(c => c.textKey).join()])) === snap, o2.snapshot);
    check('v3.23 yard clues: a signed kid\'s notes become clues (🏟 "Yard match", pass → pass, tackle → duel, dribble → solo, shot → finish, engine → run; pace / strong / hands / quiet write nothing, no second WRONG roll); a yard clue and a match clue with the same signal confirm each other, two yard clues do not',
      y1.map && y1.texts && y1.draft && y1.exact && y1.mix && y1.conf, JSON.stringify(y1));
    check('v3.23 old save without yard clues: they are added on load (dated the season start, oldest in the list), no duplicates on the second load, the 8-clue cap is respected (yard clues drop first)',
      o1.out.saved && o1.withNote.length > 0 && o2.ok && o2.dated && o2.cap && o2.oldest && o3, JSON.stringify({ o1: { ...o1, before: undefined, wantN: undefined }, o2: { ...o2, snapshot: undefined }, o3 }));
    // restore the smoke's standing flags (the reloads dropped the random rig and the pickMotm / recordMatchClues wrappers)
    await page.evaluate(() => { YAM.ui.autoReview = true; YAM.ui.autoAfter = true; });
    }

    /* ---------- v3.24 "LOOSE ENDS" ---------- */
    {   // block scope: the v3.24 names never clash with older checks
      await page.evaluate(() => { for (const v of ['locker', 'planner', 'briefing', 'kassa']) if (YAM.ui[v].isOpen) YAM.ui[v].layer.hidden = true; YAM.ui.modal.close(); });
      // (1) headlines: no id twice within NEWS.CD_DAYS over a simulated month (marked as read every morning); an empty filtered pool → no headline
      const h = await page.evaluate(() => {
        const s = YAM.game, b = YAM.ui.briefing, keep = JSON.stringify(s.newsSeen || {}), last = {};
        s.newsSeen = {};
        let ok = true, shown = 0, stable = true;
        for (let i = 0; i < 31; i++) {
          const d = isoAdd('2002-10-01', i);
          b.news(d); const ids = b.newsIds; b.news(d); if (b.newsIds.join() !== ids.join()) stable = false;   // the same morning re-rendered = the same lines
          for (const id of ids) { if (last[id] && isoDays(last[id], d) < NEWS.CD_DAYS) ok = false; last[id] = d; }
          s.markHeadlines(ids, d); shown += ids.length;
        }
        for (const id of MorningBriefing.NEWS) s.newsSeen['hl:' + id] = '2002-11-01';
        const empty = b.news('2002-11-02').length === 0 && b.newsIds.length === 0, back = b.news('2002-11-15').length > 0;
        const marks = /markHeadlines/.test(MorningBriefing.prototype.go.toString()) && /!this\.layer\.hidden && this\.newsIds/.test(MorningBriefing.prototype.go.toString());
        s.newsSeen = JSON.parse(keep);
        return { ok, shown, stable, empty, back, marks, cd: NEWS.CD_DAYS };
      });
      check('v3.24 headlines: over a simulated month no headline id repeats within 14 days (marked as read each morning, stable on re-render); every id read → no headline; free again after 14 days; only a shown briefing marks them',
        h.ok && h.shown >= 20 && h.stable && h.empty && h.back && h.marks && h.cd === 14, JSON.stringify(h));
      // (3) excuses: 8 kinds × 2 phrasings (EN + RU); 8 weeks of forced excuses → no kid repeats a kind within 28 days, the team within 7, no phrasing twice in a row
      const ex = await page.evaluate(() => {
        const s = YAM.game, keep = s.excuseLog, kids = s.squad.slice(0, 5), out = { texts: true, kid: true, team: true, row: true, det: true };
        out.kinds = EXCUSE.KINDS.length;
        for (const k of EXCUSE.KINDS) for (let i = 0; i < EXCUSE.PHRASES; i++) for (const lg of ['en', 'ru']) { const t = I18N[lg][`ex.${k}.${i}`]; if (!t || !t.includes('{k}')) out.texts = false; }
        s.excuseLog = [];
        const log = [];
        for (let i = 0; i < 56; i++) {
          const d = isoAdd('2003-01-06', i), p = kids[i % kids.length];
          const saved = JSON.stringify(s.excuseLog), r = s.pickExcuse(p, d);
          if (!r) continue;
          s.excuseLog = JSON.parse(saved); const r2 = s.pickExcuse(p, d); if (JSON.stringify(r) !== JSON.stringify(r2)) out.det = false;   // seeded
          log.push({ d, pid: p.id, kind: r.kind, text: r.text });
        }
        for (let i = 0; i < log.length; i++) for (let j = 0; j < i; j++) {
          const a = log[j], b = log[i], gap = isoDays(a.d, b.d);
          if (a.kind === b.kind && a.pid === b.pid && gap < EXCUSE.KID_CD) out.kid = false;
          if (a.kind === b.kind && gap < EXCUSE.TEAM_CD) out.team = false;
        }
        for (let i = 1; i < log.length; i++) if (log[i].text === log[i - 1].text) out.row = false;
        out.n = log.length; out.used = new Set(log.map(e => e.kind)).size;
        // the Math.random stream of v3.23: a forced excuse still consumes exactly two numbers after the shuffle
        const R = Math.random; let calls = 0; Math.random = () => { calls++; return 0; };
        const base = EXCUSE.BASE, off = s.excusesOff; EXCUSE.BASE = 1; s.excusesOff = false; s.excuseLog = [];
        const one = s.rollExcuse({}, '2003-03-03'); const shuffleCalls = s.squad.length - 1;
        EXCUSE.BASE = base; s.excusesOff = off; Math.random = R;
        out.stream = calls === shuffleCalls + 2 && !!one && EXCUSE.KINDS.includes(one.kind) && /^ex\.\w+\.[01]$/.test(one.text);
        s.excuseLog = keep;
        return out;
      });
      check('v3.24 excuses: 8 kinds × 2 phrasings with EN + RU texts; 8 simulated weeks of forced excuses — no kid repeats a kind within 28 days, the team within 7, no phrasing twice in a row; seeded, the Math.random stream unchanged',
        ex.kinds === 8 && ex.texts && ex.kid && ex.team && ex.row && ex.det && ex.stream && ex.n >= 30 && ex.used === 8, JSON.stringify(ex));
      // (4) the truant fine: income from the family (ledger 'event', tag +$); a poor family pays at the next training or not at all (no debt)
      const tf0 = await page.evaluate(() => {
        const s = YAM.game; s.weekState().ap = 0;
        const kid = s.squad.find(p => p.available && p.wealth !== 'poor'); kid.skipped_training = true;
        const out = { kid: kid.id, b: s.budget, ev: s.ledger[s.monthOf()]?.event || 0, d: kid.psych.discipline, wealth: kid.wealth };
        YAM.ui.events.fire('truant', s.calendar.date, { cast: { kid: kid.id } });
        return out;
      });
      await finishTyping();
      const tfTag = await page.evaluate(() => { const b = document.querySelector('#talk-choices .talk-btn[data-i="0"]'); return { tag: b.querySelector('.tb-money')?.textContent || '', dis: b.disabled, pos: !!b.querySelector('.tb-money.pos') }; });
      await talk(0);
      const tf1 = await page.evaluate(t => { const s = YAM.game, m = t.date; return { b: s.budget, ev: s.ledger[s.monthOf(m)]?.event || 0, d: s.player(t.kid).psych.discipline, diary: s.diary.some(x => x.key === 'ev.truant.a.diary' && x.vars?.m === '+$20') }; }, { kid: tf0.kid, date: await page.evaluate(() => YAM.game.calendar.date) });
      const tf2 = await page.evaluate(() => {
        const s = YAM.game, kid = s.squad.find(p => p.available), w0 = kid.wealth; kid.wealth = 'poor'; kid.skipped_training = true;
        const r = { kid: kid.id, w0, b: s.budget };
        YAM.ui.events.fire('truant', s.calendar.date, { cast: { kid: kid.id } });
        return r;
      });
      await finishTyping();
      const tfTag2 = await page.evaluate(() => document.querySelector('#talk-choices .talk-btn[data-i="0"] .tb-money')?.textContent || '');
      await talk(0);
      const tf3 = await page.evaluate(t => {
        const s = YAM.game, kid = s.player(t.kid), out = { b: s.budget, fines: (s.fines || []).length, later: s.diary.some(x => x.key === 'ev.truant.aLater.diary') };
        const f = s.fines[0], next = isoAdd(f.date, 2), pay = FINANCE.PAY.first.poor;
        FINANCE.PAY.first.poor = 0; const b1 = s.budget; s.resolveFines(next);
        out.unpaid = { b: s.budget - b1, left: s.fines.length, line: s.diary.some(x => x.date === next && x.key === 'fine.unpaid'), debt: s.budget < 0 };
        s.addFine(kid.id, 20, f.date); FINANCE.PAY.first.poor = 1; const ev0 = s.ledger[s.monthOf(next)]?.event || 0, b2 = s.budget; s.resolveFines(next);
        out.paid = { b: s.budget - b2, ev: (s.ledger[s.monthOf(next)]?.event || 0) - ev0, line: s.diary.some(x => x.date === next && x.key === 'fine.paid') };
        s.addFine(kid.id, 20, next); s.resolveFines(next); out.sameDay = s.fines.length === 1; s.fines = [];   // the fine day itself is not "the next training"
        FINANCE.PAY.first.poor = pay; kid.wealth = t.w0;
        return out;
      }, tf2);
      check('v3.24 truant fine: option A adds money to the club (+$20, ledger "event", button +$20 even with 0 AP / any budget); a poor family: +$ tag, no money now, paid at the next training with the poor first-fee chance — or not at all (diary line, no debt)',
        tfTag.tag === '+$20' && tfTag.pos && !tfTag.dis && tf1.b === tf0.b + 20 && tf1.ev === tf0.ev + 20 && tf1.d === Math.min(20, tf0.d + 2) && tf1.diary
        && tfTag2 === '+$20' && tf3.b === tf2.b && tf3.fines === 1 && tf3.later && tf3.unpaid.b === 0 && tf3.unpaid.left === 0 && tf3.unpaid.line && !tf3.unpaid.debt
        && tf3.paid.b === 20 && tf3.paid.ev === 20 && tf3.paid.line && tf3.sameDay, JSON.stringify({ tf0, tfTag, tf1, tfTag2, tf3 }));
      // (5) namesakes: initials in the planner, the locker room and the fee checklist; the same initial → the first name
      const nm = await page.evaluate(() => {
        const s = YAM.game, ui = YAM.ui, [a, b, c] = s.squad, keep = [a.name, b.name, c.name], ph = s.phase, out = {};
        a.name = 'Charlie Brennan'; b.name = 'Theo Brennan';
        out.one = squadName(a, s.squad) === L.name('Charlie')[0] + '. ' + L.name('Brennan') && squadName(b, s.squad) === L.name('Theo')[0] + '. ' + L.name('Brennan') && (u => !u || squadName(u, s.squad) === L.name(u.surname))(s.squad.find(q => q !== a && q !== b && s.squad.filter(x => x.surname === q.surname).length === 1));
        const lesson = ui.planner.lessonHTML('mon', true);
        out.planner = lesson.includes(esc(squadName(a, s.squad))) && lesson.includes(esc(squadName(b, s.squad)));
        const d = s.dayState(), lk0 = d.locker, f0 = s.fees;
        s.phase = 'calendar';
        d.locker = { done: false, revealed: true, absent: {}, checked: [], request: null, posRequest: null, capRequest: null };
        s.fees = { month: s.monthOf(), level: 'normal', amount: 10, started: true, status: Object.fromEntries(s.squad.map(p => [p.id, 'owed'])), reminded: {}, reason: {}, carry: {}, next: {}, got: {} };
        ui.locker.render();
        const names = [...document.querySelectorAll('#lr-grid .lk-name')].map(x => x.textContent), fees = [...document.querySelectorAll('#lr-fees .lrf-row span')].map(x => x.textContent);
        out.locker = names.includes(squadName(a, s.squad)) && names.includes(squadName(b, s.squad)) && names.filter(n => /Brennan|Бреннан/.test(n)).every(n => /^\S\. /.test(n));
        out.fees = fees.some(t => t.endsWith(squadName(a, s.squad))) && fees.some(t => t.endsWith(squadName(b, s.squad)));
        // same initial (in both languages) → the first name
        const fn = Object.keys(RU_NAMES).filter(n => /^[A-Z][a-z]+$/.test(n)), pair = fn.flatMap(x => fn.filter(y => y > x && y[0] === x[0] && RU_NAMES[y][0] === RU_NAMES[x][0]).map(y => [x, y]))[0];
        a.name = pair[0] + ' Brennan'; b.name = pair[1] + ' Brennan';
        out.first = squadName(a, s.squad) === L.name(pair[0]) + ' ' + L.name('Brennan') && squadName(b, s.squad) === L.name(pair[1]) + ' ' + L.name('Brennan');
        ui.locker.render(); out.lockerFirst = [...document.querySelectorAll('#lr-grid .lk-name')].some(x => x.textContent === squadName(b, s.squad));
        out.sample = [squadName(a, s.squad), squadName(b, s.squad)];
        [a.name, b.name, c.name] = keep; d.locker = lk0; s.fees = f0; s.phase = ph; ui.locker.render();
        return out;
      });
      check('v3.24 namesakes: two Brennans show "C. Brennan" / "T. Brennan" in the planner\'s lesson list, the locker room and the fee checklist; the same initial → the full first name; a unique surname stays alone',
        nm.one && nm.planner && nm.locker && nm.fees && nm.first && nm.lockerFirst, JSON.stringify(nm));
      // (6) the auto lineup's keeper: GK tag → yard note "hands" → kept goal most → old rule; a starter with "hands" moves into goal; a hand-placed keeper stays
      const gk = await page.evaluate(() => {
        const s = YAM.game, keep = { lineup: [...s.lineup], hand: s.gkByHand, stats: JSON.stringify(s.seasonStats), kids: s.squad.map(p => [p.id, p.tag, p.yardNotes, p.injuryDays, p.suspensionMatches, p.awayDays, p.absentToday, p.flags.slice()]) };
        const reset = () => { s.lineup = [...keep.lineup]; s.gkByHand = null; s.seasonStats = {}; s.squad.forEach(p => { p.tag = null; p.yardNotes = ['quiet']; p.injuryDays = 0; p.suspensionMatches = 0; p.awayDays = 0; p.absentToday = null; p.flags = []; }); };
        const xi = () => s.lineup.map(id => s.player(id)), bench = () => s.bench(), out = {};
        // (the squad may be down to 12 by now: one bench kid is enough — the other candidates are starters)
        reset(); let k0 = xi()[0], h = bench()[0]; h.yardNotes = ['hands']; k0.injuryDays = 5;
        let ch = s.ensureAvailableXI(); out.hands = s.lineup[0] === h.id && ch.length === 1 && !ch[0].fill;
        reset(); k0 = xi()[0]; h = bench()[0]; const t = xi()[3]; h.yardNotes = ['hands']; t.tag = 'GK'; k0.injuryDays = 5;
        s.ensureAvailableXI(); out.tag = s.lineup[0] === t.id && s.lineup[3] !== t.id && !!s.player(s.lineup[3])?.available;   // the tagged starter beats the "hands" bench kid; a bench kid fills his slot
        reset(); k0 = xi()[0]; const kept = bench()[0]; s.seasonStats[kept.id] = { apps: 3, kept: 3 }; k0.injuryDays = 5;
        s.ensureAvailableXI(); out.kept = s.lineup[0] === kept.id;
        reset(); k0 = xi()[0]; const mid = xi()[5], slot = 5; mid.yardNotes = ['hands']; k0.injuryDays = 5;
        ch = s.ensureAvailableXI(); out.starter = s.lineup[0] === mid.id && s.lineup[slot] !== mid.id && !!s.player(s.lineup[slot]) && ch[0]?.fill?.id === s.lineup[slot];
        s.xiAutoDiary(ch, s.calendar.date); out.diary = s.diary.at(-1).key === 'xi.autoGK' && /\S/.test(YAM.ui.entryText({ ...s.diary.at(-1), r: 0 }));
        reset(); k0 = xi()[0]; k0.injuryDays = 5; const old = s.bestBenchFor(0); s.ensureAvailableXI(); out.oldRule = s.lineup[0] === old.id;   // nothing visible → the old bench rule
        // never hidden skills: the bench kid with perfect goalkeeping but no visible sign loses to a starter with "hands"
        reset(); k0 = xi()[0]; const ace = bench()[0], hk = xi()[4], aceGk = ace.technical.goalkeeping; ace.technical.goalkeeping = 20; hk.yardNotes = ['hands']; k0.injuryDays = 5;
        s.ensureAvailableXI(); out.hidden = s.lineup[0] === hk.id; ace.technical.goalkeeping = aceGk;
        // hand-placed keeper: autoArrange (formation change / [ AUTO ]) leaves him; without the hand mark a tagged GK starter goes in
        reset(); const g = xi()[3]; g.tag = 'GK'; const b0 = bench()[0];
        s.swapPlayers(s.lineup[0], b0.id); out.handMark = s.gkByHand === b0.id; s.autoArrange(); out.handStays = s.lineup[0] === b0.id;
        s.gkByHand = null; s.autoArrange(); out.autoTag = s.lineup[0] === g.id;
        s.lineup = keep.lineup; s.gkByHand = keep.hand; s.seasonStats = JSON.parse(keep.stats);
        for (const [id, tag, yn, inj, sus, aw, ab, fl] of keep.kids) Object.assign(s.player(id), { tag, yardNotes: yn, injuryDays: inj, suspensionMatches: sus, awayDays: aw, absentToday: ab, flags: fl });
        s.save();
        return out;
      });
      check('v3.24 auto lineup keeper: no GK tag → the yard-note "hands" kid; a GK tag beats him; else whoever kept goal most; a starter with "hands" moves into goal (his slot filled, diary xi.autoGK); never hidden goalkeeping; a hand-placed keeper stays on auto-arrange',
        Object.values(gk).every(Boolean), JSON.stringify(gk));
      // (7) the cash desk: never on a match day (the 1st on a Saturday → the next non-match stop); the planner's cash block shows the whole ledger at 800 px
      const ks = await page.evaluate(() => {
        const s = YAM.game, ui = YAM.ui, ph = s.phase, f0 = s.fees, out = {};
        s.fees = { ...(f0 || {}), month: '1999-01' };   // this month's cash desk not done yet
        s.phase = 'matchday'; out.md = !s.kassaDue();
        ui.briefing.open(); out.mdKassa = ui.kassa.isOpen; ui.briefing.layer.hidden = true; ui.locker.layer.hidden = true; ui.modal.close();
        s.phase = 'calendar'; out.cal = s.kassaDue();
        s.phase = ph; s.fees = f0;
        return out;
      });
      await page.setViewportSize({ width: 800, height: 600 });
      const ks2 = await page.evaluate(() => {
        const s = YAM.game, ui = YAM.ui, ph = s.phase, f0 = s.fees, w = s.weekState(), conf = w.confirmed, out = {};
        s.phase = 'calendar'; s.fees = { ...(f0 || {}), month: '1999-01' }; w.confirmed = false;
        ui.planner.open();
        const k = document.getElementById('pl-kassa'), top = document.querySelector('.pl-top'), rep = document.getElementById('pl-ks-report'), lv = document.getElementById('pl-ks-levels');
        out.shown = ui.planner.isOpen && !k.hidden;
        out.rows = rep.querySelectorAll('tr').length; out.levels = lv.querySelectorAll('input, button, label').length;
        out.kassaH = Math.round(k.getBoundingClientRect().height); out.topFits = top.scrollHeight <= top.clientHeight + 1 && k.scrollHeight <= k.clientHeight + 1;
        out.whole = rep.getBoundingClientRect().bottom <= k.getBoundingClientRect().bottom + 1 && lv.getBoundingClientRect().bottom <= k.getBoundingClientRect().bottom + 1;
        ui.planner.layer.hidden = true; w.confirmed = conf; s.fees = f0; s.phase = ph;
        return out;
      });
      await page.setViewportSize({ width: 1440, height: 860 });
      check('v3.24 cash desk: no KASSA on a match day (kassaDue false, the briefing does not redirect), due again at the next calendar stop; PLANNER.EXE at 800 px shows the whole ledger and the fee choice without scrolling the cash block',
        ks.md && !ks.mdKassa && ks.cal && ks2.shown && ks2.topFits && ks2.whole && ks2.kassaH > 120 && ks2.rows > 0, JSON.stringify({ ks, ks2 }));
      // (8) "Visit the family" ([1 AP], truant D) shows its result line with one button before the game moves on
      const vf0 = await page.evaluate(() => {
        const s = YAM.game; s.weekState().ap = 1; s.budget = Math.max(s.budget, 100);
        const kid = s.squad.find(p => p.available); kid.skipped_training = true; kid.psych.discipline = 10; kid.dyn.morale = 50;
        YAM.ui.events.fire('truant', s.calendar.date, { cast: { kid: kid.id } });
        return { kid: kid.id, date: s.calendar.date };
      });
      await finishTyping();
      await talk(3);
      const vf1 = await page.evaluate(k => ({ step: YAM.game.pendingEvent?.step, n: document.querySelectorAll('#talk-choices .talk-btn').length, open: !document.getElementById('talk-layer').hidden,
        text: YAM.game.pendingEvent ? L.t('ev.truant.visit', { k: L.name(YAM.game.player(k).name) }).slice(0, 20) : '', date: YAM.game.calendar.date, ap: YAM.game.ap, d: YAM.game.player(k).psych.discipline }), vf0.kid);
      await finishTyping();
      const vfTxt = await page.evaluate(() => document.querySelector('#talk-layer .talk-text')?.textContent || '');
      await talk(0);
      const vf2 = await page.evaluate(k => ({ closed: !YAM.game.pendingEvent, d: YAM.game.player(k).psych.discipline, m: YAM.game.player(k).dyn.morale,
        diary: YAM.game.diary.slice(-4).some(x => x.key === 'ev.truant.d.diary'), log: YAM.game.eventLog.at(-1)?.choice }), vf0.kid);
      check('v3.24 [1 AP] result lines: "Visit the family" (truant D) shows the visit with ONE button before the game moves on (same day, AP spent, effects on OK: discipline +1, morale +3, diary + log as ev.truant.d); the seniors\' boots / paramedic / ulti visit — see the v3.16 / v3.17 checks',
        vf1.open && vf1.step === 'visit' && vf1.n === 1 && vf1.date === vf0.date && vf1.ap === 0 && vf1.d === 10 && vfTxt.startsWith(vf1.text) && vf2.closed && vf2.d === 11 && vf2.m === 53 && vf2.diary && vf2.log === 'ev.truant.d',
        JSON.stringify({ vf0, vf1, vfTxt: vfTxt.slice(0, 40), vf2 }));
      // (9) an old save without newsSeen / excuseLog / fines / gkByHand / yardNotes loads
      await page.evaluate(() => {
        YAM.game.save(); const d = JSON.parse(localStorage.getItem('yam_save_v1'));
        delete d.newsSeen; delete d.excuseLog; delete d.fines; delete d.gkByHand;
        for (const p of d.squad || []) delete p.yardNotes;
        localStorage.setItem('yam_save_v1', JSON.stringify(d));
      });
      await page.reload();
      await page.waitForFunction(() => window.YAM && YAM.ui);
      const old = await page.evaluate(() => { const s = YAM.game;
        return { news: JSON.stringify(s.newsSeen) === '{}', ex: Array.isArray(s.excuseLog) && !s.excuseLog.length, fines: Array.isArray(s.fines) && !s.fines.length, hand: s.gkByHand === null,
          yard: s.squad.every(p => p.yardNotes === null && Array.isArray(s.yardNotesOf(p))), headline: Array.isArray(YAM.ui.briefing.news(s.calendar.date)), squad: s.squad.length };
      });
      await page.evaluate(() => { YAM.ui.autoReview = true; YAM.ui.autoAfter = true; YAM.game.excusesOff = true; });
      check('v3.24 old save without newsSeen / excuseLog / fines / gkByHand / yard notes loads (empty defaults, yard notes from DraftView)', Object.values(old).every(Boolean), JSON.stringify(old));
    }
    // ===== v3.25 BONDS: friendships, twins, the talk =====
    {
      await page.evaluate(() => { const ui = YAM.ui; ui.modal.close(); ui.profile.close(); if (YAM.game.pendingEvent) { YAM.game.pendingEvent = null; ui.events.view.close(); } });
      // (1) starting table + old save without bonds / yard / school (seeded → the same values twice), keeps playing
      const b1 = await page.evaluate(() => {
        const s = YAM.game, out = {};
        const st = s.initBonds(s.calendar.date), S = BOND.START;
        let okYard = true, okSchool = true, okBoth = true, nY = 0, nS = 0, nB = 0;
        for (let i = 0; i < s.squad.length; i++) for (let j = i + 1; j < s.squad.length; j++) {
          const a = s.squad[i], b = s.squad[j], e = st[bondKey(a.id, b.id)], y = sameYard(a, b), sc = sameSchool(a, b);
          if (areTwins(a, b) || e?.cause === 'grudge') continue;
          const yg = e && e.v === S.yard[0] + BOND.YARD_GAME_DV || e && e.v === S.both[0] + BOND.YARD_GAME_DV;
          if (y && sc) { nB++; okBoth &&= !!e && (e.v === S.both[0] || yg) && e.root === S.both[1]; }
          else if (y) { nY++; okYard &&= !!e && (e.v === S.yard[0] || yg) && e.root === S.yard[1]; }
          else if (sc && a.bio.age === b.bio.age) { nS++; okSchool &&= !!e && e.v === S.school[0] && e.root === S.school[1]; }
          else okSchool &&= !e;
        }
        Object.assign(out, { okYard, okSchool, okBoth, nY, nS, nB });
        s.save(); const d = JSON.parse(localStorage.getItem('yam_save_v1'));
        delete d.bonds; delete d.bondMeta; for (const p of [...(d.squad || []), ...(d.pool || [])]) { delete p.yard; delete p.school; delete p.bondNotes; delete p.praiseLog; delete p.talk; }
        localStorage.setItem('yam_save_v1', JSON.stringify(d));
        return out;
      });
      const old1 = await page.evaluate(() => { const g = new GameState(); g.load(); return JSON.stringify(g.bonds) + '#' + g.squad.map(p => p.yard + '/' + p.school).join(','); });
      const old2 = await page.evaluate(() => { const g = new GameState(); g.load(); return JSON.stringify(g.bonds) + '#' + g.squad.map(p => p.yard + '/' + p.school).join(','); });
      await page.reload();
      await page.waitForFunction(() => window.YAM && YAM.ui);
      await page.evaluate(() => { YAM.ui.autoReview = true; YAM.ui.autoAfter = true; YAM.game.excusesOff = true; YAM.ui.modal.close(); });
      const b1b = await page.evaluate(() => ({ bonds: !!YAM.game.bonds && Object.keys(YAM.game.bonds).length > 0, roots: YAM.game.squad.every(p => Number.isInteger(p.yard) && Number.isInteger(p.school)) }));
      check('v3.25 starting bonds: same yard +20 / root 10, same school + same age +10 / root 0, both +35 / root 15 (an old grudge / the yard match aside); nothing else stored',
        b1.okYard && b1.okSchool && b1.okBoth && b1.nY + b1.nB > 0, JSON.stringify(b1));
      check('v3.25 old save without bonds / yard / school loads, gets the same seeded table twice in a row, keeps playing', old1 === old2 && old1.length > 10 && b1b.bonds && b1b.roots, old1.slice(0, 80));

      // (2) drift: training neighbours +1, assist +4, win +1, bench rivalry −2 (position), decay stops at the root
      const b2 = await page.evaluate(() => {
        const s = YAM.game, out = {}, bk = JSON.stringify(s.bonds), date = s.calendar.date;
        s.bonds = {};
        const [a, b] = s.lineupNeighbours()[0];
        const trained = s.squad.filter(p => [a, b].includes(p.id));
        s.bondTraining(date, trained); out.train = s.bondV(a, b) >= BOND.TRAIN && s.bondV(a, b) <= BOND.TRAIN + 2 * BOND.DRILL;
        s.bonds = {}; s.bondTraining('2000-01-01', s.squad.filter(p => [a, b].includes(p.id))); const withDrill = s.bondV(a, b);
        out.trainExact = withDrill === BOND.TRAIN + BOND.DRILL * BOND.DRILL_PAIRS || withDrill === BOND.TRAIN;   // 2 kids → both drills land on them
        s.bonds = {};
        const xi = s.lineup.map(id => s.player(id)), x = xi[5], y = xi[9];
        const eng = { sides: [{ entries: [] }], subs: [], everPlayed: new Set([x.id, y.id]), matchEvents: [{ type: 'goal', side: 0, playerId: y.id, assistId: x.id }], blames: [], injured: new Set() };
        s.bondMatch(eng, 'D', date); out.assist = s.bondV(x.id, y.id) === BOND.ASSIST;
        s.bondMatch({ ...eng, matchEvents: [] }, 'W', date); out.win = s.bondV(x.id, y.id) === BOND.ASSIST + BOND.WIN;
        const [c, d] = s.squad.filter(p => !s.isStarter(p.id)).slice(0, 1).concat(xi.slice(1, 2));
        const keep = [c.tag, d.tag, c.benchStreak, c.injuryDays, c.awayDays, c.suspensionMatches, c.absentToday, c.flags]; c.tag = d.tag = 'MID'; c.benchStreak = 2;
        Object.assign(c, { injuryDays: 0, awayDays: 0, suspensionMatches: 0, absentToday: null, flags: c.flags.filter(f => f !== 'Benched') });   // fit, just not picked
        s.bondMatch({ ...eng, everPlayed: new Set([d.id]), matchEvents: [] }, 'L', date);
        const e = s.bond(c, d); out.position = e?.v === BOND.POSITION && e.cause === 'position';
        [c.tag, d.tag, c.benchStreak, c.injuryDays, c.awayDays, c.suspensionMatches, c.absentToday, c.flags] = keep;
        s.bonds = { [bondKey(x.id, y.id)]: { v: 13, root: 10, cause: null, since: date, last: '2000-01-01' } };
        for (let k = 0; k < 6; k++) s.bondWeek(isoAdd(date, 7 * (k + 1)));
        out.decay = s.bondV(x.id, y.id) === 10;
        s.bonds = JSON.parse(bk);
        return out;
      });
      check('v3.25 bonds drift: XI neighbours who trained +1 (+ the pair drill), assist → goal +4, a win +1 to existing friends, bench rivalry −2 with cause "position", decay stops at the root',
        Object.values(b2).every(Boolean), JSON.stringify(b2));

      // (3) a fixed seeded duel: v = +100 vs −100 moves pass / interception only; AI side none
      const b3 = await page.evaluate(() => {
        const s = YAM.game, ctx = s.matchContext() || { team: { name: 'X', players: s.squad.slice(0, 11), formation: '4-4-2' } };
        const home = { name: 'H', players: s.starters(), formation: s.formation }, away = { name: ctx.team.name, players: ctx.team.players, formation: ctx.team.formation };
        const run = v => {
          const saved = Math.random; let a = 12345; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
          const e = new MatchEngine(home, away, { onUpdate() {}, onEnd() {}, onLog() {}, onSpeed() {} }, v == null ? {} : { bonds: { side: 0, v: () => v } });
          e.instant = true; e.begin(); for (let i = 0; i < 400 && !e.finished; i++) e.tick();   // the whole match
          Math.random = saved;
          return e.trace;
        };
        const hi = run(100), lo = run(-100), none = run(null);
        const kinds = (t, k) => t.filter(x => x.kind === k);
        const passHi = kinds(hi, 'pass').concat(kinds(hi, 'passFwd')), passLo = kinds(lo, 'pass').concat(kinds(lo, 'passFwd'));
        return {
          passUs: passHi.filter(x => x.side === 0).every(x => x.A.bond === 0 || Math.abs(x.A.bond - BOND.MAX) < 1e-9 || Math.abs(x.A.bond - BOND.MAX * TWINS.LINK) < 1e-9)
            && passHi.some(x => x.side === 0 && x.A.bond > 0) && passLo.filter(x => x.side === 0).every(x => x.A.bond <= 0) && passLo.some(x => x.side === 0 && x.A.bond < 0),   // XI neighbours only
          readUs: passHi.filter(x => x.side === 1).some(x => x.D.bond > 0) && passHi.filter(x => x.side === 1).every(x => x.D.bond >= 0 && x.A.bond === 0),
          ai: passHi.filter(x => x.side === 1).every(x => x.A.bond === 0) && passHi.filter(x => x.side === 0).every(x => x.D.bond === 0),
          other: [...hi, ...lo].filter(x => !['pass', 'passFwd'].includes(x.kind)).every(x => x.A.bond === 0 && x.D.bond === 0),
          none: none.every(x => x.A.bond === 0 && x.D.bond === 0) && none.length > 10,
          csv: MatchEngine.traceCsv(hi.slice(0, 2), ['a', 'b']).split('\n')[0].includes('atk_bond'),
        };
      });
      check('v3.25 seeded duel: v = +100 / −100 changes the pass duel (passer ↔ receiver, XI neighbours) and the interception (same-line neighbours), never shots / dribbles / tackles; the AI side has no bonds; no bonds = no term; bond column in the match log',
        Object.values(b3).every(Boolean), JSON.stringify(b3));

      // (4) ATMOS = 0 → the v3.24 cohesion number; enemies lower the weekly gain
      const b4 = await page.evaluate(() => {
        const s = YAM.game, w = s.weekState(), keep = { c: s.cohesion, teff: w.teff, b: s.bonds };
        s.cohesion = 50; w.teff = 2; s.bonds = {}; const a0 = s.atmos(); s.updateCohesion(); const c0 = s.cohesion;
        const v324 = clamp(50 * COH.DECAY + COH.GAIN * 2, 0, 100);
        const ids = s.squad.map(p => p.id); s.bonds = {};
        for (let i = 0; i < 6; i++) s.bonds[bondKey(ids[i], ids[i + 6])] = { v: -70, root: 0, cause: 'grudge', since: '', last: '' };
        s.cohesion = 50; const a1 = s.atmos(); s.updateCohesion(); const c1 = s.cohesion;
        Object.assign(s, { cohesion: keep.c, bonds: keep.b }); w.teff = keep.teff;
        return { a0, c0, v324, a1, c1, ok: a0 === 0 && Math.abs(c0 - v324) < 1e-9 && a1 < 0 && c1 < c0 };
      });
      check('v3.25 ATMOS: no bonds → ATMOS 0 and the v3.24 Sunday cohesion number; kids at war lower the weekly gain (× (1 + ATMOS))', b4.ok, JSON.stringify(b4));

      // (5) the loner: attendance down, the Monday line (3 phrasings, never the same two weeks running) + an exact note
      const b5 = await page.evaluate(() => {
        const s = YAM.game, keep = s.bonds, p = s.squad[3], q = s.squad[4];
        s.bonds = { [bondKey(p.id, q.id)]: { v: -30, root: 0, cause: 'blame', since: '', last: '' } };
        const lon = s.isLoner(p) && s.isLoner(q) && !s.isLoner(s.squad[5]);
        const r6 = s.squad[6], keep6 = r6.injuryDays, mate = s.squad[7];
        const penL = s.bondAttendPen(p), pen0 = s.bondAttendPen(mate);
        s.bonds[bondKey(r6.id, mate.id)] = { v: 70, root: 0, cause: null, since: '', last: '' }; r6.injuryDays = 3;
        const penF = s.bondAttendPen(mate); r6.injuryDays = keep6;
        const pens = { penL, pen0, penF };
        const m1 = weekStartOf(s.calendar.date), m2 = isoAdd(m1, 7);
        (s.bondMeta ||= {}).lonerLast = null;
        const l1 = MorningBriefing.cohNews({ ...s, phase: 'calendar', cohesion: 80, bonds: s.bonds, lonerLine: s.lonerLine.bind(s), player: s.player.bind(s) }, m1);
        const l2 = MorningBriefing.cohNews({ ...s, phase: 'calendar', cohesion: 80, bonds: s.bonds, lonerLine: s.lonerLine.bind(s), player: s.player.bind(s) }, m2);
        const note = (p.bondNotes || []).concat(q.bondNotes || []).some(n => n.band === 'alone' && n.source === 'loner');
        s.bonds = keep;
        return { lon, pens, l1, l2, note, ok: lon && penL === BOND.LONER_ATTEND && pen0 === 0 && penF === BOND.FRIEND_AWAY && l1.length === 1 && l2.length === 1 && l1[0] !== l2[0] && note };
      });
      check('v3.25 loner (no friend, one rival): the attendance chance −0.1 (and −0.1 when a best mate is injured / away), the Monday line "seems to be on his own at training" (a different phrasing next week) + an exact note', b5.ok, JSON.stringify(b5));

      // (6) twins: 2 pairs in a new world, same surname, different initials, twinId both ways; the other 96 kids unchanged + no Math.random; the mum's request
      const b6 = await page.evaluate(() => {
        const saved = Math.random; let a = 777; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        const used = new Set(), world = GameState.buildWorld(used), pool = world.filter(p => p.teamId === 'free_agent').slice(0, WORLD.DRAFT_POOL).map(p => p.id);
        const hash = list => { let h = 0; for (const p of list) for (const c of p.name + JSON.stringify([p.physical, p.technical, p.tactical, p.psych])) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; return h; };
        const before = new Map(world.map(p => [p.id, hash([p])]));
        let calls = 0; const r0 = Math.random; Math.random = () => { calls++; return r0(); };
        const made = makeTwins(world, pool);
        Math.random = saved;
        const tw = new Set(made.flat().map(p => p.id)), rest = world.filter(p => !tw.has(p.id));
        return { pairs: made.length, same: made.every(([x, y]) => x.surname === y.surname && x.name[0] !== y.name[0] && x.twinId === y.id && y.twinId === x.id && x.bio.age === y.bio.age && x.archetype === y.archetype && x.wealth === y.wealth && kidRoots(x).yard === kidRoots(y).yard && kidRoots(x).school === kidRoots(y).school),
          face: made.every(([x, y]) => x.face.filter((v, i) => v !== y.face[i]).length === 1), inPool: made[0].every(p => pool.includes(p.id)),
          rest: rest.length === 96 && rest.every(p => before.get(p.id) === hash([p])), calls };
      });
      check('v3.25 twins: 2 pairs (same surname / yard / school / family / archetype, different initials, twinId both ways, one face difference); the other 96 kids unchanged (hash of names + skills), no Math.random call',
        b6.pairs === 2 && b6.same && b6.face && b6.inPool && b6.rest && b6.calls === 0, JSON.stringify(b6));
      const b6b = await page.evaluate(() => {
        const raw = localStorage.getItem(GameState.KEY), g = new GameState(), ui = YAM.ui, real = ui.state;
        g.newAcademy();
        const t = g.globalPlayers.find(p => p.twinId && g.draft.pool.includes(p.id)), b = g.globalPlayers.find(p => p.id === t.twinId);
        g.toggleDraft(t.id);
        const ask = g.draftTwinAsk(t.id) === b;
        const m0 = t.dyn.morale, par = g.rep.parents;
        g.draftTwinAnswer(t.id, false);
        const ref = t.dyn.morale === clamp(m0 + TWINS.REFUSE_MORALE, 0, 100) && g.rep.parents === par + TWINS.REFUSE_PARENTS && !g.draftSigned().includes(b.id) && !g.draftTwinAsk(t.id);
        const g2 = new GameState(); g2.newAcademy(); const t2 = g2.globalPlayers.find(p => p.twinId && g2.draft.pool.includes(p.id));
        g2.toggleDraft(t2.id); g2.draftTwinAnswer(t2.id, true);
        const take = g2.draftSigned().includes(t2.twinId) && g2.draftSigned().length === 2;
        ui.state = g2; ui.draft.render?.(); const hasModal = ui.draft.askTwin(t2.id); ui.state = real;   // already answered → no second ask
        localStorage.setItem(GameState.KEY, raw);
        return { ask, ref, take, noRepeat: !hasModal };
      });
      await page.evaluate(() => { YAM.game.save(); YAM.ui.modal.close(); });
      check('v3.25 draft: signing one twin while the other is free → the mum\'s request; take = the brother uses the next pick; refuse = morale −8, Parents −2, asked once', Object.values(b6b).every(Boolean), JSON.stringify(b6b));

      // (7) twin mix-up: MIXUP forced to 1 → a clue lands on the brother, marked; a talk teaches the coach → the line + struck through
      const b7 = await page.evaluate(() => {
        const s = YAM.game, ui = YAM.ui, [x, y] = s.squad.filter(p => !p.twinId).slice(-2), keep = { xt: x.twinId, yt: y.twinId, xc: x.clues, yc: y.clues, bm: JSON.stringify(s.bondMeta) };
        x.twinId = y.id; y.twinId = x.id; s.bondMeta = { known: {}, matches: {} }; s.twinMixForce = 1;
        const n0 = y.clues.length;
        s.addClue(x, { date: s.calendar.date, source: 'match', ref: 99, signal: 'pass', textKey: 'clue.pass.0' });
        const landed = y.clues.at(-1)?.mix === x.id && y.clues.at(-1).ref === 99 && !x.clues.some(c => c.ref === 99);   // (the list is capped: compare the last one)
        ui.profile.open(y.id); const mark = document.getElementById('pinfo-body').innerHTML.includes(esc(L.t('twins.mix', { k: L.name(y.name) })));
        const struck0 = document.getElementById('pinfo-body').innerHTML.includes('<s>'); ui.profile.close();
        s.weekState().ap = Math.max(1, s.ap); x.talk = {};
        ui.haveWord(x.id); ui.events.view.finishTyping();
        const learned = s.twinsKnown(x) === false;
        const pe = s.pendingEvent; const q = [...document.querySelectorAll('#talk-choices .talk-btn')].findIndex(b => b.textContent.includes(L.t('btalk.q.mates')));
        document.querySelectorAll('#talk-choices .talk-btn')[q].click(); ui.events.view.finishTyping();
        const known = s.twinsKnown(x) && s.diary.some(d => d.key === 'twins.learned');
        s.pendingEvent = null; ui.events.view.close();
        ui.profile.open(y.id); const struck = document.getElementById('pinfo-body').innerHTML.includes('<s>'); ui.profile.close();
        ui.nbTab = 'locker'; ui.renderNotebook(); const line = document.getElementById('notes-body').textContent.includes(L.t('twins.line', { k: L.name(twinCowlick(x, y).name) }).slice(0, 12)); ui.nbTab = 'match';
        s.twinMixForce = null; Object.assign(x, { twinId: keep.xt, clues: keep.xc }); Object.assign(y, { twinId: keep.yt, clues: keep.yc }); s.bondMeta = JSON.parse(keep.bm);
        if (!x.twinId) delete x.twinId; if (!y.twinId) delete y.twinId;
        return { landed, mark, struck0: !struck0, learned, pe: pe?.id === 'bondtalk', known, struck, line };
      });
      check('v3.25 twin mix-up: with MIXUP forced to 1 a clue lands on the brother marked "I think it was…"; after a talk the coach tells them apart (diary + Notebook line) and the mixed clue is struck through',
        Object.values(b7).every(Boolean), JSON.stringify(b7));

      // (8) the talk: 1 AP, 2 questions then closed; greyed at 0 AP and for 7 days; free office question; O = 1 / O = 0; gossip; repeat; notes source 'talk'
      const b8 = await page.evaluate(async () => {
        const s = YAM.game, ui = YAM.ui, out = {}, kid = s.squad.find(p => !p.twinId && p.available), other = s.squad.find(p => p !== kid && !p.twinId);
        const keepB = JSON.stringify(s.bonds);
        s.bonds[bondKey(kid.id, other.id)] = { v: 45, root: 0, cause: null, since: '', last: '' };
        const btns = () => [...document.querySelectorAll('#talk-choices .talk-btn')];
        const clickLabel = t => { const b = btns().find(x => x.textContent.includes(t)); b?.click(); ui.events.view.finishTyping(); return !!b; };
        s.weekState().ap = 2; kid.talk = {}; s.talkForceO = 1;
        ui.modal.close(); ui.profile.open(kid.id); out.pOpen = ui.profile.isOpen; const tb = document.getElementById('pinfo-talk'); out.btn = !tb.hidden && !tb.disabled && !/\d+\s*%/.test(tb.textContent);
        tb.click(); ui.events.view.finishTyping();
        out.ap = s.ap === 1 && s.pendingEvent?.id === 'bondtalk';
        clickLabel(L.t('btalk.q.how')); clickLabel(L.name(other.name).split(' ')[0]) || btns().find(b => b.textContent.includes(squadName(other, s.squad)))?.click(); ui.events.view.finishTyping();
        out.honest = (kid.bondNotes || []).some(n => n.with === other.id && n.band === 'mates' && n.source === 'talk' && n.by?.pid === kid.id);
        out.more = btns().length === 2;
        clickLabel(L.t('btalk.more')); clickLabel(L.t('btalk.q.mates'));
        out.last = btns().length === 1 && btns()[0].textContent.includes(L.t('btalk.bye'));
        btns()[0].click();
        out.closed = !s.pendingEvent && document.getElementById('talk-layer').hidden;
        ui.profile.open(kid.id); out.cd = document.getElementById('pinfo-talk').disabled && s.talkBlock(kid.id) === 'btalk.cooldown'; ui.profile.close();
        const other2 = s.squad.find(p => p !== kid && p !== other); other2.talk = {}; s.weekState().ap = 0;
        out.noAp = s.talkBlock(other2.id) === 'talk.noAp' && !ui.haveWord(other2.id);
        // O forced to 0 → every answer evasive; repeat; gossip
        s.talkForceO = 0; let ev = 0; for (const q of ['how', 'how']) { const a = s.talkAnswer(other2, q, other.id, null, isoAdd(s.calendar.date, ev * 30)); if (a.kind === 'evade') ev++; }
        out.evade = ev === 2;
        s.talkForceO = 1; out.repeat = s.talkAnswer(other2, 'how', other.id, null, isoAdd(s.calendar.date, 31))?.kind === 'repeat' || s.talkAnswer(other2, 'how', other.id, null, isoAdd(s.calendar.date, 32))?.kind === 'repeat';
        s.bonds[bondKey(other2.id, other.id)] = { v: -40, root: 0, cause: 'position', since: '', last: '' };
        s.talkForceGossip = 1; const m0 = other.dyn.morale;
        const g = s.talkAnswer(other2, 'how', other.id, null, isoAdd(s.calendar.date, 90));
        out.gossip = g.kind === 'honest' && g.cause === 'position' && other.dyn.morale === clamp(m0 + TALK.GOSSIP_MORALE, 0, 100) && other.talk.closedUntil > s.calendar.date;
        s.talkForceGossip = null; s.talkForceO = null;
        // the free question when he came by himself (an excuse request)
        s.weekState().ap = 0; const k2 = s.squad.find(p => p.available && p !== kid);
        ui.events.fire('posreq', s.calendar.date, { cast: { kid: k2.id } }); ui.events.view.finishTyping();
        const free = btns().find(b => b.textContent.includes(L.t('btalk.free')));
        out.freeBtn = !!free && !free.disabled; free?.click(); ui.events.view.finishTyping();
        clickLabel(L.t('btalk.q.mates'));
        out.freeAns = btns().length === 1 && btns()[0].textContent.includes(L.t('btalk.back')) && s.ap === 0;
        btns()[0].click(); ui.events.view.finishTyping();
        out.freeBack = s.pendingEvent?.id === 'posreq' && !btns().some(b => b.textContent.includes(L.t('btalk.free')));
        btns()[1]?.click();   // pr.wait
        if (s.pendingEvent) { s.pendingEvent = null; ui.events.view.close(); }
        s.bonds = JSON.parse(keepB);
        return out;
      });
      check('v3.25 Have a word: 1 AP, two questions then only "Thanks"; greyed for 7 days and at 0 AP; O = 1 answers by the band (note source \'talk\'), O = 0 always evasive; "you already asked"; gossip (morale −2, closed for 14 days); the free question when he came by himself (no AP, back to his request)',
        Object.values(b8).every(Boolean), JSON.stringify(b8));

      // (9) no digits next to a bond word: Notebook "Locker room", PLAYER_INFO "In the squad", the locker room line, the Match Summary cause line
      const b9 = await page.evaluate(() => {
        const s = YAM.game, ui = YAM.ui, [a, b, c] = s.lineupNeighbours()[0].map(id => s.player(id)).concat([s.squad.find(p => !s.isStarter(p.id))]);
        const keep = { an: a.bondNotes, bn: b.bondNotes };
        s.addBondNote(a, { with: b.id, band: 'cold', source: 'talk', date: s.calendar.date, by: { pid: a.id, name: a.name }, cause: 'position' });
        s.addBondNote(b, { with: a.id, band: 'war', source: 'after', date: s.calendar.date, by: { pid: b.id, name: b.name } });
        s.addBondNote(a, { with: c.id, band: 'best', source: 'came', date: '2001-01-01' });
        ui.nbTab = 'locker'; ui.renderNotebook(); const nb = document.getElementById('notes-body').innerText; ui.nbTab = 'match';
        ui.profile.open(a.id); const pi = document.querySelector('#pinfo-body .pi-bonds')?.innerText || ''; ui.profile.close();
        const warn = s.lockerBondWarning(), lr = warn ? L.t('lr.bond.warn', { a: 'A', b: 'B', l: L.t('lr.bond.line.' + warn.line), d: fmtDate(warn.date, { weekday: 'long' }) }) : '';
        const cause = L.t('bond.cause', { a: L.name(a.name), b: L.name(b.name) });
        const dig = t => /\d/.test(t.replace(/\d{1,2}\s+\S+\.?/g, '').replace(/#\d+/g, ''));   // dates ("12 Dec") and shirt numbers aside
        Object.assign(a, { bondNotes: keep.an }); Object.assign(b, { bondNotes: keep.bn });
        return { nb: nb.length > 50 && !dig(nb.split('\n').filter(l => /mates|get on|war|приятел|ладят|ножах|друз|сам по себе|on his own/i.test(l)).join('\n')),
          pi: pi.length > 5 && !/\d/.test(pi), warn: !!warn && !/\d/.test(lr), cause: !/\d/.test(cause), stale: nb.includes(L.t('bn.staleTag')), avail: ui.notesAvail };   // (the Notebook's "Locker room" is there between matches too)
      });
      check('v3.25 no numbers next to any bond word: Notebook "Locker room" (+ "haven\'t checked for a while" on old notes), PLAYER_INFO "In the squad", the locker room warning, the Match Summary cause line',
        Object.values(b9).every(Boolean), JSON.stringify(b9));

      // (10) auto lineup: separates a KNOWN bad pair when a swap costs ≤ 0.5 overall; nothing for an unknown one
      const b10 = await page.evaluate(() => {
        const s = YAM.game, keep = { lu: [...s.lineup], f: s.formation }, out = {};
        s.formation = '4-4-2';
        const [a, b] = s.lineupNeighbours().find(([x, y]) => s.lineup.indexOf(x) > 0 && s.lineup.indexOf(y) > 0);
        const ia = s.lineup.indexOf(a), sl = s.slots();
        const mate = s.lineup.findIndex((id, j) => j > 0 && j !== ia && j !== s.lineup.indexOf(b) && sl[j].line === sl[ia].line && !s.lineupNeighbours().some(([x, y]) => (x === id && y === b) || (y === id && x === b)));
        const pa = s.player(a), pm = s.player(s.lineup[mate]), keepO = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(pa), 'overall');
        Object.defineProperty(pa, 'overall', { value: 10, configurable: true }); Object.defineProperty(pm, 'overall', { value: 10.3, configurable: true });
        const allNotes = s.squad.map(p => p.bondNotes); s.squad.forEach(p => { p.bondNotes = []; });   // only this pair is known
        const notes = [pa.bondNotes, s.player(b).bondNotes];
        const lu0 = [...s.lineup];
        out.unknown = s.bondSeparate() === 0 && s.lineup.join() === lu0.join();
        s.addBondNote(pa, { with: b, band: 'war', source: 'talk', date: s.calendar.date, by: { pid: a, name: pa.name } });
        out.swapped = s.bondSeparate() >= 1 && !s.lineupNeighbours().some(([x, y]) => (x === a && y === b) || (x === b && y === a));
        delete pa.overall; delete pm.overall; s.squad.forEach((p, i) => { p.bondNotes = allNotes[i]; });
        s.lineup = keep.lu; s.formation = keep.f;
        return out;
      });
      check('v3.25 auto lineup: two kids with a KNOWN bad bond side by side are separated by a swap that costs ≤ 0.5 overall; an unknown bad bond changes nothing', b10.unknown && b10.swapped, JSON.stringify(b10));

      // (11) the balance harness: default and --cohesion tables identical to v3.24, --bonds on target
      const bb = require('child_process').spawnSync(process.execPath, [require('path').join(__dirname, 'balance.js'), '--cohesion', '--bonds'], { encoding: 'utf8' });
      const hsh = t => require('crypto').createHash('sha256').update(t).digest('hex').slice(0, 16);
      const base = bb.stdout.split(/\n(?:Bonds \(v3\.25\)|fatigueMult)/)[0] + '\n' + bb.stdout.split('\n').filter(l => /^OK: (Attack|cohesion)/.test(l)).join('\n');   // what the v3.24 harness printed for --cohesion
      check('v3.25 test/balance.js --cohesion --bonds: the v3.24 tables unchanged (sha), bonds on target (3 pairs +80 → 53–56 %, 2 pairs −80 → 42–46 %)',
        bb.status === 0 && hsh(base) === BAL_V324_COH && /OK: bonds win share/.test(bb.stdout), hsh(base) + ' ' + (bb.stdout.trim().split('\n').pop() || bb.stderr).slice(0, 140));
      await page.evaluate(() => { YAM.ui.modal.close(); YAM.ui.profile.close(); });
    }
    const bal = require('child_process').spawnSync(process.execPath, [require('path').join(__dirname, 'balance.js')], { encoding: 'utf8' });
    check('balance.js: Attack vs Defense win share within 45–55%', bal.status === 0, (bal.stdout.trim().split('\n').pop() || bal.stderr).slice(0, 120));
    await page.click('#btn-lang'); await page.click('#btn-lang');
    check('frame loop cost < 2 ms', await page.evaluate(() => (YAM.ui.radar.frameCost ?? 0) < 2), (await page.evaluate(() => (YAM.ui.radar.frameCost ?? 0).toFixed(2))) + ' ms');
  } catch (e) {
    check('no exception during run', false, e.message.split('\n').slice(0, 3).join(' / '));
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();

  const failed = results.filter(r => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.info ? '  (' + r.info + ')' : ''}`);
  console.log(failed.length ? `\n${failed.length} check(s) failed` : `\nAll ${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
