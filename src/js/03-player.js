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
    /** v1.9: anonymous adult (parents, officials): a dark backlit silhouette in a doorway. */
    silhouette(tie = '#5a2c28') {
      return `<svg class="portrait-svg" viewBox="0 0 32 32" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
        + `<rect width="32" height="32" fill="#2b2a24"/>` + rects([[7, 0, 18, 32]], '#4a4637') + rects([[8, 0, 16, 32]], '#6b6248', '.55')   // lit doorway
        + rects([[3, 6, 1, 2], [27, 14, 1, 2], [5, 22, 1, 2], [29, 3, 1, 2]], '#9fb2bf', '.18')
        + rects([[12, 5, 8, 1], [11, 6, 10, 9], [12, 15, 8, 1], [14, 16, 4, 3], [6, 19, 20, 2], [4, 21, 24, 11]], '#0b0c0d')       // head, neck, coat
        + rects([[11, 7, 1, 7], [5, 21, 1, 11], [26, 21, 1, 11]], '#3a4248', '.8')                                                // rim light
        + rects([[15, 19, 2, 1], [15, 20, 2, 7]], tie, '.9') + rects([[13, 19, 2, 3], [17, 19, 2, 3]], '#d8d2c0', '.35')          // tie + collar
        + '</svg>';
    },
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
   PLAYER (v1.8: nested attribute structure)
   bio       — age 13–15, height (cm), weight (kg), strongFoot L/R, weakFoot 1–5   (position stays on p.position)
   physical  — acceleration, speed, agility, strength, baseStamina          (1–20, HIDDEN)
   technical — firstTouch, dribbling, passing, crossing, shooting, tackling, goalkeeping (1–20, HIDDEN)
   tactical  — positioning, vision, decisions                               (1–20, HIDDEN)
   psych     — passion, discipline, composure (1–20) + potential (PA 1–100)  (HIDDEN)
   dyn       — condition (= energy), sharpness (match tone), morale         (0–100)
   ========================================================= */
const AttrGen = {
  /** Fresh roll. r = rng (Math.random or seeded), mod = club strength shift for skill groups. */
  roll(position, r = Math.random, mod = 0, age = null) {
    const P = PROFILES[position] || PROFILES.MID, out = {};
    for (const g of SKILL_KEYS) { out[g] = {}; for (const k of ATTR_GROUPS[g]) { const [lo, hi] = P[k]; out[g][k] = clamp(rndR(r, lo, hi) + mod, 1, 20); } }
    out.psych = { passion: rndR(r, 4, 18), discipline: rndR(r, 3, 18), composure: rndR(r, 3, 17),
      potential: clamp(Math.round(30 + (r() + r() + r()) / 3 * 65 + mod * 2), 1, 100) };   // bell-ish 30–95
    out.bio = AttrGen.bio(position, r, age, out.physical);
    return out;
  },
  bio(position, r, age, phys) {
    age = Number.isInteger(age) && age >= 13 && age <= 16 ? age : rndR(r, 13, 15);
    const height = Math.round(150 + (age - 13) * 6 + (position === 'GK' ? 5 : 0) + (r() - 0.5) * 20);
    const weight = Math.round(height * 0.45 - 22 + (phys ? (phys.strength - 10) * 0.6 : 0) + (r() - 0.5) * 8);
    const strongFoot = r() < 0.76 ? 'R' : 'L';
    const wf = r(); const weakFoot = wf < 0.30 ? 1 : wf < 0.68 ? 2 : wf < 0.88 ? 3 : wf < 0.97 ? 4 : 5;
    return { age, height, weight, strongFoot, weakFoot };
  },
  /** Saves made before v1.8 only have the 6 old attrs (Speed/Pass/Dribble/Shoot/Tackle/Save): derive stable values. */
  fromLegacy(position, a, seed, age) {
    const r = seeded(seed), j = v => clamp(Math.round(v + (r() - 0.5) * 4), 1, 20);
    const avg = (...x) => x.reduce((s, v) => s + v, 0) / x.length;
    const fresh = AttrGen.roll(position, r, 0, age);   // psych, bio, stamina come from the seed
    fresh.physical = { acceleration: j(a.Speed), speed: j(a.Speed), agility: j(avg(a.Speed, a.Dribble)),
      strength: j(avg(a.Tackle, 10)), baseStamina: fresh.physical.baseStamina };
    fresh.technical = { firstTouch: j(a.Dribble), dribbling: j(a.Dribble), passing: j(a.Pass), crossing: j(a.Pass - 1),
      shooting: j(a.Shoot), tackling: j(a.Tackle), goalkeeping: j(a.Save) };
    fresh.tactical = { positioning: j(position === 'GK' ? a.Save - 2 : a.Tackle), vision: j(a.Pass), decisions: j(avg(a.Pass, a.Tackle)) };
    return fresh;
  },
  validGroup(o, g) { return o && typeof o === 'object' && ATTR_GROUPS[g].every(k => Number.isFinite(o[k])); },
};

class Player {
  constructor(o) {
    const { id, name, position, tags, number, face } = o;
    this.id = id;
    this.name = name;
    this.position = position;
    this.number = number;
    if (tags) {                      // only the academy squad carries tags (+ v1.9 story flags)
      this.tags = tags;
      this.flags = Array.isArray(o.flags) ? o.flags.filter(f => FLAGS[f]) : [];
    }
    this.face = PortraitGenerator.valid(face) ? face : PortraitGenerator.hashFace(id + name);
    // ---- v1.8 attribute groups (HIDDEN — never rendered outside DEBUG.EXE) ----
    const fresh = SKILL_KEYS.every(g => AttrGen.validGroup(o[g], g)) && AttrGen.validGroup(o.psych, 'psych') ? null
      : o.attrs ? AttrGen.fromLegacy(position, o.attrs, id + name + '#v18', o.age)
      : AttrGen.roll(position, seeded(id + name + '#v18'), 0, o.age);
    const src = fresh || o;
    for (const g of [...SKILL_KEYS, 'psych']) this[g] = { ...src[g] };
    this.psych.potential = clamp(Math.round(src.psych.potential ?? 50), 1, 100);
    const b = o.bio && Number.isInteger(o.bio.age) ? o.bio : (fresh?.bio || AttrGen.bio(position, seeded(id + name + '#bio'), o.age, this.physical));
    this.bio = { ...b };
    const d = o.dyn || {};
    const r = seeded(id + name + '#dyn');
    this.dyn = { condition: clamp(Math.round(d.condition ?? o.energy ?? 100), 0, 100),
      sharpness: clamp(Math.round(d.sharpness ?? rndR(r, 55, 75)), 0, 100),
      morale: clamp(Math.round(d.morale ?? rndR(r, 55, 75)), 0, 100) };
    this.portraitSvg = PortraitGenerator.svg(this.face, position === 'GK' ? 'gk' : tags ? 'home' : 'away');
  }
  get surname() { return this.name.split(' ').slice(-1)[0]; }
  get age() { return this.bio.age; }
  /** `energy` is the old name of dyn.condition — kept so every v1.1–v1.7 system keeps working. */
  get energy() { return this.dyn.condition; }
  set energy(v) { this.dyn.condition = v; }
  get sharp() { return this.dyn.sharpness >= SHARPNESS.RUSTY; }
  /** Raw skill with the sharpness rule applied: technical skills −2 when match tone < 50%. */
  skill(k) {
    const v = this.physical[k] ?? this.technical[k] ?? this.tactical[k] ?? this.psych[k] ?? 10;
    return TECH.has(k) && !this.sharp ? Math.max(1, v - SHARPNESS.RUSTY_PEN) : v;
  }
  /** Weighted engine composite (1–20 scale), e.g. rating('Pass') = (passing + vision) / 2. */
  rating(key) {
    const w = COMPOSITE[key]; let sum = 0, n = 0;
    for (const k in w) { sum += this.skill(k) * w[k]; n += w[k]; }
    return sum / n;
  }
  /** v1.9: hidden overall (1–20) = average of the engine composites that matter for his position. */
  get overall() {
    const keys = { GK: ['Save', 'Save', 'Pass'], DEF: ['Tackle', 'Mark', 'Pass', 'Speed'], MID: ['Pass', 'Dribble', 'Mark', 'Speed'], FWD: ['Shoot', 'Dribble', 'Speed', 'Pass'] }[this.position] || ['Pass'];
    return keys.reduce((a, k) => a + this.rating(k), 0) / keys.length;
  }
  hasFlag(f) { return !!this.flags?.includes(f); }
  /** Morale swing on every roll: ±2 at the extremes, amplified by passion (0.6×–1.5×). */
  get moodBonus() { return clamp((this.dyn.morale - 50) / 25 * (0.55 + this.psych.passion / 20), -2.5, 2.5); }
  /** The SVG is rebuilt from `face` on load, so saves only keep the 7 indices. */
  toJSON() { const { portraitSvg, ...o } = this; return o; }

  static generate(id, position, usedSurnames, mod = 0, withTags = false, number = 0) {
    let last; let guard = 0;
    do { last = pick(LAST); } while (usedSurnames.has(last) && guard++ < 200);
    usedSurnames.add(last);
    const a = AttrGen.roll(position, Math.random, mod);
    return new Player({ id, name: `${pick(FIRST)} ${last}`, position, number, tags: withTags ? [] : undefined, face: PortraitGenerator.roll(),
      ...a, dyn: { condition: 100, sharpness: rnd(55, 75), morale: rnd(55, 75) } });
  }
}
