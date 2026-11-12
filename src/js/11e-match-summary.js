/* =========================================================
   v2.1 — MATCH SUMMARY ("MATCH_SUMMARY.EXE")
   Opens at full time (visual and Quick Sim) BEFORE the Coach's Notebook.
   Built only from state.lastReport (events come from MatchEngine.matchEvents), so it can be re-opened after a reload.
   Our club is always on the left (like the live scoreboard); the venue is shown underneath.
   ========================================================= */
class MatchSummary {
  static ICON = { goal: '⚽', yellow: '🟨', red: '🟥', injury: '✚' };
  constructor(ui) {
    this.ui = ui;
    this.layer = document.getElementById('msum-layer');
    this.body = document.getElementById('msum-body');
    document.getElementById('msum-x').addEventListener('click', () => this.close());
    document.getElementById('msum-go').addEventListener('click', () => { this.close(); this.ui.show('notes'); });
    document.addEventListener('keydown', e => {
      if (!this.isOpen || e.key !== 'Escape') return;
      e.preventDefault(); e.stopImmediatePropagation(); this.close();
    }, true);
  }
  get isOpen() { return !this.layer.hidden; }
  /** "Liam Smith" → "L. Smith" (in the current language). */
  static short(name) { const n = L.name(name).split(' '); return n.length > 1 ? `${n[0][0]}. ${n.slice(1).join(' ')}` : n[0]; }

  open(rep) {
    if (!rep) return;
    this.rep = rep;
    this.ui.modal.close(); this.ui.profile.close();
    this.render();
    this.layer.hidden = false;
    document.getElementById('msum-go').focus();
  }
  close() { this.layer.hidden = true; }

  render() {
    const rep = this.rep, ui = this.ui, s = ui.state, lg = s.league;
    if (!rep) return;
    const me = lg.team(0), opp = lg.teams.find(t => t.name === rep.opponent);
    const evs = (rep.events || []).slice().sort((a, b) => a.minute - b.minute);
    const line = e => {
      const as = (e.pen ? ` <small>${L.t('ms.pen')}</small>` : '') + (e.corner ? ` <small>${L.t('ms.corner')}</small>` : '')
        + (e.assist ? ` <small>(${esc(MatchSummary.short(e.assist))})</small>` : '');
      return `<div class="ms-ev ${e.type}" title="${esc(L.t('ms.type.' + e.type))}"><span class="m">${pad2(e.minute)}'</span> ${MatchSummary.ICON[e.type] || '•'} ${esc(MatchSummary.short(e.playerName))}${as}</div>`;
    };
    const col = (home, title) => {
      const list = evs.filter(e => e.isHomeTeam === home);
      const first = list.filter(e => e.minute <= 45), second = list.filter(e => e.minute > 45);
      const ht = rep.ht ? `<div class="ms-ev ht">— ${L.t('ms.ht')} ${rep.ht[0]}-${rep.ht[1]} —</div>` : '';
      return `<div class="ms-col ${home ? 'home' : 'away'}"><h4>${esc(title)}</h4>`
        + (list.length ? first.map(line).join('') + ht + second.map(line).join('') : `<span class="ms-none">${L.t('ms.none')}</span>${ht}`) + '</div>';
    };
    const t = rep.totals || [{}, {}];
    const pct = x => (x.passOk + x.passFail ? Math.round(x.passOk / (x.passOk + x.passFail) * 100) : 0);
    this.body.innerHTML = `
      <div class="ms-board">
        <div class="ms-team home">${emblemHTML(me, 'lg')}<span>${esc(L.team(s.clubName))}</span></div>
        <div class="ms-score">${rep.gf} - ${rep.ga}</div>
        <div class="ms-team away">${emblemHTML(opp, 'lg')}<span>${esc(L.team(rep.opponent))}</span></div>
        <div class="ms-sub"><span class="ms-res ${rep.result}">${L.t('res.' + rep.result)}</span><span>${L.t('ms.md', { n: rep.md })} · ${L.t('venue.' + rep.venue)}</span>${rep.ht ? `<span>${L.t('ms.ht')} ${rep.ht[0]}-${rep.ht[1]}</span>` : ''}${rep.instant ? `<span>${L.t('ms.quick')}</span>` : ''}</div>
      </div>
      <div class="ms-timeline">${col(true, L.team(s.clubName))}${col(false, L.team(rep.opponent))}</div>
      <div class="ms-stats">
        <div>${L.t('ms.poss')}<b>${rep.poss ?? 50}% - ${100 - (rep.poss ?? 50)}%</b></div>
        <div>${L.t('ms.shots')}<b>${t[0].shots ?? 0} (${t[0].onTarget ?? 0}) - ${t[1].shots ?? 0} (${t[1].onTarget ?? 0})</b></div>
        <div>${L.t('ms.pass')}<b>${pct(t[0])}% - ${pct(t[1])}%</b></div>
        <div>${L.t('ms.cards')}<b>${t[0].yellow ?? 0}/${t[0].red ?? 0} - ${t[1].yellow ?? 0}/${t[1].red ?? 0}</b></div>
      </div>`;
    document.getElementById('msum-title').textContent = `MATCH_SUMMARY.EXE — ${L.t('ms.md', { n: rep.md })}`;
    document.getElementById('msum-status').textContent = L.t('ms.status');
  }
}
