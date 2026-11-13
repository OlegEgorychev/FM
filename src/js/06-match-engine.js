/* =========================================================
   MATCH ENGINE
   Zones are relative to the team in possession:
   0 = own defensive third, 1 = midfield, 2 = attacking third.
   Who plays in a zone is decided by the FORMATION slot (DEF/MID/ATT line),
   not by the player's natural position.
   ========================================================= */
class MatchEngine {
  static SPEED = { 1: 900, 2: 450, 5: 180 };        // ms per in-game minute (proportional, so motion stays smooth)
  static HIGHLIGHT = { 1: 1200, 2: 900, 5: 650 };    // ms per beat of a shot sequence (aim -> strike -> outcome)

  constructor(home, away, hooks, opts = {}) {
    this.sides = [MatchEngine.buildSide(home, true), MatchEngine.buildSide(away, false)];
    this.hooks = hooks;
    this.minute = 0;
    this.stats = new Map();
    this.lineOf = new Map();
    for (const s of this.sides) for (const e of s.entries) { this.stats.set(e.p.id, MatchEngine.blankStats()); this.lineOf.set(e.p.id, e.line); }
    // v3.3: `tired` is only a report flag now (started under 50%); the maths uses fatigueMult(live energy) in eff()
    this.tired = new Set(home.players.filter(p => (p.energy ?? 100) < ENERGY.TIRED).map(p => p.id));
    // LIVE energy (v1.1): every player drains 30–40% over 90 minutes; subs come on with their own energy
    this.energy = new Map(); this.drain = new Map();
    for (const s of this.sides) for (const e of s.entries) { this.energy.set(e.p.id, e.p.energy ?? 100); this.drain.set(e.p.id, MatchEngine.drainOf(e.p)); }
    this.everPlayed = new Set(home.players.map(p => p.id));
    this.sentOff = new Set();   // v3.4: created BEFORE the empty shirts are added (it used to crash short-handed kick-offs)
    this.shouts = [{ min: 0, side: 0, shout: opts.mentality || 'balanced' }, { min: 0, side: 1, shout: opts.oppMentality || 'balanced' }];
    this.trace = [];            // v3.4 match log: every headline duel with all its terms (see rs() / tr())
    for (const id of opts.missing || []) { this.sentOff.add(id); this.everPlayed.delete(id); }   // v2.6: an empty shirt — we start short-handed
    this.subbedOff = new Set();
    this.subsUsed = 0;
    this.subs = [];
    this.paused = false;
    this.mentality = opts.mentality || 'balanced';
    this.oppMentality = opts.oppMentality || 'balanced';   // v3.3: the away side's shout (AI stays balanced; test/balance.js mirrors setups)
    this.forceWin = !!opts.forceWin;
    this.repBonus = clamp(((opts.squadRep ?? 50) - 50) / REP.SQUAD_BONUS, -2, 2);   // v2.8
    // v3.7 hidden captain trait state + its OWN seeded stream (never Math.random → the match RNG order is untouched;
    // visual and Quick Sim run the same tick(), so the same match gives the same captain moments)
    this.capRng = seeded('cap|' + home.name + '|' + away.name + '|' + (opts.md ?? ''));
    this.cap = { id: null, trait: null, rallies: 0, cheers: 0, nerves: 0, mistakes: 0, rallyUntil: -1, breakdown: null, broken: null, minutes: 0 };
    this.capBarks = [];   // v3.7: speech bubbles for the live pitch (PitchModel reads new entries)
    this.dutiesFn = typeof opts.duties === 'function' ? opts.duties : () => (opts.duties || {});   // v3.0: read live (changes at half-time count)   // v1.8 DEBUG.EXE cheat: heavily tilts every roll to the user
    this.speed = opts.speed || 1;
    this.timer = null;
    this.delay = 0;
    this.pendingShot = null;
    this.hold = 0;
    this.boxBonus = 0;
    this.started = false;
    this.finished = false;
    this.htLogged = false;
    this.possTicks = [0, 0];
    this.ev = { kind: 'kickoff' };
    this.matchEvents = [];   // v2.1: key events for the Match Summary { minute, type, playerName, playerId, isHomeTeam, side, assist? }
    this.injured = new Set();
    this.evLog = [];   // recent {seq, ev} so the view never misses an event that was overwritten in the same tick
    this.seq = 0;
  }

  static buildSide(team, user) {
    const slots = formationSlots(team.formation);
    return { name: team.name, formation: team.formation, user, score: 0, players: [...team.players], all: [...team.players],
      entries: slots.map((s, i) => ({ ...s, p: team.players[i] })) };
  }
  /** v1.8: per-minute drain, base 30–40% / 90' scaled by baseStamina (20 → ×0.85, 10 → ×1.0, 1 → ×1.135). */
  static drainOf(p) { return rnd(ENERGY.PLAY_MIN, ENERGY.PLAY_MAX) / 90 * (1.15 - (p.physical?.baseStamina ?? 10) * 0.015); }
  static blankStats() { return { passOk: 0, passFail: 0, tackles: 0, tacklesLost: 0, intercepts: 0, shots: 0, onTarget: 0, goals: 0, dribbleOk: 0, dribbleFail: 0, saves: 0, yellow: 0, red: 0, assists: 0 }; }

  /* ---------- background play (v1.0) ----------
     Every minute, each player may also make an OFF-BALL pass or take on a man, resolved with the same
     maths (hidden stats × roles × fatigue × position × shouts × line superiority). These feed the
     statistics only: no possession change, no log line, no pitch event, no cards — so the score and
     the visible match stay exactly as before, but the Notebook gets statistically meaningful numbers.
     Per-minute chances → per match: MID ≈ 15 passes + ~3 visible; DEF faces ≈ 8–12 duels. */
  static AMBIENT = {
    pass:    { GK: 0.05, DEF: 0.09, MID: 0.17, ATT: 0.07 },
    dribble: { GK: 0,    DEF: 0.02, MID: 0.08, ATT: 0.15 },
  };
  static OPP_LINE = { GK: 'ATT', DEF: 'ATT', MID: 'MID', ATT: 'DEF' };   // who contests a player of this line
  lineMates(side, line) {
    const l = this.sides[side].entries.filter(e => e.line === line && !this.sentOff.has(e.p.id)).map(e => e.p);
    return l.length ? l : this.active(side).filter(p => !this.isGK(p));
  }
  ambient() {
    const R = () => Math.random() * 16;   // wider spread than the visible rolls → clearer differences between players
    for (const side of [0, 1]) {
      const opp = 1 - side;
      for (const e of this.sides[side].entries) {
        const p = e.p;
        if (this.sentOff.has(p.id)) continue;
        const z = LINE_IDX[e.line] ?? 0;
        if (Math.random() < MatchEngine.AMBIENT.pass[e.line]) {
          const def = pick(this.lineMates(opp, MatchEngine.OPP_LINE[e.line]));
          const atk = this.eff(p, 'Pass') + R() + this.mod(side, 'atk') + this.sup(side, z) * 0.5;
          const dfn = this.eff(def, 'Mark') * 0.35 + 5.2 + R() + this.mod(opp, 'def');
          if (atk >= dfn) this.st(p).passOk++;
          else { this.st(p).passFail++; this.st(def).intercepts++; }
        }
        if (Math.random() < MatchEngine.AMBIENT.dribble[e.line]) {
          const line = e.line === 'MID' ? (Math.random() < 0.5 ? 'MID' : 'DEF') : MatchEngine.OPP_LINE[e.line];
          const def = pick(this.lineMates(opp, line));
          const atk = (this.eff(p, 'Dribble') + this.eff(p, 'Speed')) / 2 + R() + this.mod(side, 'atk') + this.sup(side, z) * 0.5;
          const dfn = this.eff(def, 'Tackle') + R() + this.mod(opp, 'def');
          if (atk >= dfn) { this.st(p).dribbleOk++; this.st(def).tacklesLost++; }
          else { this.st(p).dribbleFail++; this.st(def).tackles++; }
        }
      }
    }
  }
  st(p) { return this.stats.get(p.id); }
  /* ---------- v3.0 duties + set pieces ---------- */
  /** The assigned taker if he is on the pitch (our side), else a random outfield kid. */
  taker(side, duty) {
    const act = this.active(side).filter(p => !this.isGK(p));
    if (side === 0) { const id = this.dutiesFn()[duty]; const p = act.find(x => x.id === id); if (p) return p; }
    return pick(act.length ? act : this.active(side));
  }
  /** Captain on the pitch → small boost on all our rolls (0.5 + passion/20).
      v3.7: a leader adds +RALLY for a while after we concede; an anxious captain who broke down gives nothing. */
  captainBonus() {
    const p = this.captain();
    if (!p) return 0;
    if (p.captainTrait === 'anxious' && this.cap.broken === p.id) return 0;
    const rally = p.captainTrait === 'leader' && this.minute <= this.cap.rallyUntil ? CAPTAIN.RALLY : 0;
    return SETPIECE.CAPTAIN + (p.psych?.passion ?? 10) / 20 + rally;
  }
  /* ---------- v3.7 HIDDEN CAPTAIN TRAITS ---------- */
  /** Our captain if he is on the pitch right now (subbed off / sent off / not picked → null). */
  captain() {
    const id = this.dutiesFn().captain;
    if (!id || this.sentOff.has(id)) return null;
    return this.sides[0].players.find(x => x.id === id) || null;
  }
  /** Stress on an anxious captain's OWN rolls while he wears the armband (gone once he has broken down). */
  captainStress(p) {
    const c = this.captain();
    if (!c || c !== p || p.captainTrait !== 'anxious' || this.cap.broken === p.id) return 0;
    return -(CAPTAIN.STRESS + Math.max(0, 10 - (p.psych?.composure ?? 10)) * CAPTAIN.STRESS_COMP);
  }
  /** Log line + speech bubble that never touch Math.random (r comes from the captain's own stream). */
  capLog(type, key, p, cls = '', bark = null) {
    this.hooks.onLog({ minute: this.minute, type, key, vars: { a: p }, side: 0, suffix: '', r: this.capRng() });
    if (bark) this.capBarks.push({ id: p.id, key: bark, cls, imp: true });
  }
  /** Something stressful just happened to us: 'mistake' (by the captain), 'concede', 'trail' (every minute behind), 'lost' (a teammate lost the ball). */
  captainMoment(kind) {
    const c = this.captain();
    if (!c || this.finished) return;
    const k = this.cap;
    if (k.id !== c.id) Object.assign(k, { id: c.id, trait: c.captainTrait });
    if (kind === 'mistake') k.mistakes++;
    if (c.captainTrait === 'leader') {
      if (kind === 'concede') {
        k.rallies++; k.rallyUntil = this.minute + CAPTAIN.RALLY_MIN;
        this.capLog('coach', 'cap.rally', c, 'good', 'bark.cap.rally');
      } else if ((kind === 'lost' || kind === 'mistake') && this.capRng() < CAPTAIN.CHEER * (kind === 'lost' ? 0.3 : 1)) {
        k.cheers++;
        this.capLog('', 'cap.cheer', c, 'good', 'bark.cap.cheer');
      }
      return;
    }
    if (c.captainTrait !== 'anxious' || k.broken === c.id || kind === 'lost') return;
    const ch = kind === 'mistake' ? CAPTAIN.BREAK_MISTAKE : kind === 'concede' ? CAPTAIN.BREAK_CONCEDE : CAPTAIN.BREAK_TRAIL;
    if (this.capRng() < ch) {
      k.broken = c.id; k.breakdown = this.minute;
      c.dyn.morale = clamp(Math.round(c.dyn.morale - CAPTAIN.BREAK_MORALE), 0, 100);
      this.capLog('turn', 'cap.breakdown', c, 'bad', 'bark.cap.tears');
    } else if (kind !== 'trail' && this.capRng() < CAPTAIN.NERVES) {
      k.nerves++;
      this.capLog('', 'cap.nerves', c, 'bad', kind === 'concede' ? null : 'bark.cap.nerves');
    }
  }
  /** v3.7: what the coach could have SEEN of the captain (Notebook). Never the trait name itself in the UI. */
  captainReport() {
    const k = this.cap, id = k.id || this.dutiesFn().captain;
    const p = id && this.sides[0].all.find(x => x.id === id);
    if (!p || !this.everPlayed.has(p.id)) return null;
    return { id: p.id, trait: p.captainTrait, rallies: k.rallies, cheers: k.cheers, nerves: k.nerves, mistakes: k.mistakes, breakdown: k.breakdown, minutes: k.minutes };
  }
  /** A foul in the box may be a penalty; elsewhere in the final third a free kick at goal. */
  setPiece(victim, side) {
    if (this.zone !== 2) return;
    if (Math.random() < SETPIECE.PEN_IN_BOX) this.penalty(side);
    else if (Math.random() < 0.5) this.startShot(victim, true);
  }
  penalty(side) {
    const t = this.taker(side, 'penalty');
    this.lastPass = null;
    this.log('foul', 'eng.pen', { a: t }, side);
    this.startShot(t, false, { penalty: true });
  }
  /** Corner: the taker's delivery vs the defence; a tall, strong target gets a header on goal. */
  corner(side) {
    const opp = 1 - side, t = this.taker(side, 'corner');
    const heads = this.active(side).filter(p => p !== t && !this.isGK(p));
    if (!heads.length) { this.turnover(this.keeper(opp), 0); return; }
    const w = heads.map(p => Math.max(1, (p.bio?.height ?? 160) - 135)), tot = w.reduce((a, b) => a + b, 0);
    let r = Math.random() * tot, target = heads[heads.length - 1];
    for (let i = 0; i < heads.length; i++) { if ((r -= w[i]) < 0) { target = heads[i]; break; } }
    const def = pick(this.inZone(opp, 0));
    const header = ((target.bio?.height ?? 160) - 160) / SETPIECE.HEADER_HEIGHT + ((target.physical?.strength ?? 10) - 10) * 0.1;
    const A = this.rs(t, null, side, 'atk', { delivery: SETPIECE.CORNER_DELIVERY, header }, { raw: t.skill ? t.skill('crossing') : 10 });
    const D = this.rs(def, 'Mark', opp, 'def');
    this.poss = side; this.zone = 2;
    this.tr('corner', side, A, D, A.total >= D.total ? 'header' : 'cleared');
    this.log('', 'eng.corner', { a: t }, side);
    if (A.total >= D.total) {
      this.lastPass = { p: t, side };   // a headed goal is an assist for the taker
      this.setEv({ kind: 'pass', a: t, b: target, d: def });
      this.startShot(target, false, { corner: true, bonus: Math.max(0, header) });
    } else {
      this.st(def).intercepts++;
      this.log('turn', 'eng.cornerClear', { d: def }, opp);
      this.turnover(def, 0);
      this.setEv({ kind: 'block', d: def });
    }
  }
  /** v2.1: key event for the Match Summary (goal / yellow / red / injury). Same in visual and instant mode. */
  addEvent(type, p, side, extra = {}) {
    this.matchEvents.push({ minute: Math.max(1, this.minute), type, playerName: p.name, playerId: p.id, isHomeTeam: side === 0, side, ...extra });
  }
  /** v2.1: a hard tackle can leave a knock — the victim plays on with −25% energy (once per match). Strength protects. */
  static INJURY = { CHANCE: 0.03, ENERGY: 25 };
  maybeInjure(p, side) {
    if (this.injured.has(p.id) || this.sentOff.has(p.id)) return;
    const str = p.physical?.strength ?? 10;
    if (Math.random() >= MatchEngine.INJURY.CHANCE * (1.4 - str * 0.04)) return;
    this.injured.add(p.id);
    this.energy.set(p.id, Math.max(0, this.energy.get(p.id) - MatchEngine.INJURY.ENERGY));
    this.addEvent('injury', p, side);
    this.log('turn', 'eng.injury', { a: p, n: MatchEngine.INJURY.ENERGY }, side);
  }
  active(side) { return this.sides[side].players.filter(p => !this.sentOff.has(p.id)); }
  inZone(side, zone) {
    const line = ZONE_LINE[zone];
    const list = this.sides[side].entries.filter(e => e.line === line && !this.sentOff.has(e.p.id)).map(e => e.p);
    return list.length ? list : this.active(side).filter(p => this.lineOf.get(p.id) !== 'GK');
  }
  keeper(side) { return this.sides[side].entries[0].p; }
  isGK(p) { return this.lineOf.get(p.id) === 'GK'; }
  team(side) { return { team: this.sides[side].name }; }
  scoreVars() { return { h: this.team(0), x: this.sides[0].score, y: this.sides[1].score, a: this.team(1) }; }
  setEv(ev) { this.ev = ev; this.seq++; this.evLog.push({ seq: this.seq, ev }); if (this.evLog.length > 12) this.evLog.shift(); }

  /* ---------- the maths: tags, fatigue, position, shouts, numerical superiority ----------
     v1.8: `attr` is a COMPOSITE key (00-utils-data.js) built from the raw 1–20 skills:
     Pass = passing+vision · Mark = positioning+2·tackling · Dribble = dribbling+agility+firstTouch · Speed = acceleration+speed
     Tackle = 2·tackling+strength+positioning · Shoot = 2·shooting+composure · Save = 2·goalkeeping+agility+positioning.
     Global modifiers: sharpness < 50% → technical skills −2 (inside Player.skill), condition = fatigueMult(live energy) (v3.3, smooth 1.00 → 0.50),
     morale × passion → ±2.5 flat on every roll. */
  eff(p, attr) { return this.effParts(p, attr).v; }
  /** v3.4: eff() split into its terms for the match log. v = rating × fatigue × tag + mood. */
  effParts(p, attr) {
    const rating = p.rating ? p.rating(attr) : 10;
    const fat = fatigueMult(this.energy?.get(p.id) ?? p.energy ?? 100);   // v3.3: smooth curve, no 50% / 30% steps
    // v3.0: no "out of position" penalty any more — only hidden stats and biometrics decide
    const t = p.tags || [];
    const tag = (t.includes('Aggressive') && (attr === 'Tackle' || attr === 'Mark')) || (t.includes('Playmaker') && attr === 'Pass')
      || (t.includes('Selfish') && (attr === 'Dribble' || attr === 'Shoot')) ? 1.5 : 1;
    const mood = p.moodBonus ?? 0;
    return { rating, fat, tag, mood, v: rating * fat * tag + mood };
  }
  mod(side, role) { return this.modParts(side, role).v; }
  /** Flat roll modifiers: DEBUG Force Win, squad reputation (v2.8), captain (v3.0), sideline shout (v3.3 SHOUT table). */
  modParts(side, role) {
    const cheat = this.forceWin ? (side === 0 ? 8 : -5) : 0;
    const rep = side === 0 ? this.repBonus : 0, cap = side === 0 ? this.captainBonus() : 0;
    const shout = SHOUT[side === 0 ? this.mentality : this.oppMentality]?.[role] ?? 0;
    return { cheat, rep, cap, shout, v: cheat + rep + cap + shout };
  }
  /** v3.4: one side of a headline duel, every term kept: (stat × fatigue × tag + mood) + rand·10 + flat extras + modifiers.
      attrs = composite key or [keys] (averaged); opt.raw = a raw skill instead of eff() (corner delivery, no fatigue). */
  rs(p, attrs, side, role, flat = {}, opt = {}) {
    let stat = 0, rating = 0, mood = 0, tag = 1;
    const fat = opt.raw !== undefined ? 1 : fatigueMult(this.energy?.get(p.id) ?? p.energy ?? 100);
    if (opt.raw !== undefined) stat = rating = opt.raw;
    else {
      const keys = Array.isArray(attrs) ? attrs : [attrs];
      for (const k of keys) { const e = this.effParts(p, k); stat += (e.v - e.mood) / keys.length; rating += e.rating / keys.length; mood += e.mood / keys.length; tag = Math.max(tag, e.tag); }
    }
    const m = this.modParts(side, role), rand = Math.random() * 10;
    const stress = side === 0 ? this.captainStress(p) : 0;   // v3.7: anxious captain under the armband
    if (stress) flat = { ...flat, stress };
    let fl = 0; for (const k in flat) fl += flat[k];
    return { p, rating, fat, tag, stat, mood, rand, flat, fl, cheat: m.cheat, rep: m.rep, cap: m.cap, shout: m.shout, total: stat + mood + rand + fl + m.v };
  }
  /** v3.4: record a duel in the match log (A = side in possession). */
  tr(kind, side, A, D, out) {
    const pack = r => ({ id: r.p.id, name: r.p.name, energy: Math.round(this.energy.get(r.p.id) ?? r.p.energy ?? 100), rating: r.rating, fat: r.fat, tag: r.tag, stat: r.stat, mood: r.mood, rand: r.rand,
      flat: r.flat, shout: r.shout, rep: r.rep, cap: r.cap, cheat: r.cheat, total: r.total });
    this.trace.push({ min: this.minute, kind, side, zone: this.zone, A: pack(A), D: pack(D), margin: A.total - D.total, out });
  }
  counts(side) {
    const c = { DEF: 0, MID: 0, ATT: 0 };
    for (const e of this.sides[side].entries) if (e.line !== 'GK' && !this.sentOff.has(e.p.id)) c[e.line]++;
    return c;
  }
  /** Bonus for the team in possession `side` contesting zone z (red cards count too). */
  sup(side, z) {
    const diff = presence(this.counts(side), z) - presence(this.counts(1 - side), 2 - z);
    return clamp((diff - SUP_BASE[z]) * SUP_SCALE, -4, 4);
  }
  setMentality(m) {
    if (m === this.mentality) return;
    this.mentality = m;
    this.shouts.push({ min: this.minute, side: 0, shout: m });   // v3.4 match log
    if (!this.finished && this.started) this.log('coach', 'eng.shout.' + m, {}, 0);
  }
  setSpeedMode(s) { this.speed = s; if (this.started && !this.finished && !this.paused) this.updateSpeed(); }

  /* ---------- clock & pacing ----------
     v2.0: the MATH lives in tick() (one in-game beat: minute, drain, action, background play, half/full time).
     The clock is only a DRIVER around it:
       • visual  — start(): setInterval(tick) paced by SPEED / HIGHLIGHT, with UI hooks every beat;
       • instant — runInstant(): a plain synchronous loop over the very same tick(), no timers, no render hooks.
     Same RNG checks, attributes, tactics, fatigue, cards, subs and stats either way. */
  begin() {
    if (this.started) return;
    this.started = true;
    this.startEnergy = new Map(this.energy);   // v3.4 match log: kick-off condition of everyone on the pitch
    this.kickoff(0);
    this.log('whistle', 'eng.kickoff', { a: this.team(0) }, 0);
  }
  start() {
    this.begin();
    this.updateSpeed();
    this.notify();
  }
  /** Instant simulation: from kick-off (or from the current minute, mid-match) to full time in one call. */
  runInstant() {
    if (this.finished) return this;
    this.instant = true;
    this.stop();
    this.begin();
    this.paused = false;
    for (let guard = 0; !this.finished && guard < 1000; guard++) this.tick();   // 90 minutes + shot beats ≈ 110 ticks
    return this;
  }
  /** Render hook: every beat in visual mode, never in instant mode (onEnd still fires). */
  notify() { if (!this.instant) this.hooks.onUpdate(this); }
  /* Highlight pacing: a shot sequence is ALWAYS played slowly, whatever the chosen speed. */
  desiredDelay() {
    if (this.pendingShot || this.hold > 0) return MatchEngine.HIGHLIGHT[this.speed] ?? 1200;
    return MatchEngine.SPEED[this.speed] ?? 600;
  }
  updateSpeed() {
    if (this.paused || this.instant) return;
    const d = this.desiredDelay();
    if (d === this.delay && this.timer) return;
    this.delay = d;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), d);
    this.hooks.onSpeed?.(d);
  }
  get highlight() { return !!(this.pendingShot || this.hold > 0); }
  stop() { clearInterval(this.timer); this.timer = null; }

  tick() {
    if (this.finished || this.paused) return;
    if (this.hold > 0) this.hold--;
    if (this.pendingShot) {
      const ps = this.pendingShot;
      if (ps.phase === 1) {
        ps.phase = 2;
        this.setEv({ kind: 'strike', a: ps.shooter, side: ps.side });
        this.log('shot', 'strike', { a: ps.shooter }, ps.side);
      } else this.resolveShot();
      this.afterAction();
      return;
    }
    this.minute++;
    if (this.minute === 46) {
      this.kickoff(1);
      this.log('whistle', 'eng.second', { a: this.team(1) }, 1);
    }
    this.possTicks[this.poss]++;
    for (const side of this.sides) for (const p of side.players) {
      if (!this.sentOff.has(p.id)) this.energy.set(p.id, Math.max(0, this.energy.get(p.id) - this.drain.get(p.id)));
    }
    this.act();
    this.ambient();
    if (this.captain()) {   // v3.7: minutes in the armband + the weight of trailing
      this.cap.minutes++;
      if (this.sides[0].score < this.sides[1].score) this.captainMoment('trail');
    }
    this.afterAction();
  }

  afterAction() {
    if (!this.pendingShot) {
      if (this.minute >= 45 && !this.htLogged) { this.htLogged = true; this.log('whistle', 'eng.ht', this.scoreVars()); this.halfTime(); return; }
      if (this.minute >= 90) { this.finish(); return; }
    }
    this.updateSpeed();
    this.notify();
  }

  /* ---------- half-time (v1.1): the loop PAUSES until the coach resumes ---------- */
  halfTime() {
    for (const side of this.sides) for (const p of side.players) {
      if (!this.sentOff.has(p.id)) this.energy.set(p.id, Math.min(100, this.energy.get(p.id) + ENERGY.HT_REST));
    }
    this.log('flavor', 'ht.rest', { n: ENERGY.HT_REST }, -1);
    this.htScore = this.sides.map(x => x.score);   // v2.1: for the summary timeline
    this.setEv({ kind: 'halftime' });
    if (this.instant) return;   // instant sim: same +4% rest, no pause
    this.pause();
    this.hooks.onUpdate(this);
    this.hooks.onHalfTime?.(this);
  }
  pause() { this.paused = true; this.stop(); this.hooks.onSpeed?.(this.delay); }
  resume() {
    if (!this.paused || this.finished) return;
    this.paused = false; this.delay = 0;
    this.updateSpeed();
    this.hooks.onResume?.(this);
  }

  /* ---------- live substitution (v1.1): incoming player takes the same formation slot ---------- */
  static MAX_SUBS = 5;   // youth football: up to five changes
  /** v3.6: our kids who took part → the archetype of the slot (line) they played; subs inherit the slot they filled. */
  slotArchetypes() {
    const out = new Map();
    for (const p of this.sides[0].all) if (p && this.everPlayed.has(p.id)) out.set(p.id, LINE_POS[this.lineOf.get(p.id)] || null);
    return out;
  }
  substitute(outId, inP) {
    if (this.finished) return 'over';
    const side = this.sides[0];
    const idx = side.entries.findIndex(e => e.p.id === outId);
    if (idx < 0 || !inP) return 'pick';
    if (this.sentOff.has(outId)) return 'sentOff';
    if (this.subbedOff.has(inP.id) || side.players.includes(inP)) return 'used';
    if (this.subsUsed >= MatchEngine.MAX_SUBS) return 'limit';
    const line = side.entries[idx].line;
    if (inP.available === false) return 'unavail';   // v2.2: injured / suspended kids can't come on
    if (side.entries[idx].p.hasFlag?.('Showcase')) return 'showcase';   // v2.3: the scout wants the full 90
    // v3.0: any kid may replace anyone, in goal too
    const out = side.entries[idx].p;
    side.entries[idx] = { ...side.entries[idx], p: inP };
    side.players = side.players.map(p => (p === out ? inP : p));
    side.all.push(inP);
    if (!this.stats.has(inP.id)) this.stats.set(inP.id, MatchEngine.blankStats());
    this.lineOf.set(inP.id, line);
    this.energy.set(inP.id, inP.energy ?? 100);
    this.startEnergy?.set(inP.id, inP.energy ?? 100);
    this.drain.set(inP.id, MatchEngine.drainOf(inP));
    if ((inP.energy ?? 100) < ENERGY.TIRED) this.tired.add(inP.id);
    this.everPlayed.add(inP.id);
    this.subbedOff.add(outId);
    this.subsUsed++;
    this.subs.push({ minute: this.minute, in: inP.id, out: outId });
    if (this.carrier === out) this.carrier = inP;
    if (this.pendingShot && this.pendingShot.shooter === out) this.pendingShot.shooter = inP;
    this.log('coach', 'eng.sub', { a: inP, b: out }, 0);
    this.hooks.onSub?.(out, inP);
    this.notify();
    return null;
  }

  finish() {
    this.stop();
    this.finished = true;
    this.log('whistle', 'eng.ft', this.scoreVars());
    this.notify();
    this.hooks.onEnd(this);
  }

  /* ---------- possession helpers ---------- */
  kickoff(side) {
    this.poss = side;
    this.zone = 1;
    this.carrier = pick(this.inZone(side, 1));
    this.boxBonus = 0;
    this.lastPass = null;
    this.setEv({ kind: 'kickoff' });
  }
  turnover(newCarrier, zone) {
    this.poss = 1 - this.poss;
    this.carrier = newCarrier;
    this.zone = zone;
    this.boxBonus = 0;
    this.lastPass = null;
  }

  /* ---------- decision (tags bend the AI) ---------- */
  chooseAction() {
    const c = this.carrier;
    if (this.isGK(c)) return 'pass';
    const w = { ...[
      { pass: 80, dribble: 20, shoot: 0 },
      { pass: 60, dribble: 32, shoot: 8 },
      this.lineOf.get(c.id) === 'ATT' ? { pass: 28, dribble: 22, shoot: 50 } : { pass: 38, dribble: 27, shoot: 35 },
    ][this.zone] };
    // v1.8: decisions — rash kids try hopeful long shots, smart ones keep the ball moving
    const dec = c.tactical?.decisions ?? 10;
    if (dec <= 7 && this.zone === 1) w.shoot += 6;
    if (dec >= 15) { w.pass *= 1.15; if (this.zone === 1) w.shoot *= 0.6; }
    const t = c.tags || [];
    if (t.includes('Playmaker')) { w.pass *= 2; w.dribble *= 0.4; }
    if (t.includes('Selfish')) {
      w.pass *= 0.08; w.dribble *= 1.6; w.shoot *= 1.8;
      if (this.zone === 1) w.shoot = Math.max(w.shoot, 22);
    }
    let r = Math.random() * (w.pass + w.dribble + w.shoot);
    for (const [action, weight] of Object.entries(w)) { if ((r -= weight) < 0) return action; }
    return 'pass';
  }

  act() {
    const action = this.chooseAction();
    if (action === 'pass') this.doPass();
    else if (action === 'dribble') this.doDribble();
    else this.startShot(this.carrier, false);
    if (!this.pendingShot && Math.random() < 0.04) this.log('flavor', 'flavor', {}, -1);
  }

  /* ---------- actions: (attacker stat + rand*10) vs (defender stat + rand*10) + modifiers ---------- */
  doPass() {
    const c = this.carrier, side = this.poss, opp = 1 - side, z = this.zone;
    let tz;
    if (this.isGK(c)) tz = Math.random() < 0.7 ? 0 : 1;
    else if (z === 0) tz = Math.random() < 0.65 ? 1 : 0;
    else if (z === 1) tz = Math.random() < 0.6 ? 2 : 1;
    else tz = Math.random() < 0.7 ? 2 : 1;
    let mates = this.inZone(side, tz).filter(p => p !== c);
    if (!mates.length) { tz = 1; mates = this.active(side).filter(p => p !== c && !this.isGK(p)); }
    const recv = pick(mates);
    const def = pick(this.inZone(opp, 2 - tz));
    const forward = tz > z;

    // v1.8: passer (passing+vision) vs reader (positioning+tackling); the receiver's first touch adds ±1.5;
    // a forward ball into the final third leans on crossing.
    const touch = ((recv.skill?.('firstTouch') ?? 10) - 10) * 0.15;
    const cross = forward && tz === 2 ? ((c.skill?.('crossing') ?? 10) - 10) * 0.1 : 0;
    const A = this.rs(c, 'Pass', side, 'atk', { base: 3, fwd: forward ? -2 : 0, gk: this.isGK(c) ? 2 : 0, touch, cross, sup: this.sup(side, tz) });
    const D = this.rs(def, 'Mark', opp, 'def');
    const vars = { a: c, b: recv, d: def };
    this.tr(forward ? 'passFwd' : 'pass', side, A, D, A.total >= D.total ? 'ok' : 'intercepted');

    if (A.total >= D.total) {
      this.st(c).passOk++;
      this.lastPass = { p: c, side };   // v1.7: the last completed pass can become an assist
      this.carrier = recv; this.zone = tz;
      this.setEv({ kind: 'pass', a: c, b: recv, d: def });
      this.log('', this.isGK(c) ? 'gkPass' : forward ? 'passFwd' : 'passOk', vars, side);
    } else {
      this.st(c).passFail++;
      this.st(def).intercepts++;
      this.log('turn', 'passFail', vars, side);
      this.turnover(def, 2 - tz);
      this.setEv({ kind: 'intercept', a: c, b: recv, d: def });
      if (side === 0) this.captainMoment(c === this.captain() ? 'mistake' : 'lost');   // v3.7
    }
  }

  doDribble() {
    const c = this.carrier, side = this.poss, opp = 1 - side, z = this.zone;
    const def = pick(this.inZone(opp, 2 - z));
    const A = this.rs(c, ['Dribble', 'Speed'], side, 'atk', { base: 1, sup: this.sup(side, z) });
    const D = this.rs(def, 'Tackle', opp, 'def');
    const vars = { a: c, d: def };

    if (A.total >= D.total) {
      this.tr('dribble', side, A, D, 'ok');
      this.st(c).dribbleOk++;
      this.st(def).tacklesLost++;
      if (z < 2) this.zone++; else this.boxBonus = 3;
      this.setEv({ kind: 'dribble', a: c, d: def });
      this.log('', 'drOk', vars, side);
      if (side === 1 && def === this.captain()) this.captainMoment('mistake');   // v3.7: our captain beaten in a duel
      if ((def.tags || []).includes('Aggressive')) this.commitFoul(def, c, side);
    } else {
      const foul = Math.random() < SETPIECE.FOUL;
      this.tr('dribble', side, A, D, foul ? 'foul' : 'tackled');
      if (foul) {   // v3.0: a mistimed tackle — our ball, maybe a penalty
        if ((def.tags || []).includes('Aggressive')) { this.commitFoul(def, c, side); return; }
        this.setEv({ kind: 'foul', a: c, d: def, card: false });
        this.log('foul', 'eng.foulPlain', vars, 1 - side);
        this.setPiece(c, side);
        return;
      }
      this.st(c).dribbleFail++;
      this.st(def).tackles++;
      this.log('turn', 'drFail', vars, side);
      this.maybeInjure(c, side);
      this.turnover(def, 2 - z);
      this.setEv({ kind: 'tackle', a: c, d: def });
      if (side === 0) this.captainMoment(c === this.captain() ? 'mistake' : 'lost');   // v3.7
    }
  }

  /** "Aggressive" downside: a lost tackle is always a foul + yellow. Two yellows = red. */
  commitFoul(def, victim, attSide) {
    const defSide = 1 - attSide;
    const s = this.st(def);
    s.yellow++;
    this.addEvent('yellow', def, defSide);
    this.setEv({ kind: 'foul', a: victim, d: def });
    this.log('foul', 'foul', { a: victim, d: def }, defSide);
    if (s.yellow >= 2) {
      s.red = 1;
      this.addEvent('red', def, defSide);
      this.sentOff.add(def.id);
      this.hold = 1;
      this.log('red', 'red', { d: def, n: this.active(defSide).length }, defSide);
    }
    this.setPiece(victim, attSide);   // v3.0: penalty or free kick in the final third
  }

  startShot(c, freeKick, sp = {}) {
    const side = this.poss;
    const long = !freeKick && !sp.penalty && !sp.corner && this.zone < 2;
    this.st(c).shots++;
    const lp = this.lastPass, assist = !freeKick && !sp.penalty && lp && lp.side === side && lp.p !== c ? lp.p : null;
    this.pendingShot = { shooter: c, side, long, freeKick, assist, penalty: !!sp.penalty, corner: !!sp.corner,
      bonus: sp.penalty ? SETPIECE.PEN_BONUS + (c.psych?.composure ?? 10) * 0.2 : sp.corner ? sp.bonus || 0 : freeKick ? 1 : this.boxBonus, phase: 1 };
    this.boxBonus = 0;
    this.setEv({ kind: 'aim', a: c, side });
    this.log('shot', sp.penalty ? 'eng.penAim' : sp.corner ? 'eng.headerAim' : freeKick ? 'fkAim' : long ? 'aimLong' : 'aim', { a: c }, side);
  }

  resolveShot() {
    const { shooter, side, long, bonus, assist, penalty, corner, freeKick } = this.pendingShot;
    this.pendingShot = null;
    const opp = 1 - side;
    const blocker = pick(this.inZone(opp, 0));
    const keeper = this.keeper(opp);

    let blocked = false;
    if (!penalty && Math.random() < 0.2) {
      const B = this.rs(blocker, 'Mark', opp, 'def'), S = this.rs(shooter, 'Shoot', side, 'atk');
      blocked = B.total > S.total;
      this.tr('block', side, S, B, blocked ? 'blocked' : 'through');
    }
    if (blocked) {
      this.st(blocker).intercepts++;
      this.log('turn', 'block', { d: blocker }, opp);
      this.setEv({ kind: 'block', d: blocker });
      if (side === 0 && shooter === this.captain()) this.captainMoment('mistake');   // v3.7
      if (Math.random() < SETPIECE.CORNER_BLOCK) { this.corner(side); return; }   // v3.0: deflected out → corner
      this.turnover(blocker, 0);
      return;
    }
    const A = this.rs(shooter, 'Shoot', side, 'atk', { bonus, long: long ? -5 : 0 });
    const D = this.rs(keeper, 'Save', opp, 'def', { keeper: 4 });
    const atk = A.total, dfn = D.total;
    const vars = { a: shooter, k: keeper };
    this.tr(penalty ? 'penalty' : corner ? 'header' : freeKick ? 'freekick' : long ? 'longShot' : 'shot', side, A, D, atk > dfn ? 'goal' : atk < dfn - 7 ? 'wide' : 'saved');

    if (atk > dfn) {
      this.st(shooter).goals++; this.st(shooter).onTarget++;
      if (assist) this.st(assist).assists++;
      this.sides[side].score++;
      this.addEvent('goal', shooter, side, { ...(assist ? { assist: assist.name } : {}), ...(penalty ? { pen: true } : {}), ...(corner ? { corner: true } : {}) });
      this.log('goal', 'goal', vars, side, `  ${this.sides[0].score}-${this.sides[1].score}`);
      if (!this.instant) this.hooks.onGoal?.(side);
      this.kickoff(opp);
      this.hold = 1;   // celebration beat
      this.setEv({ kind: 'goal', side, a: shooter });
      if (side === 1) this.captainMoment('concede');   // v3.7
    } else if (atk < dfn - 7) {
      this.log('', 'wide', vars, side);
      this.turnover(keeper, 0);
      this.setEv({ kind: 'wide', side, a: shooter });
      if (side === 0 && shooter === this.captain()) this.captainMoment('mistake');   // v3.7
    } else {
      this.st(shooter).onTarget++;
      this.st(keeper).saves++;
      this.log('', 'save', vars, opp);
      this.setEv({ kind: 'save', k: keeper });
      if (side === 0 && shooter === this.captain()) this.captainMoment('mistake');   // v3.7
      if (!penalty && Math.random() < SETPIECE.CORNER_SAVE) this.corner(side);   // v3.0: tipped over → corner
      else this.turnover(keeper, 0);
    }
  }

  /* ---------- reporting ---------- */
  log(type, key, vars = {}, side = -1, suffix = '') {
    this.hooks.onLog({ minute: this.minute, type, key, vars, side, suffix, r: Math.random() });
  }

  /* ---------- v3.4 MATCH LOG (export) ----------
     trace = every headline duel (pass, forward pass, dribble, block, shot, long shot, free kick, penalty, corner, header)
     with both sides' terms: total = stat (rating × fatigue × tag) + mood + rand·10 + flat extras + shout + rep + captain + cheat.
     Background play (ambient) is NOT in the trace: it only feeds the player stats. */
  static WIN_OUT = new Set(['ok', 'goal', 'header', 'through']);
  logData(meta = {}) {
    const r2 = v => Math.round(v * 100) / 100;
    const side = i => {
      const s = this.sides[i], rows = this.trace.filter(t => t.side === i), kinds = {};
      for (const t of rows) {
        const k = kinds[t.kind] || (kinds[t.kind] = { n: 0, won: 0, margin: 0, outcomes: {} });
        k.n++; if (MatchEngine.WIN_OUT.has(t.out)) k.won++; k.margin += t.margin; k.outcomes[t.out] = (k.outcomes[t.out] || 0) + 1;
      }
      for (const k of Object.values(kinds)) { k.rate = r2(k.won / k.n); k.margin = r2(k.margin / k.n); }
      const own = this.trace.flatMap(t => [t.A, t.D]).filter(x => s.all.some(p => p.id === x.id));
      const avg = f => own.length ? r2(own.reduce((a, x) => a + f(x), 0) / own.length) : 0;
      return { name: s.name, formation: s.formation, score: s.score, user: s.user, possession: r2(this.possTicks[i] / ((this.possTicks[0] + this.possTicks[1]) || 1)),
        totals: this.teamTotals(i), duels: kinds,
        avgInDuels: { rating: avg(x => x.rating), fatigue: avg(x => x.fat), stat: avg(x => x.stat), mood: avg(x => x.mood), shout: avg(x => x.shout), rep: avg(x => x.rep), captain: avg(x => x.cap), cheat: avg(x => x.cheat) },
        players: s.all.map(p => ({ id: p.id, name: p.name, line: this.lineOf.get(p.id), sentOff: this.sentOff.has(p.id), subbedOff: this.subbedOff.has(p.id),
          energyStart: Math.round(this.startEnergy?.get(p.id) ?? p.energy ?? 100), energyEnd: Math.round(this.energy.get(p.id) ?? 0),
          fatigueStart: r2(fatigueMult(this.startEnergy?.get(p.id) ?? p.energy ?? 100)), fatigueEnd: r2(fatigueMult(this.energy.get(p.id) ?? 0)), stats: { ...this.st(p) } })) };
    };
    return { format: 'yam-match-log/1', version: typeof APP_VERSION === 'undefined' ? null : APP_VERSION, ...meta, minute: this.minute, finished: this.finished,
      forceWin: this.forceWin, shouts: this.shouts, subs: this.subs, events: this.matchEvents, teams: [side(0), side(1)],
      trace: this.trace.map(t => ({ ...t, margin: r2(t.margin), A: MatchEngine.r2obj(t.A), D: MatchEngine.r2obj(t.D) })) };
  }
  static r2obj(o) { const out = {}; for (const k in o) out[k] = typeof o[k] === 'number' ? Math.round(o[k] * 100) / 100 : k === 'flat' ? MatchEngine.r2obj(o[k]) : o[k]; return out; }
  /** One CSV row per duel (comma-separated, dot decimals, UTF-8). `pre` = extra leading columns (e.g. setup / match no.). */
  static traceCsv(trace, sides, pre = null) {
    const f = v => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : `"${String(v ?? '').replace(/"/g, '""')}"`);
    const part = ['name', 'energy', 'rating', 'fat', 'tag', 'stat', 'mood', 'rand', 'flat', 'shout', 'rep', 'cap', 'cheat', 'total'];
    const head = [...(pre ? Object.keys(pre) : []), 'minute', 'kind', 'team', 'zone', ...part.map(k => 'atk_' + k), ...part.map(k => 'def_' + k), 'margin', 'outcome'];
    const cell = (x, k) => k === 'flat' ? f(Object.entries(x.flat || {}).filter(([, v]) => v).map(([n, v]) => `${n}:${Math.round(v * 100) / 100}`).join(' ')) : f(x[k]);
    const rows = trace.map(t => [...(pre ? Object.values(pre).map(f) : []), t.min, f(t.kind), f(sides?.[t.side] ?? t.side), t.zone,
      ...part.map(k => cell(t.A, k)), ...part.map(k => cell(t.D, k)), f(t.margin), f(t.out)].join(','));
    return [head.join(','), ...rows].join('\n');
  }

  teamTotals(side = 0) {
    const t = MatchEngine.blankStats();
    for (const p of this.sides[side].all) { const s = this.st(p); for (const k in t) t[k] += s[k]; }
    return t;
  }
}

