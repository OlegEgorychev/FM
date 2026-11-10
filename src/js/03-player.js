/* =========================================================
   PLAYER
   ========================================================= */
class Player {
  constructor({ id, name, position, attrs, tags, energy, number }) {
    this.id = id;
    this.name = name;
    this.position = position;
    this.number = number;
    this.attrs = attrs;              // HIDDEN — never rendered
    if (tags) {                      // only the academy squad carries tags + energy
      this.tags = tags;
      this.energy = energy ?? 100;
    }
  }
  get surname() { return this.name.split(' ').slice(-1)[0]; }

  static generate(id, position, usedSurnames, mod = 0, withTags = false, number = 0) {
    let last; let guard = 0;
    do { last = pick(LAST); } while (usedSurnames.has(last) && guard++ < 200);
    usedSurnames.add(last);
    const attrs = {};
    for (const a of ATTRS) { const [lo, hi] = PROFILES[position][a]; attrs[a] = clamp(rnd(lo, hi) + mod, 1, 20); }
    return new Player({ id, name: `${pick(FIRST)} ${last}`, position, attrs, number, tags: withTags ? [] : undefined });
  }
}

