/* =========================================================
   GAME STATE
   lineup[i] is the player in formation slot i (slot 0 = goalkeeper).
   phase: 'calendar' -> 'matchday' -> 'post' -> 'calendar' ... -> 'seasonEnd'
   ========================================================= */
class GameState {
  static KEY = 'yam_save_v1';

  constructor() {
    if (!this.load()) this.newAcademy();
  }

  newAcademy() {
    this.clubName = CLUB_NAME;
    this.formation = '4-4-2';
    const used = new Set();
    this.squad = SQUAD_POS.map((pos, i) => Player.generate(`a${i}`, pos, used, 0, true, i + 1));
    this.lineup = this.squad.slice(0, 11).map(p => p.id);
    this.autoArrange();
    this.newSeason(SEASON.FIRST_YEAR);
  }

  newSeason(year) {
    this.season = year;
    this.league = League.create(this.clubName);
    const start = `${year}-${SEASON.START_MONTH_DAY}`;
    const events = [];
    for (let md = 1; md <= this.league.matchdays; md++) {
      events.push({ id: `md${md}`, type: 'match', md, date: isoAdd(start, SEASON.FIRST_MATCH_OFFSET + SEASON.MATCH_INTERVAL * (md - 1)), done: false });
    }
    this.calendar = { date: start, events };
    this.phase = 'calendar';
    this.lastReport = null;
    this.notebookUnlocked = false;
    this.diary = [{ date: start, key: 'cal.welcome', vars: { y: year, z: String(year + 1).slice(2) } }];
    this.seasonStats = {};   // playerId → cumulative stats this season (+ apps)
    for (const p of this.squad) p.energy = 100;   // summer break
    this.save();
  }

  /* ----- current match context (from the calendar + league) ----- */
  nextMatchEvent() { return this.calendar.events.filter(e => !e.done && e.type === 'match').sort((a, b) => a.date.localeCompare(b.date))[0] || null; }
  matchContext() {
    const ev = this.nextMatchEvent();
    if (!ev) return null;
    const fixture = this.league.userFixture(ev.md);
    const opp = this.league.team(fixture.home === 0 ? fixture.away : fixture.home);
    const players = this.league.roster(opp, new Set(this.squad.map(p => p.surname)));
    return { ev, md: ev.md, fixture, opp, venue: fixture.home === 0 ? 'home' : 'away',
      team: { name: opp.name, players, formation: opp.formation } };
  }
  userRow() { return this.league.table().find(r => r.team.user); }

  /* ----- squad / lineup ----- */
  player(id) { return this.squad.find(p => p.id === id); }
  isStarter(id) { return this.lineup.includes(id); }
  starters() { return this.lineup.map(id => this.player(id)); }
  bench() { return this.squad.filter(p => !this.isStarter(p.id)); }
  slots() { return formationSlots(this.formation); }
  slotLine(id) { const i = this.lineup.indexOf(id); return i < 0 ? null : this.slots()[i].line; }
  outOfPosition() {
    const slots = this.slots();
    return this.starters().map((p, i) => ({ p, line: slots[i].line })).filter(({ p, line }) => NATURAL_LINE[p.position] !== line);
  }
  static gkError(players) { return players.filter(p => p.position === 'GK').length !== 1 ? 'gk' : null; }

  autoArrange() {
    const slots = this.slots();
    const pool = this.starters();
    const gk = pool.find(p => p.position === 'GK') || pool[0];
    const free = pool.filter(p => p !== gk).sort((a, b) => b.energy - a.energy);
    const assigned = new Array(slots.length).fill(null);
    slots.forEach((s, i) => {
      if (i === 0) return;
      const k = free.findIndex(p => NATURAL_LINE[p.position] === s.line);
      if (k >= 0) assigned[i] = free.splice(k, 1)[0];
    });
    slots.forEach((s, i) => {
      if (i === 0 || assigned[i]) return;
      const dist = p => Math.abs((LINE_IDX[NATURAL_LINE[p.position]] ?? 1) - LINE_IDX[s.line]);
      free.sort((a, b) => dist(a) - dist(b));
      assigned[i] = free.shift();
    });
    this.lineup = [gk.id, ...assigned.slice(1).map(p => p.id)];
  }
  setFormation(f) { if (!FORMATIONS[f]) return; this.formation = f; this.autoArrange(); this.save(); }
  /** Unified lineup swap used by both the roster list and the pitch.
      starter <-> starter : exchange formation slots
      starter <-> bench   : bench player takes the starter's slot
      Returns an error key (shown in a modal) or null. */
  swapPlayers(a, b) {
    const ia = this.lineup.indexOf(a), ib = this.lineup.indexOf(b);
    const pa = this.player(a), pb = this.player(b);
    if (!pa || !pb || (ia < 0 && ib < 0)) return 'bench';
    if (ia >= 0 && ib >= 0) {
      if (ia === 0 || ib === 0) return 'gkSlot';
      [this.lineup[ia], this.lineup[ib]] = [b, a];
    } else {
      const [slot, incoming] = ia >= 0 ? [ia, pb] : [ib, pa];
      if (slot === 0 && incoming.position !== 'GK') return 'gkOnly';
      if (slot !== 0 && incoming.position === 'GK') return 'gkTwo';
      this.lineup[slot] = incoming.id;
    }
    this.save();
    return null;
  }
  setTag(id, tag) { const p = this.player(id); if (p && TAGS[tag]) { p.tags = [tag]; this.save(); } }
  removeTag(id, tag) { const p = this.player(id); if (p) { p.tags = p.tags.filter(t => t !== tag); this.save(); } }

  /* ----- energy ----- */
  restDay() { for (const p of this.squad) p.energy = clamp(p.energy + ENERGY.DAILY_REST, 0, 100); }
  /** v1.1: players who played keep their LIVE end-of-match energy; unused subs rest. */
  applyLiveFatigue(eng) {
    for (const p of this.squad) {
      p.energy = eng.everPlayed.has(p.id)
        ? clamp(Math.round(eng.energy.get(p.id)), 0, 100)
        : clamp(Math.round(p.energy + ENERGY.BENCH_REST), 0, 100);
    }
  }
  applyFatigue(playedIds) {
    for (const p of this.squad) {
      const delta = playedIds.includes(p.id) ? -rnd(ENERGY.PLAY_MIN, ENERGY.PLAY_MAX) : ENERGY.BENCH_REST;
      p.energy = clamp(Math.round(p.energy + delta), 0, 100);
    }
  }

  /** Adds one match to every player's season totals. pairs: [[id, stats], ...] */
  recordSeasonStats(pairs) {
    for (const [id, st] of pairs) {
      const acc = this.seasonStats[id] || (this.seasonStats[id] = { ...MatchEngine.blankStats(), apps: 0 });
      for (const k in st) acc[k] = (acc[k] || 0) + st[k];
      acc.apps++;
    }
  }
  seasonOf(id) { return this.seasonStats[id] || { ...MatchEngine.blankStats(), apps: 0 }; }

  addDiary(entry) { this.diary.push(entry); if (this.diary.length > 80) this.diary.shift(); }

  save() {
    try {
      localStorage.setItem(GameState.KEY, JSON.stringify({
        v: 4, clubName: this.clubName, formation: this.formation, squad: this.squad, lineup: this.lineup,
        season: this.season, league: this.league, calendar: this.calendar, phase: this.phase,
        lastReport: this.lastReport, notebookUnlocked: this.notebookUnlocked, diary: this.diary, seasonStats: this.seasonStats,
      }));
    } catch (e) { /* storage unavailable: play in memory */ }
  }
  load() {
    try {
      const raw = localStorage.getItem(GameState.KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!Array.isArray(d.squad) || d.squad.length < 11) return false;
      this.clubName = d.clubName || CLUB_NAME;
      this.formation = FORMATIONS[d.formation] ? d.formation : '4-4-2';
      this.squad = d.squad.map(p => new Player({ ...p, tags: (Array.isArray(p.tags) ? p.tags : []).filter(t => TAGS[t]).slice(0, 1) }));
      if (this.squad.length === 11) {
        const used = new Set(this.squad.map(p => p.surname));
        SQUAD_POS.slice(11).forEach((pos, i) => this.squad.push(Player.generate(`a${11 + i}`, pos, used, 0, true)));
      }
      const taken = new Set(this.squad.map(p => p.number).filter(Boolean));
      let n = 1;
      for (const p of this.squad) if (!p.number) { while (taken.has(n)) n++; p.number = n; taken.add(n); }
      const ok = Array.isArray(d.lineup) && d.lineup.length === 11 && d.lineup.every(id => this.player(id))
        && !GameState.gkError(d.lineup.map(id => this.player(id)));
      this.lineup = ok ? d.lineup : this.squad.slice(0, 11).map(p => p.id);
      if (!d.v || d.v < 3 || this.player(this.lineup[0]).position !== 'GK') this.autoArrange();
      if (d.v >= 4 && d.league && d.calendar) {
        this.season = d.season;
        this.league = new League(d.league);
        this.calendar = d.calendar;
        this.phase = d.phase || 'calendar';
        this.lastReport = d.lastReport || null;
        this.notebookUnlocked = !!d.notebookUnlocked;
        this.diary = Array.isArray(d.diary) ? d.diary : [];
        this.seasonStats = d.seasonStats && typeof d.seasonStats === 'object' ? d.seasonStats : {};
        // a match interrupted by a page reload is simply replayed
      } else {
        this.newSeason(SEASON.FIRST_YEAR);   // older saves: keep the squad, start the league
      }
      this.save();
      return true;
    } catch (e) { return false; }
  }
  reset() {
    try { localStorage.removeItem(GameState.KEY); } catch (e) {}
    this.newAcademy();
  }
}

