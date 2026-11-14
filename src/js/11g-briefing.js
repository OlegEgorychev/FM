/* =========================================================
   v2.8 — MORNING BRIEFING ("MORNING.EXE", This Is the Police style)
   START DAY → here (date, weather, local news, the three factions) → [ HEAD TO THE CLUB ]
   → Locker Room on training / match days, or back to the quiet Dashboard on rest days.
   Weather and news are seeded by the date, so a reload shows the same morning.
   ========================================================= */
class MorningBriefing {
  static AWAY_MAX = 8;   // v3.13: "while you were away" lines shown (the rest → "+n more")
  static NEWS = ['scouts', 'vandal', 'leader', 'garage', 'pothole', 'mayor', 'rival', 'kitWash', 'derby', 'busStrike', 'chippy', 'floodlight', 'rain'];
  constructor(ui) {
    this.ui = ui;
    this.layer = document.getElementById('morning-briefing-view');
    document.getElementById('mb-go').addEventListener('click', () => this.go());
  }
  get isOpen() { return !this.layer.hidden; }
  get state() { return this.ui.state; }

  /** Seeded weather for a date (autumn in a rainy town). */
  static weather(date) {
    const r = seeded('wx' + date)(), tot = WEATHER_W.reduce((a, b) => a + b, 0);
    let x = r * tot;
    for (let i = 0; i < WEATHER.length; i++) { if ((x -= WEATHER_W[i]) < 0) return WEATHER[i]; }
    return WEATHER[0];
  }
  /** 1–2 seeded flavour headlines, filled with names from the league. */
  news(date) {
    const s = this.state, r = seeded('news' + date), lg = s.league;
    const pool = MorningBriefing.NEWS.filter(id => id !== 'leader' || lg.playedMatchdays() > 0);   // no "league leaders" before a ball is kicked
    const ids = [...pool].sort(() => r() - 0.5).slice(0, r() < 0.55 ? 1 : 2);
    const leader = lg.table()[0]?.team, ctx = s.matchContext(), kid = s.squad[Math.floor(r() * s.squad.length)];
    const rival = lg.teams.filter(t => !t.user)[Math.floor(r() * (lg.teams.length - 1))];
    return ids.map(id => L.t('news.' + id, { t: L.team(leader?.name || ''), k: L.name(kid.name), o: L.team(ctx?.opp.name || rival.name), r: L.team(rival.name) }));
  }

  open() {
    const s = this.state;
    if (this.ui.modalLock) return;   // v3.5
    if (this.ui.events.active) { this.ui.events.open(); return; }
    this.ui.modal.close(); this.ui.profile.close();
    this.render();
    this.layer.hidden = false;
    this.layer.classList.remove('in'); void this.layer.offsetWidth; this.layer.classList.add('in');
    document.getElementById('mb-go').focus();
  }
  close() { this.layer.hidden = true; }

  render() {
    const s = this.state, date = s.calendar.date, wx = MorningBriefing.weather(date), info = this.ui.dayInfo(date);
    const w = s.weekState(), plan = s.phase === 'calendar' && !w.confirmed;   // v3.13: Monday — PLANNER.EXE comes next
    const kind = s.phase === 'matchday' ? 'match' : plan ? 'plan' : info.kind;
    this.layer.dataset.wx = wx;
    document.getElementById('mb-date').textContent = fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('mb-weather').innerHTML = `<span class="wx-ico wx-${wx}"></span>${L.t('wx.' + wx)}`;
    const ctx = s.matchContext();
    let agenda = L.t('mb.agenda.' + kind, { o: L.team(ctx?.opp.name || '') });
    if (kind === 'match' && ctx) {   // v3.4: the opponent lives by the same energy rules — a word from the grapevine
      const c = s.league.oppCondition(ctx.opp, new Set(s.squad.map(p => p.surname)));
      agenda += ' ' + L.t('mb.oppForm', { a: c.avg, t: c.tired });
    }
    document.getElementById('mb-agenda').textContent = agenda;
    // v3.13: Monday — how this week's action points were made up
    const src = w.apSources || {}, apBox = document.getElementById('mb-ap');
    apBox.hidden = !(s.phase === 'calendar' && date === w.start);
    apBox.innerHTML = apBox.hidden ? '' : L.t('mb.ap', { line: MorningBriefing.apLine(src) });
    // v3.13: "while you were away" — the diary lines written since the last briefing (skipped days, evenings)
    let away = s.away || [];
    if (away.length > MorningBriefing.AWAY_MAX) away = away.filter(e => e.key !== 'cal.rest');   // plain rest days go first
    const box = document.getElementById('mb-away-box');
    box.hidden = !away.length;
    document.getElementById('mb-away').innerHTML = away.slice(-MorningBriefing.AWAY_MAX).map(e =>
      `<li><span class="d">${esc(fmtDate(e.date, { weekday: 'short' }))}</span> ${esc(this.ui.entryText({ ...e, r: 0 }))}</li>`).join('')
      + (away.length > MorningBriefing.AWAY_MAX ? `<li class="more">${esc(L.t('mb.awayMore', { n: away.length - MorningBriefing.AWAY_MAX }))}</li>` : '');
    document.getElementById('mb-news').innerHTML = MorningBriefing.worldNews(s, date).map(n => `<li class="mb-world">${esc(n)}</li>`).join('')   // v3.14
      + this.news(date).map(n => `<li>${esc(n)}</li>`).join('');
    const bar = (k) => { const v = s.rep[k];
      return `<div class="rep-row"><span class="rep-name">${L.t('rep.' + k)}</span><div class="rep-bar ${v >= 65 ? 'hi' : v <= 35 ? 'lo' : ''}"><i style="width:${v}%"></i></div><b>${v}</b><small>${L.t('rep.' + k + '.d')}</small></div>`; };
    document.getElementById('mb-rep').innerHTML = ['board', 'parents', 'squad'].map(bar).join('');
    document.getElementById('mb-go').innerHTML = L.t(kind === 'plan' ? 'mb.goPlan' : kind === 'rest' || kind === 'off' ? 'mb.goQuiet' : 'mb.go');
  }

  /** v3.14: Monday news about this week's school / city event — the day(s) and a vague hint, never names. */
  static worldNews(s, date) {
    const e = s.worldEvent;
    if (!e || s.phase !== 'calendar' || date !== e.weekStart) return [];
    return [L.t('world.news.' + e.id, { d: L.t('world.on.' + weekKey(e.days[0])) })];
  }
  /** v3.13: "Base 4 · Carried 1 · Win +1 = 6 AP" */
  static apLine(src) {
    return [L.t('mb.ap.base', { n: src.base ?? 0 }), src.carry ? L.t('mb.ap.carry', { n: src.carry }) : '', src.win ? L.t('mb.ap.win', { n: src.win }) : '']
      .filter(Boolean).join(' · ') + ' = ' + L.t('mb.ap.total', { n: src.total ?? 0 });
  }
  /** [ HEAD TO THE CLUB ] */
  go() {
    const s = this.state;
    s.dayState().briefed = true;
    s.away = null;   // v3.13: the coach has read what happened while he was away
    s.save();
    this.close();
    if (s.phase === 'calendar' && !s.weekState().confirmed) { this.ui.renderAll(); this.ui.planner.open(); return; }   // v3.13: Monday → PLANNER.EXE
    const kind = s.phase === 'matchday' ? 'match' : this.ui.dayInfo(s.calendar.date).kind;
    if (kind === 'training' || kind === 'match') this.ui.locker.open();
    else this.ui.renderAll();
  }
}
