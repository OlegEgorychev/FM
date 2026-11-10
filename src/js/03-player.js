/* =========================================================
   PORTRAIT GENERATOR (v1.4) — procedural 32x32 pixel-art "paper doll".
   A face is 7 trait indices; layers are plain [x, y, w, h] rect lists.
   ========================================================= */
const PortraitGenerator = (() => {
  const BG    = ['#22282a', '#28252e', '#252b24', '#2c2823'];                         // wet dusk
  const SKIN  = ['#e3c4a6', '#d0a581', '#b48364', '#8a5d42', '#5c3d2b'];
  const HAIRC = ['#1d1b19', '#4a3324', '#a8905c', '#7f3b25'];                         // black, brown, blonde, red
  const KIT   = { home: '#3a5d8f', away: '#8f3b33', gk: '#7d7b34' };                  // muted club colours
  const HEAD  = [                                                                    // round, square, long
    [[11, 8, 10, 1], [10, 9, 12, 12], [11, 21, 10, 1], [13, 22, 6, 1]],
    [[10, 8, 12, 14], [12, 22, 8, 1]],
    [[11, 7, 10, 1], [10, 8, 12, 13], [11, 21, 10, 2], [13, 23, 6, 1]],
  ];
  const EYES  = [                                                                    // [brows], [eyes], [bags]
    [[[12, 12, 2, 1], [18, 12, 2, 1]], [[12, 14, 2, 1], [18, 14, 2, 1]], []],            // neutral
    [[[12, 12, 2, 1], [18, 12, 2, 1]], [[12, 14, 2, 1], [18, 14, 2, 1]], [[12, 15, 2, 1], [18, 15, 2, 1]]], // tired
    [[[11, 12, 2, 1], [13, 13, 1, 1], [19, 12, 2, 1], [18, 13, 1, 1]], [[12, 14, 2, 1], [18, 14, 2, 1]], []], // angry
  ];
  const MOUTH = [[[14, 18, 4, 1]], [[14, 18, 3, 1], [17, 17, 1, 1]], [[13, 17, 6, 2]]]; // neutral, smirk, grit
  const HAIR  = [                                                                    // messy, short, long, bald
    [[9, 5, 14, 4], [9, 9, 2, 4], [21, 9, 2, 3], [11, 4, 2, 1], [16, 4, 3, 1], [14, 9, 2, 1], [18, 9, 1, 1]],
    [[10, 6, 12, 3], [10, 9, 1, 3], [21, 9, 1, 3]],
    [[9, 5, 14, 4], [9, 9, 2, 13], [21, 9, 2, 13], [11, 9, 2, 1]],
    [[10, 9, 1, 2], [21, 9, 1, 2]],
  ];
  const SIZES = [BG.length, HEAD.length, SKIN.length, EYES.length, MOUTH.length, HAIR.length, HAIRC.length];
  const dark = (hex, f) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0')).join('');
  const rects = (list, fill, op = '') => list.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join('')
    .replace(/^/, `<g fill="${fill}"${op ? ` opacity="${op}"` : ''}>`) + '</g>';
  /** Deterministic fallback for saves made before v1.4 (same kid keeps the same face). */
  const hashFace = str => { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    return SIZES.map(n => { h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0; return h % n; }); };

  return {
    roll: () => SIZES.map(n => Math.floor(Math.random() * n)),
    valid: f => Array.isArray(f) && f.length === SIZES.length && f.every((v, i) => Number.isInteger(v) && v >= 0 && v < SIZES[i]),
    hashFace,
    svg([bg, head, skin, eyes, mouth, hair, hairC], kit = 'home') {
      const s = SKIN[skin], sd = dark(s, 0.78), hc = HAIRC[hairC], j = KIT[kit] || KIT.home;
      const rain = [0, 1, 2, 3].map(i => [(bg * 7 + i * 9 + head * 5) % 30 + 1, (i * 11 + skin * 3) % 20 + 1, 1, 2]);
      const [brows, eye, bags] = EYES[eyes];
      return `<svg class="portrait-svg" viewBox="0 0 32 32" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
        + `<rect width="32" height="32" fill="${BG[bg]}"/>` + rects(rain, '#9fb2bf', '.18')
        + rects([[5, 27, 22, 5], [7, 25, 18, 2]], j) + rects([[5, 30, 22, 2], [7, 25, 2, 2]], dark(j, 0.7))       // shoulders/jersey
        + rects([[13, 21, 6, 5]], sd) + rects([[14, 25, 4, 1]], dark(j, 0.55))                                  // neck + collar
        + rects([...HEAD[head], [9, 13, 1, 3], [22, 13, 1, 3]], s) + rects([[21, 10, 1, 10], [16, 15, 1, 2]], sd) // head, ears, shade, nose
        + rects(bags, sd) + rects(eye, '#15120f') + rects(brows, dark(hc, 0.85))                                  // eyes / brows
        + rects(MOUTH[mouth], mouth === 2 ? '#2a1a16' : dark(s, 0.55)) + (mouth === 2 ? rects([[14, 17, 4, 1]], '#cfc6b0') : '')
        + rects(HAIR[hair], hc, hair === 3 ? '.55' : '')
        + '</svg>';
    },
  };
})();

/* =========================================================
   PLAYER
   ========================================================= */
class Player {
  constructor({ id, name, position, attrs, tags, energy, number, face }) {
    this.id = id;
    this.name = name;
    this.position = position;
    this.number = number;
    this.attrs = attrs;              // HIDDEN — never rendered
    if (tags) {                      // only the academy squad carries tags + energy
      this.tags = tags;
      this.energy = energy ?? 100;
    }
    this.face = PortraitGenerator.valid(face) ? face : PortraitGenerator.hashFace(id + name);
    this.portraitSvg = PortraitGenerator.svg(this.face, position === 'GK' ? 'gk' : tags ? 'home' : 'away');
  }
  get surname() { return this.name.split(' ').slice(-1)[0]; }
  /** The SVG is rebuilt from `face` on load, so saves only keep the 7 indices. */
  toJSON() { const { portraitSvg, ...o } = this; return o; }

  static generate(id, position, usedSurnames, mod = 0, withTags = false, number = 0) {
    let last; let guard = 0;
    do { last = pick(LAST); } while (usedSurnames.has(last) && guard++ < 200);
    usedSurnames.add(last);
    const attrs = {};
    for (const a of ATTRS) { const [lo, hi] = PROFILES[position][a]; attrs[a] = clamp(rnd(lo, hi) + mod, 1, 20); }
    return new Player({ id, name: `${pick(FIRST)} ${last}`, position, attrs, number, tags: withTags ? [] : undefined, face: PortraitGenerator.roll() });
  }
}
