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

/** Coach's Note: looks at the strongest and weakest signal of THIS match and returns i18n keys.
    It hints at a role without naming it (duels → Aggressive, passing → Playmaker, dribbling/goals → Selfish). */
function coachNote(p, s, flags = {}) {
  const out = [];
  if (flags.tired) out.push('note.tired');
  if (flags.gk) {   // v3.0: he was in goal in THAT match (no native positions)
    out.push(s.saves >= 3 ? 'note.gkBusy' : s.saves ? 'note.gkOk' : 'note.gkQuiet');
  } else {
    const rate = (ok, fail, min) => (ok + fail >= min ? { r: ok / (ok + fail), n: ok + fail } : null);
    const pass = rate(s.passOk, s.passFail, 6), duel = rate(s.tackles, s.tacklesLost, 4), drib = rate(s.dribbleOk, s.dribbleFail, 4);
    const cands = [];
    if (duel) cands.push({ key: duel.r >= 0.7 ? 'note.duelHigh' : duel.r < 0.4 ? 'note.duelLow' : null, w: Math.abs(duel.r - 0.55) * duel.n, good: duel.r >= 0.7 });
    if (pass) cands.push({ key: pass.r >= 0.8 ? 'note.passHigh' : pass.r < 0.45 ? 'note.passLow' : null, w: Math.abs(pass.r - 0.62) * pass.n * 0.8, good: pass.r >= 0.8 });
    if (drib) cands.push({ key: drib.r >= 0.65 ? 'note.dribHigh' : drib.r < 0.35 ? 'note.dribLow' : null, w: Math.abs(drib.r - 0.5) * drib.n, good: drib.r >= 0.65 });
    if (s.goals > 0) cands.push({ key: 'note.scorer', w: 2 + s.goals * 2, good: true });
    const hits = cands.filter(c => c.key).sort((a, b) => b.w - a.w);
    const best = hits.find(c => c.good), worst = hits.find(c => !c.good);
    if (best) out.push(best.key);
    if (worst) out.push(worst.key);
    if (!best && !worst) {
      const touches = s.passOk + s.passFail + s.dribbleOk + s.dribbleFail + s.tackles + s.tacklesLost;
      out.push(touches < 8 ? 'note.quiet' : 'note.steady');
    }
  }
  if (flags.oop) out.push('note.oop');
  if (flags.psy) out.push(flags.psy);   // v3.7 a subtle captain-trait clue (vocal leader / nerves)
  if (flags.role) out.push('note.role');
  return out;
}


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
