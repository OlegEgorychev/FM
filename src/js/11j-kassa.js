/* =========================================================
   v3.15 — KASSA.EXE: the cash desk (the first stop of every month, before anything else that day)
   Top: last month's ledger (fees / board grant / donations / rent / events / total) + the budget now.
   Bottom: this month's fee level (FINANCE.FEES). [ CONFIRM ] lifts the `kassa` blocker → the day goes on.
   ========================================================= */
class CashDesk {
  constructor(ui) {
    this.ui = ui;
    this.level = FINANCE.DEFAULT_LEVEL;
    this.layer = document.getElementById('kassa-view');
    document.getElementById('ks-x').addEventListener('click', () => this.close());
    document.getElementById('ks-confirm').addEventListener('click', () => this.confirm());
    document.getElementById('ks-levels').addEventListener('change', e => {
      const r = e.target.closest('input[name="ks-level"]');
      if (r && FINANCE.FEES[r.value]) { this.level = r.value; this.render(); }
    });
  }
  get isOpen() { return !this.layer.hidden; }
  get state() { return this.ui.state; }

  open() {
    const s = this.state;
    if (this.ui.modalLock || !s.kassaDue()) return;
    if (this.ui.events.active) { this.ui.events.open(); return; }
    this.ui.modal.close();
    if (this.ui.briefing.isOpen) this.ui.briefing.close();
    this.level = FINANCE.DEFAULT_LEVEL;
    this.render();
    this.layer.hidden = false;
    document.getElementById('ks-confirm').focus();
  }
  close() { this.layer.hidden = true; this.ui.renderAll(); }

  render() {
    const s = this.state, month = s.monthOf(), rep = s.lastMonthReport();
    const mName = m => fmtDate(m + '-01', { month: 'long', year: 'numeric' });
    const sum = v => `<b class="${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}">${v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(v)}</b>`;
    document.getElementById('ks-title').textContent = 'KASSA.EXE — ' + mName(month);
    document.getElementById('ks-report').innerHTML = (rep
      ? `<div class="ks-h">${L.t('kassa.report', { m: mName(rep.month) })}</div><table class="ks-table">`
        + LEDGER_CATS.map(c => `<tr data-cat="${c}"><td>${L.t('kassa.row.' + c)}</td><td>${sum(rep.rows[c])}</td></tr>`).join('')
        + `<tr class="tot" data-cat="total"><td>${L.t('kassa.row.total')}</td><td>${sum(rep.total)}</td></tr></table>`
      : `<div class="ks-h">${L.t('kassa.firstH')}</div><p class="ks-first">${L.t('kassa.first')}</p>`)
      + `<div class="ks-budget">${L.t('kassa.budget')} <b class="${s.budget < 0 ? 'neg' : ''}">${money(s.budget)}</b></div>`;
    document.getElementById('ks-levels').innerHTML = `<div class="ks-h">${L.t('kassa.level', { m: mName(month) })}</div>`
      + FINANCE.FEE_LEVELS.map(k => `<label class="ks-lvl${this.level === k ? ' on' : ''}"><input type="radio" name="ks-level" value="${k}"${this.level === k ? ' checked' : ''}>
        <b>${L.t('kassa.lvl.' + k, { m: '$' + FINANCE.FEES[k].fee })}</b><small>${L.t('kassa.lvl.' + k + '.d')}</small></label>`).join('');
    document.getElementById('ks-note').textContent = L.t('kassa.note');
    document.getElementById('ks-confirm').innerHTML = L.t('kassa.confirm');
    document.getElementById('ks-status').textContent = L.t('kassa.status', { n: s.squad.length, m: '$' + FINANCE.FEES[this.level].fee * s.squad.length });
  }

  /** [ CONFIRM ] → the fee for this month; then on with the day (briefing → plan → locker, or the match-day locker). */
  confirm() {
    const s = this.state;
    if (this.ui.events.active || !s.kassaDue()) return;
    s.confirmKassa(this.level);
    this.layer.hidden = true;
    this.ui.renderAll();
    this.ui.resumeStop();
  }
}
