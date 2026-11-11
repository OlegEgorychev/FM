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
    this.budget = ECONOMY.START;   // v1.9: club money ($), carried across seasons
    this.pendingEvent = null;      // v1.9: narrative event waiting for the coach's choice { id, date, cast, resume }
    this.eventLog = [];            // v1.9: [{ id, date, season, choice, who }]
    this.eventQueue = [];          // v2.2: scheduled events [{ id, due, matchDay, from }]
    const used = new Set();
    this.squad = SQUAD_POS.map((pos, i) => Player.generate(`a${i}`, pos, used, 0, true, i + 1));
    this.lineup = this.squad.slice(0, 11).map(p => p.id);
    this.autoArrange();
    this.newSeason(SEASON.FIRST_YEAR);
  }

  newSeason(year) {
    this.season = year;
    this.league = League.create(this.clubName, this.league?.teams, new Set(this.squad.map(p => p.surname)));
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
    this.cheats = this.cheats || { forceWin: false };   // v1.8 DEBUG.EXE
    this.coachNotes = {};    // v1.5: playerId → last Notebook note the coach actually saw { md, keys, role }
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
    if ((ia < 0 && !pa.available) || (ib < 0 && !pb.available)) return 'unavail_' + (ia < 0 ? pa : pb).unavailableReason;   // v2.2
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
  /** Rest day: condition +4, match sharpness fades −1 (floor 20), morale drifts 1 point toward 60. */
  restDay() {
    for (const p of this.squad) {
      p.energy = clamp(p.energy + ENERGY.DAILY_REST, 0, 100);
      p.dyn.sharpness = Math.max(SHARPNESS.FLOOR, p.dyn.sharpness + SHARPNESS.DAILY);
      p.dyn.morale += Math.sign(MORALE.DRIFT_TO - p.dyn.morale);
    }
    this.tickInjuries();
  }
  /** v2.2: one calendar day of healing (rest days AND the match day itself). Returns kids who just got fit. */
  tickInjuries() {
    const healed = [];
    for (const p of this.squad) if (p.injuryDays > 0 && --p.injuryDays === 0) healed.push(p);
    for (const p of healed) this.addDiary({ date: this.calendar.date, key: 'inj.healed', vars: { k: { pid: p.id } }, cls: 'ev' });
    return healed;
  }
  /** v2.2: injured / suspended / benched-by-deal starters are replaced by the best available bench kid
      (same position first). Returns [{ out, in }] so the UI can tell the coach. */
  ensureAvailableXI() {
    const slots = this.slots(), changes = [];
    this.lineup.forEach((id, i) => {
      const p = this.player(id);
      if (!p || p.available) return;
      const bench = this.bench().filter(b => b.available);
      const want = i === 0 ? 'GK' : LINE_POS[slots[i].line];
      const score = b => (b.position === want ? 100 : 0) + (i === 0 ? (b.position === 'GK' ? 1000 : 0) : (b.position === 'GK' ? -1000 : 0)) + b.overall;
      const best = bench.sort((a, b) => score(b) - score(a))[0];
      if (!best) return;
      this.lineup[i] = best.id;
      changes.push({ out: p, in: best });
    });
    if (changes.length) this.save();
    return changes;
  }
  /** v1.8: after a match — sharpness from minutes (full game +12, sub +6, unused −2); morale from the result,
      goals and red cards, amplified by passion (0.6×–1.4×). */
  applyMatchDynamics(eng, result) {
    const subIn = new Set(eng.subs.map(x => x.in));
    for (const p of this.squad) {
      const played = eng.everPlayed.has(p.id), st = eng.stats.get(p.id);
      const sh = !played ? SHARPNESS.UNUSED : subIn.has(p.id) || eng.subbedOff.has(p.id) ? SHARPNESS.SUB : SHARPNESS.PLAYED;
      p.dyn.sharpness = clamp(p.dyn.sharpness + sh, 0, 100);
      let m = MORALE[result] + (st ? st.goals * MORALE.GOAL + st.red * MORALE.RED : 0);
      if (!played) m -= 2;
      p.dyn.morale = clamp(Math.round(p.dyn.morale + m * (0.6 + p.psych.passion / 25)), 0, 100);
    }
  }
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
  /** v1.5: remember the notes shown in the Notebook so the Profile Card can quote them later. */
  recordCoachNotes(rep) {
    for (const pr of rep.players) {
      const p = this.player(pr.id); if (!p) continue;
      this.coachNotes[pr.id] = { md: rep.md, opp: rep.opponent, keys: coachNote(p, pr.stats, pr), role: pr.role };
    }
  }
  seasonOf(id) { return this.seasonStats[id] || { ...MatchEngine.blankStats(), apps: 0 }; }

  /* ----- v1.9 economy ----- */
  canAfford(cost) { return this.budget >= cost; }
  /** Positive = income, negative = spending. Never goes below $0. Returns the amount actually moved. */
  addMoney(delta, allowDebt = false) {   // v2.2: a forced payment may push the club into debt
    const before = this.budget;
    this.budget = Math.round(this.budget + delta);
    if (!allowDebt) this.budget = Math.max(Math.min(0, before), this.budget);
    this.onBudget?.(this.budget - before);
    return this.budget - before;
  }

  addDiary(entry) { this.diary.push(entry); if (this.diary.length > 80) this.diary.shift(); }

  save() {
    try {
      localStorage.setItem(GameState.KEY, JSON.stringify({
        v: 4, clubName: this.clubName, formation: this.formation, squad: this.squad, lineup: this.lineup,
        season: this.season, league: this.league, calendar: this.calendar, phase: this.phase,
        lastReport: this.lastReport, notebookUnlocked: this.notebookUnlocked, diary: this.diary, seasonStats: this.seasonStats, coachNotes: this.coachNotes, cheats: this.cheats,
        budget: this.budget, pendingEvent: this.pendingEvent, eventLog: this.eventLog, eventQueue: this.eventQueue,
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
      this.budget = Number.isFinite(d.budget) ? Math.round(d.budget) : ECONOMY.START;   // pre-v1.9 saves start with $500 (v2.2: debt allowed)
      this.eventQueue = Array.isArray(d.eventQueue) ? d.eventQueue.filter(q => q && q.id && q.due) : [];
      this.pendingEvent = d.pendingEvent && typeof d.pendingEvent === 'object' ? d.pendingEvent : null;
      this.eventLog = Array.isArray(d.eventLog) ? d.eventLog.slice(-60) : [];
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
        this.league = new League(d.league, new Set(this.squad.map(p => p.surname)));
        this.calendar = d.calendar;
        this.phase = d.phase || 'calendar';
        this.lastReport = d.lastReport || null;
        this.notebookUnlocked = !!d.notebookUnlocked;
        this.diary = Array.isArray(d.diary) ? d.diary : [];
        this.seasonStats = d.seasonStats && typeof d.seasonStats === 'object' ? d.seasonStats : {};
        this.coachNotes = d.coachNotes && typeof d.coachNotes === 'object' ? d.coachNotes : {};
        this.cheats = { forceWin: !!d.cheats?.forceWin };
        if (this.lastReport && !d.coachNotes) this.recordCoachNotes(this.lastReport);   // pre-v1.5 save
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

