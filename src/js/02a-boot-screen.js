/* =========================================================
   v2.1 — BOOT / LOADING SCREEN (atmospheric startup)
   Static markup (#loading-overlay) is the FIRST thing in <body>, so it is visible before any script runs.
   Two scenes over one progress bar: credits art (assets/boot-credits.webp, CSS chrome text as fallback)
   → pixel game logo with sparks. The bar fills in 5–8 s (random), a fake loading phase changes every second,
   then the overlay fades out. Click / any key skips it; `?noboot` in the URL disables it (tests).
   ========================================================= */
const PixelFont = (() => {
  // 5x7 bitmap glyphs, one string per row ('#' = pixel)
  const G = {
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'], D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'], F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'], H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'], J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
    K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'], L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'], N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'], R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'], T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'], X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'], Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'], 1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'], 3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'], 5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'], 7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'], 9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
    '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'], '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  };
  let uid = 0;
  /** Chrome-and-blood pixel text (silver top → red bottom, dark 3D extrude), as one SVG. */
  return {
    svg(text, { cls = '' } = {}) {
      const chars = [...text.toUpperCase()].map(c => G[c] || G[' ']);
      const w = chars.length * 6 - 1, id = 'pf' + (++uid);
      let d = '';
      chars.forEach((g, i) => g.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') d += `M${i * 6 + x} ${y}h1v1h-1z`; })));
      return `<svg class="pixel-text ${cls}" viewBox="-0.5 -0.5 ${w + 1.6} 8.6" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" aria-label="${esc(text)}" role="img">`
        + `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f6fa"/><stop offset=".42" stop-color="#9aa3b0"/>`
        + `<stop offset=".5" stop-color="#e9edf2"/><stop offset=".56" stop-color="#b8242a"/><stop offset="1" stop-color="#4e0b10"/></linearGradient></defs>`
        + `<path d="${d}" fill="#08090c" transform="translate(.9 .9)"/><path d="${d}" fill="#2a1a20" transform="translate(.45 .45)"/>`
        + `<path d="${d}" fill="url(#${id})"/></svg>`;
    },
  };
})();

const BootScreen = {
  MIN_MS: 5000, MAX_MS: 8000, PHASE_MS: 1000,
  el: null, done: false,
  start() {
    this.el = document.getElementById('loading-overlay');
    if (!this.el) return;
    if (/[?&]noboot\b/.test(location.search)) { this.el.remove(); this.done = true; return; }
    this.duration = rnd(this.MIN_MS, this.MAX_MS);
    this.t0 = performance.now();
    this.$ = s => this.el.querySelector(s);
    this.$('.boot-logo').innerHTML = PixelFont.svg('Youth Academy', { cls: 'l1' }) + PixelFont.svg('Manager', { cls: 'l2' });
    this.$('.boot-ver').textContent = `v${APP_VERSION}  ·  ACADEMY 98`;
    this.$('.boot-skip').textContent = L.t('boot.skip');
    const art = new Image();   // credits art: if the asset is missing, the CSS chrome fallback stays visible
    art.onload = () => this.el.classList.add('has-art');
    art.src = 'assets/boot-credits.webp';
    this.sparks();
    this.phases = shuffle(I18N[L.code]['boot.phases'] || I18N.en['boot.phases']);
    this.phase(0);
    this.skip = () => this.finish();
    addEventListener('keydown', this.skip, true);
    this.el.addEventListener('click', this.skip);
    this.raf = requestAnimationFrame(() => this.frame());
  },
  phase(i) {
    const list = [...this.phases.slice(0, Math.ceil(this.duration / this.PHASE_MS) - 1), L.t('boot.ready')];
    this.$('.boot-phase').textContent = '> ' + list[Math.min(i, list.length - 1)];
    this.phaseIdx = i;
  },
  frame() {
    if (this.done) return;
    const t = Math.min(1, (performance.now() - this.t0) / this.duration);
    const k = t < 1 ? Math.floor(t * 40) / 40 : 1;   // the bar moves in chunky steps, like an old installer
    this.$('.boot-fill').style.width = (k * 100) + '%';
    const cells = 24, on = Math.round(k * cells);
    this.$('.boot-ascii').textContent = `[${'|'.repeat(on)}${' '.repeat(cells - on)}] ${String(Math.round(k * 100)).padStart(3)}%`;
    const p = Math.floor((performance.now() - this.t0) / this.PHASE_MS);
    if (p !== this.phaseIdx) this.phase(p);
    this.el.classList.toggle('scene-b', t > 0.42);   // credits → game logo
    if (t >= 1) { this.phase(99); setTimeout(() => this.finish(), 350); return; }
    this.raf = requestAnimationFrame(() => this.frame());
  },
  sparks() {
    const box = this.$('.boot-sparks');
    box.innerHTML = Array.from({ length: 26 }, () => {
      const x = rnd(8, 92), y = rnd(30, 70), dx = rnd(-60, 60), dy = rnd(-90, -20), d = (Math.random() * 2.2 + 1.2).toFixed(2), dl = (Math.random() * 3).toFixed(2);
      return `<i style="left:${x}%;top:${y}%;--dx:${dx}px;--dy:${dy}px;animation-duration:${d}s;animation-delay:-${dl}s"></i>`;
    }).join('');
  },
  finish() {
    if (this.done) return;
    this.done = true;
    cancelAnimationFrame(this.raf);
    removeEventListener('keydown', this.skip, true);
    this.elapsed = performance.now() - this.t0;
    this.el.classList.add('fade');
    setTimeout(() => { this.el.remove(); document.dispatchEvent(new Event('yam:booted')); }, 800);
  },
};
