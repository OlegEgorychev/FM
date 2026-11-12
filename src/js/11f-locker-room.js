/* =========================================================
   v2.6 — LOCKER ROOM ("LOCKER_ROOM.EXE", This Is the Police style roll call)
   Training days: START DAY → here → Proceed → training plan → END DAY.
   Match days: matchday dialog / Match tab → here → Proceed → Match screen.
   Arrivals are rolled once per day (GameState.runLocker). Kids who don't turn up are locked out of the
   XI, the bench and the training until the next morning. An empty locker can be investigated for 1 AP.
   ========================================================= */
class LockerRoom {
  static NOTE = { injury: '✚', suspended: '▮', home: '⌂', exhausted: 'Zz', skipped: '?', excused: '\u2302' };
  constructor(ui) {
    this.ui = ui;
    this.layer = document.getElementById('locker-room-view');
    this.grid = document.getElementById('lr-grid');
    document.getElementById('lr-x').addEventListener('click', () => this.close());
    document.getElementById('lr-proceed').addEventListener('click', () => this.proceed());
    this.grid.addEventListener('click', e => {
      if (e.target.closest('[data-info]')) return;   // v2.7: the [i] opens the profile, not the roll call
      if (this.requestPending) return;               // v2.8: answer the kid first
      const box = e.target.closest('.lk.empty');
      if (box) this.investigate(box.dataset.pid);
    });
    document.addEventListener('keydown', e => {
      if (!this.isOpen || e.key !== 'Escape' || !this.ui.events.view.layer.hidden) return;
      e.preventDefault(); e.stopImmediatePropagation(); this.close();
    }, true);
  }
  get isOpen() { return !this.layer.hidden; }
  get state() { return this.ui.state; }

  /** Opens the room; the first time today the arrivals are rolled and the doors open one by one. */
  open() {
    const s = this.state;
    if (!(s.phase === 'matchday' || (s.phase === 'calendar' && this.ui.dayInfo(s.calendar.date).kind === 'training'))) return;
    if (this.ui.events.active) { this.ui.events.open(); return; }
    if (!s.dayState().briefed) { this.ui.briefing.open(); return; }   // v2.8: morning briefing first
    this.ui.modal.close();   // v2.7: an open profile may stay — it sits above the room
    const lk = s.runLocker(s.phase === 'calendar');
    const reveal = !lk.revealed;
    lk.revealed = true;
    s.save();
    this.render(reveal);
    this.layer.hidden = false;
    document.getElementById('lr-proceed').focus();
    this.maybeRequest(reveal ? 1300 : 0);   // v2.8: a kid interrupts before you can look around
  }
  get requestPending() { const r = this.state.dayState().locker?.request; return !!(r && !r.done); }
  maybeRequest(delay) {
    if (!this.requestPending) return;
    clearTimeout(this.reqTimer);
    this.reqTimer = setTimeout(() => {
      const r = this.state.dayState().locker?.request;
      if (!this.isOpen || !r || r.done || this.ui.events.active) return;
      this.ui.profile.close();
      this.ui.events.fire('excuse', this.state.calendar.date, { cast: { kid: r.pid } });
    }, delay);
  }
  close() { this.layer.hidden = true; this.ui.renderDash(); }

  render(reveal = false) {
    const s = this.state, lk = s.dayState().locker;
    if (!lk) return;
    const match = s.phase === 'matchday', ctx = match ? s.matchContext() : null;
    const squad = [...s.squad].sort((a, b) => a.number - b.number);
    const present = squad.filter(p => !lk.absent[p.id]).length;
    this.grid.innerHTML = squad.map((p, i) => {
      const why = lk.absent[p.id], checked = lk.checked.includes(p.id), delay = reveal ? `style="animation-delay:${i * 70}ms"` : '';
      const plate = `<div class="lk-plate"><span class="lk-no">${p.number}</span>${this.ui.infoBtn(p)}<span class="pos ${p.position}">${L.pos(p.position)}</span></div>`;   // v2.7: [i] / right-click → profile
      if (!why) {
        const e = Math.round(p.energy);
        return `<div class="lk here${reveal ? ' rv' : ''}" ${delay} data-pid="${p.id}">${plate}
          <div class="lk-in"><span class="portrait lk-face">${p.portraitSvg}</span></div>
          <div class="lk-name">${esc(L.name(p.surname))}</div>
          <div class="energy ${this.ui.energyClass(e)}"><i style="width:${e}%"></i><span>${e}%</span></div></div>`;
      }
      const note = checked ? `<div class="lk-note open">${esc(L.t('lr.short.' + why))}</div>`
        : `<div class="lk-note">${LockerRoom.NOTE[why] && why !== 'skipped' && why !== 'exhausted' ? LockerRoom.NOTE[why] : '?'}</div>`;
      const can = !checked && s.ap > 0;
      return `<div class="lk empty${reveal ? ' rv' : ''}${checked ? ' checked' : ''}${can ? ' can' : ''}" ${delay} data-pid="${p.id}" role="button" tabindex="0"
          title="${esc(checked ? L.t('lr.short.' + why) : can ? L.t('lr.investigate') : L.t('lr.noAp'))}">${plate}
        <div class="lk-in dark">${note}</div>
        <div class="lk-name">${esc(L.name(p.surname))}</div><div class="lk-miss">${L.t('lr.missing')}</div></div>`;
    }).join('');
    const d = s.dayState();
    document.getElementById('lr-title').textContent = 'LOCKER_ROOM.EXE — ' + fmtDate(s.calendar.date, { weekday: 'long', day: 'numeric', month: 'short' });
    document.getElementById('lr-head').innerHTML = `
      <span class="lr-kind ${match ? 'k-match' : 'k-training'}">${match ? L.t('lr.kindMatch', { o: esc(L.team(ctx?.opp.name || '')) }) : L.t('lr.kindTraining')}</span>
      <span class="lr-count${present < 11 ? ' low' : ''}">${L.t('lr.arrived', { n: present, t: squad.length })}</span>
      <span class="lr-ap">${L.t('ap.left')} <b>${d.ap}/${COACH.AP}</b></span>`;
    document.getElementById('lr-proceed').innerHTML = L.t('lr.toPitch');   // v2.8: [ HEAD TO PITCH ]
    document.getElementById('lr-status').textContent = L.t(present < 11 ? 'lr.statusShort' : 'lr.status');
  }

  /** Roll call: 1 AP, a short phone call about one empty locker. */
  investigate(pid) {
    const s = this.state, lk = s.dayState().locker;
    if (!lk || !lk.absent[pid] || lk.checked.includes(pid) || this.ui.events.active) return;
    if (!s.spendAP()) { document.getElementById('lr-status').textContent = L.t('lr.noAp'); return; }
    lk.checked.push(pid);
    s.save();
    this.ui.renderBudget();
    this.render();
    this.ui.events.fire('rollcall', s.calendar.date, { cast: { kid: pid } });
  }

  /** Proceed: only the kids who came move on (absent starters are replaced), then plan / match. */
  proceed() {
    const s = this.state, lk = s.dayState().locker;
    if (!lk || this.ui.events.active) return;
    if (this.requestPending) { this.maybeRequest(0); return; }   // v2.8
    lk.done = true;
    for (const c of s.ensureAvailableXI()) s.addDiary({ date: s.calendar.date, key: 'xi.auto', vars: { a: { pid: c.out.id }, b: { pid: c.in.id } }, cls: 'ev' });
    const miss = Object.keys(lk.absent).length;
    s.addDiary({ date: s.calendar.date, key: miss ? 'lr.diary' : 'lr.diaryAll', vars: { n: s.squad.length - miss, t: s.squad.length,
      s: { list: Object.keys(lk.absent).map(pid => ({ pid })) } }, cls: 'tr' });
    s.save();
    this.layer.hidden = true;
    this.ui.prepareMatch();
    this.ui.renderAll();
    this.ui.show(s.phase === 'matchday' ? 'match' : 'dash');
  }
}
