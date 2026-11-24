/* =========================================================
   v3.27 "CLASHES" — the six conflict dialogues (+ the mum's call). when: 'bond' = rolled by GameState.bondEventRoll /
   clashRoll / blameRoll (own cooldowns, CLASH.*), never by the random day pool and never counted by the 6-day event cooldown.
   Rules for all: the v3.17 typewriter; the FIRST button is the neutral, weak, free one (the `first` script can't solve a
   conflict blindly); [1 AP] options use `ap: 1`; every event writes an exact bond note (source 'event'); a cause the coach
   knows marks its matching option with a quiet hint (S + CAUSE_S, or v + CAUSE_DV for an option without a roll). No numbers.
   Rolls happen in `next` (saved as the step: a reload can't re-roll them); effects run on the result step's button.
   ========================================================= */
const clashMor = (p, d) => { if (p && d) p.dyn.morale = clamp(p.dyn.morale + d, 0, 100); };
const clashDisc = (p, d) => { if (p && d) p.psych.discipline = clamp(p.psych.discipline + d, 1, 20); };
/** The exact note every event leaves (the pair's band after the effects). */
function clashNote(s, a, b, ev, date) { s.addBondNote(a, { with: b.id, band: bondBand(s.bondV(a.id, b.id)), source: 'event', date, ev }); }
/** Shared parts of a conflict dialogue: names, the role line, the cause option, the mediator, the witness. */
function clashCtx(ctx, id) {
  const s = ctx.state, pe = s.pendingEvent, A = ctx.cast.kid, B = ctx.cast.b, date = ctx.date;
  const an = L.name(A.name), bn = L.name(B.name), vars = { a: { pid: A.id }, b: { pid: B.id } };
  const co = s.causeOption(id, A.id, B.id), meds = s.mediatorsFor(A.id, B.id), med = meds.length ? s.player(meds[0]) : null;
  const bonus = k => (co === k ? CLASH.CAUSE_S : 0), dvB = k => (co === k ? CLASH.CAUSE_DV : 0);
  const role = L.t('clash.role.' + id, { n: A.number, p: L.pos(A.position) });
  return { s, pe, A, B, date, an, bn, vars, co, med, bonus, dvB, role, face: A.portraitSvg,
    show: (text, choices, who = A) => ctx.show({ face: who.portraitSvg, name: L.name(who.name), role, text, choices }),
    /** A result step: one button that applies `run` and writes the diary of `as`. */
    result: (stepKey, run, as, who = A) => ctx.show({ face: who.portraitSvg, name: L.name(who.name), role, text: L.t('ev.' + id + '.' + stepKey, { a: an, b: bn, c: med ? L.name(med.name) : '' }),
      choices: [{ key: 'ev.' + id + '.ok', tone: 'gray', as: 'ev.' + id + '.' + stepKey, who: A.id, run: () => { run(); clashNote(s, A, B, id, date); return vars; } }] }) };
}
/** The mediator option ([1 AP], only when the coach knows [C] is mates+ with both). → step 'medOk' / 'medFail'. */
function clashMedOpt(c, id) {
  if (!c.med) return null;
  return { key: 'ev.' + id + '.f', vars: { c: squadName(c.med, c.s.squad) }, tone: 'green', ap: 1, who: c.A.id,
    next: () => { const r = c.s.mediate(c.med.id, c.A.id, c.B.id, c.date, 'ev#' + id); c.pe.medRes = r; return r?.ok ? 'medOk' : 'medFail'; } };
}
/** "Ask the others what happened" — one free question to a seeded witness (clash: what happened; fight: who started it). */
function clashWitnessOpt(c, id) {
  if (c.pe.witDone) return null;
  const here = c.s.trainedOn(c.date).length ? c.s.trainedOn(c.date) : c.s.squad.filter(p => p.available);   // (a match day: whoever is fit)
  const pool = (id === 'fight' ? c.s.fightFacts(c.A.id, c.B.id, c.date).present : here.map(p => p.id)).filter(x => x !== c.A.id && x !== c.B.id && c.s.player(x)).sort();
  if (!pool.length) return null;
  return { key: 'ev.clashAsk', tone: 'gray', next: () => { c.pe.wit = pool[Math.floor(seeded(c.date + '#witness#' + bondKey(c.A.id, c.B.id))() * pool.length)]; c.pe.witDone = true; return 'witness'; } };
}
/** The witness's answer (rolled once; the answer is saved on the pending event). */
function clashWitnessStep(ctx, c, id) {
  const s = c.s, w = s.player(c.pe.wit);
  if (!w) { ctx.show({ face: c.face, name: c.an, role: c.role, text: L.t('bt.a.evade.0'), choices: [{ key: 'btalk.back', tone: 'gray', next: 'start' }] }); return; }
  if (!c.pe.witAns) c.pe.witAns = id === 'fight' ? s.talkAnswer(w, 'who', null, null, c.date) : s.witnessWhat(w, c.A.id, c.B.id, c.date);
  const a = c.pe.witAns, text = id === 'fight' ? bondTalkText(s, w, a) : a.kind === 'honest' && a.cause ? L.t('ev.clashWit.cause.' + a.cause, { a: c.an, b: c.bn }) : a.kind === 'honest' ? L.t('ev.clashWit.none', { a: c.an, b: c.bn }) : L.t('bt.a.evade.1');
  ctx.show({ face: w.portraitSvg, name: L.name(w.name), role: L.t('clash.roleWit', { n: w.number, p: L.pos(w.position) }), text,
    choices: [{ key: 'btalk.back', tone: 'gray', next: () => { delete c.pe.witAns; return 'start'; } }] });
}

NARRATIVE_EVENTS.push(
  /* ---------- 1. CLASH AT TRAINING ---------- */
  {
    id: 'clash', when: 'bond', trigger: () => false,
    cast: s => s.debugClashCast('clash'),
    execute(ctx) {
      const c = clashCtx(ctx, 'clash'), { s, A, B, date, an, bn } = c, E = CLASH.E.clash;
      const done = (open, fx) => () => { fx(); s.clashOpen(A.id, B.id, open, date); clashNote(s, A, B, 'clash', date); return c.vars; };
      switch (ctx.step) {
        case 'witness': clashWitnessStep(ctx, c, 'clash'); return;
        case 'bOk': c.result('bOk', () => { s.addBond(A.id, B.id, E.bOk, null, date); clashMor(A, E.bOkM); clashMor(B, E.bOkM); s.clashOpen(A.id, B.id, false, date); }); return;
        case 'bFail': c.result('bFail', () => { s.addBond(A.id, B.id, E.bFail, 'temper', date); s.clashOpen(A.id, B.id, true, date); }); return;
        case 'dOk': c.result('dOk', () => { s.addBond(A.id, B.id, E.dOk, null, date); s.clashOpen(A.id, B.id, false, date); }); return;
        case 'dFail': {   // it gets worse — straight into a fight (unless one happened in the last FIGHT_CD days)
          const m = s.clashMeta(), canFight = !(m.fight && isoDays(m.fight, date) < CLASH.FIGHT_CD);
          ctx.show({ face: c.face, name: an, role: c.role, text: L.t(canFight ? 'ev.clash.dFail' : 'ev.clash.dFailCalm', { a: an, b: bn }),
            choices: [{ key: canFight ? 'ev.clash.toFight' : 'ev.clash.ok', tone: 'gray', as: 'ev.clash.dFail', who: A.id,
              run: () => { s.addBond(A.id, B.id, E.dFail, 'temper', date); s.clashOpen(A.id, B.id, true, date); clashNote(s, A, B, 'clash', date); return c.vars; },
              ...(canFight ? { next: () => { const pe = s.pendingEvent; pe.id = 'fight'; delete pe.witDone; s.clashStart('fight', A.id, B.id, date); return 'start'; } } : {}) }] });
          return;
        }
        case 'medOk': c.result('medOk', () => {}); return;
        case 'medFail': c.result('medFail', () => { s.clashOpen(A.id, B.id, true, date); }); return;
      }
      const hidden = s.skewHurt(A.id, B.id) === A.id;   // a hidden grudge: [B] has no idea why
      const ch = [
        { key: 'ev.clash.a', tone: 'gray', who: A.id, run: done(true, () => s.addBond(A.id, B.id, E.a, null, date)) },
        { key: 'ev.clash.b', tone: 'green', ap: 1, who: A.id, hint: c.co === 'b', next: () => (s.clashSucceeds(A, B, 'clash#b', c.bonus('b'), date) ? 'bOk' : 'bFail') },
        { key: 'ev.clash.c', tone: 'red', who: A.id, hint: c.co === 'c', run: done(false, () => { clashDisc(A, 1); clashDisc(B, 1); clashMor(A, E.cM); clashMor(B, E.cM); s.addBond(A.id, B.id, E.c + c.dvB('c'), null, date); s.addRep('squad', E.cSq); }) },
        { key: 'ev.clash.d', tone: 'green', ap: 1, who: A.id,
          next: () => { const T = (bondTemper(A) + bondTemper(B)) / 2, p = s.clashForceS ?? clamp(E.d - E.dT * T, 0.1, 0.9); return seeded(date + '#clashpair#' + bondKey(A.id, B.id))() < p ? 'dOk' : 'dFail'; } },
        { key: 'ev.clash.e', vars: { b: squadName(B, s.squad) }, tone: 'red', who: B.id,
          run: done(true, () => { clashMor(B, E.eMB); clashMor(A, E.eMA); s.addBond(A.id, B.id, E.e, 'unfair', date); s.addRep('squad', E.eSq); s.addSkew(A.id, B.id, BOND.SKEW_SIDED, date); s.clashMeta().sPen[A.id] = 1; }) },
        clashMedOpt(c, 'clash'),
        c.co === 'g' || s.knownCause(A.id, B.id) === 'unfair' ? { key: 'ev.clashWrong', tone: 'green', ap: 1, who: A.id, hint: true,
          run: done(false, () => { const h = s.player(s.skewHurt(A.id, B.id)) || A; clashMor(h, E.wrongM); s.skewReset(A.id, B.id); s.addRep('squad', E.wrongSq); s.addBond(A.id, B.id, CLASH.CAUSE_DV, null, date); }) } : null,
        clashWitnessOpt(c, 'clash'),
      ].filter(Boolean);
      c.show(L.t('ev.clash.text', { a: an, b: bn }) + (hidden ? ' ' + L.t('ev.clash.surprised', { a: an, b: bn }) : ''), ch);
    },
  },

  /* ---------- 2. "IT'S YOUR FAULT" — after a loss, in the locker after the Coach's Word ---------- */
  {
    id: 'blame', when: 'bond', trigger: () => false,
    cast: s => s.debugClashCast('blame'),
    execute(ctx) {
      const c = clashCtx(ctx, 'blame'), { s, A, B, date, an, bn } = c, E = CLASH.E.blame;
      const done = fx => () => { fx(); clashNote(s, A, B, 'blame', date); return c.vars; };
      switch (ctx.step) {
        case 'eOk': c.result('eOk', () => { s.addBond(A.id, B.id, E.eOk, null, date); clashMor(B, E.eOkM);
          s.addClue(B, { date, source: 'talk', ref: 'clash', signal: null, textKey: 'clue.voice.lead.own', kind: 'leadership', claim: 'high', by: null }); }, undefined, B); return;
        case 'eFail': c.result('eFail', () => { clashMor(B, E.eFailM); s.addBond(A.id, B.id, E.eFail, 'blame', date); }, undefined, B); return;
        case 'medOk': c.result('medOk', () => {}); return;
        case 'medFail': c.result('medFail', () => {}); return;
      }
      c.show(L.t('ev.blame.text', { a: an, b: bn }), [
        { key: 'ev.blame.a', tone: 'gray', who: A.id, run: done(() => { s.addBond(A.id, B.id, E.a, 'blame', date); clashMor(B, E.aMB); clashMor(A, E.aMA); }) },
        { key: 'ev.blame.b', vars: { a: squadName(A, s.squad) }, tone: 'green', ap: 1, who: A.id, hint: c.co === 'b',
          run: done(() => { s.addBond(A.id, B.id, E.b + c.dvB('b'), null, date); clashMor(A, E.bMA); clashMor(B, E.bMB); s.addRep('squad', E.bSq); }) },
        { key: 'ev.blame.c', tone: 'gray', who: A.id, run: done(() => { s.addBond(A.id, B.id, E.c, 'blame', date); clashMor(B, E.cMB); }) },
        { key: 'ev.blame.d', tone: 'red', who: B.id, run: done(() => { clashMor(B, E.dMB); clashMor(A, E.dMA); s.addBond(A.id, B.id, E.d, 'blame', date); s.addRep('squad', E.dSq); s.addSkew(B.id, A.id, BOND.SKEW_SIDED, date); }) },
        { key: 'ev.blame.e', vars: { b: squadName(B, s.squad) }, tone: 'green', ap: 1, who: B.id, next: () => ((B.leadership ?? 10) >= CLASH.BLAME_LEAD || s.clashForceS === 1) && s.clashForceS !== 0 ? 'eOk' : 'eFail' },
        clashMedOpt(c, 'blame'),
      ].filter(Boolean));
    },
  },

  /* ---------- 3. FIGHT — behind the locker room after training (or a clash that went wrong) ---------- */
  {
    id: 'fight', when: 'bond', trigger: () => false,
    cast: s => s.debugClashCast('fight'),
    execute(ctx) {
      const c = clashCtx(ctx, 'fight'), { s, A, B, date, an, bn } = c, E = CLASH.E.fight, f = s.fightFacts(A.id, B.id, date);
      const after = opt => {   // the mum's call: a face mark → 50 % the next day (not after calling the parents); else after A / B in 2–4 days
        if (s.clashMeta().mumFor === f.key + f.date) return;
        const mark = f.mark >= 1 && (s.clashForceMum ?? f.mumRoll) < CLASH.MUM_P;
        if (opt !== 'e' && mark) { f.mum = 'mark'; ctx.schedule('fightmum', { days: 1, cast: { kid: B.id, b: A.id } }); }
        else if (opt === 'a' || opt === 'b') { f.mum = 'ask'; ctx.schedule('fightmum', { days: CLASH.MUM_DAYS[0] + Math.floor(seeded(date + '#mumdays#' + f.key)() * (CLASH.MUM_DAYS[1] - CLASH.MUM_DAYS[0] + 1)), cast: { kid: B.id, b: A.id } }); }
        s.clashMeta().mumFor = f.key + f.date;
      };
      const done = (opt, fx) => () => { fx(); after(opt); s.clashOpen(A.id, B.id, opt === 'a', date); clashNote(s, A, B, 'fight', date); return c.vars; };
      const guess = (who, opt) => done(opt, () => {
        const inn = who === A ? B : A, right = f.inst === who.id;
        who.suspensionMatches = Math.max(who.suspensionMatches || 0, 1);
        if (right) { s.addBond(A.id, B.id, E.ok + c.dvB(opt), null, date); s.addRep('squad', E.okSq); clashDisc(who, 1); }
        else { s.addBond(A.id, B.id, E.bad, 'unfair', date); clashMor(inn, E.badM); s.addRep('squad', E.badSq); s.addRep('parents', E.badPar); s.addSkew(who.id, inn.id, BOND.SKEW_SIDED, date); }
      });
      if (ctx.step === 'witness') { clashWitnessStep(ctx, c, 'fight'); return; }
      const trace = L.t('ev.fight.mark.' + f.mark, { a: an, b: bn });
      c.show(L.t('ev.fight.text', { a: an, b: bn, t: trace }), [
        { key: 'ev.fight.a', tone: 'gray', who: A.id, run: done('a', () => { s.addBond(A.id, B.id, E.a, null, date); s.addRep('squad', E.aSq); if (seeded(date + '#fightboard#' + f.key)() < CLASH.BOARD_P) s.addRep('board', E.aBrd); }) },
        { key: 'ev.fight.b', tone: 'red', who: A.id, hint: c.co === 'b',
          run: done('b', () => { for (const p of [A, B]) { p.suspensionMatches = Math.max(p.suspensionMatches || 0, 1); clashDisc(p, 1); } s.addRep('parents', E.bPar); s.addBond(A.id, B.id, E.b + c.dvB('b'), null, date); }) },
        { key: 'ev.fight.c', vars: { a: squadName(A, s.squad) }, tone: 'red', who: A.id, run: guess(A, 'c') },
        { key: 'ev.fight.d', vars: { b: squadName(B, s.squad) }, tone: 'red', who: B.id, run: guess(B, 'd') },
        { key: 'ev.fight.e', tone: 'green', ap: 1, who: A.id,
          run: done('e', () => { s.addRep('parents', E.ePar); s.addBond(A.id, B.id, E.e, null, date); clashMor(A, E.eM); clashMor(B, E.eM);
            const inst = s.player(f.inst), oth = inst === A ? B : A; s.addBondNote(inst, { with: oth.id, band: bondBand(s.bondV(A.id, B.id)), source: 'event', date, ev: 'inst' }); f.told = { by: 'parents', inst: f.inst }; }) },
        c.co === 'g' ? { key: 'ev.clashWrong', tone: 'green', ap: 1, who: A.id, hint: true,
          run: done('g', () => { const h = s.player(s.skewHurt(A.id, B.id)) || A; clashMor(h, CLASH.E.clash.wrongM); s.skewReset(A.id, B.id); s.addRep('squad', CLASH.E.clash.wrongSq); }) } : null,
        clashWitnessOpt(c, 'fight'),
      ].filter(Boolean));
    },
  },

  /* ---------- 4. COACH'S FAVOURITE ---------- */
  {
    id: 'envy', when: 'bond', trigger: () => false,
    cast: s => { const f = [...s.squad].sort((a, b) => (b.praiseLog || []).length - (a.praiseLog || []).length)[0], a = s.squad.find(q => q !== f && !areTwins(q, f)); return f && a ? { kid: a.id, b: f.id } : null; },
    execute(ctx) {
      const c = clashCtx(ctx, 'envy'), { s, A, B, date, an, bn } = c, E = CLASH.E.envy;   // A = the envious kid, B = the favourite [F]
      const done = fx => () => { fx(); clashNote(s, A, B, 'envy', date); return c.vars; };
      if (ctx.step === 'bOk' || ctx.step === 'bFail') {
        c.result(ctx.step, () => {
          if (ctx.step === 'bFail') { clashMor(A, E.bFailM); return; }
          s.skewReset(A.id, B.id); const e = s.bond(A.id, B.id); if (e?.cause === 'envy') e.cause = null;
          clashMor(A, E.bOkM);
          const sig = trueSignals(A)[0] || null;   // what he wants: his place / more minutes
          if (sig) s.addClue(A, { date, source: 'talk', ref: 'talk', signal: sig, textKey: 'clue.voice.self', kind: 'role', claim: null, by: { pid: A.id, name: A.name } });
        });
        return;
      }
      c.show(L.t('ev.envy.text', { a: an, f: bn }), [
        { key: 'ev.envy.a', tone: 'gray', who: A.id, run: done(() => s.addBond(A.id, B.id, E.a, 'envy', date)) },
        { key: 'ev.envy.b', vars: { a: squadName(A, s.squad) }, tone: 'green', ap: 1, who: A.id, hint: c.co === 'b', next: () => (s.clashSucceeds(A, B, 'envy#b', c.bonus('b'), date) ? 'bOk' : 'bFail') },
        { key: 'ev.envy.c', vars: { a: squadName(A, s.squad) }, tone: 'green', who: A.id, hint: c.co === 'c',
          run: done(() => { clashMor(A, E.cM); B.praiseLog = []; if (A.dyn.sharpness < E.cSharp) s.addRep('squad', E.cSq); if (c.dvB('c')) s.addBond(A.id, B.id, c.dvB('c'), null, date); }) },
        { key: 'ev.envy.d', tone: 'red', who: B.id, run: done(() => { clashMor(B, E.dMF); clashMor(A, E.dMA); s.addBond(A.id, B.id, E.d, 'envy', date); s.addRep('squad', E.dSq); s.addSkew(A.id, B.id, BOND.SKEW_SIDED, date); }) },
      ]);
    },
  },

  /* ---------- 5. "CAN I PLAY WITH HIM?" (positive) ---------- */
  {
    id: 'pairreq', when: 'bond', trigger: () => false,
    cast: s => s.debugClashCast('pairreq'),
    execute(ctx) {
      const c = clashCtx(ctx, 'pairreq'), { s, A, B, date, an, bn } = c, E = CLASH.E.pairreq;
      const note = () => clashNote(s, A, B, 'pairreq', date);
      c.show(L.t('ev.pairreq.text', { a: an, b: bn }), [
        { key: 'ev.pairreq.a', tone: 'gray', who: A.id, run: () => { note(); return c.vars; } },
        { key: 'ev.pairreq.b', tone: 'green', who: A.id,
          run: () => { s.oblAdd('pair', A.id, B.id, CLASH.OBL_PAIR, date); if (s.bondViewV(B.id, A.id) < 20) clashMor(B, E.oneSidedM); note(); return c.vars; } },   // one-sided: [B] doesn't think so
        { key: 'ev.pairreq.c', tone: 'red', who: A.id, run: () => { clashMor(A, E.cM); note(); return c.vars; } },
      ]);
    },
  },

  /* ---------- 6. BROTHERS FELL OUT ---------- */
  {
    id: 'twinfight', when: 'bond', trigger: () => false,
    cast: s => s.debugClashCast('twinfight'),
    execute(ctx) {
      const c = clashCtx(ctx, 'twinfight'), { s, A, B, date, an, bn } = c, E = CLASH.E.twinfight;   // A = the favoured brother, B = the hurt one
      const done = fx => () => { fx(); clashNote(s, A, B, 'twinfight', date); return c.vars; };
      if (ctx.step === 'bOk' || ctx.step === 'bFail') {
        c.result(ctx.step, () => {
          if (ctx.step === 'bFail') { s.addBond(A.id, B.id, E.bFail, null, date); return; }
          s.addBond(A.id, B.id, E.bOk, null, date);
          const sig = trueSignals(B)[0] || null;
          if (sig) s.addClue(B, { date, source: 'talk', ref: 'talk', signal: sig, textKey: 'clue.voice.self', kind: 'role', claim: null, by: { pid: B.id, name: B.name } });
        }, undefined, B);
        return;
      }
      c.show(L.t('ev.twinfight.text', { a: an, b: bn }), [
        { key: 'ev.twinfight.a', tone: 'gray', who: A.id,
          run: done(() => { s.addBond(A.id, B.id, E.a, null, date); if (seeded(date + '#twinmum#' + A.id)() < CLASH.TWIN_MUM) { s.addRep('parents', E.aPar); s.addDiary({ date, key: 'ev.twinfight.mum', vars: c.vars, cls: 'ev' }); } }) },
        { key: 'ev.twinfight.b', vars: { b: squadName(B, s.squad) }, tone: 'green', ap: 1, who: B.id, hint: c.co === 'b', next: () => (s.clashSucceeds(A, B, 'twin#b', E.bS + c.bonus('b'), date) ? 'bOk' : 'bFail') },
        { key: 'ev.twinfight.c', tone: 'green', who: B.id, hint: c.co === 'c', run: done(() => { s.oblAdd('start', A.id, B.id, 1, date); if (c.dvB('c')) s.addBond(A.id, B.id, c.dvB('c'), null, date); }) },
        { key: 'ev.twinfight.d', tone: 'gray', who: A.id, run: done(() => { s.addBond(A.id, B.id, E.d, null, date); s.bondEntry(A.id, B.id, date).apart = isoAdd(date, CLASH.TWIN_APART); }) },
        { key: 'ev.twinfight.e', vars: { a: squadName(A, s.squad) }, tone: 'red', who: A.id, run: done(() => { clashMor(B, E.eM); s.addSkew(B.id, A.id, CLASH.TWIN_SKEW, date); s.addRep('parents', E.ePar); }) },
      ], B);
    },
  },

  /* ---------- the mum's call after a fight (scheduled; short) ---------- */
  {
    id: 'fightmum', when: 'scheduled', trigger: () => false, cast: () => null,
    execute(ctx) {
      const s = ctx.state, son = ctx.cast.kid, other = ctx.cast.b, E = CLASH.E.mum;
      const f = [...(s.clashMeta().fights || [])].reverse().find(x => x.key === bondKey(son.id, other.id));
      const vars = { k: { pid: son.id }, b: { pid: other.id } }, mark = f?.mum === 'mark';
      ctx.show({ face: PortraitGenerator.silhouette('#4a3b5c'), name: L.t('ev.fightmum.name', { k: L.name(son.name) }), role: L.t('talk.rolePhone'),
        text: L.t(mark ? 'ev.fightmum.mark' : 'ev.fightmum.ask', { k: L.name(son.name), b: L.name(other.name), t: f ? L.t('ev.fight.markShort.' + f.mark) : '' }),
        choices: [
          { key: 'ev.fightmum.b', tone: 'gray', who: son.id, run: () => { s.addRep('parents', E.noPar); return vars; } },
          { key: 'ev.fightmum.a', tone: 'green', who: son.id, run: () => { s.addRep('parents', E.truthPar); clashMor(son, E.truthM); return vars; } },
          { key: 'ev.fightmum.c', tone: 'green', ap: 1, who: son.id, run: () => { s.addRep('parents', E.apPar); return vars; } },
        ] });
    },
  },
);
