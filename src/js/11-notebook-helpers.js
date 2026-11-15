/* =========================================================
   NOTEBOOK HELPERS (v1.0)
   ========================================================= */
/** Inline colour for a success rate: > 75% retro green, < 40% retro red (dark shades: the card is paper). */
function rateStyle(r) {
  if (r == null) return '';
  if (r > 75) return 'color:#1d7a1d;font-weight:bold';
  if (r < 40) return 'color:#b3261e;font-weight:bold';
  return '';
}

/** Coach's Note (v3.18): no verdict, no role names, no advice. Lines: tired / keeper line, then ONE clue (an episode,
    see rollClue — flags.clue = its text key), then out-of-position and the v3.7 psych hint. "Numbers already reflect his
    current role" is a stat line on the card, not part of the note. */
function coachNote(p, s, flags = {}) {
  const out = [];
  if (flags.tired) out.push('note.tired');
  if (flags.gk) out.push(s.saves >= 3 ? 'note.gkBusy' : s.saves ? 'note.gkOk' : 'note.gkQuiet');   // v3.0: he was in goal in THAT match
  if (flags.clue) out.push(flags.clue);
  if (flags.oop) out.push('note.oop');
  if (flags.psy) out.push(flags.psy);   // v3.7 a subtle captain-trait clue (vocal leader / nerves)
  return out;
}

/* =========================================================
   v3.18 CLUES — hints instead of answers (CLUE_SIGNALS / CLUES in 00-utils-data.js)
   The hidden truth is the same one the match engine uses: a role multiplies its composites ×1.5 (Aggressive: Tackle + Mark,
   Playmaker: Pass, Selfish: Dribble + Shoot) and brings its side effects (fouls / forced passes / never passing). The role
   that fits = the one whose composites are his strongest — exactly when the ×1.5 pays and the side effects hurt least.
   ========================================================= */
/** Composite from the RAW hidden skills (no sharpness dip): the long-term truth, not today's form. */
function rawComposite(p, key) {
  const w = COMPOSITE[key]; let sum = 0, n = 0;
  for (const k in w) { sum += (p.physical?.[k] ?? p.technical?.[k] ?? p.tactical?.[k] ?? p.psych?.[k] ?? 10) * w[k]; n += w[k]; }
  return sum / n;
}
/** signal → how well its role's composites suit him (1–20). */
function roleFit(p) {
  const o = {};
  for (const sig in CLUE_SIGNALS) { const a = CLUE_SIGNALS[sig].attrs; o[sig] = a.reduce((x, k) => x + rawComposite(p, k), 0) / a.length; }
  return o;
}
/** His "true" signals: the best one + any within CLUES.FIT_TIE of it (several fitting roles all count as true). */
function trueSignals(p) {
  const f = roleFit(p), best = Math.max(...Object.values(f));
  return Object.keys(f).filter(k => f[k] >= best - CLUES.FIT_TIE);
}
/** Did he do the thing the clue describes? `stats` = null (training) → no numbers on show, nothing to contradict. */
function clueEvidence(sig, stats) {
  if (!stats) return true;
  const c = CLUE_SIGNALS[sig];
  return c.stats.reduce((a, k) => a + (stats[k] || 0), 0) >= c.min;
}
/** One clue about one kid at one event. True with chance 1 − WRONG (seeded date#clue#id), otherwise a random OTHER signal —
    worded just as confidently. No evidence on today's card → a neutral line (signal null, never confirms anything).
    `used` = text keys already given at this event, so two kids never share a phrasing. */
function rollClue(p, { date, source, ref, stats = null, used = new Set() }) {
  const r = seeded(date + '#clue#' + p.id), truth = trueSignals(p);
  const others = Object.keys(CLUE_SIGNALS).filter(k => !truth.includes(k));
  let signal = r() < CLUES.WRONG && others.length ? others[Math.floor(r() * others.length)] : truth[Math.floor(r() * truth.length)];
  if (!clueEvidence(signal, stats)) signal = null;
  const base = signal ? 'clue.' + signal + '.' : 'clue.none.', n = signal ? CLUES.PHRASES : CLUES.NEUTRAL;
  const start = Math.floor(seeded(date + '#cluetxt#' + p.id)() * n);
  let i = 0;
  while (i < n - 1 && used.has(base + (start + i) % n)) i++;
  const textKey = base + (start + i) % n;
  used.add(textKey);
  return { date, source, ref, signal, textKey, seen: false };
}
/** One event = source + ref (+ date: round numbers repeat every season). */
const clueEvent = c => c.source + '|' + c.ref + '|' + c.date;
/** ✓ confirmed: another clue with the same signal from a DIFFERENT event. Contradictions stay visible, nothing is resolved. */
function clueConfirmed(list, c) { return !!c.signal && list.some(o => o !== c && o.signal === c.signal && clueEvent(o) !== clueEvent(c)); }
const unseenClues = p => (p?.clues || []).filter(c => !c.seen).length;


/* =========================================================
   v3.7 HIDDEN CAPTAIN TRAITS — qualitative clues only (i18n keys; seeded by matchday + id, never Math.random)
   ========================================================= */
/** The armband line for the Notebook from MatchEngine.captainReport(): rallied / organised (leader),
    overwhelmed / tears (anxious), did the job (normal). Returns { pid, key } or null. */
function captainObservation(rep, md) {
  if (!rep) return null;
  const v = Math.floor(seeded(md + '#capobs#' + rep.id)() * 2);
  let key;
  if (rep.trait === 'leader') key = rep.rallies ? 'cap.obs.rally.' : 'cap.obs.lead.';
  else if (rep.trait === 'anxious') key = rep.breakdown != null ? 'cap.obs.tears.' : rep.nerves || rep.mistakes ? 'cap.obs.nerves.' : 'cap.obs.tense.';
  else key = 'cap.obs.steady.';
  return { pid: rep.id, key: key + v };
}
/** A sampled kid (not wearing the armband) may show natural vocal leadership or visible nerves. */
function psychClue(p, md, captainId) {
  if (!p || p.id === captainId || p.captainTrait === 'normal' || !p.captainTrait) return null;
  const r = seeded(md + '#psy#' + p.id);
  if (r() >= CAPTAIN.CLUE) return null;
  return (p.captainTrait === 'leader' ? 'note.vocal.' : 'note.nervy.') + Math.floor(r() * 2);
}
