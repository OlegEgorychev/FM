'use strict';

/* =========================================================
   UTILITIES & STATIC DATA
   ========================================================= */
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const jit = r => (Math.random() * 2 - 1) * r;
const pad2 = n => String(n).padStart(2, '0');
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n));   // v2.2: budget can be in debt
const fmt = (tpl, map) => tpl.replace(/\{(\w+)\}/g, (_, k) => map[k] ?? '');

const CLUB_NAME = 'Ashford Rovers U-14';
const SQUAD_POS = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'GK', 'DEF', 'MID', 'MID', 'FWD'];
const POS_ORDER = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
const posRank = p => POS_ORDER[p.position] ?? 9;   // v3.0: untagged kids sort last
const NATURAL_LINE = { GK: 'GK', DEF: 'DEF', MID: 'MID', FWD: 'ATT' };   // player position -> tactical line
const LINE_POS = { GK: 'GK', DEF: 'DEF', MID: 'MID', ATT: 'FWD' };
const LINE_IDX = { DEF: 0, MID: 1, ATT: 2 };
const ZONE_LINE = ['DEF', 'MID', 'ATT'];   // zone index (relative to team in possession) -> line that plays there
/** Seeded PRNG (FNV-1a hash → mulberry32): the same string always rolls the same numbers. Used to migrate old saves. */
const seeded = str => {
  let h = 2166136261; for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
const rndR = (r, a, b) => a + Math.floor(r() * (b - a + 1));

/* =========================================================
   v1.8 PLAYER ATTRIBUTES — classic RPG / manager framework. ALL HIDDEN from the normal UI
   (only DEBUG.EXE shows raw numbers). Skills 1–20, potential = growth room 1–10 (v3.12), dynamic states 0–100.
   ========================================================= */
const ATTR_GROUPS = {
  physical:  ['acceleration', 'speed', 'agility', 'strength', 'baseStamina'],
  technical: ['firstTouch', 'dribbling', 'passing', 'crossing', 'shooting', 'tackling', 'goalkeeping'],
  tactical:  ['positioning', 'vision', 'decisions'],
  psych:     ['passion', 'discipline', 'composure'],          // + psych.potential (v3.12: growth room 1–10 = +points per skill)
};
const SKILL_KEYS = ['physical', 'technical', 'tactical'];     // groups that scale with club strength
/* [min, max] per position (13–15 year olds). Psych is rolled the same for everybody. */
const PROFILES = {
  GK:  { acceleration: [5, 11],  speed: [5, 11],  agility: [9, 16],  strength: [7, 13],  baseStamina: [7, 13],
         firstTouch: [5, 11],  dribbling: [3, 8],   passing: [5, 11],  crossing: [2, 7],   shooting: [2, 6],   tackling: [4, 9],  goalkeeping: [10, 18],
         positioning: [9, 16], vision: [4, 10],  decisions: [7, 14] },
  DEF: { acceleration: [7, 13],  speed: [7, 14],  agility: [6, 12],  strength: [10, 17], baseStamina: [9, 16],
         firstTouch: [6, 12],  dribbling: [5, 10],  passing: [7, 13],  crossing: [5, 11],  shooting: [4, 9],   tackling: [10, 18], goalkeeping: [1, 4],
         positioning: [10, 17], vision: [5, 11], decisions: [7, 14] },
  MID: { acceleration: [8, 14],  speed: [8, 15],  agility: [9, 15],  strength: [7, 13],  baseStamina: [11, 17],
         firstTouch: [9, 16],  dribbling: [8, 15],  passing: [10, 18], crossing: [7, 14],  shooting: [7, 13],  tackling: [7, 14], goalkeeping: [1, 4],
         positioning: [8, 14], vision: [10, 17], decisions: [9, 16] },
  FWD: { acceleration: [11, 18], speed: [10, 18], agility: [10, 16], strength: [7, 14],  baseStamina: [8, 14],
         firstTouch: [9, 16],  dribbling: [10, 17], passing: [7, 13],  crossing: [6, 12],  shooting: [11, 18], tackling: [3, 8],  goalkeeping: [1, 3],
         positioning: [9, 15], vision: [7, 13],  decisions: [7, 13] },
};
/* Engine composites: which raw skills feed each match roll (weights). TECH = hit by low sharpness (−2 each). */
const COMPOSITE = {
  Pass:    { passing: 1, vision: 1 },                         // passer
  Mark:    { positioning: 1, tackling: 2 },                   // defender reading a pass / blocking a shot
  Dribble: { dribbling: 1, agility: 1, firstTouch: 1 },
  Speed:   { acceleration: 1, speed: 1 },
  Tackle:  { tackling: 2, strength: 1, positioning: 1 },      // defender in a 1v1 duel
  Shoot:   { shooting: 2, composure: 1 },
  Save:    { goalkeeping: 2, agility: 1, positioning: 1 },
  Motor:   { baseStamina: 2, acceleration: 1, speed: 1 },     // v3.19: never rolled in a duel — only the Engine role's "fits him" truth (CLUE_SIGNALS.run)
};
const TECH = new Set(ATTR_GROUPS.technical);
/* v1.9 CLUB ECONOMY + NARRATIVE EVENTS */
const ECONOMY = { START: 500 };
const EVENTS_CFG = { COOLDOWN: 6, BOOTS_CHANCE: 0.05, DAD_CHANCE: 0.05, BOOTS_COST: 150, DAD_GIFT: 300, DAD_REFUND: 300,
  DAD_REFUSE_MORALE: -5, PROMISE_BROKEN_MORALE: -30, BOOTS_AGILITY: -2,
  // v3.22 "Money with strings" (test values): the dad's rumour, the promise card at kick-off, the scout's poach, the pool leak
  DAD_RUMOUR_SQUAD: -2, PROMISE_DISPLACED_MORALE: -6, DAD_KEPT_PARENTS: -2, DAD_BROKEN_PARENTS: -3,
  POACH_DAYS: [28, 42], POACH_CHANCE: 0.7, POACH_REFUSE_MORALE: -10, POACH_REFUSE_PARENTS: -2, POACH_TALK_STAY_MORALE: 5,
  POACH_FEE: 150, POACH_LET_PARENTS: 3, POACH_LET_SQUAD: -2,
  POOL_LEAK_CHANCE: 0.5, POOL_LEAK_DAYS: [5, 14], POOL_LEAK_BOARD: -4, POOL_LEAK_PARENTS: -2,
  // v2.2
  BUS_CHANCE: 0.2, BUS_COST: 50, BUS_CONDITION: 0.3,                       // away match days only; jog = condition ×0.7
  KNOCK_CHANCE: 0.04, CLINIC_COST: 200, CLINIC_DAYS: 3, ICE_DAYS: 14,
  // v2.3: the scout (kit money → showcase 14 days later) and the dads' pool (donation → angry dad 14 days later)
  SCOUT_CHANCE: 0.05, SCOUT_GIFT: 500, SCOUT_DAYS: 14, SHOWCASE_MORALE: 10, SHOWCASE_DRAIN: 15, SHOWCASE_INJURY: 0.25, SHOWCASE_DAYS: [3, 8],
  DEBT_MORALE: -20,
  POOL_CHANCE: 0.05, POOL_GIFT: 200, POOL_DAYS: 14, POOL_REFUSE_MORALE: -5, HOME_DAYS: 10, HOME_MORALE: -15, POOL_BROKEN_MORALE: -30,
  ULTI_CHANCE: 0.05, ULTI_DISCIPLINE: 8, ULTI_FINE: 20, ULTI_FINE_MORALE: -10, ULTI_SUSPEND: 2, ULTI_SORRY_DISC: -2, ULTI_SORRY_MORALE: 5,
  RED_BAN: 1, KNOCK_TO_INJURY: 0.35, KNOCK_DAYS: [4, 12],
  // v2.4 The Truant (training days, someone skipped)
  TRUANT_CHANCE: 0.6, TRUANT_FINE: 20, TRUANT_FINE_DISC: 2, TRUANT_BAN_MORALE: -10, TRUANT_SORRY_DISC: 2, TRUANT_HANGUP_MORALE: -10 };
/* Story flags on academy kids (separate from the one-per-kid ROLE tag). Shown as chips, never as numbers. */
const FLAGS = { Promised_Start: { en: ['PROMISED START', 'A parent paid for this kid to start the next match.'],
  ru: ['ОБЕЩАН СТАРТ', 'Родитель заплатил, чтобы этот игрок вышел в старте в следующем матче.'] },
  Showcase: { en: ['SCOUT WATCHING', 'A big-club scout is here for him: he starts and plays the full 90.'],
    ru: ['СМОТРИТ СКАУТ', 'Скаут большого клуба приехал на него: выходит в старте и играет все 90 минут.'] },
  Benched: { en: ['BENCHED (DEAL)', 'You promised a businessman he sits out this match.'],
    ru: ['В ЗАПАСЕ (СДЕЛКА)', 'Ты пообещал бизнесмену, что он пропустит этот матч.'] } };
const SHARPNESS = { RUSTY: 50, RUSTY_PEN: 2, PLAYED: 12, SUB: 6, UNUSED: -2, DAILY: -2, FLOOR: 20 };   // v2.4: rest −2/day, training +5
/* v2.4 TRAINING DAYS — every Tuesday and Thursday (UTC weekday 2 and 4).
   Attend: condition −10, sharpness +5. Skip chance = (SKIP_FROM − discipline) × SKIP_STEP (discipline 1 → 27%, 9 → 3%, 10+ → 0). */
const TRAINING = { WEEKDAYS: [2, 4], DRAIN: 10, SHARP: 5, SKIP_FROM: 10, SKIP_STEP: 0.03 };
/* v2.5 TRAINING REGIMES — the coach picks one every training day (attendees only; skippers get nothing).
   grow: per attendee, chance × growthMult(p) to gain +1 in a random skill of `group` that still has room
   (v3.12: every skill can grow `potential` points above its start, max 20; maxed skills are skipped, so a roll is never wasted). */
const REGIMES = {
  cardio:  { cond: 5,   sharp: 2, morale: -4, grow: { group: 'physical', keys: ['baseStamina', 'acceleration', 'speed'], chance: 0.06 } },
  match:   { cond: -10, sharp: 8, injury: 0.03, injDays: [2, 5] },
  tech:    { cond: -12, sharp: 3, grow: { group: 'technical', chance: 0.12 } },
  tactics: { cond: -5,  sharp: 2, extraSkip: 0.35, lowDisc: 8, grow: { group: 'tactical', chance: 0.12 } },
};
const REGIME_KEYS = Object.keys(REGIMES);
/* v3.12 GROWTH ROOM — psych.potential (HIDDEN) = how many points EVERY skill can still gain above its starting value
   (p.gains counts what each skill already gained; 20 stays the hard max). Rolled independently of current quality
   (late bloomers / early peakers); younger kids get more. growthMult: room 2 → ×0.8, 5 → ×1.1, 8 → ×1.4. */
const GROWTH = { MIN: 1, MAX: 10, DEFAULT: 5, AGE: { 13: 1, 14: 0, 15: -1, 16: -2 } };
const growthRoom = p => clamp(Math.round(p.psych?.potential ?? GROWTH.DEFAULT), GROWTH.MIN, GROWTH.MAX);
const growthMult = p => 0.6 + growthRoom(p) / 10;
/** Can this skill still grow? (room left and below 20) */
const canGrow = (p, g, k) => (p.gains?.[k] || 0) < growthRoom(p) && p[g][k] < 20;
/** Pre-v3.12 saves stored a ceiling: v3.11 = 1–20, older = PA 1–100 (always > 20). Room = ceiling − overall, at least 2. */
const roomFromCeiling = (v, overall) => clamp(Math.round((v > 20 ? clamp(Math.round(6 + v * 0.14), 8, 20) : v) - overall), 2, GROWTH.MAX);
/* v3.12 YARD NOTES (draft cards, replace the old stars): what the coach noticed in one muddy afternoon — only CURRENT
   strengths (never the growth room); a trait shows when its value ≥ SHOW, up to 2 per kid; each note is wrong with WRONG chance. */
const YARD = { SHOW: 14, MAX: 2, WRONG: 0.2,
  TRAITS: { pace: p => p.rating('Speed'), dribble: p => p.rating('Dribble'), pass: p => p.rating('Pass'), shot: p => p.rating('Shoot'),
    tackle: p => p.rating('Tackle'), hands: p => p.rating('Save'), engine: p => p.physical.baseStamina - 1, strong: p => p.physical.strength - 1 },
  /* v3.23: a yard note that maps to a role signal becomes a clue (source 'yard'); pace / strong / hands / quiet have no role signal → no clue. */
  SIGNAL: { pass: 'pass', tackle: 'duel', dribble: 'solo', shot: 'finish', engine: 'run' } };   // raw skills swing more than composites → −1
/* v3.13 WEEKLY PLAN + WEEKLY ACTION POINTS (replaces the v2.5 1 AP/day). All numbers are test values.
   Monday: ap = min(AP_MAX, AP_BASE + carry + WIN_BONUS if the last match was won); carry = min(CARRY_MAX, AP left on Sunday).
   AP pay only for the coach's own actions (office, roll call); trainings are free (0–MAX_TRAININGS, Mon–Fri).
   Sunday review: 0 trainings → Board / Parents EMPTY_*; ≥ HEAVY_FROM trainings → Parents HEAVY_PARENTS.
   v3.21: the k-th empty week in a row (state.week.emptyStreak) → Board / Parents EMPTY_* × k, capped at EMPTY_CAP each;
   any training with at least one kid present resets the streak. */
const WEEK = { AP_BASE: 4, AP_MAX: 7, CARRY_MAX: 2, WIN_BONUS: 1, MAX_TRAININGS: 5, DEFAULT_REGIME: 'match', DEFAULT_DAYS: ['tue', 'thu'],
  WARN_HEAVY: 3, WARN_OVER: 4, EMPTY_BOARD: -2, EMPTY_PARENTS: -2, EMPTY_CAP: -6, HEAVY_FROM: 4, HEAVY_PARENTS: -2,
  KEYS: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], PLAN_KEYS: ['mon', 'tue', 'wed', 'thu', 'fri'] };
/* v3.21 COHESION — one team value 0–100 (state.cohesion), all numbers are TEST values.
   Sunday: C ← clamp(C × DECAY + GAIN × T_eff, 0, 100), T_eff = Σ (kids who trained / squad size) over the week's trainings, ≤ T_CAP.
   Equilibrium ≈ 0 / 40 / 80 / 100 for 0 / 1 / 2 / 3 full trainings; from 50 with empty weeks 35 → 25 → 17 → 12.
   Match: (C − 50) / 50 × MAX (below 50) / × MAX_UP (above 50) on PASS duels only (the passer + receiver side, and the reading / intercepting side) — never shots,
   dribbles, tackles or the keeper. AI clubs: a fixed AI (they train Tue / Thu; their weeks are not simulated).
   Knocks: our kids' in-match knock chance × (1 + max(0, 50 − C) / KNOCK_DIV). BANDS = lower bounds of the band words (no numbers in the UI).
   LOW = the Monday briefing / Match Summary cause line below this value. */
const COH = { START: 50, DECAY: 0.7, GAIN: 12, T_CAP: 3, MAX: 2.0, MAX_UP: 0.7, AI: 60, KNOCK_DIV: 100, LOW: 35,
  BANDS: [{ min: 80, key: 'clock' }, { min: 60, key: 'good' }, { min: 40, key: 'normal' }, { min: 20, key: 'weak' }, { min: 0, key: 'apart' }] };
const cohBand = c => COH.BANDS.find(b => (c ?? COH.START) >= b.min).key;
/** Duel bonus for a side with cohesion c (null / undefined = neutral, so engines built without cohesion are unchanged). */
const cohBonus = c => { if (c == null) return 0; const x = (clamp(c, 0, 100) - 50) / 50; return x * (x < 0 ? COH.MAX : COH.MAX_UP); };
/* v3.21 POLICY HARNESS (ui.autoSim({ policy }), test/policy.js) — how each scripted coach plans his week. */
const POLICY = { NAMES: ['first', 'empty', 'reference', 'overload', 'greedy'],   // v3.22: + greedy (takes every money offer)
  DAYS: { first: [], empty: [], reference: ['tue', 'thu'], overload: ['mon', 'tue', 'wed', 'thu', 'fri'], greedy: ['tue', 'thu'] } };
/* v3.13 ATTENDANCE CURVE — chance to turn up for the k-th training of the week (index 0…4), only from the 3rd one.
   chance = curve[k] + (discipline − 10)/10 × DISC − (energy < TIRED ? TIRED_PEN : 0), clamped MIN–MAX; seeded(date + '#load#' + id). */
const ATTEND_CURVE = [1, 1, 0.7, 0.5, 0.3];
const ATTEND = { FROM: 2, DISC: 0.15, TIRED: 50, TIRED_PEN: 0.15, MIN: 0.05, MAX: 1 };
const attendChance = (p, k) => clamp((ATTEND_CURVE[k] ?? ATTEND_CURVE[ATTEND_CURVE.length - 1]) + ((p.psych?.discipline ?? 10) - 10) / 10 * ATTEND.DISC
  - ((p.energy ?? 100) < ATTEND.TIRED ? ATTEND.TIRED_PEN : 0), ATTEND.MIN, ATTEND.MAX);
const weekKey = iso => WEEK.KEYS[(new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7];
const weekStartOf = iso => isoAdd(iso, -((new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7));
/* v3.0 EXCLUSIVE TEAM DUTIES + SET PIECES */
const DUTIES = { captain: 'C', penalty: 'PK', corner: 'CK' };
/* v3.7 HIDDEN CAPTAIN TRAITS (only DEBUG.EXE shows them; the coach reads them from the Notebook / diary).
   Trait roll (seeded): P(leader) = 0.12 + (composure−10)·0.045 + ((passion+discipline)/2 − 10)·0.03, P(anxious) = 0.12 + (10−composure)·0.06, both 0.03–0.75.
   leader : on top of the armband bonus — after we concede, +RALLY on all our rolls for RALLY_MIN minutes; +POST_MORALE for everyone who played.
   anxious: −STRESS (−composure term) on his OWN rolls while he wears C; after his mistake / a conceded goal / every minute we trail
            a chance to break down in tears (once): −BREAK_MORALE morale, armband bonus lost for the rest of the match.
   normal : the plain v3.0 armband bonus. */
const CAPTAIN_TRAITS = ['leader', 'anxious', 'normal'];
const CAPTAIN = { LEAD_BASE: 0.12, LEAD_COMP: 0.045, LEAD_DRIVE: 0.03, ANX_BASE: 0.12, ANX_COMP: 0.06, TRAIT_MIN: 0.03, TRAIT_MAX: 0.75,
  RALLY: 1, RALLY_MIN: 10, POST_MORALE: 3, CHEER: 0.25,
  STRESS: 1.5, STRESS_COMP: 0.1, BREAK_MISTAKE: 0.08, BREAK_CONCEDE: 0.2, BREAK_TRAIL: 0.006, BREAK_MORALE: 20, NERVES: 0.35, CLUE: 0.4, PRACTICE_CLUE: 0.3 };
/* v3.8 HIDDEN LEADERSHIP (1–20) — the single source of truth for the captain trait:
   ≥ LEADER → 'leader', ≤ ANXIOUS → 'anxious', otherwise 'normal'. Never shown outside DEBUG.EXE.
   Armband reactions (dialogue on assignment) give morale once per REACT_CD days per kid (anti-farming).
   Captain initiatives (locker room, after excuses / position requests): shared INIT_CD-day cooldown, seeded by date + ids.
   Low-leadership captains may ask to hand the armband back (RESIGN_CHANCE by matches worn, +1 step after a loss / breakdown). */
const LEADERSHIP = { LEADER: 14, ANXIOUS: 7,
  REACT_CD: 14, HIGH_MORALE: 5, MID_MORALE: 2, LOW_KEEP_MORALE: -2, STRIP_LEADER: -3, STRIP_ANXIOUS: 2,
  INIT_CD: 7, ADVICE_PAUSE: 14,
  OBS_LEAD: 8, OBS_MIN: 2, OBS_BASE: 0.15, OBS_STEP: 0.04, OBS_MORALE: 3, OBS_RED_DISC: 1, OBS_RED_MORALE: -3,
  BENCH_MIN: 2, BENCH_MORALE: 55, BENCH_BASE: 0.3, BENCH_STEP: 0.05,
  PROMISE_KEPT: 6, PROMISE_KEPT_SQUAD: 2, PROMISE_BROKEN: -10, PROMISE_BROKEN_SQUAD: -3,
  BENCH_WAIT_MORALE: 1, BENCH_RED_DISC: 1, BENCH_RED_KID: -5, BENCH_RED_CAP: -2,
  RESIGN_MIN: 2, RESIGN_CHANCE: [0.25, 0.45, 0.65], RESIGN_YES: 8, RESIGN_HOLD: 2, RESIGN_HOLD_MORALE: -3,
  RESIGN_NO_DISC: 1, RESIGN_NO_MORALE: -10, RESIGN_NO_HOLD: 1, PRESSURE_MULT: 1.5 };
const leadershipTrait = l => l >= LEADERSHIP.LEADER ? 'leader' : l <= LEADERSHIP.ANXIOUS ? 'anxious' : 'normal';
const LEADERSHIP_RANGE = { leader: [14, 20], normal: [8, 13], anxious: [1, 7] };
const SETPIECE = { FOUL: 0.05, PEN_IN_BOX: 0.25, PEN_BONUS: 6, CORNER_SAVE: 0.25, CORNER_BLOCK: 0.3, CORNER_DELIVERY: 3, HEADER_HEIGHT: 6,
  CAPTAIN: 0.5 };   // captain on the pitch: + (0.5 + passion/20) on all our rolls (≈ +0.55 … +1.5)
/* v3.1 SANDBOX WORLD — 100 kids; 40 at rival clubs, 60 free agents; 30 of them play the Yard Match; you sign 15
   (≈ 45 free agents remain for future transfers / poaching). MIX = hidden archetypes in the world. */
const WORLD = { SIZE: 100, RIVALS: 40, DRAFT_POOL: 30, DRAFT_SIGN: 15, MIX: { GK: 12, DEF: 30, MID: 32, FWD: 26 },
  CHANCE: 0.5, WRONG: 0.2 };   // v3.14 world events: weekly chance (never two weeks running), chance one pick is a wrong kid
/* v3.16 INDIVIDUAL LESSONS + [1 AP] EVENT OPTIONS (TEST values). Weekly AP uses: office talk 1, roll call 1, an evening lesson 1
   (reserved in PLANNER.EXE, refunded when re-planned away or cancelled on the day), an event option marked ap: 1.
   LESSON: a weekday evening without team training; one kid + a focus. Growth chance = MULT × the matching regime's base chance
   (FOCUS → REGIMES key) × growthMult; condition COND; with HINT one fog-of-war clue (archetype ↔ leadership, alternating). */
const LESSON = { PER_KID_WEEK: 1, MULT: 2, COND: -5, HINT: 0.4, FOCUS: { physical: 'cardio', technical: 'tech', tactical: 'tactics' } };
const LESSON_FOCI = Object.keys(LESSON.FOCUS);
const AP_OPTION = { TRUANT_DISC: 1, TRUANT_MORALE: 3, BOOTS_MORALE: 5, KNOCK_COST: 35, KNOCK_DAYS: 8 };   // the [1 AP] choices in truant / boots / knock
/* v3.17 "SILENCE": what the morning briefing / "While you were away" / the training report show.
   A line = a diary entry. Its news key = template key + the kids it names (newsKey). A key shown less than COOLDOWN days ago
   is muted in those windows (the diary keeps everything) — unless it matches NEVER_MUTE (event choices, injuries, money,
   reputation, the world event). IMPORTANT lines come first; everything else is routine (a collapsed "Routine (N)" group).
   Prefix match ('rep.' = every rep line); a trailing '.diary' = any event choice. */
const NEWS = {
  COOLDOWN: 14,
  CD_DAYS: 14,   // v3.24: a morning headline (MorningBriefing.NEWS id) is not picked again within this many days (state.newsSeen['hl:' + id])
  IMPORTANT: ['.diary', 'tr.hurt', 'inj.', 'ex.ankleHurt', 'sus.', 'home.back', 'world.', 'fin.', 'fee.lost', 'rep.', 'week.', 'tr.plateau.',
    'tr.improved', 'lesson.improved', 'lesson.cancel', 'lesson.clue', 'obs.', 'scout.', 'cb.', 'xi.auto', 'af.complaint'],
  NEVER_MUTE: ['.diary', 'tr.hurt', 'inj.', 'ex.ankleHurt', 'sus.', 'world.', 'fin.', 'fee.', 'rep.', 'week.', 'af.complaint'],
};
const newsMatch = (key, list) => list.some(x => x[0] === '.' ? key.endsWith(x) : key.startsWith(x));
/** News key of a diary entry: its template key + the ids of the kids it names (sorted), e.g. 'tr.hurt|k12'. */
function newsKey(e) {
  const ids = [];
  const walk = v => { if (!v || typeof v !== 'object') return; if (v.pid) ids.push(v.pid); if (Array.isArray(v.list)) v.list.forEach(walk); else for (const k in v) if (k !== 'pid') walk(v[k]); };
  walk(e.vars);
  return e.key + (ids.length ? '|' + [...new Set(ids)].sort().join(',') : '');
}
/* v3.15 CASH DESK + MONTHLY FEES + FAMILY WEALTH (all TEST values).
   Ledger categories (state.ledger['YYYY-MM'][cat], signed sums). Rent: forced on the 1st (may go below $0 → Board RENT_LATE_BOARD).
   FEES: KASSA.EXE level per month — per kid, payment modifier (pp = added to every chance, mult = by wealth), rep once on confirm.
   PAY: chance to pay at a training by wealth — the fee day (1st training of the month), later reminded / not reminded.
   OFFICE: forgot / told parents → next roll NEXT_CHANCE; HALF_CHANCE for the first half of a two-part payment. */
const LEDGER_CATS = ['fee', 'grant', 'donation', 'rent', 'event'];
const WEALTH = { KEYS: ['rich', 'middle', 'poor'], SHARE: [0.2, 0.6, 0.2] };
const FINANCE = { RENT: 100, RENT_LATE_BOARD: -3,
  FEES: { low: { fee: 5, pp: 0.10, rep: { parents: 2 } }, normal: { fee: 10 }, high: { fee: 15, mult: { poor: 0.6, middle: 0.9 }, rep: { parents: -3 } } },
  FEE_LEVELS: ['low', 'normal', 'high'], DEFAULT_LEVEL: 'normal',
  PAY: { first: { rich: 0.95, middle: 0.80, poor: 0.40 }, reminded: { rich: 1, middle: 0.90, poor: 0.50 }, later: { rich: 0.50, middle: 0.45, poor: 0.25 } },
  NEXT_CHANCE: 0.9, HALF_CHANCE: 1, MIN_TRAININGS: 4, LOW_TRAINING_PAY: 0.5, SPENT_DISC: 7, SPENT_SHARE: 0.5,
  FORGIVE_MORALE: 5, TELL_MORALE: -8, TELL_DISC: 1, TELL_PARENTS: 2, WAIVE_MORALE: 8, WAIVE_SQUAD: 2 };
/** Chance to pay one fee roll: the wealth table for the kind of roll, then the month's level modifier, clamped 0–1. */
const feeChance = (wealth, kind, level) => {
  const L = FINANCE.FEES[level] || FINANCE.FEES.normal, base = (FINANCE.PAY[kind] || FINANCE.PAY.later)[wealth] ?? FINANCE.PAY[kind].middle;
  return clamp(base * (L.mult?.[wealth] ?? 1) + (L.pp || 0), 0, 1);
};
/* v3.14 WORLD EVENTS — school / city events announced in the Monday news. ONE engine (GameState.rollWorldEvent), rows of data:
   a new event = a new row (+ its EN/RU strings: world.news.<id>, world.tip.<id>, lr.short.world:<id>, world.<id>.diary).
   days: 'mon-thu' | 'one' (one of Tue–Thu); pick: { kind: 'all' } | { kind: 'top' | 'bottom', n: number | (eligible) => number, score: (p, eligible) => number };
   effect: { absent: true } (picked kids away that day, not truancy) | { attendMult, condition } (training days: attendance ×, trainees' extra condition). */
const worldRank = (list, f) => { const v = list.map(f).sort((a, b) => a - b); return x => v.indexOf(x) + 1; };   // 1 = lowest
const WORLD_EVENTS = [
  { id: 'tests', tier: 1, days: 'mon-thu', pick: { kind: 'all' }, effect: { attendMult: 0.75, condition: -5 } },
  { id: 'athletics', tier: 2, days: 'one', pick: { kind: 'top', n: 4, score: p => p.physical.speed + p.physical.acceleration }, effect: { absent: true } },
  { id: 'olympiad', tier: 2, days: 'one', pick: { kind: 'top', n: 3, score: p => p.tactical.decisions + p.tactical.vision }, effect: { absent: true } },
  { id: 'basketball', tier: 2, days: 'one', pick: { kind: 'top', n: 3,
    score: (p, all) => worldRank(all, q => q.bio.height)(p.bio.height) + worldRank(all, q => q.physical.agility)(p.physical.agility) }, effect: { absent: true } },
  { id: 'council', tier: 3, days: 'one', pick: { kind: 'bottom', n: all => all.filter(p => p.psych.discipline <= 7).length >= 2 ? 2 : 1, score: p => p.psych.discipline },
    effect: { absent: true } },
];
const COACH = { KICK_PARENTS: -10, KICK_SQUAD: -5, MIN_SQUAD: 12,   // v2.9: kick out (keep ≥ 12 kids and ≥ 1 keeper)
  PRAISE: 12, PRAISE_BACKFIRE: -8, PRAISE_LOW: 50, CRIT_DISC: 2, CRIT_COMP: -1, CRIT_MORALE: -8, CHECK_MORALE: 4 };
/** v2.4 AI clubs' training days (Tue/Thu). v3.13: our club trains on the days of state.week.plan (GameState.isOurTraining). */
const isTrainingDay = iso => TRAINING.WEEKDAYS.includes(new Date(iso + 'T00:00:00Z').getUTCDay());
/* v2.6 LOCKER ROOM — who turns up on training / match days.
   Absent if: condition < MIN_COND, injured / suspended / kept at home, or skips: random·20 > discipline + DISC_GRACE.
   (The brief's raw roll random·20 > discipline would leave ~half the squad at home: DISC_GRACE = 8 → discipline 10 ≈ 10%, 3 ≈ 45%, 12+ never.) */
/* v2.8 FACTION REPUTATION (0–100, start 50) + MORNING ROUTINE */
const REP = { START: 50,
  BOARD_GRANT_BASE: 50, BOARD_GRANT_STEP: 4,          // 1st of the month: $50 + (board − 50) × 4 (board 100 → $250, under ~38 → nothing)
  PARENTS_HIGH: 65, PARENTS_LOW: 30, PARENTS_HOME_DAYS: 3,   // Sundays: happy parents donate, angry parents keep a kid at home
  SQUAD_BONUS: 25,                                    // match rolls for us: (squad − 50) / 25 → −2 … +2
  MATCH: { W: { board: 3, squad: 2 }, D: { board: 0, squad: 0 }, L: { board: -2, squad: -2 } },
  EXCUSE_HOME_PARENTS: 5, EXCUSE_STAY_SQUAD: -5, EXCUSE_STAY_MORALE: -10, EXCUSE_ANKLE_INJURY: 0.3, EXCUSE_ANKLE_DAYS: [3, 6] };
const EXCUSE = { BASE: 0.04, PER_DISC: 0.006,   // per present kid: 4% + (20 − discipline) × 0.6%
  // v3.24: 8 kinds × PHRASES phrasings (ex.<kind>.0–1). Seeded pick (date#excuse#id) among the kinds this kid hasn't used for KID_CD days
  // and the team hasn't heard for TEAM_CD days; the team never hears the same phrasing twice in a row. state.excuseLog keeps LOG_DAYS.
  KINDS: ['test', 'ankle', 'birthday', 'dentist', 'garage', 'wedding', 'play', 'brother'], PHRASES: 2, KID_CD: 28, TEAM_CD: 7 };
const WEATHER = ['heavyRain', 'rain', 'drizzle', 'overcast', 'fog', 'wind', 'clearCold'];
const WEATHER_W = [4, 4, 3, 4, 2, 2, 1];
const LOCKER = { MIN_COND: 25, DISC_GRACE: 8, FINE: 10, FINE_DISC: 2 };
/* v3.6 POSITION DISCOVERY — Practice Match observations + the escalating "out of position" locker request.
   OBSERVE_MAX: kids the coach may mark "Under Observation" (0 AP); unmarked → 1–2 random present kids.
   Request: eligible after MIN straight league matches outside his hidden archetype's line (cooldown 0, at the club);
   chance by streak 3 → 25 %, 4 → 40 %, 5 → 55 %, 6 → 75 %, then +5 % per match, capped at 85 %. One per day, seeded by date + id. */
const POS_HINT = { OBSERVE_MAX: 2, MIN: 3, CHANCE: { 3: 0.25, 4: 0.40, 5: 0.55, 6: 0.75 }, STEP: 0.05, CAP: 0.85,
  COOLDOWN: 2, YES_MORALE: 5, ORDER_MORALE: -8, ORDER_DISC: 1 };
/* v3.18 CLUES — the coach's notes describe an episode instead of naming a role.
   CLUE_SIGNALS: signal → the role it points to (ROLES_DEF id), `attrs` = the engine composites that role multiplies (same hidden truth
   as the ×1.5 and its side effects), `stats` = match counters that show he actually did it (a clue never contradicts the card),
   `min` = how many of them are needed. A new signal = one line here + `clue.<signal>.0…PHRASES-1` texts (EN + RU).
   CLUES: WRONG = chance a clue points to another signal; MAX_PER_KID kept; PHRASES per signal; FIT_TIE = composites this
   close to his best one also count as "true"; TIP = clues in the 📝 tooltip / under the role buttons.
   v3.19: three more rows (run / screen / finish) for the new roles + `lots` = how many of `stats` in one match count as
   "he did a lot of it" (REVIEW.EXE card weights). */
const CLUE_SIGNALS = {
  pass:   { role: 'Playmaker',  attrs: ['Pass'],            stats: ['passOk'],                                      min: 2, lots: 14 },
  duel:   { role: 'Aggressive', attrs: ['Tackle', 'Mark'],  stats: ['tackles', 'intercepts'],                       min: 1, lots: 6 },
  solo:   { role: 'Selfish',    attrs: ['Dribble', 'Shoot'], stats: ['dribbleOk', 'shots'],                          min: 1, lots: 8 },
  run:    { role: 'Engine',     attrs: ['Motor'],           stats: ['passOk', 'tackles', 'intercepts', 'dribbleOk'], min: 8, lots: 26 },
  screen: { role: 'Anchor',     attrs: ['Mark'],            stats: ['intercepts'],                                  min: 1, lots: 4 },
  finish: { role: 'Finisher',   attrs: ['Shoot'],           stats: ['onTarget'],                                    min: 1, lots: 3 },
};
const CLUES = { WRONG: 0.2, MAX_PER_KID: 8, PHRASES: 4, NEUTRAL: 3, FIT_TIE: 0.5, TIP: 3, SOURCES: { match: '\u26BD', training: '\u{1F3C3}', review: '\u2606', voice: '\u{1F5E3}', yard: '\u{1F3DF}' } };   // v3.19 'review'; v3.20 'voice' (AFTER_GAME.EXE)
const KEEPER_NOTE = { ROUGH: 4 };   // v3.18.1: goals let in from which the keeper's day reads as a rough one, whatever his saves
/* v3.18: changing / removing a role that already played a match costs morale (0–100); first assignment and same-week fixes are free.
   v3.19 GROWTH: p.roles = [{ id, level, m }] (m = league matches he played with it since he got it), at most SLOTS, levels 1–LEVELS.
   LEVEL_MULT = the main multiplier by level for a ×1.5 role (level 3 = the v3.18 strength); any other main multiplier
   scales the same way (roleLevelMult). Downsides never scale. Old single role → MIGRATE_LEVEL. */
const ROLES = { CHANGE_MORALE: -3, SLOTS: 2, LEVELS: 3, LEVEL_MULT: [1.2, 1.35, 1.5], MIGRATE_LEVEL: 2 };
/* v3.19 ROLES AS DATA — adding a role = one row + its texts (`role.<id>`, `role.<id>.d`, CLUE_SIGNALS row + `clue.<signal>.*`,
   `clue.like.<signal>`) + (only if it needs a new kind of effect) one engine hook. Numbers are TEST values (test/balance.js --roles).
   boost  = the MAIN effect, scales with the level: attrs × mult (ctx 'box' = only shots that are not long shots) | drain × (energy use)
   down   = downsides, never scale: attrs {composite: ×}, weights {pass|dribble|shoot: ×} in chooseAction, midShotMin (Selfish:
            shoot weight at least this in midfield), noShotPastLine (Anchor: no shot from a zone beyond his line),
            fwdPass (Anchor: × the chance his pass goes forward), foulOnLostDuel (Aggressive)
   signal = CLUE_SIGNALS key = the hidden "fits him" truth (11-notebook-helpers roleFit / trueSignals); clash = can't be held together. */
const ROLES_DEF = [
  { id: 'Aggressive', tone: 'bad',     signal: 'duel',   boost: { attrs: ['Tackle', 'Mark'], mult: 1.5 },  down: { foulOnLostDuel: true },                                  clash: [] },
  { id: 'Playmaker',  tone: 'good',    signal: 'pass',   boost: { attrs: ['Pass'], mult: 1.5 },            down: { weights: { pass: 2, dribble: 0.4 } },                    clash: ['Selfish'] },
  { id: 'Selfish',    tone: 'neutral', signal: 'solo',   boost: { attrs: ['Dribble', 'Shoot'], mult: 1.5 }, down: { weights: { pass: 0.08, dribble: 1.6, shoot: 1.8 }, midShotMin: 22 }, clash: ['Playmaker'] },
  { id: 'Engine',     tone: 'good',    signal: 'run',    boost: { drain: 0.8 },                            down: { attrs: { Dribble: 0.95, Shoot: 0.95 } },                   clash: [] },
  { id: 'Anchor',     tone: 'neutral', signal: 'screen', boost: { attrs: ['Mark'], mult: 1.35 },           down: { noShotPastLine: true, fwdPass: 0.7, weights: { dribble: 0.5 } },       clash: ['Finisher'] },
  { id: 'Finisher',   tone: 'neutral', signal: 'finish', boost: { attrs: ['Shoot'], mult: 1.3, ctx: 'box' }, down: { attrs: { Pass: 0.85, Tackle: 0.85, Mark: 0.85 } },  clash: ['Anchor'] },
];
const ROLE_BY_ID = Object.fromEntries(ROLES_DEF.map(r => [r.id, r]));
const ROLE_IDS = ROLES_DEF.map(r => r.id);
/** Main multiplier at this level: `base` is the level-3 value; LEVEL_MULT [1.2, 1.35, 1.5] → ×1.5 role 1.2 / 1.35 / 1.5, ×0.8 drain 0.92 / 0.86 / 0.8. */
function roleLevelMult(base, level) {
  const LM = ROLES.LEVEL_MULT, top = LM[LM.length - 1], l = LM[clamp(Math.round(level) || 1, 1, LM.length) - 1];
  return 1 + (base - 1) * (l - 1) / (top - 1);
}
/** His roles (academy kids; opponents and world kids have none). */
const rolesOf = p => p?.roles || [];
const roleClash = (a, b) => !!ROLE_BY_ID[a]?.clash.includes(b) || !!ROLE_BY_ID[b]?.clash.includes(a);
/** Engine hook: every role's multiplier on one composite (boost × level, downsides flat; two roles on the same action multiply). */
function roleAttrMult(p, attr, ctx = null) {
  let m = 1;
  for (const r of rolesOf(p)) {
    const d = ROLE_BY_ID[r.id]; if (!d) continue;
    if (d.boost.attrs?.includes(attr) && (!d.boost.ctx || d.boost.ctx === ctx)) m *= roleLevelMult(d.boost.mult, r.level);
    if (d.down.attrs?.[attr]) m *= d.down.attrs[attr];
  }
  return m;
}
/** Engine hook: energy use multiplier (Engine). */
function roleDrainMult(p) { let m = 1; for (const r of rolesOf(p)) { const d = ROLE_BY_ID[r.id]; if (d?.boost.drain) m *= roleLevelMult(d.boost.drain, r.level); } return m; }
const roleHas = (p, flag) => rolesOf(p).some(r => ROLE_BY_ID[r.id]?.down[flag]);
/* v3.19 REVIEW.EXE — the pick after a win (draw: the smaller pick, until v3.20). TEST values.
   CARDS / CARDS_DRAW / CARDS_STREAK (after STREAK_FROM+ losses in a row), LIKE_HINT = chance of the "he lit up" mark (win, first set only),
   BANISH_CLUE = chance a banish also writes a clue, REROLL_AP, SKIP_MORALE, EVIDENCE_W = extra card weight for the signal he showed
   most this match (base 1 each). RATING = man of the match: base + Σ stat × weight (our kids who played; tie → seeded). */
const REVIEW = { CARDS: 3, CARDS_DRAW: 2, CARDS_STREAK: 4, STREAK_FROM: 2, LIKE_HINT: 0.3, BANISH_CLUE: 0.4, REROLL_AP: 1, SKIP_MORALE: 2, EVIDENCE_W: 2,
  RATING: { base: 6, goals: 1, assists: 0.6, onTarget: 0.2, passOk: 0.03, passFail: -0.04, tackles: 0.15, tacklesLost: -0.05, intercepts: 0.12,
    dribbleOk: 0.08, dribbleFail: -0.05, saves: 0.3, conceded: -0.3, yellow: -0.3, red: -1.5 } };
/* v3.20 AFTER_GAME.EXE — "After the game": after a loss the coach hears out kids and parents (3 remark cards, he picks 1);
   after a draw he chooses: praise (the REVIEW draw mode) or listen (1 random remark). TEST values.
   PARENT = chance one of the 3 speakers is a parent. Kids are taken from those involved in key moments (INVOLVE weights on the
   match card: goals let in, shots off target, lost dribbles / duels, cards; ≥ INVOLVE_MIN = involved), then any kid who played.
   Hidden reliability: kid = KID_BASE + (discipline + composure − 20) / 40 × KID_SPREAD, clamped KID_MIN–KID_MAX;
   a parent about his own kid's role PARENT_OWN (pride), about a misfit PARENT_MISFIT. FORCE_REL (tests) overrides every one.
   LISTEN_MORALE for the kid heard; a parent heard → Parents +PARENT_REP; Skip → Squad SKIP_SQUAD.
   A parent's "wrong role" complaint left alone for COMPLAINT_MATCHES matches → Parents COMPLAINT_REP + a briefing line.
   OTHER_MISFIT = chance a kid talking about a teammate who has a role talks about that role; W = type weights (×LOW / ×HIGH by leadership). */
const AFTER = { PARENT: 0.4, SPEAKERS: 3, KID_BASE: 0.7, KID_SPREAD: 0.2, KID_MIN: 0.5, KID_MAX: 0.9, PARENT_OWN: 0.65, PARENT_MISFIT: 0.85,
  FORCE_REL: null, LISTEN_MORALE: 3, PARENT_REP: 1, SKIP_SQUAD: -1, COMPLAINT_MATCHES: 3, COMPLAINT_REP: -2, OTHER_MISFIT: 0.5, PHRASES: 4,
  INVOLVE: { conceded: 1, miss: 1, dribbleFail: 1, tacklesLost: 1, yellow: 2, red: 3 }, INVOLVE_MIN: 2,
  W: { self: 1, other: 1, blame: 1, excuse: 1, low: { other: 2, excuse: 2 }, high: { blame: 3 }, parentOwn: 1, parentCoach: 1, misfitCoach: 2 } };
/* Remark types as data: who says it, what kind of clue it writes, and about whom. */
const AFTER_REMARKS = {
  self:        { speaker: 'kid',    kind: 'role',       about: 'speaker' },
  other:       { speaker: 'kid',    kind: 'role',       about: 'teammate' },   // or 'misfit' when the teammate has a role (OTHER_MISFIT)
  blame:       { speaker: 'kid',    kind: 'leadership', about: 'speaker', claim: 'high' },
  excuse:      { speaker: 'kid',    kind: 'leadership', about: 'speaker', claim: 'low' },
  parentOwn:   { speaker: 'parent', kind: 'role',       about: 'child' },
  parentCoach: { speaker: 'parent', kind: 'misfit',     about: 'child' },
};
/** Hidden reliability of a kid's remark (discipline + composure, 1–20 each). */
const kidReliability = p => clamp(AFTER.KID_BASE + ((p.psych?.discipline ?? 10) + (p.psych?.composure ?? 10) - 20) / 40 * AFTER.KID_SPREAD, AFTER.KID_MIN, AFTER.KID_MAX);
/** How much a kid was in the key moments of the match: his card (goals let in, shots off target, lost balls, lost duels)
    + our cards from matchEvents. */
function afterInvolvement(played, events = []) {
  const I = AFTER.INVOLVE, inv = {};
  for (const [id, st] of played) inv[id] = (st?.conceded || 0) * I.conceded + Math.max(0, (st?.shots || 0) - (st?.onTarget || 0)) * I.miss
    + (st?.dribbleFail || 0) * I.dribbleFail + (st?.tacklesLost || 0) * I.tacklesLost;
  for (const e of events || []) if (e.side === 0 && I[e.type] && e.playerId in inv) inv[e.playerId] += I[e.type];
  return inv;
}
const matchRating = st => { let r = REVIEW.RATING.base; for (const k in REVIEW.RATING) if (k !== 'base') r += (st?.[k] || 0) * REVIEW.RATING[k]; return clamp(r, 1, 10); };
const positionRequestChance = n => n < POS_HINT.MIN ? 0 : POS_HINT.CHANCE[n] ?? Math.min(POS_HINT.CAP, POS_HINT.CHANCE[6] + (n - 6) * POS_HINT.STEP);
const arrivalSkipChance = p => clamp((20 - ((p.psych?.discipline ?? 10) + LOCKER.DISC_GRACE)) / 20, 0, 1);
const skipChance = p => Math.max(0, (TRAINING.SKIP_FROM - (p.psych?.discipline ?? 10)) * TRAINING.SKIP_STEP);
const MORALE = { W: 8, D: 1, L: -6, GOAL: 5, RED: -10, DRIFT_TO: 60 };
/* v3.5 POST-MATCH TEAM TALK ("Coach's Word" in the Match Summary). One forced choice per match, effects by result (W / D / L).
   morale = every kid's dyn.morale (0–100, flat); board / parents / squad = state.rep (0–100);
   disc = +discipline (1–20 scale) for kids below DISC_CAP. "Heavy loss" = lost by HEAVY_LOSS+ goals. */
const TEAM_TALK = {
  KEYS: ['praise', 'tough', 'excuse'],
  HEAVY_LOSS: 2, DISC_CAP: 16,
  SKIP_SQUAD: -1,   // v3.23: the word was owed and never given (Quick Sim without the summary): Squad reputation
  praise: { W: { morale: 6, squad: 2 }, D: { morale: 6, squad: 2 }, L: { morale: 5, squad: 2 }, heavy: { morale: 5, squad: 2, board: -3 } },
  tough:  { W: { morale: -6, disc: 1, board: 2, parents: -3 }, D: { morale: -6, disc: 1, board: 2 }, L: { morale: -5, disc: 1, board: 2 }, heavy: { morale: -5, disc: 2, board: 2 } },
  excuse: { W: { morale: 0, parents: 2, board: -3 }, D: { morale: 3, parents: 2, board: -3 }, L: { morale: 5, parents: 2, board: -3 }, heavy: { morale: 5, parents: 2, board: -4 } },
};
/** v3.5: 'W' | 'D' | 'L' | 'heavy' for a lastReport. */
const talkOutcome = rep => rep.result === 'L' && rep.ga - rep.gf >= TEAM_TALK.HEAVY_LOSS ? 'heavy' : rep.result;
const talkEffects = (key, rep) => (TEAM_TALK[key] && TEAM_TALK[key][talkOutcome(rep)]) || null;
/* Energy economy: matchday drain/rest + daily recovery from the calendar. */
const ENERGY = { TIRED: 50, PLAY_MIN: 30, PLAY_MAX: 40, BENCH_REST: 6, DAILY_REST: 10,   // v2.4: rest days +10 (training days cost 10)
  EXHAUSTED: 30,                        // assistant warning threshold (live energy)
  HT_REST: 4 };                         // half-time rest for everyone on the pitch   // bench +6 on matchday, +4 every rest day
/* v3.3 SIDELINE SHOUTS — flat bonus on OUR attacking rolls (atk: pass, dribble, shot, corner delivery) and on OUR
   defending rolls (def: interception, tackle, block, save). Every duel is "our atk vs their def", so a shout moves the
   goal rate of BOTH teams: Attack = more goals for and against; Defense = fewer of both, and it gives away a little more
   going forward than it gains at the back (the price of safety). v1.x–v3.2 used ±3 both ways (Attack ≈ 2.7× goals,
   Defense ≈ 0.3× → a free "lock the lead" button). Tuned with test/balance.js (Attack vs Defense win share 45–55%). */
const SHOUT = { attack: { atk: 1.0, def: -1.0 }, defend: { atk: -1.05, def: 1.0 }, balanced: { atk: 0, def: 0 } };
/* v3.3 SMOOTH FATIGUE, recalibrated in v3.4 — one continuous, monotonic curve on LIVE energy, x = energy/100:
   m = 1 − K·(1 − x)², K = 0.1  →  100% 1.000 · 75% 0.994 · 50% 0.975 · 25% 0.944 · 0% 0.900.
   The numbers look small on purpose: the duel chain (pass → dribble → shot vs keeper) multiplies every point, so ~1%
   on all stats ≈ 0.2 goals. v3.3 (0.5 + 0.9x − 0.4x², 50% → 0.85) made a half-tired XI concede 2.4 goals more than a
   fresh one; now (test/balance.js, live drain included): start 75% −0.25 · 60% −0.5 · 50% −0.7 · 40% −0.95 · 25% −1.35 goal difference. */
const fatigueMult = energy => { const x = clamp((energy ?? 100) / 100, 0, 1); return 1 - FATIGUE.K * (1 - x) * (1 - x); };
const FATIGUE = { K: 0.1 };
/* v3.4 AI FATIGUE — AI clubs live by the same energy rules and rotate (League.matchXI). RATING: AI-vs-AI Poisson rating per
   unit of mid-match fatigue multiplier (calibrated on the live engine). */
const AI_FATIGUE = { ROTATE_BELOW: 60, ROTATE_GAIN: 15, DESPERATE: 40, TRAIN: -10, RATING: 350 };
const OUT_OF_POSITION = 0.85;   // stat multiplier for a player outside his natural line

/* =========================================================
   FORMATIONS
   Rows go from the back line to the front line. Each row = [line, players].
   ========================================================= */
const FORMATIONS = {
  '4-4-2':   [['DEF', 4], ['MID', 4], ['ATT', 2]],
  '4-3-3':   [['DEF', 4], ['MID', 3], ['ATT', 3]],
  '4-2-3-1': [['DEF', 4], ['MID', 2], ['MID', 3], ['ATT', 1]],
  '3-5-2':   [['DEF', 3], ['MID', 5], ['ATT', 2]],
  '5-3-2':   [['DEF', 5], ['MID', 3], ['ATT', 2]],
  '4-1-4-1': [['DEF', 4], ['MID', 1], ['MID', 4], ['ATT', 1]],
  '4-5-1':   [['DEF', 4], ['MID', 5], ['ATT', 1]],
  '3-4-3':   [['DEF', 3], ['MID', 4], ['ATT', 3]],
  '4-4-1-1': [['DEF', 4], ['MID', 4], ['ATT', 1], ['ATT', 1]],
  '4-3-1-2': [['DEF', 4], ['MID', 3], ['MID', 1], ['ATT', 2]],
};
const FORMATION_KEYS = Object.keys(FORMATIONS);

/** 11 slots: index 0 = GK, then back-to-front, left-to-right. x/y are % of the pitch for a team attacking left->right. */
function formationSlots(f) {
  const rows = FORMATIONS[f] || FORMATIONS['4-4-2'];
  const slots = [{ line: 'GK', x: 5, y: 50 }];
  rows.forEach(([line, n], i) => {
    const x = 18 + i * (28 / (rows.length - 1));
    const span = Math.min(78, 26 * (n - 1));
    for (let k = 0; k < n; k++) slots.push({ line, x, y: n === 1 ? 50 : 50 - span / 2 + k * span / (n - 1) });
  });
  return slots;
}
function lineCounts(f) {
  const c = { DEF: 0, MID: 0, ATT: 0 };
  for (const [line, n] of FORMATIONS[f]) c[line] += n;
  return c;
}
/* "Presence" of a team in a third of the pitch (from that team's point of view).
   Neighbouring lines help a little. Numerical superiority -> roll bonus. */
function presence(c, zone) {
  if (zone === 0) return c.DEF + 0.5 * c.MID;
  if (zone === 1) return c.MID + 0.25 * (c.DEF + c.ATT);
  return c.ATT + 0.5 * c.MID;
}
const SUP_BASE = [2, 0, -2];   // presence difference of 4-4-2 vs 4-4-2 per zone -> normalised to 0
const SUP_SCALE = 0.8;

const FIRST = ['Tommy', 'Jamie', 'Callum', 'Liam', 'Owen', 'Danny', 'Kieran', 'Ryan', 'Connor', 'Ben', 'Josh', 'Lewis', 'Harvey', 'Alfie', 'Reece', 'Sam', 'Mikey', 'Charlie', 'Ethan', 'Jack', 'Nathan', 'Dylan', 'Kai', 'Robbie', 'Elliot', 'Archie', 'Finn', 'Leo', 'Marcus', 'Theo', 'Aaron', 'Jordan'];
const LAST = ['Smith', 'Jones', 'Walsh', 'Doyle', 'Carter', 'Hughes', 'Price', 'Barnes', 'Fletcher', 'Kenny', 'Morgan', 'Reid', 'Shaw', 'Harper', 'Quinn', 'Mason', 'Booth', 'Lowe', 'Dunn', 'Pike', 'Holt', 'Riley', 'Webb', 'Nolan', 'Cobb', 'Finch', 'Rowe', 'Sutton', 'Dale', 'Gill', 'Marsh', 'Platt', 'Varley', 'Ashworth', 'Brennan', 'Tully', 'Kemp', 'Oakes', 'Perry', 'Ward'];
const OPPONENTS = ['Dockside Juniors', "St. Albert's U-14", 'Ironworks Colts', 'Northgate Rangers', 'Millbrook Wanderers', 'Canal Street Youth', 'Fernhill Athletic', 'Gasworks Boys', 'Crossley Athletic'];

