/* =========================================================
   v3.26 HOLST — SCALED CANVAS
   The whole UI (#screen) is laid out on a logical canvas H = 900 px tall and W = 1440…2048 px wide, then scaled
   as one picture: scale = min(innerHeight / 900, innerWidth / 1440), W = min(innerWidth / scale, 2048).
   CSS `zoom` where supported (layout measures stay in logical px), else transform: scale() from the top-left.
   The boot screen (#loading-overlay) sits outside #screen and is never scaled.
   CSS reads --cv-w / --cv-h (logical canvas size) and --vh (1 % of the canvas height) instead of vw/vh.
   ========================================================= */
const Canvas = {
  H: 900, MIN_W: 1440, MAX_W: 2048, MARGIN: 6,   // MARGIN: physical px around the CRT bezel (letterbox = body background)
  scale: 1, W: 1440, mode: 'zoom',
  init() {
    this.el = document.getElementById('screen');
    if (!this.el) return;
    this.mode = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('zoom', '1') ? 'zoom' : 'transform';
    document.documentElement.classList.add('cv-' + this.mode);
    this.fit();
    let t = 0;
    addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => this.fit(), 60); });
  },
  fit() {
    const m = this.MARGIN, vw = Math.max(320, innerWidth - 2 * m), vh = Math.max(240, innerHeight - 2 * m);
    const s = Math.min(vh / this.H, vw / this.MIN_W);
    const W = Math.round(Math.min(vw / s, this.MAX_W));
    const left = (innerWidth - W * s) / 2, top = (innerHeight - this.H * s) / 2;
    const st = this.el.style, root = document.documentElement.style;
    this.scale = s; this.W = W;
    root.setProperty('--cv-w', W + 'px'); root.setProperty('--cv-h', this.H + 'px'); root.setProperty('--cv-scale', String(s));
    st.width = W + 'px'; st.height = this.H + 'px';
    if (this.mode === 'zoom') {   // zoom also scales the element's own left/top → give them in logical px
      st.zoom = String(s); st.transform = ''; st.left = left / s + 'px'; st.top = top / s + 'px';
    } else {
      st.zoom = ''; st.transformOrigin = '0 0'; st.transform = `scale(${s})`; st.left = left + 'px'; st.top = top + 'px';
    }
  },
};
Canvas.init();
