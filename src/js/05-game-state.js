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
    this.today = null; this.week = null; this.away = null; this.worldEvent = null; this.worldLast = null;   // (v3.14 world events)
    this.review = null; this.lossStreak = 0;   // v3.19 REVIEW.EXE + losses in a row
    this.after = null; this.parentComplaints = [];   // v3.20 AFTER_GAME.EXE + parents' "wrong role" complaints
    this.cohesion = COH.START; this.stats = {};   // v3.21 team cohesion + DEBUG attention metrics
    this.worldSalt = null; this.ledger = {}; this.fees = null; this.newsSeen = {}; this.excuseLog = []; this.fines = []; this.gkByHand = null;   // v3.15: world seed salt, money ledger, this month's fees   // v3.13: weekly plan / AP wallet / "while you were away"
    // v3.1 SANDBOX: a global database of 100 kids; the coach drafts 15 of them at the Yard Match
    const used = new Set();
    this.globalPlayers = GameState.buildWorld(used);
    this.squad = [];
    this.lineup = [];
    const free = shuffle(this.globalPlayers.filter(p => p.teamId === 'free_agent'));
    this.draft = { pool: free.slice(0, WORLD.DRAFT_POOL).map(p => p.id), signed: [] };
    makeTwins(this.globalPlayers, this.draft.pool);   // v3.25: two pairs of twins, own seeded stream (world RNG order untouched)
    this.bonds = null; this.bondMeta = { known: {}, matches: {} }; this.draft.twins = {};   // v3.25 bonds (built at the end of the draft)
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
    for (const p of this.squad) this.addYardClues(p, this.calendar.date);   // v3.23: the draft notes → clues
    this.initBonds(this.calendar.date);   // v3.25: yard / school / twins → the starting bonds
    this.draftBondNotes(this.calendar.date);
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
    for (const p of this.squad) { p.energy = 100; p.banned = []; }   // summer break; v3.19: banished REVIEW roles come back
    this.review = null; this.lossStreak = 0;   // v3.19
    this.after = null; this.parentComplaints = [];   // v3.20
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
    // v3.0: by the coach's tags (untagged kids just fill the gaps). v3.24: a keeper the coach put in goal himself stays; else
    // keeperPick (tag GK → yard note "hands" → kept goal most this season), else the current keeper.
    const gk = pool[0] && this.gkByHand === pool[0].id ? pool[0] : this.keeperPick(pool) || pool[0];
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
    this.bondSeparate?.();   // v3.25: two kids the coach KNOWS don't get on are not put side by side (if it costs ≤ 0.5)
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
    if (ia === 0 || ib === 0) this.gkByHand = this.lineup[0];   // v3.24: the coach chose this keeper — the auto lineup leaves him there
    this.save();
    return null;
  }
  /* ---------- v3.24 the auto lineup's keeper: only what the coach can see, never hidden skills ---------- */
  /** What he saw in the yard match (kept since the draft; older saves: DraftView.notes). */
  yardNotesOf(p) { return p.yardNotes || (typeof DraftView !== 'undefined' ? DraftView.notes(p) : []); }
  /** League matches he finished in goal this season. */
  keptGoal(id) { return this.seasonStats?.[id]?.kept || 0; }
  /** 3 = tagged GK, 2 = yard note "hands" ("safe hands in goal"), 1 = has kept goal this season, 0 = nothing visible. */
  keeperTier(p) { return p.position === 'GK' ? 3 : this.yardNotesOf(p).includes('hands') ? 2 : this.keptGoal(p.id) > 0 ? 1 : 0; }
  /** The best visible keeper among `cands` (their order breaks the last ties), or null → the caller's old rule. */
  keeperPick(cands, benchIds = null) {
    const c = cands.filter(p => p && this.keeperTier(p) > 0);
    if (!c.length) return null;
    const onBench = p => (benchIds && benchIds.has(p.id) ? 1 : 0);
    return c.map((p, i) => ({ p, i })).sort((a, b) => this.keeperTier(b.p) - this.keeperTier(a.p) || onBench(b.p) - onBench(a.p)
      || this.keptGoal(b.p.id) - this.keptGoal(a.p.id) || a.i - b.i)[0].p;
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
    this.notePraise(p);   // v3.25: the armband counts as praise
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
  /* ---------- v3.19 GROWTH: roles with levels, two slots; they come only from REVIEW.EXE ---------- */
  /** Morale cost of removing this role now (0 = free): free until it has played a league match (a misclick in the latest
      REVIEW, a migrated role that never played) or with `free` (v3.20: after the "After the game" talk; no caller yet). */
  roleChangeCost(p, free = false, roleId = null) {
    const r = roleId ? rolesOf(p).find(x => x.id === roleId) : rolesOf(p).find(x => x.m > 0);
    return !free && r && r.m > 0 ? ROLES.CHANGE_MORALE : 0;
  }
  /** The Notebook's / roster's [ Remove role ] (v3.18 rules: −3 morale once the role has played a match). Returns the morale change. */
  removeRole(id, roleId, { free = false } = {}) {
    const p = this.player(id), r = rolesOf(p).find(x => x.id === roleId);
    if (!r) return 0;
    const cost = this.roleChangeCost(p, free, roleId);
    p.roles = p.roles.filter(x => x !== r);
    this.pruneComplaints();   // v3.20: a removed role ends a parent's complaint
    if (cost) {
      p.dyn.morale = clamp(p.dyn.morale + cost, 0, 100);
      this.addDiary({ date: this.calendar.date, key: 'role.drop', vars: { k: { pid: p.id }, r: { role: roleId }, m: cost }, cls: 'ev' });
    }
    this.save();
    return cost;
  }
  removeTag(id, tag) { return this.removeRole(id, tag); }   // v3.18 name (roster ✕)
  /** After every league match: each role of a kid who played has now "played" once more (removing it costs morale). */
  trackRoles(playedIds) { for (const p of this.squad) if (playedIds.has(p.id)) for (const r of rolesOf(p)) r.m++; }

  /* ---------- v3.19 REVIEW.EXE: 1 of 3 cards for the man of the match after a win (draw: 1 of 2) ---------- */
  /** Every card he may be offered now: new role (free slot, no clash), +1 level (< LEVELS), replace (slots full; no clash with
      the role he keeps). Banished roles never come back this season. */
  reviewPool(p) {
    if (GameState.isKeeper(p)) return [];   // v3.23: keeper roles are a separate version — nobody offers a keeper a role
    const held = rolesOf(p), ids = held.map(r => r.id), out = [];
    const fresh = ROLE_IDS.filter(id => !ids.includes(id) && !(p.banned || []).includes(id));
    if (held.length < ROLES.SLOTS) for (const id of fresh) if (!ids.some(h => roleClash(h, id))) out.push({ type: 'new', role: id });
    for (const r of held) if (r.level < ROLES.LEVELS) out.push({ type: 'up', role: r.id });
    if (held.length >= ROLES.SLOTS) for (const r of held) for (const id of fresh) if (!ids.some(h => h !== r.id && roleClash(h, id))) out.push({ type: 'swap', role: id, replaces: r.id });
    return out;
  }
  /** v3.23: a kid the coach tagged GK. Roles are not for him yet (REVIEW, free rethink); a role he already holds stays. */
  static isKeeper(p) { return !!p && p.tag === 'GK'; }
  /** v3.23: the man of the match among [[id, stats]] (the caller passes OUTFIELD kids only): best matchRating, a tie → seeded(date#motm).
      Shared by REVIEW (startReview) and the Notebook (lastReport.motm), so they always agree. Returns { pid, rating, stats } or null. */
  pickMotm(kids, date) {
    kids = kids.filter(([id]) => this.player(id));
    if (!kids.length) return null;
    const best = Math.max(...kids.map(([, st]) => matchRating(st)));
    const top = kids.filter(([, st]) => matchRating(st) >= best - 1e-9).map(([id]) => id).sort();
    const pid = top.length > 1 ? top[Math.floor(seeded(date + '#motm')() * top.length)] : top[0];
    return { pid, rating: best, stats: { ...kids.find(k => k[0] === pid)[1] } };
  }
  /** Card weight: base 1 + EVIDENCE_W × how much of his role's signal he showed this match (CLUE_SIGNALS stats / lots, capped at 1). */
  static reviewWeight(card, stats) {
    const sig = CLUE_SIGNALS[ROLE_BY_ID[card.role].signal];
    return 1 + REVIEW.EVIDENCE_W * Math.min(1, sig.stats.reduce((a, k) => a + (stats?.[k] || 0), 0) / sig.lots);
  }
  /** rv.n weighted cards without repeats, seeded(date#review#id + salt). */
  rollReviewCards(p, rv, salt = '') {
    const r = seeded(rv.date + '#review#' + p.id + salt);
    const pool = this.reviewPool(p).map(c => ({ c, w: GameState.reviewWeight(c, rv.stats) })), out = [];
    while (out.length < rv.n && pool.length) {
      let x = r() * pool.reduce((a, b) => a + b.w, 0), i = 0;
      for (; i < pool.length - 1; i++) if ((x -= pool[i].w) < 0) break;
      out.push(pool.splice(i, 1)[0].c);
    }
    return out;
  }
  /** "He lit up when you mentioned it": with LIKE_HINT one card gets the mark — a fitting role, or (CLUES.WRONG) a random other
      card. It is a clue, so it also goes to p.clues (source 'review'). No fitting card and not a wrong roll → no mark. */
  reviewLike(p, rv) {
    const h = seeded(rv.date + '#reviewlike#' + p.id);
    if (h() >= REVIEW.LIKE_HINT) return;
    const idx = rv.cards.map((c, i) => i), fit = idx.filter(i => roleFits(p, rv.cards[i].role)), other = idx.filter(i => !fit.includes(i));
    const from = h() < CLUES.WRONG ? other : fit;
    if (!from.length) return;
    const c = rv.cards[from[Math.floor(h() * from.length)]], signal = ROLE_BY_ID[c.role].signal;
    c.like = true;
    this.addClue(p, { date: rv.date, source: 'review', ref: rv.md, signal, textKey: 'clue.like.' + signal });
  }
  /** After our match (live + Quick Sim). played = [[id, stats]] of our kids who played. Loss → streak +1, no window;
      win → 3 cards (4 after STREAK_FROM+ losses in a row), draw → 2 (no reroll, no mark). Win / draw reset the streak. */
  startReview(result, played, date = this.calendar.date, md = null) {
    const streak = this.lossStreak || 0;
    this.lossStreak = result === 'L' ? streak + 1 : 0;
    this.review = null;
    if (result === 'L') return null;
    const m = this.pickMotm(played.filter(([id]) => !GameState.isKeeper(this.player(id))), date);   // v3.23: outfield kids only (the caller also drops whoever stood in goal)
    if (!m) return null;
    const pid = m.pid, p = this.player(pid), mode = result === 'W' ? 'win' : 'draw';
    const rv = { mode, date, md, pid, rating: +m.rating.toFixed(1), stats: m.stats,
      n: mode === 'draw' ? REVIEW.CARDS_DRAW : streak >= REVIEW.STREAK_FROM ? REVIEW.CARDS_STREAK : REVIEW.CARDS,
      rerolled: false, banished: false, cards: [] };
    rv.cards = this.rollReviewCards(p, rv);
    if (mode === 'win') this.reviewLike(p, rv);
    this.review = rv;
    return rv;
  }
  get reviewPending() { return !!this.review && !!this.player(this.review.pid); }
  /** Close the window: the matchday can be closed now. */
  endReview() { this.review = null; this.save(); }
  /** Pick a card → apply it, one diary line, the window closes. */
  reviewPick(i) {
    const rv = this.review, p = rv && this.player(rv.pid), c = rv?.cards[i];
    if (!p || !c) return false;
    const vars = { k: { pid: p.id }, r: { role: c.role } };
    if (c.type === 'new' && p.roles.length < ROLES.SLOTS) p.roles.push({ id: c.role, level: 1, m: 0 });
    else if (c.type === 'up') { const r = p.roles.find(x => x.id === c.role); if (!r || r.level >= ROLES.LEVELS) return false; r.level++; vars.l = r.level; }
    else if (c.type === 'swap') { const i2 = p.roles.findIndex(x => x.id === c.replaces); if (i2 < 0) return false; p.roles[i2] = { id: c.role, level: 1, m: 0 }; vars.o = { role: c.replaces }; }
    else return false;
    this.notePraise(p);   // v3.25: a REVIEW card counts as praise (the favourite)
    this.pruneComplaints();   // v3.20: a replaced role ends a parent's complaint
    this.addDiary({ date: this.calendar.date, key: 'rv.' + c.type, vars, cls: 'ev' });
    this.endReview();
    return true;
  }
  /** [ Reroll ] (win only, once per window, REROLL_AP from the weekly wallet): 3 new cards, no new mark. */
  canReroll() { const rv = this.review; return !!rv && rv.mode === 'win' && !rv.rerolled && this.ap >= REVIEW.REROLL_AP; }
  reviewReroll() {
    if (!this.canReroll()) return false;
    for (let i = 0; i < REVIEW.REROLL_AP; i++) this.spendAP();
    const rv = this.review;
    rv.rerolled = true;
    rv.cards = this.rollReviewCards(this.player(rv.pid), rv, '#reroll');
    this.save();
    return true;
  }
  /** [ Skip ]: no role change, morale +SKIP_MORALE ("the coach didn't push me"). */
  reviewSkip() {
    const rv = this.review, p = rv && this.player(rv.pid);
    if (!p) return false;
    p.dyn.morale = clamp(p.dyn.morale + REVIEW.SKIP_MORALE, 0, 100);
    this.addDiary({ date: this.calendar.date, key: 'rv.skip.diary', vars: { k: { pid: p.id } }, cls: 'ev' });
    this.endReview();
    return true;
  }
  /** [ Banish ] one card's role from HIS pool for the season (not a role he holds); the window stays with the rest (no refill),
      once per window. BANISH_CLUE: his reaction is a clue (v3.18 rules, source 'review'). */
  reviewBanish(i) {
    const rv = this.review, p = rv && this.player(rv.pid), c = rv?.cards[i];
    if (!p || !c || rv.banished || c.type === 'up') return false;
    p.banned.push(c.role);
    rv.cards = rv.cards.filter(x => x.role !== c.role);
    rv.banished = true;
    this.addDiary({ date: this.calendar.date, key: 'rv.ban.diary', vars: { k: { pid: p.id }, r: { role: c.role } } });
    if (seeded(rv.date + '#reviewban#' + p.id)() < REVIEW.BANISH_CLUE) this.addClue(p, rollClue(p, { date: rv.date, source: 'review', ref: rv.md, salt: '#ban' }));
    this.save();
    return true;
  }
  /* ---------- v3.20 AFTER_GAME.EXE: after a loss the coach hears out kids and parents (draw: praise or listen) ---------- */
  /** After our match (live + Quick Sim), right after startReview. played = [[id, stats]] of our kids who played, events = matchEvents.
      Loss → 3 remark cards; draw (when REVIEW has its cards) → the praise / listen choice first. Win → nothing. */
  startAfter(result, played, events = [], date = this.calendar.date, md = null) {
    this.after = null;
    if (result === 'W' || (result === 'D' && !this.review)) return null;
    const kids = played.filter(([id]) => this.player(id));
    if (!kids.length) return null;
    const ids = kids.map(([id]) => id);
    const af = { mode: result === 'L' ? 'loss' : 'draw', date, md, played: ids, inv: afterInvolvement(kids, events),
      bench: this.bench().filter(p => p.available && !ids.includes(p.id)).map(p => p.id), remarks: [], picked: null, stage: 'pick' };
    if (af.mode === 'loss') af.remarks = this.rollRemarks(af);
    this.after = af;
    return af;
  }
  get afterPending() { return !!this.after; }
  /** 3 speakers, seeded(date#after#): 2 kids + (PARENT) 1 parent, else a 3rd kid. Kids from those involved in the key moments
      (afterInvolvement ≥ INVOLVE_MIN), then any kid who played; the parent of a kid who played or sat on the bench.
      One speaker per kid: a kid and his own parent never both speak. */
  rollRemarks(af) {
    const r = seeded(af.date + '#after#');
    const pick = a => a.length ? a[Math.floor(r() * a.length)] : null;
    const mix = a => { a = [...a].sort(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const played = af.played.filter(id => this.player(id));
    const involved = played.filter(id => (af.inv[id] || 0) >= AFTER.INVOLVE_MIN);
    const order = [...mix(involved), ...mix(played.filter(id => !involved.includes(id)))];
    const parent = r() < AFTER.PARENT, nKids = parent ? AFTER.SPEAKERS - 1 : AFTER.SPEAKERS;
    const sp = order.slice(0, nKids).map(pid => ({ pid, parent: null }));
    if (parent) {
      const child = pick([...played, ...af.bench].filter(id => this.player(id) && !sp.some(x => x.pid === id)).sort());
      if (child) sp.push({ pid: child, parent: r() < 0.5 ? 'mum' : 'dad' });
      else if (order[nKids]) sp.push({ pid: order[nKids], parent: null });
    }
    return sp.map(x => this.rollRemark(af, x, r, played));
  }
  /** One remark: type (weighted, seeded from the evening's stream), then its hidden reliability, rolled on its own stream
      seeded(date#voice#speakerId). A false remark points to a random OTHER signal / claims a misfit when the role fits /
      misreads his leadership — and looks exactly as confident as a true one. */
  rollRemark(af, sp, r, played) {
    const kid = this.player(sp.pid), W = AFTER.W, mates = played.filter(id => id !== kid.id).sort();
    let w;
    if (sp.parent) {
      const roles = rolesOf(kid);
      w = { parentOwn: W.parentOwn, parentCoach: !roles.length ? 0 : roles.some(x => !roleFits(kid, x.id)) ? W.misfitCoach : W.parentCoach };
    } else {
      const band = leadershipTrait(kid.leadership), extra = band === 'anxious' ? W.low : band === 'leader' ? W.high : {};
      w = { self: W.self, other: mates.length ? W.other : 0, blame: W.blame, excuse: W.excuse };
      for (const k in extra) if (w[k]) w[k] *= extra[k];
    }
    const tilt = this.bondMeta?.clash?.tilt, tiltOn = !sp.parent && tilt && tilt.a === kid.id && tilt.date === af.date && mates.includes(tilt.b);   // v3.27: "It's your fault"
    if (tiltOn && w.other) w.other *= CLASH_TILT.OTHER;
    let x = r() * Object.values(w).reduce((a, b) => a + b, 0), type = Object.keys(w)[0];
    for (const k in w) { if (!w[k]) continue; type = k; if ((x -= w[k]) < 0) break; }
    // v3.25: a kid is twice as likely to talk about a mate he doesn't get on with (one r() either way)
    const wt = mates.map(id => (this.bondV?.(kid.id, id) <= -20 ? BOND.AFTER_W : 1) * (tiltOn && id === tilt.b ? CLASH_TILT.ABOUT : 1)), wsum = wt.reduce((a, b) => a + b, 0);
    let target = null;
    if (type === 'other') {
      if (wsum === mates.length) target = this.player(mates[Math.floor(r() * mates.length)]);
      else { let x = r() * wsum; for (let i = 0; i < mates.length; i++) if ((x -= wt[i]) < 0 || i === mates.length - 1) { target = this.player(mates[i]); break; } }
    }
    const v = seeded(af.date + '#voice#' + (sp.parent ? 'par:' : '') + kid.id);
    const grudge = target && this.bondV?.(kid.id, target.id) <= -20 ? BOND.AFTER_REL : 0;   // v3.25: that remark is less reliable
    const rel = AFTER.FORCE_REL ?? (sp.parent ? (type === 'parentCoach' ? AFTER.PARENT_MISFIT : AFTER.PARENT_OWN) : clamp(kidReliability(kid) + grudge, 0, 1));
    const ok = v() < rel, one = a => a[Math.floor(v() * a.length)];
    const rm = { pid: kid.id, parent: sp.parent, type, about: (target || kid).id, kind: AFTER_REMARKS[type].kind, signal: null, role: null, claim: null, ok };
    const about = this.player(rm.about);
    if (type === 'other' && rolesOf(about).length && v() < AFTER.OTHER_MISFIT) rm.kind = 'misfit';
    if (rm.kind === 'leadership') {   // blame → "a leader", excuse → "anxious"; a 'normal' kid's true word is about where he plays
      const band = leadershipTrait(kid.leadership), real = band === 'leader' ? 'high' : band === 'anxious' ? 'low' : null;
      if (ok && AFTER_REMARKS[type].claim !== real) { if (real) rm.type = real === 'high' ? 'blame' : 'excuse'; else { rm.type = 'self'; rm.kind = 'role'; } }
      if (!ok && AFTER_REMARKS[type].claim === real) rm.type = real === 'high' ? 'excuse' : 'blame';
      if (rm.kind === 'leadership') rm.claim = AFTER_REMARKS[rm.type].claim;
    }
    if (rm.kind === 'misfit') {   // true → a role that does not fit him; false → one that does
      const held = rolesOf(about).map(x => x.id), pool = held.filter(id => roleFits(about, id) !== ok);
      if (pool.length) { rm.role = one(pool); rm.claim = 'misfit:' + rm.role; }
      else { rm.kind = 'role'; if (rm.type === 'parentCoach') rm.type = 'parentOwn'; }
    }
    if (rm.kind === 'role') {
      const truth = trueSignals(about), others = Object.keys(CLUE_SIGNALS).filter(k => !truth.includes(k));
      rm.signal = one(ok || !others.length ? truth : others);
    }
    rm.phr = Math.floor(v() * AFTER.PHRASES);
    return rm;
  }
  /** Draw: [ Praise ] → the v3.19 REVIEW draw mode (2 cards). */
  afterPraise() { if (this.after?.mode !== 'draw') return false; this.after = null; this.save(); return true; }
  /** Draw: [ Listen ] → one random remark (no choice of speaker, no rethink); the praise is gone. */
  afterListen() {
    const af = this.after;
    if (af?.mode !== 'draw') return false;
    const all = this.rollRemarks(af);
    if (!all.length) { this.after = null; this.save(); return false; }
    af.remarks = [all[Math.floor(seeded(af.date + '#afterdraw')() * all.length)]];
    af.mode = 'listen';
    this.review = null;
    this.save();
    return true;
  }
  /** Listen to remark i → it becomes a clue about the kid it is about (source 'voice'); the speaker feels heard (morale / Parents);
      a parent's "wrong role" starts a complaint. Loss → the free rethink stage; draw → done. */
  afterPick(i) {
    const af = this.after, rm = af?.remarks[i];
    if (!rm || af.stage !== 'pick' || !['loss', 'listen'].includes(af.mode)) return false;
    const kid = this.player(rm.pid), about = this.player(rm.about);
    if (!kid || !about) return false;
    const textKey = rm.kind === 'leadership' ? 'clue.voice.lead.' + rm.claim : rm.kind === 'misfit' ? 'clue.voice.misfit' : rm.parent || rm.about !== rm.pid ? 'clue.voice.role' : 'clue.voice.self';
    const by = rm.parent || rm.about !== rm.pid ? { pid: kid.id, name: kid.name, parent: rm.parent || null } : null;
    this.addClue(about, { date: af.date, source: 'voice', ref: af.md, signal: rm.kind === 'role' ? rm.signal : null, textKey,
      kind: rm.kind, claim: rm.kind === 'role' ? null : rm.claim, role: rm.role, by });
    if (rm.parent) this.addRep('parents', AFTER.PARENT_REP);
    else kid.dyn.morale = clamp(kid.dyn.morale + AFTER.LISTEN_MORALE, 0, 100);
    if (!rm.parent && rm.about !== rm.pid && this.bonds && this.bondV(kid.id, about.id) <= -20) {   // v3.25: "according to Petya, Kolya let him down"
      const real = bondBand(this.bondV(kid.id, about.id));
      this.addBondNote(kid, { with: about.id, band: rm.ok ? real : real === 'war' ? 'cold' : 'war', source: 'after', date: af.date, by: { pid: kid.id, name: kid.name } });
    }
    if (rm.type === 'parentCoach' && rm.role) {
      this.parentComplaints = (this.parentComplaints || []).filter(c => c.pid !== about.id);
      this.parentComplaints.push({ pid: about.id, role: rm.role, parent: rm.parent, n: 0, date: af.date });
    }
    this.addDiary({ date: this.calendar.date, key: rm.parent ? 'af.heard.' + rm.parent : 'af.heard.kid', vars: { k: { pid: kid.id } }, cls: 'ev' });
    af.picked = i;
    if (af.mode === 'loss') { af.stage = 'rethink'; this.save(); } else this.endAfter();
    return true;
  }
  /** "Not now, go home": nothing learnt, nothing changed, the kids wanted to talk (Squad −1). Loss only, before a pick. */
  afterSkip() {
    const af = this.after;
    if (af?.mode !== 'loss' || af.stage !== 'pick') return false;
    this.addRep('squad', AFTER.SKIP_SQUAD);
    this.addDiary({ date: this.calendar.date, key: 'af.skip.diary', cls: 'ev' });
    this.endAfter();
    return true;
  }
  /** The kid the chosen remark is about (rethink stage). */
  get afterKid() { const af = this.after; return af?.stage === 'rethink' ? this.player(af.remarks[af.picked]?.about) : null; }
  /** Free rethink offers for him: remove one role, swap one for another allowed role (slots, clashes, p.banned), or give one. */
  rethinkOptions(p) {
    const held = rolesOf(p), ids = held.map(r => r.id), ok = id => !ids.includes(id) && !(p.banned || []).includes(id);
    return {
      remove: ids,
      swap: GameState.isKeeper(p) ? [] : held.flatMap(r => ROLE_IDS.filter(id => ok(id) && !ids.some(h => h !== r.id && roleClash(h, id))).map(to => ({ from: r.id, to }))),
      give: held.length || GameState.isKeeper(p) ? [] : ROLE_IDS.filter(ok),   // v3.23: no new roles for a keeper
    };
  }
  /** The one free rethink: 'remove' (role) / 'swap' (role → to) / 'give' (to) / 'keep'. Uses the v3.18 role-change path with free = true. */
  afterRethink(action, role = null, to = null) {
    const p = this.afterKid;
    if (!p) return false;
    const o = this.rethinkOptions(p);
    if (action === 'remove' && o.remove.includes(role)) this.removeRole(p.id, role, { free: true });
    else if (action === 'swap' && o.swap.some(x => x.from === role && x.to === to)) this.changeRole(p.id, role, to, { free: true });
    else if (action === 'give' && o.give.includes(to)) this.changeRole(p.id, null, to, { free: true });
    else if (action !== 'keep') return false;
    if (action !== 'keep') this.addDiary({ date: this.calendar.date, key: 'af.rd.' + action, vars: { k: { pid: p.id }, r: { role: role || to }, o: { role: to || role } }, cls: 'ev' });
    this.endAfter();
    return true;
  }
  /** Auto modes (ui.autoSim, smoke auto-play): loss → the first remark + keep; draw → praise. */
  afterAuto() {
    const af = this.after;
    if (!af) return;
    if (af.mode === 'draw') { this.afterPraise(); return; }
    if (af.stage === 'pick') this.afterPick(0);
    if (this.after?.stage === 'rethink') this.afterRethink('keep');
    if (this.after) this.endAfter();
  }
  endAfter() { this.after = null; this.save(); }
  /** Give / swap a role (v3.20 rethink; free = no morale). Swap keeps the slot at max(1, level − 1); give = level 1. Returns the cost or null. */
  changeRole(id, from, to, { free = false } = {}) {
    const p = this.player(id), held = rolesOf(p), i = from ? held.findIndex(x => x.id === from) : -1;
    if (!p || !ROLE_BY_ID[to] || held.some(x => x.id === to) || (p.banned || []).includes(to) || (from && i < 0)) return null;
    if (held.some(x => x.id !== from && roleClash(x.id, to)) || (!from && held.length >= ROLES.SLOTS)) return null;
    const cost = from ? this.roleChangeCost(p, free, from) : 0, r = { id: to, level: from ? Math.max(1, held[i].level - 1) : 1, m: 0 };
    if (from) p.roles[i] = r; else p.roles.push(r);
    if (cost) p.dyn.morale = clamp(p.dyn.morale + cost, 0, 100);
    this.pruneComplaints();
    this.save();
    return cost;
  }
  /** A parent's complaint ends when the role is changed or removed (any path) or the kid has left. */
  pruneComplaints() { this.parentComplaints = (this.parentComplaints || []).filter(c => rolesOf(this.player(c.pid)).some(r => r.id === c.role)); }
  /** After every league match: a complaint left alone for COMPLAINT_MATCHES matches → Parents −2 + an important briefing line. */
  tickComplaints(date = this.calendar.date) {
    this.pruneComplaints();
    this.parentComplaints = this.parentComplaints.filter(c => {
      if (++c.n < AFTER.COMPLAINT_MATCHES) return true;
      this.addRep('parents', AFTER.COMPLAINT_REP);
      this.addDiary({ date, key: 'af.complaint.' + (c.parent || 'mum'), vars: { k: { pid: c.pid } }, cls: 'ev' });
      return false;
    });
  }
  /** v3.18: keep a clue in the kid's Notebook (last CLUES.MAX_PER_KID). */
  addClue(p, c) {
    if (!p || !c) return;
    const tw = this.mixTwin?.(p, c.source + '#' + c.ref + '#' + c.date + '#' + c.textKey);   // v3.25: the coach mixes the twins up
    if (tw) { c = { ...c, mix: p.id }; p = tw; }
    const v = c.source === 'voice' || c.source === 'talk' ? { kind: c.kind, claim: c.claim || null, role: c.role || null, by: c.by || null } : {};   // v3.20 voice clue extras
    (p.clues ||= []).push({ date: c.date, source: c.source, ref: c.ref, signal: c.signal, textKey: c.textKey, ...v, ...(c.mix ? { mix: c.mix } : {}), seen: false });
    if (p.clues.length > CLUES.MAX_PER_KID) p.clues.splice(0, p.clues.length - CLUES.MAX_PER_KID);
  }
  /** v3.23: his yard notes (DraftView.notes — seeded by id, already lying with YARD.WRONG) become clues: source 'yard', ref 'draft'.
      Only traits that map to a role signal (YARD.SIGNAL) write one; no second WRONG roll — the note's signal is carried as it is.
      Yard clues are the OLDEST in his list, so with the cap they drop off first. One-shot per kid (p.yardDone): a clue that
      dropped off never comes back. They are born read (the coach saw the notes in the draft): no 📝 badge. */
  addYardClues(p, date) {
    if (!p || p.yardDone || typeof DraftView === 'undefined') return;
    p.yardDone = true;
    p.yardNotes = DraftView.notes(p);   // v3.24: kept as seen on draft day (the auto lineup's "safe hands in goal")
    const out = [];
    for (const k of p.yardNotes) {
      const signal = YARD.SIGNAL[k];
      if (signal) out.push({ date, source: 'yard', ref: 'draft', signal, textKey: 'clue.yard.' + k, seen: true });
    }
    p.clues = [...out, ...(p.clues || [])].slice(-CLUES.MAX_PER_KID);
  }
  /** v3.18: one clue per kid the Notebook covers after a match (checked against that match's numbers). pr.clue = its text. */
  recordMatchClues(rep, date = this.calendar.date) {
    const used = new Set();
    for (const pr of rep.players) {
      const p = this.player(pr.id); if (!p || pr.gk) continue;   // the keeper is judged by his saves line
      const c = rollClue(p, { date, source: 'match', ref: rep.md, stats: pr.stats, used });
      pr.clue = c.textKey;
      this.addClue(p, c);
    }
  }
  /** v3.18: the Notebook card was opened → his clues are read (the 📝 badge goes). Returns true if anything changed. */
  markCluesSeen(id) {
    const p = this.player(id), list = (p?.clues || []).filter(c => !c.seen);
    list.forEach(c => { c.seen = true; });
    if (list.length) this.save();
    return list.length > 0;
  }

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
    if (w && w.start >= start) {
      w.lessons ||= GameState.noLessons();   // v3.16: lazy migration → no lessons
      if (w.teff == null) { w.teff = Math.min(COH.T_CAP, w.trainingsDone || 0); w.present = !!w.trainingsDone; w.emptyStreak ||= 0; }   // v3.21: old saves (done = full)
      return w;
    }
    const prev = w && isoAdd(w.start, 7) === start ? w : null;
    const carry = prev ? Math.min(WEEK.CARRY_MAX, Math.max(0, prev.ap)) : 0;
    const win = this.lastResult() === 'W' ? WEEK.WIN_BONUS : 0;
    const ap = Math.min(WEEK.AP_MAX, WEEK.AP_BASE + carry + win);
    this.week = { start, plan: Object.fromEntries(WEEK.PLAN_KEYS.map(k => [k, null])), lessons: GameState.noLessons(), confirmed: false, ap, carry, trainingsDone: 0,
      apSources: { base: WEEK.AP_BASE, carry, win, total: ap }, teff: 0, present: false, emptyStreak: w?.emptyStreak || 0 };   // v3.21: cohesion input + empty-week streak
    if (!this.plannableDays().length) {   // nothing left to plan (the season opens on a Sunday): a stub week, no AP to carry
      Object.assign(this.week, { confirmed: true, ap: 0, carry: 0, apSources: { base: 0, carry: 0, win: 0, total: 0 } });
    }
    this.rollWorldEvent(start);   // v3.14: Monday — before the morning briefing is shown
    return this.week;
  }
  /* ---------- v3.14 WORLD EVENTS: one engine, the rows live in WORLD_EVENTS ---------- */
  /** A new week: maybe one school / city event — seeded by the week, never two weeks running, never in the season's first week. */
  rollWorldEvent(start) {
    this.worldEvent = null;   // last week's event is over
    const md1 = this.calendar.events.find(e => e.type === 'match');
    if (this.phase === 'draft' || !this.squad.length || !md1 || start <= weekStartOf(md1.date)) return null;
    if (this.worldLast && isoAdd(this.worldLast, 7) === start) return null;
    this.worldSalt ||= GameState.worldSaltOf(this.squad);   // v3.15: per-game variety, computed once and saved (never recomputed)
    const r = seeded(start + '#world#' + this.worldSalt);
    if (r() >= WORLD.CHANCE) return null;
    this.worldEvent = this.buildWorldEvent(WORLD_EVENTS[Math.floor(r() * WORLD_EVENTS.length)], start, r);
    this.worldLast = start;
    return this.worldEvent;
  }
  /** The day(s) and the kids of one event row (fixed for the week). Injured / banned / kept-home kids are not picked.
      With WORLD.WRONG one picked kid is swapped for another (a hint, not a proof); 'all' events have no wrong picks. */
  /** v3.15: a stable hash of the squad's sorted ids (the academy's "fingerprint"). */
  static worldSaltOf(squad) { return Math.floor(seeded(squad.map(p => p.id).sort().join(','))() * 2 ** 32).toString(36); }
  buildWorldEvent(row, start, r = seeded(start + '#world#' + (this.worldSalt ||= GameState.worldSaltOf(this.squad)) + '#' + row.id)) {
    const days = row.days === 'mon-thu' ? [0, 1, 2, 3].map(i => isoAdd(start, i)) : [isoAdd(start, 1 + Math.floor(r() * 3))];
    const all = this.squad.filter(p => !(p.injuryDays > 0) && !(p.suspensionMatches > 0) && !(p.awayDays > 0)).sort((a, b) => a.id.localeCompare(b.id));
    let picked = all;
    if (row.pick.kind !== 'all') {
      const n = typeof row.pick.n === 'function' ? row.pick.n(all) : row.pick.n, dir = row.pick.kind === 'bottom' ? 1 : -1;
      const sc = new Map(all.map(p => [p.id, row.pick.score(p, all)]));
      picked = [...all].sort((a, b) => dir * (sc.get(a.id) - sc.get(b.id)) || a.id.localeCompare(b.id)).slice(0, n);
      const others = all.filter(p => !picked.includes(p));
      if (r() < WORLD.WRONG && picked.length && others.length) picked[Math.floor(r() * picked.length)] = others[Math.floor(r() * others.length)];
    }
    return { id: row.id, tier: row.tier, days, playerIds: picked.map(p => p.id), weekStart: start };
  }
  /** DEBUG.EXE: replace this week's event (id) or clear it (null). */
  forceWorldEvent(id) {
    const start = this.weekState().start, row = WORLD_EVENTS.find(e => e.id === id);
    this.worldEvent = row ? this.buildWorldEvent(row, start) : null;
    if (row) this.worldLast = start;
    this.save();
    return this.worldEvent;
  }
  worldRow(id) { return WORLD_EVENTS.find(e => e.id === id) || null; }
  /** This week's event if it runs on that date. */
  worldEventOn(date) { const e = this.worldEvent; return e && date && e.days.includes(date) && this.worldRow(e.id) ? e : null; }
  /** 'world:<id>' when this kid is away at the event that day (absent-type events only). */
  worldAway(id, date) { const e = this.worldEventOn(date); return e && this.worldRow(e.id).effect.absent && e.playerIds.includes(id) ? 'world:' + e.id : null; }
  /** Daily hook: the diary names the kids away at the event (tests: one line on its first day). */
  worldDaily(date) {
    const e = this.worldEventOn(date);
    if (!e) return;
    const row = this.worldRow(e.id), kids = e.playerIds.filter(id => this.player(id));
    if (row.effect.absent && kids.length) this.addDiary({ date, key: 'world.' + e.id + '.diary', vars: { s: { list: kids.map(pid => ({ pid })) } }, cls: 'ev' });
    else if (!row.effect.absent && date === e.days[0]) this.addDiary({ date, key: 'world.' + e.id + '.diary', cls: 'ev' });
  }
  static noLessons() { return Object.fromEntries(WEEK.PLAN_KEYS.map(k => [k, null])); }
  /* ---------- v3.16 INDIVIDUAL LESSONS (weekday evenings without team training, 1 AP reserved in the planner) ---------- */
  /** PLANNER.EXE: book (id + focus) or clear (id = null) the evening lesson of a weekday. Returns null when done, else a reason:
      'locked' (past / today after confirming / match day), 'training' (team training that day), 'perKid', 'noAp', 'bad'.
      Booking takes 1 AP from the weekly wallet at once (the planner's "AP left after plan"); clearing a future lesson refunds it. */
  setLesson(k, id, focus = 'technical') {
    const w = this.weekState(), day = this.weekDays().find(d => d.k === k), cur = w.lessons[k];
    if (!day || !LESSON_FOCI.includes(focus)) return 'bad';
    if (!this.dayEditable(day.date)) return 'locked';
    if (!id) { if (cur) { w.lessons[k] = null; w.ap++; this.save(); } return null; }
    if (w.plan[k]) return 'training';
    if (!this.player(id)) return 'bad';
    if (WEEK.PLAN_KEYS.filter(x => x !== k && w.lessons[x]?.id === id).length >= LESSON.PER_KID_WEEK) return 'perKid';
    if (!cur && w.ap < 1) return 'noAp';
    if (!cur) w.ap--;
    w.lessons[k] = { id, focus };
    this.save();
    return null;
  }
  lessonOn(date) { const w = this.weekState(); return date && weekStartOf(date) === w.start ? w.lessons?.[weekKey(date)] || null : null; }
  /** The evening lesson (dayRoutine, rest days): cancelled + refunded if the kid can't come; else a seeded growth roll
      (MULT × the regime's chance × growthMult, growth room respected), condition −5, maybe one fog-of-war clue. Diary lines. */
  runLesson(date) {
    const L = this.lessonOn(date);
    if (!L || L.done) return null;
    L.done = true;
    const p = this.player(L.id), f = { focus: L.focus };
    if (!p || p.injuryDays > 0 || p.suspensionMatches > 0 || p.awayDays > 0 || this.worldAway(p.id, date)) {
      this.week.ap++; L.cancelled = true;
      const who = p ? { pid: p.id } : { name: (this.expelled || []).find(e => e.id === L.id)?.name || '?' };
      this.addDiary({ date, key: 'lesson.cancel', vars: { k: who, f }, cls: 'tr' });
      return 'cancel';
    }
    const g = REGIMES[LESSON.FOCUS[L.focus]].grow, r = seeded(date + '#lessongrow#' + p.id);
    const res = r() < Math.min(1, LESSON.MULT * g.chance * growthMult(p)) ? this.growSkill(p, g, r) : false;
    p.energy = clamp(p.energy + LESSON.COND, 0, 100);
    this.addDiary({ date, key: 'lesson.done', vars: { k: { pid: p.id }, f }, cls: 'tr' });
    if (res === true) this.addDiary({ date, key: 'lesson.improved', vars: { k: { pid: p.id } }, cls: 'tr' });
    else if (res === 'plateau' && !(p.plateau ||= []).includes(g.group)) {   // v3.11 clue, told once per group
      p.plateau.push(g.group);
      this.addDiary({ date, key: 'tr.plateau.' + g.group, vars: { s: { list: [{ pid: p.id }] } }, cls: 'tr' });
    }
    const h = seeded(date + '#lesson#' + p.id);
    if (h() < LESSON.HINT) {   // one clue, alternating archetype ↔ leadership (no leadership line for a 'normal' kid → archetype)
      const v = Math.floor(h() * 2), lead = (p.lessonClues || 0) % 2 === 1 && p.captainTrait && p.captainTrait !== 'normal';
      const key = lead ? 'obs.cap.' + p.captainTrait + '.' + v : (isPlayingNaturalPosition(p, p.tag) ? 'obs.ok.' : 'obs.hint.' + p.archetype + '.') + v;
      p.lessonClues = (p.lessonClues || 0) + 1;
      this.addDiary({ date, key: 'lesson.clue', vars: { c: { clue: key, pid: p.id } }, cls: 'tr' });
    }
    return res === true ? 'grew' : res || 'none';
  }
  /** Pre-v3.13 save in the middle of a week: Tue + Thu with the default regime (today's old pick kept), confirmed, base AP. */
  static migrateWeek(date, oldPlan) {
    const start = weekStartOf(date), plan = Object.fromEntries(WEEK.PLAN_KEYS.map(k => [k, null]));
    for (const k of WEEK.DEFAULT_DAYS) plan[k] = WEEK.DEFAULT_REGIME;
    if (REGIMES[oldPlan] && plan[weekKey(date)]) plan[weekKey(date)] = oldPlan;
    const done = WEEK.PLAN_KEYS.filter((k, i) => plan[k] && isoAdd(start, i) < date).length;
    return { start, plan, lessons: GameState.noLessons(), confirmed: true, ap: WEEK.AP_BASE, carry: 0, trainingsDone: done, apSources: { base: WEEK.AP_BASE, carry: 0, win: 0, total: WEEK.AP_BASE } };
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
  /** v3.27: the kids who trained on `date` (the day's routine has run), for the clash roll. */
  trainedOn(date) { return this._trained?.date === date ? this._trained.ids.map(id => this.player(id)).filter(Boolean) : []; }
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
    if (regime && w.lessons?.[k]) { w.lessons[k] = null; w.ap++; }   // v3.16: a team training replaces the evening lesson (AP back)
    w.plan[k] = regime;
    this.save();
    return true;
  }
  confirmWeek() { this.weekState().confirmed = true; this.save(); }
  /** Sunday (daily hook): an empty gym or an overloaded week upsets the factions.
      v3.21: the team's cohesion is recalculated first; the k-th empty week in a row costs Board / Parents 2k (capped). */
  weekReview(date) {
    const w = this.weekState(), first = this.calendar.events[0] && isoAdd(this.calendar.events[0].date, -SEASON.FIRST_MATCH_OFFSET);
    if (weekKey(date) !== 'sun' || weekStartOf(date) !== w.start || (first && w.start < first)) return null;
    this.bondWeek(date);   // v3.25: envy, decay, friends' morale — before the cohesion that reads ATMOS
    this.updateCohesion(date);
    if (!w.present) {   // no training with a kid in it this week
      const k = w.emptyStreak = (w.emptyStreak || 0) + 1;
      this.addRep('board', Math.max(WEEK.EMPTY_CAP, WEEK.EMPTY_BOARD * k)); this.addRep('parents', Math.max(WEEK.EMPTY_CAP, WEEK.EMPTY_PARENTS * k));
      this.addDiary({ date, key: k >= 3 ? 'week.empty3' : k === 2 ? 'week.empty2' : 'week.empty', vars: { n: k }, cls: 'ev' });
      return 'empty';
    }
    w.emptyStreak = 0;
    if (w.trainingsDone >= WEEK.HEAVY_FROM) {
      this.addRep('parents', WEEK.HEAVY_PARENTS);
      this.addDiary({ date, key: 'week.heavy', vars: { n: w.trainingsDone }, cls: 'ev' });
      return 'heavy';
    }
    return null;
  }
  /** v3.21: Sunday — C ← clamp(C × DECAY + GAIN × T_eff, 0, 100); a diary line only when the band word changes. */
  updateCohesion(date = this.calendar.date) {
    const w = this.weekState(), before = this.cohesion ?? COH.START, band0 = cohBand(before);
    this.cohesion = clamp(before * COH.DECAY + COH.GAIN * Math.min(COH.T_CAP, w.teff || 0) * (1 + this.atmos()), 0, 100);   // v3.25: × (1 + ATMOS)
    const band = cohBand(this.cohesion);
    if (band !== band0) this.addDiary({ date, key: 'coh.diary.' + (this.cohesion > before ? 'up' : 'down'), vars: { b: { coh: band } }, cls: 'ev' });
    return this.cohesion;
  }
  /** v3.21 DEBUG attention metrics (lazy): one answered choice window — first button?, ms from "ready" to the click (null = unknown). */
  noteAttention({ first = false, dt = null } = {}) {
    const st = (this.stats ||= {}), a = (st.attention ||= {}), wk = this.calendar?.date ? weekStartOf(this.calendar.date) : null;
    if (!a.season || a.season.season !== this.season) a.season = { season: this.season, weeks: [], clicks: 0, first: 0, dts: [] };
    if (!a.week || a.week.start !== wk) a.week = { start: wk, clicks: 0, first: 0, dts: [] };
    if (wk && !a.season.weeks.includes(wk)) a.season.weeks.push(wk);
    for (const b of [a.week, a.season]) {
      b.clicks++; if (first) b.first++;
      if (Number.isFinite(dt)) { b.dts.push(Math.round(dt)); if (b.dts.length > 300) b.dts.shift(); }
    }
  }
  /** v3.21: { clicks, perWeek, first (share), median (s), fast (share < 0.5 s) } of the current week / season, or null. */
  attentionSummary(which) {
    const a = this.stats?.attention, b = a?.[which];
    if (!b || (which === 'week' && b.start !== weekStartOf(this.calendar.date)) || (which === 'season' && b.season !== this.season)) return null;
    const d = [...b.dts].sort((x, y) => x - y), med = d.length ? (d.length % 2 ? d[(d.length - 1) / 2] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2) : null;
    return { clicks: b.clicks, perWeek: which === 'season' ? b.clicks / Math.max(1, b.weeks.length) : b.clicks, first: b.clicks ? b.first / b.clicks : 0,
      median: med == null ? null : med / 1000, fast: d.length ? d.filter(x => x < 500).length / d.length : null, timed: d.length };
  }
  /** v3.21 (policy `reference`): does any of this kid's ✓ confirmed clues point at this role's signal? */
  static roleConfirmed(p, roleId) {
    const sig = ROLE_BY_ID[roleId]?.signal, list = p?.clues || [];
    return !!sig && list.some(c => c.signal === sig && clueConfirmed(list, c));
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
      if (grant) this.addMoney(grant, 'grant', false, date);
      this.addDiary({ date, key: grant ? 'rep.boardGrant' : 'rep.boardNone', vars: { m: '$' + grant }, cls: 'ev' });
      this.addMoney(-FINANCE.RENT, 'rent', true, date);   // v3.15: pitch rent — forced, may go below $0
      this.addDiary({ date, key: 'fin.rent', vars: { m: '$' + FINANCE.RENT }, cls: 'ev' });
      if (this.budget < 0) { this.addRep('board', FINANCE.RENT_LATE_BOARD); this.addDiary({ date, key: 'fin.rentLate', cls: 'ev' }); }
    }
    if (d.getUTCDay() === 0) {
      if (this.rep.parents >= REP.PARENTS_HIGH) {
        const gift = rnd(10, 30) + (this.rep.parents - REP.PARENTS_HIGH);
        this.addMoney(gift, 'donation', false, date);
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
    const used = new Set(), clueUsed = new Set();   // v3.18: two kids on one day never get the same template
    return who.map(p => {
      const ok = isPlayingNaturalPosition(p, p.tag), base = ok ? 'obs.ok.' : 'obs.hint.' + p.archetype + '.';
      let v = Math.floor(seeded(date + '#obs#' + p.id)() * 2);
      if (used.has(base + v)) v = 1 - v;
      used.add(base + v);
      const o = { pid: p.id, ok, key: base + v };
      o.clue = rollClue(p, { date, source: 'training', ref: date, used: clueUsed });   // v3.18: + one role clue (same rules as a match)
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
  growSkill(p, g, rng = Math.random) {   // v3.16: rng — lessons pass a seeded stream (trainings keep Math.random)
    let keys = g.keys || ATTR_GROUPS[g.group];
    if (g.group === 'technical') keys = p.archetype === 'GK' ? ['goalkeeping', 'passing', 'firstTouch'] : keys.filter(k => k !== 'goalkeeping');
    const open = keys.filter(k => canGrow(p, g.group, k)), k = open[Math.floor(rng() * open.length)];   // = pick(): same single Math.random as before
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
    const x = Math.random();   // (one draw, as before v3.25)
    if (this.bonds && this.isLoner(p) ? x > 1 - Math.min(1, BOND.LONER_TRUANT * arrivalSkipChance(p)) : x * 20 > p.psych.discipline + LOCKER.DISC_GRACE) return 'skipped';   // v3.25: a loner skips ×1.3
    return null;
  }
  /** Rolls the arrivals once per day (training / match days). Absent kids are locked out until the next morning. */
  runLocker(training = this.isOurTraining(this.calendar.date), date = this.calendar.date) {
    const d = this.dayState();
    if (d.locker) return d.locker;
    const absent = {}, k = training ? this.trainingIndex(date) : -1, we = this.worldEventOn(date), mult = training && we ? this.worldRow(we.id).effect.attendMult ?? 1 : 1;
    for (const p of this.squad) {
      let r = this.worldAway(p.id, date) || this.arrivalCheck(p);   // v3.14: away at a school / city event — before the other checks
      // v3.13: from the 3rd training of the week the kids who'd come may be kept home (school / not recovered) — not truancy
      // v3.14: the 'tests' week multiplies that chance (×attendMult); a kid lost only to the tests gets 'world:tests'
      const base = training && k >= ATTEND.FROM ? clamp(attendChance(p, k) - (this.bonds ? this.bondAttendPen(p, date) : 0), ATTEND.MIN, ATTEND.MAX) : 1, m = mult < 1 && we.playerIds.includes(p.id) ? mult : 1;   // v3.25: a loner / a best mate away −0.1
      if (!r && training && (base < 1 || m < 1)) { const x = seeded(date + '#load#' + p.id)(); r = x >= base ? 'overload' : x >= base * m ? 'world:' + we.id : null; }
      p.absentToday = ['exhausted', 'skipped', 'overload'].includes(r) || r?.startsWith('world:') ? r : null;   // injured / banned / home are locked by their own status
      p.skipped_training = training && r === 'skipped';                   // feeds The Truant
      if (r) absent[p.id] = r;
    }
    if (training) {   // v3.15: fee collection among the kids who came (+ auto-sim reminds everyone who still owes)
      d.feesPaid = this.collectFees(date, absent);
      this.resolveFines(date);   // v3.24: a poor family's truant fine — paid (or not) at the next training
      if (this.autoFees) for (const p of this.squad) if (!absent[p.id]) this.remindFee(p.id);
    }
    d.locker = { done: false, revealed: false, absent, checked: [], request: this.rollExcuse(absent, date), posRequest: this.rollPositionRequest(absent) };   // v3.6
    d.locker.capRequest = d.locker.request || d.locker.posRequest ? null : this.rollCaptainRequest(absent);   // v3.8: urgent kid requests come first
    if (training && this.bonds) d.locker.came = this.bondArrivals(date, this.squad.filter(p => !absent[p.id]));   // v3.25: "came in together again"
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
  expel(id, { to = 'free_agent' } = {}) {   // v3.22: to = 'big_club' when the scout takes him (no rep penalties live here)
    const p = this.player(id);
    if (!p || this.expelBlock(id)) return false;
    const slot = this.lineup.indexOf(id);
    this.squad = this.squad.filter(x => x !== p);
    if (slot >= 0) {
      const bench = this.squad.filter(x => !this.lineup.includes(x.id));
      const want = slot === 0 ? 'GK' : LINE_POS[this.slots()[slot].line];
      const score = b => (b.available ? 1000 : 0) + (b.position === want ? 100 : 0) + b.overall - (b.hasFlag('Promised_Start') ? 5000 : 0);   // v3.0: by the coach's tags; v3.22: a promised kid only by the card
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
    if (this.worldEvent) this.worldEvent.playerIds = this.worldEvent.playerIds.filter(x => x !== id);   // v3.14
    this.bondLeave(p);   // v3.25: best mates are upset; his pairs go
    p.teamId = to;   // v3.1: he stays in the world database (future transfers)
    p.flags = p.flags.filter(f => f !== 'Promised_Start'); p.promiseBy = null; p.promiseChoice = null;
    (this.expelled = this.expelled || []).push({ id, name: p.name, number: p.number, date: this.calendar.date });
    const tw = p.twinId && this.player(p.twinId);   // v3.25 shared fate: his brother leaves with him (50 %) or takes it hard
    if (tw && !this.twinFollowing) {
      if (seeded('twinleave#' + id + '#' + this.calendar.date)() < (this.twinLeaveForce ?? TWINS.LEAVE_P) && !this.expelBlock(tw.id)) {
        this.twinFollowing = true; this.expel(tw.id, { to }); this.twinFollowing = false;
        this.addDiary({ date: this.calendar.date, key: 'twins.follow', vars: { k: { pid: tw.id } }, cls: 'ev' });
      } else tw.dyn.morale = clamp(tw.dyn.morale + TWINS.LEAVE_MORALE, 0, 100);
    }
    this.save();
    return true;
  }

  /** v2.8: "Immediate request" — maybe one present kid asks to go home (low discipline asks more). Rolled with the arrivals. */
  rollExcuse(absent, date = this.calendar.date) {
    if (this.excusesOff) return null;
    for (const p of shuffle(this.squad.filter(x => !absent[x.id]))) {
      if (Math.random() < EXCUSE.BASE + (20 - p.psych.discipline) * EXCUSE.PER_DISC) {
        Math.random();   // v3.24: the kind is seeded now; this keeps the v3.23 Math.random stream (the old pick(EXCUSE.KINDS))
        return this.pickExcuse(p, date);
      }
    }
    return null;
  }
  /** v3.24: which excuse this kid uses today (seeded date#excuse#id): a kind he hasn't used for EXCUSE.KID_CD days and the team
      hasn't heard for EXCUSE.TEAM_CD days (none left → he doesn't ask today); one of EXCUSE.PHRASES phrasings, never the team's
      last one. Logged in state.excuseLog [{ date, pid, kind, text }] (the last entry is always kept). */
  pickExcuse(p, date = this.calendar.date) {
    const log = (this.excuseLog || []).filter((e, i, a) => i === a.length - 1 || isoDays(e.date, date) < EXCUSE.KID_CD);
    this.excuseLog = log;
    const recent = (e, k) => e.kind === k && e.date <= date && isoDays(e.date, date) < (e.pid === p.id ? EXCUSE.KID_CD : EXCUSE.TEAM_CD);
    const ok = EXCUSE.KINDS.filter(k => !log.some(e => recent(e, k)));
    if (!ok.length) return null;
    const r = seeded(date + '#excuse#' + p.id), kind = ok[Math.floor(r() * ok.length)];
    let n = Math.floor(r() * EXCUSE.PHRASES), text = `ex.${kind}.${n}`;
    if (text === log[log.length - 1]?.text) text = `ex.${kind}.${(n + 1) % EXCUSE.PHRASES}`;
    log.push({ date, pid: p.id, kind, text });
    return { pid: p.id, kind, text, done: false };
  }
  /* ---------- v3.24: a truant's fine is paid by his family (income). A poor family pays at the next training with the v3.15
     first-fee chance for poor kids (one seeded roll); if not, nothing happens — no debt. state.fines [{ pid, amount, date }]. ---------- */
  addFine(pid, amount, date = this.calendar.date) { (this.fines ||= []).push({ pid, amount, date }); }
  resolveFines(date = this.calendar.date) {
    if (!this.fines?.length) return;
    const keep = [];
    for (const f of this.fines) {
      const p = this.player(f.pid);
      if (!p) continue;   // he left the academy: the fine is forgotten
      if (f.date >= date) { keep.push(f); continue; }   // the next training, not today's
      const paid = seeded(date + '#fine#' + f.pid)() < feeChance(p.wealth, 'first', this.fees?.level || FINANCE.DEFAULT_LEVEL);
      if (paid) this.addMoney(f.amount, 'event', false, date);
      this.addDiary({ date, key: paid ? 'fine.paid' : 'fine.unpaid', vars: { k: { pid: p.id }, m: '$' + f.amount }, cls: 'ev' });
    }
    this.fines = keep;
  }
  /** Every morning (and after a match): nobody is "absent" any more. */
  clearDayStatus() { for (const p of this.squad) { p.absentToday = null; p.skipped_training = false; } }

  dayRoutine(date, training = this.isOurTraining(date), plan = this.planOf(date) || WEEK.DEFAULT_REGIME) {
    const skipped = [], improved = [], plateau = [], hurt = [], trained = [], R = REGIMES[plan] || REGIMES.match;
    let attended = 0;
    if (training) { const lk = this.runLocker(true, date || this.calendar.date); lk.done = true; }   // auto-sim: arrivals are rolled without the view
    else this.clearDayStatus();
    const thisWeek = training && date && weekStartOf(date) === this.weekState().start;
    if (thisWeek) this.week.trainingsDone++;   // v3.13: Sunday review
    const wc = training ? this.worldRow(this.worldEventOn(date || this.calendar.date)?.id)?.effect.condition || 0 : 0;   // v3.14: tests week — tired trainees
    for (const p of this.squad) {
      const present = training && p.available;   // v2.6: only kids who came to the locker room train
      const walkOut = present && R.extraSkip && p.psych.discipline < R.lowDisc && Math.random() < R.extraSkip;   // v2.5: tactics bore the restless ones
      if (walkOut) { p.skipped_training = true; }
      if (p.skipped_training) skipped.push(p);
      const trains = present && !walkOut;
      if (training && p.skipped_training) { /* skipped: no tiredness, no sharpness (exhausted / injured kids rest) */ }
      else if (trains) {   // v2.5: the coach's regime
        attended++; trained.push(p);
        p.energy = clamp(p.energy + R.cond + wc, 0, 100);
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
    if (training && date) this.bondTraining(date, trained);   // v3.25: neighbours + the pair drill
    if (date) { this._trained = { date, ids: training ? trained.map(p => p.id) : [] }; this.tickMarks(date); }   // v3.27: who trained (the clash roll), face marks fade
    if (training && date && hurt.length && this.bonds) this.bondQuietHurt(date, hurt, trained);   // v3.27: a mate walks him home
    for (const p of hurt) { const t = p.twinId && this.player(p.twinId); if (t) t.dyn.morale = clamp(t.dyn.morale + TWINS.HURT_MORALE, 0, 100); }   // v3.25 shared fate
    if (thisWeek && attended) {   // v3.21 cohesion: the share of the squad that trained; a kid present ends the empty-week streak
      this.week.teff = (this.week.teff || 0) + attended / Math.max(1, this.squad.length);
      this.week.present = true; this.week.emptyStreak = 0;
    }
    this.tickInjuries();
    this.league?.aiDay(!!date && isTrainingDay(date));   // v3.4: AI clubs rest / train on the same calendar (v3.13: always Tue / Thu)
    // v3.6: Practice Match = scouting — the coach watches the marked kids (or 1–2 random ones) play
    const observed = training && plan === 'match'
      ? this.practiceObservations(date || this.calendar.date, trained, this.today?.date === date ? this.today.observe || [] : []) : [];
    for (const o of observed) { this.addClue(this.player(o.pid), o.clue); if (this.bonds) o.bond = this.bondObserve(this.player(o.pid), date || this.calendar.date); }   // v3.18; v3.25: + who he sticks with
    const lesson = !training && date ? this.runLesson(date) : null;   // v3.16: the evening lesson (no CONTINUE stop)
    return { training, plan: training ? plan : null, attended, skipped, improved, plateau, hurt, observed, lesson };
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
    for (const p of this.squad.filter(x => x.hasFlag('Showcase') && x.available && !this.isStarter(x.id))) {
      const idx = this.lineSwapSlot(p);
      if (idx) this.lineup[idx.i] = p.id;
    }
    this.save();
  }
  /** v2.3 → v3.22 (shared by the showcase and the promise card): the XI slot kid `p` would take — the weakest starter of his
      line (his tag), never a Showcase kid; a keeper only takes the keeper's slot. { i, q } (q = who drops out) or null. */
  lineSwapSlot(p) {
    const slots = this.slots();
    return this.lineup.map((id, i) => ({ i, q: this.player(id) }))
      .filter(({ i, q }) => i > 0 && q && p.position !== 'GK' && !q.hasFlag('Showcase'))
      .sort((a, b) => (LINE_POS[slots[b.i].line] === p.position) - (LINE_POS[slots[a.i].line] === p.position) || a.q.overall - b.q.overall)[0]
      || (p.position === 'GK' && !this.player(this.lineup[0])?.hasFlag('Showcase') ? { i: 0, q: this.player(this.lineup[0]) } : null);
  }
  /** v2.2 → v3.22: the best available bench kid for XI slot i (same position first). A kid with a pending Promised_Start is
      never picked: only the coach puts him in (the promise card). `except` = an id to leave out. */
  bestBenchFor(i, except = null) {
    const slots = this.slots(), want = i === 0 ? 'GK' : LINE_POS[slots[i].line];
    const score = b => (b.position === want ? 100 : 0) + (i === 0 ? (b.position === 'GK' ? 1000 : 0) : (b.position === 'GK' ? -1000 : 0)) + b.overall;   // v3.0: tags, not hidden roles
    return this.bench().filter(b => b.available && b.id !== except && !b.hasFlag('Promised_Start')).sort((a, b) => score(b) - score(a))[0] || null;
  }
  ensureAvailableXI() {
    const changes = [];
    this.lineup.forEach((id, i) => {
      const p = this.player(id);
      if (!p || p.available) return;
      if (i === 0 && this.keeperSwap(p, changes)) return;   // v3.24: the keeper by what the coach can see
      const best = this.bestBenchFor(i);
      if (!best) return;
      this.lineup[i] = best.id;
      changes.push({ out: p, in: best });
    });
    if (changes.length) this.save();
    return changes;
  }
  /** v3.24: the keeper is out — keeperPick over the available bench (old bench order: tag, then overall) and the outfield starters.
      A starter moves into goal and the best bench kid for his slot fills it. false = nobody visible → the old bench rule. */
  keeperSwap(out, changes) {
    const bench = this.bench().filter(b => b.available && !b.hasFlag('Promised_Start'))
      .sort((a, b) => (b.position === 'GK') - (a.position === 'GK') || b.overall - a.overall);
    const xi = this.lineup.slice(1).map(id => this.player(id)).filter(q => q && q.available);
    const pick = this.keeperPick([...bench, ...xi], new Set(bench.map(b => b.id)));
    if (!pick) return false;
    if (bench.includes(pick)) { this.lineup[0] = pick.id; changes.push({ out, in: pick }); return true; }
    const j = this.lineup.indexOf(pick.id), fill = this.bestBenchFor(j);
    if (!fill) return false;
    this.lineup[0] = pick.id; this.lineup[j] = fill.id;
    changes.push({ out, in: pick, fill });
    return true;
  }
  /** v3.24: diary lines for ensureAvailableXI's changes (a starter moved into goal names the kid who took his place). */
  xiAutoDiary(changes, date = this.calendar.date) {
    for (const c of changes) this.addDiary({ date, key: c.fill ? 'xi.autoGK' : 'xi.auto', vars: { a: { pid: c.out.id }, b: { pid: c.in.id }, ...(c.fill ? { c: { pid: c.fill.id } } : {}) }, cls: 'ev' });
  }
  /* ---------- v3.22 "MONEY WITH STRINGS": the promise card ---------- */
  /** The kid whose kick-off promise card is still owed today (present and available, no answer yet), or null. */
  promiseCardKid() {
    if (this.phase !== 'matchday') return null;
    return this.squad.find(p => p.hasFlag('Promised_Start') && !p.promiseChoice && p.available) || null;
  }
  /** Keep: he starts (the weakest starter of his line drops out). Returns the displaced kid or null. */
  promiseStart(p) {
    if (this.isStarter(p.id)) return null;
    const idx = this.lineSwapSlot(p);
    if (!idx) return null;
    this.lineup[idx.i] = p.id;
    return idx.q || null;
  }
  /** Break: he sits out (the best available bench kid of his line takes the slot). */
  promiseBench(p) {
    const i = this.lineup.indexOf(p.id);
    if (i < 0) return null;
    const b = this.bestBenchFor(i, p.id);
    if (b) this.lineup[i] = b.id;
    return b;
  }
  /** At kick-off the card's answer stands even if the lineup was edited afterwards (keep → in the XI, break → out). */
  ensurePromiseXI() {
    for (const p of this.squad.filter(x => x.hasFlag('Promised_Start') && x.promiseChoice && x.available)) {
      if (p.promiseChoice === 'keep') this.promiseStart(p); else this.promiseBench(p);
    }
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
    if (key === 'praise' && rep.motm) this.notePraise(this.player(rep.motm));   // v3.25: the praise lands on the man of the match
    this.addDiary({ date: this.calendar.date, key: 'tt.diary', vars: { o: { team: rep.opponent }, t: { talk: key }, r: { talkReact: key + '.' + talkOutcome(rep) } }, cls: 'ev' });   // v3.9: + the dressing-room reaction
    this.save();
    return fx;
  }
  /** v3.9: a Quick Sim matchday closed without opening the Match Summary — no talk, no effects (never a soft-lock). */
  skipTeamTalk() {
    if (!this.talkPending) return;
    this.lastReport.talk = 'none';
    this.addRep('squad', TEAM_TALK.SKIP_SQUAD);   // v3.23: the boys noticed
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
  recordSeasonStats(pairs, keepers = null) {
    for (const [id, st] of pairs) {
      const acc = this.seasonStats[id] || (this.seasonStats[id] = { ...MatchEngine.blankStats(), apps: 0 });
      for (const k in st) acc[k] = (acc[k] || 0) + st[k];
      acc.apps++;
      if (keepers?.has(id)) acc.kept = (acc.kept || 0) + 1;   // v3.24: finished the match in goal (the auto lineup's keeper rule)
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
  /** v3.15: every money change is booked in the ledger: cat ∈ LEDGER_CATS ('event' by default), month of `date` (today).
      allowDebt (v2.2): a forced payment may push the club below $0. (An old boolean second argument still means allowDebt.) */
  addMoney(delta, cat = 'event', allowDebt = false, date = this.calendar?.date) {
    if (typeof cat === 'boolean') { allowDebt = cat; cat = 'event'; }
    const before = this.budget;
    this.budget = Math.round(this.budget + delta);
    if (!allowDebt) this.budget = Math.max(Math.min(0, before), this.budget);
    const d = this.budget - before;
    if (d && date) {
      const m = ((this.ledger ||= {})[date.slice(0, 7)] ||= {});
      const c = LEDGER_CATS.includes(cat) ? cat : 'event';
      m[c] = (m[c] || 0) + d;
    }
    this.onBudget?.(d);
    return d;
  }
  /* ---------- v3.15 CASH DESK + MONTHLY FEES ---------- */
  monthOf(date = this.calendar.date) { return date.slice(0, 7); }
  /** KASSA.EXE is due at the first stop of a month (also old saves without fees). */
  /** v3.24: the cash desk belongs to the month's first stop that is NOT a match day (the 1st on a Saturday → the next stop;
      the 1st on a Monday → inside PLANNER.EXE as in v3.17). Rent and the grant are still booked on the 1st (repDaily). */
  kassaDue() { return this.phase === 'calendar' && this.squad.length > 0 && this.fees?.month !== this.monthOf(); }
  /** Last month's ledger totals for the cash desk: { month, rows: {cat: sum}, total } — null for the academy's first month. */
  lastMonthReport() {
    const d = new Date(this.monthOf() + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1);
    const month = d.toISOString().slice(0, 7), m = this.ledger?.[month];
    if (!m) return null;
    const rows = Object.fromEntries(LEDGER_CATS.map(c => [c, m[c] || 0]));
    return { month, rows, total: LEDGER_CATS.reduce((a, c) => a + rows[c], 0) };
  }
  /** Closes an older month's fees: unpaid 'owed' is lost (diary with a count), 'half' carries the rest into the next month. */
  closeFees() {
    const f = this.fees;
    if (!f || f.closed) return {};
    const carry = {};
    let lost = 0;
    for (const [id, st] of Object.entries(f.status || {})) {
      if (!this.player(id)) continue;
      if (st === 'owed' && f.started) lost++;
      if (st === 'half') carry[id] = Math.max(0, this.feeDue(id) - (f.got?.[id] || 0));
    }
    const next = new Date(f.month + '-01T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1);
    if (lost) this.addDiary({ date: isoAdd(next.toISOString().slice(0, 10), -1), key: 'fee.lost', vars: { n: lost }, cls: 'ev' });   // the month's last day
    f.closed = true;
    return carry;
  }
  /** [ CONFIRM ] in KASSA.EXE: this month's fee level (rep once), every kid owes; last month closed. */
  confirmKassa(level = FINANCE.DEFAULT_LEVEL) {
    if (!FINANCE.FEES[level]) level = FINANCE.DEFAULT_LEVEL;
    const carry = this.closeFees(), L = FINANCE.FEES[level], month = this.monthOf();
    for (const [k, v] of Object.entries(L.rep || {})) this.addRep(k, v);
    this.fees = { month, level, amount: L.fee, started: false, status: Object.fromEntries(this.squad.map(p => [p.id, 'owed'])),
      reminded: {}, reason: {}, carry, next: {}, got: {} };
    this.addDiary({ date: this.calendar.date, key: 'fee.set.' + level, vars: { m: '$' + L.fee }, cls: 'ev' });
    this.save();
    return this.fees;
  }
  /** What this kid has to pay this month (his fee + a carried half from last month). */
  feeDue(id) { const f = this.fees; return f ? f.amount + (f.carry?.[id] || 0) : 0; }
  /** Does this kid still owe this month's fee (after the fee day)? */
  feeOwes(id) { const f = this.fees; return !!f && f.month === this.monthOf() && f.started && ['owed', 'half'].includes(f.status?.[id]) && !(f.status[id] === 'half' && f.got?.[id]); }
  /** Training day (runLocker): every PRESENT kid who owes rolls once — the fee day (1st training of the month after KASSA),
      later reminded / not; office promises (next) and the first half of a two-part deal use a fixed chance. Seeded. */
  collectFees(date, absent) {
    const f = this.fees;
    if (!f || f.closed || f.month !== this.monthOf(date)) return [];
    const kind = f.started ? null : 'first', paid = [];
    f.started = true;
    f.trn = (f.trn || 0) + 1;   // v3.21: this month's trainings (today included)
    const low = this.lowTrainingMonth(date);
    if (low && !f.lowNoted) { f.lowNoted = true; this.addDiary({ date, key: 'fee.lowTraining', cls: 'ev' }); }
    for (const p of this.squad) {
      const id = p.id;
      if (absent[id] || !f.status[id]) continue;
      const st = f.status[id], half = st === 'half' && !f.got[id];
      if (st !== 'owed' && !half) continue;
      const chance = (half ? FINANCE.HALF_CHANCE : f.next[id] ?? feeChance(p.wealth, kind || (f.reminded[id] ? 'reminded' : 'later'), f.level))
        * (low ? FINANCE.LOW_TRAINING_PAY : 1);   // v3.21: "what are we paying for?" 
      delete f.reminded[id]; delete f.next[id];   // consumed by this roll
      if (seeded(f.month + '#fee#' + (p.twinId && this.player(p.twinId) && p.twinId < id ? p.twinId : id) + '#' + date)() >= chance) continue;   // v3.25: twins = one family, one payment roll
      const due = this.feeDue(id), amt = half ? Math.ceil(due / 2) : due;
      this.addMoney(amt, 'fee', false, date);
      if (half) f.got[id] = amt; else { f.status[id] = 'paid'; f.got[id] = amt; }
      paid.push(id);
    }
    return paid;
  }
  /** v3.21: will this month stay under FINANCE.MIN_TRAININGS trainings? Rolled at each fee collection (simple projection):
      trainings so far this month (today included) + the rest of this week's plan in this month + this week's pace × the weekdays
      left in the month after this week / 5. Under the minimum → every fee chance × LOW_TRAINING_PAY. */
  lowTrainingMonth(date = this.calendar.date) {
    const f = this.fees, m = this.monthOf(date), w = this.weekState(), wkEnd = isoAdd(w.start, 6);
    const rest = this.weekDays().filter(d => d.date > date && d.date.startsWith(m) && this.isOurTraining(d.date)).length;
    let days = 0;
    for (let d = isoAdd(wkEnd, 1); d.startsWith(m); d = isoAdd(d, 1)) if (WEEK.PLAN_KEYS.includes(weekKey(d))) days++;
    return (f?.trn || 0) + rest + this.trainingsPlanned() * days / 5 < FINANCE.MIN_TRAININGS;
  }
  /** Locker Room [ Remind ] (free): consumed by this kid's next roll. */
  remindFee(id) { const f = this.fees; if (f && this.feeOwes(id)) { f.reminded[id] = true; this.save(); return true; } return false; }
  /** v3.17: [ Remind everyone ] — every kid whose status is plain `owed` (not paid / waived / half) and not reminded yet. */
  remindable(id) { const f = this.fees; return !!f && this.feeOwes(id) && f.status[id] === 'owed' && !f.reminded[id]; }
  remindAllFees() {
    const ids = this.squad.map(p => p.id).filter(id => this.remindable(id));
    for (const id of ids) this.fees.reminded[id] = true;
    if (ids.length) this.save();
    return ids.length;
  }
  /* ---------- v3.17 "SILENCE": muted repeats (NEWS) ---------- */
  /** Show this diary line in the briefing / "While you were away"? No if the same news was shown < NEWS.COOLDOWN days ago. */
  newsFresh(e, date = this.calendar.date) {
    if (newsMatch(e.key, NEWS.NEVER_MUTE)) return true;
    const seen = this.newsSeen?.[newsKey(e)];
    return !seen || isoDays(seen, date) >= NEWS.COOLDOWN;
  }
  /** The coach has seen these lines today (old marks are pruned so the save stays small). */
  markNews(list, date = this.calendar.date) {
    const m = this.newsSeen || (this.newsSeen = {});
    for (const e of list || []) m[newsKey(e)] = date;
    for (const k in m) if (isoDays(m[k], date) > NEWS.COOLDOWN * 2) delete m[k];
  }
  /** v3.24: a morning headline id (MorningBriefing.NEWS) may be picked on `date` unless the coach read it < NEWS.CD_DAYS days ago
      (read today = still fresh, so a re-render of the same morning keeps it). Stored in newsSeen as 'hl:<id>' (pruned with the rest). */
  headlineFresh(id, date = this.calendar.date) {
    const seen = this.newsSeen?.['hl:' + id];
    return !seen || seen >= date || isoDays(seen, date) >= NEWS.CD_DAYS;
  }
  markHeadlines(ids, date = this.calendar.date) {
    const m = this.newsSeen || (this.newsSeen = {});
    for (const id of ids || []) m['hl:' + id] = date;
  }
  /** Office talk about the fee: the reason is fixed per month (poor → nomoney; discipline ≤ 7 → spent 50 %; else forgot). */
  feeReason(id) {
    const f = this.fees, p = this.player(id);
    if (!f || !p) return 'forgot';
    if (!f.reason[id]) f.reason[id] = p.wealth === 'poor' ? 'nomoney'
      : p.psych.discipline <= FINANCE.SPENT_DISC && seeded(f.month + '#feewhy#' + id)() < FINANCE.SPENT_SHARE ? 'spent' : 'forgot';
    return f.reason[id];
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
        lastReport: this.lastReport, review: this.review || null, lossStreak: this.lossStreak || 0, after: this.after || null, parentComplaints: this.parentComplaints || [], notebookUnlocked: this.notebookUnlocked, diary: this.diary, seasonStats: this.seasonStats, coachNotes: this.coachNotes, cheats: this.cheats,
        budget: this.budget, rep: this.rep, duties: this.duties, captaincy: this.captaincy, today: this.today, week: this.week || null, away: this.away || null, worldEvent: this.worldEvent || null, worldLast: this.worldLast || null, worldSalt: this.worldSalt || null, ledger: this.ledger || {}, fees: this.fees || null, cohesion: this.cohesion ?? COH.START, stats: this.stats || {}, newsSeen: this.newsSeen || {}, excuseLog: this.excuseLog || [], fines: this.fines || [], gkByHand: this.gkByHand || null, expelled: this.expelled || [], bonds: this.bonds || null, bondMeta: this.bondMeta || null, pendingEvent: this.pendingEvent, eventLog: this.eventLog, eventQueue: this.eventQueue,
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
        this.draft = { pool: d.draft.pool.filter(id => this.globalPlayers.some(p => p.id === id)), signed: (d.draft.signed || []).filter(id => d.draft.pool.includes(id)), twins: d.draft.twins || {} };
        this.save();
        return true;
      }
      if (!Array.isArray(d.squad) || d.squad.length < 11) return false;
      this.clubName = d.clubName || CLUB_NAME;
      this.formation = FORMATIONS[d.formation] ? d.formation : '4-4-2';
      this.budget = Number.isFinite(d.budget) ? Math.round(d.budget) : ECONOMY.START;   // pre-v1.9 saves start with $500 (v2.2: debt allowed)
      this.today = d.today && typeof d.today === 'object' ? d.today : null;   // v2.5
      this.away = Array.isArray(d.away) ? d.away : null;   // v3.13 "while you were away"
      this.newsSeen = d.newsSeen && typeof d.newsSeen === 'object' ? d.newsSeen : {};   // v3.17 muted repeats (lazy migration)
      this.excuseLog = Array.isArray(d.excuseLog) ? d.excuseLog.filter(e => e && EXCUSE.KINDS.includes(e.kind)) : [];   // v3.24 (lazy)
      this.fines = Array.isArray(d.fines) ? d.fines.filter(f => f && f.pid && f.amount > 0) : [];   // v3.24: poor families' truant fines
      this.gkByHand = typeof d.gkByHand === 'string' ? d.gkByHand : null;   // v3.24: the coach put this kid in goal himself
      this.worldEvent = d.worldEvent && typeof d.worldEvent === 'object' && Array.isArray(d.worldEvent.playerIds) && Array.isArray(d.worldEvent.days) ? d.worldEvent : null;   // v3.14 (missing → none this week)
      this.worldLast = typeof d.worldLast === 'string' ? d.worldLast : null;
      this.worldSalt = typeof d.worldSalt === 'string' ? d.worldSalt : null;   // v3.15 (old saves: set on the next Monday roll)
      this.ledger = d.ledger && typeof d.ledger === 'object' ? d.ledger : {};   // v3.15 (missing → {})
      this.cohesion = Number.isFinite(d.cohesion) ? clamp(d.cohesion, 0, 100) : COH.START;   // v3.21 (old saves → 50)
      this.stats = d.stats && typeof d.stats === 'object' ? d.stats : {};   // v3.21 (attention: lazy)
      this.fees = d.fees && typeof d.fees === 'object' && d.fees.status ? { reminded: {}, reason: {}, carry: {}, next: {}, got: {}, ...d.fees } : null;
      this.expelled = Array.isArray(d.expelled) ? d.expelled : [];   // v2.9
      const r = d.rep || {};   // v2.8 (older saves start neutral)
      this.rep = { board: clamp(r.board ?? REP.START, 0, 100), parents: clamp(r.parents ?? REP.START, 0, 100), squad: clamp(r.squad ?? REP.START, 0, 100) };
      this.eventQueue = Array.isArray(d.eventQueue) ? d.eventQueue.filter(q => q && q.id && q.due) : [];
      this.pendingEvent = d.pendingEvent && typeof d.pendingEvent === 'object' ? d.pendingEvent : null;
      this.eventLog = Array.isArray(d.eventLog) ? d.eventLog.slice(-60) : [];
      this.squad = d.squad.map(p => new Player({ ...p, tags: Array.isArray(p.tags) ? p.tags : [] }));   // v3.19: Player.cleanRoles migrates an old single role → level 2
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
        this.lossStreak = Math.max(0, Math.round(d.lossStreak || 0));   // v3.19
        this.review = d.review && typeof d.review === 'object' && Array.isArray(d.review.cards) && this.player(d.review.pid) ? d.review : null;
        this.after = d.after && typeof d.after === 'object' && ['loss', 'draw', 'listen'].includes(d.after.mode) && Array.isArray(d.after.remarks) ? d.after : null;   // v3.20
        this.parentComplaints = Array.isArray(d.parentComplaints) ? d.parentComplaints.filter(c => c && this.player(c.pid) && ROLE_BY_ID[c.role]) : [];   // v3.20: old saves → []
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
      for (const p of this.squad) this.addYardClues(p, `${this.season}-${SEASON.START_MONTH_DAY}`);   // v3.23: old saves get their yard clues once (dated the season start)
      // v3.25 bonds (old saves: yard / school seeded per kid, the starting table rebuilt — the same values on every load)
      this.bondMeta = d.bondMeta && typeof d.bondMeta === 'object' ? { known: {}, matches: {}, ...d.bondMeta } : { known: {}, matches: {} };
      this.bonds = d.bonds && typeof d.bonds === 'object' ? Object.fromEntries(Object.entries(d.bonds).filter(([k, e]) => e && Number.isFinite(e.v) && k.split('|').every(id => this.player(id)))) : null;
      if (!this.bonds) this.initBonds(this.calendar?.date);
      this.save();
      return true;
    } catch (e) { return false; }
  }
  reset() {
    try { localStorage.removeItem(GameState.KEY); } catch (e) {}
    this.newAcademy();
  }
}

