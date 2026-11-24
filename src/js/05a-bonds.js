/* =========================================================
   v3.25 "BONDS" — friendships and dislikes inside the squad (GameState mixin).
   state.bonds = { 'idA|idB' (ids sorted): { v −100…100, root, cause, since, last, cd, cdate } }; missing = neutral (v 0).
   Roots come from the yard (5 streets) and the school (3 schools) — hidden, seeded per kid; twins are made after world
   generation on their own stream. v moves with training, matches, praise and time (BOND.*). The coach never sees v:
   he collects notes (p.bondNotes) from the locker room, practice, after-game remarks, the loner hint, the yard and his talks.
   All randomness here is seeded() — Math.random is never touched.
   ========================================================= */

/** Hidden yard / school, lazily from a seeded stream (old saves get the same values on every load). */
function kidRoots(p) {
  if (!p) return { yard: 0, school: 0 };
  if (!Number.isInteger(p.yard) || !Number.isInteger(p.school)) {
    const r = seeded('yard' + p.id + '#home');   // own stream: 'yard' + id alone is the v3.12 yard-notes stream
    p.yard = Math.floor(r() * BOND.YARDS); p.school = Math.floor(r() * BOND.SCHOOLS);
  }
  return { yard: p.yard, school: p.school };
}
const sameYard = (a, b) => kidRoots(a).yard === kidRoots(b).yard;
const sameSchool = (a, b) => kidRoots(a).school === kidRoots(b).school;
const areTwins = (a, b) => !!a && !!b && a.twinId === b.id && b.twinId === a.id;

/** v3.25 twins: after the world is built, a private stream seeded('twins' + worldSeed) turns TWINS.PAIRS kids into twins of
    another kid of the same age (pair 1 inside the draft pool, pair 2 elsewhere in the world). The first kid of a pair is
    untouched; the second gets his surname, yard, school, family (wealth), archetype and face (one visible difference: the hair),
    a different first initial and skills re-rolled from that archetype with the strong group swapped. Never Math.random. */
function makeTwins(world, pool = []) {
  if (typeof window !== 'undefined' && window.YAM_NO_TWINS) return [];   // test/policy.js --notwins (the v3.24 world)
  const seed = world.map(p => p.name).join(',');
  const r = seeded('twins' + seed), inPool = new Set(pool), made = [];
  const free = p => !p.twinId && !made.some(m => m.includes(p));
  const pairsOf = list => { const out = []; for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
    if (list[i].bio.age === list[j].bio.age && list[i].teamId === list[j].teamId && free(list[i]) && free(list[j])) out.push([list[i], list[j]]); return out; };
  const groups = [world.filter(p => inPool.has(p.id)), world.filter(p => !inPool.has(p.id))];
  for (let k = 0; k < TWINS.PAIRS; k++) {
    let cand = pairsOf(groups[Math.min(k, 1)]);
    if (!cand.length) cand = pairsOf(world);
    if (!cand.length) break;
    const [a, b] = cand[Math.floor(r() * cand.length)];
    twinOf(a, b, r);
    made.push([a, b]);
  }
  return made;
}
function twinOf(a, b, r) {
  const ini = a.name[0];
  let first = b.name.split(' ')[0];
  if (first[0] === ini) { const opts = FIRST.filter(f => f[0] !== ini); first = opts[Math.floor(r() * opts.length)]; }
  b.name = `${first} ${a.surname}`;
  b.archetype = a.archetype;
  const kr = kidRoots(a); b.yard = kr.yard; b.school = kr.school;
  b.wealth = a.wealth;
  const fresh = AttrGen.roll(a.archetype, r, 0, a.bio.age), P = PROFILES[a.archetype] || PROFILES.MID;
  const skew = g => ATTR_GROUPS[g].reduce((t, k) => t + (a[g][k] - (P[k][0] + P[k][1]) / 2) / Math.max(1, P[k][1] - P[k][0]), 0) / ATTR_GROUPS[g].length;
  const techA = skew('technical') >= skew('physical');   // a is the technical one → b is the physical one (and back)
  for (const g of ['physical', 'technical', 'tactical']) b[g] = { ...fresh[g] };
  for (const k of ATTR_GROUPS.physical) b.physical[k] = clamp(b.physical[k] + (techA ? TWINS.SKEW : -TWINS.SKEW), 1, 20);
  for (const k of ATTR_GROUPS.technical) b.technical[k] = clamp(b.technical[k] + (techA ? -TWINS.SKEW : TWINS.SKEW), 1, 20);
  b.psych = { ...fresh.psych };   // growth room is rolled separately (fresh.psych.potential)
  b.bio = { ...fresh.bio, age: a.bio.age };
  b.face = [...a.face]; b.face[5] = a.face[5] === 0 ? 1 : 0;   // the same face; one of them has the messy hair ("the cowlick")
  b.twinId = a.id; a.twinId = b.id;
  b.refreshPortrait?.();
}
/** The twin with the messy hair (face[5] === 0) is the one with "the cowlick". */
const twinCowlick = (a, b) => (a.face?.[5] === 0 ? a : b);

const BondsMixin = {
  /* ---------- store ---------- */
  bond(a, b) { const ia = a?.id ?? a, ib = b?.id ?? b; return ia && ib && ia !== ib ? this.bonds?.[bondKey(ia, ib)] || null : null; },
  bondV(a, b) { return this.bond(a, b)?.v || 0; },
  /** Every change goes through here: clamp −100…100, last date, the cause of the strongest recent drop; twins never below FLOOR.
      An entry with |v| < BOND.DEL and root 0 is deleted on Sunday (bondWeek), after the decay. */
  addBond(a, b, dv, cause = null, date = this.calendar?.date) {
    const ia = a?.id ?? a, ib = b?.id ?? b;
    if (!ia || !ib || ia === ib || !dv) return 0;
    this.bonds ||= {};
    const k = bondKey(ia, ib), e = this.bonds[k] || { v: 0, root: 0, cause: null, since: date, last: null };
    let v = clamp(Math.round(e.v + dv), -100, 100);
    if (areTwins(this.player(ia), this.player(ib))) v = Math.max(TWINS.FLOOR, v);
    if (dv < 0 && cause && (!e.cause || dv <= (e.cd ?? 0) || !e.cdate || isoDays(e.cdate, date) > BOND.STALE_DAYS)) { e.cause = cause; e.cd = dv; e.cdate = date; }
    e.v = v; e.last = date;
    this.bonds[k] = e;   // (small entries are dropped by the Sunday decay — dropping them here would stop any +1 from ever adding up)
    return v;
  },
  bondBand(v) { return bondBand(v); },
  /** [{ id, v, e }] of this kid's stored pairs with kids still in the squad. */
  bondsOf(id) {
    const out = [];
    for (const k in this.bonds || {}) { const [a, b] = k.split('|'); if (a !== id && b !== id) continue; const o = a === id ? b : a; if (this.player(o)) out.push({ id: o, v: this.bonds[k].v, e: this.bonds[k] }); }
    return out;
  },
  /** The draft / an old save: starting bonds for the squad (BOND.START), seeded per pair — the same values on every call. */
  initBonds(date = this.calendar?.date) {
    this.bonds = {};
    const S = BOND.START, sq = this.squad;
    for (let i = 0; i < sq.length; i++) for (let j = i + 1; j < sq.length; j++) {
      const a = sq[i], b = sq[j], k = bondKey(a.id, b.id), y = sameYard(a, b), sc = sameSchool(a, b);
      let st = areTwins(a, b) ? S.twins : y && sc ? S.both : y ? S.yard : sc && a.bio.age === b.bio.age ? S.school : null, cause = null;
      if (y && !areTwins(a, b)) {
        if (seeded('grudge#' + k)() < BOND.GRUDGE) { st = S.grudge; cause = 'grudge'; }
        else if (seeded('yardgame#' + k)() < BOND.YARD_GAME) st = [st[0] + BOND.YARD_GAME_DV, st[1]];   // the yard match: opposite sides, one scored
      }
      if (st) this.bonds[k] = { v: st[0], root: st[1], cause, since: date, last: date, ...(cause ? { cd: st[0], cdate: date } : {}) };
      if (st && !cause && !areTwins(a, b)) {   // v3.27: a one-sided friendship (one of them thinks they're closer) — its own stream
        const r = seeded('skew#' + k);
        if (r() < BOND.SKEW_START_P) this.bonds[k].skew = r() < 0.5 ? BOND.SKEW_START : -BOND.SKEW_START;
      }
    }
    return this.bonds;
  },
  /** Pairs of XI neighbours in the current lineup ([idA, idB]). */
  lineupNeighbours(lineup = this.lineup, formation = this.formation) {
    return bondNeighbours(formation).map(([i, j]) => [lineup[i], lineup[j]]).filter(([a, b]) => a && b && this.player(a) && this.player(b));
  },
  /** For MatchEngine opts.bonds (our side only; AI clubs have none). */
  engineBonds() {
    return { side: 0, v: (a, b) => this.bondV(a, b), twin: (a, b) => areTwins(this.player(a), this.player(b)) };
  },

  /* ---------- sources of change ---------- */
  /** Training day: XI neighbours who both trained +TRAIN; 2 seeded "pair drill" pairs among the trainees +DRILL. */
  bondTraining(date, trained) {
    if (!this.bonds || !trained?.length) return;
    const ids = new Set(trained.map(p => p.id)), apart = (a, b) => { const e = this.bond(a, b); return !!e?.apart && date <= e.apart; };   // v3.27: twins in separate groups
    for (const [a, b] of this.lineupNeighbours()) if (ids.has(a) && ids.has(b) && !apart(a, b)) this.addBond(a, b, BOND.TRAIN, null, date);
    const list = trained.map(p => p.id).sort(), r = seeded(date + '#drill');
    for (let k = 0; k < BOND.DRILL_PAIRS && list.length >= 2; k++) {
      const i = Math.floor(r() * list.length); let j = Math.floor(r() * (list.length - 1)); if (j >= i) j++;
      if (!apart(list[i], list[j])) this.addBond(list[i], list[j], BOND.DRILL, null, date);
    }
  },
  /** After a match (visual and Quick Sim): side by side, assists, a win, the error before a goal, the fight for a place, twins. */
  bondMatch(eng, result, date = this.calendar.date) {
    if (!this.bonds) this.initBonds(date);
    const side = eng.sides[0], mins = new Map();
    for (const e of side.entries) if (e.p && !eng.subs.some(s => s.in === e.p.id)) mins.set(e.p.id, 90);
    for (const s of eng.subs) { mins.set(s.out, s.minute); mins.set(s.in, 90 - s.minute); }
    for (const [a, b] of this.lineupNeighbours()) if ((mins.get(a) || 0) >= BOND.SIDE_MIN && (mins.get(b) || 0) >= BOND.SIDE_MIN) this.addBond(a, b, BOND.SIDE, null, date);
    for (const ev of eng.matchEvents) if (ev.type === 'goal' && ev.side === 0 && ev.assistId && this.player(ev.assistId)) {
      this.addBond(ev.assistId, ev.playerId, BOND.ASSIST, null, date);
      this.bondQuiet?.(date, ev.assistId, ev.playerId, 'assist');   // v3.27: "Lee set up Finn — they hugged" (mates only, one a day)
    }
    const played = [...eng.everPlayed].filter(id => this.player(id));
    if (result === 'W') for (let i = 0; i < played.length; i++) for (let j = i + 1; j < played.length; j++) if (this.bondV(played[i], played[j]) > 0) this.addBond(played[i], played[j], BOND.WIN, null, date);
    for (const bl of eng.blames || []) {   // the erring kid and a hot-headed neighbour
      const err = this.player(bl.id); if (!err) continue;
      for (const q of this.lineupNeighbours().filter(([a, b]) => a === err.id || b === err.id).map(([a, b]) => this.player(a === err.id ? b : a)))
        if (q && bondTemper(q) >= BOND.BLAME_T) { this.addBond(err.id, q.id, BOND.BLAME, 'blame', date); this.addSkew?.(err.id, q.id, BOND.SKEW_BLAME / 2, date); }   // v3.27: the blamed kid takes it worse
    }
    const starters = this.squad.filter(p => eng.everPlayed.has(p.id) && p.tag);   // the fight for a place (same position tag)
    for (const b of this.squad.filter(p => !eng.everPlayed.has(p.id) && p.tag && p.available && (p.benchStreak || 0) >= BOND.BENCH_RUN))
      for (const s of starters) if (s.tag === b.tag) this.addBond(b.id, s.id, BOND.POSITION, 'position', date);
    for (const p of this.squad) {   // twins: 3 matches together and the coach can tell them apart
      const t = p.twinId && this.player(p.twinId);
      if (!t || p.id > t.id || !eng.everPlayed.has(p.id) || !eng.everPlayed.has(t.id)) continue;
      const k = bondKey(p.id, t.id), tw = (this.bondMeta ||= { known: {}, matches: {} });
      tw.matches[k] = (tw.matches[k] || 0) + 1;
      if (tw.matches[k] >= TWINS.TELL_MATCHES) this.learnTwins(p, date);
    }
    for (const id of eng.injured || []) { const p = this.player(id), t = p?.twinId && this.player(p.twinId); if (t) t.dyn.morale = clamp(t.dyn.morale + TWINS.HURT_MORALE, 0, 100); }
    this.oblCheck?.(eng, date);   // v3.27: "play next to him" / "both start" — kept or broken
    this.bondMatchNotes(eng, date);
  },
  /** A praise for one kid (Coach's Word praise → the man of the match, a REVIEW card, the armband, the office praise). */
  notePraise(p, date = this.calendar?.date) {
    if (!p || !date) return;
    p.praiseLog = [...(p.praiseLog || []).filter(d => isoDays(d, date) < BOND.FAV_WEEKS * 7), date];
  },
  /** Sunday (weekReview, before cohesion): the favourite's envy, decay, morale from friends / enemies. */
  bondWeek(date) {
    if (!this.bonds) this.initBonds(date);
    const start = weekStartOf(date);
    for (const p of this.squad) {   // the favourite
      const n = (p.praiseLog || []).filter(d => isoDays(d, date) < BOND.FAV_WEEKS * 7).length;
      if (n < BOND.FAV_PRAISES) continue;
      for (const q of this.squad) if (q !== p && q.psych.discipline <= BOND.FAV_DISC) { this.addBond(p.id, q.id, BOND.FAV, 'envy', date); this.addSkew?.(q.id, p.id, BOND.SKEW_ENVY, date); }   // v3.27: only the envious kid is hurt
    }
    for (const e of Object.values(this.bonds)) if (e.skew) {   // v3.27: the skew fades SKEW_DECAY a week towards 0
      e.skew = e.skew > 0 ? Math.max(0, e.skew - BOND.SKEW_DECAY) : Math.min(0, e.skew + BOND.SKEW_DECAY);
      if (!e.skew) delete e.skew;
    }
    for (const k of Object.keys(this.bonds)) {   // decay towards the root (twins faster)
      const e = this.bonds[k]; if (e.last && e.last >= start) continue;
      const [a, b] = k.split('|'), tw = areTwins(this.player(a), this.player(b)), step = tw ? TWINS.DECAY : BOND.DECAY, to = e.root || 0;
      if (e.v === to) { if (!e.root && Math.abs(e.v) < BOND.DEL) delete this.bonds[k]; continue; }
      e.v = e.v > to ? Math.max(to, e.v - step) : Math.min(to, e.v + step);
      if (Math.abs(e.v) < BOND.DEL && !e.root) delete this.bonds[k];
    }
    for (const k of Object.keys(this.bonds)) if (Math.abs(this.bonds[k].v) < BOND.DEL && !this.bonds[k].root) delete this.bonds[k];
    for (const p of this.squad) {   // morale: a mate in the squad / kids he is at war with
      const list = this.bondsOf(p.id);
      let d = list.some(x => x.v >= BOND.MATE_V) ? BOND.MORALE_MATE : 0;
      d += Math.max(BOND.MORALE_ENEMY_CAP, list.filter(x => x.v <= -60).length * BOND.MORALE_ENEMY);
      if (d) p.dyn.morale = clamp(p.dyn.morale + d, 0, 100);
    }
  },
  /** ATMOS = clamp((F − 1.5 × E) / squad × K, MIN, MAX): F = best mates 1 + mates 0.5, E = at war 1 + don't get on 0.5. */
  atmos() {
    if (!this.bonds || !this.squad.length) return 0;
    let F = 0, E = 0;
    for (const k in this.bonds) {
      const [a, b] = k.split('|'); if (!this.player(a) || !this.player(b)) continue;
      const v = this.bonds[k].v;
      if (v >= 60) F += 1; else if (v >= 20) F += 0.5; else if (v <= -60) E += 1; else if (v <= -20) E += 0.5;
    }
    return clamp((F - 1.5 * E) / this.squad.length * BOND.ATMOS_K, BOND.ATMOS_MIN, BOND.ATMOS_MAX);
  },
  /** v3.25 the attendance chance (attendChance, from the week's 3rd training) − LONER_ATTEND for a loner, − FRIEND_AWAY when a best
      mate (v ≥ 60) is away with a good reason (injured, kept at home, banned, at a school / city event). */
  bondAttendPen(p, date = this.calendar?.date) {
    let pen = this.isLoner(p) ? BOND.LONER_ATTEND : 0;
    if (this.bondsOf(p.id).some(x => { const q = x.v >= 60 && this.player(x.id); return q && (q.injuryDays > 0 || q.awayDays > 0 || q.suspensionMatches > 0 || !!this.worldAway(q.id, date)); })) pen += BOND.FRIEND_AWAY;
    return pen;
  },
  /** No bond ≥ 20 and at least one ≤ −20. */
  isLoner(p) { const l = this.bondsOf(p.id); return !l.some(x => x.v >= 20) && l.some(x => x.v <= -20); },
  /** A kid leaves (expel / the scout / "misses his brother"): best mates are upset, the twin may follow. */
  bondLeave(p, date = this.calendar?.date) {
    for (const x of this.bondsOf(p.id)) if (x.v >= 60 && !areTwins(p, this.player(x.id))) { const q = this.player(x.id); q.dyn.morale = clamp(q.dyn.morale + BOND.FRIEND_LEAVES, 0, 100); }
    for (const k of Object.keys(this.bonds || {})) if (k.split('|').includes(p.id)) delete this.bonds[k];
  },

  /* ---------- the draft ---------- */
  /** The twin still on the draft board when the coach signs `id` (and there is room for him) — or null. */
  draftTwinAsk(id) {
    const d = this.draft, p = this.globalPlayers.find(x => x.id === id), t = p?.twinId && this.globalPlayers.find(x => x.id === p.twinId);
    if (!d || !t || !d.pool.includes(t.id) || d.signed.includes(t.id) || !d.signed.includes(id) || d.signed.length >= WORLD.DRAFT_SIGN) return null;
    if ((d.twins ||= {})[bondKey(id, t.id)]) return null;   // asked once
    return t;
  },
  /** The mum's request: take → the brother uses the next pick; refuse → morale −8 for the taken twin, Parents −2 (+ maybe a delayed event). */
  draftTwinAnswer(id, take) {
    const d = this.draft, p = this.globalPlayers.find(x => x.id === id), t = p && this.globalPlayers.find(x => x.id === p.twinId);
    if (!d || !t) return false;
    d.twins[bondKey(id, t.id)] = take ? 'take' : 'refuse';
    if (take && d.signed.length < WORLD.DRAFT_SIGN && !d.signed.includes(t.id)) d.signed.push(t.id);
    if (!take) { p.dyn.morale = clamp(p.dyn.morale + TWINS.REFUSE_MORALE, 0, 100); this.addRep('parents', TWINS.REFUSE_PARENTS); }
    this.save();
    return true;
  },
  /** finishDraft: the yard notes become root notes; a refused twin may miss his brother in 2–4 weeks. */
  draftBondNotes(date) {
    const board = [...(this.draft?.pool || [])];
    for (const p of this.squad) {
      const yn = typeof DraftView !== 'undefined' ? DraftView.notes(p) : [];
      if (!(yn.length < YARD.MAX || yn[0] === 'quiet')) continue;   // the card had no room for it
      const m = this.draftYardMate(p, board);
      if (m && this.player(m.id)) this.addBondNote(p, { with: m.id, band: 'yard', source: 'yard', date, root: 'yard' });
    }
    for (const [k, ans] of Object.entries(this.draft?.twins || {})) {
      if (ans !== 'refuse') continue;
      const kid = k.split('|').map(id => this.player(id)).find(Boolean);
      if (!kid || this.player(kid.twinId)) continue;
      const r = seeded('twinmiss#' + k);
      if (r() < (this.twinMissForce ?? TWINS.MISS_P)) this.eventQueue.push({ id: 'twinmiss', due: isoAdd(date, rndR(r, ...TWINS.MISS_DAYS)), matchDay: false, from: null, cast: { kid: kid.id } });
    }
    this.eventQueue.sort((a, b) => a.due.localeCompare(b.due));
  },

  /* ---------- twins ---------- */
  twinsKnown(p) { const t = p?.twinId && this.player(p.twinId); return !t || !!this.bondMeta?.known?.[bondKey(p.id, t.id)]; },
  /** The coach can tell them apart now: a Notebook line, mixed-up clues / notes get struck through. */
  learnTwins(p, date = this.calendar?.date) {
    const t = p?.twinId && this.player(p.twinId);
    if (!t || this.twinsKnown(p)) return false;
    (this.bondMeta ||= { known: {}, matches: {} }).known[bondKey(p.id, t.id)] = date || true;
    const c = twinCowlick(p, t);
    this.addDiary({ date, key: 'twins.learned', vars: { k: { pid: c.id }, b: { pid: (c === p ? t : p).id } }, cls: 'ev' });
    return true;
  },
  /** Until the coach can tell them apart, a clue / note about a twin lands on his brother with TWINS.MIXUP. → the kid it lands on. */
  mixTwin(p, salt) {
    const t = p?.twinId && this.player(p.twinId);
    if (!t || this.twinsKnown(p)) return null;
    const m = this.twinMixForce ?? TWINS.MIXUP;
    return seeded('mix#' + p.id + '#' + salt)() < m ? t : null;
  },

  /* ---------- the coach's notes (p.bondNotes) ---------- */
  /** { with, band, source, date, by } on kid p (band: a BOND.BANDS key, 'alone' for the loner hint, 'yard' for a root clue). */
  addBondNote(p, n) {
    if (!p) return null;
    let owner = p, mix = null;
    const tw = n.with && this.mixTwin(p, (n.source || '') + '#' + n.with + '#' + n.date);
    if (tw && tw.id !== n.with) { mix = p.id; owner = tw; }
    const note = { with: n.with || null, band: n.band, source: n.source, date: n.date, by: n.by || null, ...(n.cause ? { cause: n.cause } : {}), ...(n.root ? { root: n.root } : {}), ...(n.ev ? { ev: n.ev } : {}), ...(mix ? { mix } : {}) };
    owner.bondNotes = [...(owner.bondNotes || []), note].slice(-24);
    return note;
  },
  /** All notes about the pair (a, b) from both kids' lists, oldest first. */
  pairNotes(a, b) {
    const pa = this.player(a?.id ?? a), pb = this.player(b?.id ?? b);
    if (!pa || !pb) return [];
    return [...(pa.bondNotes || []).filter(n => n.with === pb.id), ...(pb.bondNotes || []).filter(n => n.with === pa.id)].sort((x, y) => (x.date || '').localeCompare(y.date || ''));
  },
  /** What the coach believes about the pair: the latest note's band (+ confirmed: two notes of the same kind from different
      sources or days, the v3.18 rule) — or null. Rumours and the yard's root clue never count as a band of their own. */
  knownBond(a, b) {
    const list = this.pairNotes(a, b).filter(n => n.band !== 'yard' && !n.mix);
    if (!list.length) return null;
    const last = list[list.length - 1], cls = bondClass(last.band);
    const confirmed = list.some(n => n !== last && bondClass(n.band) === cls && (n.source !== last.source || n.date !== last.date));
    const stale = !!last.date && !!this.calendar?.date && isoDays(last.date, this.calendar.date) > BOND.STALE_DAYS;
    return { band: last.band, cls, source: last.source, date: last.date, confirmed, stale };
  },
  /** Known links of a kid (for PLAYER_INFO, the tac board, the Notebook): [{ id, band, cls, … }]. */
  knownLinks(id) {
    const out = [];
    for (const q of this.squad) { if (q.id === id) continue; const k = this.knownBond(id, q.id); if (k && k.cls !== 'neutral') out.push({ id: q.id, ...k }); }
    return out;
  },
  /** Training (the locker room): pairs v ≥ CAME_V arrive together — 30 % per pair, max one line per training. */
  bondArrivals(date, present) {
    if (!this.bonds) return null;
    const ids = new Set(present.map(p => p.id)), r = seeded(date + '#came');
    for (const k of Object.keys(this.bonds).sort()) {
      const [a, b] = k.split('|'), e = this.bonds[k];
      if (e.v < BOND.CAME_V || !ids.has(a) || !ids.has(b)) continue;
      if (r() < BOND.CAME_P) { this.addBondNote(this.player(a), { with: b, band: bondBand(e.v), source: 'came', date }); return { a, b }; }
    }
    return null;
  },
  /** v3.24 auto lineup + v3.25: two kids with a KNOWN bad bond next to each other → swap one of them with a starter of the same
      line (or a fit bench kid of the same tag) whose overall differs by ≤ 0.5, if that separates them. Never the hidden v. */
  bondSeparate() {
    if (!this.bonds) return 0;
    const slots = this.slots(), bad = (a, b) => this.knownBond(a, b)?.cls === 'bad';
    const clash = lu => this.lineupNeighbours(lu).filter(([a, b]) => bad(a, b));
    let n = 0;
    for (let guard = 0; guard < 4; guard++) {
      const now = clash(this.lineup);
      if (!now.length) break;
      let best = null;
      for (const who of [...new Set(now.flat())]) {
        const i = this.lineup.indexOf(who), p = this.player(who);
        if (i <= 0) continue;
        const tryLu = lu => { const c = clash(lu).length; if (c < now.length && (!best || c < best.c)) best = { lu, c }; };
        this.lineup.forEach((id, j) => {
          const q = this.player(id);
          if (j <= 0 || j === i || slots[j].line !== slots[i].line || !q || Math.abs(q.overall - p.overall) > 0.5) return;
          const lu = [...this.lineup]; [lu[i], lu[j]] = [lu[j], lu[i]]; tryLu(lu);
        });
        for (const q of this.bench()) {
          if (!q.available || p.hasFlag('Showcase') || q.position !== p.position || q.hasFlag('Promised_Start') || Math.abs(q.overall - p.overall) > 0.5) continue;
          const lu = [...this.lineup]; lu[i] = q.id; tryLu(lu);
        }
      }
      if (!best) break;
      this.lineup = best.lu; n++;
    }
    return n;
  },
  /** Match day locker room: one warning when two kids the coach KNOWS don't get on stand next to each other in the XI. */
  lockerBondWarning() {
    if (!this.bonds) return null;
    for (const [a, b] of this.lineupNeighbours()) {
      const k = this.knownBond(a, b);
      if (k?.cls !== 'bad') continue;
      const i = this.lineup.indexOf(a), j = this.lineup.indexOf(b), sl = this.slots(), line = sl[i].line === sl[j].line ? sl[i].line : sl[Math.max(i, j)].line;
      return { a, b, line, date: k.date };
    }
    return null;
  },
  /** v3.6 practice observation: "stays near Lee, doesn't even look at Finn" — wrong with CLUES.WRONG. */
  bondObserve(p, date) {
    const list = this.bondsOf(p.id).filter(x => Math.abs(x.v) >= 20);
    if (!list.length) return null;
    const r = seeded(date + '#bobs#' + p.id), x = list[Math.floor(r() * list.length)];
    let band = bondBand(x.v);
    if (r() < CLUES.WRONG) band = BOND.BANDS.map(b => b.key).filter(k => k !== band)[Math.floor(r() * (BOND.BANDS.length - 1))];
    return this.addBondNote(p, { with: x.id, band, source: 'obs', date });
  },
  /** Match notes are written elsewhere (after-game remarks); kept as a hook for v3.26. */
  bondMatchNotes() {},
  /** Match Summary: a pass between two kids with v ≤ −20 lost before a chance / goal against — only a pair the coach knows about. */
  bondCauseOf(eng) {
    for (const l of [...(eng.keyLosses || [])].sort((x, y) => (y.goal ? 1 : 0) - (x.goal ? 1 : 0))) {
      if (l.kind !== 'pass' || !this.player(l.a) || !this.player(l.b) || this.bondV(l.a, l.b) > -20) continue;
      if (this.knownBond(l.a, l.b)?.cls === 'bad') return { a: l.a, b: l.b, goal: !!l.goal };
    }
    return null;
  },
  /** Monday briefing: one loner line (3 phrasings, the week number picks one → never the same two weeks running) + an exact 'alone' note. */
  lonerLine(date) {
    const kids = this.squad.filter(p => this.isLoner(p)).sort((a, b) => a.number - b.number);
    const tw = (this.bondMeta ||= { known: {}, matches: {} }), last = tw.lonerLast || null;
    if (last?.date === date) return kids.some(k => k.id === last.pid) ? { pid: last.pid, v: last.v } : null;
    const p = kids[0];
    if (!p) return null;
    const v = Math.floor(isoDays('2000-01-03', date) / 7) % 3;   // the week number picks the phrasing → never the same two weeks running
    tw.lonerLast = { pid: p.id, date, v };
    this.addBondNote(p, { with: null, band: 'alone', source: 'loner', date });
    return { pid: p.id, v: tw.lonerLast.v };
  },
  /** The draft (v3.12 yard notes): "from Canal Street, like Lee" — a clue about the root. */
  draftYardMate(p, ids) {
    if (seeded('yardnote' + p.id)() >= BOND.YARD_NOTE) return null;
    const mates = ids.filter(id => id !== p.id).map(id => this.globalPlayers.find(x => x.id === id)).filter(q => q && sameYard(p, q)).sort((a, b) => a.id.localeCompare(b.id));
    return mates[0] || null;
  },

  /* ---------- the talk (§6) ---------- */
  /** Hidden openness 0.1–0.9 (morale, composure, discipline, Squad reputation; anxious −0.1; gossip −0.1 for 14 days). */
  openness(p, date = this.calendar.date) {
    if (this.talkForceO != null) return this.talkForceO;
    let o = 0.35 + p.dyn.morale / 250 + (p.psych.composure - 10) / 40 + (p.psych.discipline - 10) / 40 + ((this.rep?.squad ?? 50) - 50) / 400;
    if (p.leadership <= 7) o -= 0.1;
    if (p.talk?.closedUntil && date < p.talk.closedUntil) o += TALK.GOSSIP_OPEN;
    return clamp(o, 0.1, 0.9);
  },
  /** Why the [ Have a word ] button is greyed (i18n key) — or null. */
  talkBlock(id) {
    const p = this.player(id);
    if (!p) return 'office.kickNo.gone';
    if ((this.weekState?.().ap ?? this.ap ?? 0) < TALK.AP) return 'talk.noAp';
    if (p.talk?.last && isoDays(p.talk.last, this.calendar.date) < TALK.WEEK_CD) return 'btalk.cooldown';
    return null;
  },
  /** One answer. Returns { kind: 'honest' | 'evade' | 'lie' | 'repeat' | 'none', band, root, cause, about, x, y, line }. */
  talkAnswer(kid, qid, xId = null, yId = null, date = this.calendar.date) {
    const q = TALK_QUESTIONS.find(t => t.id === qid); if (!q || !kid) return null;
    const t = (kid.talk ||= {}), ak = qid + '#' + (xId || '') + '#' + (yId || '');
    t.asked ||= {};
    if (t.asked[ak] && isoDays(t.asked[ak], date) < TALK.REPEAT_DAYS) return { kind: 'repeat', qid };
    t.asked[ak] = date;
    const r = seeded(date + '#talk#' + kid.id + '#' + qid + '#' + (xId || '') + (yId ? '#' + yId : ''));
    const O = this.openness(kid, date), by = { pid: kid.id, name: kid.name };
    let about = xId, v;
    if (qid === 'mates' || qid === 'hard') {
      const list = this.bondsOf(kid.id).sort((a, b) => (qid === 'mates' ? b.v - a.v : a.v - b.v) || a.id.localeCompare(b.id));
      const top = list[0];
      if (!top || (qid === 'mates' ? top.v < 20 : top.v > -20)) { if (r() < O) return { kind: 'none', qid }; return this.talkEvade(kid, qid, null, date); }
      about = top.id;
    }
    if (qid === 'pair') return this.talkRumour(kid, xId, yId, r, date, by);
    if (qid === 'who') return this.talkWho(kid, r, date, by);   // v3.27
    if (qid === 'mediate') return this.talkMediate(kid, xId, yId, date);   // v3.27
    v = this.bondV(kid.id, about);
    const e = this.bond(kid.id, about), vv = this.bondViewV(kid.id, about);   // v3.27: the answer is the pair as HE sees it (skew)
    if (qid === 'pitch') return this.talkPitch(kid, this.player(about), v, r, date, by);
    let evade = 1 - O;
    if (q.evade) evade *= q.evade;
    if (vv <= -20) evade *= TALK.EVADE_COLD; else if (vv >= 20) evade *= TALK.EVADE_MATE;
    const res = { qid, about };
    if (r() < clamp(evade, 0, 1)) Object.assign(res, this.talkEvade(kid, qid, about, date));
    else if (vv <= -20 && kid.psych.discipline <= TALK.LIE_DISC && r() < (this.talkForceLie ?? TALK.LIE)) {
      Object.assign(res, { kind: 'lie', band: 'neutral' });
      this.addBondNote(kid, { with: about, band: 'neutral', source: 'talk', date, by });
    } else {
      const band = bondBand(vv), root = e?.root ? (areTwins(kid, this.player(about)) ? 'twins' : sameYard(kid, this.player(about)) ? 'yard' : 'school') : null;
      const cause = vv <= -20 || (qid === 'what' && v <= -20) ? e?.cause || null : null;   // "What happened?" always names the cause he sees
      Object.assign(res, { kind: 'honest', band, root, cause, assist: vv >= 20 && !root, surprised: qid === 'what' && vv > -20 });
      this.addBondNote(kid, { with: about, band, source: 'talk', date, by, ...(cause ? { cause } : {}), ...(root ? { root } : {}) });
    }
    if (res.kind !== 'evade' && vv >= 20) kid.dyn.morale = clamp(kid.dyn.morale + TALK.MATE_MORALE, 0, 100);   // asked about a mate
    if (v <= -60 && bondTemper(kid) >= 1 && r() < TALK.STIR) { this.addBond(kid.id, about, TALK.STIR_DV, null, date); res.stirred = true; }   // «растравил»
    if (v <= -20) this.talkGossip(kid, about, r, date);
    return res;
  },
  talkEvade(kid, qid, about, date) {
    if (about) this.addBondNote(kid, { with: about, band: 'evade', source: 'talk', date, by: { pid: kid.id, name: kid.name } });
    return { kind: 'evade', qid, about };
  },
  /** Gossip: TALK.GOSSIP that X hears "the coach was asking about you" — X morale −2, openness −0.1 for 14 days. */
  talkGossip(kid, xId, r, date) {
    const x = this.player(xId);
    if (!x || r() >= (this.talkForceGossip ?? TALK.GOSSIP)) return false;
    x.dyn.morale = clamp(x.dyn.morale + TALK.GOSSIP_MORALE, 0, 100);
    (x.talk ||= {}).closedUntil = isoAdd(date, TALK.GOSSIP_DAYS);
    this.addDiary({ date, key: 'btalk.gossip', vars: { k: { pid: x.id } }, cls: 'ev' });
    return true;
  },
  /** v3.27 "Who started it?" — to a witness of the last fight: the instigator; a witness who is a mate (v ≥ WITNESS_LIE_V) of the
      instigator names the other kid with TALK.LIE (talkForceLie). Evasive with 1 − openness. */
  talkWho(kid, r, date, by) {
    const f = this.lastFight(date);
    if (!f) return { kind: 'none', qid: 'who' };
    if (r() >= this.openness(kid, date)) return { kind: 'evade', qid: 'who', about: f.inst };
    const other = f.inst === f.a ? f.b : f.a;
    const lies = this.bondV(kid.id, f.inst) >= CLASH.WITNESS_LIE_V && this.bondV(kid.id, f.inst) > this.bondV(kid.id, other) && r() < (this.talkForceLie ?? TALK.LIE);
    const named = lies ? other : f.inst, victim = named === f.a ? f.b : f.a;
    f.told = { by: kid.id, inst: named };
    this.addBondNote(this.player(named), { with: victim, band: bondBand(this.bondV(named, victim)), source: 'who', date, by });
    return { kind: lies ? 'lie' : 'honest', qid: 'who', about: named, y: victim };
  },
  /** v3.27 "Will you help me make X and Y friends again?" — the mediator attempt (GameState.mediate). */
  talkMediate(kid, xId, yId, date) {
    const res = this.mediate(kid, xId, yId, date, 'talk');
    return res ? { kind: res.ok ? 'honest' : 'fail', qid: 'mediate', about: xId, y: yId, ok: res.ok, side: res.side || null } : null;
  },
  /** v3.27: is the question on offer for this kid now (only when its condition holds)? */
  talkQAvail(kid, q, date = this.calendar?.date) {
    if (q.x === 'conflict') return this.knownConflicts(kid.id).length > 0;
    if (q.x === 'fight') { const f = this.lastFight(date); return !!f && f.a !== kid.id && f.b !== kid.id && f.present.includes(kid.id); }
    if (q.x === 'mediate') return this.talkMedPairs(kid).length > 0;
    return true;
  },
  /** Pairs [a, b] the coach knows are in conflict, where he knows `kid` is mates+ with both. */
  talkMedPairs(kid) {
    const out = [];
    for (let i = 0; i < this.squad.length; i++) for (let j = i + 1; j < this.squad.length; j++) {
      const a = this.squad[i].id, b = this.squad[j].id;
      if (a === kid.id || b === kid.id || !this.knowsConflict(a, b)) continue;
      if (this.knownBond(kid.id, a)?.cls === 'good' && this.knownBond(kid.id, b)?.cls === 'good') out.push([a, b]);
    }
    return out;
  },
  /** "And X and Y?" — a rumour, wrong with 2 × CLUES.WRONG; always gossip-prone. */
  talkRumour(kid, xId, yId, r, date, by) {
    const x = this.player(xId), y = this.player(yId);
    if (!x || !y) return null;
    if (r() >= this.openness(kid, date)) { this.talkGossip(kid, xId, r, date); return { kind: 'evade', qid: 'pair', about: xId, y: yId }; }
    let band = bondBand(this.bondV(xId, yId));
    if (r() < 2 * CLUES.WRONG) band = BOND.BANDS.map(b => b.key).filter(k => k !== band)[Math.floor(r() * (BOND.BANDS.length - 1))];
    this.addBondNote(x, { with: yId, band, source: 'rumour', date, by });
    this.talkGossip(kid, xId, r, date);
    return { kind: 'honest', qid: 'pair', about: xId, y: yId, band };
  },
  /** "What do you think of X on the pitch?" — a v3.18 role clue, reliability − 0.003 × |v|, friends praise, rivals run down. */
  talkPitch(kid, x, v, r, date, by) {
    if (!x) return null;
    const rel = clamp((AFTER.FORCE_REL ?? kidReliability(kid)) - TALK.ROLE_REL * Math.abs(v), 0.05, 0.95), ok = r() < rel;
    const truth = trueSignals(x), others = Object.keys(CLUE_SIGNALS).filter(k => !truth.includes(k));
    const down = v <= -20, signal = (ok || !others.length ? truth : others)[Math.floor(r() * (ok || !others.length ? truth.length : others.length))] || null;
    if (down) { this.addClue(x, { date, source: 'talk', ref: 'talk', signal: null, textKey: 'clue.voice.down', kind: 'down', claim: null, by }); }
    else this.addClue(x, { date, source: 'talk', ref: 'talk', signal, textKey: 'clue.voice.role', kind: 'role', claim: null, by });
    if (down) this.talkGossip(kid, x.id, r, date);
    return { kind: 'honest', qid: 'pitch', about: x.id, signal: down ? null : signal, down, tone: v >= 20 ? 'praise' : down ? 'down' : 'plain' };
  },
};
/** 'good' (mates / best mates), 'bad' (don't get on / at war), 'neutral' or the note's own kind (alone / evade / yard). */
const bondClass = band => (band === 'best' || band === 'mates' ? 'good' : band === 'cold' || band === 'war' ? 'bad' : band);
Object.assign(GameState.prototype, BondsMixin);
const BOND_ICONS = { best: '\u{1F91D}', mates: '\u{1F642}', cold: '\u{1F620}', war: '⚡', neutral: '·', alone: '…', evade: '\u{1F910}', yard: '\u{1F3E0}' };
const BOND_SRC = { came: '\u{1F6AA}', obs: '\u{1F3C3}', after: '\u{1F5E3}', loner: '…', yard: '\u{1F3E0}', talk: '\u{1F4AC}', rumour: '\u{1F442}', event: '\u{1F4A2}', who: '\u{1F50E}' };   // v3.27: + event, who
/** One bond note as the coach wrote it ("From Petya: Kolya took his place"). n.owner = the kid whose list holds it. */
function bondNoteText(s, n) {
  const a = s.player(n.owner), b = n.with && s.player(n.with), an = a ? L.name(a.name) : '', bn = b ? L.name(b.name) : '';
  const say = () => L.t(n.band === 'cold' && n.cause ? 'bn.say.cold.' + n.cause : (n.band === 'best' || n.band === 'mates') && n.root ? 'bn.say.mates.' + n.root : 'bn.say.' + n.band, { a: an, b: bn });
  let t;
  if (n.source === 'came') t = L.t('bn.note.came', { a: an, b: bn });
  else if (n.source === 'obs') t = L.t('bn.note.obs.' + bondClass(n.band), { a: an, b: bn });
  else if (n.source === 'loner') t = L.t('bn.note.alone', { a: an });
  else if (n.source === 'yard') t = L.t('bn.note.yard', { a: an, b: bn, y: L.t('yard.street.' + kidRoots(a).yard) });
  else if (n.band === 'evade') t = L.t('bn.note.evade', { a: an, b: bn });
  else if (n.source === 'rumour') t = L.t('bn.note.rumour', { k: n.by?.name ? L.name(n.by.name) : '', a: an, b: bn, w: L.t('bn.band.' + n.band) });
  else if (n.source === 'event') t = L.t('bn.note.event.' + (n.ev || 'clash'), { a: an, b: bn, d: n.date ? fmtDate(n.date, { day: 'numeric', month: 'short' }) : '' });   // v3.27
  else if (n.source === 'who') t = L.t('bn.note.who', { k: n.by?.name ? L.name(n.by.name) : '', a: an, b: bn });   // v3.27
  else t = (n.by?.name ? L.t('bn.by', { k: L.name(n.by.name) }) + ': ' : '') + say();
  return n.mix ? L.t('twins.mix', { k: an }) + ' ' + t : t;
}
