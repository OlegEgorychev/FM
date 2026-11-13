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
   (only DEBUG.EXE shows raw numbers). Skills 1–20, potential 1–100, dynamic states 0–100.
   ========================================================= */
const ATTR_GROUPS = {
  physical:  ['acceleration', 'speed', 'agility', 'strength', 'baseStamina'],
  technical: ['firstTouch', 'dribbling', 'passing', 'crossing', 'shooting', 'tackling', 'goalkeeping'],
  tactical:  ['positioning', 'vision', 'decisions'],
  psych:     ['passion', 'discipline', 'composure'],          // + psych.potential (1–100)
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
};
const TECH = new Set(ATTR_GROUPS.technical);
/* v1.9 CLUB ECONOMY + NARRATIVE EVENTS */
const ECONOMY = { START: 500 };
const EVENTS_CFG = { COOLDOWN: 6, BOOTS_CHANCE: 0.05, DAD_CHANCE: 0.05, BOOTS_COST: 150, DAD_GIFT: 300, DAD_REFUND: 150,
  DAD_REFUSE_MORALE: -20, PROMISE_BROKEN_MORALE: -30, BOOTS_AGILITY: -2,
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
   grow: per attendee, chance × (0.6 + potential/100) to gain +1 in a random skill of `group` (capped by potential). */
const REGIMES = {
  cardio:  { cond: 5,   sharp: 2, morale: -4, grow: { group: 'physical', keys: ['baseStamina', 'acceleration', 'speed'], chance: 0.06 } },
  match:   { cond: -10, sharp: 8, injury: 0.03, injDays: [2, 5] },
  tech:    { cond: -12, sharp: 3, grow: { group: 'technical', chance: 0.12 } },
  tactics: { cond: -5,  sharp: 2, extraSkip: 0.35, lowDisc: 8, grow: { group: 'tactical', chance: 0.12 } },
};
const REGIME_KEYS = Object.keys(REGIMES);
const potentialCap = p => clamp(Math.round(6 + (p.psych?.potential ?? 50) * 0.14), 8, 20);   // PA 50 → 13, PA 100 → 20
/* v2.5 COACH ACTION POINTS — reset every morning; "Call into office" costs 1. */
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
const SETPIECE = { FOUL: 0.05, PEN_IN_BOX: 0.25, PEN_BONUS: 6, CORNER_SAVE: 0.25, CORNER_BLOCK: 0.3, CORNER_DELIVERY: 3, HEADER_HEIGHT: 6,
  CAPTAIN: 0.5 };   // captain on the pitch: + (0.5 + passion/20) on all our rolls (≈ +0.55 … +1.5)
/* v3.1 SANDBOX WORLD — 100 kids; 40 at rival clubs, 60 free agents; 30 of them play the Yard Match; you sign 15
   (≈ 45 free agents remain for future transfers / poaching). MIX = hidden archetypes in the world. */
const WORLD = { SIZE: 100, RIVALS: 40, DRAFT_POOL: 30, DRAFT_SIGN: 15, MIX: { GK: 12, DEF: 30, MID: 32, FWD: 26 } };
const COACH = { KICK_PARENTS: -10, KICK_SQUAD: -5, MIN_SQUAD: 12,   // v2.9: kick out (keep ≥ 12 kids and ≥ 1 keeper)
  AP: 1, PRAISE: 12, PRAISE_BACKFIRE: -8, PRAISE_LOW: 50, CRIT_DISC: 2, CRIT_COMP: -1, CRIT_MORALE: -8, CHECK_MORALE: 4 };
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
const EXCUSE = { BASE: 0.04, PER_DISC: 0.006, KINDS: ['test', 'ankle', 'birthday'] };   // per present kid: 4% + (20 − discipline) × 0.6%
const WEATHER = ['heavyRain', 'rain', 'drizzle', 'overcast', 'fog', 'wind', 'clearCold'];
const WEATHER_W = [4, 4, 3, 4, 2, 2, 1];
const LOCKER = { MIN_COND: 25, DISC_GRACE: 8, FINE: 10, FINE_DISC: 2 };
/* v3.6 POSITION DISCOVERY — Practice Match observations + the escalating "out of position" locker request.
   OBSERVE_MAX: kids the coach may mark "Under Observation" (0 AP); unmarked → 1–2 random present kids.
   Request: eligible after MIN straight league matches outside his hidden archetype's line (cooldown 0, at the club);
   chance by streak 3 → 25 %, 4 → 40 %, 5 → 55 %, 6 → 75 %, then +5 % per match, capped at 85 %. One per day, seeded by date + id. */
const POS_HINT = { OBSERVE_MAX: 2, MIN: 3, CHANCE: { 3: 0.25, 4: 0.40, 5: 0.55, 6: 0.75 }, STEP: 0.05, CAP: 0.85,
  COOLDOWN: 2, YES_MORALE: 5, ORDER_MORALE: -8, ORDER_DISC: 1 };
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

