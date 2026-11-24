/* =========================================================
   v3.27 "CLASHES" — bonds start to produce stories (GameState mixin, data side; the six dialogues live in 11m-clash-events.js).
   Pair entry extras: skew (−SKEW_MAX…+SKEW_MAX: kid A of the sorted key sees v + skew, kid B sees v − skew), open (date until
   which an unresolved clash doubles the pair's clash chance), clash (date of its last clash), apart (twins kept apart until).
   bondMeta.clash = { last, fight, twin, envy, pairreq: {key: date}, sPen: {id: 1}, fights: [...], post, quiet, n: [dates], ap }.
   bondMeta.obl   = [{ kind: 'pair' | 'start', a, b, left, date }] — the coach's word to the kids (checked after every match).
   The coach never sees v, skew or S. All randomness is seeded(); Math.random is never touched.
   ========================================================= */
const ClashMixin = {
  /* ---------- skew: the two-sided view ---------- */
  /** v as kid `a` sees it (shared v + his side of the skew). */
  bondViewV(a, b) {
    const ia = a?.id ?? a, ib = b?.id ?? b, e = this.bond(ia, ib);
    if (!e) return 0;
    return clamp((e.v || 0) + (ia < ib ? 1 : -1) * (e.skew || 0), -100, 100);
  },
  /** The band as kid `a` sees the pair (talk answers, event casting, notes). Match / cohesion / ATMOS keep the shared v. */
  bondView(a, b) { return bondBand(this.bondViewV(a, b)); },
  /** The pair entry (created at v 0 when missing) — for writes that are not a v change. */
  bondEntry(a, b, date = this.calendar?.date) {
    const ia = a?.id ?? a, ib = b?.id ?? b;
    if (!ia || !ib || ia === ib) return null;
    this.bonds ||= {};
    return (this.bonds[bondKey(ia, ib)] ||= { v: 0, root: 0, cause: null, since: date, last: date });
  },
  /** `hurt` takes it worse than `other`: his view drops by amt (skew moves towards him). */
  addSkew(hurt, other, amt, date = this.calendar?.date) {
    const ih = hurt?.id ?? hurt, io = other?.id ?? other, e = this.bondEntry(ih, io, date);
    if (!e || !amt) return 0;
    e.skew = clamp(Math.round((e.skew || 0) - (ih < io ? 1 : -1) * amt), -BOND.SKEW_MAX, BOND.SKEW_MAX);
    if (!e.skew) delete e.skew;
    return e.skew || 0;
  },
  skewReset(a, b) { const e = this.bond(a, b); if (e) delete e.skew; },
  /** The kid who carries a hidden grudge (|skew| ≥ SKEW_HIDDEN) — or null. */
  skewHurt(a, b) {
    const ia = a?.id ?? a, ib = b?.id ?? b, e = this.bond(ia, ib);
    if (!e || Math.abs(e.skew || 0) < BOND.SKEW_HIDDEN) return null;
    const [ka, kb] = ia < ib ? [ia, ib] : [ib, ia];
    return e.skew < 0 ? ka : kb;
  },
  /** Sets the pair's cause without a v change (an event that is itself the hurt). */
  setCause(a, b, cause, date = this.calendar?.date) {
    const e = this.bondEntry(a, b, date);
    if (!e || !cause) return;
    e.cause = cause; e.cd = Math.min(-1, e.v || 0); e.cdate = date;
  },

  /* ---------- meta ---------- */
  clashMeta() {
    const m = (this.bondMeta ||= { known: {}, matches: {} });
    return (m.clash ||= { last: null, fight: null, twin: null, envy: null, pairreq: {}, sPen: {}, fights: [], post: null, quiet: null, n: [], ap: 0 });
  },
  obligations() { return ((this.bondMeta ||= { known: {}, matches: {} }).obl ||= []); },
  /** Harness / DEBUG counters (clash dates, fights, AP spent on conflicts). */
  clashCount(kind, date = this.calendar?.date) {
    const m = this.clashMeta();
    if (kind === 'clash' || kind === 'fight') m.n = [...(m.n || []), date].slice(-200);
    if (kind === 'fight') m.fightsN = (m.fightsN || 0) + 1;
  },

  /* ---------- the hidden success roll S ---------- */
  clashS(a, b, bonus = 0) {
    if (this.clashForceS != null) return this.clashForceS;
    const pa = this.player(a?.id ?? a), pb = this.player(b?.id ?? b);
    if (!pa || !pb) return CLASH.S_MIN;
    const lead = Math.max(pa.leadership ?? 10, pb.leadership ?? 10), T = (bondTemper(pa) + bondTemper(pb)) / 2;
    let S = CLASH.S_BASE + ((this.rep?.squad ?? 50) - 50) / 200 + (lead - 10) / 40 - CLASH.S_T * T;
    const m = this.clashMeta();
    for (const p of [pa, pb]) if (m.sPen?.[p.id]) S -= CLASH.NEXT_S_PEN;   // he still remembers the coach sided against him
    return clamp(S + bonus, CLASH.S_MIN, CLASH.S_MAX);
  },
  /** One seeded success roll (salt = event#option). The sPen of both kids is used up. */
  clashSucceeds(a, b, salt, bonus = 0, date = this.calendar?.date) {
    const S = this.clashS(a, b, bonus), m = this.clashMeta();
    for (const id of [a?.id ?? a, b?.id ?? b]) if (m.sPen?.[id]) delete m.sPen[id];
    if (this.clashForceS != null) return this.clashForceS >= 0.5;
    return seeded(date + '#S#' + salt + '#' + bondKey(a?.id ?? a, b?.id ?? b))() < S;
  },

  /* ---------- what the coach knows ---------- */
  /** The cause the coach has written down for the pair (latest note with a cause) — or null. */
  knownCause(a, b) {
    const n = this.pairNotes(a, b).filter(x => x.cause && !x.mix).pop();
    return n ? n.cause : null;
  },
  /** The coach knows a conflict between a and b: a 'bad' note or an event note. */
  knowsConflict(a, b) {
    return this.knownBond(a, b)?.cls === 'bad' || this.pairNotes(a, b).some(n => n.source === 'event' && !n.mix && n.band !== 'best' && n.band !== 'mates');
  },
  /** Both kids' own words about each other (their latest talk notes) — { a: band, b: band } or null when one side is missing. */
  pairSides(a, b) {
    const own = (x, y) => [...(this.player(x)?.bondNotes || [])].reverse().find(n => n.with === y && n.source === 'talk' && n.by?.pid === x && !n.mix && n.band !== 'evade');
    const na = own(a, b), nb = own(b, a);
    return na && nb ? { a: na.band, b: nb.band, two: bondClass(na.band) !== bondClass(nb.band) } : null;
  },
  /** Kids the coach knows `id` fell out with. */
  knownConflicts(id) { return this.squad.filter(q => q.id !== id && this.knowsConflict(id, q.id)).map(q => q.id); },
  /** Possible mediators for (a, b): kids the coach KNOWS are mates+ with both. */
  mediatorsFor(a, b) {
    return this.squad.filter(q => q.id !== a && q.id !== b && this.knownBond(q.id, a)?.cls === 'good' && this.knownBond(q.id, b)?.cls === 'good')
      .sort((x, y) => (y.leadership ?? 0) - (x.leadership ?? 0) || x.id.localeCompare(y.id)).map(q => q.id);
  },
  /** The cause → the matching option per event (the hint "you know what this is about" + S +CAUSE_S, or +CAUSE_DV without a roll). */
  causeOption(eventId, a, b) {
    const c = this.knownCause(a, b);
    return c && CLASH_CAUSE_OPT[eventId]?.[c] || null;
  },

  /* ---------- the daily roll ---------- */
  /** Clash chance of one pair today (0 when out of the roll). */
  clashP(e, a, b, date) {
    if (!e || e.v > CLASH.V_FROM) return 0;
    const pa = this.player(a), pb = this.player(b);
    if (!pa || !pb || areTwins(pa, pb)) return 0;   // twins quarrel like brothers (twinfight), never a clash / a fight
    if (e.clash && isoDays(e.clash, date) < CLASH.CD_PAIR) return 0;
    let p = CLASH.BASE + Math.max(0, -e.v - 20) / 100 * CLASH.V_K + CLASH.T_K * (bondTemper(pa) + bondTemper(pb));
    if (e.open && date <= e.open) p *= CLASH.OPEN_MULT;
    return clamp(p, 0, 1);
  },
  /** Once per training / match day: the first pair (sorted keys) whose seeded roll comes up → clash (or a fight at v ≤ FIGHT_V). */
  clashRoll(date, present) {
    if (!this.bonds || !date) return null;
    const m = this.clashMeta();
    if (m.last && isoDays(m.last, date) < CLASH.CD_TEAM) return null;
    const ids = new Set(present.map(p => p?.id ?? p));
    for (const k of Object.keys(this.bonds).sort()) {
      const [a, b] = k.split('|'), e = this.bonds[k];
      if (!ids.has(a) || !ids.has(b)) continue;
      const base = this.clashP(e, a, b, date), p = base && (this.clashForceP ?? base);   // (a forced p keeps the v / twin / cooldown rules)
      if (!p || seeded(date + '#clash#' + k)() >= p) continue;
      const fight = e.v <= CLASH.FIGHT_V && !(m.fight && isoDays(m.fight, date) < CLASH.FIGHT_CD);
      return { id: fight ? 'fight' : 'clash', cast: this.clashCast(a, b) };
    }
    return null;
  },
  /** [A] = the hotter kid, or the hurt one when the skew hides a grudge (he starts it, the other is surprised). */
  clashCast(a, b) {
    const hurt = this.skewHurt(a, b);
    if (hurt) return { kid: hurt, b: hurt === a ? b : a };
    const ta = bondTemper(this.player(a)), tb = bondTemper(this.player(b));
    return ta > tb || (ta === tb && a < b) ? { kid: a, b } : { kid: b, b: a };
  },
  /** Bookkeeping when a conflict event opens (cooldowns, counters, the `open` flag, causes). */
  clashStart(id, a, b, date = this.calendar?.date) {
    const m = this.clashMeta(), e = this.bondEntry(a, b, date);
    if (id === 'clash' || id === 'fight') {
      m.last = date; e.clash = date; this.clashCount(id, date);
      const hot = bondTemper(this.player(a)) >= 1 || bondTemper(this.player(b)) >= 1;   // a clash between hot heads: the cause is temper
      if (hot && (!e.cause || e.cause === 'grudge' || e.cause === 'temper')) this.setCause(a, b, 'temper', date);   // a sharper cause stays
    }
    if (id === 'fight') m.fight = date;
    if (id === 'envy') { m.envy = date; m.last = date; }
    if (id === 'twinfight') { m.twin = date; m.last = date; }
    if (id === 'pairreq') (m.pairreq ||= {})[bondKey(a, b)] = date;
  },
  /** The pair has an unresolved clash for OPEN_DAYS (its chance × OPEN_MULT); resolved = cleared. */
  clashOpen(a, b, open, date = this.calendar?.date) {
    const e = this.bondEntry(a, b, date);
    if (!e) return;
    if (open) e.open = isoAdd(date, CLASH.OPEN_DAYS); else delete e.open;
  },
  /** Training day (after the routine): clash / fight → brothers fell out → the favourite → "Can I play with him?". One a day. */
  bondEventRoll(date, present, matchDay = false) {
    if (!this.bonds || !date || !present?.length) return null;
    const c = this.clashRoll(date, present);
    if (c || matchDay) return c;
    return this.twinfightRoll(date, present) || this.envyRoll(date, present) || this.pairreqRoll(date, present);
  },
  twinfightRoll(date, present) {
    const m = this.clashMeta();
    if ((m.twin && isoDays(m.twin, date) < CLASH.TWIN_CD) || (m.last && isoDays(m.last, date) < CLASH.CD_TEAM)) return null;
    const ids = new Set(present.map(p => p.id));
    for (const p of [...this.squad].sort((x, y) => x.id.localeCompare(y.id))) {
      const t = p.twinId && this.player(p.twinId);
      if (!t || p.id > t.id || !ids.has(p.id) || !ids.has(t.id)) continue;
      const hurtOf = () => {   // the one on the bench (2+ matches in a row while his brother starts) or the one praised less
        for (const [x, y] of [[p, t], [t, p]]) if ((x.benchStreak || 0) >= CLASH.TWIN_BENCH && this.isStarter(y.id)) return x;
        const n = q => (q.praiseLog || []).filter(d => isoDays(d, date) < BOND.FAV_WEEKS * 7).length;
        return n(p) - n(t) >= CLASH.TWIN_PRAISE ? t : n(t) - n(p) >= CLASH.TWIN_PRAISE ? p : null;
      };
      const hurt = hurtOf();
      if (!hurt || seeded(date + '#twinfight#' + p.id)() >= (this.clashForceP ?? CLASH.TWIN_P)) continue;
      const other = hurt === p ? t : p;
      return { id: 'twinfight', cast: { kid: other.id, b: hurt.id } };   // [A] the favoured brother, [B] the hurt one
    }
    return null;
  },
  envyRoll(date, present) {
    const m = this.clashMeta();
    if ((m.envy && isoDays(m.envy, date) < CLASH.ENVY_CD) || (m.last && isoDays(m.last, date) < CLASH.CD_TEAM)) return null;
    const ids = new Set(present.map(p => p.id)), sl = this.slots(), lineOfKid = q => { const i = this.lineup.indexOf(q.id); return i >= 0 ? sl[i].line : NATURAL_LINE[q.position] || null; };
    const favs = this.squad.filter(p => ids.has(p.id) && (p.praiseLog || []).filter(d => isoDays(d, date) < BOND.FAV_WEEKS * 7).length >= BOND.FAV_PRAISES).sort((a, b) => a.id.localeCompare(b.id));
    for (const f of favs) {
      const rivals = this.squad.filter(q => q !== f && ids.has(q.id) && !areTwins(q, f) && q.psych.discipline <= BOND.FAV_DISC
        && (lineOfKid(q) === lineOfKid(f) || (q.tag && q.tag === f.tag))).sort((a, b) => a.id.localeCompare(b.id));
      if (!rivals.length || seeded(date + '#envy#' + f.id)() >= (this.clashForceP ?? CLASH.ENVY_P)) continue;
      const a = rivals[Math.floor(seeded(date + '#envywho#' + f.id)() * rivals.length)];
      return { id: 'envy', cast: { kid: a.id, b: f.id } };
    }
    return null;
  },
  pairreqRoll(date, present) {
    const m = this.clashMeta(), ids = new Set(present.map(p => p.id)), nb = new Set(this.lineupNeighbours().map(([a, b]) => bondKey(a, b)));
    for (const k of Object.keys(this.bonds).sort()) {
      const e = this.bonds[k], [a, b] = k.split('|');
      if (e.v < CLASH.PAIRREQ_V || !ids.has(a) || !ids.has(b) || areTwins(this.player(a), this.player(b))) continue;
      if (m.pairreq?.[k] && isoDays(m.pairreq[k], date) < CLASH.PAIRREQ_CD) continue;
      if (this.obligations().some(o => o.kind === 'pair' && bondKey(o.a, o.b) === k)) continue;
      const bench = !this.isStarter(a) || !this.isStarter(b);
      if (nb.has(k) && !bench) continue;
      if (seeded(date + '#pairreq#' + k)() >= (this.clashForceP ?? CLASH.PAIRREQ_P)) continue;
      const va = this.bondViewV(a, b), vb = this.bondViewV(b, a);   // the one who believes it more asks
      return { id: 'pairreq', cast: va > vb || (va === vb && !this.isStarter(a)) ? { kid: a, b } : { kid: b, b: a } };
    }
    return null;
  },
  /** After a loss: [B] erred before a goal against, a neighbour [A] with composure ≤ BLAME_COMP or v ≤ −20 (40 %) → "It's your fault"
      after the Coach's Word. [A]'s AFTER_GAME remark leans to [B] (afterTilt). Returns the post event or null. */
  blameRoll(eng, result, date = this.calendar?.date) {
    const m = this.clashMeta();
    m.post = null; m.tilt = null;
    if (!this.bonds || result !== 'L' || !eng?.blames?.length) return null;
    const nbs = this.lineupNeighbours();
    for (const bl of eng.blames) {
      const b = this.player(bl.id);
      if (!b) continue;
      const cand = nbs.filter(([x, y]) => x === b.id || y === b.id).map(([x, y]) => this.player(x === b.id ? y : x))
        .filter(a => a && eng.everPlayed.has(a.id) && !areTwins(a, b) && (a.psych.composure <= CLASH.BLAME_COMP || this.bondV(a.id, b.id) <= CLASH.V_FROM))
        .sort((x, y) => bondTemper(y) - bondTemper(x) || x.id.localeCompare(y.id));
      const a = cand[0];
      if (!a || seeded(date + '#blame#' + b.id)() >= (this.clashForceP ?? CLASH.BLAME_P)) continue;
      this.setCause(a.id, b.id, 'blame', date);
      this.addSkew(b.id, a.id, BOND.SKEW_BLAME, date);
      m.post = { id: 'blame', cast: { kid: a.id, b: b.id } };
      m.tilt = { a: a.id, b: b.id, date };
      return m.post;
    }
    return null;
  },

  /* ---------- the fight ---------- */
  /** The fight's hidden facts: the instigator (likelier the hotter kid), the mark ({след}), who was there. Seeded, saved. */
  fightFacts(a, b, date = this.calendar?.date) {
    const m = this.clashMeta(), k = bondKey(a, b);
    let f = (m.fights ||= []).find(x => x.key === k && x.date === date);
    if (f) return f;
    const pa = this.player(a), pb = this.player(b), r = seeded(date + '#fight#' + k);
    const pA = clamp(0.5 + 0.25 * (bondTemper(pa) - bondTemper(pb)), 0.2, 0.8);
    const inst = r() < pA ? a : b, T = (bondTemper(pa) + bondTemper(pb)) / 2;
    const mark = clamp(Math.floor(r() * (2 + T * 2)), 0, 3);   // 0 shirts · 1 bruise on B's cheek · 2 B's split lip · 3 B's black eye + A's split lip
    const present = (this.dayState?.().locker ? this.squad.filter(p => !this.dayState().locker.absent?.[p.id]) : this.squad).map(p => p.id).filter(id => id !== a && id !== b);
    f = { key: k, a, b, date, inst, mark, present, told: null, mumRoll: r() };
    m.fights.push(f);
    if (m.fights.length > 8) m.fights.shift();
    if (mark === 1) this.markFace(pb, 'bruise', date);
    else if (mark === 2) this.markFace(pb, 'lip', date);
    else if (mark === 3) { this.markFace(pb, 'eye', date); this.markFace(pa, 'lip', date); }
    return f;
  },
  /** "Ask the others what happened" (a clash): the witness names the pair's cause (openness decides if he talks). A rumour note. */
  witnessWhat(w, a, b, date = this.calendar?.date) {
    const r = seeded(date + '#witwhat#' + w.id + '#' + bondKey(a, b));
    if (r() >= this.openness(w, date)) return { kind: 'evade' };
    const e = this.bond(a, b), cause = e?.v <= CLASH.V_FROM ? e.cause || null : null;
    this.addBondNote(this.player(a), { with: b, band: bondBand(e?.v || 0), source: 'rumour', date, by: { pid: w.id, name: w.name }, ...(cause ? { cause } : {}) });
    return { kind: 'honest', cause };
  },
  lastFight(date = this.calendar?.date) {
    const f = [...(this.clashMeta().fights || [])].reverse().find(x => this.player(x.a) && this.player(x.b));
    return f && isoDays(f.date, date) <= TALK.WHO_DAYS ? f : null;
  },
  /** A face mark for MARK_DAYS (shown on the portrait; cleared by tickMarks). */
  markFace(p, kind, date = this.calendar?.date) {
    if (!p) return;
    p.faceMark = { kind, until: isoAdd(date, CLASH.MARK_DAYS) };
    p.refreshPortrait?.();
  },
  tickMarks(date) {
    for (const p of this.squad) if (p.faceMark && date > p.faceMark.until) { delete p.faceMark; p.refreshPortrait?.(); }
  },

  /* ---------- mediator ---------- */
  /** Kid `med` tries to make a and b friends again. S + MED_S (+ MED_LEAD_S with leadership ≥ MED_LEAD).
      Success: v +MED_DV, skew 0, his morale +2, a hidden leadership clue. Fail: caught in the middle — his v with one of them −10. */
  mediate(med, a, b, date = this.calendar?.date, salt = 'med') {
    const m = this.player(med?.id ?? med), pa = this.player(a), pb = this.player(b);
    if (!m || !pa || !pb) return null;
    const bonus = CLASH.MED_S + ((m.leadership ?? 10) >= CLASH.MED_LEAD ? CLASH.MED_LEAD_S : 0);
    const ok = this.clashSucceeds(pa.id, pb.id, salt + '#' + m.id, bonus, date);
    if (ok) {
      this.addBond(pa.id, pb.id, CLASH.MED_DV, null, date); this.skewReset(pa.id, pb.id); this.clashOpen(pa.id, pb.id, false, date);
      m.dyn.morale = clamp(m.dyn.morale + 2, 0, 100);
      this.addClue(m, { date, source: 'voice', ref: 'clash', signal: null, textKey: 'clue.voice.lead.med', kind: 'leadership', claim: 'high', by: null });
      this.addBondNote(pa, { with: pb.id, band: bondBand(this.bondV(pa.id, pb.id)), source: 'event', date, ev: 'med' });
      return { ok: true, med: m.id };
    }
    const side = seeded(date + '#medside#' + m.id)() < 0.5 ? pa : pb;
    this.addBond(m.id, side.id, CLASH.MED_FAIL, null, date);
    return { ok: false, med: m.id, side: side.id };
  },

  /* ---------- obligations (the coach's word: "play next to him", "both start") ---------- */
  oblAdd(kind, a, b, matches, date = this.calendar?.date) {
    const list = this.obligations().filter(o => !(o.kind === kind && bondKey(o.a, o.b) === bondKey(a, b)));
    list.push({ kind, a, b, left: matches, date });
    this.bondMeta.obl = list;
  },
  /** After a match (bondMatch): kept → the reward and gone; not kept → one match fewer; 0 left → broken. A kid who couldn't
      play (injured, banned, away) doesn't count against the coach that match. */
  oblCheck(eng, date = this.calendar?.date) {
    const list = this.obligations(), out = [];
    if (!list.length) return out;
    const starters = new Set(eng.sides[0].entries.filter(e => e.p).map(e => e.p.id).filter(id => !eng.subs.some(s => s.in === id)));
    const nb = new Set(this.lineupNeighbours().map(([a, b]) => bondKey(a, b))), E = CLASH.E;
    for (const o of list) {
      const a = this.player(o.a), b = this.player(o.b);
      if (!a || !b) { o.left = 0; o.void = true; continue; }
      const could = q => eng.everPlayed.has(q.id) || q.available;
      if (!could(a) || !could(b)) continue;   // not his fault this time
      const kept = o.kind === 'pair' ? starters.has(a.id) && starters.has(b.id) && nb.has(bondKey(a.id, b.id)) : starters.has(a.id) && starters.has(b.id);
      if (kept) {
        if (o.kind === 'pair') { for (const q of [a, b]) q.dyn.morale = clamp(q.dyn.morale + E.pairreq.keptM, 0, 100); this.addBond(a.id, b.id, E.pairreq.kept, null, date); }
        else { for (const q of [a, b]) q.dyn.morale = clamp(q.dyn.morale + E.twinfight.keptM, 0, 100); this.addBond(a.id, b.id, E.twinfight.keptV, null, date); }
        this.addDiary({ date, key: 'obl.kept.' + o.kind, vars: { a: { pid: a.id }, b: { pid: b.id } }, cls: 'ev' });
        o.left = 0; o.done = 'kept'; out.push(o);
        continue;
      }
      o.left--;
      if (o.left <= 0) {
        if (o.kind === 'pair') a.dyn.morale = clamp(a.dyn.morale + E.pairreq.brokenM, 0, 100);
        else { this.addBond(a.id, b.id, E.twinfight.brokenV, null, date); this.addRep('parents', E.twinfight.brokenPar); }
        this.addDiary({ date, key: 'obl.broken.' + o.kind, vars: { a: { pid: a.id }, b: { pid: b.id } }, cls: 'ev' });
        o.done = 'broken'; out.push(o);
      }
    }
    this.bondMeta.obl = list.filter(o => o.left > 0);
    return out;
  },
  /** The coach keeps his word before kick-off (reference policy; never the hidden v): `start` → both in the XI (promiseStart's
      line swap), `pair` → [B] moved next to [A] (a swap inside the XI, else from the bench into a slot of his line next to [A]). */
  oblKeepXI() {
    let n = 0;
    for (const o of this.obligations()) {
      const a = this.player(o.a), b = this.player(o.b);
      if (!a || !b || !a.available || !b.available) continue;
      if (o.kind === 'start') { for (const q of [a, b]) if (!this.isStarter(q.id) && this.promiseStart(q)) n++; continue; }
      if (this.lineupNeighbours().some(([x, y]) => bondKey(x, y) === bondKey(a.id, b.id))) continue;
      if (!this.isStarter(a.id) && this.promiseStart(a)) n++;
      const i = this.lineup.indexOf(a.id);
      if (i < 0) continue;
      const sl = this.slots(), nbr = bondNeighbours(this.formation).filter(([x, y]) => x === i || y === i).map(([x, y]) => (x === i ? y : x)).filter(j => j > 0);
      const bi = this.lineup.indexOf(b.id), line = bi >= 0 ? sl[bi].line : NATURAL_LINE[b.position];
      const j = nbr.find(j => sl[j].line === line) ?? nbr[0];
      if (j == null) continue;
      if (bi >= 0) { [this.lineup[bi], this.lineup[j]] = [this.lineup[j], this.lineup[bi]]; }
      else this.lineup[j] = b.id;
      n++;
    }
    return n;
  },

  /* ---------- quiet moments (a diary line, no window) ---------- */
  bondQuiet(date, a, b, kind) {
    const m = this.clashMeta();
    if (!this.bonds || m.quiet === date || !this.player(a) || !this.player(b) || this.bondV(a, b) < CLASH.QUIET_V) return false;
    m.quiet = date;
    this.addBond(a, b, CLASH.QUIET_DV, null, date);
    this.addBondNote(this.player(a), { with: b, band: bondBand(this.bondV(a, b)), source: 'event', date, ev: 'quiet.' + kind });
    this.addDiary({ date, key: 'quiet.' + kind, vars: { a: { pid: a }, b: { pid: b } }, cls: 'ev' });
    return true;
  },
  /** A training knock: a mate (v ≥ 40, trained today) walks the hurt kid home. */
  bondQuietHurt(date, hurt, trained) {
    for (const p of hurt) {
      const mate = this.bondsOf(p.id).filter(x => x.v >= BOND.MATE_V && trained.some(t => t.id === x.id)).sort((x, y) => y.v - x.v || x.id.localeCompare(y.id))[0];
      if (mate && this.bondQuiet(date, mate.id, p.id, 'home')) return true;
    }
    return false;
  },

  /* ---------- DEBUG.EXE ---------- */
  /** A cast for a forced event: the given pair (or the worst / best stored pair that fits). */
  debugClashCast(id, key = null) {
    const pairs = Object.entries(this.bonds || {}).filter(([k]) => k.split('|').every(x => this.player(x)));
    if (key) { const [a, b] = key.split('|'); return id === 'pairreq' || id === 'envy' ? { kid: a, b } : this.clashCast(a, b); }
    if (id === 'twinfight') { const p = this.squad.find(q => q.twinId && this.player(q.twinId)); return p ? { kid: p.id, b: p.twinId } : null; }
    const sorted = pairs.filter(([k]) => { const [a, b] = k.split('|'); return !areTwins(this.player(a), this.player(b)); }).sort((x, y) => (id === 'pairreq' ? y[1].v - x[1].v : x[1].v - y[1].v));
    const k = sorted[0]?.[0] || (this.squad.length > 1 ? bondKey(this.squad[0].id, this.squad[1].id) : null);
    if (!k) return null;
    const [a, b] = k.split('|');
    return id === 'pairreq' || id === 'envy' ? { kid: a, b } : this.clashCast(a, b);
  },
};
/** v3.27 the cause → the matching option per event (see the design notes; grudge waits for v3.28 teambuilding). */
const CLASH_CAUSE_OPT = {
  clash: { temper: 'c', blame: 'b', unfair: 'g', position: 'b', envy: 'b' },
  blame: { blame: 'b', unfair: 'g' },
  fight: { temper: 'b', unfair: 'g' },
  envy: { envy: 'c', unfair: 'g' },
  twinfight: { position: 'c', envy: 'b' },
};
Object.assign(GameState.prototype, ClashMixin);
