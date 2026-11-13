/* =========================================================
   v2.1 — MATCH SUMMARY ("MATCH_SUMMARY.EXE")
   Opens at full time (visual and Quick Sim) BEFORE the Coach's Notebook.
   Built only from state.lastReport (events come from MatchEngine.matchEvents), so it can be re-opened after a reload.
   Our club is always on the left (like the live scoreboard); the venue is shown underneath.
   v3.5: a BLOCKING modal (ui.modalLock: nothing behind it opens or reacts) with a forced post-match team talk
   ("Coach's Word"): Proceed / × / Esc stay locked until one of the 3 talks (TEAM_TALK) is chosen. A reload before
   the choice re-opens the summary (state.talkPending).
   ========================================================= */
class MatchSummary {
  static ICON = { goal: '⚽', yellow: '🟨', red: '🟥', injury: '✚' };
  constructor(ui) {
    this.ui = ui;
    this.layer = document.getElementById('msum-layer');
    this.body = document.getElementById('msum-body');
    document.getElementById('msum-x').addEventListener('click', () => this.requestClose());
    document.getElementById('msum-go').addEventListener('click', () => this.proceed());
    this.body.addEventListener('click', e => { const b = e.target.closest('[data-talk]'); if (b && !b.disabled) this.chooseTalk(b.dataset.talk); });
    // v3.4: match log export (kept in memory for the last match only — not in the save)
    document.getElementById('msum-csv').addEventListener('click', () => this.exportLog('csv'));
    document.getElementById('msum-json').addEventListener('click', () => this.exportLog('json'));
    document.addEventListener('keydown', e => {
      if (!this.isOpen || e.key !== 'Escape') return;
      e.preventDefault(); e.stopImmediatePropagation(); this.requestClose();
    }, true);
  }
  get isOpen() { return !this.layer.hidden; }
  /** "Liam Smith" → "L. Smith" (in the current language). */
  static short(name) { const n = L.name(name).split(' '); return n.length > 1 ? `${n[0][0]}. ${n.slice(1).join(' ')}` : n[0]; }

  open(rep) {
    if (!rep) return;
    this.rep = rep;
    this.render();
    this.layer.hidden = false;
    this.ui.setModalLock(true);   // v3.5: closes whatever was open behind and makes it inert
    (this.body.querySelector('[data-talk]:not([disabled])') || document.getElementById('msum-go')).focus();
    for (const id of ['msum-csv', 'msum-json']) document.getElementById(id).disabled = !this.log;
  }
  close() { if (this.layer.hidden) return; this.layer.hidden = true; this.ui.setModalLock(false); }
  /** v3.5: the team talk is still owed for THIS report. */
  get pending() { return !!this.rep && this.rep === this.ui.state.lastReport && this.ui.state.talkPending; }
  /** v3.5: × / Esc — refused (status bar hint) until the team talk is chosen. */
  requestClose() {
    if (this.pending) { this.nudge(); return false; }
    this.close(); return true;
  }
  proceed() {
    if (this.pending) { this.nudge(); return; }
    this.close(); this.ui.show('notes');
  }
  nudge() {
    const st = document.getElementById('msum-status');
    st.textContent = L.t('tt.needed');
    const t = this.body.querySelector('.ms-talk');
    if (t) { t.classList.remove('nudge'); void t.offsetWidth; t.classList.add('nudge'); }
  }
  chooseTalk(key) {
    const fx = this.ui.state.applyTeamTalk(key);
    if (!fx) return;
    this.ui.renderAll();   // morale / reputation / diary changed (this also re-renders the summary)
    document.getElementById('msum-go').focus();
  }
  /** v3.5: compact effect tags ("+Morale", "−Board") for one talk option — no numbers, just the direction. */
  static fxTags(fx) {
    const order = [['morale', 'morale'], ['disc', 'disc'], ['board', 'board'], ['parents', 'parents'], ['squad', 'squad']];
    return order.filter(([k]) => fx[k]).map(([k, lbl]) => {
      const up = fx[k] > 0;
      return `<i class="${up ? 'up' : 'dn'}">${up ? '+' : '\u2212'}${L.t('tt.fx.' + lbl)}</i>`;
    }).join('') || `<i class="eq">${L.t('tt.fx.none')}</i>`;
  }
  talkHTML(rep) {
    if (rep.talk === undefined) return '';   // pre-v3.5 report: no talk owed
    const out = talkOutcome(rep), chosen = rep.talk, say = out === 'heavy' ? 'L' : out;   // v3.9: lines per W / D / L
    const btns = TEAM_TALK.KEYS.map(k => {
      const fx = talkEffects(k, rep);
      return `<button class="btn ms-talk-btn${chosen === k ? ' chosen' : ''}" type="button" data-talk="${k}" ${chosen ? 'disabled' : ''} title="${esc(L.t('tt.tip.' + k))}">
        <b>${L.t('tt.name.' + k)}</b><span class="q">${L.t('tt.say.' + k + '.' + say)}</span><span class="fx">${MatchSummary.fxTags(fx)}</span></button>`;
    }).join('');
    const react = chosen === 'none' ? `<div class="ms-talk-react wait">${L.t('tt.react.none')}</div>`   // v3.9: Quick Sim day closed without a word
      : chosen ? `<div class="ms-talk-react">&#9658; ${L.t('tt.react.' + chosen + '.' + out)}</div>` : `<div class="ms-talk-react wait">${L.t('tt.prompt.' + out)}</div>`;
    return `<div class="ms-talk${chosen ? ' done' : ''}"><h4>${L.t('tt.title')}</h4><div class="ms-talk-btns">${btns}</div>${react}</div>`;
  }
  /** v3.4: the log of THIS match, if it is still in memory (it is not saved, so a reload loses it). */
  get log() { const g = this.ui.lastMatchLog; return g && this.rep && g.md === this.rep.md && g.opponent === this.rep.opponent ? g : null; }
  exportLog(kind) {
    const g = this.log; if (!g) return;
    const base = `yam-log-md${g.md}-${String(g.opponent).replace(/[^\w]+/g, '_').toLowerCase()}`;
    if (kind === 'json') this.ui.download(base + '.json', JSON.stringify(g, null, 1), 'application/json');
    else this.ui.download(base + '.csv', MatchEngine.traceCsv(g.trace, g.teams.map(t => t.name)), 'text/csv');
  }

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
      </div>${this.talkHTML(rep)}`;
    document.getElementById('msum-title').textContent = `MATCH_SUMMARY.EXE — ${L.t('ms.md', { n: rep.md })}`;
    const pending = this.pending;
    document.getElementById('msum-status').textContent = L.t(pending ? 'tt.needed' : 'ms.status');
    document.getElementById('msum-go').disabled = pending;   // v3.5
    document.getElementById('msum-x').disabled = pending;
    const lb = document.getElementById('msum-lockbar');   // v3.9: what the locked taskbar says on hover
    lb.textContent = L.t('lock.bar'); lb.title = L.t(pending ? 'lock.tipTalk' : 'lock.tip');
  }
}
