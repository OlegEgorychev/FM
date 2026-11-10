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
  pos(p) { return POS_LABEL[this.code][p] || p; }
  line(l) { return this.pos(LINE_POS[l]); }
  tag(key) { return TAGS[key] ? TAGS[key][this.code][0] : key; }
  tagDesc(key) { return TAGS[key] ? TAGS[key][this.code][1] : ''; }
  locale() { return this.code === 'ru' ? 'ru-RU' : 'en-GB'; }
}
const L = new Lang();

