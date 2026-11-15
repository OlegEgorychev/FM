/* =========================================================
   v3.20 — AFTER_GAME.EXE "After the game": a win gives strength (REVIEW.EXE), a loss gives understanding.
   Loss: 3 remark cards (2 kids + maybe a parent), the coach listens to 1 → a 🗣 clue with HIDDEN reliability (GameState.afterPick),
         then one free rethink of that kid's roles (remove / swap / give / keep). "Not now, go home" = Squad −1.
   Draw: one small choice — Praise (the v3.19 REVIEW draw mode, ReviewView.open) or Listen (1 random remark, no rethink).
   No OK / × button, Esc does nothing (Escape manager: close null); the lead line is typed and every choice waits for it (v3.17 rule:
   click the text, Space or Enter = finish typing). Opened by UIController.closeMatchday() before REVIEW; the matchday stays open.
   ========================================================= */
class AfterGameView {
  constructor(ui) {
    this.ui = ui;
    this.layer = document.getElementById('after-view');
    this.typer = null;
    this.layer.addEventListener('click', e => {
      if (this.typer) { if (e.target.closest('#af-lead')) this.finishTyping(); return; }   // no choice until the line is typed
      const b = e.target.closest('button[data-act]');
      if (!b || b.disabled) return;
      const s = this.state, a = b.dataset.act;
      let ok = false;
      if (a === 'pick') ok = s.afterPick(+b.dataset.i);
      else if (a === 'skip') ok = s.afterSkip();
      else if (a === 'praise') ok = s.afterPraise();
      else if (a === 'listen') ok = s.afterListen();
      else if (a === 'rethink') ok = s.afterRethink(b.dataset.do, b.dataset.role || null, b.dataset.to || null);
      if (!ok) return;
      if (s.afterPending) this.render(); else this.done();
      this.ui.renderBudget?.();
    });
    document.addEventListener('keydown', e => {
      if (!this.isOpen || !this.typer || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault(); e.stopImmediatePropagation(); this.finishTyping();
    }, true);
  }
  get isOpen() { return !this.layer.hidden; }
  get state() { return this.ui.state; }

  /** The one entry point. Returns false when nothing is owed. */
  open() {
    if (!this.state.afterPending) { this.layer.hidden = true; return false; }
    this.ui.modal.close(); this.ui.profile.close();
    this.layer.hidden = false;
    this.render();
    return true;
  }
  close() { if (!this.state.afterPending) { this.finishTyping(); this.layer.hidden = true; } }
  /** A choice ended the talk → on with the evening (REVIEW after "Praise", else the matchday closes). */
  done() { this.finishTyping(); this.layer.hidden = true; this.ui.closeMatchday(); }

  /* ---------- typewriter (v3.17 rule: buttons inactive until the text is typed) ---------- */
  type(text) {
    const el = document.getElementById('af-lead');
    clearInterval(this.typer); this.full = text;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !text) { el.textContent = text; this.typer = null; this.setWaiting(false); return; }
    let n = 0; el.textContent = ''; this.setWaiting(true);
    this.typer = setInterval(() => { n += 2; el.textContent = text.slice(0, n); if (n >= text.length) this.finishTyping(); }, 16);
  }
  finishTyping() {
    const was = !!this.typer;
    clearInterval(this.typer); this.typer = null;
    const el = document.getElementById('af-lead'); if (el && this.full != null) el.textContent = this.full;
    if (was || this.layer.classList.contains('af-typing')) this.setWaiting(false);
  }
  setWaiting(on) {
    this.layer.classList.toggle('af-typing', on);
    this.layer.querySelectorAll('button[data-act]').forEach(b => { b.disabled = on || b.dataset.off === '1'; });
    if (!on) this.layer.querySelector('button[data-act]:not([disabled])')?.focus();
  }

  /* ---------- drawing ---------- */
  /** Bold one-line gist (no hint at reliability) + the full remark in smaller text + the speaker's portrait. */
  static remarkKey(rm) { return rm.type === 'other' && rm.kind === 'misfit' ? 'otherMisfit' : rm.type; }
  remarkVars(rm) {
    const s = this.state, kid = s.player(rm.pid), about = s.player(rm.about);
    return { k: esc(L.name(kid.name)), t: esc(L.name(about.name)), s: rm.signal ? L.t('af.sig.' + rm.signal) : '', r: rm.role ? esc(L.tag(rm.role)) : '',
      w: rm.parent ? L.t('af.who.' + rm.parent, { k: esc(L.name(kid.name)) }) : esc(L.name(kid.name)) };
  }
  cardHTML(rm, i) {
    const s = this.state, kid = s.player(rm.pid);
    if (!kid) return '';
    const v = this.remarkVars(rm), key = AfterGameView.remarkKey(rm);
    return `<button type="button" class="af-card${rm.parent ? ' parent' : ''}" data-act="pick" data-i="${i}">
      <span class="af-who"><span class="portrait sm" data-pid="${kid.id}">${kid.portraitSvg}</span>${rm.parent ? `<span class="af-name">${v.w}</span>` : ''}</span>
      <b class="af-gist">${L.t('af.gist.' + key, v)}</b>
      <span class="af-say">${L.t('af.say.' + key + '.' + (rm.phr % AFTER.PHRASES), v)}</span>
    </button>`;
  }
  kidHTML(p) {
    const roles = rolesOf(p), clues = [...(p.clues || [])].reverse().slice(0, CLUES.TIP);
    return `<span class="portrait lg" data-pid="${p.id}">${p.portraitSvg}</span>
      <h3><span class="num dark">${p.number}</span>${esc(L.name(p.name))}</h3>
      <fieldset class="rv-roles"><legend>${L.t('rv.roles', { a: roles.length, b: ROLES.SLOTS })}</legend>
        ${roles.length ? roles.map(r => this.ui.tagChip(r.id, p.id, false)).join('') : `<span class="pi-none">${L.t('rv.noRole')}</span>`}</fieldset>
      <fieldset class="rv-clues nb-clues"><legend>${L.t('rv.clues')}</legend>
        ${clues.length ? `<ul>${clues.map(c => this.ui.clueLine(p, c)).join('')}</ul>` : `<p class="pi-none">${L.t('nb.cluesNone')}</p>`}</fieldset>`;
  }
  rethinkHTML(p) {
    const o = this.state.rethinkOptions(p), btn = (act, label, role, to) =>
      `<button type="button" class="btn af-re" data-act="rethink" data-do="${act}"${role ? ` data-role="${role}"` : ''}${to ? ` data-to="${to}"` : ''}>${label}</button>`;
    const lvl = id => rolesOf(p).find(r => r.id === id)?.level || 1;
    const grp = (title, items) => items.length ? `<fieldset class="af-grp"><legend>${title}</legend>${items.join('')}</fieldset>` : '';
    return grp(L.t('af.re.removeH'), o.remove.map(id => btn('remove', L.t('af.re.remove', { r: esc(L.tag(id)) }), id)))
      + grp(L.t('af.re.swapH'), o.swap.map(x => btn('swap', L.t('af.re.swap', { r: esc(L.tag(x.from)), o: esc(L.tag(x.to)), l: Math.max(1, lvl(x.from) - 1) }), x.from, x.to)))
      + grp(L.t('af.re.giveH'), o.give.map(id => btn('give', L.t('af.re.give', { r: esc(L.tag(id)) }), null, id)))
      + `<div class="af-keep">${btn('keep', L.t('af.re.keep'))}</div>`;
  }
  render() {
    const s = this.state, af = s.after;
    if (!af) return;
    const rep = s.lastReport, kidBox = document.getElementById('af-kid'), body = document.getElementById('af-body'), foot = document.getElementById('af-foot');
    const score = { x: rep?.gf ?? 0, y: rep?.ga ?? 0 };
    this.layer.dataset.mode = af.mode + (af.stage === 'rethink' ? '-re' : '');
    document.getElementById('af-title').textContent = L.t('af.title');
    let lead, status;
    if (af.mode === 'draw') {
      kidBox.hidden = true;
      lead = L.t('af.lead.draw', score);
      body.innerHTML = `<div class="af-choice">
        <button type="button" class="af-opt" data-act="praise"><b>${L.t('af.praise')}</b><span>${L.t('af.praise.d')}</span></button>
        <button type="button" class="af-opt" data-act="listen"><b>${L.t('af.listen')}</b><span>${L.t('af.listen.d')}</span></button></div>`;
      foot.innerHTML = ''; status = L.t('af.status.draw');
    } else if (af.stage === 'rethink') {
      const p = s.afterKid;
      kidBox.hidden = false; kidBox.innerHTML = p ? this.kidHTML(p) : '';
      lead = L.t('af.lead.rethink', { k: p ? L.name(p.name) : '' });
      body.innerHTML = p ? `<div class="af-rethink">${this.rethinkHTML(p)}</div>` : '';
      foot.innerHTML = ''; status = L.t('af.status.rethink');
    } else {
      kidBox.hidden = true;
      lead = L.t(af.mode === 'listen' ? 'af.lead.listen' : 'af.lead.loss', score);
      body.innerHTML = `<div class="af-cards" style="--af-n:${af.remarks.length}">${af.remarks.map((rm, i) => this.cardHTML(rm, i)).join('')}</div>`;
      foot.innerHTML = af.mode === 'loss' ? `<button type="button" class="btn" data-act="skip" title="${esc(L.t('af.skipTip'))}">${L.t('af.skip')}</button>` : '';
      status = L.t(af.mode === 'listen' ? 'af.status.listen' : 'af.status.loss');
    }
    document.getElementById('af-status').textContent = status;
    this.type(lead);
  }
}
