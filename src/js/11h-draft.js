/* =========================================================
   v3.1 — INTRO: THE YARD MATCH DRAFT ("#intro-draft-view")
   A new academy starts here: 30 free agents from the world database play a muddy yard tournament.
   The coach sees ONLY face, age, height, weight and up to 2 yard notes (v3.12, replaced the stars), and signs exactly 15.
   ========================================================= */
class DraftView {
  constructor(ui) {
    this.ui = ui;
    this.layer = document.getElementById('intro-draft-view');
    this.grid = document.getElementById('dr-grid');
    this.grid.addEventListener('click', e => {
      const b = e.target.closest('[data-sign]');
      if (!b || b.disabled) return;
      this.ui.state.toggleDraft(b.dataset.sign);
      this.render();
      this.askTwin(b.dataset.sign);   // v3.25: his twin is still on the board → his mum asks
    });
    document.getElementById('dr-start').addEventListener('click', () => this.start());
  }
  get isOpen() { return !this.layer.hidden; }
  /** v3.12: what the coach noticed in the mud (keys of YARD.TRAITS, or ['quiet']) — current strengths only, never the
      growth room; each note can be wrong (a random other trait). Seeded per kid, so it never changes on re-render / reload. */
  static notes(p) {
    const r = seeded('yard' + p.id), keys = Object.keys(YARD.TRAITS), out = [];
    const top = keys.map(k => ({ k, v: YARD.TRAITS[k](p) })).sort((a, b) => b.v - a.v || a.k.localeCompare(b.k)).filter(t => t.v >= YARD.SHOW).slice(0, YARD.MAX);
    for (const t of top) {
      let k = t.k;
      if (r() < YARD.WRONG) { const other = keys.filter(x => x !== t.k && !out.includes(x)); k = other[Math.floor(r() * other.length)]; }
      if (!out.includes(k)) out.push(k);
    }
    return out.length ? out : ['quiet'];
  }
  /** v3.25: "[Surname]'s mum: please take his brother too, they can't do things apart" — before the next pick. */
  askTwin(id) {
    const s = this.ui.state, t = s.draftTwinAsk(id);
    if (!t) return false;
    const p = s.globalPlayers.find(x => x.id === id);
    this.ui.modal.show({ title: L.t('draft.twin.title'), icon: 'info',
      html: `<p>${esc(L.t('draft.twin.text', { s: L.name(p.surname), k: L.name(p.name), b: L.name(t.name) }))}</p>`,
      buttons: [
        { label: L.t('draft.twin.take', { b: esc(L.name(t.name)) }), primary: true, onClick: () => { s.draftTwinAnswer(id, true); this.render(); } },
        { label: L.t('draft.twin.refuse'), onClick: () => { s.draftTwinAnswer(id, false); this.render(); } },
      ] });
    return true;
  }
  open() { this.render(); this.layer.hidden = false; }
  close() { this.layer.hidden = true; }
  render() {
    const s = this.ui.state;
    if (s.phase !== 'draft' || !s.draft) { this.close(); return; }
    const signed = s.draftSigned(), full = signed.length >= WORLD.DRAFT_SIGN;
    const pool = s.draft.pool.map(id => s.globalPlayers.find(p => p.id === id)).filter(Boolean);
    this.grid.innerHTML = pool.map(p => {
      const on = signed.includes(p.id), notes = DraftView.notes(p);
      const mate = notes.length < YARD.MAX || notes[0] === 'quiet' ? s.draftYardMate(p, s.draft.pool) : null;   // v3.25: counts towards YARD.MAX
      return `<div class="dr-card${on ? ' on' : ''}" data-pid="${p.id}">
        <span class="portrait dr-face">${p.portraitSvg}</span>
        <div class="dr-name">${esc(L.name(p.name))}</div>
        <dl class="dr-bio"><dt>${L.t('pi.age')}</dt><dd>${p.bio.age}</dd><dt>${L.t('pi.height')}</dt><dd>${L.t('pi.cm', { n: p.bio.height })}</dd>
          <dt>${L.t('pi.weight')}</dt><dd>${L.t('pi.kg', { n: p.bio.weight })}</dd></dl>
        <ul class="dr-notes" title="${esc(L.t('draft.notesTip'))}">${notes.filter(k => !(mate && k === 'quiet')).map(k => `<li class="${k === 'quiet' ? 'quiet' : ''}">${esc(L.t('yard.' + k))}</li>`).join('')}${mate ? `<li class="yardmate">${esc(L.t('draft.yardMate', { y: L.t('yard.street.' + kidRoots(p).yard), k: squadName(mate, pool) }))}</li>` : ''}</ul>
        <button type="button" class="dr-btn" data-sign="${p.id}"${!on && full ? ' disabled' : ''}>${L.t(on ? 'draft.release' : 'draft.sign')}</button>
      </div>`;
    }).join('');
    document.getElementById('dr-count').innerHTML = L.t('draft.count', { n: signed.length, m: WORLD.DRAFT_SIGN });
    document.getElementById('dr-count').classList.toggle('full', full);
    const btn = document.getElementById('dr-start');
    btn.disabled = !full;
    btn.innerHTML = L.t(full ? 'draft.start' : 'draft.startNeed', { n: WORLD.DRAFT_SIGN - signed.length });
  }
  start() {
    const ui = this.ui, s = ui.state;
    if (!s.finishDraft()) return;
    this.close();
    ui.cal.attach(s.calendar);
    ui.prepareMatch();
    ui.renderAll();
    ui.show('dash');
  }
}
