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
    this.rep = { board: REP.START, parents: REP.START, squad: REP.START };   // v2.8 faction reputation
    this.duties = { captain: null, penalty: null, corner: null };            // v3.0 exclusive team duties (player ids)
    this.captaincy = GameState.freshCaptaincy();                               // v3.8 armband tenure + captain initiative cooldowns
    this.pendingEvent = null;      // v1.9: narrative event waiting for the coach's choice { id, date, cast, resume }
    this.eventLog = [];            // v1.9: [{ id, date, season, choice, who }]
    this.eventQueue = [];          // v2.2: scheduled events [{ id, due, matchDay, from }]
    this.today = null; this.week = null; this.away = null;   // v3.13: weekly plan / AP wallet / "while you were away"
    // v3.1 SANDBOX: a global database of 100 kids; the coach drafts 15 of them at the Yard Match
    const used = new Set();
    this.globalPlayers = GameState.buildWorld(used);
    this.squad = [];
    this.lineup = [];
    const free = shuffle(this.globalPlayers.filter(p => p.teamId === 'free_agent'));
    this.draft = { pool: free.slice(0, WORLD.DRAFT_POOL).map(p => p.id), signed: [] };
    this.newSeason(SEASON.FIRST_YEAR);
    this.phase = 'draft';
    this.save();
  }
  /** v3.1: 100 fully generated kids (hidden stats, biometrics, `teamId`): WORLD.RIVALS go to rival clubs, the rest are free agents. */
  static buildWorld(used, count = WORLD.SIZE, idFrom = 0) {
    const arch = [];
    for (const [k, n] of Object.entries(WORLD.MIX)) for (let i = 0; i < n; i++) arch.push(k);
    const players = shuffle(arch).slice(0, count).map((pos, i) => {
      const p = Player.generate(`g${idFrom + i}`, pos, used, 0, true, 0);
      p.teamId = 'free_agent';
      return p;
    });
    shuffle(players).slice(0, Math.min(WORLD.RIVALS, players.length)).forEach((p, i) => { p.teamId = `rival_${(i % 9) + 1}`; });
    return players;
  }
  /** v3.1 Yard Match draft. */
  draftSigned() { return this.draft?.signed || []; }
  toggleDraft(id) {
    if (this.phase !== 'draft' || !this.draft.pool.includes(id)) return;
    const s = this.draft.signed, i = s.indexOf(id);
    if (i >= 0) s.splice(i, 1);
    else if (s.length < WORLD.DRAFT_SIGN) s.push(id);
    this.save();
  }
  /** 15 signed → they become the academy (teamId 'player_team', shirts 1–15, no tags: fog of war). The tallest kid starts in goal. */
  finishDraft() {
    if (this.phase !== 'draft' || this.draft.signed.length !== WORLD.DRAFT_SIGN) return false;
    const byId = id => this.globalPlayers.find(p => p.id === id);
    this.squad = this.draft.signed.map((id, i) => { const p = byId(id); p.teamId = 'player_team'; p.number = i + 1; p.tag = null; p.refreshPortrait(); return p; });
    const keeper = [...this.squad].sort((a, b) => b.bio.height - a.bio.height)[0];
    this.lineup = [keeper.id, ...this.squad.filter(p => p !== keeper).slice(0, 10).map(p => p.id)];
    for (const p of this.squad) p.energy = 100;
    this.draft = null;
    this.phase = 'calendar';
    this.addDiary({ date: this.calendar.date, key: 'draft.diary', vars: { n: this.squad.length }, cls: 'ev' });
    this.save();
    return true;
  }

  newSeason(year) {
    this.season = year;
    this.league = League.create(this.clubName, this.league?.teams, new Set((this.globalPlayers || this.squad).map(p => p.surname)));
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
    const players = this.league.matchXI(opp, new Set(this.squad.map(p => p.surname)));   // v3.4: rotation by energy
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
    return [];   // v3.0: no native positions → nobody is "out of position" (kept for old callers)
  }
  static gkError() { return null; }   // v3.0: anyone may play in goal

  autoArrange() {
    const slots = this.slots();
    const pool = this.starters();
    const gk = pool.find(p => p.position === 'GK') || pool[0];   // v3.0: by the coach's tags (untagged kids just fill the gaps)
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
    if ((ia < 0) !== (ib < 0) && (ia >= 0 ? pa : pb).hasFlag('Showcase')) return 'showcase';   // v2.3: the scout came for him
    if (ia >= 0 && ib >= 0) {
      [this.lineup[ia], this.lineup[ib]] = [b, a];   // v3.0: any kid can go anywhere, goal included
    } else {
      const [slot, incoming] = ia >= 0 ? [ia, pb] : [ib, pa];
      this.lineup[slot] = incoming.id;
    }
    this.save();
    return null;
  }
  /* ---------- v3.0 coach's assignment: visual position tag + exclusive duties ---------- */
  setPosTag(id, tag) {
    const p = this.player(id);
    if (!p) return;
    p.tag = POS_ORDER[tag] !== undefined && p.tag !== tag ? tag : null;   // clicking the active tag clears it
    p.refreshPortrait();
    this.save();
  }
  /** Exclusive: assigning a duty takes it away from whoever had it. Clicking the holder again clears it.
      v3.8: a captain who loses the armband reacts (leader −3 / anxious +2 relief, once per REACT_CD days). Returns that diary line or null. */
  setDuty(duty, id) {
    if (!(duty in DUTIES)) return null;
    const prev = this.duties[duty], next = prev === id ? null : id;
    this.duties[duty] = next;
    let line = null;
    if (duty === 'captain' && prev && prev !== next) line = this.relieveCaptain(this.player(prev));
    this.save();
    return line;
  }

  /* ---------- v3.8 HIDDEN LEADERSHIP: armband reactions, captain initiatives, resignation ---------- */
  static freshCaptaincy(o = {}) {
    return { id: o.id || null, matches: Math.max(0, Math.round(o.matches || 0)), shock: !!o.shock, hold: Math.max(0, Math.round(o.hold || 0)),
      initUntil: o.initUntil || null, pauseUntil: o.pauseUntil || null, assigns: Math.max(0, Math.round(o.assigns || 0)) };
  }
  /** Armband tenure of the CURRENT captain (resets lazily whenever the armband changes hands; cooldown dates survive). */
  get capt() {
    const c = this.captaincy || (this.captaincy = GameState.freshCaptaincy()), id = this.duties?.captain || null;
    if (c.id !== id) Object.assign(c, { id, matches: 0, shock: false, hold: 0 });
    return c;
  }
  captainTier(p) { return p.leadership >= LEADERSHIP.LEADER ? 'high' : p.leadership <= LEADERSHIP.ANXIOUS ? 'low' : 'mid'; }
  /** Morale from an armband change — skipped while his reaction cooldown runs (no farming by toggling the armband). Returns the applied delta. */
  captainReaction(p, delta) {
    if (!p || !delta || p.captainReactionCooldown > 0) return 0;
    p.dyn.morale = clamp(Math.round(p.dyn.morale + delta), 0, 100);
    p.captainReactionCooldown = LEADERSHIP.REACT_CD;
    return delta;
  }
  /** The armband is taken off him: a real leader is hurt, an anxious kid is relieved. */
  relieveCaptain(p) {
    if (!p?.tags) return null;
    const t = this.captainTier(p), d = t === 'high' ? LEADERSHIP.STRIP_LEADER : t === 'low' ? LEADERSHIP.STRIP_ANXIOUS : 0;
    if (!this.captainReaction(p, d)) return null;
    const key = 'ca.strip.' + t;
    this.addDiary({ date: this.calendar.date, key, vars: { k: { pid: p.id } }, cls: 'ev' });
    return key;
  }
  /** Coach confirmed the armband in the assignment dialogue. keep=false (low tier) → nothing changes. Returns the applied morale delta. */
  confirmCaptain(id, keep = true) {
    const p = this.player(id);
    if (!p || !keep) return 0;
    if (this.duties.captain !== id) this.setDuty('captain', id);
    const t = this.captainTier(p);
    const d = this.captainReaction(p, t === 'high' ? LEADERSHIP.HIGH_MORALE : t === 'mid' ? LEADERSHIP.MID_MORALE : LEADERSHIP.LOW_KEEP_MORALE);
    this.capt.assigns++;
    this.save();
    return d;
  }
  /** Seeded index (0–3) of the reaction line: same dialogue after a reload, a new line for every new assignment. */
  captainLine(id, date = this.calendar.date) { return Math.floor(seeded(date + '#ca#' + id + '#' + this.capt.assigns)() * 4); }
  /** Daily: reaction cooldowns tick down. */
  captainDaily() { for (const p of this.squad) if (p.captainReactionCooldown > 0) p.captainReactionCooldown--; }
  /** Locker room (rolled with the arrivals, AFTER excuses and position requests): the captain may come to the coach.
      ≤ ANXIOUS → asks to hand back the armband; ≥ LEADER → asks to play a benched teammate; ≥ OBS_LEAD → spots a kid out of position. */
  rollCaptainRequest(absent, date = this.calendar.date) {
    if (this.excusesOff) return null;
    const c = this.player(this.duties?.captain), k = this.capt, Ld = LEADERSHIP;
    if (!c || absent[c.id]) return null;
    const here = this.squad.filter(p => p !== c && !absent[p.id]);
    if (c.leadership <= Ld.ANXIOUS) {
      if (k.hold > 0 || (k.matches < Ld.RESIGN_MIN && !k.shock)) return null;
      const step = clamp(k.matches - Ld.RESIGN_MIN + (k.shock ? 1 : 0), 0, Ld.RESIGN_CHANCE.length - 1);
      if (seeded(date + '#capresign#' + c.id)() >= Ld.RESIGN_CHANCE[step]) return null;
      const hint = here.filter(p => p.leadership >= Ld.LEADER).sort((a, b) => b.leadership - a.leadership || a.id.localeCompare(b.id))[0];
      return { kind: 'resign', pid: c.id, hint: hint ? hint.id : null, done: false };
    }
    if ((k.initUntil && date < k.initUntil) || (k.pauseUntil && date < k.pauseUntil)) return null;
    if (c.leadership >= Ld.LEADER) {
      const m = here.filter(p => p.available && p.benchStreak >= Ld.BENCH_MIN && p.dyn.morale < Ld.BENCH_MORALE && !p.promisedPitchTime)
        .sort((a, b) => b.benchStreak - a.benchStreak || a.dyn.morale - b.dyn.morale || a.id.localeCompare(b.id))[0];
      if (m && seeded(date + '#capbench#' + c.id + '#' + m.id)() < Ld.BENCH_BASE + (c.leadership - Ld.LEADER) * Ld.BENCH_STEP) return { kind: 'bench', pid: c.id, mate: m.id, done: false };
    }
    if (c.leadership >= Ld.OBS_LEAD) {
      const m = here.filter(p => p.outOfPositionMatches >= Ld.OBS_MIN && p.archetype)
        .sort((a, b) => b.outOfPositionMatches - a.outOfPositionMatches || a.id.localeCompare(b.id))[0];
      if (m && seeded(date + '#capobs#' + c.id + '#' + m.id)() < Ld.OBS_BASE + (c.leadership - Ld.OBS_LEAD) * Ld.OBS_STEP) return { kind: 'obs', pid: c.id, mate: m.id, done: false };
    }
    return null;
  }
  /** After every league match (live + Quick Sim), BEFORE suspensions / injuries tick: armband tenure, bench streaks, promised pitch time. */
  trackCaptaincy(eng, result, cap = null) {
    const k = this.capt, Ld = LEADERSHIP, date = this.calendar.date;
    if (k.id) { k.matches++; k.shock = result === 'L' || (cap?.id === k.id && cap.breakdown != null); if (k.hold > 0) k.hold--; }
    for (const p of this.squad) {
      const played = eng.everPlayed.has(p.id);
      if (played) p.benchStreak = 0; else if (p.available) p.benchStreak++;
      if (p.promisedPitchTime) {
        p.promisedPitchTime = false;
        const ok = played;
        p.dyn.morale = clamp(p.dyn.morale + (ok ? Ld.PROMISE_KEPT : Ld.PROMISE_BROKEN), 0, 100);
        this.addRep('squad', ok ? Ld.PROMISE_KEPT_SQUAD : Ld.PROMISE_BROKEN_SQUAD);
        this.addDiary({ date, key: ok ? 'cb.kept' : 'cb.broken', vars: { k: { pid: p.id } }, cls: 'ev' });
      }
      p.capPressure = 0;
    }
  }
  dutiesOf(id) { return Object.keys(DUTIES).filter(d => this.duties?.[d] === id); }
  setTag(id, tag) { const p = this.player(id); if (p && TAGS[tag]) { p.tags = [tag]; this.save(); } }
  removeTag(id, tag) { const p = this.player(id); if (p) { p.tags = p.tags.filter(t => t !== tag); this.save(); } }

  /* ----- energy ----- */
  /** Rest day: condition +10, match sharpness fades −2 (floor 20), morale drifts 1 point toward 60. */
  restDay() { this.dayRoutine(null, false); }
  /** v2.5: today's coach state { date, briefed, locker, observe } — resets lazily every morning (whatever advanced the calendar).
      v3.13: action points moved to the weekly wallet (weekState), the training regime to the weekly plan. */
  dayState() {
    if (!this.today || this.today.date !== this.calendar.date) this.today = { date: this.calendar.date };
    return this.today;
  }
  get ap() { return this.weekState().ap; }
  /* ---------- v3.13 WEEKLY PLAN + WEEKLY ACTION POINTS ---------- */
  /** The current week (Mon–Sun), created lazily when the calendar enters a new week (never rolls backwards). */
  weekState() {
    const start = weekStartOf(this.calendar.date), w = this.week;
    if (w && w.start >= start) return w;
    const prev = w && isoAdd(w.start, 7) === start ? w : null;
    const carry = prev ? Math.min(WEEK.CARRY_MAX, Math.max(0, prev.ap)) : 0;
    const win = this.lastResult() === 'W' ? WEEK.WIN_BONUS : 0;
    const ap = Math.min(WEEK.AP_MAX, WEEK.AP_BASE + carry + win);
    this.week = { start, plan: Object.fromEntries(WEEK.PLAN_KEYS.map(k => [k, null])), confirmed: false, ap, carry, trainingsDone: 0,
      apSources: { base: WEEK.AP_BASE, carry, win, total: ap } };
    if (!this.plannableDays().length) {   // nothing left to plan (the season opens on a Sunday): a stub week, no AP to carry
      Object.assign(this.week, { confirmed: true, ap: 0, carry: 0, apSources: { base: 0, carry: 0, win: 0, total: 0 } });
    }
    return this.week;
  }
  /** Pre-v3.13 save in the middle of a week: Tue + Thu with the default regime (today's old pick kept), confirmed, base AP. */
  static migrateWeek(date, oldPlan) {
    const start = weekStartOf(date), plan = Object.fromEntries(WEEK.PLAN_KEYS.map(k => [k, null]));
    for (const k of WEEK.DEFAULT_DAYS) plan[k] = WEEK.DEFAULT_REGIME;
    if (REGIMES[oldPlan] && plan[weekKey(date)]) plan[weekKey(date)] = oldPlan;
    const done = WEEK.PLAN_KEYS.filter((k, i) => plan[k] && isoAdd(start, i) < date).length;
    return { start, plan, confirmed: true, ap: WEEK.AP_BASE, carry: 0, trainingsDone: done, apSources: { base: WEEK.AP_BASE, carry: 0, win: 0, total: WEEK.AP_BASE } };
  }
  /** 'W' | 'D' | 'L' of our last played league match (null before the first one). */
  lastResult() {
    const lg = this.league;
    const f = lg?.fixtures.filter(x => (x.home === 0 || x.away === 0) && lg.played(x)).sort((a, b) => b.md - a.md)[0];
    if (!f) return null;
    const gf = f.home === 0 ? f.hg : f.ag, ga = f.home === 0 ? f.ag : f.hg;
    return gf > ga ? 'W' : gf < ga ? 'L' : 'D';
  }
  matchOn(date) { return this.calendar.events.some(e => e.type === 'match' && e.date === date); }
  /** Mon–Fri of the current week: [{ k, date }]. */
  weekDays() { const w = this.weekState(); return WEEK.PLAN_KEYS.map((k, i) => ({ k, date: isoAdd(w.start, i) })); }
  /** Can the coach still change this day? Future days always; today only before the week is confirmed. */
  dayEditable(date) { const t = this.calendar.date; return !this.matchOn(date) && (date > t || (date === t && !this.weekState().confirmed)); }
  plannableDays() { return this.weekDays().filter(d => this.dayEditable(d.date)); }
  /** Does OUR club train on this day? (the weekly plan; AI clubs keep isTrainingDay) */
  isOurTraining(date) {
    if (!date) return false;
    const w = this.weekState();
    return weekStartOf(date) === w.start && !!w.plan[weekKey(date)] && !this.matchOn(date);
  }
  planOf(date) { return this.isOurTraining(date) ? this.week.plan[weekKey(date)] : null; }
  todayPlan() { return this.planOf(this.calendar.date); }
  /** 0-based number of this training within its week (attendance curve index). */
  trainingIndex(date) { return this.weekDays().filter(d => d.date <= date && this.isOurTraining(d.date)).length - 1; }
  trainingsPlanned() { return this.weekDays().filter(d => this.isOurTraining(d.date)).length; }
  /** PLANNER.EXE: Rest (null) or a regime for one weekday. Today's regime can change after confirming (not Rest ↔ Training). */
  setWeekPlan(k, regime) {
    const w = this.weekState(), day = this.weekDays().find(d => d.k === k);
    if (!day || (regime !== null && !REGIMES[regime])) return false;
    const todayRegime = day.date === this.calendar.date && w.confirmed && w.plan[k] && regime;   // until CONTINUE processes the day
    if (!this.dayEditable(day.date) && !todayRegime) return false;
    if (regime && !w.plan[k] && this.trainingsPlanned() >= WEEK.MAX_TRAININGS) return false;
    w.plan[k] = regime;
    this.save();
    return true;
  }
  confirmWeek() { this.weekState().confirmed = true; this.save(); }
  /** Sunday (daily hook): an empty gym or an overloaded week upsets the factions. */
  weekReview(date) {
    const w = this.weekState(), first = this.calendar.events[0] && isoAdd(this.calendar.events[0].date, -SEASON.FIRST_MATCH_OFFSET);
    if (weekKey(date) !== 'sun' || weekStartOf(date) !== w.start || (first && w.start < first)) return null;
    if (!w.trainingsDone) {
      this.addRep('board', WEEK.EMPTY_BOARD); this.addRep('parents', WEEK.EMPTY_PARENTS);
      this.addDiary({ date, key: 'week.empty', cls: 'ev' });
      return 'empty';
    }
    if (w.trainingsDone >= WEEK.HEAVY_FROM) {
      this.addRep('parents', WEEK.HEAVY_PARENTS);
      this.addDiary({ date, key: 'week.heavy', vars: { n: w.trainingsDone }, cls: 'ev' });
      return 'heavy';
    }
    return null;
  }
  /* ---------- v2.8 faction reputation ---------- */
  addRep(key, delta) { if (this.rep && key in this.rep) this.rep[key] = clamp(Math.round(this.rep[key] + delta), 0, 100); }
  /** Daily: squad rep drifts 1 toward the squad's average morale; 1st of the month: board grant; Sundays: parents. */
  repDaily(date) {
    this.captainDaily();   // v3.8
    const avg = this.squad.reduce((a, p) => a + p.dyn.morale, 0) / this.squad.length;
    this.addRep('squad', Math.sign(Math.round(avg) - this.rep.squad));
    const d = new Date(date + 'T00:00:00Z');
    const seasonStart = isoAdd(this.calendar.events[0]?.date || date, -SEASON.FIRST_MATCH_OFFSET);
    if (d.getUTCDate() === 1 && date > seasonStart) {   // no grant on the opening day of the season
      const grant = Math.max(0, Math.round(REP.BOARD_GRANT_BASE + (this.rep.board - 50) * REP.BOARD_GRANT_STEP));
      if (grant) this.addMoney(grant);
      this.addDiary({ date, key: grant ? 'rep.boardGrant' : 'rep.boardNone', vars: { m: '$' + grant }, cls: 'ev' });
    }
    if (d.getUTCDay() === 0) {
      if (this.rep.parents >= REP.PARENTS_HIGH) {
        const gift = rnd(10, 30) + (this.rep.parents - REP.PARENTS_HIGH);
        this.addMoney(gift);
        this.addDiary({ date, key: 'rep.parentsGift', vars: { m: '$' + gift }, cls: 'ev' });
      } else if (this.rep.parents <= REP.PARENTS_LOW) {
        const kid = pick(this.squad.filter(p => p.available));
        if (kid) { kid.awayDays = Math.max(kid.awayDays, REP.PARENTS_HOME_DAYS); this.addDiary({ date, key: 'rep.parentsAngry', vars: { k: { pid: kid.id }, d: REP.PARENTS_HOME_DAYS }, cls: 'ev' }); }
      }
    }
  }
  spendAP() { const w = this.weekState(); if (w.ap < 1) return false; w.ap--; this.save(); return true; }
  /** TODAY widget: change today's regime (only on a planned training day). */
  setPlan(plan) { const d = this.calendar.date; if (REGIMES[plan] && this.isOurTraining(d)) this.setWeekPlan(weekKey(d), plan); }
  /* ---------- v3.6 POSITION DISCOVERY ---------- */
  /** Practice Match: mark / unmark a present kid "Under Observation" (0 AP, at most POS_HINT.OBSERVE_MAX). Returns true if changed. */
  toggleObserve(id) {
    const d = this.dayState(), p = this.player(id);
    const list = d.observe = (d.observe || []).filter(x => this.player(x));
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else if (!p || !p.available || list.length >= POS_HINT.OBSERVE_MAX) return false;
    else list.push(id);
    this.save();
    return true;
  }
  /** Practice Match scouting: qualitative diary lines about the observed kids (or 1–2 random trainees).
      Compares the coach's tag with the HIDDEN archetype; never shows numbers. Seeded (no Math.random: RNG order stays). */
  practiceObservations(date, trained, chosen = []) {
    if (!trained.length) return [];
    const r = seeded(date + '#obs');
    let who = chosen.map(id => trained.find(p => p.id === id)).filter(Boolean);
    if (!who.length) {
      const pool = [...trained].sort((a, b) => a.id.localeCompare(b.id));
      const n = Math.min(pool.length, r() < 0.5 ? 1 : 2);
      while (who.length < n) who.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    }
    return who.map(p => {
      const ok = isPlayingNaturalPosition(p, p.tag), v = Math.floor(seeded(date + '#obs#' + p.id)() * 2);
      const o = { pid: p.id, ok, key: (ok ? 'obs.ok.' : 'obs.hint.' + p.archetype + '.') + v };
      // v3.7: sometimes a natural vocal leader / a kid who freezes under pressure shows it (even without the armband)
      const c = seeded(date + '#obscap#' + p.id);
      if (p.captainTrait && p.captainTrait !== 'normal' && c() < CAPTAIN.PRACTICE_CLUE) o.capKey = 'obs.cap.' + p.captainTrait + '.' + Math.floor(c() * 2);
      return o;
    });
  }
  /** After every league match (live and Quick Sim): straight matches outside the hidden archetype's line.
      Played in his natural line → reset to 0. Every kid's request cooldown ticks down by one match. */
  trackPositions(eng) {
    const played = eng.slotArchetypes(), changed = [];
    for (const p of this.squad) {
      if (p.positionHintCooldown > 0) p.positionHintCooldown--;
      if (!played.has(p.id)) continue;
      if (isPlayingNaturalPosition(p, played.get(p.id))) p.outOfPositionMatches = 0;
      else { p.outOfPositionMatches++; changed.push(p); }
    }
    return changed;
  }
  /** Locker room: maybe one present kid asks to play elsewhere (one per day, seeded by date + id: reload-proof). */
  rollPositionRequest(absent, date = this.calendar.date) {
    if (this.excusesOff) return null;
    const cands = this.squad.filter(p => !absent[p.id] && p.outOfPositionMatches >= POS_HINT.MIN && !p.positionHintCooldown)
      .sort((a, b) => b.outOfPositionMatches - a.outOfPositionMatches || a.id.localeCompare(b.id));
    for (const p of cands) if (seeded(date + '#posreq#' + p.id)() < positionRequestChance(p.outOfPositionMatches)) return { pid: p.id, done: false };
    return null;
  }
  /** v2.5: one random skill of a group +1. v3.12: only skills with growth room left are picked (gains < room, < 20), so
      a roll is never wasted on a maxed skill. Returns true if improved, 'plateau' if the whole group has no room left. */
  growSkill(p, g) {
    let keys = g.keys || ATTR_GROUPS[g.group];
    if (g.group === 'technical') keys = p.archetype === 'GK' ? ['goalkeeping', 'passing', 'firstTouch'] : keys.filter(k => k !== 'goalkeeping');
    const k = pick(keys.filter(k => canGrow(p, g.group, k)));   // same single Math.random as before
    if (!k) return 'plateau';
    p[g.group][k]++;
    (p.gains ||= {})[k] = (p.gains[k] || 0) + 1;
    return true;
  }
  /** v2.4: one non-match calendar day. Training day (Tue/Thu): fit kids roll vs discipline —
      attend → condition −10, sharpness +5; skip → no change + `skipped_training` (until the next day).
      Injured / kept-at-home kids rest. Returns { training, attended, skipped: [players] }. */
  /* ---------- v2.6 LOCKER ROOM: who turns up today ---------- */
  /** Why a kid would NOT come today (null = he arrives). */
  arrivalCheck(p) {
    if (p.injuryDays > 0) return 'injury';
    if (p.suspensionMatches > 0) return 'suspended';
    if (p.awayDays > 0) return 'home';
    if (p.energy < LOCKER.MIN_COND) return 'exhausted';
    if (Math.random() * 20 > p.psych.discipline + LOCKER.DISC_GRACE) return 'skipped';
    return null;
  }
  /** Rolls the arrivals once per day (training / match days). Absent kids are locked out until the next morning. */
  runLocker(training = this.isOurTraining(this.calendar.date), date = this.calendar.date) {
    const d = this.dayState();
    if (d.locker) return d.locker;
    const absent = {}, k = training ? this.trainingIndex(date) : -1;
    for (const p of this.squad) {
      let r = this.arrivalCheck(p);
      // v3.13: from the 3rd training of the week the kids who'd come may be kept home (school / not recovered) — not truancy
      if (!r && k >= ATTEND.FROM && seeded(date + '#load#' + p.id)() >= attendChance(p, k)) r = 'overload';
      p.absentToday = ['exhausted', 'skipped', 'overload'].includes(r) ? r : null;   // injured / banned / home are locked by their own status
      p.skipped_training = training && r === 'skipped';                   // feeds The Truant
      if (r) absent[p.id] = r;
    }
    d.locker = { done: false, revealed: false, absent, checked: [], request: this.rollExcuse(absent), posRequest: this.rollPositionRequest(absent) };   // v3.6
    d.locker.capRequest = d.locker.request || d.locker.posRequest ? null : this.rollCaptainRequest(absent);   // v3.8: urgent kid requests come first
    this.save();
    return d.locker;
  }
  /* ---------- v2.9 KICK OUT OF THE ACADEMY ---------- */
  /** Why this kid can't be expelled (i18n key) — or null. Keeps ≥ COACH.MIN_SQUAD kids and at least one goalkeeper. */
  expelBlock(id) {
    const p = this.player(id);
    if (!p) return 'office.kickNo.gone';
    if (this.squad.length <= COACH.MIN_SQUAD) return 'office.kickNo.size';
    return null;
  }
  /** Permanently removes a kid: squad, XI (best bench replacement), notes, queued events, today's locker, last report. */
  expel(id) {
    const p = this.player(id);
    if (!p || this.expelBlock(id)) return false;
    const slot = this.lineup.indexOf(id);
    this.squad = this.squad.filter(x => x !== p);
    if (slot >= 0) {
      const bench = this.squad.filter(x => !this.lineup.includes(x.id));
      const want = slot === 0 ? 'GK' : LINE_POS[this.slots()[slot].line];
      const score = b => (b.available ? 1000 : 0) + (b.position === want ? 100 : 0) + b.overall;   // v3.0: by the coach's tags
      const best = bench.sort((a, b) => score(b) - score(a))[0];
      this.lineup[slot] = best.id;
    }
    delete this.coachNotes[id];
    for (const d in this.duties) if (this.duties[d] === id) this.duties[d] = null;   // v3.0
    this.eventQueue = this.eventQueue.filter(q => !q.cast || ![].concat(...Object.values(q.cast)).includes(id));
    if (this.lastReport) this.lastReport.players = this.lastReport.players.filter(r => r.id !== id);
    const lk = this.today?.locker;
    if (lk) { delete lk.absent[id]; lk.checked = lk.checked.filter(x => x !== id); if (lk.request?.pid === id) lk.request = null; if (lk.posRequest?.pid === id) lk.posRequest = null;
      if ([lk.capRequest?.pid, lk.capRequest?.mate, lk.capRequest?.hint].includes(id)) lk.capRequest = null; }   // v3.8
    p.teamId = 'free_agent';   // v3.1: he stays in the world database (future transfers)
    (this.expelled = this.expelled || []).push({ id, name: p.name, number: p.number, date: this.calendar.date });
    this.save();
    return true;
  }

  /** v2.8: "Immediate request" — maybe one present kid asks to go home (low discipline asks more). Rolled with the arrivals. */
  rollExcuse(absent) {
    if (this.excusesOff) return null;
    for (const p of shuffle(this.squad.filter(x => !absent[x.id]))) {
      if (Math.random() < EXCUSE.BASE + (20 - p.psych.discipline) * EXCUSE.PER_DISC) return { pid: p.id, kind: pick(EXCUSE.KINDS), done: false };
    }
    return null;
  }
  /** Every morning (and after a match): nobody is "absent" any more. */
  clearDayStatus() { for (const p of this.squad) { p.absentToday = null; p.skipped_training = false; } }

  dayRoutine(date, training = this.isOurTraining(date), plan = this.planOf(date) || WEEK.DEFAULT_REGIME) {
    const skipped = [], improved = [], plateau = [], hurt = [], trained = [], R = REGIMES[plan] || REGIMES.match;
    let attended = 0;
    if (training) { const lk = this.runLocker(true, date || this.calendar.date); lk.done = true; }   // auto-sim: arrivals are rolled without the view
    if (training && date && weekStartOf(date) === this.weekState().start) this.week.trainingsDone++;   // v3.13: Sunday review
    else this.clearDayStatus();
    for (const p of this.squad) {
      const present = training && p.available;   // v2.6: only kids who came to the locker room train
      const walkOut = present && R.extraSkip && p.psych.discipline < R.lowDisc && Math.random() < R.extraSkip;   // v2.5: tactics bore the restless ones
      if (walkOut) { p.skipped_training = true; }
      if (p.skipped_training) skipped.push(p);
      const trains = present && !walkOut;
      if (training && p.skipped_training) { /* skipped: no tiredness, no sharpness (exhausted / injured kids rest) */ }
      else if (trains) {   // v2.5: the coach's regime
        attended++; trained.push(p);
        p.energy = clamp(p.energy + R.cond, 0, 100);
        p.dyn.sharpness = clamp(p.dyn.sharpness + R.sharp, 0, 100);
        if (R.morale) p.dyn.morale = clamp(p.dyn.morale + R.morale, 0, 100);
        if (R.grow && Math.random() < R.grow.chance * growthMult(p)) {
          const res = this.growSkill(p, R.grow);
          if (res === true) improved.push(p);
          else if (res === 'plateau' && !(p.plateau ||= []).includes(R.grow.group)) { p.plateau.push(R.grow.group); plateau.push(p); }   // v3.11: told once per group
        }
        if (R.injury && Math.random() < R.injury) { p.injuryDays = Math.max(p.injuryDays, rnd(...R.injDays)); hurt.push(p); }
      } else {
        p.energy = clamp(p.energy + ENERGY.DAILY_REST, 0, 100);
        p.dyn.sharpness = Math.max(SHARPNESS.FLOOR, p.dyn.sharpness + SHARPNESS.DAILY);
      }
      p.dyn.morale += Math.sign(MORALE.DRIFT_TO - p.dyn.morale);
    }
    this.tickInjuries();
    this.league?.aiDay(!!date && isTrainingDay(date));   // v3.4: AI clubs rest / train on the same calendar (v3.13: always Tue / Thu)
    // v3.6: Practice Match = scouting — the coach watches the marked kids (or 1–2 random ones) play
    const observed = training && plan === 'match'
      ? this.practiceObservations(date || this.calendar.date, trained, this.today?.date === date ? this.today.observe || [] : []) : [];
    return { training, plan: training ? plan : null, attended, skipped, improved, plateau, hurt, observed };
  }
  /** v2.2: one calendar day of healing (rest days AND the match day itself). Returns kids who just got fit. */
  tickInjuries() {
    const healed = [];
    for (const p of this.squad) if (p.injuryDays > 0 && --p.injuryDays === 0) healed.push(p);
    for (const p of healed) this.addDiary({ date: this.calendar.date, key: 'inj.healed', vars: { k: { pid: p.id } }, cls: 'ev' });
    for (const p of this.squad) if (p.awayDays > 0 && --p.awayDays === 0)   // v2.3: back from "home arrest"
      this.addDiary({ date: this.calendar.date, key: 'home.back', vars: { k: { pid: p.id } }, cls: 'ev' });
    return healed;
  }
  /** v2.2: injured / suspended / benched-by-deal starters are replaced by the best available bench kid
      (same position first). Returns [{ out, in }] so the UI can tell the coach. */
  /** v2.3: scout showcase — flagged kids must be in the XI (they replace the weakest starter of their line). */
  ensureShowcaseXI() {
    const slots = this.slots();
    for (const p of this.squad.filter(x => x.hasFlag('Showcase') && x.available && !this.isStarter(x.id))) {
      const idx = this.lineup.map((id, i) => ({ i, q: this.player(id) }))
        .filter(({ i, q }) => i > 0 && p.position !== 'GK' && !q.hasFlag('Showcase'))
        .sort((a, b) => (LINE_POS[slots[b.i].line] === p.position) - (LINE_POS[slots[a.i].line] === p.position) || a.q.overall - b.q.overall)[0]
        || (p.position === 'GK' && !this.player(this.lineup[0]).hasFlag('Showcase') ? { i: 0 } : null);
      if (idx) this.lineup[idx.i] = p.id;
    }
    this.save();
  }
  ensureAvailableXI() {
    const slots = this.slots(), changes = [];
    this.lineup.forEach((id, i) => {
      const p = this.player(id);
      if (!p || p.available) return;
      const bench = this.bench().filter(b => b.available);
      const want = i === 0 ? 'GK' : LINE_POS[slots[i].line];
      const score = b => (b.position === want ? 100 : 0) + (i === 0 ? (b.position === 'GK' ? 1000 : 0) : (b.position === 'GK' ? -1000 : 0)) + b.overall;   // v3.0: tags, not hidden roles
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
  applyMatchDynamics(eng, result, cap = eng.captainReport?.()) {
    const rm = REP.MATCH[result];   // v2.8: results move the Board and the dressing room
    if (rm) { this.addRep('board', rm.board); this.addRep('squad', rm.squad); }
    const subIn = new Set(eng.subs.map(x => x.in));
    for (const p of this.squad) {
      const played = eng.everPlayed.has(p.id), st = eng.stats.get(p.id);
      const sh = !played ? SHARPNESS.UNUSED : subIn.has(p.id) || eng.subbedOff.has(p.id) ? SHARPNESS.SUB : SHARPNESS.PLAYED;
      p.dyn.sharpness = clamp(p.dyn.sharpness + sh, 0, 100);
      let m = MORALE[result] + (st ? st.goals * MORALE.GOAL + st.red * MORALE.RED : 0);
      if (!played) m -= 2;
      p.dyn.morale = clamp(Math.round(p.dyn.morale + m * (0.6 + p.psych.passion / 25)), 0, 100);
      if (played && cap?.trait === 'leader') p.dyn.morale = clamp(p.dyn.morale + CAPTAIN.POST_MORALE, 0, 100);   // v3.7: a real leader lifts the dressing room
    }
  }
  /** v3.5: the post-match team talk is still owed (lastReport.talk === null; older saves have no field = done). */
  get talkPending() { return this.phase === 'post' && !!this.lastReport && this.lastReport.talk === null; }
  /** v3.5: apply the chosen post-match talk once (TEAM_TALK table), log it in the diary and save. Returns the effects or null. */
  applyTeamTalk(key) {
    const rep = this.lastReport, fx = rep && talkEffects(key, rep);
    if (!fx || !this.talkPending) return null;
    for (const p of this.squad) {
      if (fx.morale) p.dyn.morale = clamp(Math.round(p.dyn.morale + fx.morale), 0, 100);
      if (fx.disc && p.psych.discipline < TEAM_TALK.DISC_CAP) p.psych.discipline = Math.min(TEAM_TALK.DISC_CAP, p.psych.discipline + fx.disc);
    }
    for (const k of ['board', 'parents', 'squad']) if (fx[k]) this.addRep(k, fx[k]);
    rep.talk = key;
    this.addDiary({ date: this.calendar.date, key: 'tt.diary', vars: { o: { team: rep.opponent }, t: { talk: key }, r: { talkReact: key + '.' + talkOutcome(rep) } }, cls: 'ev' });   // v3.9: + the dressing-room reaction
    this.save();
    return fx;
  }
  /** v3.9: a Quick Sim matchday closed without opening the Match Summary — no talk, no effects (never a soft-lock). */
  skipTeamTalk() {
    if (!this.talkPending) return;
    this.lastReport.talk = 'none';
    this.addDiary({ date: this.calendar.date, key: 'tt.skipped', vars: { o: { team: this.lastReport.opponent } }, cls: 'ev' });
    this.save();
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

  addDiary(entry) {
    this.diary.push(entry); if (this.diary.length > 80) this.diary.shift();
    if (this.away) { this.away.push(entry); if (this.away.length > 40) this.away.shift(); }   // v3.13: CONTINUE → next morning briefing
  }

  save() {
    try {
      localStorage.setItem(GameState.KEY, JSON.stringify({
        v: 4, clubName: this.clubName, formation: this.formation, squad: this.squad, lineup: this.lineup,
        pool: (this.globalPlayers || []).filter(p => !this.squad.includes(p)), draft: this.draft || null,   // v3.1 world database
        season: this.season, league: this.league, calendar: this.calendar, phase: this.phase,
        lastReport: this.lastReport, notebookUnlocked: this.notebookUnlocked, diary: this.diary, seasonStats: this.seasonStats, coachNotes: this.coachNotes, cheats: this.cheats,
        budget: this.budget, rep: this.rep, duties: this.duties, captaincy: this.captaincy, today: this.today, week: this.week || null, away: this.away || null, expelled: this.expelled || [], pendingEvent: this.pendingEvent, eventLog: this.eventLog, eventQueue: this.eventQueue,
      }));
    } catch (e) { /* storage unavailable: play in memory */ }
  }
  load() {
    try {
      const raw = localStorage.getItem(GameState.KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (d.phase === 'draft' && Array.isArray(d.pool) && d.draft) {   // v3.1: reload in the middle of the Yard Match
        this.newAcademy();
        this.globalPlayers = d.pool.map(p => new Player({ ...p, tags: [] }));
        this.draft = { pool: d.draft.pool.filter(id => this.globalPlayers.some(p => p.id === id)), signed: (d.draft.signed || []).filter(id => d.draft.pool.includes(id)) };
        this.save();
        return true;
      }
      if (!Array.isArray(d.squad) || d.squad.length < 11) return false;
      this.clubName = d.clubName || CLUB_NAME;
      this.formation = FORMATIONS[d.formation] ? d.formation : '4-4-2';
      this.budget = Number.isFinite(d.budget) ? Math.round(d.budget) : ECONOMY.START;   // pre-v1.9 saves start with $500 (v2.2: debt allowed)
      this.today = d.today && typeof d.today === 'object' ? d.today : null;   // v2.5
      this.away = Array.isArray(d.away) ? d.away : null;   // v3.13 "while you were away"
      this.expelled = Array.isArray(d.expelled) ? d.expelled : [];   // v2.9
      const r = d.rep || {};   // v2.8 (older saves start neutral)
      this.rep = { board: clamp(r.board ?? REP.START, 0, 100), parents: clamp(r.parents ?? REP.START, 0, 100), squad: clamp(r.squad ?? REP.START, 0, 100) };
      this.eventQueue = Array.isArray(d.eventQueue) ? d.eventQueue.filter(q => q && q.id && q.due) : [];
      this.pendingEvent = d.pendingEvent && typeof d.pendingEvent === 'object' ? d.pendingEvent : null;
      this.eventLog = Array.isArray(d.eventLog) ? d.eventLog.slice(-60) : [];
      this.squad = d.squad.map(p => new Player({ ...p, tags: (Array.isArray(p.tags) ? p.tags : []).filter(t => TAGS[t]).slice(0, 1) }));
      // v3.1: the world database (older saves get one: the rest of the 100 kids are generated around the squad)
      for (const p of this.squad) p.teamId = 'player_team';
      const rest = Array.isArray(d.pool) ? d.pool.map(p => new Player({ ...p, tags: [] }))
        : GameState.buildWorld(new Set(this.squad.map(p => p.surname)), Math.max(0, WORLD.SIZE - this.squad.length), 1000);
      this.globalPlayers = [...this.squad, ...rest];
      this.draft = null;
      const du = d.duties || {};   // v3.0 (after the squad: duties point at kids)
      this.duties = Object.fromEntries(Object.keys(DUTIES).map(k => [k, du[k] && this.player(du[k]) ? du[k] : null]));
      this.captaincy = GameState.freshCaptaincy(d.captaincy && typeof d.captaincy === 'object' ? d.captaincy : { id: this.duties.captain });   // v3.8 (older saves: tenure 0)
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
      if (!d.v || d.v < 3) this.autoArrange();
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
        // v3.13: weekly plan (pre-v3.13 saves: Tue + Thu, confirmed, base AP — the current day is never broken)
        this.week = d.week && typeof d.week === 'object' && d.week.plan && d.week.start ? d.week : GameState.migrateWeek(this.calendar.date, d.today?.plan);
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

