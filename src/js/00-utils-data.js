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
const fmt = (tpl, map) => tpl.replace(/\{(\w+)\}/g, (_, k) => map[k] ?? '');

const CLUB_NAME = 'Ashford Rovers U-14';
const SQUAD_POS = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'GK', 'DEF', 'MID', 'MID', 'FWD'];
const POS_ORDER = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
const NATURAL_LINE = { GK: 'GK', DEF: 'DEF', MID: 'MID', FWD: 'ATT' };   // player position -> tactical line
const LINE_POS = { GK: 'GK', DEF: 'DEF', MID: 'MID', ATT: 'FWD' };
const LINE_IDX = { DEF: 0, MID: 1, ATT: 2 };
const ZONE_LINE = ['DEF', 'MID', 'ATT'];   // zone index (relative to team in possession) -> line that plays there
const ATTRS = ['Speed', 'Pass', 'Dribble', 'Shoot', 'Tackle', 'Save'];
const PROFILES = { // [min, max] per hidden attribute, 1-20
  GK:  { Speed: [6, 12],  Pass: [5, 11],  Dribble: [3, 8],   Shoot: [2, 6],   Tackle: [4, 9],   Save: [10, 18] },
  DEF: { Speed: [7, 14],  Pass: [7, 13],  Dribble: [5, 10],  Shoot: [4, 9],   Tackle: [10, 18], Save: [1, 4] },
  MID: { Speed: [8, 15],  Pass: [10, 18], Dribble: [8, 15],  Shoot: [7, 13],  Tackle: [7, 14],  Save: [1, 4] },
  FWD: { Speed: [10, 18], Pass: [7, 13],  Dribble: [10, 17], Shoot: [11, 18], Tackle: [3, 8],   Save: [1, 3] },
};
/* Energy economy: matchday drain/rest + daily recovery from the calendar. */
const ENERGY = { TIRED: 50, PLAY_MIN: 30, PLAY_MAX: 40, BENCH_REST: 6, DAILY_REST: 4,
  EXHAUSTED: 30, EXHAUSTED_MULT: 0.8,   // live: under 30% during the match → stats ×0.8 (v1.1)
  HT_REST: 4 };                         // half-time rest for everyone on the pitch   // bench +6 on matchday, +4 every rest day
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

