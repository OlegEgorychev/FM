/* =========================================================
   v3.19 — REVIEW.EXE: the pick after a win (Vampire Survivors style)
   The man of the match (best matchRating among our kids who played) gets 1 of 3 cards: a new role (free slot),
   +1 level of a role he has, or a replacement (slots full). Draw = the smaller pick (2 cards, no reroll, no mark).
   No OK / × button and Esc does nothing: the window closes only through a card, [ Skip ] (morale +2).
   [ Reroll ] 1 AP once (win only), [ Banish ] one role from HIS pool for the season, once (no refill).
   Opened by UIController.closeMatchday() — the stop after summary → Coach's Word → Notebook, before the next day.
   open(mode) is the single entry point; v3.20 can put the "listen" option / "After the game" in front of it.
   ========================================================= */
class ReviewView {
  constructor(ui) {
    this.ui = ui;
    this.layer = document.getElementById('review-view');
    this.cards = document.getElementById('rv-cards');
    this.cards.addEventListener('click', e => {
      const ban = e.target.closest('[data-ban]'), pick = e.target.closest('[data-pick]');
      if (ban && !ban.disabled) { if (this.state.reviewBanish(+ban.dataset.ban)) this.render(); return; }
      if (pick && !pick.disabled && this.state.reviewPick(+pick.dataset.pick)) this.done();
    });
    document.getElementById('rv-reroll').addEventListener('click', () => { if (this.state.reviewReroll()) { this.render(); this.ui.renderBudget?.(); } });
    document.getElementById('rv-skip').addEventListener('click', () => { if (this.state.reviewSkip()) this.done(); });
  }
  get isOpen() { return !this.layer.hidden; }
  get state() { return this.ui.state; }

  /** The one entry point (mode comes from the saved review: 'win' | 'draw'). Returns false when nothing is owed. */
  open() {
    if (!this.state.reviewPending) { this.layer.hidden = true; return false; }
    this.ui.modal.close(); this.ui.profile.close();
    this.render();
    this.layer.hidden = false;
    this.cards.querySelector('[data-pick]')?.focus();
    return true;
  }
  /** Only the state can close it (a choice was made). */
  close() { if (!this.state.reviewPending) this.layer.hidden = true; }
  done() { this.layer.hidden = true; this.ui.closeMatchday(); }

  /** Level pips: ●●○ (level 0 = ○○○). */
  static pips(level) { return '●'.repeat(level) + '○'.repeat(Math.max(0, ROLES.LEVELS - level)); }

  render() {
    const s = this.state, rv = s.review, p = rv && s.player(rv.pid);
    if (!p) return;
    const ui = this.ui, name = esc(L.name(p.name)), win = rv.mode === 'win';
    const roles = rolesOf(p);
    const clues = [...(p.clues || [])].reverse().slice(0, CLUES.TIP);
    document.getElementById('rv-kid').innerHTML = `
      <span class="portrait lg" data-pid="${p.id}">${p.portraitSvg}</span>
      <h3><span class="num dark">${p.number}</span>${name}</h3>
      <div class="rv-pos"><span class="pos ${p.position || 'none'}">${L.pos(p.position)}</span> <span class="rv-rating">${L.t('rv.rating', { r: rv.rating.toFixed(1) })}</span></div>
      <fieldset class="rv-roles"><legend>${L.t('rv.roles', { a: roles.length, b: ROLES.SLOTS })}</legend>
        ${roles.length ? roles.map(r => ui.tagChip(r.id, p.id, false)).join('') : `<span class="pi-none">${L.t('rv.noRole')}</span>`}</fieldset>
      <fieldset class="rv-clues nb-clues"><legend>${L.t('rv.clues')}</legend>
        ${clues.length ? `<ul>${clues.map(c => ui.clueLine(p, c)).join('')}</ul>` : `<p class="pi-none">${L.t('nb.cluesNone')}</p>`}</fieldset>`;
    document.getElementById('rv-lead').innerHTML = L.t(win ? 'rv.lead.win' : 'rv.lead.draw', { k: name, n: rv.cards.length });
    this.cards.style.setProperty('--rv-n', Math.max(2, rv.cards.length));
    this.cards.innerHTML = rv.cards.length ? rv.cards.map((c, i) => {
      const lvl = c.type === 'up' ? p.roleLevel(c.role) + 1 : 1, def = ROLE_BY_ID[c.role];
      const banWhy = c.type === 'up' ? L.t('rv.banHeld') : rv.banished ? L.t('rv.banUsed') : L.t('rv.banTip', { r: L.tag(c.role) });
      return `<div class="rv-card t-${c.type} tone-${def.tone}${c.like ? ' like' : ''}">
        <button type="button" class="rv-pick" data-pick="${i}">
          <small class="rv-type">${L.t('rv.type.' + c.type)}</small>
          <b class="rv-name">${esc(L.tag(c.role))}</b>
          <span class="rv-pips" aria-label="${esc(L.t('rv.level', { l: lvl }))}">${ReviewView.pips(lvl)}</span>
          ${c.type === 'swap' ? `<em class="rv-repl">${L.t('rv.replaces', { r: esc(L.tag(c.replaces)) })}</em>` : ''}
          <span class="rv-desc">${esc(L.tagDesc(c.role))}</span>
          ${c.like ? `<i class="rv-like">✎ ${L.t('rv.like')}</i>` : ''}
        </button>
        <button type="button" class="rv-ban" data-ban="${i}" ${c.type === 'up' || rv.banished ? 'disabled' : ''} title="${esc(banWhy)}">&#10005; ${L.t('rv.ban')}</button>
      </div>`;
    }).join('') : `<p class="rv-empty">${L.t('rv.empty')}</p>`;
    const rr = document.getElementById('rv-reroll');
    rr.hidden = !win;
    rr.disabled = !s.canReroll();
    rr.innerHTML = L.t('rv.reroll', { n: REVIEW.REROLL_AP });
    rr.title = rv.rerolled ? L.t('rv.rerollUsed') : s.ap < REVIEW.REROLL_AP ? L.t('rv.rerollNoAp') : L.t('rv.rerollTip', { a: s.ap });
    const sk = document.getElementById('rv-skip');
    sk.innerHTML = L.t('rv.skip', { n: REVIEW.SKIP_MORALE });
    sk.title = L.t('rv.skipTip');
    document.getElementById('rv-status').textContent = L.t('rv.status');
  }
}
