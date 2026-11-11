/* =========================================================
   UI CONTROLLER
   ========================================================= */
class UIController {
  constructor(state) {
    this.state = state;
    this.engine = null;
    this.view = 'dash';
    this.logEntries = [];
    this.selected = null;        // team screen: player id picked for a swap (list row or pitch dot)
    this.teamMsg = '';
    this.mentality = 'balanced';
    this.speed = 1;
    this.tableMd = null;
    try { const s = Number(localStorage.getItem('yam_speed')); if (MatchEngine.SPEED[s]) this.speed = s; } catch (e) {}
    this.$ = id => document.getElementById(id);
    this.radar = new MatchView(this.$('radar-view'), this.$('radar'), {   // live 60 FPS pitch with camera
      onShake: () => this.shake(),
      onFlash: tone => this.flash(tone),
    });
    this.board = new RadarView(this.$('tac-board'), {
      labels: true,
      onDotClick: i => this.onBoardClick(i),
      onDrop: (i, srcId) => this.onDropSwap(this.state.lineup[i], srcId),
    });
    this.modal = new Modal();
    this.profile = new ProfileCard(this);
    this.teamCard = new TeamRosterCard(this);   // v1.7
    this.debug = new DebugConsole(this);         // v1.8
    this.events = new EventEngine(this);         // v1.9: narrative events + locker room dialogue
    this.summary = new MatchSummary(this);       // v2.1: full-time scoreboard
    this.state.onBudget = d => this.renderBudget(d);
    this.setupCalendar();
    this.bind();
    this.applyStatic();
    this.fillFormations();
    this.prepareMatch();
    this.renderAll();
    this.show('dash');
    if (this.state.pendingEvent) this.events.open();   // v1.9: an unanswered dilemma survives a reload
    this.checkUpdateNotice();
  }

  /* ---------- calendar wiring: event types + daily routines ---------- */
  setupCalendar() {
    const cal = this.cal = new CalendarEngine(this.state.calendar);
    cal.registerType('match', {
      blocking: true,
      label: ev => {
        const ctx = this.state.matchContext();
        if (!ctx || ctx.md !== ev.md) return `#${ev.md}`;
        return L.t('ev.match.label', { md: ev.md, o: esc(L.team(ctx.opp.name)), v: L.t('venue.' + ctx.venue) });
      },
      onArrive: ev => this.onMatchdayArrived(ev),
    });
    // Future event types plug in here, e.g.:
    // cal.registerType('training', { blocking: false, label: ev => '…', onArrive: ev => this.state.applyTraining(ev) });
    // cal.registerType('dialogue', { blocking: true,  label: ev => '…', onArrive: ev => this.openDialogue(ev) });
    cal.onDay(date => {   // v2.4/2.5: Tue/Thu = training with the coach's regime (auto-sim falls back to Match Practice)
      const s = this.state, r = s.dayRoutine(date, isTrainingDay(date), s.dayState().plan || 'match');
      if (!r.training) return { key: 'cal.rest', vars: { n: ENERGY.DAILY_REST } };
      const ids = list => ({ list: list.map(p => ({ pid: p.id })) });
      if (r.improved.length) s.addDiary({ date, key: 'tr.improved', vars: { s: ids(r.improved) }, cls: 'tr' });
      if (r.hurt.length) s.addDiary({ date, key: 'tr.hurt', vars: { s: ids(r.hurt) }, cls: 'ev' });
      const plan = { p: { plan: r.plan } };
      return r.skipped.length
        ? { key: 'cal.training', vars: { ...plan, a: r.attended, s: ids(r.skipped) }, cls: 'tr' }
        : { key: 'cal.trainingAll', vars: { ...plan, a: r.attended }, cls: 'tr' };
    });
  }

  renderAll() {
    this.renderLiveRoster(); this.renderAssistant(this.engine);
    this.renderDash();
    this.renderTeam();
    this.renderTable();
    this.renderNotebook();
    this.renderReadme();
    this.renderMatchChrome();
    this.syncLocks();
    this.renderShouts();
    this.renderSpeedBtns();
    this.renderBudget();
    if (this.debug?.isOpen) this.debug.render();   // v1.8
    if (this.summary?.isOpen) this.summary.render();   // v2.1
  }

  /* ---------- language ---------- */
  applyStatic() {
    document.documentElement.lang = L.code;
    document.title = `${L.t('doc.title')} v${APP_VERSION}`;
    this.$('app-title').innerHTML = `Youth Academy Manager <b>v${APP_VERSION}</b>`;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = L.t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => { const v = L.t(el.dataset.i18nAria); el.setAttribute('aria-label', v); el.title = v; });
    this.$('fx-lbl').textContent = L.t(document.body.classList.contains('fx') ? 'ui.fxOn' : 'ui.fxOff');
    const b = this.$('btn-lang');
    b.textContent = L.code === 'ru' ? 'RU' : 'EN';
    b.title = L.t('ui.lang');
  }

  setLang(code) {
    L.set(code);
    this.applyStatic();
    this.renderAll();
    if (this.events.view.isOpen) this.events.open();   // v1.9: re-translate the open dialogue
    if (this.engine) { this.renderLive(this.engine); this.relabelRadar(); } else this.prepareRadar();
    this.rerenderLog();
    this.profile.tick();
  }

  relabelRadar() {
    this.radar.relabel();
  }

  v(x) {
    if (x instanceof Player) return L.name(x.surname);
    if (x && typeof x === 'object' && 'plan' in x) return L.t('plan.' + x.plan);   // v2.5 diary
    if (x && typeof x === 'object' && 'pid' in x) { const p = this.state.player(x.pid); return p ? L.name(p.name) : '?'; }   // v1.9 diary
    if (x && typeof x === 'object' && Array.isArray(x.list)) return x.list.map(p => this.v(p)).join(', ');
    if (x && typeof x === 'object' && Array.isArray(x.fixtures)) return x.fixtures.map(f => this.fxText(f)).join('; ');
    if (x && typeof x === 'object' && 'team' in x) return L.team(x.team);
    if (x && typeof x === 'object' && 'venue' in x) return L.t('venue.' + x.venue);
    return String(x);
  }
  fxText(f) { const lg = this.state.league; return `${L.team(lg.team(f.home).name)} ${f.hg}-${f.ag} ${L.team(lg.team(f.away).name)}`; }

  entryText(e) {
    const vars = {};
    for (const k in e.vars) vars[k] = this.v(e.vars[k]);
    const pool = TXT[L.code][e.key];
    const text = pool ? fmt(pool[Math.floor(e.r * pool.length)], vars) : L.t(e.key, vars);
    return text + (e.suffix || '');
  }

  /* ---------- navigation ---------- */
  bind() {
    /* v1.5: Player Profile Card — right-click any player element, or press its [i] button.
       Capture phase + stopPropagation so the [i] never triggers the click-to-swap underneath. */
    const pidOf = el => el?.closest('[data-info]')?.dataset.info || el?.closest('[data-pid]')?.dataset.pid
      || el?.closest('#roster .r-row, #live-roster .r-row')?.dataset.id || null;
    document.addEventListener('contextmenu', e => {
      const id = pidOf(e.target);
      if (!id) return;
      e.preventDefault();
      this.toggleStart(false);
      this.profile.open(id);
    });
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-info]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      this.profile.open(b.dataset.info);
    }, true);
    document.addEventListener('keydown', e => {   // Enter/Space on [i] must not also select the row
      if (e.target.closest?.('[data-info]') && (e.key === 'Enter' || e.key === ' ')) e.stopPropagation();
    }, true);
    document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => this.show(b.dataset.view)));
    document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => { this.toggleStart(false); this.show(b.dataset.goto); }));
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => this.show('dash')));
    this.$('btn-start').addEventListener('click', () => this.onStartButton());
    this.$('btn-instant').addEventListener('click', () => this.onInstantSim());   // v2.0
    this.$('btn-ver').addEventListener('click', () => this.show('readme'));
    this.$('btn-resume').addEventListener('click', () => this.resumeMatch());
    const lr = this.$('live-roster');
    lr.addEventListener('click', e => { const row = e.target.closest('.r-row'); if (row) this.onLiveRosterClick(row.dataset.id); });
    lr.addEventListener('keydown', e => {
      const row = e.target.closest('.r-row');
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.onLiveRosterClick(row.dataset.id); }
    });
    this.$('btn-sim').addEventListener('click', () => this.onDashAction());
    this.$('today-box').addEventListener('click', e => {   // v2.5: training plan
      const b = e.target.closest('[data-plan]');
      if (b) { this.state.setPlan(b.dataset.plan); this.renderDash(); }
    });
    // v1.6 calendar: month navigation + clickable day cells (info in the status bar)
    this.$('cal-prev').addEventListener('click', () => { this.calMonth = this.shiftMonth(this.viewMonth(), -1); this.renderCalendar(); });
    this.$('cal-next').addEventListener('click', () => { this.calMonth = this.shiftMonth(this.viewMonth(), 1); this.renderCalendar(); });
    this.$('cal-grid').addEventListener('click', e => { const c = e.target.closest('.cal-day[data-date]'); if (c) this.pickDay(c.dataset.date); });
    this.$('btn-full-table').addEventListener('click', () => this.show('table'));
    this.$('btn-startmenu').addEventListener('click', e => { e.stopPropagation(); this.toggleStart(); });
    document.addEventListener('click', e => { if (!e.target.closest('#startmenu')) this.toggleStart(false); });
    const flip = () => this.setLang(L.code === 'ru' ? 'en' : 'ru');
    this.$('btn-lang').addEventListener('click', flip);
    this.$('btn-lang-menu').addEventListener('click', () => { this.toggleStart(false); flip(); });
    try { document.body.classList.toggle('fx', localStorage.getItem('yam_fx') === '1'); } catch (e) {}
    this.$('btn-fx').addEventListener('click', () => {
      const on = document.body.classList.toggle('fx');
      try { localStorage.setItem('yam_fx', on ? '1' : '0'); } catch (e) {}
      this.applyStatic();
    });
    this.$('btn-reset').addEventListener('click', () => {
      this.toggleStart(false);
      if (this.live || this.cal.running) { this.alert(L.t('dlg.finishFirst'), L.t('dlg.academy')); return; }
      this.state.reset(); this.cal.attach(this.state.calendar);
      this.engine = null; this.selected = null; this.tableMd = null;
      this.prepareMatch(); this.renderAll(); this.show('dash');
      this.alert(L.t('dlg.reset'), L.t('dlg.academy'));
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || this.modal.isOpen || this.profile.isOpen || this.teamCard.isOpen) return;
      this.toggleStart(false);
      if (this.selected) { this.clearSelection(); }
      if (this.liveSel) { this.liveSel = null; this.renderLiveRoster(); }
    });

    document.querySelectorAll('[data-shout]').forEach(b => b.addEventListener('click', () => {
      this.mentality = b.dataset.shout;
      if (this.live) this.engine.setMentality(this.mentality);
      this.renderShouts();
      if (this.engine) this.renderAssistant(this.engine);
    }));
    document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
      this.speed = Number(b.dataset.speed);
      try { localStorage.setItem('yam_speed', this.speed); } catch (e) {}
      if (this.live) this.engine.setSpeedMode(this.speed);
      this.renderSpeedBtns();
    }));
    this.$('formation').addEventListener('change', e => {
      if (this.live) { e.target.value = this.state.formation; return; }
      this.state.setFormation(e.target.value);
      this.selected = null;
      this.teamMsg = '';
      this.afterLineupChange();
    });
    this.$('btn-auto').addEventListener('click', () => {
      if (this.live) return;
      this.state.autoArrange(); this.state.save(); this.selected = null; this.teamMsg = '';
      this.afterLineupChange();
    });
    this.$('btn-clear').addEventListener('click', () => this.clearSelection());
    // click on empty space (window background, empty pitch, headers) cancels the selection
    this.$('win-team').addEventListener('click', e => {
      if (!this.selected) return;
      if (e.target.closest('.r-row, .pl, button, select, label, input, a, .titlebar')) return;
      this.clearSelection();
    });

    // match log: sticky auto-scroll + "new events" pill when the user scrolled up
    const log = this.$('log');
    log.addEventListener('scroll', () => { if (this.logAtBottom()) this.$('log-jump').hidden = true; });
    this.$('log-jump').addEventListener('click', () => { log.scrollTop = log.scrollHeight; this.$('log-jump').hidden = true; });

    // roster: click / keyboard / drag-and-drop
    const roster = this.$('roster');
    roster.addEventListener('click', e => {
      const rm = e.target.closest('[data-untag]');
      if (rm) { e.stopPropagation(); if (!this.live) { this.state.removeTag(rm.dataset.id, rm.dataset.untag); this.renderTeam(); } return; }
      const row = e.target.closest('.r-row');
      if (row) this.pick(row.dataset.id);
    });
    roster.addEventListener('keydown', e => {
      const row = e.target.closest('.r-row');
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.pick(row.dataset.id); }
    });
    roster.addEventListener('dragstart', e => {
      const row = e.target.closest('.r-row'); if (!row || this.live) return;
      e.dataTransfer.setData('text/plain', row.dataset.id); e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    roster.addEventListener('dragend', e => { e.target.closest('.r-row')?.classList.remove('dragging'); });
    roster.addEventListener('dragover', e => {
      const row = e.target.closest('.r-row'); if (!row) return;
      e.preventDefault();
      roster.querySelectorAll('.drop-over').forEach(r => r !== row && r.classList.remove('drop-over'));
      row.classList.add('drop-over');
    });
    roster.addEventListener('dragleave', e => { e.target.closest('.r-row')?.classList.remove('drop-over'); });
    roster.addEventListener('drop', e => {
      const row = e.target.closest('.r-row'); if (!row) return;
      e.preventDefault(); row.classList.remove('drop-over');
      this.onDropSwap(row.dataset.id, e.dataTransfer.getData('text/plain'));
    });
    this.$('md-prev').addEventListener('click', () => { this.tableMd = Math.max(1, this.tableMd - 1); this.renderTable(); });
    const openTeam = e => { const tr = e.target.closest('tr[data-team]'); if (tr) this.teamCard.open(+tr.dataset.team); };
    this.$('table-body').addEventListener('click', openTeam);
    this.$('table-body').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTeam(e); } });
    this.$('top-scorers').addEventListener('click', openTeam);
    this.$('top-assists').addEventListener('click', openTeam);
    this.$('md-next').addEventListener('click', () => { this.tableMd = Math.min(this.state.league.matchdays, this.tableMd + 1); this.renderTable(); });

    this.$('notes-body').addEventListener('click', e => {
      if (e.target.closest('#btn-back')) { this.closeMatchday(); return; }
      const b = e.target.closest('[data-tag]'); if (!b || b.disabled) return;
      this.state.setTag(b.dataset.id, b.dataset.tag);
      this.renderNotebook(); this.renderTeam(); this.renderDash();
    });
  }

  afterLineupChange() {
    this.renderTeam();
    this.renderDash();
    if (!this.engine) this.prepareMatch();
  }

  toggleStart(force) {
    const m = this.$('startmenu');
    m.classList.toggle('open', force ?? !m.classList.contains('open'));
  }

  get live() { return !!(this.engine && !this.engine.finished); }

  /* ---------- MATCH: live roster & substitutions (left column, v1.1) ---------- */
  renderLiveRoster() {
    const eng = this.engine, s = this.state;
    const onPitch = eng ? eng.sides[0].entries.map(e => e.p) : s.starters();
    const lines = eng ? eng.sides[0].entries.map(e => e.line) : s.slots().map(x => x.line);
    const onIds = onPitch.map(p => p.id);
    const bench = s.squad.filter(p => !onIds.includes(p.id)).sort((a, b) => POS_ORDER[a.position] - POS_ORDER[b.position]);
    const selP = this.liveSel ? s.player(this.liveSel) : null;
    const over = !!(eng && eng.finished) || (!eng && s.phase !== 'matchday');
    const row = (p, i, pitch) => {
      const status = eng?.sentOff.has(p.id) ? 'sent' : eng?.subbedOff.has(p.id) ? 'off' : '';
      const out = !pitch && !p.available;   // v2.2: can't come on
      const disabled = over || !!status || out;
      const hint = selP && p.id !== selP.id && !disabled ? (p.position === selP.position ? ' suggested-swap' : ' dimmed-swap') : '';
      const sub = status ? L.t('lr.' + status) : out ? L.t('st.short.' + p.unavailableReason) : pitch ? L.line(lines[i]) : L.t('team.onBench');
      return `<div class="r-row lr${pitch ? ' starter' : ' bench'}${this.liveSel === p.id ? ' sel' : ''}${hint}${disabled ? ' disabled' : ''}"
          data-id="${p.id}" role="option" tabindex="${disabled ? -1 : 0}" aria-selected="${this.liveSel === p.id}" aria-disabled="${disabled}">
        <span class="portrait sm">${p.portraitSvg}</span><span class="num">${p.number}</span><span class="pos ${p.position}">${L.pos(p.position)}</span>
        <span class="lr-name"><b>${esc(L.name(p.surname))}${this.statusBadge(p)}</b><span class="lr-sub">${this.infoBtn(p)}<small>${sub}</small></span></span>
        <div class="energy"><i></i><span></span></div><span class="lr-cards"></span>
      </div>`;
    };
    const box = this.$('live-roster');
    const keep = box.scrollTop;
    box.innerHTML = `<div class="r-grp">${L.t('lr.onPitch')}</div>` + onPitch.map((p, i) => row(p, i, true)).join('')
      + `<div class="r-grp">${L.t('lr.bench')}</div>` + bench.map(p => row(p, -1, false)).join('');
    box.scrollTop = keep;
    this.lrRefs = [...box.querySelectorAll('.r-row')].map(el => ({ id: el.dataset.id, bar: el.querySelector('.energy'), fill: el.querySelector('.energy i'), txt: el.querySelector('.energy span'), cards: el.querySelector('.lr-cards'), last: '' }));
    this.$('lr-subs').textContent = eng ? L.t('lr.subs', { n: eng.subsUsed, m: MatchEngine.MAX_SUBS }) : L.t('lr.preMatch');
    const help = over ? 'lr.help.over' : this.liveSel ? 'lr.help.sel' : eng ? 'lr.help.live' : 'lr.help.pre';
    this.$('lr-help').textContent = L.t(help, { n: selP ? L.name(selP.surname) : '' });
    this.updateLiveRoster();
  }

  /** Cheap per-tick update: only energy bars and cards (rows are not rebuilt, so clicks are never lost). */
  updateLiveRoster() {
    const eng = this.engine, s = this.state;
    for (const r of this.lrRefs || []) {
      const p = s.player(r.id); if (!p) continue;
      const e = Math.round(eng?.energy.get(r.id) ?? p.energy);
      const st = eng?.stats.get(r.id);
      const sig = `${e}|${st?.yellow || 0}|${st?.red || 0}`;
      if (sig === r.last) continue;
      r.last = sig;
      r.bar.className = 'energy ' + this.energyClass(e);
      r.fill.style.width = e + '%';
      r.txt.textContent = e + '%';
      r.cards.innerHTML = st?.red ? '<i class="cd r"></i>' : st?.yellow ? '<i class="cd y"></i>' : '';
    }
  }

  onLiveRosterClick(id) {
    const eng = this.engine, s = this.state;
    const row = this.$('live-roster').querySelector(`.r-row[data-id="${id}"]`);
    if (!row || row.classList.contains('disabled')) return;
    const isOn = x => eng ? eng.sides[0].entries.some(e => e.p.id === x) : s.isStarter(x);
    if (!this.liveSel) this.liveSel = id;
    else if (this.liveSel === id) this.liveSel = null;
    else if (!isOn(this.liveSel) && !isOn(id)) this.liveSel = id;   // two bench players: move the selection
    else if (eng && isOn(this.liveSel) === isOn(id)) this.liveSel = id;
    else {
      const a = this.liveSel; this.liveSel = null;
      if (eng) {                      // LIVE substitution
        const outId = isOn(a) ? a : id, inId = outId === a ? id : a;
        const err = eng.substitute(outId, s.player(inId));
        if (err) this.alert(L.t('sub.err.' + err, { m: MatchEngine.MAX_SUBS }), L.t('sub.err.title'), 'error');
      } else {                        // before kick-off: same rules as Team Management
        const err = s.swapPlayers(a, id);
        if (err) this.alert(L.t('team.err.' + err), L.t('team.err.title'), 'error');
        else { this.renderTeam(); this.prepareMatch(); return; }
      }
    }
    this.renderLiveRoster();
  }

  onSub(out, inP) {
    this.radar.substitute(out.id, inP);
    this.renderLiveRoster();
  }

  onHalfTime(eng) {
    const [a, b] = eng.sides;
    this.$('ht-score').textContent = `${L.team(a.name).replace(' U-14', '')}  ${a.score} - ${b.score}  ${L.team(b.name)}`;
    this.$('ht-banner').hidden = false;
    this.renderMatchChrome();
    this.renderAssistant(eng);
  }
  resumeMatch() {
    if (!this.engine || !this.engine.paused) return;
    this.$('ht-banner').hidden = true;
    this.engine.resume();
    this.renderMatchChrome();
  }

  /* ---------- MATCH: assistant coach (right column, v1.1) ---------- */
  assistantMessages(eng) {
    if (!eng) return this.state.phase === 'matchday' ? [{ key: 'asst.pre', pr: 10 }] : [];
    if (eng.finished) return [{ key: 'asst.ft', pr: 10 }];
    const [us, them] = eng.sides;
    const mine = us.entries.map(e => e.p).filter(p => !eng.sentOff.has(p.id));
    const en = p => Math.round(eng.energy.get(p.id) ?? 100);
    const st = p => eng.stats.get(p.id);
    const msgs = [];
    if (eng.paused) msgs.push({ key: 'asst.ht', vars: { t: mine.filter(p => en(p) < 45).length, c: mine.filter(p => st(p).yellow).length }, pr: 100 });
    mine.slice().sort((a, b) => en(a) - en(b)).slice(0, 2).forEach((p, i) => {
      const e = en(p);
      if (e < ENERGY.EXHAUSTED) msgs.push({ key: 'asst.exhausted', vars: { n: p, e }, pr: 90 - i });
      else if (e < 45) msgs.push({ key: 'asst.tiring', vars: { n: p, e }, pr: 45 - i });
    });
    mine.filter(p => st(p).yellow && !st(p).red).forEach(p => msgs.push({ key: 'asst.yellow', vars: { n: p }, pr: 80 }));
    if (us.players.some(p => eng.sentOff.has(p.id))) msgs.push({ key: 'asst.red', vars: { k: mine.length }, pr: 85 });
    const diff = us.score - them.score;
    if (diff < 0 && this.mentality !== 'attack') msgs.push({ key: eng.minute >= 70 ? 'asst.losingLate' : 'asst.losing', pr: eng.minute >= 70 ? 78 : 70 });
    if (diff > 0 && eng.minute >= 70 && this.mentality !== 'defend') msgs.push({ key: 'asst.protect', pr: 60 });
    if (eng.minute >= 15) {
      const t = eng.teamTotals(0), passes = t.passOk + t.passFail;
      const total = eng.possTicks[0] + eng.possTicks[1] || 1, share = Math.round(eng.possTicks[0] / total * 100);
      if (passes >= 20 && t.passOk / passes < 0.55) msgs.push({ key: 'asst.sloppy', vars: { r: Math.round(t.passOk / passes * 100) }, pr: 35 });
      if (share < 38) msgs.push({ key: 'asst.possession', vars: { p: share }, pr: 30 });
    }
    if (!msgs.length) msgs.push({ key: 'asst.good', pr: 0 });
    return msgs.sort((a, b) => b.pr - a.pr).slice(0, 3);
  }
  renderAssistant(eng) {
    const msgs = this.assistantMessages(eng);
    const html = msgs.map((m, i) => {
      const vars = {};
      for (const k in (m.vars || {})) vars[k] = esc(this.v(m.vars[k]));
      const lvl = m.pr >= 75 ? 'hi' : m.pr >= 45 ? 'mid' : 'lo';
      return `<div class="asst-msg ${lvl}${i === 0 ? ' top' : ''}"><span class="ic">${lvl === 'lo' ? 'i' : '!'}</span>${L.t(m.key, vars)}</div>`;
    }).join('');
    if (html !== this.asstHtml) { this.$('asst').innerHTML = html; this.asstHtml = html; }
  }
  get matchOpen() { return this.live || this.state.phase === 'matchday' || this.state.phase === 'post'; }
  get notesOpen() { return this.state.phase === 'post' && this.state.notebookUnlocked && !!this.state.lastReport; }

  show(view) {
    if (view === 'notes' && !this.notesOpen) { this.alert(L.t('dlg.nbLocked'), L.t('dlg.nbTitle'), 'warn'); return; }
    if (view === 'match' && !this.matchOpen) { this.alert(L.t('dlg.noMatch'), L.t('nav.match'), 'warn'); return; }
    this.view = view;
    const scenes = { dash: 'scene-office', team: 'scene-squad', match: 'scene-match', table: 'scene-table', notes: 'scene-notes', readme: 'scene-office' };
    // several views can share one backdrop (readme uses the office): compare by scene id, not by view name
    for (const id of new Set(Object.values(scenes))) this.$(id).classList.toggle('active', id === scenes[view]);
    for (const v of Object.keys(scenes)) this.$('win-' + v).classList.toggle('open', v === view);
    document.querySelectorAll('.tk[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if (view === 'notes') this.$('tk-notes').classList.remove('alert');
    if (view === 'match') this.$('tk-match').classList.remove('alert');
    if (view === 'table') this.renderTable();
    if (view === 'dash') this.renderDash();
  }

  alert(html, title, icon = 'info', buttons) { this.profile?.close(); this.teamCard?.close(); this.modal.show({ title, html, icon, buttons }); }

  /** Match / Notebook only exist in the navigation while the calendar has unlocked them. */
  syncLocks() {
    const m = this.matchOpen, n = this.notesOpen;
    for (const id of ['tk-match', 'icon-match', 'sm-match']) this.$(id).hidden = !m;
    for (const id of ['tk-notes', 'icon-notes', 'sm-notes']) this.$(id).hidden = !n;
    this.$('dyn-sep').hidden = !(m || n);
    if ((this.view === 'match' && !m) || (this.view === 'notes' && !n)) this.show('dash');
    this.$('tray-date').textContent = fmtDate(this.cal.date, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ---------- JUICE: screen shake + CRT surge (triggered by the pitch renderer) ---------- */
  shake() {
    if (REDUCED_MOTION) return;
    const el = this.$('win-match').querySelector('.match-body');
    el.classList.remove('screen-shake'); void el.offsetWidth; el.classList.add('screen-shake');
    clearTimeout(this.shakeT); this.shakeT = setTimeout(() => el.classList.remove('screen-shake'), 300);
  }
  flash(tone = 'goal') {
    const el = this.$('surge');
    el.className = 'surge'; void el.offsetWidth; el.classList.add('surge-go', tone);
    clearTimeout(this.flashT); this.flashT = setTimeout(() => { el.className = 'surge'; }, 400);
  }

  /* ---------- README.TXT: version history ---------- */
  renderReadme() {
    const lang = L.code;
    const line = '='.repeat(52);
    this.$('btn-ver').textContent = 'v' + APP_VERSION;
    this.$('readme-body').innerHTML = `
      <div class="np-head">YOUTH ACADEMY MANAGER — ${L.t('readme.head')}
${L.t('readme.current', { v: APP_VERSION })}
${line}</div>` + PATCH_NOTES.map((n, i) => `
      <section class="np-ver${i === 0 ? ' latest' : ''}">
        <h3>v${n.v} — “${esc(n.name[lang])}”${i === 0 ? ` <span class="np-new">${L.t('readme.new')}</span>` : ''}</h3>
        <ul>${n[lang].map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      </section>`).join('') + `<div class="np-foot">${line}\n${L.t('readme.foot')}</div>`;
    this.$('readme-status').textContent = L.t('readme.status', { v: APP_VERSION, n: PATCH_NOTES.length });
  }

  /** After an update, offer the patch notes once. */
  checkUpdateNotice() {
    let seen = null;
    try { seen = localStorage.getItem('yam_seen_version'); localStorage.setItem('yam_seen_version', APP_VERSION); } catch (e) {}
    if (seen === APP_VERSION) return;
    this.alert(L.t('update.text', { v: APP_VERSION }), L.t('update.title'), 'info', [
      { label: L.t('update.open'), primary: true, onClick: () => this.show('readme') },
      { label: L.t('modal.later') },
    ]);
  }

  /* ---------- DASHBOARD ---------- */
  seasonVars() { return { y: this.state.season, z: String(this.state.season + 1).slice(2) }; }

  renderDash() {
    const s = this.state, lg = s.league, phase = s.phase;
    const date = this.cal.date;

    // LEFT: next event with a big opponent badge
    const ev = this.cal.nextEvent();
    const ctx = s.matchContext();
    if (ev) {
      const n = daysBetween(date, ev.date);
      const when = n <= 0 ? `<span class="today">${L.t('dash.today')}</span>` : n === 1 ? L.t('dash.tomorrow') : L.t('dash.inDays', { n });
      let sub = '', badge = emblemHTML(lg.team(0), 'lg');
      if (ev.type === 'match' && ctx) {
        badge = emblemHTML(ctx.opp, 'lg');
        sub = `<span class="tag t-${ctx.venue}">${L.t('venue.' + ctx.venue)}</span> `
          + L.t('ev.match.sub', { date: fmtDate(ev.date, { weekday: 'short', day: 'numeric', month: 'short' }), pos: lg.position(ctx.opp.id), f: ctx.opp.formation });
      }
      this.$('next-event').innerHTML = `
        <div class="ne-row">${badge}<div class="ne-date"><div class="ev-when">${when}</div>
          <div class="ne-day">${fmtDate(ev.date, { day: 'numeric' })}</div>
          <div class="ne-month">${fmtDate(ev.date, { weekday: 'short', month: 'short' })}</div></div></div>
        <div class="ev-title">${this.cal.label(ev)}</div>
        <div class="ev-sub">${sub}</div>`;
    } else {
      this.$('next-event').innerHTML = `<div class="ne-row">${emblemHTML(lg.team(0), 'lg')}</div><div class="ev-title">${L.t('dash.none')}</div>`;
    }
    this.$('cal-legend').innerHTML = ['match', 'W', 'D', 'L', 'training', 'rest', 'today']
      .map(k => `<li><i class="sw sw-${k}"></i>${L.t('cal.lg.' + k)}</li>`).join('');

    // club panel
    const row = s.userRow();
    const avg = Math.round(s.squad.reduce((a, p) => a + p.energy, 0) / s.squad.length);
    const tired = s.squad.filter(p => p.energy < ENERGY.TIRED).length;
    this.$('club-kv').innerHTML = `
      <dt>${L.t('dash.record')}</dt><dd>${L.t('dash.recordVal', row)}</dd>
      <dt>${L.t('dash.form')}</dt><dd>${this.formChips(row.form) || '—'}</dd>
      <dt>${L.t('dash.formation')}</dt><dd>${s.formation}</dd>
      <dt>${L.t('dash.budget')}</dt><dd class="money${s.budget < 0 ? " debt" : ""}">${money(s.budget)}</dd>
      <dt>${L.t('dash.energy')}</dt><dd${tired ? ' class="warn"' : ''}>${L.t('dash.energyVal', { a: avg, t: tired })}</dd>`;

    // main action button
    const btn = this.$('btn-sim');
    btn.disabled = this.cal.running || this.live || this.events.active || this.dayBlockers().length > 0;
    btn.classList.toggle('pulse', phase === 'matchday' || phase === 'post');
    if (this.cal.running) btn.innerHTML = L.t('dash.simming');
    else if (phase === 'calendar') btn.innerHTML = L.t(this.dayBlockers().length ? 'dash.endDayBlocked' : 'dash.endDay');
    else if (phase === 'matchday') btn.innerHTML = L.t('dash.goMatch');
    else if (phase === 'post') btn.innerHTML = L.t('dash.close');
    else btn.innerHTML = L.t('dash.newSeason', { y: s.season + 1, z: String(s.season + 2).slice(2) });
    this.renderToday();   // v2.5
    this.$('sim-hint').innerHTML = phase === 'seasonEnd'
      ? L.t('dash.hint.seasonEnd', { pos: lg.position(0), pts: row.pts })
      : L.t('dash.hint.' + phase, { n: ENERGY.DAILY_REST });

    // CENTER: month grid + diary
    this.renderCalendar();
    this.renderTicker();

    // RIGHT: latest played matchday (or the first fixtures before any game), then the top 5
    const last = lg.playedMatchdays();
    const md = last || 1;
    this.$('md-fx-label').textContent = L.t(last ? 'dash.results' : 'dash.thisMd', { md });
    this.$('md-fixtures').innerHTML = lg.fixturesOf(md).map(f => this.fixtureHTML(f)).join('');
    this.renderMiniTable();

    this.$('dash-status').textContent = L.t('dash.status.' + phase);
    this.$('dash-season').textContent = `${L.t('dash.season', this.seasonVars())} · v${APP_VERSION}`;
    this.syncLocks();
  }

  /* ---------- v1.6 CALENDAR GRID (month view, Sunday first) ---------- */
  viewMonth() { return this.calMonth || this.cal.date.slice(0, 7); }      // 'YYYY-MM'; null = follow the current date
  shiftMonth(ym, k) { const d = new Date(ym + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + k); return d.toISOString().slice(0, 7); }

  /** Everything the calendar knows about one day (done events included). */
  dayInfo(iso) {
    const s = this.state, lg = s.league;
    const ev = s.calendar.events.find(e => e.date === iso);
    if (ev?.type === 'match') {
      const f = lg.userFixture(ev.md), home = f.home === 0;
      const opp = lg.team(home ? f.away : f.home);
      let res = null;
      if (lg.played(f)) { const gf = home ? f.hg : f.ag, ga = home ? f.ag : f.hg; res = { r: gf > ga ? 'W' : gf < ga ? 'L' : 'D', gf, ga }; }
      return { kind: 'match', ev, f, opp, venue: home ? 'home' : 'away', res };
    }
    const start = s.calendar.events[0] && isoAdd(s.calendar.events[0].date, -SEASON.FIRST_MATCH_OFFSET);
    const end = s.calendar.events[s.calendar.events.length - 1]?.date;
    if (!(start && iso >= start && iso <= end)) return { kind: 'off' };
    return { kind: isTrainingDay(iso) ? 'training' : 'rest' };   // v2.4
  }

  renderCalendar() {
    const ym = this.viewMonth(), today = this.cal.date;
    const first = ym + '-01', lead = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7;   // v2.4: Monday-first week
    const days = daysBetween(first, this.shiftMonth(ym, 1) + '-01');
    this.$('cal-month').textContent = fmtDate(first, { month: 'long', year: 'numeric' });
    this.$('cal-today').textContent = fmtDate(today, { weekday: 'long', day: 'numeric', month: 'long' });
    const wd = Array.from({ length: 7 }, (_, i) => `<div class="cal-wd${i >= 5 ? ' we' : ''}">${fmtDate(isoAdd('2002-09-02', i), { weekday: 'short' })}</div>`).join('');   // 2002-09-02 = Monday
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const n = i - lead + 1;
      if (i >= 35 && n > days) break;
      if (n < 1 || n > days) { cells += '<div class="cal-day out"></div>'; continue; }
      const iso = `${ym}-${String(n).padStart(2, '0')}`, d = this.dayInfo(iso);
      const cls = ['cal-day', d.kind, iso === today ? 'today' : '', iso < today ? 'past' : '', d.res ? 'r-' + d.res.r : ''].filter(Boolean).join(' ');
      let body = '';
      if (d.kind === 'match') {
        const tag = d.res ? `${d.res.gf}-${d.res.ga}` : `${L.t('cal.md')}${d.ev.md}`;
        body = `<div class="cd-ev">${emblemHTML(d.opp, 'xs')}<span class="cd-tag ${d.res ? 't-' + d.res.r : 't-match'}">${tag}</span></div>
          <div class="cd-opp">${esc(L.team(d.opp.name))}</div>`;
      } else if (d.kind === 'rest') body = '<div class="cd-rest"></div>';
      else if (d.kind === 'training') body = `<div class="cd-cone" aria-hidden="true"></div><div class="cd-tr">${L.t('cal.trShort')}</div>`;
      cells += `<div class="${cls}" data-date="${iso}" role="gridcell" tabindex="-1" title="${esc(this.dayText(iso, d))}"><span class="cd-n">${n}</span>${body}</div>`;
    }
    this.$('cal-grid').innerHTML = wd + cells;
    const span = this.state.calendar.events;
    this.$('cal-prev').disabled = span.length && this.shiftMonth(ym, -1) < span[0].date.slice(0, 7);
    this.$('cal-next').disabled = span.length && this.shiftMonth(ym, 1) > span[span.length - 1].date.slice(0, 7);
  }

  dayText(iso, d = this.dayInfo(iso)) {
    const when = fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short' });
    if (d.kind === 'match') return `${when}: ` + L.t(d.res ? 'cal.info.played' : 'cal.info.match',
      { md: d.ev.md, o: L.team(d.opp.name), v: L.t('venue.' + d.venue), x: d.res?.gf, y: d.res?.ga });
    return `${when}: ` + L.t({ rest: 'cal.info.rest', training: 'cal.info.training' }[d.kind] || 'cal.info.off', { n: ENERGY.DAILY_REST, d: TRAINING.DRAIN, s: TRAINING.SHARP });
  }

  pickDay(iso) {
    this.$('cal-grid').querySelectorAll('.cal-day.sel').forEach(c => c.classList.remove('sel'));
    this.$('cal-grid').querySelector(`[data-date="${iso}"]`)?.classList.add('sel');
    this.$('dash-status').textContent = this.dayText(iso);
  }

  renderMiniTable() {
    const rows = this.state.league.table();
    const top = rows.slice(0, 5), mi = rows.findIndex(r => r.team.user);
    const tr = (r, i) => `<tr class="${r.team.user ? 'me' : ''}${i === 0 && r.p ? ' lead' : ''}"><td class="c pos-n">${i + 1}</td>
      <td class="tm"><div class="tm-in">${emblemHTML(r.team, 'xs')}<span>${esc(L.team(r.team.name))}</span></div></td><td class="c">${r.p}</td>
      <td class="c">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="c pts">${r.pts}</td></tr>`;
    this.$('mini-table').innerHTML = `<tr class="hd"><th class="c">${L.t('table.pos')}</th><th>${L.t('table.team')}</th><th class="c">${L.t('table.p')}</th><th class="c">${L.t('table.gd')}</th><th class="c">${L.t('table.pts')}</th></tr>`
      + top.map(tr).join('') + (mi >= 5 ? `<tr class="gap"><td colspan="5">⋯</td></tr>` + tr(rows[mi], mi) : '');
  }

  renderTicker() {
    const t = this.$('ticker');
    t.innerHTML = this.state.diary.slice(-40).map(d =>
      `<div class="tk-line ${d.cls || ''}"><span class="d">${fmtDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>${esc(this.entryText({ ...d, r: 0 }))}</div>`).join('');
    t.scrollTop = t.scrollHeight;
  }

  formChips(form) { return form.map(r => `<span class="fc ${r}">${L.t('res.' + r)}</span>`).join(''); }

  fixtureHTML(f) {
    const lg = this.state.league;
    const me = f.home === 0 || f.away === 0;
    const score = lg.played(f) ? `${f.hg} - ${f.ag}` : 'vs';
    const H = lg.team(f.home), A = lg.team(f.away);
    return `<div class="fx${me ? ' me' : ''}"><span class="h">${esc(L.team(H.name))}${emblemHTML(H, 'xs')}</span><b>${score}</b><span class="a">${emblemHTML(A, 'xs')}${esc(L.team(A.name))}</span></div>`;
  }

  /** The one big button on the Dashboard changes with the phase of the matchday loop. */
  onDashAction() {
    const phase = this.state.phase;
    if (phase === 'matchday') { this.show('match'); return; }
    if (phase === 'post') { this.closeMatchday(); return; }
    if (phase === 'seasonEnd') {
      this.state.newSeason(this.state.season + 1);
      this.cal.attach(this.state.calendar);
      this.engine = null; this.tableMd = null;
      this.prepareMatch(); this.renderAll();
      return;
    }
    if (this.events.active) { this.events.open(); return; }   // a dilemma is still waiting for an answer
    this.endDay();   // v2.5: one day per click
  }

  /* ---------- v2.5 DAILY LOOP: decide → END DAY → (evening event?) → next morning ---------- */
  /** Mandatory tasks that block END DAY. */
  dayBlockers() {
    const s = this.state, out = [];
    if (s.phase === 'calendar' && isTrainingDay(s.calendar.date) && !s.dayState().plan && this.dayInfo(s.calendar.date).kind === 'training') out.push('plan');
    return out;
  }
  endDay() {
    const s = this.state;
    if (this.cal.running || s.phase !== 'calendar' || this.events.active || this.dayBlockers().length) { this.renderDash(); return; }
    const r = this.cal.step();
    if (r.stopped) { this.cal.types[r.stopped.type]?.onArrive?.(r.stopped); return; }   // safety: today was already a match day
    for (const info of r.infos) s.addDiary({ date: r.date, ...info });
    this.calMonth = null;
    s.save();
    const fired = this.cal.nextEvent() && this.events.roll(r.date, { resume: false });   // the evening: something may happen
    if (!fired) this.morning();
    else this.renderAll();
  }
  /** New morning: AP and plan reset (lazily in dayState); a match day arrives straight away. */
  morning() {
    const s = this.state;
    if (s.phase === 'calendar' && this.cal.blockingToday()) {
      const r = this.cal.step();
      if (r.stopped) { this.cal.types[r.stopped.type]?.onArrive?.(r.stopped); return; }
    }
    if (s.phase === 'calendar' && !this.cal.nextEvent()) { s.phase = 'seasonEnd'; s.save(); }
    this.renderAll();
  }
  /** v2.5 debug / tests: the old non-stop simulation to the next match (Match Practice on training days). */
  autoSim() { if (this.state.phase === 'calendar' && !this.events.active) this.runCalendar(); }

  /** v2.5: [ CALL INTO OFFICE ] — 1 action point, a short talk in the dialogue box. */
  canCallIn(id) {
    const s = this.state, p = s.player(id);
    return !!p && s.ap > 0 && !this.events.active && !(this.engine && !this.engine.finished) && !this.cal.running;
  }
  callIntoOffice(id) {
    if (!this.canCallIn(id) || !this.state.spendAP()) return;
    this.profile.close();
    this.events.fire('office', this.state.calendar.date, { cast: { kid: id } });
    this.renderBudget();
  }

  /** Visible day-by-day simulation. v1.9: after every non-match day the EventEngine may fire an event,
      which PAUSES the calendar; EventEngine.choose() calls runCalendar() again to resume. */
  runCalendar() {
    if (this.cal.running || this.state.phase !== 'calendar') return;
    this.calMonth = null;   // calendar view follows the days as they pass
    this.cal.simulate({
      stepMs: 180,
      onStep: (date, infos) => {
        for (const info of infos) this.state.addDiary({ date, ...info });
        if (this.cal.nextEvent() && this.events.roll(date)) this.cal.stop();
        this.state.save();
        this.renderDash();
        this.renderTeam();
      },
      onStop: () => { this.state.save(); this.renderAll(); },
    });
    this.renderDash();
  }

  /** v2.5: TODAY widget — date, action points, mandatory training plan (Tue/Thu). */
  renderToday() {
    const s = this.state, box = this.$('today-box');
    if (!box) return;
    const d = s.dayState(), info = this.dayInfo(s.calendar.date), live = s.phase === 'calendar';
    const pips = Array.from({ length: COACH.AP }, (_, i) => `<i class="${i < d.ap ? 'on' : ''}"></i>`).join('');
    let body = '';
    if (live && info.kind === 'training') {
      const need = !d.plan;
      body = `<div class="td-req${need ? ' need' : ''}">${L.t(need ? 'today.planReq' : 'today.planSet')}</div><div class="plan-grid">`
        + REGIME_KEYS.map(k => `<button type="button" class="plan-btn${d.plan === k ? ' on' : ''}" data-plan="${k}" aria-pressed="${d.plan === k}">
            <b>${L.t('plan.' + k)}</b><small>${L.t('plan.' + k + '.d')}</small></button>`).join('') + '</div>';
    } else if (live) body = `<div class="td-note">${L.t(info.kind === 'rest' ? 'today.rest' : 'today.off', { n: ENERGY.DAILY_REST })}</div>`;
    else body = `<div class="td-note">${L.t('today.phase.' + s.phase)}</div>`;
    box.innerHTML = `<div class="td-head"><b>${fmtDate(s.calendar.date, { weekday: 'long', day: 'numeric', month: 'short' })}</b>
        <span class="td-kind k-${info.kind}">${L.t('today.kind.' + info.kind)}</span></div>
      <div class="td-ap" title="${esc(L.t('ap.tip'))}">${L.t('ap.left')} <span class="ap-pips">${pips}</span> <b>${d.ap}/${COACH.AP}</b></div>${body}`;
  }

  /** v1.9: club budget in the taskbar header (+ a short green/red flash when it changes). */
  renderBudget(delta = 0) {
    const el = this.$('hdr-budget');
    if (!el) return;
    el.innerHTML = L.t('hdr.budget', { b: money(this.state.budget) }); el.classList.toggle('debt', this.state.budget < 0);
    const ap = this.$('hdr-ap');   // v2.5
    if (ap) { const n = this.state.ap; ap.innerHTML = L.t('hdr.ap', { n, m: COACH.AP }); ap.classList.toggle('spent', n < 1); }
    if (delta) { el.classList.remove('up', 'down'); void el.offsetWidth; el.classList.add(delta > 0 ? 'up' : 'down'); }
  }

  /** v2.2: after a match — served bans tick down, deal benches end, red cards = 1-match ban, some knocks become injuries. */
  applyAvailabilityAfterMatch(eng, ctx) {
    const s = this.state, date = s.calendar.date;
    for (const p of s.squad) {
      if (p.suspensionMatches > 0 && !eng.everPlayed.has(p.id)) p.suspensionMatches--;
      if (p.hasFlag('Benched')) p.flags = p.flags.filter(f => f !== 'Benched');
      if (p.hasFlag('Showcase')) {   // v2.3: 90 minutes in front of the scout, whatever his legs said
        p.flags = p.flags.filter(f => f !== 'Showcase');
        if (!eng.everPlayed.has(p.id)) continue;
        p.energy = clamp(p.energy - EVENTS_CFG.SHOWCASE_DRAIN, 0, 100);
        const hurt = Math.random() < EVENTS_CFG.SHOWCASE_INJURY * (p.energy < ENERGY.TIRED ? 2 : 1);
        if (hurt) p.injuryDays = Math.max(p.injuryDays, rnd(...EVENTS_CFG.SHOWCASE_DAYS));
        s.addDiary({ date, key: hurt ? 'scout.hurt' : 'scout.done', vars: { k: { pid: p.id }, d: p.injuryDays }, cls: 'ev' });
      }
    }
    for (const p of eng.sides[0].all) {
      const own = s.player(p.id); if (!own) continue;
      if (eng.st(p).red) {
        own.suspensionMatches = Math.max(own.suspensionMatches, EVENTS_CFG.RED_BAN);
        s.addDiary({ date, key: 'sus.red', vars: { k: { pid: own.id }, n: EVENTS_CFG.RED_BAN }, cls: 'ev' });
      }
      if (eng.injured.has(p.id) && Math.random() < EVENTS_CFG.KNOCK_TO_INJURY) {
        own.injuryDays = Math.max(own.injuryDays, rnd(...EVENTS_CFG.KNOCK_DAYS));
        s.addDiary({ date, key: 'inj.match', vars: { k: { pid: own.id }, d: own.injuryDays }, cls: 'ev' });
      }
    }
  }
  /** v2.2: red cross (injured, days left) / red card (suspended, matches left) / deal lock. */
  statusBadge(p) {
    const r = p.unavailableReason;
    if (!r) return '';
    const n = r === 'inj' ? p.injuryDays : r === 'sus' ? p.suspensionMatches : r === 'home' ? p.awayDays : '';
    return `<span class="st-badge ${r}" title="${esc(L.t('st.' + r, { n }))}">${{ inj: '\u271A', sus: '<i></i>', home: '\u2302', deal: '$' }[r]}${n}</span>`;
  }

  /** v1.9: Promised_Start is checked at kick-off — kept quietly, or broken (morale crash + the parent wants money back). */
  checkPromises() {
    const s = this.state;
    for (const p of s.squad.filter(x => x.hasFlag('Promised_Start'))) {
      p.flags = p.flags.filter(f => f !== 'Promised_Start');
      const kept = s.isStarter(p.id), pool = p.promiseBy === 'pool';
      p.promiseBy = null;
      let refund = 0;
      if (!kept && pool) {   // v2.3: the dad who lost at the pub keeps his son at home
        p.dyn.morale = clamp(p.dyn.morale + EVENTS_CFG.POOL_BROKEN_MORALE, 0, 100);
        p.awayDays = Math.max(p.awayDays, EVENTS_CFG.HOME_DAYS);
      } else if (!kept) { p.dyn.morale = clamp(p.dyn.morale + EVENTS_CFG.PROMISE_BROKEN_MORALE, 0, 100); refund = -s.addMoney(-EVENTS_CFG.DAD_REFUND); }
      const key = kept ? 'ev.promise.kept' : pool ? 'ev.promise.brokenPool' : 'ev.promise.broken';
      s.addDiary({ date: s.calendar.date, key, vars: { k: { pid: p.id }, m: '$' + refund, d: EVENTS_CFG.HOME_DAYS }, cls: 'ev' });
      if (this.engine) this.engine.log(kept ? 'coach' : 'turn', kept ? 'ev.promise.kept' : pool ? 'ev.promise.brokenPool' : 'ev.promise.brokenLog', { k: p, m: '$' + refund, d: EVENTS_CFG.HOME_DAYS }, 0);
    }
    s.save();
  }

  onMatchdayArrived(ev) {
    const s = this.state;
    s.phase = 'matchday';
    const ctx = s.matchContext();
    const vars = { md: ev.md, o: { team: ctx.opp.name }, v: L.t('venue.' + ctx.venue) };
    s.addDiary({ date: ev.date, key: 'cal.arrive', vars: { ...vars, v: { venue: ctx.venue } }, cls: 'hl' });
    for (const c of s.ensureAvailableXI()) s.addDiary({ date: ev.date, key: 'xi.auto', vars: { a: { pid: c.out.id }, b: { pid: c.in.id } }, cls: 'ev' });
    s.save();
    this.engine = null;
    this.prepareMatch();
    this.renderAll();
    this.$('tk-match').classList.add('alert');
    if (this.events.rollMatchDay(ev)) return;   // v2.2: match-day event BEFORE kick-off; the matchday dialog follows the choice
    this.showMatchdayDialog();
  }
  /** v2.2: called by EventEngine.choose() after a match-day event. */
  afterMatchdayEvent() { this.prepareMatch(); this.renderAll(); this.showMatchdayDialog(); }
  showMatchdayDialog() {
    const s = this.state, ctx = s.matchContext(), ev = s.nextMatchEvent();
    if (!ctx || s.phase !== 'matchday') return;
    this.alert(L.t('dlg.matchday', { md: ev.md, o: esc(L.team(ctx.opp.name)), v: L.t('venue.' + ctx.venue) }), L.t('dlg.matchdayTitle'), 'match', [
      { label: L.t('modal.toMatch'), primary: true, onClick: () => this.show('match') },
      { label: L.t('modal.toTeam'), onClick: () => this.show('team') },
      { label: L.t('modal.later') },
    ]);
  }

  /** "Return to Dashboard": completes the matchday event and queues the next one. */
  closeMatchday() {
    const s = this.state;
    if (s.phase !== 'post') { this.show('dash'); return; }
    const ev = s.nextMatchEvent();
    const rep = s.lastReport;
    this.cal.completeEvent(ev.id);
    s.tickInjuries();   // v2.2: the match day counts as a day of healing too
    this.cal.advanceDay();
    s.addDiary({ date: ev.date, key: 'cal.closed', vars: { md: ev.md, x: rep.gf, y: rep.ga, o: { team: rep.opponent }, pos: s.league.position(0) } });
    s.phase = this.cal.nextEvent() ? 'calendar' : 'seasonEnd';
    s.notebookUnlocked = false;   // POST-MATCH only exists until the matchday is closed
    this.engine = null;
    s.save();
    this.prepareMatch();
    this.renderAll();
    this.show('dash');
  }

  /* ---------- STANDINGS ---------- */
  renderTable() {
    const lg = this.state.league;
    const rows = lg.table();
    this.$('table-body').innerHTML = rows.map((r, i) => `
      <tr class="${r.team.user ? 'me' : ''}${i === 0 && r.p ? ' lead' : ''}" data-team="${r.team.id}" tabindex="0">
        <td class="c pos-n">${i + 1}</td><td class="tm"><div class="tm-in">${emblemHTML(r.team, 'sm')}<span>${esc(L.team(r.team.name))}</span></div></td>
        <td class="c">${r.p}</td><td class="c">${r.w}</td><td class="c">${r.d}</td><td class="c">${r.l}</td>
        <td class="c">${r.gf}</td><td class="c">${r.ga}</td><td class="c">${r.gd > 0 ? '+' : ''}${r.gd}</td>
        <td class="c pts">${r.pts}</td><td class="form">${this.formChips(r.form)}</td>
      </tr>`).join('');
    const playedMd = lg.playedMatchdays();
    if (this.tableMd == null) this.tableMd = Math.max(1, playedMd);
    this.$('md-label').textContent = L.t('table.md', { n: this.tableMd });
    this.$('md-prev').disabled = this.tableMd <= 1;
    this.$('md-next').disabled = this.tableMd >= lg.matchdays;
    this.$('md-results').innerHTML = lg.fixturesOf(this.tableMd).map(f => this.fixtureHTML(f)).join('');
    this.$('table-status').textContent = L.t('table.status', { n: playedMd });
    this.renderLeaders();
    this.teamCard.render();
  }

  /** v1.7: Top Scorers / Top Assists (AI kids + our academy). */
  renderLeaders() {
    const s = this.state, all = s.league.scorers(s.squad, s.seasonStats);
    const fill = (id, key) => {
      const top = League.leaders(all, key, 7);
      this.$(id).innerHTML = `<thead><tr><th class="c">${L.t('table.pos')}</th><th>${L.t('table.player')}</th><th class="c"></th><th class="c">${L.t(key === 'goals' ? 'table.g' : 'table.a')}</th></tr></thead><tbody>`
        + (top.length ? top.map((k, i) => `<tr class="${k.own ? 'me' : ''}${i === 0 ? ' lead' : ''}" data-team="${k.team.id}">
            <td class="c pos-n">${i + 1}</td><td class="nm">${esc(L.name(k.name))}</td>
            <td class="c">${emblemHTML(k.team, 'xs')}</td><td class="c pts">${k[key]}</td></tr>`).join('')
          : `<tr class="empty"><td colspan="4">${L.t('table.none')}</td></tr>`) + '</tbody>';
    };
    fill('top-scorers', 'goals');
    fill('top-assists', 'assists');
  }

  /* ---------- TEAM MANAGEMENT: roster (left) + tactics board (right) ---------- */
  fillFormations() {
    this.$('formation').innerHTML = FORMATION_KEYS.map(f => `<option value="${f}">${f}</option>`).join('');
  }

  /** Semantic energy colours: green > 70, yellow 30-70, red < 30 (stats halve below 50). */
  energyClass(e) { return e > 70 ? 'hi' : e >= 30 ? 'mid' : 'lo'; }

  renderTeam() {
    const s = this.state, live = this.live;
    if (live || (this.selected && !s.player(this.selected))) this.selected = null;
    const slots = s.slots();
    const byPos = (a, b) => POS_ORDER[a.position] - POS_ORDER[b.position];

    const row = (p, starter) => {
      const e = Math.round(p.energy);
      const line = starter ? slots[s.lineup.indexOf(p.id)].line : null;
      const oop = line && line !== 'GK' && NATURAL_LINE[p.position] !== line;
      const sub = starter
        ? `<small class="r-slot${oop ? ' warn' : ''}">${oop ? L.t('squad.oop', { l: L.line(line) }) : L.t('team.slot', { l: L.line(line) })}</small>`
        : `<small class="r-slot">${L.t('team.onBench')}</small>`;
      const sel = this.selected === p.id;
      const hint = this.swapClass(p);
      const out = !p.available;   // v2.2: injured / suspended → locked out of the XI
      return `<div class="r-row ${starter ? 'starter' : 'bench'}${sel ? ' sel' : ''}${hint ? ' ' + hint : ''}${live ? ' locked' : ''}${out ? ' unavail' : ''}" data-id="${p.id}"
          role="option" tabindex="0" aria-selected="${sel}" draggable="${!live}"${hint === 'suggested-swap' ? ` aria-description="${esc(L.t('team.suggestedAria'))}"` : ''}>
        <span class="num">${p.number}</span>
        <span class="r-name"><span class="r-line"><span class="pos ${p.position}" title="${esc(L.t('team.posTitle', { p: L.pos(p.position) }))}">${L.pos(p.position)}</span><b>${esc(L.name(p.name))}</b>${this.statusBadge(p)}${this.infoBtn(p)}</span>${sub}</span>
        <div class="energy ${this.energyClass(e)}" title="${e}%"><i style="width:${e}%"></i><span>${e}%${e < ENERGY.TIRED ? ' ×0.5' : ''}</span></div>
        <span class="r-tags">${p.tags.length || p.flags?.length ? p.tags.map(t => this.tagChip(t, p.id, !live)).join('') + this.flagChips(p) : '<span class="empty">—</span>'}</span>
      </div>`;
    };
    const roster = this.$('roster');
    const keepScroll = roster.scrollTop;
    roster.innerHTML =
      `<div class="r-grp">${L.t('team.xi', { f: s.formation })}</div>` + s.starters().map(p => row(p, true)).join('') +
      `<div class="r-grp">${L.t('team.bench')} · ${s.bench().length}</div>` + s.bench().sort(byPos).map(p => row(p, false)).join('');
    roster.scrollTop = keepScroll;
    this.$('roster-title').textContent = L.t('team.roster', { n: s.squad.length });

    // tactics toolbar + line strength
    const sel = this.$('formation');
    sel.value = s.formation; sel.disabled = live;
    this.$('btn-auto').disabled = live;
    this.$('btn-clear').disabled = !this.selected;
    const c = lineCounts(s.formation), base = lineCounts('4-4-2');
    this.$('tac-strength').innerHTML = `<span class="lbl">${L.t('tac.strength')}:</span>` + [0, 1, 2].map(z => {
      const d = presence(c, z) - presence(base, z);
      const cls = d > 0.01 ? 'ok' : d < -0.01 ? 'bad' : '';
      return `<span class="chip ${cls}">${L.t('tac.z' + z)} <b>${d >= 0 ? '+' : ''}${d.toFixed(2)}</b></span>`;
    }).join('');
    const oop = s.outOfPosition();
    this.$('tac-warn').innerHTML = oop.length
      ? oop.map(({ p, line }) => `<span class="w">&#9888; ${L.t('tac.oop', { n: esc(L.name(p.surname)), p: L.pos(p.position), l: L.line(line) })}</span>`).join('')
      : `<span class="okmsg">&#10003; ${L.t('tac.allGood')}</span>`;

    // board: the starting XI exactly as the match engine will read it (state.lineup, slot order)
    this.board.setup([{ entries: slots.map((sl, i) => ({ ...sl, p: s.player(s.lineup[i]) })) }], { board: true });
    this.board.highlight(this.selected, id => this.swapClass(s.player(id)));
    const boardEl = this.$('tac-board');
    boardEl.classList.toggle('locked', live);
    boardEl.classList.toggle('armed', !!this.selected);
    this.$('swap-hint').hidden = !this.selected;

    const who = this.selected ? L.name(s.player(this.selected).name) : '';
    const selPos = this.selected ? L.pos(s.player(this.selected).position) : '';
    this.$('team-status').textContent = live ? L.t('squad.locked') : this.selected ? L.t('team.help.sel', { n: who, p: selPos }) : L.t('team.help.idle');
    this.$('team-msg').textContent = this.teamMsg;
  }

  /** Smart swap highlighting: same natural position as the selected player = suggested, anything else = dimmed
      (still clickable — out-of-position swaps are allowed, just not recommended). */
  swapClass(p) {
    const selP = this.selected ? this.state.player(this.selected) : null;
    if (!selP || p.id === selP.id) return '';
    return p.position === selP.position ? 'suggested-swap' : 'dimmed-swap';
  }

  /** Unified swap: select one player (list row or pitch dot), then pick another (row or dot). */
  pick(id) {
    if (this.live) { this.alert(L.t('squad.locked'), L.t('team.err.title'), 'warn'); return; }
    const s = this.state;
    if (!this.selected) { this.selected = id; this.teamMsg = ''; }
    else if (this.selected === id) { this.selected = null; }
    else if (!s.isStarter(this.selected) && !s.isStarter(id)) { this.selected = id; }   // two bench players: just move the selection
    else { this.trySwap(this.selected, id); return; }
    this.renderTeam();
  }

  trySwap(a, b) {
    const s = this.state;
    const err = s.swapPlayers(a, b);
    this.selected = null;
    if (err) {
      this.alert(L.t('team.err.' + err), L.t('team.err.title'), 'error');
      this.renderTeam();
      return;
    }
    this.teamMsg = L.t('team.done', { a: L.name(s.player(a).surname), b: L.name(s.player(b).surname) });
    this.afterLineupChange();
  }

  onBoardClick(i) { this.pick(this.state.lineup[i]); }
  onDropSwap(targetId, srcId) {
    if (this.live || !srcId || !targetId || srcId === targetId || !this.state.player(srcId)) return;
    if (!this.state.isStarter(srcId) && !this.state.isStarter(targetId)) return;
    this.trySwap(srcId, targetId);
  }
  clearSelection() { this.selected = null; this.renderTeam(); }

  /** v1.5: small retro [i] button → Player Profile Card (left-click alternative to right-click). */
  infoBtn(p) {
    const t = esc(L.t('pi.open', { n: L.name(p.name) }));
    return `<button type="button" class="info-btn" data-info="${p.id}" tabindex="0" aria-label="${t}" title="${t}" draggable="false">i</button>`;
  }

  /** v1.9: story flags (e.g. PROMISED START) — visible, unlike the hidden numbers. */
  flagChips(p) { return (p.flags || []).map(f => `<span class="tag flag" title="${esc(FLAGS[f][L.code][1])}">${f === 'Showcase' ? '\u25C9' : '$'} ${esc(FLAGS[f][L.code][0])}</span>`).join(''); }
  tagChip(tag, id, removable) {
    const tone = TAGS[tag]?.tone || 'neutral';
    const x = removable ? `<button type="button" data-untag="${esc(tag)}" data-id="${id}" aria-label="${esc(L.t('squad.remove'))}" title="${esc(L.t('squad.remove'))}">&times;</button>` : '';
    return `<span class="tag ${tone}" title="${esc(L.tagDesc(tag))}">${esc(L.tag(tag))}${x}</span>`;
  }

  /* ---------- MATCH ---------- */
  renderShouts() {
    document.querySelectorAll('[data-shout]').forEach(b => {
      const on = b.dataset.shout === this.mentality;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', on);
    });
  }
  renderSpeedBtns() {
    document.querySelectorAll('[data-speed]').forEach(b => {
      const on = Number(b.dataset.speed) === this.speed;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', on);
    });
  }

  homeTeam() { return { name: this.state.clubName, players: this.state.starters(), formation: this.state.formation }; }

  prepareRadar() {
    const ctx = this.state.matchContext();
    const home = MatchEngine.buildSide(this.homeTeam(), true);
    const sides = ctx ? [home, MatchEngine.buildSide(ctx.team, false)] : [home];
    this.radar.setup(sides);   // pre-match: both teams warm up in formation
  }

  prepareMatch() {
    this.$('sb-score').textContent = '0 - 0';
    this.$('sb-min').textContent = "00'";
    this.$('sb-bar').style.width = '0%';
    this.$('sb-period').textContent = L.t('period.pre');
    this.$('carrier').textContent = '—'; this.$('poss').textContent = '—';
    this.logEntries = [];
    this.$('log').innerHTML = '';
    this.$('log-jump').hidden = true;
    const s = this.state, ctx = s.matchContext();
    if (ctx) {
      this.appendLog({ minute: 0, type: 'flavor', key: 'match.intro', vars: { a: { team: s.clubName }, b: { team: ctx.opp.name } }, side: -1, r: 0 });
      this.appendLog({ minute: 0, type: 'coach', key: 'match.hintShouts', vars: {}, side: -1, r: 0 });
      const tired = s.starters().filter(p => p.energy < ENERGY.TIRED);
      if (tired.length) this.appendLog({ minute: 0, type: 'turn', key: 'match.tiredWarn', vars: { n: { list: tired } }, side: 0, r: 0 });
      const promised = s.squad.filter(p => p.hasFlag('Promised_Start'));   // v1.9
      for (const p of promised) this.appendLog({ minute: 0, type: s.isStarter(p.id) ? 'coach' : 'turn', key: s.isStarter(p.id) ? 'ev.promise.ok' : 'ev.promise.warn', vars: { k: p }, side: 0, r: 0 });
      const oop = s.outOfPosition().map(o => o.p);
      if (oop.length) this.appendLog({ minute: 0, type: 'turn', key: 'match.oopWarn', vars: { n: { list: oop } }, side: 0, r: 0 });
    }
    this.prepareRadar();
    this.$('ht-banner').hidden = true;
    this.liveSel = null;
    this.renderMatchChrome();
    this.renderTeamStats(MatchEngine.blankStats());
    this.renderLiveRoster();
    this.renderAssistant(null);
  }

  renderMatchChrome() {
    const s = this.state, e = this.engine, ctx = s.matchContext();
    const btn = this.$('btn-start'), sp = this.$('speed'), st = this.$('match-status');
    this.$('sb-home').textContent = L.team(s.clubName).replace(' U-14', '');
    if (ctx) {
      const v = L.t('venue.' + ctx.venue);
      this.$('match-title').textContent = L.t('match.title', { n: ctx.md, v });
      this.$('match-fixture').textContent = L.t('match.venue', { c: L.team(s.clubName), v });
      this.$('sb-away').textContent = L.team(ctx.opp.name);
      this.$('forms').textContent = `${e ? e.sides[0].formation : s.formation} vs ${ctx.opp.formation}`;
    }
    let slow = false;
    if (!e) {
      const can = s.phase === 'matchday';
      btn.disabled = !can;
      btn.innerHTML = can ? L.t('match.start') : L.t('match.noMatch');
      sp.textContent = can ? L.t('match.ready') : '';
      st.textContent = can ? L.t('match.statusReady') : L.t('dlg.noMatch').replace(/<br>.*/, '');
    } else if (e.paused) {
      btn.disabled = false; btn.innerHTML = L.t('match.resume');
      sp.textContent = L.t('match.paused');
      st.textContent = L.t('ht.tip');
    } else if (!e.finished) {
      slow = e.highlight;
      btn.disabled = true; btn.innerHTML = L.t('match.inProgress');
      sp.textContent = slow ? L.t('match.slow') : L.t('match.run', { x: e.speed });
      st.textContent = L.t('match.statusLive');
    } else {
      btn.disabled = false; btn.innerHTML = L.t('match.toNotes');
      sp.textContent = L.t('match.ft');
      st.textContent = s.lastReport ? L.t('match.end' + s.lastReport.result) : '';
    }
    sp.classList.toggle('slow', slow);
    const ib = this.$('btn-instant');   // v2.0
    ib.disabled = e ? e.finished : s.phase !== 'matchday';
    ib.innerHTML = L.t(e && !e.finished ? 'match.instantRest' : 'match.instant');
  }

  onStartButton() {
    if (this.engine && this.engine.finished) { this.show('notes'); return; }
    if (this.engine && this.engine.paused) { this.resumeMatch(); return; }
    if (this.engine) return;
    if (!this.createEngine()) return;
    this.engine.start();
    this.renderAll();
  }

  /** v2.0: [ INSTANT SIM MATCH ] — the same MatchEngine and the same tick() maths, driven by a synchronous loop
      instead of the timer. Works from the pre-match screen, at half-time or mid-match (sims the rest). */
  onInstantSim() {
    if (this.engine?.finished) return;
    if (!this.engine && !this.createEngine()) return;
    this.$('ht-banner').hidden = true;
    const t0 = performance.now();
    this.engine.runInstant();   // → onMatchEnd() → Notebook
    this.lastSimMs = performance.now() - t0;
  }

  /** Builds the engine for the current matchday (shared by the visual and the instant start). */
  createEngine() {
    if (this.state.phase !== 'matchday') { this.alert(L.t('dlg.noMatch'), L.t('nav.match'), 'warn'); return null; }
    if (this.events.active) { this.events.open(); return null; }   // v2.2: answer the match-day dilemma first
    this.state.ensureShowcaseXI();                                  // v2.3: the scout's three start
    const fixes = this.state.ensureAvailableXI();                   // v2.2: nobody injured / suspended kicks off
    if (fixes.length) { this.renderTeam(); this.prepareMatch(); }
    if (this.state.starters().some(p => !p.available)) { this.alert(L.t('xi.noFit'), L.t('team.err.title'), 'error'); return null; }
    const ctx = this.state.matchContext();
    this.state.notebookUnlocked = false;
    this.syncLocks();
    this.engine = new MatchEngine(this.homeTeam(), ctx.team, {
      onLog: e => this.appendLog(e),
      onUpdate: eng => this.renderLive(eng),
      onSpeed: d => {
        this.radar.setTempo(d);
        this.renderMatchChrome();
      },
      onGoal: () => { const el = this.$('sb-score'); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); },
      onEnd: eng => this.onMatchEnd(eng),
      onHalfTime: eng => this.onHalfTime(eng),
      onSub: (out, inP) => this.onSub(out, inP),
    }, { mentality: this.mentality, speed: this.speed, forceWin: !!this.state.cheats?.forceWin });
    if (this.engine.forceWin) this.engine.log('coach', 'dbg.forceLog', {}, 0);
    this.checkPromises();   // v1.9
    this.liveSel = null;
    this.radar.setup(this.engine.sides);
    return this.engine;
  }

  logLine(e) {
    const sideCls = e.side === 0 ? 'us' : e.side === 1 ? 'them' : '';
    const line = document.createElement('span');
    line.className = 'ln';
    line.innerHTML = `<span class="m">${pad2(e.minute)}'</span><span class="${sideCls} ${e.type}">${esc(this.entryText(e))}</span>`;
    return line;
  }
  logAtBottom() { const log = this.$('log'); return log.scrollHeight - log.scrollTop - log.clientHeight < 24; }
  /** Auto-scrolls to every new event; if the coach scrolled up to re-read, a "new events" pill appears instead. */
  appendLog(e) {
    const log = this.$('log');
    const stick = this.logAtBottom();
    this.logEntries.push(e);
    log.appendChild(this.logLine(e));
    while (log.children.length > 400) { log.removeChild(log.firstChild); this.logEntries.shift(); }
    if (stick) log.scrollTop = log.scrollHeight;
    else this.$('log-jump').hidden = false;
  }
  rerenderLog() {
    const log = this.$('log');
    const frag = document.createDocumentFragment();
    this.logEntries.forEach(e => frag.appendChild(this.logLine(e)));
    log.innerHTML = '';
    log.appendChild(frag);
    log.scrollTop = log.scrollHeight;
  }

  renderLive(eng) {
    const [a, b] = eng.sides;
    this.$('sb-score').textContent = `${a.score} - ${b.score}`;
    this.$('sb-min').textContent = `${pad2(eng.minute)}'`;
    this.$('sb-bar').style.width = `${(eng.minute / 90) * 100}%`;
    this.$('sb-period').textContent = L.t(eng.finished ? 'period.ft' : eng.minute <= 45 ? 'period.h1' : 'period.h2');
    this.$('carrier').textContent = eng.finished ? '—' : `#${eng.carrier.number} ${L.name(eng.carrier.name)} (${L.team(eng.sides[eng.poss].name)})`;
    const total = eng.possTicks[0] + eng.possTicks[1] || 1;
    this.$('poss').textContent = `${Math.round(eng.possTicks[0] / total * 100)}% - ${Math.round(eng.possTicks[1] / total * 100)}%`;
    this.renderTeamStats(eng.teamTotals(0));
    this.radar.onEngineUpdate(eng);
    this.updateLiveRoster();
    this.renderAssistant(eng);
    this.profile.tick();
  }

  renderTeamStats(t) {
    this.$('team-stats').innerHTML = `
      <dt>${L.t('st.passOk')}</dt><dd class="ok">${t.passOk}</dd>
      <dt>${L.t('st.passFail')}</dt><dd class="bad">${t.passFail}</dd>
      <dt>${L.t('st.tackles')}</dt><dd>${t.tackles}</dd>
      <dt>${L.t('st.dribbles')}</dt><dd>${t.dribbleOk}/${t.dribbleFail}</dd>
      <dt>${L.t('st.shots')}</dt><dd>${t.shots} (${t.onTarget})</dd>
      <dt>${L.t('st.goals')}</dt><dd class="ok">${t.goals}</dd>
      <dt>${L.t('st.saves')}</dt><dd>${t.saves}</dd>
      <dt>${L.t('st.intercepts')}</dt><dd>${t.intercepts}</dd>
      <dt>${L.t('st.cards')}</dt><dd class="${t.red ? 'bad' : ''}">${t.yellow}/${t.red}</dd>`;
  }

  /** Our match is over: record it, resolve the 4 AI fixtures instantly, update table, open the notebook. */
  onMatchEnd(eng) {
    const s = this.state, ctx = s.matchContext();
    const [a, b] = eng.sides;
    const result = a.score > b.score ? 'W' : a.score === b.score ? 'D' : 'L';
    s.league.setUserResult(ctx.fixture, a.score, b.score);
    const others = s.league.simulateOthers(ctx.md);
    this.appendLog({ minute: 90, type: 'flavor', key: 'match.others', vars: { r: { fixtures: others } }, side: -1, r: 0 });
    const played = a.all;   // starters + substitutes
    s.lastReport = {
      md: ctx.md, opponent: ctx.opp.name, venue: ctx.venue, gf: a.score, ga: b.score, result,
      // v2.1: Match Summary data (identical for visual and instant matches: both come from the same tick())
      events: eng.matchEvents.map(e => ({ ...e })), ht: eng.htScore || null, instant: !!eng.instant,
      totals: [eng.teamTotals(0), eng.teamTotals(1)].map(t => ({ shots: t.shots, onTarget: t.onTarget, passOk: t.passOk, passFail: t.passFail, yellow: t.yellow, red: t.red })),
      poss: Math.round(eng.possTicks[0] / ((eng.possTicks[0] + eng.possTicks[1]) || 1) * 100),
      players: shuffle(played).slice(0, 3).map(p => ({
        id: p.id, stats: { ...eng.st(p) },
        tired: eng.tired.has(p.id), oop: NATURAL_LINE[p.position] !== eng.lineOf.get(p.id), role: (p.tags || [])[0] || null,
      })),
    };
    s.recordSeasonStats(played.map(p => [p.id, eng.st(p)]));
    s.league.recordKids(b.all.map(p => [p.id, eng.st(p)]));   // v1.7: opponent kids feed the league leaders
    s.recordCoachNotes(s.lastReport);
    s.applyLiveFatigue(eng);
    s.applyMatchDynamics(eng, result);
    this.applyAvailabilityAfterMatch(eng, ctx);   // v2.2
    if (s.cheats?.forceWin) s.cheats.forceWin = false;   // v1.8: one-shot debug cheat
    this.debug?.render();
    s.phase = 'post';
    s.notebookUnlocked = true;
    s.save();
    this.tableMd = ctx.md;
    this.renderAll();
    this.$('tk-notes').classList.add('alert');
    if (eng.instant) {   // v2.0 Quick Sim
      this.renderLive(eng);
      this.appendLog({ minute: 90, type: 'coach', key: 'match.instantDone', vars: {}, side: -1, r: 0 });
      this.summary.open(s.lastReport);
      return;
    }
    // v2.1: full time → MATCH SUMMARY scoreboard first (a short beat so the final whistle lands on the pitch)
    setTimeout(() => { if (s.phase === 'post' && s.lastReport) this.summary.open(s.lastReport); }, 700);
  }

  /* ---------- NOTEBOOK ---------- */
  renderNotebook() {
    const body = this.$('notes-body');
    const rep = this.state.lastReport;
    if (!this.state.notebookUnlocked || !rep) {
      body.innerHTML = `<div class="locked-msg">${L.t('notes.lockedMsg')}</div>`;
      this.$('notes-status').textContent = L.t('notes.locked');
      return;
    }
    const cards = rep.players.map(pr => {
      const { id, stats: s } = pr;
      const p = this.state.player(id);
      if (!p) return '';
      const season = this.state.seasonOf(id);
      const rateLine = (label, ok, fail, sOk, sFail) => {
        const tot = ok + fail, sTot = sOk + sFail;
        const r = tot ? Math.round(ok / tot * 100) : null, sr = sTot ? Math.round(sOk / sTot * 100) : null;
        return `<b>${label}:</b> <span style="${rateStyle(r)}">${tot ? `${ok}/${tot}` : '—'}${r != null ? ` (${r}%)` : ''}</span>`
          + ` <span class="avg">(${L.t('nb.season')}: <span style="${rateStyle(sr)}">${sr != null ? sr + '%' : '—'}</span>)</span>`;
      };
      const lines = [
        rateLine(L.t('nb.passes'), s.passOk, s.passFail, season.passOk, season.passFail),
        rateLine(L.t('nb.tackles'), s.tackles, s.tacklesLost, season.tackles, season.tacklesLost),
        rateLine(L.t('nb.dribbles'), s.dribbleOk, s.dribbleFail, season.dribbleOk, season.dribbleFail),
        L.t('nb.intercepts', { a: s.intercepts || 0, b: season.intercepts || 0 }),
        L.t('nb.shots', { a: s.shots, b: s.onTarget, c: s.goals, g: season.goals }),
      ];
      if (p.position === 'GK') lines.push(L.t('nb.saves', { a: s.saves, b: season.saves }));
      if (s.yellow || s.red) lines.push(L.t('notes.cards', { a: s.yellow, b: s.red }));
      lines.push(`${L.t('notes.energy', { a: Math.round(p.energy) })} · ${L.t('nb.apps', { n: season.apps })}`);
      const note = coachNote(p, s, pr).map(k => k === 'note.role' ? L.t(k, { r: L.tag(pr.role) }) : L.t(k)).join(' ');
      const btns = TAG_KEYS.map(t => {
        const has = p.tags.includes(t);
        const key = has ? 'notes.noted' : p.tags.length ? 'notes.change' : 'notes.add';
        return `<button class="btn ${has ? 'done' : ''}" data-tag="${t}" data-id="${p.id}" ${has ? 'disabled' : ''} title="${esc(L.tagDesc(t))}">
          ${L.t(key, { t: esc(L.tag(t)) })}<small>${esc(L.tagDesc(t))}</small></button>`;
      }).join('');
      return `<article class="card" data-pid="${p.id}">
        <div class="nb-face"><span class="portrait lg">${p.portraitSvg}</span></div>
        <h3><span class="num dark">${p.number}</span>${esc(L.name(p.name))}<span class="pos ${p.position}">${L.pos(p.position)}</span></h3>
        <ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>
        <p class="coach-note"><b>${L.t('nb.coachNote')}:</b> ${esc(note)}</p>
        <div class="cur tags">${p.tags.map(t => this.tagChip(t, p.id, false)).join('') || `<span style="color:#6f6754">${L.t('notes.noTags')}</span>`}</div>
        <div class="tag-btns">${btns}</div>
      </article>`;
    }).join('');
    const back = this.state.phase === 'post' ? `<div class="row-btns"><button class="btn go big" id="btn-back">${L.t('notes.back')}</button></div>` : '';
    body.innerHTML = `
      <div class="nb-head">
        <h2>${L.t('notes.head', { n: rep.md, o: esc(L.team(rep.opponent)) })}</h2>
        <span class="res ${rep.result}">${L.t('res.' + rep.result)} &nbsp;${rep.gf} - ${rep.ga}</span>
      </div>
      <p class="nb-hint">${L.t('notes.hint')}</p>
      <p class="nb-legend"><span style="${rateStyle(80)}">■ &gt; 75%</span> · <span style="${rateStyle(30)}">■ &lt; 40%</span> · ${L.t('nb.legend')}</p>
      <div class="cards">${cards}</div>${back}`;
    this.$('notes-status').textContent = L.t('notes.status', { n: rep.md });
  }
}

