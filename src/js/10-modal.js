/* =========================================================
   MODAL — retro in-game dialog (no native alert/confirm anywhere)
   ========================================================= */
class Modal {
  static ICONS = { info: 'i', warn: '!', error: '\u00d7', ok: '\u2713', match: '\u26bd' };
  constructor() {
    this.layer = document.getElementById('modal-layer');
    this.titleEl = document.getElementById('modal-title');
    this.textEl = document.getElementById('modal-text');
    this.iconEl = document.getElementById('modal-ico');
    this.btnsEl = document.getElementById('modal-btns');
    document.getElementById('modal-x').addEventListener('click', () => this.close());
    this.layer.addEventListener('mousedown', e => { if (e.target === this.layer) this.close(); });
    document.addEventListener('keydown', e => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.close(); }
      if (e.key === 'Tab') {   // keep focus inside the dialog
        const f = [...this.layer.querySelectorAll('button')];
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    }, true);
  }
  get isOpen() { return !this.layer.hidden; }
  /** buttons: [{ label, primary, onClick }] */
  show({ title, html, icon = 'info', buttons }) {
    buttons = buttons?.length ? buttons : [{ label: L.t('ui.ok'), primary: true }];
    this.titleEl.textContent = title;
    this.textEl.innerHTML = html;
    this.iconEl.className = 'dlg-ico ' + icon;
    this.iconEl.textContent = Modal.ICONS[icon] || 'i';
    this.btnsEl.innerHTML = '';
    let primary = null;
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'btn' + (b.primary ? ' go' : '');
      el.innerHTML = b.label;
      el.addEventListener('click', () => { this.close(); b.onClick?.(); });
      this.btnsEl.appendChild(el);
      if (b.primary) primary = el;
    }
    this.lastFocus = document.activeElement;
    this.layer.hidden = false;
    (primary || this.btnsEl.firstChild).focus();
  }
  close() {
    if (!this.isOpen) return;
    this.layer.hidden = true;
    if (this.lastFocus && document.contains(this.lastFocus)) this.lastFocus.focus();
  }
}

