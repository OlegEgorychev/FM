/* =========================================================
   RADAR VIEW — static tactics board (click / drag dots). The live match uses MatchView below.
   Coordinates are % of the pitch. Home attacks left -> right.
   ========================================================= */
class RadarView {
  static LINES = `
    <div class="pl-line half"></div><div class="pl-line third t1"></div><div class="pl-line third t2"></div>
    <div class="pl-line circle"></div><div class="pl-line spot"></div>
    <div class="pl-line box l"></div><div class="pl-line box r"></div>
    <div class="pl-line six l"></div><div class="pl-line six r"></div>
    <div class="pl-goal l"></div><div class="pl-goal r"></div>`;

  constructor(el, { labels = false, onDotClick = null, onDrop = null } = {}) {
    this.el = el;
    this.labels = labels;
    this.onDotClick = onDotClick;
    this.onDrop = onDrop;
    this.dots = new Map();
    this.ball = null;
    this.lastSeq = -1;
  }

  /** sides: [{ entries: [{p, x, y, line}] }, ...]  (index 0 = home/blue, 1 = away/red) */
  setup(sides, { board = false } = {}) {
    this.el.innerHTML = RadarView.LINES;
    this.dots.clear();
    this.lastSeq = -1;
    sides.forEach((side, si) => side.entries.forEach((e, idx) => {
      const d = document.createElement(this.onDotClick ? 'button' : 'div');
      d.className = `pl ${si === 0 ? 'home' : 'away'}${e.line === 'GK' ? ' gk' : ''}`;
      d.innerHTML = `<b>${e.p.number ?? idx + 1}</b>${this.labels ? `<span class="pl-pos ${e.p.position}">${L.pos(e.p.position)}</span><span class="pl-nm">${esc(L.name(e.p.surname))}</span>` : ''}`;
      d.title = `${L.name(e.p.name)} · ${L.line(e.line === 'GK' ? 'GK' : e.line)}`;
      d.dataset.pid = e.p.id;   // v1.5: right-click → Player Profile Card
      if (this.onDotClick) { d.type = 'button'; d.dataset.slot = idx; d.addEventListener('click', () => this.onDotClick(idx)); }
      if (this.onDrop) {
        d.draggable = true;
        d.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/plain', e.p.id); ev.dataTransfer.effectAllowed = 'move'; });
        d.addEventListener('dragover', ev => { ev.preventDefault(); d.classList.add('drop-over'); });
        d.addEventListener('dragleave', () => d.classList.remove('drop-over'));
        d.addEventListener('drop', ev => { ev.preventDefault(); d.classList.remove('drop-over'); this.onDrop(idx, ev.dataTransfer.getData('text/plain')); });
      }
      this.el.appendChild(d);
      // base position (away mirrored); the tactics board spreads the shape over the whole pitch
      const bx = board ? (e.line === 'GK' ? 5 : 5 + (e.x - 5) * 1.9) : e.x;
      const base = si === 0 ? { x: bx, y: e.y } : { x: 100 - bx, y: 100 - e.y };
      this.dots.set(e.p.id, { el: d, base, side: si });
      this.place(d, base.x, base.y);
    }));
    if (!board) {
      this.ball = document.createElement('div');
      this.ball.className = 'ball';
      this.el.appendChild(this.ball);
      this.place(this.ball, 50, 50);
    } else this.ball = null;
  }

  place(el, x, y) { el.style.left = x + '%'; el.style.top = y + '%'; }
  select(id) { this.highlight(id); }
  /** sel = the chosen player; clsFor(id) returns 'suggested-swap' | 'dimmed-swap' | '' for every other dot. */
  highlight(selId, clsFor) {
    for (const [pid, d] of this.dots) {
      d.el.classList.toggle('sel', pid === selId);
      d.el.classList.remove('suggested-swap', 'dimmed-swap');
      const c = selId && clsFor ? clsFor(pid) : '';
      if (c) d.el.classList.add(c);
    }
  }
}

