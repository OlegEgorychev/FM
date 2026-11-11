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
    // Energy is checked once, at kick-off: under 50% => every hidden stat x0.5 for the whole match
    this.tired = new Set(home.players.filter(p => (p.energy ?? 100) < ENERGY.TIRED).map(p => p.id));
    // LIVE energy (v1.1): every player drains 30–40% over 90 minutes; subs come on with their own energy
    this.energy = new Map(); this.drain = new Map();
    for (const s of this.sides) for (const e of s.entries) { this.energy.set(e.p.id, e.p.energy ?? 100); this.drain.set(e.p.id, MatchEngine.drainOf(e.p)); }
    this.everPlayed = new Set(home.players.map(p => p.id));
    this.subbedOff = new Set();
    this.subsUsed = 0;
    this.subs = [];
    this.paused = false;
    this.mentality = opts.mentality || 'balanced';
    this.forceWin = !!opts.forceWin;   // v1.8 DEBUG.EXE cheat: heavily tilts every roll to the user
    this.speed = opts.speed || 1;
    this.sentOff = new Set();
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
     Global modifiers: sharpness < 50% → technical skills −2 (inside Player.skill), condition = live energy (×0.5 / ×0.8),
     morale × passion → ±2.5 flat on every roll. */
  eff(p, attr) {
    let v = p.rating ? p.rating(attr) : 10;
    if (this.tired.has(p.id)) v *= 0.5;
    const en = this.energy?.get(p.id);
    if (en !== undefined && en < ENERGY.EXHAUSTED) v *= ENERGY.EXHAUSTED_MULT;
    if (NATURAL_LINE[p.position] !== this.lineOf.get(p.id)) v *= OUT_OF_POSITION;
    const t = p.tags || [];
    if (t.includes('Aggressive') && (attr === 'Tackle' || attr === 'Mark')) v *= 1.5;
    if (t.includes('Playmaker') && attr === 'Pass') v *= 1.5;
    if (t.includes('Selfish') && (attr === 'Dribble' || attr === 'Shoot')) v *= 1.5;
    return v + (p.moodBonus ?? 0);
  }
  mod(side, role) {
    const cheat = this.forceWin ? (side === 0 ? 8 : -5) : 0;
    if (side !== 0 || this.mentality === 'balanced') return cheat;
    const pushing = this.mentality === 'attack';
    return cheat + ((role === 'atk') === pushing ? 3 : -3);
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
  substitute(outId, inP) {
    if (this.finished) return 'over';
    const side = this.sides[0];
    const idx = side.entries.findIndex(e => e.p.id === outId);
    if (idx < 0 || !inP) return 'pick';
    if (this.sentOff.has(outId)) return 'sentOff';
    if (this.subbedOff.has(inP.id) || side.players.includes(inP)) return 'used';
    if (this.subsUsed >= MatchEngine.MAX_SUBS) return 'limit';
    const line = side.entries[idx].line;
    if (line === 'GK' && inP.position !== 'GK') return 'gkOnly';
    if (line !== 'GK' && inP.position === 'GK') return 'gkTwo';
    const out = side.entries[idx].p;
    side.entries[idx] = { ...side.entries[idx], p: inP };
    side.players = side.players.map(p => (p === out ? inP : p));
    side.all.push(inP);
    if (!this.stats.has(inP.id)) this.stats.set(inP.id, MatchEngine.blankStats());
    this.lineOf.set(inP.id, line);
    this.energy.set(inP.id, inP.energy ?? 100);
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
    const atk = this.eff(c, 'Pass') + Math.random() * 10 + 3 - (forward ? 2 : 0) + (this.isGK(c) ? 2 : 0) + touch + cross + this.mod(side, 'atk') + this.sup(side, tz);
    const dfn = this.eff(def, 'Mark') + Math.random() * 10 + this.mod(opp, 'def');
    const vars = { a: c, b: recv, d: def };

    if (atk >= dfn) {
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
    }
  }

  doDribble() {
    const c = this.carrier, side = this.poss, opp = 1 - side, z = this.zone;
    const def = pick(this.inZone(opp, 2 - z));
    const atk = (this.eff(c, 'Dribble') + this.eff(c, 'Speed')) / 2 + Math.random() * 10 + 1 + this.mod(side, 'atk') + this.sup(side, z);
    const dfn = this.eff(def, 'Tackle') + Math.random() * 10 + this.mod(opp, 'def');
    const vars = { a: c, d: def };

    if (atk >= dfn) {
      this.st(c).dribbleOk++;
      this.st(def).tacklesLost++;
      if (z < 2) this.zone++; else this.boxBonus = 3;
      this.setEv({ kind: 'dribble', a: c, d: def });
      this.log('', 'drOk', vars, side);
      if ((def.tags || []).includes('Aggressive')) this.commitFoul(def, c, side);
    } else {
      this.st(c).dribbleFail++;
      this.st(def).tackles++;
      this.log('turn', 'drFail', vars, side);
      this.turnover(def, 2 - z);
      this.setEv({ kind: 'tackle', a: c, d: def });
    }
  }

  /** "Aggressive" downside: a lost tackle is always a foul + yellow. Two yellows = red. */
  commitFoul(def, victim, attSide) {
    const defSide = 1 - attSide;
    const s = this.st(def);
    s.yellow++;
    this.setEv({ kind: 'foul', a: victim, d: def });
    this.log('foul', 'foul', { a: victim, d: def }, defSide);
    if (s.yellow >= 2) {
      s.red = 1;
      this.sentOff.add(def.id);
      this.hold = 1;
      this.log('red', 'red', { d: def, n: this.active(defSide).length }, defSide);
    }
    if (this.zone === 2 && Math.random() < 0.5) this.startShot(victim, true);
  }

  startShot(c, freeKick) {
    const side = this.poss;
    const long = !freeKick && this.zone < 2;
    this.st(c).shots++;
    const lp = this.lastPass, assist = !freeKick && lp && lp.side === side && lp.p !== c ? lp.p : null;
    this.pendingShot = { shooter: c, side, long, freeKick, assist, bonus: freeKick ? 1 : this.boxBonus, phase: 1 };
    this.boxBonus = 0;
    this.setEv({ kind: 'aim', a: c, side });
    this.log('shot', freeKick ? 'fkAim' : long ? 'aimLong' : 'aim', { a: c }, side);
  }

  resolveShot() {
    const { shooter, side, long, bonus, assist } = this.pendingShot;
    this.pendingShot = null;
    const opp = 1 - side;
    const blocker = pick(this.inZone(opp, 0));
    const keeper = this.keeper(opp);

    if (Math.random() < 0.2 &&
        this.eff(blocker, 'Mark') + Math.random() * 10 + this.mod(opp, 'def') > this.eff(shooter, 'Shoot') + Math.random() * 10 + this.mod(side, 'atk')) {
      this.st(blocker).intercepts++;
      this.log('turn', 'block', { d: blocker }, opp);
      this.turnover(blocker, 0);
      this.setEv({ kind: 'block', d: blocker });
      return;
    }
    const atk = this.eff(shooter, 'Shoot') + Math.random() * 10 + bonus - (long ? 5 : 0) + this.mod(side, 'atk');
    const dfn = this.eff(keeper, 'Save') + Math.random() * 10 + 4 + this.mod(opp, 'def');
    const vars = { a: shooter, k: keeper };

    if (atk > dfn) {
      this.st(shooter).goals++; this.st(shooter).onTarget++;
      if (assist) this.st(assist).assists++;
      this.sides[side].score++;
      this.log('goal', 'goal', vars, side, `  ${this.sides[0].score}-${this.sides[1].score}`);
      if (!this.instant) this.hooks.onGoal?.(side);
      this.kickoff(opp);
      this.hold = 1;   // celebration beat
      this.setEv({ kind: 'goal', side, a: shooter });
    } else if (atk < dfn - 7) {
      this.log('', 'wide', vars, side);
      this.turnover(keeper, 0);
      this.setEv({ kind: 'wide', side, a: shooter });
    } else {
      this.st(shooter).onTarget++;
      this.st(keeper).saves++;
      this.log('', 'save', vars, opp);
      this.turnover(keeper, 0);
      this.setEv({ kind: 'save', k: keeper });
    }
  }

  /* ---------- reporting ---------- */
  log(type, key, vars = {}, side = -1, suffix = '') {
    this.hooks.onLog({ minute: this.minute, type, key, vars, side, suffix, r: Math.random() });
  }

  teamTotals(side = 0) {
    const t = MatchEngine.blankStats();
    for (const p of this.sides[side].all) { const s = this.st(p); for (const k in t) t[k] += s[k]; }
    return t;
  }
}

