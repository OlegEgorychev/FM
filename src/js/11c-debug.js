/* =========================================================
   v1.8 — DEBUG.EXE (developer mode, Win98 "Registry Editor" look)
   Tab DATABASE: every hidden + visible attribute of every academy kid as raw numbers (sortable).
   Tab GOD MODE: test cheats (energy, morale & sharpness, one-shot Force Win).
   This is the ONLY place where the hidden 1–20 skills are ever rendered.
   ========================================================= */
class DebugConsole {
  /** Column spec: g = group header, h = short header, v = value getter, s = scale for heat colours. */
  static COLS = (() => {
    const c = [];
    const add = (g, h, v, s = null, t = '') => c.push({ g, h, v, s, t });
    add('ID', '#', p => p.number); add('ID', 'NAME', p => p.name); add('ID', 'ARCH', p => p.archetype, null, 'v3.0 hidden generated role (shapes the hidden stats only)'); add('ID', 'TAG', p => p.tag || '—', null, 'coach\'s visual tag');
    add('BIO', 'AGE', p => p.bio.age); add('BIO', 'HT', p => p.bio.height, null, 'height, cm'); add('BIO', 'WT', p => p.bio.weight, null, 'weight, kg');
    add('BIO', 'FT', p => p.bio.strongFoot, null, 'strong foot'); add('BIO', 'WF', p => p.bio.weakFoot, 5, 'weak foot 1-5');
    const short = { acceleration: 'ACC', speed: 'SPD', agility: 'AGI', strength: 'STR', baseStamina: 'STA',
      firstTouch: 'FTC', dribbling: 'DRI', passing: 'PAS', crossing: 'CRO', shooting: 'SHO', tackling: 'TCK', goalkeeping: 'GKP',
      positioning: 'POS', vision: 'VIS', decisions: 'DEC', passion: 'PSN', discipline: 'DSC', composure: 'CMP' };
    for (const g of ['physical', 'technical', 'tactical', 'psych'])
      for (const k of ATTR_GROUPS[g]) add(g.toUpperCase(), short[k], p => p[g][k], 20, k);
    add('PSYCH', 'ROOM', p => p.psych.potential, 10, 'v3.12 growth room 1-10: points every skill can gain above its start (max 20)');
    add('PSYCH', 'GAIN', p => Object.values(p.gains || {}).reduce((a, b) => a + b, 0), null, 'v3.12 total points gained in training');
    add('PSYCH', 'CAPT', p => L.t('dbg.cap.' + (p.captainTrait || 'normal')), null, 'v3.7 hidden captain trait: leader (rally +morale) / anxious (stress, may break down) / normal');
    add('PSYCH', 'LDR', p => p.leadership, 20, 'v3.8 hidden leadership 1-20 (≥14 leader, ≤7 anxious): armband reactions, captain initiatives, resignation');
    add('PSYCH', 'WLTH', p => p.wealth || '—', null, 'v3.15 hidden family wealth rich / middle / poor (seeded by id): fee payments, Rich Kid\'s Dad, Torn Boots');
    add('DYNAMIC', 'CON', p => Math.round(p.dyn.condition), 100, 'condition (energy)');
    add('DYNAMIC', 'SHP', p => Math.round(p.dyn.sharpness), 100, 'sharpness (match tone); < 50 → technical −2');
    add('DYNAMIC', 'MOR', p => Math.round(p.dyn.morale), 100, 'morale');
    for (const k of Object.keys(COMPOSITE)) add('ENGINE', { Pass: 'PAS*', Mark: 'MRK*', Dribble: 'DRB*', Speed: 'PAC*', Tackle: 'TKL*', Shoot: 'SHT*', Save: 'SAV*' }[k], p => +p.rating(k).toFixed(1), 20, 'composite ' + k + ' = ' + Object.keys(COMPOSITE[k]).join('+'));
    add('ENGINE', 'OVR', p => +p.overall.toFixed(1), 20, 'hidden overall (position composites) — v1.9 "worst player"');
    add('ENGINE', 'MOOD', p => +p.moodBonus.toFixed(1), null, 'morale × passion roll bonus');
    add('ENGINE', 'ROLE', p => (p.tags || [])[0] || '—');
    add('ENGINE', 'INJ', p => p.injuryDays || 0, null, 'v2.2 injury: calendar days left');
    add('ENGINE', 'SUS', p => p.suspensionMatches || 0, null, 'v2.2 suspension: matches left');
    add('ENGINE', 'HOME', p => p.awayDays || 0, null, 'v2.3 kept at home by a parent: days left');
    add('ENGINE', 'SKIP%', p => Math.round(arrivalSkipChance(p) * 100), null, 'v2.6 chance to skip the locker room (from discipline)');
    add('ENGINE', 'ABS', p => p.absentToday || '—', null, 'v2.6 absent today');
    add('ENGINE', 'FLAGS', p => (p.flags || []).join(' ') || '—', null, 'v1.9 story flags');
    return c;
  })();

  constructor(ui) {
    this.ui = ui;
    this.tab = 'db';
    this.sort = { i: 2, dir: 1 };
    this.msg = '';
    this.layer = document.getElementById('debug-layer');
    this.body = document.getElementById('debug-body');
    document.getElementById('btn-debug').addEventListener('click', () => this.open());
    document.getElementById('debug-x').addEventListener('click', () => this.close());
    document.getElementById('debug-ok').addEventListener('click', () => this.close());
    this.layer.addEventListener('mousedown', e => { if (e.target === this.layer) this.close(); });
    this.layer.querySelectorAll('[data-dtab]').forEach(b => b.addEventListener('click', () => { this.tab = b.dataset.dtab; this.msg = ''; this.render(); }));
    this.body.addEventListener('click', e => {
      const th = e.target.closest('th[data-col]');
      if (th) { const i = +th.dataset.col; this.sort = { i, dir: this.sort.i === i ? -this.sort.dir : 1 }; this.render(); return; }
      const b = e.target.closest('[data-cheat]');
      if (b) this.cheat(b.dataset.cheat);
    });
    document.addEventListener('keydown', e => {
      if (!this.isOpen || e.key !== 'Escape') return;
      e.preventDefault(); e.stopImmediatePropagation(); this.close();
    }, true);
  }
  get isOpen() { return !this.layer.hidden; }
  open() { if (this.ui.modal.isOpen || this.ui.modalLock) return; this.ui.profile.close(); this.msg = ''; this.render(); this.layer.hidden = false; document.getElementById('debug-ok').focus(); }
  close() { this.layer.hidden = true; }

  heat(v, s) {
    if (s == null || typeof v !== 'number') return '';
    const r = v / s;
    return r >= 0.75 ? 'hi' : r >= 0.55 ? 'gd' : r <= 0.3 ? 'lo' : '';
  }

  render() {
    if (!this.layer) return;
    this.layer.querySelectorAll('[data-dtab]').forEach(b => b.classList.toggle('on', b.dataset.dtab === this.tab));
    this.body.innerHTML = this.tab === 'db' ? this.dbHTML() : this.godHTML();
    document.getElementById('debug-status').textContent = this.msg
      || (this.tab === 'db' ? L.t('dbg.rows', { n: this.ui.state.squad.length, c: DebugConsole.COLS.length }) : L.t('dbg.godHint'));
  }

  dbHTML() {
    const C = DebugConsole.COLS, { i, dir } = this.sort;
    const squad = [...this.ui.state.squad].sort((a, b) => {
      if (i === 2) return dir * ((POS_ORDER[a.archetype] - POS_ORDER[b.archetype]) || a.number - b.number);
      const x = C[i].v(a), y = C[i].v(b);
      return dir * (typeof x === 'number' ? x - y : String(x).localeCompare(String(y)));
    });
    const groups = [];
    C.forEach(c => { const last = groups[groups.length - 1]; if (last && last.g === c.g) last.n++; else groups.push({ g: c.g, n: 1 }); });
    const head1 = groups.map(g => `<th colspan="${g.n}" class="grp g-${g.g.toLowerCase()}">${g.g}</th>`).join('');
    const head2 = C.map((c, k) => `<th data-col="${k}" title="${esc(c.t || c.h)}" class="${k === i ? (dir > 0 ? 'asc' : 'desc') : ''}">${c.h}</th>`).join('');
    const rows = squad.map(p => `<tr>${C.map(c => { const v = c.v(p); return `<td class="${this.heat(v, c.s)}">${esc(v)}</td>`; }).join('')}</tr>`).join('');
    const avg = C.map((c, k) => {
      if (k === 0) return `<td colspan="3">${L.t('dbg.avg')}</td>`;
      if (k < 3) return '';
      const vals = squad.map(c.v).filter(v => typeof v === 'number');
      return vals.length && c.s ? `<td>${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)}</td>` : '<td></td>';
    }).join('');
    return `<p class="dbg-hint">${esc(L.t('dbg.dbHint'))}</p>
      <div class="dbg-scroll"><table class="dbg-table"><thead><tr>${head1}</tr><tr>${head2}</tr></thead>
      <tbody>${rows}</tbody><tfoot><tr>${avg}</tr></tfoot></table></div>`;
  }

  godHTML() {
    const on = !!this.ui.state.cheats?.forceWin, ev = this.ui.events.enabled;
    const btn = (id, label, desc, extra = '') => `<div class="dbg-cheat"><button class="btn${extra}" type="button" data-cheat="${id}">${label}</button><span>${desc}</span></div>`;
    return `<div class="dbg-god">
      ${btn('energy', L.t('dbg.energy'), L.t('dbg.energyD'))}
      ${btn('maxms', L.t('dbg.maxMs'), L.t('dbg.maxMsD'))}
      ${btn('force', L.t('dbg.force') + ` <b class="dbg-flag ${on ? 'on' : ''}">[${L.t(on ? 'dbg.forceOn' : 'dbg.forceOff')}]</b>`, L.t('dbg.forceD'), on ? ' armed' : '')}
      <hr class="dbg-hr">
      ${btn('autosim', L.t('dbg.autosim'), L.t('dbg.autosimD'))}
      ${btn('ap', L.t('dbg.ap'), L.t('dbg.apD'))}
      <div class="dbg-cheat"><span class="dbg-world"><select id="dbg-world" aria-label="${esc(L.t('dbg.world'))}"><option value="">${L.t('dbg.worldNone')}</option>${WORLD_EVENTS.map(e =>
        `<option value="${e.id}"${this.ui.state.worldEvent?.id === e.id ? ' selected' : ''}>${esc(L.t('world.name.' + e.id))}</option>`).join('')}</select>
        <button class="btn" type="button" data-cheat="world">${L.t('dbg.world')}</button></span><span>${L.t('dbg.worldD')}</span></div>
      ${btn('money', L.t('dbg.money') + ` <b class="dbg-flag">[${money(this.ui.state.budget)}]</b>`, L.t('dbg.moneyD'))}
      ${NARRATIVE_EVENTS.filter(e => e.when !== 'manual').map(e => btn('fire:' + e.id, L.t('dbg.fire', { e: L.t('dbg.ev.' + e.id) }), L.t('dbg.fireD'))).join('')}
      ${btn('events', L.t('dbg.events') + ` <b class="dbg-flag ${ev ? '' : 'on'}">[${L.t(ev ? 'dbg.forceOn' : 'dbg.forceOff')}]</b>`, L.t('dbg.eventsD'))}
      <div class="dbg-queue"><b>EVENT_QUEUE</b> ${this.ui.state.eventQueue.length ? this.ui.state.eventQueue.map(q => `<code>${esc(q.id)} @ ${q.due}${q.matchDay ? ' (match day)' : ''}${q.from ? ' ← ' + esc(q.from) : ''}</code>`).join(' ') : '<i>empty</i>'}</div>
    </div>`;
  }

  cheat(id) {
    const ui = this.ui, s = ui.state, eng = ui.engine && !ui.engine.finished ? ui.engine : null;
    if (id === 'energy') {
      for (const p of s.squad) {
        p.dyn.condition = 100;
        if (eng?.energy.has(p.id)) { eng.energy.set(p.id, 100); eng.tired.delete(p.id); }
      }
      this.msg = L.t('dbg.doneEnergy', { n: s.squad.length });
    } else if (id === 'maxms') {
      for (const p of s.squad) { p.dyn.morale = 100; p.dyn.sharpness = 100; }
      this.msg = L.t('dbg.doneMs', { n: s.squad.length });
    } else if (id === 'force') {
      s.cheats = { ...(s.cheats || {}), forceWin: !s.cheats?.forceWin };
      this.msg = L.t('dbg.doneForce', { s: L.t(s.cheats.forceWin ? 'dbg.forceOn' : 'dbg.forceOff') })
        + (s.cheats.forceWin && eng ? ' ' + L.t('dbg.forceLive') : '');
    } else if (id === 'autosim') {   // v2.5: the old non-stop calendar (Match Practice on training days)
      if (eng || ui.events.active || ui.cal.running || s.phase !== 'calendar') { this.msg = L.t('dbg.busy'); this.render(); return; }
      this.close(); ui.autoSim(); return;
    } else if (id === 'ap') {
      s.weekState().ap++;   // v3.13: weekly wallet
      this.msg = L.t('dbg.doneAp', { n: s.ap });
    } else if (id === 'world') {   // v3.14: dev tool — force (or clear) this week's school / city event
      const e = s.forceWorldEvent(document.getElementById('dbg-world')?.value || null);
      this.msg = L.t('dbg.doneWorld', { e: e ? L.t('world.name.' + e.id) + ' · ' + e.days.join(', ') : L.t('dbg.worldNone') });
      if (ui.planner?.isOpen) ui.planner.render();
    } else if (id === 'money') {
      s.addMoney(500);
      this.msg = L.t('dbg.doneMoney', { b: money(s.budget) });
    } else if (id === 'events') {
      ui.events.enabled = !ui.events.enabled;
      s.excusesOff = !ui.events.enabled;   // v2.8: morning requests follow the same switch
      this.msg = L.t('dbg.events') + ': ' + L.t(ui.events.enabled ? 'dbg.forceOn' : 'dbg.forceOff');
    } else if (id.startsWith('fire:')) {
      if (eng || ui.events.active || ui.cal.running) { this.msg = L.t('dbg.busy'); this.render(); return; }
      this.close();
      ui.events.fire(id.slice(5));
      return;
    }
    s.save();
    ui.renderAll();
    if (eng) ui.renderLive(eng);
    this.render();
  }
}
