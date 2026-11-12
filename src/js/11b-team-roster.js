/* =========================================================
   TEAM ROSTER CARD (v1.7) — "[TEAM]_ROSTER.EXE"
   Click any club in the League standings. Shows the badge, league position
   and the lightweight squad stats only (MP / Goals / Assists), sorted by goals.
   ========================================================= */
class TeamRosterCard {
  constructor(ui) {
    this.ui = ui;
    this.teamId = null;
    this.layer = document.getElementById('troster-layer');
    this.body = document.getElementById('troster-body');
    const close = () => this.close();
    document.getElementById('troster-x').addEventListener('click', close);
    document.getElementById('troster-ok').addEventListener('click', close);
    this.layer.addEventListener('mousedown', e => { if (e.target === this.layer) close(); });
    document.addEventListener('keydown', e => {
      if (!this.isOpen || e.key !== 'Escape') return;
      e.preventDefault(); e.stopImmediatePropagation(); close();
    }, true);
  }
  get isOpen() { return !this.layer.hidden; }

  open(teamId) {
    const team = this.ui.state.league.team(teamId);
    if (!team || this.ui.modal.isOpen || this.ui.modalLock) return;   // v3.5
    this.teamId = teamId;
    this.render();
    this.lastFocus = document.activeElement;
    this.layer.hidden = false;
    document.getElementById('troster-ok').focus();
  }
  close() {
    if (!this.isOpen) return;
    this.layer.hidden = true;
    this.teamId = null;
    if (this.lastFocus && document.contains(this.lastFocus)) this.lastFocus.focus();
  }

  render() {
    if (this.teamId == null) return;
    const s = this.ui.state, lg = s.league, team = lg.team(this.teamId);
    const table = lg.table(), i = table.findIndex(r => r.team.id === team.id), row = table[i];
    const posOf = id => team.user ? s.player(id)?.position : team.squad.find(k => k.id === id)?.pos;   // v3.0: our kids show the coach's tag
    const kids = lg.scorers(s.squad, s.seasonStats).filter(k => k.team === team)
      .sort((a, b) => b.goals - a.goals || b.assists - a.assists || b.mp - a.mp || a.name.localeCompare(b.name));
    const title = `${L.team(team.name).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '').toUpperCase()}_ROSTER.EXE`;
    document.getElementById('troster-title').textContent = title;
    this.body.innerHTML = `
      <div class="tr-left">
        <span class="emblem xl">${team.emblemSvg}</span>
        <b class="tr-name">${esc(L.team(team.name))}</b>
        ${team.user ? `<small class="tr-you">${L.t('tr.you')}</small>` : ''}
        <dl class="pi-kv">
          <dt>${L.t('tr.place')}</dt><dd><b class="tr-place">${L.t('tr.placeN', { n: i + 1, t: table.length })}</b></dd>
          <dt>${L.t('tr.record')}</dt><dd>${row.w}-${row.d}-${row.l}</dd>
          <dt>${L.t('tr.gd')}</dt><dd>${row.gf}:${row.ga}</dd>
          <dt>${L.t('tr.pts')}</dt><dd><b class="tr-pts">${row.pts}</b></dd>
        </dl>
        <div class="tr-form">${this.ui.formChips(row.form)}</div>
      </div>
      <fieldset class="tr-right"><legend>${L.t('tr.tab')}</legend>
        <div class="tr-scroll"><table class="tr-table">
          <thead><tr><th class="c">#</th><th>${L.t('tr.player')}</th><th class="c">${L.t('tr.pos')}</th><th class="c">${L.t('tr.mp')}</th><th class="c">${L.t('tr.g')}</th><th class="c">${L.t('tr.a')}</th></tr></thead>
          <tbody>${kids.map((k, n) => `<tr class="${k.goals ? 'has-g' : ''}">
            <td class="c n">${n + 1}</td><td class="nm">${esc(L.name(k.name))}</td>
            <td class="c"><span class="pos ${posOf(k.id)}">${L.pos(posOf(k.id))}</span></td>
            <td class="c">${k.mp}</td><td class="c g">${k.goals}</td><td class="c a">${k.assists}</td></tr>`).join('')}</tbody>
        </table></div>
      </fieldset>`;
    document.getElementById('troster-status').textContent = L.t(team.user ? 'tr.statusMe' : 'tr.status');
  }
}
