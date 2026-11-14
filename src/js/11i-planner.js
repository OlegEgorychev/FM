/* =========================================================
   v3.13 — PLANNER.EXE: the weekly plan (Monday, after the morning briefing)
   Mon–Fri: Rest or a training regime (REGIMES); Sat = match, Sun = rest (fixed, greyed).
   0–5 trainings, 0 AP. [ CONFIRM WEEK ] lifts the `week` blocker. Afterwards future days can be re-planned,
   today's regime can still change (not Rest ↔ Training), past days are locked.
   Warnings are words only (fog of war): the 3rd training = heavy week, the 4th–5th = overload.
   ========================================================= */
class WeekPlanner {
  constructor(ui) {
    this.ui = ui;
    this.layer = document.getElementById('planner-view');
    this.grid = document.getElementById('pl-grid');
    document.getElementById('pl-x').addEventListener('click', () => this.close());
    document.getElementById('pl-confirm').addEventListener('click', () => this.confirm());
    this.grid.addEventListener('click', e => {
      const b = e.target.closest('[data-day]');
      if (!b || b.disabled) return;
      if (this.state.setWeekPlan(b.dataset.day, b.dataset.reg === 'rest' ? null : b.dataset.reg)) { this.render(); this.ui.renderDash(); }
    });
  }
  get isOpen() { return !this.layer.hidden; }
  get state() { return this.ui.state; }

  open() {
    const s = this.state;
    if (this.ui.modalLock || s.phase !== 'calendar') return;
    if (this.ui.events.active) { this.ui.events.open(); return; }
    if (this.ui.isStopDay() && !s.dayState().briefed) { this.ui.briefing.open(); return; }   // the briefing comes first
    this.ui.modal.close();
    this.render();
    this.layer.hidden = false;
    document.getElementById('pl-confirm').focus();
  }
  close() { this.layer.hidden = true; this.ui.renderAll(); }

  /** Qualitative warning for the n-th training of the week (1-based), or ''. */
  static warnKey(n) { return n >= WEEK.WARN_OVER ? 'pl.warn.over' : n >= WEEK.WARN_HEAVY ? 'pl.warn.heavy' : ''; }

  render() {
    const s = this.state, w = s.weekState(), today = s.calendar.date;
    let nth = 0;
    this.grid.innerHTML = WEEK.KEYS.map((k, i) => {
      const date = isoAdd(w.start, i), past = date < today, isToday = date === today;
      const head = `<div class="pl-day"><b>${esc(fmtDate(date, { weekday: 'short' }))}</b><span>${esc(fmtDate(date, { day: 'numeric', month: 'short' }))}</span>${isToday ? `<em>${L.t('pl.today')}</em>` : ''}</div>`;
      const cls = `pl-col${past ? ' past' : ''}${isToday ? ' now' : ''}`;
      if (s.matchOn(date) || !WEEK.PLAN_KEYS.includes(k)) {   // fixed days: the match / Sunday rest
        const ev = s.calendar.events.find(e => e.type === 'match' && e.date === date), ctx = s.matchContext();
        const label = ev ? L.t('pl.match') + (ctx && ctx.ev.id === ev.id ? `<small>${esc(L.team(ctx.opp.name))}</small>` : '') : L.t('pl.rest');
        return `<div class="${cls} fixed${ev ? ' m' : ''}">${head}<div class="pl-fixed">${label}</div></div>`;
      }
      const cur = w.plan[k], editable = s.dayEditable(date), todayRegime = isToday && w.confirmed && cur;
      if (cur) nth++;
      const warn = cur ? WeekPlanner.warnKey(nth) : '';
      const opt = (reg, txt) => {
        const on = (cur || 'rest') === reg, ok = editable || (todayRegime && reg !== 'rest');
        return `<button type="button" class="pl-opt${on ? ' on' : ''}${reg === 'rest' ? ' rest' : ''}" data-day="${k}" data-reg="${reg}" aria-pressed="${on}"${ok ? '' : ' disabled'}>${txt}</button>`;
      };
      return `<div class="${cls}${cur ? ' t' : ''}">${head}<div class="pl-opts">${opt('rest', L.t('pl.rest'))}`
        + REGIME_KEYS.map(r => opt(r, L.t('plan.' + r))).join('') + `</div>`
        + `<div class="pl-warn${warn === 'pl.warn.over' ? ' over' : ''}">${warn ? esc(L.t(warn)) : ''}</div></div>`;
    }).join('');
    const n = s.trainingsPlanned(), src = w.apSources || {};
    document.getElementById('pl-title').textContent = 'PLANNER.EXE — ' + L.t('pl.week', { d: fmtDate(w.start, { day: 'numeric', month: 'short' }) });
    document.getElementById('pl-head').innerHTML = `<span class="pl-ap" title="${esc(L.t('ap.tip'))}">${L.t('pl.ap', { n: w.ap, line: esc(MorningBriefing.apLine(src)) })}</span>
      <span class="pl-note">${L.t('pl.note', { m: WEEK.MAX_TRAININGS })}</span>`;
    const warn = WeekPlanner.warnKey(n);
    document.getElementById('pl-sum').innerHTML = `${L.t('pl.count', { n })}${warn ? ` <b class="${warn === 'pl.warn.over' ? 'over' : ''}">${esc(L.t(warn))}</b>` : n ? '' : ` <b>${esc(L.t('pl.warn.empty'))}</b>`}`;
    document.getElementById('pl-confirm').innerHTML = L.t('pl.confirm');
    document.getElementById('pl-status').textContent = L.t(w.confirmed ? 'pl.status.replan' : 'pl.status.new');
  }

  /** [ CONFIRM WEEK ] → today's locker room on a training day, else the Dashboard. */
  confirm() {
    const s = this.state;
    if (this.ui.events.active) return;
    s.confirmWeek();
    this.layer.hidden = true;
    this.ui.renderAll();
    if (s.isOurTraining(s.calendar.date) && !s.dayState().locker?.done) this.ui.locker.open();
  }
}
