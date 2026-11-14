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
    document.getElementById('pl-ks-levels').addEventListener('change', e => {   // v3.17: the month's fee inside the planner
      const r = e.target.closest('input[name="pl-level"]');
      if (r && FINANCE.FEES[r.value]) { this.feeLevel = r.value; this.render(); }
    });
    this.grid.addEventListener('click', e => {
      const b = e.target.closest('[data-day]');
      if (!b || b.disabled) return;
      if (this.state.setWeekPlan(b.dataset.day, b.dataset.reg === 'rest' ? null : b.dataset.reg)) { this.render(); this.ui.renderAll(); }
    });
    this.grid.addEventListener('change', e => {   // v3.16: the evening lesson — kid / focus
      const kid = e.target.closest('[data-lkid]'), foc = e.target.closest('[data-lfocus]'), s = this.state;
      if (!kid && !foc) return;
      const k = (kid || foc).dataset.lkid || (kid || foc).dataset.lfocus, l = s.weekState().lessons[k];
      const why = kid ? s.setLesson(k, kid.value || null, l?.focus || 'technical') : s.setLesson(k, l?.id || null, foc.value);
      this.msg = why ? L.t('pl.lessonNo.' + why) : '';
      this.render(); this.ui.renderAll();
    });
  }
  get isOpen() { return !this.layer.hidden; }
  get state() { return this.ui.state; }

  open() {
    const s = this.state;
    if (this.ui.modalLock || s.phase !== 'calendar') return;
    if (this.ui.events.active) { this.ui.events.open(); return; }
    // v3.17: an unconfirmed week = Monday's one window (briefing + cash desk + plan). Re-planning later keeps the old order.
    if (s.weekState().confirmed && this.ui.isStopDay() && (s.kassaDue() || !s.dayState().briefed)) { this.ui.briefing.open(); return; }
    if (this.layer.hidden) this.feeLevel = FINANCE.DEFAULT_LEVEL;
    this.ui.modal.close(); this.ui.briefing.close(); this.ui.kassa.layer.hidden = true;
    this.render();
    this.layer.hidden = false;
    document.getElementById('pl-confirm').focus();
  }
  close() { this.layer.hidden = true; this.ui.renderAll(); }

  /** Qualitative warning for the n-th training of the week (1-based), or ''. */
  static warnKey(n) { return n >= WEEK.WARN_OVER ? 'pl.warn.over' : n >= WEEK.WARN_HEAVY ? 'pl.warn.heavy' : ''; }

  /** v3.17: Monday's briefing block (new "while you were away" lines + this week's world event) and the month's cash block. */
  renderMonday() {
    const s = this.state, w = s.weekState(), monday = !w.confirmed && s.phase === 'calendar', date = s.calendar.date;
    const box = document.getElementById('pl-brief'), kb = document.getElementById('pl-kassa');
    const a = monday ? MorningBriefing.awayLines(s, date) : { imp: [], rout: [] }, world = monday ? MorningBriefing.worldNews(s, date) : [];
    this.shown = [...a.imp, ...a.rout];
    box.hidden = !this.shown.length && !world.length;
    box.innerHTML = box.hidden ? '' : world.map(n => `<div class="pl-world">&#10022; ${esc(n)}</div>`).join('')
      + (this.shown.length ? `<details class="pl-sec"${a.imp.length ? ' open' : ''}><summary>${esc(L.t('mb.away'))} (${this.shown.length})</summary><ul class="pl-away">${MorningBriefing.awayHTML(this.ui, a)}</ul></details>` : '');
    const cash = monday && s.kassaDue();
    kb.hidden = !cash;
    if (cash) {
      document.getElementById('pl-kassa-h').textContent = '$ ' + L.t('pl.kassa', { m: CashDesk.mName(s.monthOf()) });
      document.getElementById('pl-ks-report').innerHTML = CashDesk.reportHTML(s);
      document.getElementById('pl-ks-levels').innerHTML = CashDesk.levelsHTML(s, this.feeLevel || FINANCE.DEFAULT_LEVEL, 'pl-level');
    }
  }

  render() {
    this.renderMonday();
    const s = this.state, w = s.weekState(), today = s.calendar.date;
    let nth = 0;
    this.grid.innerHTML = WEEK.KEYS.map((k, i) => {
      const date = isoAdd(w.start, i), past = date < today, isToday = date === today;
      const we = s.worldEventOn(date), wtip = we ? L.t('world.tip.' + we.id) : '';   // v3.14: school / city event marker
      const head = `<div class="pl-day"><b>${esc(fmtDate(date, { weekday: 'short' }))}</b><span>${esc(fmtDate(date, { day: 'numeric', month: 'short' }))}</span>${isToday ? `<em>${L.t('pl.today')}</em>` : ''}${we ? `<i class="pl-we" title="${esc(wtip)}" aria-label="${esc(wtip)}">&#10022;</i>` : ''}</div>`;
      const cls = `pl-col${past ? ' past' : ''}${isToday ? ' now' : ''}${we ? ' we' : ''}`;
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
      return `<div class="${cls}${cur ? ' t' : ''}" data-date="${date}"${we ? ` title="${esc(wtip)}"` : ''}>${head}<div class="pl-opts">${opt('rest', L.t('pl.rest'))}`
        + REGIME_KEYS.map(r => opt(r, L.t('plan.' + r))).join('') + `</div>`
        + `<div class="pl-warn${warn === 'pl.warn.over' ? ' over' : ''}">${warn ? esc(L.t(warn)) : ''}</div>${cur ? '' : this.lessonHTML(k, editable)}</div>`;
    }).join('');
    const n = s.trainingsPlanned(), src = w.apSources || {};
    document.getElementById('pl-title').textContent = 'PLANNER.EXE — ' + L.t('pl.week', { d: fmtDate(w.start, { day: 'numeric', month: 'short' }) });
    document.getElementById('pl-head').innerHTML = `<span class="pl-ap" title="${esc(L.t('ap.tip'))}">${L.t('pl.ap', { n: w.ap, line: esc(MorningBriefing.apLine(src)) })}</span>
      <span class="pl-apleft">${L.t('pl.apLeft', { n: w.ap })}</span>
      <span class="pl-note">${L.t('pl.note', { m: WEEK.MAX_TRAININGS })}</span>`;
    const warn = WeekPlanner.warnKey(n);
    document.getElementById('pl-sum').innerHTML = `${L.t('pl.count', { n })}${warn ? ` <b class="${warn === 'pl.warn.over' ? 'over' : ''}">${esc(L.t(warn))}</b>` : n ? '' : ` <b>${esc(L.t('pl.warn.empty'))}</b>`}`;
    document.getElementById('pl-confirm').innerHTML = L.t('pl.confirm');
    document.getElementById('pl-status').textContent = this.msg || (!w.confirmed && s.kassaDue() ? L.t('kassa.status', { n: s.squad.length, m: '$' + FINANCE.FEES[this.feeLevel || FINANCE.DEFAULT_LEVEL].fee * s.squad.length }) + ' · ' : '')
      + (this.msg ? '' : L.t(w.confirmed ? 'pl.status.replan' : 'pl.status.new'));
    this.msg = '';
  }

  /** v3.16: the evening slot of a weekday without team training — kid + focus (1 AP, booked at once; '— none —' refunds). */
  lessonHTML(k, editable) {
    const s = this.state, w = s.weekState(), l = w.lessons[k], p = l && s.player(l.id);
    const head = `<div class="pl-lh">&#9790; ${L.t('pl.lesson')} <span class="tb-ap">${L.t('talk.apTag', { n: 1 })}</span></div>`;
    if (!editable) {   // past / today after confirming: read-only
      if (!l) return `<div class="pl-lesson none">${head}<small>—</small></div>`;
      const st = l.cancelled ? L.t('pl.lessonCancelled') : l.done ? L.t('pl.lessonDone') : '';
      return `<div class="pl-lesson on">${head}<small>${p ? `${p.number}. ${esc(L.name(p.surname))}` : '?'} · ${esc(L.t('lesson.focus.' + l.focus))}${st ? ' · ' + esc(st) : ''}</small></div>`;
    }
    const taken = new Set(WEEK.PLAN_KEYS.filter(x => x !== k && w.lessons[x]).map(x => w.lessons[x].id));
    const canBook = !!l || w.ap >= 1, tip = canBook ? L.t('pl.lessonTip') : L.t('pl.lessonNo.noAp');
    const kids = [...s.squad].sort((a, b) => a.number - b.number).map(q =>
      `<option value="${q.id}"${l?.id === q.id ? ' selected' : ''}${taken.has(q.id) ? ' disabled' : ''}>${q.number}. ${esc(L.name(q.surname))}</option>`).join('');
    return `<div class="pl-lesson${l ? ' on' : ''}" title="${esc(tip)}">${head}
      <select data-lkid="${k}" aria-label="${esc(L.t('pl.lesson'))}"${canBook ? '' : ' disabled'}><option value="">${L.t('pl.lessonNone')}</option>${kids}</select>
      <select data-lfocus="${k}" aria-label="${esc(L.t('pl.lessonFocus'))}"${l ? '' : ' disabled'}>${LESSON_FOCI.map(f =>
        `<option value="${f}"${(l?.focus || 'technical') === f ? ' selected' : ''}>${esc(L.t('lesson.focus.' + f))}</option>`).join('')}</select></div>`;
  }

  /** [ CONFIRM WEEK ] → today's locker room on a training day, else the Dashboard. */
  confirm() {
    const s = this.state;
    if (this.ui.events.active) return;
    if (!s.weekState().confirmed) {   // v3.17: Monday's one window — the cash desk and the briefing are confirmed with the plan
      if (s.phase === 'calendar' && s.kassaDue()) s.confirmKassa(this.feeLevel || FINANCE.DEFAULT_LEVEL);
      s.dayState().briefed = true;
      if (this.shown) s.markNews(this.shown);
      this.shown = null;
      s.away = null;
    }
    s.confirmWeek();
    this.layer.hidden = true;
    this.ui.renderAll();
    if (s.isOurTraining(s.calendar.date) && !s.dayState().locker?.done) this.ui.locker.open();
  }
}
