class Lang {
  static KEY = 'yam_lang';
  constructor() {
    let saved = null;
    try { saved = localStorage.getItem(Lang.KEY); } catch (e) {}
    this.code = saved === 'en' || saved === 'ru' ? saved : 'ru';
  }
  set(code) { this.code = code; try { localStorage.setItem(Lang.KEY, code); } catch (e) {} }
  t(key, vars = {}) {
    const v = I18N[this.code][key] ?? I18N.en[key] ?? key;
    return typeof v === 'string' ? fmt(v, vars) : v;
  }
  name(full) { return this.code === 'ru' ? full.split(' ').map(w => RU_NAMES[w] || w).join(' ') : full; }
  team(n) { return this.code === 'ru' ? (RU_TEAMS[n] || n) : n; }
  pos(p) { return p ? (POS_LABEL[this.code][p] || p) : '—'; }   // v3.0: untagged kid
  line(l) { return this.pos(LINE_POS[l]); }
  tag(key) { return ROLE_BY_ID[key] ? this.t('role.' + key) : key; }            // v3.19: names / texts of ROLES_DEF rows live in I18N
  /** v3.19: {m} = the main multiplier by level from ROLES_DEF ("1.2 / 1.35 / 1.5"), {d} = its first flat downside multiplier. */
  tagDesc(key) {
    const d = ROLE_BY_ID[key]; if (!d) return '';
    const b = d.boost.mult ?? d.boost.drain, n = v => String(+v.toFixed(2));
    const m = ROLES.LEVEL_MULT.map((_, i) => n(roleLevelMult(b, i + 1))).join(' / ');
    return this.t('role.' + key + '.d', { m, d: n(Object.values(d.down.attrs || {})[0] ?? 1) });
  }
  locale() { return this.code === 'ru' ? 'ru-RU' : 'en-GB'; }
}
const L = new Lang();

