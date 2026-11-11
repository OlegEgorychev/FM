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
      const pool = s.squad.filter(p => p !== snitch && !helped.has(p.id)).sort((a, b) => b.psych.potential - a.psych.potential).slice(0, 6);
      if (!pool.length) return null;
      return { snitch: snitch.id, kid: pick(pool).id };
    },
    execute(ctx) {
      const { snitch, kid } = ctx.cast;
      ctx.show({
        face: snitch.portraitSvg, name: L.name(snitch.name), role: L.t('talk.roleSnitch', { n: snitch.number, p: L.pos(snitch.position) }),
        text: L.t('ev.boots.text', { s: L.name(snitch.name), k: L.name(kid.name) }),
        choices: [
          { key: 'ev.boots.a', tone: 'red', cost: EVENTS_CFG.BOOTS_COST, who: kid.id,
            run: () => { kid.dyn.morale = 100; return { k: { pid: kid.id } }; } },
          { key: 'ev.boots.b', tone: 'gray', who: kid.id,
            run: () => { kid.physical.agility = Math.max(1, kid.physical.agility + EVENTS_CFG.BOOTS_AGILITY); return { k: { pid: kid.id } }; } },
        ],
      });
    },
  },

  /* ---------- 2. RICH KID'S DAD — reported by a parent (silhouette) ---------- */
  {
    id: 'dad', when: 'day',
    trigger: (s) => Math.random() < EVENTS_CFG.DAD_CHANCE && !s.squad.some(p => p.hasFlag('Promised_Start')),
    cast(s) {
      const worst = [...s.squad].sort((a, b) => a.overall - b.overall)[0];   // hidden overall → the weakest kid
      return worst ? { kid: worst.id } : null;
    },
    execute(ctx) {
      const { kid } = ctx.cast;
      ctx.show({
        face: PortraitGenerator.silhouette(), name: L.t('talk.parentName', { s: L.name(kid.surname) }), role: L.t('talk.roleParent'),
        text: L.t('ev.dad.text', { k: L.name(kid.name) }),
        choices: [
          { key: 'ev.dad.a', tone: 'green', gain: EVENTS_CFG.DAD_GIFT, who: kid.id,
            run: () => { if (!kid.hasFlag('Promised_Start')) kid.flags.push('Promised_Start'); return { k: { pid: kid.id } }; } },
          { key: 'ev.dad.b', tone: 'gray', who: kid.id,
            run: () => { kid.dyn.morale = clamp(kid.dyn.morale + EVENTS_CFG.DAD_REFUSE_MORALE, 0, 100); return { k: { pid: kid.id } }; } },
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
      ctx.show({
        face: snitch.portraitSvg, name: L.name(snitch.name), role: L.t('talk.roleSnitch', { n: snitch.number, p: L.pos(snitch.position) }),
        text: L.t('ev.knock.text', { k: L.name(kid.name) }),
        choices: [
          { key: 'ev.knock.a', tone: 'red', cost: EVENTS_CFG.CLINIC_COST, who: kid.id,
            run: () => { kid.injuryDays = EVENTS_CFG.CLINIC_DAYS; return { k: { pid: kid.id }, d: EVENTS_CFG.CLINIC_DAYS }; } },
          { key: 'ev.knock.b', tone: 'gray', who: kid.id,
            run: () => { kid.injuryDays = EVENTS_CFG.ICE_DAYS; return { k: { pid: kid.id }, d: EVENTS_CFG.ICE_DAYS }; } },
        ],
      });
    },
  },

  /* ---------- 5. SHADY SPONSOR — sets up a time bomb ---------- */
  {
    id: 'sponsor', when: 'day',
    trigger: (s) => s.budget < EVENTS_CFG.SPONSOR_BUDGET && Math.random() < EVENTS_CFG.SPONSOR_CHANCE
      && !s.eventQueue.some(q => q.id === 'favor') && !s.eventLog.some(e => e.id === 'sponsor' && e.season === s.season),
    cast: () => ({}),
    execute(ctx) {
      ctx.show({
        face: PortraitGenerator.silhouette('#c9a227'), name: L.t('talk.bizName'), role: L.t('talk.roleBiz'),
        text: L.t('ev.sponsor.text'),
        choices: [
          { key: 'ev.sponsor.a', tone: 'green', gain: EVENTS_CFG.SPONSOR_GIFT,
            run: () => { ctx.schedule('favor', { days: EVENTS_CFG.FAVOR_DAYS, matchDay: true }); return {}; } },
          { key: 'ev.sponsor.b', tone: 'gray', run: () => ({}) },
        ],
      });
    },
  },

  /* ---------- 6. CALLING IN THE FAVOR — only ever fired by the queue (match day, 14+ days after the sponsor) ---------- */
  {
    id: 'favor', when: 'scheduled',
    trigger: () => false,
    cast(s) {   // the three best kids in today's XI (hidden overall)
      const top = s.starters().filter(p => p.available).sort((a, b) => b.overall - a.overall).slice(0, 3);
      return { top: top.map(p => p.id) };
    },
    execute(ctx) {
      const s = ctx.state, top = ctx.cast.top, opp = s.matchContext()?.opp;
      const names = top.map(p => L.name(p.name)).join(', ');
      ctx.show({
        face: PortraitGenerator.silhouette('#c9a227'), name: L.t('talk.bizName'), role: L.t('talk.roleBizBack'),
        text: L.t('ev.favor.text', { o: L.team(opp?.name || '?'), t: names }),
        choices: [
          { key: 'ev.favor.a', tone: 'gray',
            run: () => {
              for (const p of top) if (!p.hasFlag('Benched')) p.flags.push('Benched');   // locked out of THIS match → ensureAvailableXI benches them
              for (const p of s.squad) p.dyn.morale = clamp(p.dyn.morale + EVENTS_CFG.FAVOR_MORALE, 0, 100);
              return { t: names };
            } },
          { key: 'ev.favor.b', tone: 'red', debt: EVENTS_CFG.FAVOR_DEBT,
            run: () => {
              if (s.budget < 0) for (const p of s.squad) p.dyn.morale = clamp(p.dyn.morale + EVENTS_CFG.FAVOR_DEBT_MORALE, 0, 100);
              return { b: money(s.budget) };
            } },
        ],
      });
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
        ] });
    },
  },
];

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
  schedule(id, { days = 0, date = null, matchDay = false, from = this.state.calendar.date, by = null } = {}) {
    const due = date || isoAdd(from, days);
    this.state.eventQueue.push({ id, due, matchDay: !!matchDay, from: by });
    this.state.eventQueue.sort((a, b) => a.due.localeCompare(b.due));
  }
  takeDue(date, matchDay) {
    const q = this.state.eventQueue, i = q.findIndex(x => x.due <= date && !!x.matchDay === matchDay);
    return i < 0 ? null : q.splice(i, 1)[0];
  }

  /** After a NON-match day. Returns true when an event fired (the calendar must pause). */
  roll(date) {
    if (this.active) return false;
    const due = this.takeDue(date, false);
    if (due && this.fire(due.id, date, { resume: true })) return true;
    if (!this.enabled) return false;
    const s = this.state, last = s.eventLog[s.eventLog.length - 1];
    if (last && last.season === s.season && isoDays(last.date, date) < EVENTS_CFG.COOLDOWN) return false;
    for (const ev of shuffle(NARRATIVE_EVENTS.filter(e => (e.when || 'day') === 'day')))
      if (ev.trigger(s, date) && this.fire(ev.id, date, { resume: true })) return true;
    return false;
  }
  /** v2.2: on a MATCH day, before kick-off (called when the calendar stops on the matchday). */
  rollMatchDay(mev) {
    if (this.active) return false;
    const s = this.state, date = mev.date, ctx = s.matchContext();
    const due = this.takeDue(date, true);
    if (due && this.fire(due.id, date, { after: 'matchday' })) return true;
    if (!this.enabled) return false;
    for (const ev of shuffle(NARRATIVE_EVENTS.filter(e => e.when === 'matchday')))
      if (ev.trigger(s, date, ctx) && this.fire(ev.id, date, { after: 'matchday' })) return true;
    return false;
  }
  /** Starts an event now (also used by DEBUG.EXE). resume = continue the calendar afterwards; after = 'matchday' → matchday dialog. */
  fire(id, date = this.state.calendar.date, { resume = false, after = null } = {}) {
    const ev = this.find(id);
    if (!ev || this.active) return false;
    const cast = ev.cast ? ev.cast(this.state) : {};
    if (!cast) return false;
    this.state.pendingEvent = { id, date, cast, resume, after, step: 'start' };
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
    ev.execute({ state: this.state, date: pe.date, step: pe.step || 'start', cast, ui: this.ui,
      show: spec => this.view.show(spec),
      schedule: (id, opt) => this.schedule(id, { from: pe.date, by: pe.id, ...opt }) });
  }
  /** Applies a choice: money, effect, (next step | diary line + log), closes and resumes. */
  choose(choice) {
    const s = this.state, pe = s.pendingEvent;
    if (!pe || (choice.cost && !s.canAfford(choice.cost))) return;
    if (choice.cost) s.addMoney(-choice.cost);
    if (choice.gain) s.addMoney(choice.gain);
    if (choice.debt) s.addMoney(-choice.debt, true);   // v2.2: forced payment, may go below $0
    const vars = choice.run?.() || {};
    if (choice.next) {                                 // v2.2 multi-step dialogue: same event, next step
      pe.step = choice.next;
      s.save();
      this.open();
      return;
    }
    const delta = choice.cost ? -choice.cost : choice.debt ? -choice.debt : choice.gain || 0;
    s.eventLog.push({ id: pe.id, date: pe.date, season: s.season, choice: choice.key, who: choice.who });
    if (s.eventLog.length > 60) s.eventLog.shift();
    s.addDiary({ date: pe.date, key: choice.key + '.diary', vars: { ...vars, m: delta ? (delta > 0 ? '+$' : '−$') + Math.abs(delta) : '' }, cls: 'ev' });
    s.pendingEvent = null;
    for (const c of s.ensureAvailableXI()) s.addDiary({ date: pe.date, key: 'xi.auto', vars: { a: { pid: c.out.id }, b: { pid: c.in.id } }, cls: 'ev' });
    s.save();
    this.view.close();
    this.ui.renderAll();
    if (pe.after === 'matchday') this.ui.afterMatchdayEvent();
    else if (pe.resume && s.phase === 'calendar') this.ui.runCalendar();
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
      if (e.key === 'Tab') {
        const f = [...this.layer.querySelectorAll('button:not([disabled])')], i = f.indexOf(document.activeElement);
        e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
      }
    }, true);
    this.layer.addEventListener('click', e => {
      const b = e.target.closest('.talk-btn');
      if (b && !b.disabled && this.choices) this.engine.choose(this.choices[+b.dataset.i]);
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
      const short = c.cost && !s.canAfford(c.cost);
      const pay = c.cost || c.debt;   // v2.2: `debt` = forced payment, never disabled, may push the budget below $0
      const tag = pay ? `<span class="tb-money neg">−$${pay}</span>` : c.gain ? `<span class="tb-money pos">+$${c.gain}</span>` : '';
      return `<button type="button" class="talk-btn tone-${c.tone}" data-i="${i}"${short ? ' disabled aria-disabled="true"' : ''}>
        <span class="tb-label">${esc(L.t(c.key))}</span>${tag}
        ${short ? `<small class="tb-why">${esc(L.t('talk.short', { b: money(s.budget), c: c.cost }))}</small>` : ''}</button>`;
    }).join('');
    this.type(text);
    this.layer.hidden = false;
    this.layer.querySelector('.talk-btn:not([disabled])')?.focus();
  }
  /** Typewriter for the narrative line (click the text to skip; instant with reduced motion). */
  type(text) {
    const el = this.layer.querySelector('#talk-text');
    clearInterval(this.typer);
    this.full = text;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = text; return; }
    let n = 0;
    el.textContent = '';
    this.typer = setInterval(() => { n += 2; el.textContent = text.slice(0, n); if (n >= text.length) this.finishTyping(); }, 16);
  }
  finishTyping() { clearInterval(this.typer); this.typer = null; this.layer.querySelector('#talk-text').textContent = this.full || ''; }
  close() { this.finishTyping(); this.layer.hidden = true; this.choices = null; }
}
