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
    id: 'boots',
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
    id: 'dad',
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
];

class EventEngine {
  constructor(ui) {
    this.ui = ui;
    this.enabled = true;              // smoke test / debug can switch random events off
    this.view = new DialogueView(ui, this);
  }
  get state() { return this.ui.state; }
  get active() { return !!this.state.pendingEvent; }
  get events() { return NARRATIVE_EVENTS; }
  find(id) { return NARRATIVE_EVENTS.find(e => e.id === id); }

  /** After a non-match day. Returns true when an event fired (the calendar must pause). */
  roll(date) {
    if (!this.enabled || this.active) return false;
    const s = this.state, last = s.eventLog[s.eventLog.length - 1];
    if (last && last.season === s.season && isoDays(last.date, date) < EVENTS_CFG.COOLDOWN) return false;
    for (const ev of shuffle(NARRATIVE_EVENTS)) if (ev.trigger(s, date) && this.fire(ev.id, date, true)) return true;
    return false;
  }
  /** Starts an event now (also used by DEBUG.EXE). resume = continue the calendar simulation afterwards. */
  fire(id, date = this.state.calendar.date, resume = false) {
    const ev = this.find(id);
    if (!ev || this.active) return false;
    const cast = ev.cast(this.state);
    if (!cast) return false;
    this.state.pendingEvent = { id, date, cast, resume };
    this.state.save();
    this.open();
    return true;
  }
  /** Re-builds the dialogue of the pending event (after a fire, a reload or a language switch). */
  open() {
    const pe = this.state.pendingEvent;
    const ev = pe && this.find(pe.id);
    const cast = {};
    for (const k in pe?.cast || {}) cast[k] = this.state.player(pe.cast[k]);
    if (!ev || Object.values(cast).some(p => !p)) { this.state.pendingEvent = null; this.state.save(); return; }
    ev.execute({ state: this.state, date: pe.date, cast, show: spec => this.view.show(spec) });
  }
  /** Applies a choice: money, effect, diary line, log; then closes and (maybe) resumes the calendar. */
  choose(choice) {
    const s = this.state, pe = s.pendingEvent;
    if (!pe || (choice.cost && !s.canAfford(choice.cost))) return;
    if (choice.cost) s.addMoney(-choice.cost);
    if (choice.gain) s.addMoney(choice.gain);
    const vars = choice.run() || {};
    const money = choice.cost ? -choice.cost : choice.gain || 0;
    s.eventLog.push({ id: pe.id, date: pe.date, season: s.season, choice: choice.key, who: choice.who });
    if (s.eventLog.length > 60) s.eventLog.shift();
    s.addDiary({ date: pe.date, key: choice.key + '.diary', vars: { ...vars, m: money ? (money > 0 ? '+$' : '−$') + Math.abs(money) : '' }, cls: 'ev' });
    s.pendingEvent = null;
    s.save();
    this.view.close();
    this.ui.renderAll();
    if (pe.resume && s.phase === 'calendar') this.ui.runCalendar();
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
    this.layer.querySelector('#talk-budget').innerHTML = L.t('talk.budget', { b: s.budget });
    this.layer.querySelector('#talk-choices').innerHTML = choices.map((c, i) => {
      const short = c.cost && !s.canAfford(c.cost);
      const money = c.cost ? `<span class="tb-money neg">−$${c.cost}</span>` : c.gain ? `<span class="tb-money pos">+$${c.gain}</span>` : '';
      return `<button type="button" class="talk-btn tone-${c.tone}" data-i="${i}"${short ? ' disabled aria-disabled="true"' : ''}>
        <span class="tb-label">${esc(L.t(c.key))}</span>${money}
        ${short ? `<small class="tb-why">${esc(L.t('talk.short', { b: s.budget, c: c.cost }))}</small>` : ''}</button>`;
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
