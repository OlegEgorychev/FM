/* =========================================================
   DATES (ISO 'YYYY-MM-DD', always handled in UTC to avoid timezone drift)
   ========================================================= */
const isoAdd = (iso, days) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
const fmtDate = (iso, opts) => new Date(iso + 'T00:00:00Z').toLocaleDateString(L.locale(), { timeZone: 'UTC', ...opts });
const SEASON = { START_MONTH_DAY: '09-01', FIRST_MATCH_OFFSET: 6, MATCH_INTERVAL: 7, FIRST_YEAR: 2002 };

/* =========================================================
   EMBLEM GENERATOR (v1.6) — procedural 32x32 pixel-art club badges.
   A crest is 4 indices [shape, pattern, primary, secondary]. The badge is
   rasterised on a 32x32 grid and written as ONE <path> per colour
   (row runs), so there are no <clipPath> ids and no bloat.
   ========================================================= */
const EmblemGenerator = (() => {
  const SHAPES   = ['shield', 'circle', 'hexagon'];
  const PATTERNS = ['solid', 'stripes', 'halved'];
  const COLORS   = ['#2f4f86', '#8c2f2a', '#2f6a3c', '#b8902f', '#5e2a55', '#c86f2a',     // muted kit colours
                    '#3f87a8', '#6e1f2c', '#3b3b3e', '#7a7f34', '#1f5f5c', '#9b4f7a'];
  const LIGHT    = ['#e9e2cc', '#f1f4ee', '#d8c27a', '#1c1c1e'];                          // secondary / trim
  const SIZES = [SHAPES.length, PATTERNS.length, COLORS.length, LIGHT.length];
  const C = 16;                                                                           // centre
  const inside = {
    shield:  (x, y) => y >= 3 && y < 30 && (y < 17 ? x >= 4 && x < 28 : Math.abs(x + .5 - C) <= 12 * Math.sqrt(1 - ((y + .5 - 17) / 13) ** 2)),
    circle:  (x, y) => (x + .5 - C) ** 2 + (y + .5 - C) ** 2 <= 14 ** 2,
    hexagon: (x, y) => { const dx = Math.abs(x + .5 - C), dy = Math.abs(y + .5 - C); return dx <= 12.5 && dy + dx * .577 <= 14.6; },
  };
  const fillAt = { solid: () => 0, stripes: x => Math.floor((x - 2) / 4) % 2, halved: x => (x < C ? 0 : 1) };
  const lum = hex => [1, 3, 5].reduce((a, i, k) => a + parseInt(hex.slice(i, i + 2), 16) * [.3, .59, .11][k], 0);
  const hash = str => { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    return SIZES.map(n => { h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0; return h % n; }); };
  const cache = new Map();

  return {
    /** Unique primary colours for a whole league (user club keeps the academy blue). */
    rollLeague(n) {
      const prim = shuffle(COLORS.map((_, i) => i).slice(1));
      return Array.from({ length: n }, (_, i) => i === 0 ? [0, 2, 0, 0]
        : [rnd(0, 2), rnd(0, 2), prim[(i - 1) % prim.length], rnd(0, LIGHT.length - 1)]);
    },
    valid: c => Array.isArray(c) && c.length === SIZES.length && c.every((v, i) => Number.isInteger(v) && v >= 0 && v < SIZES[i]),
    hash,
    /** Returns an inline SVG string; cached per crest + letter (pure function of its inputs). */
    svg(crest, letter = '') {
      const key = crest.join('.') + letter;
      if (cache.has(key)) return cache.get(key);
      const [sh, pt, ci, si] = crest, shape = inside[SHAPES[sh]], fill = fillAt[PATTERNS[pt]];
      let c1 = COLORS[ci], c2 = LIGHT[si];
      if (PATTERNS[pt] === 'solid') c2 = c1;
      const d = ['', '', ''];                                         // 0 primary, 1 secondary, 2 outline
      for (let y = 0; y < 32; y++) {
        let run = null;
        const flush = x => { if (run) d[run.k] += `M${run.x} ${y}h${x - run.x}v1h${run.x - x}z`; };
        for (let x = 0; x <= 32; x++) {
          let k = null;
          if (x < 32 && shape(x, y)) {
            const edge = !shape(x - 1, y) || !shape(x + 1, y) || !shape(x, y - 1) || !shape(x, y + 1);
            k = edge ? 2 : fill(x);
          }
          if (!run || run.k !== k) { flush(x); run = k === null ? null : { k, x }; }
        }
      }
      // letter colour: pick the readable one against the primary
      const ink = lum(c1) > 140 ? '#1c1c1e' : '#f1ecd8';
      const out = `<svg class="emblem-svg" viewBox="0 0 32 32" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
        + `<path fill="${c1}" d="${d[0]}"/>` + (d[1] ? `<path fill="${c2}" d="${d[1]}"/>` : '') + `<path fill="#121315" d="${d[2]}"/>`
        + `<rect x="10" y="10" width="12" height="12" fill="${c1}" opacity=".85"/>`
        + `<text x="16" y="21.5" text-anchor="middle" font-family="VT323,monospace" font-size="15" fill="${ink}" stroke="#121315" stroke-width="1.4" paint-order="stroke">${esc(letter)}</text>`
        + '</svg>';
      cache.set(key, out);
      return out;
    },
  };
})();

/** Badge letter = first letter of the localized club name, skipping "St." style prefixes. */
const crestLetter = name => (L.team(name).replace(/^(St\.|Св\.)\s*/, '').match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();

/** Gives a team its crest + a non-enumerable `emblemSvg` (rebuilt from `crest`, never saved). */
function attachEmblem(team) {
  if (!EmblemGenerator.valid(team.crest)) team.crest = EmblemGenerator.hash(team.name + '#crest');
  Object.defineProperty(team, 'emblemSvg', { configurable: true, enumerable: false,
    get() { return EmblemGenerator.svg(this.crest, crestLetter(this.name)); } });
  return team;
}
/** HTML helper: <span class="emblem sm">…svg…</span> */
const emblemHTML = (team, size = 'sm') => team ? `<span class="emblem ${size}" title="${esc(L.team(team.name))}">${team.emblemSvg}</span>` : '';


/* =========================================================
   LEAGUE — 10 teams, double round-robin (18 matchdays x 5 fixtures)
   Team strength is HIDDEN: it drives AI rosters and AI-vs-AI results.
   ========================================================= */
class League {
  static STRENGTHS = [3, 2, 1, 1, 0, 0, -1, -2, -3];   // spread across the 9 AI clubs

  static SQUAD_SIZE = 15;   // v3.4: + a second keeper (the AI rotates tired kids now)
  static LITE_POS = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD', 'GK'];
  /* background share of goals / assists by position (weights, not %) */
  static GOAL_W   = { GK: 0,   DEF: 0.6, MID: 2.2, FWD: 5 };
  static ASSIST_W = { GK: 0.1, DEF: 1.1, MID: 3.6, FWD: 2.4 };

  constructor({ teams, fixtures }, usedSurnames = new Set()) {
    this.teams = teams;
    this.fixtures = fixtures;
    for (const t of this.teams) { if (t.roster) t.roster = t.roster.map(p => new Player(p)); attachEmblem(t); }
    // v1.7: every AI club carries a lightweight squad { id, name, pos, mp, goals, assists } (no attrs, no faces)
    const used = new Set([...usedSurnames, ...this.teams.flatMap(t => (t.squad || []).map(k => k.name.split(' ').pop()))]);
    for (const t of this.teams) if (!t.user && !Array.isArray(t.squad)) t.squad = League.liteSquad(t, used);
    // v3.4: old saves — top the squad up to 15 (second keeper) and give every AI kid an energy value
    for (const t of this.teams) if (!t.user) {
      for (let i = t.squad.length; i < League.LITE_POS.length; i++) t.squad.push(League.liteKid(t, i, League.LITE_POS[i], used));
      for (const k of t.squad) if (!Number.isFinite(k.en)) k.en = 100;
    }
  }
  static liteKid(team, i, pos, used) {
    let last, g = 0; do { last = pick(LAST); } while (used.has(last) && g++ < 200); used.add(last);
    return { id: `t${team.id}_${i}`, name: `${pick(FIRST)} ${last}`, pos, mp: 0, goals: 0, assists: 0, en: 100 };
  }

  /** 14 kids per AI club. If a full match roster already exists (old save), its 11 names are kept. */
  static liteSquad(team, used) {
    return League.LITE_POS.map((pos, i) => {
      const old = team.roster?.find(p => p.id === `t${team.id}_${i}`);
      let name = old?.name;
      if (!name) { let last, g = 0; do { last = pick(LAST); } while (used.has(last) && g++ < 200); used.add(last); name = `${pick(FIRST)} ${last}`; }
      return { id: `t${team.id}_${i}`, name, pos: old?.position || pos, mp: 0, goals: 0, assists: 0, en: 100 };
    });
  }

  /** prevTeams: last season's clubs, so every badge survives the summer. */
  static create(userName, prevTeams = [], usedSurnames = new Set()) {
    const strengths = shuffle(League.STRENGTHS);
    const rolled = EmblemGenerator.rollLeague(OPPONENTS.length + 1);
    const crests = [userName, ...OPPONENTS].map((n, i) => prevTeams.find(t => t.name === n)?.crest || rolled[i]);
    const teams = [{ id: 0, name: userName, user: true, crest: crests[0] }];
    OPPONENTS.forEach((name, i) => teams.push({ id: i + 1, name, strength: strengths[i], formation: pick(FORMATION_KEYS), roster: null, crest: crests[i + 1] }));
    return new League({ teams, fixtures: League.roundRobin(teams.map(t => t.id)) }, usedSurnames);
  }

  /** Circle method: one team fixed, the rest rotate. Second half mirrors the first with home/away swapped. */
  static roundRobin(ids) {
    const n = ids.length, arr = shuffle(ids), rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const md = [];
      for (let i = 0; i < n / 2; i++) {
        let h = arr[i], a = arr[n - 1 - i];
        if ((r + i) % 2 === 1) [h, a] = [a, h];
        md.push([h, a]);
      }
      rounds.push(md);
      arr.splice(1, 0, arr.pop());
    }
    const fixtures = [];
    rounds.forEach((md, r) => md.forEach(([h, a]) => fixtures.push({ md: r + 1, home: h, away: a, hg: null, ag: null })));
    rounds.forEach((md, r) => md.forEach(([h, a]) => fixtures.push({ md: r + n, home: a, away: h, hg: null, ag: null })));
    return fixtures;
  }

  get matchdays() { return (this.teams.length - 1) * 2; }
  team(id) { return this.teams.find(t => t.id === id); }
  fixturesOf(md) { return this.fixtures.filter(f => f.md === md); }
  userFixture(md) { return this.fixtures.find(f => f.md === md && (f.home === 0 || f.away === 0)); }
  played(f) { return f.hg !== null; }
  playedMatchdays() { return new Set(this.fixtures.filter(f => this.played(f)).map(f => f.md)).size; }

  /** AI roster is generated on first need and stored, so a club keeps the same kids all season. */
  /** v1.7: the match roster is built from the club's lightweight squad, so names and ids match the league stats. */
  roster(team, usedSurnames) {
    if (!team.roster) {
      const free = [...team.squad];
      team.roster = formationSlots(team.formation).map(s => {
        const want = LINE_POS[s.line];
        const k = Math.max(0, free.findIndex(x => x.pos === want));
        const kid = free.splice(k, 1)[0];
        const p = Player.generate(kid.id, want, usedSurnames, team.strength, false, team.squad.indexOf(kid) + 1);
        p.name = kid.name;
        return new Player(p);   // rebuild so the portrait hash matches the final name
      });
    }
    // v3.4: the bench (kids not in the first-choice XI) gets full Player objects too, so the AI can rotate
    for (const kid of team.squad) if (!team.roster.some(p => p.id === kid.id)) {
      const p = Player.generate(kid.id, kid.pos, usedSurnames, team.strength, false, team.squad.indexOf(kid) + 1);
      p.name = kid.name; team.roster.push(new Player(p));
    }
    return team.roster;
  }

  /* ---------- v3.4 AI FATIGUE: same energy rules as the academy + simple rotation ----------
     Every AI kid carries `en` (0–100) in the lite squad. Day: rest +10, training day −10 (match practice).
     Match: the XI drains like in the engine (live energy is written back after our match; AI-vs-AI uses drainOf × 90),
     the unused kids rest +6. Rotation: a first-choice starter under AI_FATIGUE.ROTATE_BELOW is replaced by the
     freshest bench kid of the same role who has at least ROTATE_GAIN more energy (any outfield kid if the starter
     is under DESPERATE). */
  matchXI(team, usedSurnames) {
    const pool = this.roster(team, usedSurnames), en = id => this.kid(id)?.en ?? 100;
    const xi = pool.slice(0, 11), bench = pool.slice(11);
    for (let i = 0; i < xi.length; i++) {
      const p = xi[i], e = en(p.id);
      if (e >= AI_FATIGUE.ROTATE_BELOW) continue;
      const gk = i === 0, fits = b => (gk ? b.archetype === 'GK' : b.archetype !== 'GK') && (b.archetype === p.archetype || (!gk && e < AI_FATIGUE.DESPERATE));
      const alt = bench.filter(b => fits(b) && en(b.id) >= e + AI_FATIGUE.ROTATE_GAIN).sort((a, b) => en(b.id) - en(a.id))[0];
      if (alt) { xi[i] = alt; bench.splice(bench.indexOf(alt), 1); }
    }
    for (const p of pool) p.energy = Math.round(en(p.id));
    return xi;
  }
  /** Calendar day for every AI kid (called from GameState.dayRoutine). */
  aiDay(training) {
    for (const t of this.teams) if (!t.user) for (const k of t.squad) k.en = clamp(k.en + (training ? AI_FATIGUE.TRAIN : ENERGY.DAILY_REST), 0, 100);
  }
  /** After a match: XI keep their end energy (map id → energy), everybody else in the squad rests +6. */
  aiAfterMatch(team, endEnergy) {
    for (const k of team.squad) k.en = endEnergy.has(k.id) ? clamp(Math.round(endEnergy.get(k.id)), 0, 100) : clamp(k.en + ENERGY.BENCH_REST, 0, 100);
  }
  /** Opponent report for the morning briefing: average energy of the expected XI and how many of them are tired. */
  oppCondition(team, usedSurnames) {
    const xi = this.matchXI(team, usedSurnames), e = xi.map(p => p.energy);
    return { avg: Math.round(e.reduce((a, b) => a + b, 0) / e.length), tired: e.filter(v => v < ENERGY.TIRED).length };
  }

  /* ---------- v1.7: LEAGUE STATS (matches, goals, assists) ---------- */
  kid(id) { for (const t of this.teams) { const k = t.squad?.find(x => x.id === id); if (k) return k; } return null; }

  /** Weighted random pick from a list of kids, never `not`. */
  static weighted(list, wKey, not) {
    const pool = list.filter(k => k !== not), w = pool.map(k => wKey[k.pos] + 0.05);
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) if ((r -= w[i]) <= 0) return pool[i];
    return pool[pool.length - 1];
  }
  /** Background result → stats: 11 of 14 kids play (GK always), each goal gets a scorer and usually an assist. */
  distributeStats(team, goals, xiIds = null) {
    if (!team.squad) return;
    const gk = team.squad.filter(k => k.pos === 'GK');
    const out = shuffle(team.squad.filter(k => k.pos !== 'GK'));
    const xi = xiIds ? team.squad.filter(k => xiIds.includes(k.id)) : [...gk.slice(0, 1), ...out.slice(0, 10)];   // v3.4: the real XI
    for (const k of xi) k.mp++;
    for (let g = 0; g < goals; g++) {
      const scorer = League.weighted(xi, League.GOAL_W);
      scorer.goals++;
      if (Math.random() < 0.72) League.weighted(xi, League.ASSIST_W, scorer).assists++;
    }
  }
  /** User match: credit the opponent kids with what they did in the live engine. pairs: [[id, stats], ...] */
  recordKids(pairs) {
    for (const [id, st] of pairs) { const k = this.kid(id); if (k) { k.mp++; k.goals += st.goals || 0; k.assists += st.assists || 0; } }
  }

  /** All players of the league (AI kids + our academy) as { name, team, goals, assists, mp }. */
  scorers(userSquad = [], userStats = {}) {
    const me = this.teams.find(t => t.user);
    const list = this.teams.filter(t => !t.user).flatMap(t => t.squad.map(k => ({ id: k.id, name: k.name, team: t, mp: k.mp, goals: k.goals, assists: k.assists })));
    for (const p of userSquad) { const st = userStats[p.id] || {}; list.push({ id: p.id, name: p.name, team: me, mp: st.apps || 0, goals: st.goals || 0, assists: st.assists || 0, own: true }); }
    return list;
  }
  static leaders(list, key, n = 7) {
    return list.filter(x => x[key] > 0).sort((a, b) => b[key] - a[key] || a.mp - b.mp || a.name.localeCompare(b.name)).slice(0, n);
  }

  setUserResult(f, userGoals, oppGoals) {
    if (f.home === 0) { f.hg = userGoals; f.ag = oppGoals; } else { f.hg = oppGoals; f.ag = userGoals; }
  }

  /* Simplified background model: Poisson goals around a rating difference.
     rating = 50 + strength*4 (user club counts as 50). Home side gets a small edge. */
  rating(t) { return t.user ? 50 : 50 + t.strength * 4; }
  static poisson(lambda) { const l = Math.exp(-lambda); let k = 0, p = 1; do { k++; p *= Math.random(); } while (p > l); return Math.min(k - 1, 7); }
  simulateFixture(f) {
    // v3.4: rotation + fatigue for AI-vs-AI too: the rating drops with the XI's mid-match fatigue (≈ the live engine:
    // a whole XI at 50% loses ~0.6 goal against a fresh one), then the XI pays the usual drain.
    const sides = [f.home, f.away].map(id => { const t = this.team(id), xi = this.matchXI(t, new Set());
      const fm = xi.reduce((a, p) => a + fatigueMult(p.energy - 17), 0) / xi.length;
      return { t, xi, r: this.rating(t) + (fm - 1) * AI_FATIGUE.RATING }; });
    const rh = sides[0].r, ra = sides[1].r;
    // base rates tuned so AI games score like the visual engine does (~2 goals per game)
    f.hg = League.poisson(clamp(1.1 + (rh - ra) * 0.035, 0.15, 3));
    f.ag = League.poisson(clamp(0.85 + (ra - rh) * 0.035, 0.1, 2.8));
    for (const [i, g] of [[0, f.hg], [1, f.ag]]) {
      const { t, xi } = sides[i];
      this.distributeStats(t, g, xi.map(p => p.id));
      this.aiAfterMatch(t, new Map(xi.map(p => [p.id, p.energy - rnd(ENERGY.PLAY_MIN, ENERGY.PLAY_MAX) * (1.15 - (p.physical?.baseStamina ?? 10) * 0.015)])));
    }
  }
  /** Resolve every unplayed AI-vs-AI fixture of a matchday. Returns those fixtures. */
  simulateOthers(md) {
    const done = [];
    for (const f of this.fixturesOf(md)) if (!this.played(f) && f.home !== 0 && f.away !== 0) { this.simulateFixture(f); done.push(f); }
    return done;
  }

  table() {
    const rows = new Map(this.teams.map(t => [t.id, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, form: [] }]));
    for (const f of [...this.fixtures].sort((a, b) => a.md - b.md)) {
      if (!this.played(f)) continue;
      const h = rows.get(f.home), a = rows.get(f.away);
      h.p++; a.p++; h.gf += f.hg; h.ga += f.ag; a.gf += f.ag; a.ga += f.hg;
      if (f.hg > f.ag) { h.w++; a.l++; h.pts += 3; h.form.push('W'); a.form.push('L'); }
      else if (f.hg < f.ag) { a.w++; h.l++; a.pts += 3; h.form.push('L'); a.form.push('W'); }
      else { h.d++; a.d++; h.pts++; a.pts++; h.form.push('D'); a.form.push('D'); }
    }
    const list = [...rows.values()];
    list.forEach(r => { r.gd = r.gf - r.ga; r.form = r.form.slice(-5); });
    return list.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.name.localeCompare(y.team.name));
  }
  position(teamId) { return this.table().findIndex(r => r.team.id === teamId) + 1; }

  toJSON() { return { teams: this.teams, fixtures: this.fixtures }; }
}

/* =========================================================
   CALENDAR ENGINE — event-driven day-by-day progression.
   New event types plug in with registerType(); daily routines with onDay().
     registerType('match',    { blocking: true,  label(ev), onArrive(ev) })
     registerType('training', { blocking: false, label(ev), onArrive(ev) })   // future
     registerType('dialogue', { blocking: true,  label(ev), onArrive(ev) })   // future
   Blocking events stop the simulation on their day and stay pending until
   completeEvent(); non-blocking ones fire and auto-complete as the day passes.
   ========================================================= */
class CalendarEngine {
  constructor(data) {
    this.attach(data);
    this.types = {};
    this.dailyHooks = [];
    this.timer = null;
    this.running = false;
  }
  attach(data) { this.data = data; }               // data = { date, events: [{id, type, date, done, ...}] }
  get date() { return this.data.date; }
  registerType(type, def) { this.types[type] = def; }
  onDay(fn) { this.dailyHooks.push(fn); }
  pending() { return this.data.events.filter(e => !e.done).sort((a, b) => a.date.localeCompare(b.date)); }
  nextEvent() { return this.pending()[0] || null; }
  eventsOn(date) { return this.pending().filter(e => e.date === date); }
  blockingToday() { return this.eventsOn(this.date).find(e => this.types[e.type]?.blocking) || null; }
  label(ev) { return this.types[ev.type]?.label?.(ev) ?? ev.type; }
  advanceDay() { this.data.date = isoAdd(this.data.date, 1); }
  completeEvent(id) { const e = this.data.events.find(x => x.id === id); if (e) e.done = true; }

  /** Runs one day. Returns { stopped: event|null, infos: [...] } */
  step() {
    const today = this.eventsOn(this.date);
    for (const e of today) if (!this.types[e.type]?.blocking) { this.types[e.type]?.onArrive?.(e); e.done = true; }
    const blocking = today.find(e => this.types[e.type]?.blocking);
    if (blocking) return { stopped: blocking, infos: [] };
    const date = this.date;
    const infos = this.dailyHooks.map(fn => fn(date)).filter(Boolean);
    this.advanceDay();
    return { stopped: null, date, infos };
  }

  /** Simulates days one by one (visibly) until a blocking event or the end of the calendar. */
  simulate({ stepMs = 180, onStep, onStop } = {}) {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      const r = this.step();
      if (r.stopped) { this.stop(); this.types[r.stopped.type]?.onArrive?.(r.stopped); onStop?.(r.stopped); return; }
      onStep?.(r.date, r.infos);
      if (!this.nextEvent()) { this.stop(); onStop?.(null); }
    };
    tick();
    if (this.running) this.timer = setInterval(tick, stepMs);
  }
  stop() { this.running = false; clearInterval(this.timer); this.timer = null; }
}

