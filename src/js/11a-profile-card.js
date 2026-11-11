/* =========================================================
   PLAYER PROFILE CARD (v1.5) — "PLAYER_INFO.EXE"
   Right-click any player (roster rows, pitch tokens, Notebook cards) or press [i] in a roster.
   Shows only OBSERVABLE data: energy, role, season totals, the coach's last note.
   Hidden attributes (1–20) are never rendered.
   ========================================================= */
class ProfileCard {
  constructor(ui) {
    this.ui = ui;
    this.id = null;
    this.layer = document.getElementById('pinfo-layer');
    this.body = document.getElementById('pinfo-body');
    this.lastSig = '';
    document.getElementById('pinfo-x').addEventListener('click', () => this.close());
    document.getElementById('pinfo-ok').addEventListener('click', () => this.close());
    document.getElementById('pinfo-office').addEventListener('click', () => this.ui.callIntoOffice(this.id));   // v2.5
    this.layer.addEventListener('mousedown', e => { if (e.target === this.layer) this.close(); });
    this.layer.addEventListener('contextmenu', e => { e.preventDefault(); if (e.target === this.layer) this.close(); });
    document.addEventListener('keydown', e => {
      if (!this.isOpen || e.key !== 'Escape') return;
      e.preventDefault(); e.stopImmediatePropagation(); this.close();
    }, true);
  }
  get isOpen() { return !this.layer.hidden; }

  /** Our academy kid, or (during a match) an opponent from the engine. */
  resolve(id) {
    const own = this.ui.state.player(id);
    if (own) return { p: own, own: true };
    const eng = this.ui.engine;
    const opp = eng?.sides[1].all?.find(p => p.id === id) || eng?.sides[1].players.find(p => p.id === id);
    return opp ? { p: opp, own: false } : null;
  }

  open(id) {
    if (!this.resolve(id) || this.ui.modal.isOpen) return;
    this.id = id;
    this.lastSig = '';
    this.render();
    this.lastFocus = document.activeElement;
    this.layer.hidden = false;
    document.getElementById('pinfo-ok').focus();
  }
  close() {
    if (!this.isOpen) return;
    this.layer.hidden = true;
    this.id = null;
    if (this.lastFocus && document.contains(this.lastFocus)) this.lastFocus.focus();
  }
  /** Called on every engine update: cheap signature check, re-render only when something visible changed. */
  tick() { if (this.isOpen) this.render(); }

  render() {
    const r = this.resolve(this.id);
    if (!r) { this.close(); return; }
    const { p, own } = r, ui = this.ui, s = ui.state, eng = ui.engine;
    const live = eng?.stats.get(p.id) && !eng.finished ? eng.stats.get(p.id) : null;
    const energy = Math.round(eng?.energy?.get(p.id) ?? p.energy ?? 100);
    const sig = [L.code, energy, JSON.stringify(live), own && JSON.stringify(s.seasonOf(p.id)), own && p.tags.join(), own && p.flags.join(), s.budget, own && p.injuryDays, own && p.suspensionMatches, own && p.awayDays, s.ap].join('|');
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    const season = own ? s.seasonOf(p.id) : null;
    const pct = (ok, fail) => (ok + fail ? Math.round(ok / (ok + fail) * 100) : null);
    const cell = (v, r) => `<td style="${rateStyle(r)}">${v}</td>`;
    const rows = st => [
      [L.t('pi.apps'), st.apps ?? (st === live ? 1 : 0)],
      [L.t('pi.goals'), st.goals],
      [L.t('pi.assists'), st.assists ?? 0],
      [L.t('pi.shots'), `${st.shots} <small>(${L.t('pi.onTarget', { n: st.onTarget })})</small>`],
      [L.t('pi.tackles'), `${st.tackles} <small>/ ${st.tackles + st.tacklesLost}</small>`, pct(st.tackles, st.tacklesLost)],
      [L.t('pi.passAcc'), pct(st.passOk, st.passFail) == null ? '—' : pct(st.passOk, st.passFail) + '% <small>(' + st.passOk + '/' + (st.passOk + st.passFail) + ')</small>', pct(st.passOk, st.passFail)],
      ...(p.position === 'GK' ? [[L.t('pi.saves'), st.saves]] : []),
    ];
    const base = season || MatchEngine.blankStats();
    const sRows = rows(base), lRows = live ? rows(live) : null;
    const table = `<table class="pi-stats"><thead><tr><th></th><th>${L.t(own ? 'pi.season' : 'pi.na')}</th>${live ? `<th class="live">${L.t('pi.today')}</th>` : ''}</tr></thead><tbody>`
      + sRows.map((row, i) => `<tr><th>${row[0]}</th>${own ? cell(row[1], row[2]) : '<td>—</td>'}${live ? cell(lRows[i][1], lRows[i][2]) : ''}</tr>`).join('')
      + '</tbody></table>';

    let roleHtml, noteHtml;
    if (own) {
      const tag = p.tags[0];
      roleHtml = (tag ? `${L.t('pi.roleLbl')} ${ui.tagChip(tag, p.id, false)}<small>${esc(L.tagDesc(tag))}</small>`
        : `<span class="pi-none">${L.t('pi.noRole')}</span>`) + ui.flagChips(p);
      const n = s.coachNotes?.[p.id];
      noteHtml = n
        ? `<div class="pi-note-h">${L.t('pi.noteFrom', { n: n.md, o: esc(L.team(n.opp || '')) })}</div><p>${esc(n.keys.map(k => k === 'note.role' ? L.t(k, { r: L.tag(n.role) }) : L.t(k)).join(' '))}</p>`
        : `<p class="pi-none">${L.t('pi.noNote')}</p>`;
    } else {
      roleHtml = `<span class="pi-none">${L.t('pi.scout')}</span>`;
      noteHtml = `<p class="pi-none">${L.t('pi.oppNote')}</p>`;
    }
    const where = !own ? L.t('pi.opponent')
      : eng && !eng.finished ? (eng.sentOff.has(p.id) ? L.t('lr.sent') : eng.subbedOff.has(p.id) ? L.t('lr.off')
        : eng.sides[0].players.includes(p) ? L.t('lr.onPitch') : L.t('lr.bench'))
      : s.isStarter(p.id) ? L.t('pi.starter') : L.t('team.onBench');
    const tired = energy < ENERGY.TIRED;

    this.body.innerHTML = `
      <div class="pi-left">
        <span class="portrait xl">${p.portraitSvg}</span>
        <dl class="pi-kv">
          <dt>${L.t('pi.name')}</dt><dd><b>${esc(L.name(p.name))}</b></dd>
          <dt>${L.t('pi.number')}</dt><dd>#${p.number ?? '—'}</dd>
          <dt>${L.t('pi.age')}</dt><dd>${p.age}</dd>
          <dt>${L.t('pi.height')}</dt><dd>${L.t('pi.cm', { n: p.bio.height })}</dd>
          <dt>${L.t('pi.weight')}</dt><dd>${L.t('pi.kg', { n: p.bio.weight })}</dd>
          <dt>${L.t('pi.foot')}</dt><dd>${L.t(p.bio.strongFoot === 'L' ? 'pi.footL' : 'pi.footR')}</dd>
          <dt>${L.t('pi.pos')}</dt><dd><span class="pos ${p.position}">${L.pos(p.position)}</span></dd>
          <dt>${L.t('pi.status')}</dt><dd>${where}</dd>
          ${own && !p.available ? `<dt>${L.t('pi.avail')}</dt><dd class="pi-out">${ui.statusBadge(p)} ${esc(L.t('st.' + p.unavailableReason, { n: { inj: p.injuryDays, sus: p.suspensionMatches, home: p.awayDays }[p.unavailableReason] ?? '' }))}</dd>` : ''}
        </dl>
      </div>
      <div class="pi-right">
        <fieldset><legend>${L.t('pi.energy')}</legend>
          <div class="energy ${ui.energyClass(energy)}"><i style="width:${energy}%"></i><span>${energy}%${tired ? ' ×0.5' : ''}</span></div>
        </fieldset>
        <fieldset><legend>${L.t('pi.tags')}</legend><div class="pi-role">${roleHtml}</div></fieldset>
        <fieldset><legend>${L.t('pi.stats')}</legend>${table}</fieldset>
        <fieldset class="pi-note"><legend>${L.t('nb.coachNote')}</legend>${noteHtml}</fieldset>
      </div>`;
    document.getElementById('pinfo-status').textContent = L.t('pi.status.bar');
    const ob = document.getElementById('pinfo-office');   // v2.5: [ CALL INTO OFFICE ] (1 action point)
    ob.hidden = !own;
    ob.disabled = !ui.canCallIn(p.id);
    ob.innerHTML = L.t('office.btn', { n: s.ap });
    ob.title = L.t(s.ap > 0 ? 'office.btnTip' : 'office.btnNoAp');
  }
}
