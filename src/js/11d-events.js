/* =========================================================
   v1.9 — NARRATIVE EVENT ENGINE + "LOCKER ROOM DIALOGUE" (This Is the Police style)
   EventEngine.roll(date) runs after every simulated NON-match day. If an event fires, the calendar
   pauses, the event is saved as `state.pendingEvent` (a reload re-opens it: the choice can't be dodged),
   and the simulation resumes by itself once the coach picks a choice.

   Event object:
     id       — unique key (also the i18n prefix `ev.<id>.*`)
     trigger  — (state, date) => boolean   probability + conditions
     cast     — (state) => { ...playerIds } | null   picks the actors (saved, so a reload shows the same people)
     execute  — (ctx) => void   builds the dialogue: ctx.show({ face, name, role, text, choices: [...] })
                choice = { key, tone: 'red'|'gray'|'green', cost?, gain?, run: () => diaryVars }
   ========================================================= */
const isoDays = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);

const NARRATIVE_EVENTS = [
  /* ---------- 1. TORN BOOTS — reported by a Snitch ---------- */
  {
    id: 'boots', when: 'day',
    trigger: (s) => Math.random() < EVENTS_CFG.BOOTS_CHANCE && s.squad.length > 2,
    cast(s) {
      const helped = new Set(s.eventLog.filter(e => e.id === 'boots' && e.season === s.season).map(e => e.who));
      const snitch = pick(s.squad);
      // the "talented kid" is drawn from the 6 highest potentials (hidden), never the snitch himself
      const pool = s.squad.filter(p => p !== snitch && !helped.has(p.id)).sort((a, b) => b.psych.potential - a.psych.potential || b.overall - a.overall).slice(0, 6);   // v3.11: 1–20 ties → overall
      if (!pool.length) return null;
      // v3.15: a poor family's kid is twice as likely (hidden wealth) — still ONE Math.random, like pick()
      const w = pool.map(p => p.wealth === 'poor' ? 2 : 1), tot = w.reduce((a, b) => a + b, 0);
      let x = Math.random() * tot, i = 0;
      while (i < pool.length - 1 && (x -= w[i]) >= 0) i++;
      return { snitch: snitch.id, kid: pool[i].id };
    },
    execute(ctx) {
      const { snitch, kid } = ctx.cast;
      if (ctx.step === 'seniors') {   // v3.24: the [1 AP] result line before the game moves on
        ctx.show({ face: kid.portraitSvg, name: L.name(kid.name), role: L.t('talk.roleKid', { n: kid.number, p: L.pos(kid.position) }),
          text: L.t('ev.boots.seniors', { k: L.name(kid.name) }),
          choices: [{ key: 'ev.boots.seniorsOk', as: 'ev.boots.c', tone: 'gray', who: kid.id,
            run: () => { kid.dyn.morale = clamp(kid.dyn.morale + AP_OPTION.BOOTS_MORALE, 0, 100); return { k: { pid: kid.id } }; } }] });
        return;
      }
      ctx.show({
        face: snitch.portraitSvg, name: L.name(snitch.name), role: L.t('talk.roleSnitch', { n: snitch.number, p: L.pos(snitch.position) }),
        text: L.t('ev.boots.text', { s: L.name(snitch.name), k: L.name(kid.name) }),
        choices: [
          { key: 'ev.boots.a', tone: 'red', cost: EVENTS_CFG.BOOTS_COST, who: kid.id,
            run: () => { kid.dyn.morale = 100; return { k: { pid: kid.id } }; } },
          { key: 'ev.boots.b', tone: 'gray', who: kid.id,
            run: () => { kid.physical.agility = Math.max(1, kid.physical.agility + EVENTS_CFG.BOOTS_AGILITY); return { k: { pid: kid.id } }; } },
          { key: 'ev.boots.c', tone: 'green', ap: 1, who: kid.id, next: 'seniors' },   // v3.16: [1 AP] — free and no agility lost, but only +5 morale
        ],
      });
    },
  },

  /* ---------- 2. RICH KID'S DAD — reported by a parent (silhouette) ---------- */
  {
    id: 'dad', when: 'day',
    trigger: (s) => Math.random() < EVENTS_CFG.DAD_CHANCE && !s.squad.some(p => p.hasFlag('Promised_Start')),
    cast(s) {
      // v3.15: the son of a rich family (hidden wealth), the weakest of them; fallback middle, then anyone
      const of = w => [...s.squad].filter(p => !w || p.wealth === w).sort((a, b) => a.overall - b.overall)[0];
      const worst = of('rich') || of('middle') || of(null);   // hidden overall → the weakest kid
      return worst ? { kid: worst.id } : null;
    },
    execute(ctx) {
      const { kid } = ctx.cast;
      ctx.show({
        face: PortraitGenerator.silhouette(), name: L.t('talk.parentName', { s: L.name(kid.surname) }), role: L.t('talk.roleParent'),
        text: L.t('ev.dad.text', { k: L.name(kid.name) }),
        // v3.22 MONEY OFFERS: the refusal is the FIRST button (dad / scout / pool) — a first-button player must not collect money
        // blindly; test/policy.js checks it (`first` refuses, gate: first's budget ≤ reference + $200)
        choices: [
          { key: 'ev.dad.b', tone: 'gray', who: kid.id,
            run: () => { kid.dyn.morale = clamp(kid.dyn.morale + EVENTS_CFG.DAD_REFUSE_MORALE, 0, 100); return { k: { pid: kid.id } }; } },
          { key: 'ev.dad.a', tone: 'green', gain: EVENTS_CFG.DAD_GIFT, who: kid.id,
            run: () => {
              if (!kid.hasFlag('Promised_Start')) kid.flags.push('Promised_Start');
              kid.promiseBy = 'dad'; kid.promiseChoice = null;
              const s = ctx.state;   // v3.22: the rumour spreads at once
              s.addRep('squad', EVENTS_CFG.DAD_RUMOUR_SQUAD);
              s.addDiary({ date: ctx.date, key: 'ev.dad.rumour.diary', vars: {}, cls: 'ev' });
              return { k: { pid: kid.id } };
            } },
        ],
      });
    },
  },

  /* ======================= v2.2 ======================= */
  /* ---------- 3. BROKEN BUS — match day (away games), before kick-off ---------- */
  {
    id: 'bus', when: 'matchday',
    trigger: (s, date, ctx) => ctx?.venue === 'away' && Math.random() < EVENTS_CFG.BUS_CHANCE,
    cast: () => ({}),
    execute(ctx) {
      const s = ctx.state;
      ctx.show({
        face: PortraitGenerator.silhouette('#2b3a4a'), name: L.t('talk.driverName'), role: L.t('talk.roleDriver'),
        text: L.t('ev.bus.text'),
        choices: [
          { key: 'ev.bus.a', tone: 'red', cost: EVENTS_CFG.BUS_COST, run: () => ({}) },
          { key: 'ev.bus.b', tone: 'gray',
            run: () => { for (const p of s.squad) p.energy = Math.round(p.energy * (1 - EVENTS_CFG.BUS_CONDITION)); return {}; } },
        ],
      });
    },
  },

  /* ---------- 4. TRAINING GROUND KNOCK — multi-match injury ---------- */
  {
    id: 'knock', when: 'day',
    trigger: (s) => Math.random() < EVENTS_CFG.KNOCK_CHANCE && s.squad.filter(p => p.available).length > 13,
    cast(s) {
      const fit = s.squad.filter(p => p.available);
      const kid = pick(fit), snitch = pick(fit.filter(p => p !== kid));
      return kid && snitch ? { kid: kid.id, snitch: snitch.id } : null;
    },
    execute(ctx) {
      const { kid, snitch } = ctx.cast;
      if (ctx.step === 'medic') {   // v3.24: the paramedic's verdict, one button (AP and money were spent on the first click)
        ctx.show({ face: kid.portraitSvg, name: L.name(kid.name), role: L.t('talk.roleKnock', { n: kid.number, p: L.pos(kid.position) }),
          text: L.t('ev.knock.medic', { k: L.name(kid.name), d: AP_OPTION.KNOCK_DAYS }),
          choices: [{ key: 'ev.knock.medicOk', as: 'ev.knock.c', tone: 'gray', who: kid.id,
            run: () => { kid.injuryDays = AP_OPTION.KNOCK_DAYS; return { k: { pid: kid.id }, d: AP_OPTION.KNOCK_DAYS, m: '−$' + AP_OPTION.KNOCK_COST }; } }] });
        return;
      }
      ctx.show({   // v3.17: the window shows the injured kid himself (it showed the teammate while the text was about the kid)
        face: kid.portraitSvg, name: L.name(kid.name), role: L.t('talk.roleKnock', { n: kid.number, p: L.pos(kid.position) }),
        text: L.t('ev.knock.text', { k: L.name(kid.name) }) + (snitch ? ' ' + L.t('ev.knock.helper', { s: L.name(snitch.name) }) : ''),
        choices: [
          { key: 'ev.knock.a', tone: 'red', cost: EVENTS_CFG.CLINIC_COST, who: kid.id,
            run: () => { kid.injuryDays = EVENTS_CFG.CLINIC_DAYS; return { k: { pid: kid.id }, d: EVENTS_CFG.CLINIC_DAYS }; } },
          { key: 'ev.knock.b', tone: 'gray', who: kid.id,
            run: () => { kid.injuryDays = EVENTS_CFG.ICE_DAYS; return { k: { pid: kid.id }, d: EVENTS_CFG.ICE_DAYS }; } },
          { key: 'ev.knock.c', tone: 'green', ap: 1, cost: AP_OPTION.KNOCK_COST, who: kid.id, next: 'medic' },   // v3.16: [1 AP] — cheaper than the clinic, slower than it (v3.24: result line first)
        ],
      });
    },
  },

  /* ---------- 5. THE SCOUT — kit money now, a showcase later (time bomb) ---------- */
  {
    id: 'scout', when: 'day',
    trigger: (s) => Math.random() < EVENTS_CFG.SCOUT_CHANCE && s.league.playedMatchdays() >= 1
      && !s.eventQueue.some(q => q.id === 'scoutvisit') && !s.eventLog.some(e => e.id === 'scout' && e.season === s.season),
    cast: () => ({}),
    execute(ctx) {
      ctx.show({
        face: PortraitGenerator.silhouette('#1f4f8a'), name: L.t('talk.scoutName'), role: L.t('talk.roleScout'),
        text: L.t('ev.scout.text', { g: EVENTS_CFG.SCOUT_GIFT }),
        choices: [   // v3.22: refusal first (see dad)
          { key: 'ev.scout.b', tone: 'gray', run: () => ({}) },
          { key: 'ev.scout.a', tone: 'green', gain: EVENTS_CFG.SCOUT_GIFT,
            run: () => { ctx.schedule('scoutvisit', { days: EVENTS_CFG.SCOUT_DAYS, matchDay: true }); return {}; } },
        ],
      });
    },
  },

  /* ---------- 6. THE SCOUT IN THE STANDS — only ever fired by the queue (match day, 14+ days later) ---------- */
  {
    id: 'scoutvisit', when: 'scheduled',
    trigger: () => false,
    cast(s) {   // the three best FIT kids in the whole squad (hidden overall)
      const top = s.squad.filter(p => p.available).sort((a, b) => b.overall - a.overall).slice(0, 3);
      return top.length ? { top: top.map(p => p.id) } : null;
    },
    execute(ctx) {
      const s = ctx.state, top = ctx.cast.top;
      const names = top.map(p => L.name(p.name)).join(', ');
      const tired = top.filter(p => p.energy < ENERGY.TIRED).length;
      ctx.show({
        face: PortraitGenerator.silhouette('#1f4f8a'), name: L.t('talk.scoutName'), role: L.t('talk.roleScoutBack'),
        text: L.t('ev.scoutvisit.text', { t: names }) + (tired ? ' ' + L.t('ev.scoutvisit.tired', { n: tired }) : ''),
        choices: [
          { key: 'ev.scoutvisit.a', tone: 'gray',
            run: () => {
              for (const p of top) {
                if (!p.hasFlag('Showcase')) p.flags.push('Showcase');   // must start, can't be subbed off (see ensureShowcaseXI / substitute)
                p.dyn.morale = clamp(p.dyn.morale + EVENTS_CFG.SHOWCASE_MORALE, 0, 100);
              }
              s.ensureShowcaseXI();
              return { t: names };
            } },
          { key: 'ev.scoutvisit.b', tone: 'red', debt: EVENTS_CFG.SCOUT_GIFT,
            run: () => {
              if (s.budget < 0) for (const p of s.squad) p.dyn.morale = clamp(p.dyn.morale + EVENTS_CFG.DEBT_MORALE, 0, 100);
              return { b: money(s.budget) };
            } },
        ],
      });
    },
  },

  /* ---------- 7. THE DADS' POOL — a winning dad donates now… ---------- */
  {
    id: 'pool', when: 'day',
    trigger: (s) => Math.random() < EVENTS_CFG.POOL_CHANCE && s.league.playedMatchdays() >= 1
      && !s.eventQueue.some(q => q.id === 'poolloss') && !s.eventLog.some(e => e.id === 'pool' && e.season === s.season),
    cast(s) {
      const [w, l] = shuffle(s.squad.filter(p => !p.hasFlag('Promised_Start')));   // winner's son, loser's son (named later)
      return w && l ? { winner: w.id, loser: l.id } : null;
    },
    execute(ctx) {
      const { winner } = ctx.cast;
      ctx.show({
        face: PortraitGenerator.silhouette('#3a6b2a'), name: L.t('talk.parentName', { s: L.name(winner.surname) }), role: L.t('talk.rolePub'),
        text: L.t('ev.pool.text', { k: L.name(winner.name), g: EVENTS_CFG.POOL_GIFT }),
        choices: [   // v3.22: refusal first (see dad)
          { key: 'ev.pool.b', tone: 'gray', who: winner.id,
            run: () => { winner.dyn.morale = clamp(winner.dyn.morale + EVENTS_CFG.POOL_REFUSE_MORALE, 0, 100); return { k: { pid: winner.id } }; } },
          { key: 'ev.pool.a', tone: 'green', gain: EVENTS_CFG.POOL_GIFT, who: winner.id,
            run: () => {
              ctx.schedule('poolloss', { days: EVENTS_CFG.POOL_DAYS, cast: { kid: ctx.cast.loser.id } });
              const r = seeded(ctx.date + '#poolleak#' + winner.id);   // v3.22: the Board may find out (independent of the losing dad)
              if (r() < EVENTS_CFG.POOL_LEAK_CHANCE) ctx.schedule('poolleak', { days: rndR(r, ...EVENTS_CFG.POOL_LEAK_DAYS) });
              return { k: { pid: winner.id } };
            } },
        ],
      });
    },
  },

  /* ---------- 8. …and a losing dad comes for his son's minutes (scheduled, 14 days later) ---------- */
  {
    id: 'poolloss', when: 'scheduled',
    trigger: () => false,
    cast(s) {   // fallback if the scheduled cast is gone: the kid with the fewest appearances
      const kid = [...s.squad].sort((a, b) => (s.seasonOf(a.id).apps - s.seasonOf(b.id).apps))[0];
      return kid ? { kid: kid.id } : null;
    },
    execute(ctx) {
      const s = ctx.state, { kid } = ctx.cast;
      ctx.show({
        face: PortraitGenerator.silhouette('#6b2a2a'), name: L.t('talk.parentName', { s: L.name(kid.surname) }), role: L.t('talk.rolePubBack'),
        text: L.t('ev.poolloss.text', { k: L.name(kid.name), d: EVENTS_CFG.HOME_DAYS }),
        choices: [
          { key: 'ev.poolloss.a', tone: 'gray', who: kid.id,
            run: () => { if (!kid.hasFlag('Promised_Start')) kid.flags.push('Promised_Start'); kid.promiseBy = 'pool'; kid.promiseChoice = null; return { k: { pid: kid.id } }; } },
          { key: 'ev.poolloss.b', tone: 'red', who: kid.id,
            run: () => {
              kid.awayDays = Math.max(kid.awayDays, EVENTS_CFG.HOME_DAYS);
              kid.dyn.morale = clamp(kid.dyn.morale + EVENTS_CFG.HOME_MORALE, 0, 100);
              return { k: { pid: kid.id }, d: EVENTS_CFG.HOME_DAYS };
            } },
        ],
      });
    },
  },

  /* ---------- v2.4 THE TRUANT — rolled right after the training-day routine ---------- */
  {
    id: 'truant', when: 'training',
    trigger: (s) => s.squad.some(p => p.skipped_training) && Math.random() < EVENTS_CFG.TRUANT_CHANCE,
    cast(s) {
      const sk = s.squad.filter(p => p.skipped_training);
      return sk.length ? { kid: pick(sk).id } : null;
    },
    execute(ctx) {
      const { kid } = ctx.cast, face = kid.portraitSvg, name = L.name(kid.name), role = L.t('talk.roleSnitch', { n: kid.number, p: L.pos(kid.position) });
      const sorry = ctx.step === 'sorry';
      if (ctx.step === 'visit') {   // v3.24: the family visit's result, one button, before the game moves on
        ctx.show({ face, name, role: L.t('talk.roleVisit'), text: L.t('ev.truant.visit', { k: name }),
          choices: [{ key: 'ev.visitOk', as: 'ev.truant.d', tone: 'gray', who: kid.id,
            run: () => { kid.psych.discipline = Math.min(20, kid.psych.discipline + AP_OPTION.TRUANT_DISC);
              kid.dyn.morale = clamp(kid.dyn.morale + AP_OPTION.TRUANT_MORALE, 0, 100); return { k: { pid: kid.id } }; } }] });
        return;
      }
      if (sorry || ctx.step === 'hangup') {   // result of "call him": decided once, saved as the step (a reload can't re-roll it)
        ctx.show({ face, name, role: L.t('talk.rolePhone'), text: L.t('ev.truant.' + ctx.step, { k: name }),
          choices: [{ key: 'ev.truant.' + ctx.step + 'Ok', tone: 'gray', who: kid.id,
            run: () => {
              if (sorry) kid.psych.discipline = Math.min(20, kid.psych.discipline + EVENTS_CFG.TRUANT_SORRY_DISC);
              else kid.dyn.morale = clamp(kid.dyn.morale + EVENTS_CFG.TRUANT_HANGUP_MORALE, 0, 100);
              return { k: { pid: kid.id } };
            } }] });
        return;
      }
      ctx.show({ face, name, role: L.t('talk.roleTruant'), text: L.t('ev.truant.text', { k: name }),
        choices: [
          // v3.24: the fine is paid by his family to the club (income, ledger 'event', like the Ultimatum fine). A poor family pays
          // at the next training with the poor kids' first-fee chance — or not at all (no debt). Same amount, same discipline.
          { key: 'ev.truant.a', tone: 'red', who: kid.id, ...(kid.wealth === 'poor' ? { gainLater: EVENTS_CFG.TRUANT_FINE, diary: 'ev.truant.aLater' } : { gain: EVENTS_CFG.TRUANT_FINE }),
            run: () => {
              kid.psych.discipline = Math.min(20, kid.psych.discipline + EVENTS_CFG.TRUANT_FINE_DISC);
              if (kid.wealth === 'poor') ctx.state.addFine(kid.id, EVENTS_CFG.TRUANT_FINE, ctx.date);
              return { k: { pid: kid.id }, f: '$' + EVENTS_CFG.TRUANT_FINE };
            } },
          { key: 'ev.truant.b', tone: 'gray', who: kid.id,
            run: () => {
              kid.suspensionMatches = Math.max(kid.suspensionMatches, 1);
              kid.dyn.morale = clamp(kid.dyn.morale + EVENTS_CFG.TRUANT_BAN_MORALE, 0, 100);
              return { k: { pid: kid.id } };
            } },
          { key: 'ev.truant.c', tone: 'green', next: () => (Math.random() < 0.5 ? 'sorry' : 'hangup') },
          { key: 'ev.truant.d', tone: 'green', ap: 1, who: kid.id, next: 'visit' },   // v3.16: [1 AP] — no fine, no ban, but only discipline +1 (v3.24: result line first)
        ] });
    },
  },

  /* ---------- v2.5 CALL INTO OFFICE — the coach's own action (1 AP), never random ---------- */
  {
    id: 'office', when: 'manual',
    trigger: () => false,
    cast: () => null,   // always fired with the kid the coach picked
    execute(ctx) {
      const { kid } = ctx.cast, face = kid.portraitSvg, name = L.name(kid.name), role = L.t('talk.roleOffice', { n: kid.number, p: L.pos(kid.position) });
      const out = {
        praiseGood: () => { kid.dyn.morale = clamp(kid.dyn.morale + COACH.PRAISE, 0, 100); },
        praiseBad:  () => { kid.dyn.morale = clamp(kid.dyn.morale + COACH.PRAISE_BACKFIRE, 0, 100); },
        crit:       () => { kid.psych.discipline = Math.min(20, kid.psych.discipline + COACH.CRIT_DISC); kid.psych.composure = Math.max(1, kid.psych.composure + COACH.CRIT_COMP);
                            kid.dyn.morale = clamp(kid.dyn.morale + COACH.CRIT_MORALE, 0, 100); },
        check:      () => { kid.dyn.morale = clamp(kid.dyn.morale + COACH.CHECK_MORALE, 0, 100); },
      };
      const s = ctx.state;
      if (ctx.step === 'fee') {   // v3.15: about the fee — the reason is fixed for the month (no extra AP: the talk is already paid)
        const why = s.feeReason(kid.id), f = s.fees, k = { k: { pid: kid.id } }, m = '$' + s.feeDue(kid.id);
        const mor = d => { kid.dyn.morale = clamp(kid.dyn.morale + d, 0, 100); };
        const choices = {
          forgot: [{ key: 'office.fee.forgotOk', tone: 'gray', who: kid.id, run: () => { f.next[kid.id] = FINANCE.NEXT_CHANCE; return k; } }],
          spent: [
            { key: 'office.fee.forgive', tone: 'green', who: kid.id, run: () => { mor(FINANCE.FORGIVE_MORALE); f.status[kid.id] = 'waived'; return k; } },
            { key: 'office.fee.tell', tone: 'gray', who: kid.id, run: () => { mor(FINANCE.TELL_MORALE); kid.psych.discipline = Math.min(20, kid.psych.discipline + FINANCE.TELL_DISC);
              s.addRep('parents', FINANCE.TELL_PARENTS); f.next[kid.id] = FINANCE.NEXT_CHANCE; return k; } } ],
          nomoney: [
            { key: 'office.fee.waive', tone: 'green', who: kid.id, run: () => { mor(FINANCE.WAIVE_MORALE); s.addRep('squad', FINANCE.WAIVE_SQUAD); f.status[kid.id] = 'waived'; return k; } },
            { key: 'office.fee.half', tone: 'gray', who: kid.id, run: () => { f.status[kid.id] = 'half'; return k; } } ],
        }[why];
        ctx.show({ face, name, role, text: L.t('office.fee.' + why, { k: name, m }), choices });
        return;
      }
      if (ctx.step === 'kickConfirm') {   // v2.9: the drastic option asks once more — it can't be undone
        ctx.show({ face, name, role, text: L.t('office.react.kickConfirm', { k: name }),
          choices: [
            { key: 'office.btn.kickYes', tone: 'red', who: kid.id,
              run: () => { s.expel(kid.id); s.addRep('parents', COACH.KICK_PARENTS); s.addRep('squad', COACH.KICK_SQUAD); return { n: name }; } },
            { key: 'office.btn.kickNo', tone: 'gray', next: 'start' },
          ] });
        return;
      }
      if (out[ctx.step]) {   // the kid's reaction (decided when the coach spoke; saved as the step)
        ctx.show({ face, name, role, text: L.t('office.react.' + ctx.step, { k: name }),   // v2.9: reaction keys no longer clash with the button labels
          choices: [{ key: 'office.' + ctx.step + '.ok', tone: 'gray', who: kid.id, run: () => { out[ctx.step](); return { k: { pid: kid.id } }; } }] });
        return;
      }
      ctx.show({ face, name, role, text: L.t('office.text', { k: name }),
        choices: [
          { key: 'office.btn.praise', tone: 'green', next: () => (kid.dyn.sharpness < COACH.PRAISE_LOW || kid.energy < COACH.PRAISE_LOW ? 'praiseBad' : 'praiseGood') },
          { key: 'office.btn.crit', tone: 'gray', next: 'crit' },
          { key: 'office.btn.check', tone: 'gray', next: 'check' },
          ...(s.feeOwes(kid.id) ? [{ key: 'office.btn.fee', tone: 'gray', next: 'fee' }] : []),   // v3.15: only for a kid who owes
          { key: 'office.btn.kick', tone: 'red', blocked: s.expelBlock(kid.id), next: 'kickConfirm' },   // v2.9: destructive
        ] });
    },
  },

  /* ---------- v2.6 ROLL CALL — the coach rings an absent kid (1 AP, from an empty locker) ---------- */
  {
    id: 'rollcall', when: 'manual',
    trigger: () => false,
    cast: () => null,
    execute(ctx) {
      const { kid } = ctx.cast, name = L.name(kid.name), why = ctx.state.dayState().locker?.absent[kid.id] || 'skipped';
      const base = { face: why === 'skipped' ? PortraitGenerator.silhouette('#444') : kid.portraitSvg, name, role: L.t('talk.rolePhoneCall', { n: kid.number }) };
      if (why === 'skipped') {
        ctx.show({ ...base, text: L.t('lr.why.skipped', { k: name }),
          choices: [
            { key: 'lr.fine', tone: 'red', cost: LOCKER.FINE, who: kid.id,
              run: () => { kid.psych.discipline = Math.min(20, kid.psych.discipline + LOCKER.FINE_DISC); return { k: { pid: kid.id } }; } },
            { key: 'lr.ignore', tone: 'gray', who: kid.id, run: () => ({ k: { pid: kid.id } }) },
          ] });
        return;
      }
      ctx.show({ ...base, text: L.t('lr.why.' + why, { k: name, d: kid.injuryDays, n: kid.suspensionMatches, h: kid.awayDays }),
        choices: [{ key: 'lr.ok', tone: 'gray', who: kid.id, run: () => ({ k: { pid: kid.id }, r: { why } }) }] });
    },
  },

  /* ---------- v2.8 IMMEDIATE REQUEST — a kid who DID turn up asks to go home (locker room, before you look around) ---------- */
  {
    id: 'excuse', when: 'manual',
    trigger: () => false,
    cast: () => null,
    execute(ctx) {
      const s = ctx.state, { kid } = ctx.cast, lk = s.dayState().locker, req = lk?.request, kind = req?.kind || 'test', name = L.name(kid.name);
      const text = req?.text || `ex.${kind}.0`;   // v3.24: 8 kinds × 2 phrasings (a v3.23 request has no text → the first phrasing)
      const finish = () => { if (req) req.done = true; };
      ctx.show({ face: kid.portraitSvg, name, role: L.t('talk.roleExcuse', { n: kid.number, p: L.pos(kid.position) }),
        text: L.t(text, { k: name }),
        choices: [
          { key: 'ex.home', tone: 'gray', who: kid.id,
            run: () => {
              finish();
              kid.absentToday = 'excused'; kid.skipped_training = false;
              if (lk) { lk.absent[kid.id] = 'excused'; if (!lk.checked.includes(kid.id)) lk.checked.push(kid.id); }
              s.addRep('parents', REP.EXCUSE_HOME_PARENTS);
              return { k: { pid: kid.id } };
            } },
          { key: s.phase === 'matchday' ? 'ex.stayMatch' : 'ex.stay', tone: 'red', who: kid.id,   // v3.17: match-day wording
            run: () => {
              finish();
              s.addRep('squad', REP.EXCUSE_STAY_SQUAD);
              kid.dyn.morale = clamp(kid.dyn.morale + REP.EXCUSE_STAY_MORALE, 0, 100);
              if (kind === 'ankle' && Math.random() < REP.EXCUSE_ANKLE_INJURY) {   // it really was something
                kid.injuryDays = Math.max(kid.injuryDays, rnd(...REP.EXCUSE_ANKLE_DAYS));
                if (lk) { lk.absent[kid.id] = 'injury'; if (!lk.checked.includes(kid.id)) lk.checked.push(kid.id); }
                s.addDiary({ date: ctx.date, key: 'ex.ankleHurt', vars: { k: { pid: kid.id }, d: kid.injuryDays }, cls: 'ev' });
              }
              return { k: { pid: kid.id } };
            } },
        ] });
    },
  },

  /* ---------- v3.6 "WRONG SPOT" — after 3+ straight matches outside his hidden line, a kid asks to play elsewhere (locker room) ---------- */
  {
    id: 'posreq', when: 'manual',
    trigger: () => false,
    cast: () => null,   // rolled with the arrivals (GameState.rollPositionRequest), fired by LockerRoom.maybeRequest
    execute(ctx) {
      const s = ctx.state, { kid } = ctx.cast, name = L.name(kid.name), req = s.dayState().locker?.posRequest;
      const now = LINE_POS[s.slotLine(kid.id)] || kid.position, want = kid.archetype;
      const finish = () => { if (req && req.pid === kid.id) req.done = true; };
      ctx.show({ face: kid.portraitSvg, name, role: L.t('talk.rolePosReq', { n: kid.number, p: L.pos(kid.position) }),
        text: L.t('pr.text', { k: name, now: L.t('pr.where.' + (now || 'none')), want: L.t('pr.want.' + want) }),
        choices: [
          { key: 'pr.yes', tone: 'green', who: kid.id,
            run: () => {
              finish();
              kid.tag = want; kid.refreshPortrait();
              kid.outOfPositionMatches = 0;
              kid.dyn.morale = clamp(kid.dyn.morale + POS_HINT.YES_MORALE, 0, 100);
              return { k: { pid: kid.id }, p: { pos: want } };
            } },
          { key: 'pr.wait', tone: 'gray', who: kid.id,
            run: () => { finish(); kid.positionHintCooldown = POS_HINT.COOLDOWN; return { k: { pid: kid.id } }; } },
          { key: 'pr.order', tone: 'red', who: kid.id,
            run: () => {
              finish();
              kid.psych.discipline = clamp(kid.psych.discipline + POS_HINT.ORDER_DISC, 1, 20);
              kid.dyn.morale = clamp(kid.dyn.morale + POS_HINT.ORDER_MORALE, 0, 100);
              kid.positionHintCooldown = POS_HINT.COOLDOWN;
              return { k: { pid: kid.id } };
            } },
        ] });
    },
  },

  /* ---------- v3.8 ARMBAND ASSIGNMENT — the kid reacts by his HIDDEN leadership (fired by UIController.assignDuty) ---------- */
  {
    id: 'capassign', when: 'manual',
    trigger: () => false,
    cast: () => null,
    execute(ctx) {
      const s = ctx.state, { kid } = ctx.cast, name = L.name(kid.name), tier = s.captainTier(kid), v = s.captainLine(kid.id, ctx.date);
      const ok = key => ({ key, tone: 'green', who: kid.id, run: () => { s.confirmCaptain(kid.id, true); return { k: { pid: kid.id } }; } });
      ctx.show({ face: kid.portraitSvg, name, role: L.t('talk.roleArmband', { n: kid.number, p: L.pos(kid.position) }),
        text: L.t('ca.' + tier + '.' + v, { k: name }),
        choices: tier === 'low'
          ? [ok('ca.trust'), { key: 'ca.other', tone: 'gray', who: kid.id, run: () => ({ k: { pid: kid.id } }) }]
          : [ok('ca.ok.' + tier)] });
    },
  },

  /* ---------- v3.8 CAPTAIN INITIATIVE A — "he looks lost there" (captain leadership ≥ 8, teammate 2+ matches out of his line) ---------- */
  {
    id: 'capobs', when: 'manual',
    trigger: () => false,
    cast: () => null,   // rolled with the arrivals (GameState.rollCaptainRequest), fired by LockerRoom.maybeRequest
    execute(ctx) {
      const s = ctx.state, { kid, mate } = ctx.cast, Ld = LEADERSHIP, name = L.name(kid.name), t = L.name(mate.name);
      const now = LINE_POS[s.slotLine(mate.id)] || mate.position, want = mate.archetype;
      const finish = () => { const r = s.dayState().locker?.capRequest; if (r && r.pid === kid.id) r.done = true; s.capt.initUntil = isoAdd(ctx.date, Ld.INIT_CD); };
      const vars = () => ({ k: { pid: kid.id }, t: { pid: mate.id } });
      ctx.show({ face: kid.portraitSvg, name, role: L.t('talk.roleCaptain', { n: kid.number, p: L.pos(kid.position) }),
        text: L.t('co.text.' + Math.floor(seeded(ctx.date + '#cotext#' + mate.id)() * 2), { k: name, t, now: L.t('pr.where.' + (now || 'none')), want: L.t('pr.where.' + want) }),
        choices: [
          { key: 'co.yes', tone: 'green', who: kid.id,
            run: () => {
              finish();
              mate.tag = want; mate.refreshPortrait(); mate.outOfPositionMatches = 0;
              for (const p of [kid, mate]) p.dyn.morale = clamp(p.dyn.morale + Ld.OBS_MORALE, 0, 100);
              return { ...vars(), p: { pos: want } };
            } },
          { key: 'co.watch', tone: 'gray', who: kid.id, run: () => { finish(); return vars(); } },
          { key: 'co.no', tone: 'red', who: kid.id,
            run: () => {
              finish();
              kid.psych.discipline = clamp(kid.psych.discipline + Ld.OBS_RED_DISC, 1, 20);
              kid.dyn.morale = clamp(kid.dyn.morale + Ld.OBS_RED_MORALE, 0, 100);
              s.capt.pauseUntil = isoAdd(ctx.date, Ld.ADVICE_PAUSE);
              return vars();
            } },
        ] });
    },
  },

  /* ---------- v3.8 CAPTAIN INITIATIVE B — "give him some minutes" (captain leadership ≥ 14, teammate benched 2+ matches, low morale) ---------- */
  {
    id: 'capbench', when: 'manual',
    trigger: () => false,
    cast: () => null,
    execute(ctx) {
      const s = ctx.state, { kid, mate } = ctx.cast, Ld = LEADERSHIP, name = L.name(kid.name), t = L.name(mate.name);
      const finish = () => { const r = s.dayState().locker?.capRequest; if (r && r.pid === kid.id) r.done = true; s.capt.initUntil = isoAdd(ctx.date, Ld.INIT_CD); };
      const vars = () => ({ k: { pid: kid.id }, t: { pid: mate.id } });
      ctx.show({ face: kid.portraitSvg, name, role: L.t('talk.roleCaptain', { n: kid.number, p: L.pos(kid.position) }),
        text: L.t('cb.text.' + Math.floor(seeded(ctx.date + '#cbtext#' + mate.id)() * 2), { k: name, t, n: mate.benchStreak }),
        choices: [
          { key: 'cb.yes', tone: 'green', who: kid.id, run: () => { finish(); mate.promisedPitchTime = true; return vars(); } },
          { key: 'cb.wait', tone: 'gray', who: kid.id,
            run: () => { finish(); mate.dyn.morale = clamp(mate.dyn.morale + Ld.BENCH_WAIT_MORALE, 0, 100); return vars(); } },
          { key: 'cb.no', tone: 'red', who: kid.id,
            run: () => {
              finish();
              for (const p of [kid, mate]) p.psych.discipline = clamp(p.psych.discipline + Ld.BENCH_RED_DISC, 1, 20);
              mate.dyn.morale = clamp(mate.dyn.morale + Ld.BENCH_RED_KID, 0, 100);
              kid.dyn.morale = clamp(kid.dyn.morale + Ld.BENCH_RED_CAP, 0, 100);
              return vars();
            } },
        ] });
    },
  },

  /* ---------- v3.8 "CAN I GIVE IT BACK?" — a low-leadership captain asks to hand back the armband ---------- */
  {
    id: 'capresign', when: 'manual',
    trigger: () => false,
    cast: () => null,
    execute(ctx) {
      const s = ctx.state, { kid, hint } = ctx.cast, Ld = LEADERSHIP, name = L.name(kid.name);
      const finish = () => { const r = s.dayState().locker?.capRequest; if (r && r.pid === kid.id) r.done = true; };
      const text = hint ? L.t('cr.text.hint', { k: name, h: L.name(hint.name) }) : L.t('cr.text.' + Math.floor(seeded(ctx.date + '#crtext#' + kid.id)() * 2), { k: name });
      ctx.show({ face: kid.portraitSvg, name, role: L.t('talk.roleCaptain', { n: kid.number, p: L.pos(kid.position) }), text,
        choices: [
          { key: 'cr.yes', tone: 'green', who: kid.id,
            run: () => {
              finish();
              if (s.duties.captain === kid.id) s.duties.captain = null;   // no "stripped" reaction: he asked for it
              kid.dyn.morale = clamp(kid.dyn.morale + Ld.RESIGN_YES, 0, 100);
              return { k: { pid: kid.id } };
            } },
          { key: 'cr.hold', tone: 'gray', who: kid.id,
            run: () => { finish(); s.capt.hold = Ld.RESIGN_HOLD; kid.dyn.morale = clamp(kid.dyn.morale + Ld.RESIGN_HOLD_MORALE, 0, 100); return { k: { pid: kid.id } }; } },
          { key: 'cr.no', tone: 'red', who: kid.id,
            run: () => {
              finish();
              kid.psych.discipline = clamp(kid.psych.discipline + Ld.RESIGN_NO_DISC, 1, 20);
              kid.dyn.morale = clamp(kid.dyn.morale + Ld.RESIGN_NO_MORALE, 0, 100);
              kid.capPressure = 1;               // breakdown risk ×1.5 in the next match
              s.capt.hold = Ld.RESIGN_NO_HOLD;   // he won't ask again before that match
              return { k: { pid: kid.id } };
            } },
        ] });
    },
  },

  /* ---------- 7. THE ULTIMATUM — two-step disciplinary dialogue ---------- */
  {
    id: 'ulti', when: 'day',
    trigger: (s) => Math.random() < EVENTS_CFG.ULTI_CHANCE && s.squad.some(p => p.psych.discipline < EVENTS_CFG.ULTI_DISCIPLINE && p.available),
    cast(s) {
      const bad = s.squad.filter(p => p.psych.discipline < EVENTS_CFG.ULTI_DISCIPLINE && p.available);
      return bad.length ? { kid: pick(bad).id } : null;
    },
    execute(ctx) {
      const { kid } = ctx.cast, face = kid.portraitSvg, name = L.name(kid.name), role = L.t('talk.roleSnitch', { n: kid.number, p: L.pos(kid.position) });
      if (ctx.step === 'visit') {   // v3.24: the family visit's result, one button, before the game moves on
        ctx.show({ face, name, role: L.t('talk.roleVisit'), text: L.t('ev.truant.visit', { k: name }),
          choices: [{ key: 'ev.visitOk', as: 'ev.ulti.e', tone: 'gray', who: kid.id,
            run: () => { kid.psych.discipline = Math.min(20, kid.psych.discipline + AP_OPTION.TRUANT_DISC);
              kid.dyn.morale = clamp(kid.dyn.morale + AP_OPTION.TRUANT_MORALE, 0, 100); return { k: { pid: kid.id } }; } }] });
        return;
      }
      if (ctx.step === 'office') {
        ctx.show({ face, name, role, text: L.t('ev.ulti.text2', { k: name }),
          choices: [
            { key: 'ev.ulti.c', tone: 'red', who: kid.id,
              run: () => { kid.suspensionMatches = Math.max(kid.suspensionMatches, EVENTS_CFG.ULTI_SUSPEND); return { k: { pid: kid.id }, n: EVENTS_CFG.ULTI_SUSPEND }; } },
            { key: 'ev.ulti.d', tone: 'gray', who: kid.id,
              run: () => {
                kid.psych.discipline = Math.max(1, kid.psych.discipline + EVENTS_CFG.ULTI_SORRY_DISC);
                kid.dyn.morale = clamp(kid.dyn.morale + EVENTS_CFG.ULTI_SORRY_MORALE, 0, 100);
                return { k: { pid: kid.id } };
              } },
          ] });
        return;
      }
      ctx.show({ face, name, role: L.t('talk.roleReport'), text: L.t('ev.ulti.text', { k: name }),
        choices: [
          { key: 'ev.ulti.a', tone: 'green', gain: EVENTS_CFG.ULTI_FINE, who: kid.id,
            run: () => { kid.dyn.morale = clamp(kid.dyn.morale + EVENTS_CFG.ULTI_FINE_MORALE, 0, 100); return { k: { pid: kid.id } }; } },
          { key: 'ev.ulti.b', tone: 'gray', next: 'office' },
          { key: 'ev.ulti.e', tone: 'green', ap: 1, who: kid.id, next: 'visit' },   // v3.17: the same [1 AP] family visit as The Truant (v3.16; v3.24: result line first)
        ] });
    },
  },
  /* ---------- v3.22 THE PUB POOL GETS FOUND OUT — silent (no dialogue): an important briefing line + diary ---------- */
  {
    id: 'poolleak', when: 'scheduled', silent: true,
    trigger: () => false,
    apply(s, date) {
      s.addRep('board', EVENTS_CFG.POOL_LEAK_BOARD);
      s.addRep('parents', EVENTS_CFG.POOL_LEAK_PARENTS);
      s.eventLog.push({ id: 'poolleak', date, season: s.season, choice: 'ev.poolleak' });
      if (s.eventLog.length > 60) s.eventLog.shift();
      s.addDiary({ date, key: 'ev.poolleak.diary', vars: {}, cls: 'ev' });   // '.diary' = an IMPORTANT, never-muted briefing line
    },
  },

  /* ---------- v3.22 THE PROMISE CARD — kick-off, locker room (dad's paid start or the pool dad's promise). No OK: keep or break ---------- */
  {
    id: 'promise', when: 'manual',
    trigger: () => false,
    cast: () => null,   // fired by LockerRoom.maybeRequest / createEngine with { kid }
    execute(ctx) {
      const s = ctx.state, { kid } = ctx.cast, name = L.name(kid.name), pool = kid.promiseBy === 'pool';
      const starter = s.isStarter(kid.id), out = starter ? null : s.lineSwapSlot(kid)?.q;
      const tail = starter ? L.t('ev.promise.inXI', { k: name }) : out ? L.t('ev.promise.drops', { d: L.name(out.name) }) : '';
      ctx.show({ face: kid.portraitSvg, name, role: L.t('talk.rolePromise'),
        text: L.t(pool ? 'ev.promise.textPool' : 'ev.promise.text', { k: name }) + (tail ? ' ' + tail : ''),
        choices: [
          { key: (pool ? 'ev.promise.keepPool' : 'ev.promise.keep') + (out ? 'Swap' : ''), vars: { k: name }, tone: 'green', who: kid.id,   // …Swap: the diary names who dropped out
            run: () => {
              kid.promiseChoice = 'keep';
              const d = s.promiseStart(kid);
              if (d) d.dyn.morale = clamp(d.dyn.morale + EVENTS_CFG.PROMISE_DISPLACED_MORALE, 0, 100);
              if (!pool) s.addRep('parents', EVENTS_CFG.DAD_KEPT_PARENTS);   // the other parents notice (not for the pool dad: no money)
              return { k: { pid: kid.id }, ...(d ? { d: { pid: d.id } } : {}) };
            } },
          { key: pool ? 'ev.promise.breakPool' : 'ev.promise.break', vars: { k: name }, tone: 'red', who: kid.id,
            ...(pool ? {} : { debt: EVENTS_CFG.DAD_REFUND, cat: 'donation' }),   // full refund (may push the club below $0)
            run: () => {
              kid.promiseChoice = 'break';
              s.promiseBench(kid);
              if (pool) {   // the losing dad keeps his son at home
                kid.dyn.morale = clamp(kid.dyn.morale + EVENTS_CFG.POOL_BROKEN_MORALE, 0, 100);
                kid.awayDays = Math.max(kid.awayDays, EVENTS_CFG.HOME_DAYS);
              } else {
                kid.dyn.morale = clamp(kid.dyn.morale + EVENTS_CFG.PROMISE_BROKEN_MORALE, 0, 100);
                s.addRep('parents', EVENTS_CFG.DAD_BROKEN_PARENTS);   // the father complains to the other parents
              }
              return { k: { pid: kid.id }, d: EVENTS_CFG.HOME_DAYS };
            } },
        ] });
    },
  },

  /* ---------- v3.22 THE SCOUT COMES BACK — 28–42 days after the showcase he wants the best kid who played (scheduled) ---------- */
  {
    id: 'scoutpoach', when: 'scheduled',
    trigger: () => false,
    cast: () => null,   // only the scheduled kid; gone from the squad → skipped silently
    execute(ctx) {
      const s = ctx.state, { kid } = ctx.cast, name = L.name(kid.name);
      const face = PortraitGenerator.silhouette('#1f4f8a'), who = L.t('talk.scoutName'), role = L.t('talk.roleScoutPoach');
      const leave = () => {   // the scout takes him: the removal path of the office's "expel", without its penalties
        s.expel(kid.id, { to: 'big_club' });
        return { k: { name: kid.name } };
      };
      if (ctx.step === 'stay' || ctx.step === 'leave') {   // the family's answer, decided once (saved step) and shown before moving on
        const stay = ctx.step === 'stay';
        ctx.show({ face, name: who, role: L.t('talk.rolePhone'), text: L.t('ev.scoutpoach.' + ctx.step, { k: name }),
          choices: [{ key: 'ev.scoutpoach.' + ctx.step + 'Ok', tone: 'gray', who: kid.id, ...(stay ? {} : { gain: EVENTS_CFG.POACH_FEE }),
            run: () => {
              if (stay) { kid.dyn.morale = clamp(kid.dyn.morale + EVENTS_CFG.POACH_TALK_STAY_MORALE, 0, 100); return { k: { pid: kid.id } }; }
              s.addRep('squad', EVENTS_CFG.POACH_LET_SQUAD);   // Parents +0: the family decided, not the coach
              return leave();
            } }] });
        return;
      }
      const blk = s.expelBlock(kid.id);   // never below the squad minimum / without a keeper
      ctx.show({ face, name: who, role, text: L.t('ev.scoutpoach.text', { k: name }),
        choices: [   // refusal first, like every money offer
          { key: 'ev.scoutpoach.a', vars: { k: name }, tone: 'gray', who: kid.id,
            run: () => {
              kid.dyn.morale = clamp(kid.dyn.morale + EVENTS_CFG.POACH_REFUSE_MORALE, 0, 100);
              s.addRep('parents', EVENTS_CFG.POACH_REFUSE_PARENTS);
              return { k: { pid: kid.id } };
            } },
          { key: 'ev.scoutpoach.b', tone: 'green', ap: 1, who: kid.id,
            next: () => (blk || seeded(ctx.date + '#poachtalk#' + kid.id)() < clamp(0.5 + (kid.dyn.morale - 50) / 100, 0.2, 0.8) ? 'stay' : 'leave') },
          { key: 'ev.scoutpoach.c', tone: 'green', gain: EVENTS_CFG.POACH_FEE, who: kid.id, blocked: blk ? 'ev.scoutpoach.blk' : null,
            run: () => {
              s.addRep('parents', EVENTS_CFG.POACH_LET_PARENTS);
              s.addRep('squad', EVENTS_CFG.POACH_LET_SQUAD);
              return leave();
            } },
        ] });
    },
  },

  /* ---------- v3.25 HAVE A WORD — the talk one-on-one (PLAYER_INFO.EXE, 1 AP = 2 questions, once a week per kid) ---------- */
  {
    id: 'bondtalk', when: 'manual',
    trigger: () => false,
    cast: () => null,   // fired by UIController.haveWord with the kid
    execute(ctx) { bondTalkStep(ctx, ctx.step === 'start' ? 'menu' : ctx.step, ''); },
  },

  /* ---------- v3.25 MISSES HIS BROTHER — 2–4 weeks after the coach refused the twin at the draft (20 %, scheduled) ---------- */
  {
    id: 'twinmiss', when: 'scheduled',
    trigger: () => false,
    cast: () => null,
    execute(ctx) {
      const s = ctx.state, { kid } = ctx.cast, name = L.name(kid.name), blk = s.expelBlock(kid.id);
      const face = kid.portraitSvg, role = L.t('talk.roleOffice', { n: kid.number, p: L.pos(kid.position) });
      if (ctx.step === 'stay' || ctx.step === 'go') {
        ctx.show({ face, name, role, text: L.t('ev.twinmiss.' + ctx.step, { k: name }),
          choices: [{ key: 'ev.twinmiss.' + ctx.step + 'Ok', tone: 'gray', who: kid.id,
            run: () => { if (ctx.step === 'go') { s.expel(kid.id); return { k: { name: kid.name } }; } kid.dyn.morale = clamp(kid.dyn.morale + 5, 0, 100); return { k: { pid: kid.id } }; } }] });
        return;
      }
      ctx.show({ face, name, role, text: L.t('ev.twinmiss.text', { k: name }),
        choices: [
          { key: 'ev.twinmiss.a', tone: 'gray', who: kid.id, blocked: blk ? 'ev.scoutpoach.blk' : null, run: () => { s.expel(kid.id); return { k: { name: kid.name } }; } },   // let him go (no expel penalties)
          { key: 'ev.twinmiss.b', tone: 'green', ap: 1, who: kid.id, next: () => (blk || seeded(ctx.date + '#twinmiss#' + kid.id)() < clamp(0.5 + (kid.dyn.morale - 50) / 100, 0.2, 0.8) ? 'stay' : 'go') },
          { key: 'ev.twinmiss.c', tone: 'red', who: kid.id, run: () => { kid.dyn.morale = clamp(kid.dyn.morale - 10, 0, 100); return { k: { pid: kid.id } }; } },
        ] });
    },
  },
];

/* ---------- v3.25 the talk window (shared by "Have a word" and the free question when a kid came by himself) ----------
   pe.talk = { left, free }; steps: 'menu' → 'pick:<qid>' (→ 'pick2:pair:<x>') → 'ans' (the answer, rolled once in `next`). */
function bondTalkStep(ctx, step, prefix) {
  const s = ctx.state, pe = s.pendingEvent, { kid } = ctx.cast, name = L.name(kid.name);
  const t = (pe.talk ||= { left: TALK.QUESTIONS, free: false });
  const face = kid.portraitSvg, role = L.t(t.free ? 'btalk.roleFree' : 'btalk.role', { n: kid.number, p: L.pos(kid.position) });
  const others = s.squad.filter(p => p.id !== kid.id).sort((a, b) => a.number - b.number);
  const nm = p => squadName(p, s.squad);
  const ask = (qid, x = null, y = null) => () => { pe.ans = s.talkAnswer(kid, qid, x, y, ctx.date); t.left--; s.learnTwins(kid, ctx.date); return prefix + 'ans'; };
  const back = t.free ? { key: 'btalk.back', tone: 'gray', next: () => { const r = pe.ret || 'start'; delete pe.talk; delete pe.ans; return r; } }
    : { key: 'btalk.bye', tone: 'gray', who: kid.id, diary: 'btalk.end', run: () => ({ k: { pid: kid.id } }) };
  if (step === 'ans') {
    ctx.show({ face, name, role, text: bondTalkText(s, kid, pe.ans),
      choices: t.left > 0 ? [{ key: 'btalk.more', tone: 'green', next: prefix + 'menu' }, back] : [back] });
    return;
  }
  if (step.startsWith('pick:') && TALK_QUESTIONS.find(r => r.id === step.split(':')[1])?.x === 'mediate') {   // v3.27: a pair in conflict
    ctx.show({ face, name, role, text: L.t('btalk.pickMed'),
      choices: [...s.talkMedPairs(kid).map(([a, b]) => ({ key: 'btalk.kid2', vars: { x: nm(s.player(a)), y: nm(s.player(b)) }, tone: 'gray', next: ask('mediate', a, b) })),
        { key: 'btalk.cancel', tone: 'gray', next: prefix + 'menu' }] });
    return;
  }
  if (step.startsWith('pick:') || step.startsWith('pick2:')) {
    const [, qid, x] = step.split(':'), q = TALK_QUESTIONS.find(r => r.id === qid);
    const pool = step.startsWith('pick2:') ? others.filter(p => p.id !== x)
      : q.x === 'played' ? others.filter(p => (s.seasonOf(p.id).apps || 0) >= 1)
      : q.x === 'conflict' ? others.filter(p => s.knownConflicts(kid.id).includes(p.id)) : others;   // v3.27
    ctx.show({ face, name, role, text: L.t(step.startsWith('pick2:') ? 'btalk.pick2' : 'btalk.pick', { x: x ? nm(s.player(x)) : '' }),
      choices: [...pool.map(p => ({ key: 'btalk.kid', vars: { x: nm(p) }, tone: 'gray',
        next: qid === 'pair' && !step.startsWith('pick2:') ? prefix + 'pick2:pair:' + p.id : ask(qid, qid === 'pair' ? x : p.id, qid === 'pair' ? p.id : null) })),
        { key: 'btalk.cancel', tone: 'gray', next: prefix + 'menu' }] });
    return;
  }
  const played = others.some(p => (s.seasonOf(p.id).apps || 0) >= 1);
  ctx.show({ face, name, role, text: L.t(pe.ans ? 'btalk.again' : t.free ? 'btalk.introFree' : 'btalk.intro', { k: name, n: t.left }),
    choices: [...TALK_QUESTIONS.filter(q => (q.x !== 'played' || played) && s.talkQAvail(kid, q, ctx.date)).map(q => ({ key: 'btalk.q.' + q.id, tone: 'green',
      next: q.x && q.x !== 'fight' ? prefix + 'pick:' + q.id : ask(q.id) })), back] });   // v3.27: conditional questions; "Who started it?" needs no pick
}
/** The kid's words for one answer (no numbers; phrasings by band × root / cause, picked by a seeded roll). */
function bondTalkText(s, kid, a) {
  if (!a) return L.t('bt.a.evade.0');
  const x = a.about && s.player(a.about), y = a.y && s.player(a.y), xn = x ? L.name(x.name) : '', yn = y ? L.name(y.name) : '';
  const v = (key, n) => key + '.' + Math.floor(seeded(kid.id + '#bt#' + (a.qid || '') + (a.about || '') + (s.calendar?.date || ''))() * n);
  if (a.kind === 'repeat') return L.t('bt.a.repeat');
  if (a.kind === 'none') return L.t(a.qid === 'mates' ? 'bt.a.noMates' : 'bt.a.noHard');
  if (a.kind === 'evade') return L.t(v('bt.a.evade', 3), { x: xn });
  if (a.qid === 'pair') return L.t('bt.a.pair.' + bondClass(a.band), { x: xn, y: yn });
  if (a.qid === 'who') return a.kind === 'none' ? L.t('bt.a.who.none') : L.t(v('bt.a.who', 2), { x: xn, y: yn });   // v3.27 (a lie looks the same)
  if (a.qid === 'mediate') return L.t(a.ok ? 'bt.a.med.ok' : 'bt.a.med.fail', { x: xn, y: yn });
  if (a.qid === 'what' && a.surprised && a.kind === 'honest') return L.t(v('bt.a.what.fine', 2), { x: xn });   // the other side of a hidden grudge
  if (a.qid === 'pitch') return L.t(v('bt.a.pitch.' + a.tone, 2), { x: xn, s: a.signal ? L.t('af.sig.' + a.signal) : '' });
  const band = a.kind === 'lie' ? 'neutral' : a.band;
  let key;
  if (band === 'best' || band === 'mates') key = a.root ? v('bt.a.mates.' + a.root, 2) : band === 'best' ? v('bt.a.best', 2) : a.assist ? v('bt.a.mates.club', 2) : v('bt.a.mates', 3);
  else if (band === 'cold') key = a.cause ? v('bt.a.cold.' + a.cause, 2) : v('bt.a.cold', 2);
  else if (band === 'war') key = a.qid === 'what' && a.cause ? v('bt.a.cold.' + a.cause, 2) : v('bt.a.war', 3);   // v3.27: "What happened?" names it
  else key = v('bt.a.neutral', 3);
  const lead = a.qid === 'mates' ? L.t('bt.who.mates', { x: xn }) + ' ' : a.qid === 'hard' ? L.t('bt.who.hard', { x: xn }) + ' ' : '';
  return lead + L.t(key, { x: xn }) + (a.stirred ? ' ' + L.t('bt.a.stirred') : '');
}

class EventEngine {
  constructor(ui) {
    this.ui = ui;
    this.enabled = true;              // random rolls on/off (smoke test / debug). Scheduled consequences always fire.
    this.view = new DialogueView(ui, this);
  }
  get state() { return this.ui.state; }
  get active() { return !!this.state.pendingEvent; }
  get events() { return NARRATIVE_EVENTS; }
  find(id) { return NARRATIVE_EVENTS.find(e => e.id === id); }

  /* ---------- v2.2 time bombs: state.eventQueue = [{ id, due, matchDay, from }] ---------- */
  /** Schedules `id` for `days` after `from` (ISO date). matchDay = fire on the first MATCH day on/after that date. */
  schedule(id, { days = 0, date = null, matchDay = false, from = this.state.calendar.date, by = null, cast = null } = {}) {
    const due = date || isoAdd(from, days);
    this.state.eventQueue.push({ id, due, matchDay: !!matchDay, from: by, ...(cast ? { cast } : {}) });
    this.state.eventQueue.sort((a, b) => a.due.localeCompare(b.due));
  }
  takeDue(date, matchDay) {
    const q = this.state.eventQueue, i = q.findIndex(x => x.due <= date && !!x.matchDay === matchDay);
    return i < 0 ? null : q.splice(i, 1)[0];
  }

  /** After a NON-match day. Returns true when an event fired (the calendar must pause). */
  roll(date, { resume = true, cont = false } = {}) {   // v2.5: resume=false in the day loop; v3.13: cont = a [ CONTINUE ] run goes on afterwards
    if (this.active) return false;
    const due = this.takeDue(date, false);
    if (due && this.find(due.id)?.silent) this.find(due.id).apply(this.state, date);   // v3.22: no dialogue (poolleak)
    else if (due && this.fire(due.id, date, { resume, cont, cast: due.cast })) return true;
    if (!this.enabled) return false;
    const s = this.state;
    if (s.isOurTraining(date) && s.bonds) {   // v3.27: the clash roll and the bond events have their own cooldowns (CLASH.*), before the 6-day one
      const b = s.bondEventRoll(date, s.trainedOn?.(date) || []);
      if (b && this.fire(b.id, date, { resume, cont, cast: b.cast })) return true;
    }
    const last = [...s.eventLog].reverse().find(e => !['manual', 'bond'].includes(this.find(e.id)?.when));   // the coach's own talks (and v3.27 bond events) don't count
    if (last && last.season === s.season && isoDays(last.date, date) < EVENTS_CFG.COOLDOWN) return false;
    // v2.4: on a training day the training events are evaluated first (the routine has just run)
    const pool = (s.isOurTraining(date) ? shuffle(NARRATIVE_EVENTS.filter(e => e.when === 'training')) : [])
      .concat(shuffle(NARRATIVE_EVENTS.filter(e => (e.when || 'day') === 'day')));
    for (const ev of pool) if (ev.trigger(s, date) && this.fire(ev.id, date, { resume, cont })) return true;
    return false;
  }
  /** v2.2: on a MATCH day, before kick-off (called when the calendar stops on the matchday). */
  rollMatchDay(mev) {
    if (this.active) return false;
    const s = this.state, date = mev.date, ctx = s.matchContext();
    const due = this.takeDue(date, true);
    if (due && this.fire(due.id, date, { after: 'matchday', cast: due.cast })) return true;
    if (!this.enabled) return false;
    if (s.bonds && CLASH.MATCHDAY) {   // v3.27: the warm-up rondo — the clash roll on a match day (clash / fight only)
      const b = s.clashRoll(date, s.squad.filter(p => p.available));
      if (b && this.fire(b.id, date, { after: 'matchday', cast: b.cast })) return true;
    }
    for (const ev of shuffle(NARRATIVE_EVENTS.filter(e => e.when === 'matchday')))
      if (ev.trigger(s, date, ctx) && this.fire(ev.id, date, { after: 'matchday' })) return true;
    return false;
  }
  /** Starts an event now (also used by DEBUG.EXE). resume = continue the calendar afterwards; after = 'matchday' → matchday dialog. */
  fire(id, date = this.state.calendar.date, { resume = false, cont = false, after = null, cast: preset = null } = {}) {
    const ev = this.find(id);
    if (!ev || this.active) return false;
    // v2.3: a scheduled event may carry its actors from the moment it was planned (if they are still in the squad)
    const keep = preset && Object.values(preset).every(v => [].concat(v).every(pid => this.state.player(pid)));
    const cast = keep ? preset : ev.cast ? ev.cast(this.state) : {};
    if (!cast) return false;
    if (ev.when === 'bond' && cast.kid && cast.b) this.state.clashStart(id, cast.kid, cast.b, date);   // v3.27: cooldowns, counters, causes
    this.state.pendingEvent = { id, date, cast, resume, after, step: 'start', ...(cont ? { cont } : {}) };
    this.state.save();
    this.open();
    return true;
  }
  /** Re-builds the dialogue of the pending event (after a fire, a reload, a language switch or a new STEP). */
  open() {
    const pe = this.state.pendingEvent;
    const ev = pe && this.find(pe.id);
    const cast = {};
    for (const k in pe?.cast || {}) cast[k] = Array.isArray(pe.cast[k]) ? pe.cast[k].map(id => this.state.player(id)) : this.state.player(pe.cast[k]);
    if (!ev || Object.values(cast).some(p => !p || (Array.isArray(p) && p.some(x => !x)))) { this.state.pendingEvent = null; this.state.save(); return; }
    const ctx = { state: this.state, date: pe.date, step: pe.step || 'start', cast, ui: this.ui,
      show: spec => this.view.show(spec),
      schedule: (id, opt) => this.schedule(id, { from: pe.date, by: pe.id, ...opt }) };
    if (String(pe.step || '').startsWith('bq:')) { bondTalkStep(ctx, pe.step.slice(3), 'bq:'); return; }   // v3.25: the free question
    if (TALK.FREE.includes(pe.id) && cast.kid && !pe.freeAsked && (pe.step || 'start') === 'start' && this.state.bonds) {   // v3.25: he came by himself → one free question
      ctx.show = spec => this.view.show({ ...spec, choices: [...spec.choices, { key: 'btalk.free', tone: 'gray',
        next: () => { pe.freeAsked = true; pe.ret = 'start'; pe.talk = { left: 1, free: true }; delete pe.ans; return 'bq:menu'; } }] });
    }
    ev.execute(ctx);
  }
  /** Applies a choice: money, effect, (next step | diary line + log), closes and resumes. */
  choose(choice) {
    const s = this.state, pe = s.pendingEvent;
    if (!pe || (choice.cost && !s.canAfford(choice.cost)) || choice.blocked || (choice.ap && s.ap < choice.ap)) return;
    if (choice.ap) s.weekState().ap -= choice.ap;   // v3.16: [1 AP] options spend from the weekly wallet
    if (choice.ap && this.find(pe.id)?.when === 'bond') s.clashMeta().ap = (s.clashMeta().ap || 0) + choice.ap;   // v3.27 harness: AP on conflicts
    if (choice.cost) s.addMoney(-choice.cost, 'event');   // v3.15: ledger category
    if (choice.gain) s.addMoney(choice.gain, 'event');
    if (choice.debt) s.addMoney(-choice.debt, choice.cat || 'event', true);   // v2.2: forced payment, may go below $0 (v3.22: own ledger category)
    const vars = choice.run?.() || {};
    if (choice.next) {                                 // v2.2 multi-step dialogue: same event, next step
      pe.step = typeof choice.next === 'function' ? choice.next() : choice.next;   // v2.4: a step can be rolled
      s.save();
      this.open();
      return;
    }
    const delta = choice.cost ? -choice.cost : choice.debt ? -choice.debt : choice.gain || 0;
    const key = choice.as || choice.key;   // v3.24: a result step logs / writes the diary of the option that led to it
    s.eventLog.push({ id: pe.id, date: pe.date, season: s.season, choice: key, who: choice.who });   // ('office' is skipped by the cooldown)
    if (s.eventLog.length > 60) s.eventLog.shift();
    s.addDiary({ date: pe.date, key: (choice.diary || key) + '.diary', vars: { ...vars, m: delta ? (delta > 0 ? '+$' : '−$') + Math.abs(delta) : vars.m ?? '' }, cls: 'ev' });
    s.pendingEvent = null;
    // v3.27: a bond event on a training evening leaves the XI alone — ensureAvailableXI would drop the kids who merely skipped
    // today's training (absentToday) for good; the match-day arrival checks the XI anyway. (Older events keep the v3.24 behaviour.)
    if (!(this.find(pe.id)?.when === 'bond' && pe.after !== 'matchday')) s.xiAutoDiary(s.ensureAvailableXI(), pe.date);
    s.save();
    this.view.close();
    this.ui.renderAll();
    if (pe.after === 'matchday') this.ui.afterMatchdayEvent();
    else if (pe.after === 'post') this.ui.afterPostEvent?.(pe);   // v3.27: "It's your fault" → back to the evening windows
    else if (pe.resume && s.phase === 'calendar') this.ui.runCalendar();
    else if (this.find(pe.id)?.when === 'manual') this.ui.afterManualEvent?.();   // v2.6: office / roll call: same day goes on
    else this.ui.morning({ cont: !!pe.cont });   // v2.5: the day loop → the next morning (v3.13: CONTINUE keeps skipping empty days)
  }
}

/** The dialogue box itself. Esc / backdrop clicks never close it: the coach has to choose. */
class DialogueView {
  constructor(ui, engine) {
    this.ui = ui; this.engine = engine;
    this.layer = document.getElementById('talk-layer');
    this.typer = null;
    document.addEventListener('keydown', e => {
      if (this.layer.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); }
      if (this.typer && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopImmediatePropagation(); this.finishTyping(); return; }   // v3.17: skip, never choose
      if (e.key === 'Tab') {
        const f = [...this.layer.querySelectorAll('button:not([disabled])')], i = f.indexOf(document.activeElement);
        e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
      }
    }, true);
    this.layer.addEventListener('click', e => {
      const b = e.target.closest('.talk-btn');
      if (this.typer) { if (e.target.closest('.talk-text')) this.finishTyping(); return; }   // v3.17: no choice until the line is fully typed
      if (b && !b.disabled && this.choices) {   // v3.21 attention: time from the fully typed line to the click
        this.ui.noteChoice('talk', +b.dataset.i, this.options(), this.readyAt ? performance.now() - this.readyAt : null);
        this.engine.choose(this.choices[+b.dataset.i]);
      }
      else if (e.target.closest('.talk-text')) this.finishTyping();
    });
  }
  get isOpen() { return !this.layer.hidden; }

  show({ face, name, role, text, choices }) {
    const s = this.ui.state;
    this.choices = choices;
    this.ui.modal.close(); this.ui.profile.close(); this.ui.debug?.close();
    this.layer.querySelector('#talk-face').innerHTML = face;
    this.layer.querySelector('#talk-name').textContent = name;
    this.layer.querySelector('#talk-role').textContent = role;
    this.layer.querySelector('#talk-budget').innerHTML = L.t('talk.budget', { b: money(s.budget) });
    this.layer.querySelector('#talk-choices').innerHTML = choices.map((c, i) => {
      const noAp = !!c.ap && s.ap < c.ap;   // v3.16: [1 AP] options need the weekly wallet
      const broke = !!c.cost && !s.canAfford(c.cost), short = broke || !!c.blocked || noAp;   // v2.9: `blocked` = i18n key of a non-money reason
      const pay = c.cost || c.debt;   // v2.2: `debt` = forced payment, never disabled, may push the budget below $0
      const tag = (c.ap ? `<span class="tb-ap" title="${esc(L.t('talk.apTip'))}">${L.t('talk.apTag', { n: c.ap })}</span>` : '')
        + (pay ? `<span class="tb-money neg">−$${pay}</span>` : c.gain || c.gainLater ? `<span class="tb-money pos"${c.gainLater ? ` title="${esc(L.t('talk.gainLater'))}"` : ''}>+$${c.gain || c.gainLater}</span>` : '');   // v3.24: gainLater = paid by the family later
      const why = c.blocked ? L.t(c.blocked) : broke ? L.t('talk.short', { b: money(s.budget), c: c.cost }) : noAp ? L.t('talk.noAp') : '';
      return `<button type="button" class="talk-btn tone-${c.tone}${c.ap ? ' has-ap' : ''}" data-i="${i}"${short ? ` data-short="1" disabled aria-disabled="true" title="${esc(why)}"` : ''}>
        <span class="tb-label">${esc(L.t(c.key, c.vars || {}))}</span>${tag}${c.hint ? `<small class="tb-hint">${esc(L.t('clash.hint'))}</small>` : ''}
        ${short ? `<small class="tb-why">${esc(why)}</small>` : ''}</button>`;
    }).join('');
    this.layer.hidden = false;
    this.readyAt = null;
    this.type(text);
    if (!this.typer) this.layer.querySelector('.talk-btn:not([disabled])')?.focus();
    if (this.ui.autoPolicy) { clearTimeout(this.autoT); this.autoT = setTimeout(() => this.autoPick(), 0); }   // v3.21: a scripted coach answers
  }
  /** v3.21: the buttons as policyPick() sees them (greyed = enabled: false). */
  options() {
    const s = this.ui.state;
    return (this.choices || []).map(c => ({ key: c.key, enabled: !((c.cost && !s.canAfford(c.cost)) || c.blocked || (c.ap && s.ap < c.ap)), gain: c.gain || 0, cost: c.cost || 0, ap: c.ap || 0, hint: !!c.hint }));
  }
  /** v3.21: policy runs — the open dialogue is answered through ui.policyPick('talk:<event id>'). */
  autoPick() {
    clearTimeout(this.autoT); this.autoT = null;
    if (!this.ui.autoPolicy || this.layer.hidden || !this.choices) return;
    this.finishTyping();
    const pe = this.ui.state.pendingEvent, i = this.ui.policyPick('talk:' + (pe?.id || '?'), this.options());
    this.engine.choose(this.choices[i]);
  }
  /** v3.17: while the line is typing every choice is disabled (Win98 grey); `data-short` keeps the money / AP / blocked reasons. */
  setWaiting(on) {
    this.layer.classList.toggle('talk-typing', on);
    for (const b of this.layer.querySelectorAll('.talk-btn')) b.disabled = on || b.dataset.short === '1';
    if (!on) this.readyAt = performance.now();   // v3.21 attention: the line is fully on screen
    if (on) this.layer.querySelector('#talk-text').focus?.();
    else if (!this.layer.hidden) this.layer.querySelector('.talk-btn:not([disabled])')?.focus();
  }
  /** Typewriter for the narrative line (click the text to skip; instant with reduced motion). */
  type(text) {
    const el = this.layer.querySelector('#talk-text');
    clearInterval(this.typer);
    this.full = text;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !text) { el.textContent = text; this.typer = null; this.setWaiting(false); return; }
    let n = 0;
    el.textContent = '';
    this.typer = setInterval(() => { n += 2; el.textContent = text.slice(0, n); if (n >= text.length) this.finishTyping(); }, 16);
    this.setWaiting(true);
  }
  finishTyping() {
    const was = !!this.typer;
    clearInterval(this.typer); this.typer = null; this.layer.querySelector('#talk-text').textContent = this.full || '';
    if (was || this.layer.classList.contains('talk-typing')) this.setWaiting(false);
  }
  close() { this.finishTyping(); this.layer.hidden = true; this.choices = null; }
}
