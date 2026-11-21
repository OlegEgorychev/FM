/* =========================================================
   v2.8 — MORNING BRIEFING ("MORNING.EXE", This Is the Police style)
   START DAY → here (date, weather, local news, the three factions) → [ HEAD TO THE CLUB ]
   → Locker Room on training / match days, or back to the quiet Dashboard on rest days.
   Weather and news are seeded by the date, so a reload shows the same morning.
   ========================================================= */
class MorningBriefing {
  static NEWS = ['scouts', 'vandal', 'leader', 'garage', 'pothole', 'mayor', 'rival', 'kitWash', 'derby', 'busStrike', 'chippy', 'floodlight', 'rain'];
  constructor(ui) {
    this.ui = ui;
    this.layer = document.getElementById('morning-briefing-view');
    document.getElementById('mb-go').addEventListener('click', () => this.go());
  }
  get isOpen() { return !this.layer.hidden; }
  get state() { return this.ui.state; }

  /** Seeded weather for a date (autumn in a rainy town). */
  static weather(date) {
    const r = seeded('wx' + date)(), tot = WEATHER_W.reduce((a, b) => a + b, 0);
    let x = r * tot;
    for (let i = 0; i < WEATHER.length; i++) { if ((x -= WEATHER_W[i]) < 0) return WEATHER[i]; }
    return WEATHER[0];
  }
  /** 1–2 seeded flavour headlines, filled with names from the league. */
  news(date) {
    const s = this.state, r = seeded('news' + date), lg = s.league;
    const pool = MorningBriefing.NEWS.filter(id => id !== 'leader' || lg.playedMatchdays() > 0)   // no "league leaders" before a ball is kicked
      .filter(id => s.headlineFresh(id, date));   // v3.24: a headline the coach read < NEWS.CD_DAYS days ago is not picked (empty → none)
    const ids = [...pool].sort(() => r() - 0.5).slice(0, r() < 0.55 ? 1 : 2);
    this.newsIds = ids;   // remembered by go() only if the window was actually shown
    const leader = lg.table()[0]?.team, ctx = s.matchContext(), kid = s.squad[Math.floor(r() * s.squad.length)];
    const rival = lg.teams.filter(t => !t.user)[Math.floor(r() * (lg.teams.length - 1))];
    return ids.map(id => L.t('news.' + id, { t: L.team(leader?.name || ''), k: L.name(kid.name), o: L.team(ctx?.opp.name || rival.name), r: L.team(rival.name) }));
  }

  open() {
    const s = this.state;
    if (this.ui.modalLock) return;   // v3.5
    if (this.ui.events.active) { this.ui.events.open(); return; }
    if (s.phase === 'calendar' && !s.weekState().confirmed) { this.ui.planner.open(); return; }   // v3.17: Monday = one window (PLANNER.EXE)
    if (s.kassaDue() && this.ui.isStopDay()) { this.ui.kassa.open(); return; }   // v3.15: the cash desk first (v3.24: never on a match day — kassaDue())
    if (!this.hasNews()) { this.go(); return; }   // v3.17: nothing new → no window, the day simply goes on
    this.report = null;
    this.ui.modal.close(); this.ui.profile.close();
    this.render();
    this.layer.hidden = false;
    this.layer.classList.remove('in'); void this.layer.offsetWidth; this.layer.classList.add('in');
    document.getElementById('mb-go').focus();
  }
  close() {
    this.layer.hidden = true;
    if (this.layer.classList.contains('mb-report')) {   // v3.17: back from the training report's titles
      this.layer.classList.remove('mb-report');
      this.layer.querySelector('.mb-kicker').textContent = L.t('mb.kicker');
      this.layer.querySelector('#mb-away-box .mb-h').textContent = L.t('mb.away');
    }
  }

  /* ---------- v3.17 "SILENCE": only what is new, important first ---------- */
  /** "While you were away" lines still worth showing (muted repeats dropped), split into important / routine. */
  static awayLines(s, date = s.calendar.date) {
    const fresh = (s.away || []).filter(e => s.newsFresh(e, date));
    return { imp: fresh.filter(e => newsMatch(e.key, NEWS.IMPORTANT)), rout: fresh.filter(e => !newsMatch(e.key, NEWS.IMPORTANT)) };
  }
  /** Important lines (by day), then a collapsed Win98 tree "[+] Routine (N)". */
  static awayHTML(ui, a, max = 12) {
    const li = e => `<li><span class="d">${esc(fmtDate(e.date, { weekday: 'short' }))}</span> ${esc(ui.entryText({ ...e, r: 0 }))}</li>`;
    let h = a.imp.slice(-max).map(li).join('') + (a.imp.length > max ? `<li class="more">${esc(L.t('mb.awayMore', { n: a.imp.length - max }))}</li>` : '');
    if (a.rout.length) h += `<li class="mb-routine"><details><summary>${esc(L.t('mb.routine', { n: a.rout.length }))}</summary><ul>${a.rout.map(li).join('')}</ul></details></li>`;
    return h;
  }
  /** The fee day's agenda line (1st training of the month after KASSA). */
  feeDay(date = this.state.calendar.date) {
    const s = this.state, f = s.fees;
    return s.phase === 'calendar' && !!f && !f.started && f.month === s.monthOf(date) && s.isOurTraining(date);
  }
  /** Is there anything new worth a window? A match day always is (the opponent report); routine lines alone never are
      (they ride along, collapsed, when the window opens anyway). */
  hasNews() {
    const s = this.state, date = s.calendar.date;
    return s.phase === 'matchday' || MorningBriefing.awayLines(s, date).imp.length > 0 || MorningBriefing.worldNews(s, date).length > 0 || this.feeDay(date);
  }

  render() {
    if (this.report) return;   // v3.17: the training report is drawn once by openReport()
    const s = this.state, date = s.calendar.date, wx = MorningBriefing.weather(date), info = this.ui.dayInfo(date);
    const w = s.weekState(), plan = s.phase === 'calendar' && !w.confirmed;   // v3.13: Monday — PLANNER.EXE comes next
    const kind = s.phase === 'matchday' ? 'match' : plan ? 'plan' : info.kind;
    this.layer.dataset.wx = wx;
    document.getElementById('mb-date').textContent = fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('mb-weather').innerHTML = `<span class="wx-ico wx-${wx}"></span>${L.t('wx.' + wx)}`;
    const ctx = s.matchContext();
    let agenda = L.t('mb.agenda.' + kind, { o: L.team(ctx?.opp.name || '') });
    if (kind === 'match' && ctx) {   // v3.4: the opponent lives by the same energy rules — a word from the grapevine
      const c = s.league.oppCondition(ctx.opp, new Set(s.squad.map(p => p.surname)));
      agenda += ' ' + L.t('mb.oppForm', { a: c.avg, t: c.tired });
    }
    if (this.feeDay(date)) agenda += ' ' + L.t('mb.feeDay', { m: '$' + s.fees.amount });   // v3.15: the fee day (1st training of the month)
    document.getElementById('mb-agenda').textContent = agenda;
    // v3.13: Monday — how this week's action points were made up
    const src = w.apSources || {}, apBox = document.getElementById('mb-ap');
    apBox.hidden = !(s.phase === 'calendar' && date === w.start);
    apBox.innerHTML = apBox.hidden ? '' : L.t('mb.ap', { line: MorningBriefing.apLine(src) }) + ` <span class="mb-coh">· ${MorningBriefing.cohLine(s)}</span>`;   // v3.21
    // v3.13 → v3.17: "while you were away" — new lines only (14-day mute), important first, routine collapsed
    const a = MorningBriefing.awayLines(s, date), box = document.getElementById('mb-away-box');
    this.shown = [...a.imp, ...a.rout];
    box.hidden = !this.shown.length;
    document.getElementById('mb-away').innerHTML = MorningBriefing.awayHTML(this.ui, a);
    document.getElementById('mb-news').innerHTML = (date === w.start ? MorningBriefing.cohNews(s, date) : []).map(n => `<li class="mb-cohlow">${esc(n)}</li>`).join('')   // v3.21
      + MorningBriefing.worldNews(s, date).map(n => `<li class="mb-world">${esc(n)}</li>`).join('')   // v3.14
      + this.news(date).map(n => `<li>${esc(n)}</li>`).join('');
    const bar = (k) => { const v = s.rep[k];
      return `<div class="rep-row"><span class="rep-name">${L.t('rep.' + k)}</span><div class="rep-bar ${v >= 65 ? 'hi' : v <= 35 ? 'lo' : ''}"><i style="width:${v}%"></i></div><b>${v}</b><small>${L.t('rep.' + k + '.d')}</small></div>`; };
    document.getElementById('mb-rep').innerHTML = ['board', 'parents', 'squad'].map(bar).join('');
    document.getElementById('mb-go').innerHTML = L.t(kind === 'plan' ? 'mb.goPlan' : kind === 'rest' || kind === 'off' ? 'mb.goQuiet' : 'mb.go');
  }

  /* ---------- v3.17: TRAINING REPORT — the same window right after a training day (not the next morning) ---------- */
  /** Opens the report for a processed training day; onDone runs after [ OK ]. Returns false when there is nothing to show. */
  openReport(date, onDone) {
    const s = this.state, d = s.today?.date === date ? s.today : null, lk = d?.locker;
    if (!lk || this.ui.modalLock || this.ui.autoRunning) return false;
    const entries = s.diary.filter(e => e.date === date && !['lr.diary', 'lr.diaryAll', 'cal.training', 'cal.trainingAll'].includes(e.key));
    const absent = Object.entries(lk.absent), t = s.squad.length, here = t - absent.length;
    const lines = [L.t(absent.length ? 'trr.came' : 'trr.cameAll', { a: here, t })];
    for (const [id, why] of absent) { const p = s.player(id); if (p) lines.push(L.t('trr.absent', { k: L.name(p.name), w: L.t('lr.short.' + why) })); }
    const paid = (d.feesPaid || []).filter(id => s.player(id)), got = paid.reduce((m, id) => m + (s.fees?.got?.[id] || 0), 0);
    if (paid.length) lines.push(L.t('trr.fees', { n: paid.length, m: '$' + got }));
    this.report = { date, onDone, entries };
    this.ui.modal.close(); this.ui.profile.close();
    this.layer.classList.add('mb-report');
    this.layer.querySelector('.mb-kicker').textContent = L.t('trr.kicker');
    this.layer.querySelector('#mb-away-box .mb-h').textContent = L.t('trr.h');
    document.getElementById('mb-date').textContent = L.t('trr.title', { d: fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' }) });
    document.getElementById('mb-weather').innerHTML = '';
    document.getElementById('mb-agenda').textContent = L.t('trr.plan', { p: L.t('plan.' + (s.planOf(date) || WEEK.DEFAULT_REGIME)) });
    document.getElementById('mb-ap').hidden = true;
    const imp = entries.filter(e => newsMatch(e.key, NEWS.IMPORTANT)), rout = entries.filter(e => !newsMatch(e.key, NEWS.IMPORTANT));
    document.getElementById('mb-away-box').hidden = false;
    document.getElementById('mb-away').innerHTML = lines.map(x => `<li class="trr">${esc(x)}</li>`).join('')
      + MorningBriefing.awayHTML(this.ui, { imp, rout }, 40).replace(/<span class="d">[^<]*<\/span> /g, '');
    document.getElementById('mb-go').innerHTML = L.t('trr.ok');
    this.layer.hidden = false;
    this.layer.classList.remove('in'); void this.layer.offsetWidth; this.layer.classList.add('in');
    document.getElementById('mb-go').focus();
    return true;
  }
  endReport() {
    const s = this.state, r = this.report;
    this.report = null;
    s.markNews(r.entries);   // not again tomorrow morning
    if (s.away) s.away = s.away.filter(e => e.date !== r.date);
    s.save();
    this.close();
    r.onDone?.();
  }

  /** v3.14: Monday news about this week's school / city event — the day(s) and a vague hint, never names. */
  static worldNews(s, date) {
    const e = s.worldEvent;
    if (!e || s.phase !== 'calendar' || date !== e.weekStart) return [];
    return [L.t('world.news.' + e.id, { d: L.t('world.on.' + weekKey(e.days[0])) })];
  }
  /** v3.21: Monday — the band word and, when cohesion is low, one of COH.LOW phrasings (the week's number picks it,
      so two weeks in a row never repeat). Words only. */
  static cohLine(s) { return L.t('coh.line', { b: L.t('coh.band.' + cohBand(s.cohesion)) }); }
  static cohNews(s, date) {
    if (s.phase !== 'calendar') return [];
    const n = Math.floor(isoDays('2000-01-03', weekStartOf(date)) / 7), out = [];
    if ((s.cohesion ?? COH.START) < COH.LOW) out.push(L.t('coh.low.' + (((n % 3) + 3) % 3)));
    const ln = s.bonds ? s.lonerLine(weekStartOf(date)) : null;   // v3.25: "[A] seems to be on his own at training" (+ an exact note)
    if (ln && s.player(ln.pid)) out.push(L.t('bond.loner.' + ln.v, { k: L.name(s.player(ln.pid).name) }));
    return out;
  }
  /** v3.13: "Base 4 · Carried 1 · Win +1 = 6 AP" */
  static apLine(src) {
    return [L.t('mb.ap.base', { n: src.base ?? 0 }), src.carry ? L.t('mb.ap.carry', { n: src.carry }) : '', src.win ? L.t('mb.ap.win', { n: src.win }) : '']
      .filter(Boolean).join(' · ') + ' = ' + L.t('mb.ap.total', { n: src.total ?? 0 });
  }
  /** [ HEAD TO THE CLUB ] */
  go() {
    const s = this.state;
    if (this.report) { this.endReport(); return; }   // v3.17: the training report's [ OK ]
    s.dayState().briefed = true;
    if (!this.layer.hidden && this.shown) s.markNews(this.shown);   // v3.17: what he read is muted for NEWS.COOLDOWN days
    if (!this.layer.hidden && this.newsIds) s.markHeadlines(this.newsIds);   // v3.24: the headlines he read are not repeated for NEWS.CD_DAYS
    this.newsIds = null;
    this.shown = null;
    s.away = null;   // v3.13: the coach has read what happened while he was away
    s.save();
    this.close();
    if (s.phase === 'calendar' && !s.weekState().confirmed) { this.ui.renderAll(); this.ui.planner.open(); return; }   // v3.13: Monday → PLANNER.EXE
    if (s.phase === 'matchday' && s.dayState().mdWait) { this.ui.renderAll(); this.ui.matchdayMorning(); return; }   // v3.24: → match-day event / "Match day" dialog
    const kind = s.phase === 'matchday' ? 'match' : this.ui.dayInfo(s.calendar.date).kind;
    if (kind === 'training' || kind === 'match') this.ui.locker.open();
    else this.ui.renderAll();
  }
}
