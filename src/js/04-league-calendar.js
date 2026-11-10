/* =========================================================
   DATES (ISO 'YYYY-MM-DD', always handled in UTC to avoid timezone drift)
   ========================================================= */
const isoAdd = (iso, days) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
const fmtDate = (iso, opts) => new Date(iso + 'T00:00:00Z').toLocaleDateString(L.locale(), { timeZone: 'UTC', ...opts });
const SEASON = { START_MONTH_DAY: '09-01', FIRST_MATCH_OFFSET: 6, MATCH_INTERVAL: 7, FIRST_YEAR: 2002 };

/* =========================================================
   LEAGUE — 10 teams, double round-robin (18 matchdays x 5 fixtures)
   Team strength is HIDDEN: it drives AI rosters and AI-vs-AI results.
   ========================================================= */
class League {
  static STRENGTHS = [3, 2, 1, 1, 0, 0, -1, -2, -3];   // spread across the 9 AI clubs

  constructor({ teams, fixtures }) {
    this.teams = teams;
    this.fixtures = fixtures;
    for (const t of this.teams) if (t.roster) t.roster = t.roster.map(p => new Player(p));
  }

  static create(userName) {
    const strengths = shuffle(League.STRENGTHS);
    const teams = [{ id: 0, name: userName, user: true }];
    OPPONENTS.forEach((name, i) => teams.push({ id: i + 1, name, strength: strengths[i], formation: pick(FORMATION_KEYS), roster: null }));
    return new League({ teams, fixtures: League.roundRobin(teams.map(t => t.id)) });
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
  roster(team, usedSurnames) {
    if (!team.roster) {
      team.roster = formationSlots(team.formation).map((s, i) =>
        Player.generate(`t${team.id}_${i}`, LINE_POS[s.line], usedSurnames, team.strength, false, i + 1));
    }
    return team.roster;
  }

  setUserResult(f, userGoals, oppGoals) {
    if (f.home === 0) { f.hg = userGoals; f.ag = oppGoals; } else { f.hg = oppGoals; f.ag = userGoals; }
  }

  /* Simplified background model: Poisson goals around a rating difference.
     rating = 50 + strength*4 (user club counts as 50). Home side gets a small edge. */
  rating(t) { return t.user ? 50 : 50 + t.strength * 4; }
  static poisson(lambda) { const l = Math.exp(-lambda); let k = 0, p = 1; do { k++; p *= Math.random(); } while (p > l); return Math.min(k - 1, 7); }
  simulateFixture(f) {
    const rh = this.rating(this.team(f.home)), ra = this.rating(this.team(f.away));
    // base rates tuned so AI games score like the visual engine does (~2 goals per game)
    f.hg = League.poisson(clamp(1.1 + (rh - ra) * 0.035, 0.15, 3));
    f.ag = League.poisson(clamp(0.85 + (ra - rh) * 0.035, 0.1, 2.8));
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

