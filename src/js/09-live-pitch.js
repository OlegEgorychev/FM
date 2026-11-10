/* =========================================================
   LIVE PITCH — three layers, strictly separated:
     MatchEngine   → simulation only (events, scores). Knows nothing about pixels.
     PitchModel    → DATA: coordinates, targets, velocities, ball trajectory (in % of the pitch).
     PitchRenderer → RENDER: writes transform: translate3d() on DOM nodes; owns the camera, trails and barks.
   MatchView glues them with one requestAnimationFrame loop (60 FPS).
   Coordinates: x 0 = home goal line, 100 = away goal line; y 0..100 across.
   ========================================================= */

/** Critically damped spring (Unity-style SmoothDamp) on one axis. vel is {v}. */
function smoothDamp(cur, target, vel, smoothTime, maxSpeed, dt) {
  smoothTime = Math.max(0.0001, smoothTime);
  const omega = 2 / smoothTime, x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const maxChange = maxSpeed * smoothTime;
  const change = clamp(cur - target, -maxChange, maxChange);
  const t = cur - change;
  const temp = (vel.v + omega * change) * dt;
  vel.v = (vel.v - omega * temp) * exp;
  let out = t + (change + temp) * exp;
  if ((target - cur > 0) === (out > target)) { out = target; vel.v = 0; }
  return out;
}
const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

class PitchModel {
  constructor() {
    this.ents = new Map();
    this.t = 0;
    this.delay = 900;
    this.lastSeq = -1;
    this.prevKind = null;
    this.shotY = 50;
    this.fx = [];          // effects for the renderer: barks, shake, flash (DATA → RENDER hand-off)
    this.zoomHint = 1;     // camera push-in request (1 = normal)
    this.sentCount = 0;
    this.resetBall();
  }
  resetBall() {
    this.ball = { pos: { x: 50, y: 50 }, vx: { v: 0 }, vy: { v: 0 }, from: { x: 50, y: 50 }, to: { x: 50, y: 50 }, t: 1, dur: 0.1, loft: 0, h: 0, ease: easeInOut, follow: true, hiddenUntil: 0, trail: false, power: false };
  }

  /** sides: [{ entries: [{p, x, y, line}] }]; home = index 0 (attacks to x=100), away mirrored. */
  setup(sides) {
    this.ents.clear();
    this.lastSeq = -1;
    this.prevKind = null;
    this.fx = [];
    this.zoomHint = 1;
    this.sentCount = 0;
    this.resetBall();
    sides.forEach((side, si) => side.entries.forEach((e, idx) => {
      const base = si === 0 ? { x: e.x, y: e.y } : { x: 100 - e.x, y: 100 - e.y };
      const amp = REDUCED_MOTION ? 0.3 : 1;
      this.ents.set(e.p.id, {
        id: e.p.id, p: e.p, side: si, gk: e.line === 'GK', number: e.p.number ?? idx + 1,
        base, pos: { ...base }, vx: { v: 0 }, vy: { v: 0 }, target: { ...base },
        involved: false, smooth: 0.6, sprint: 1, off: false, face: si === 0 ? 0 : Math.PI,
        // personal "idle" rhythm: every kid shuffles differently
        w: { ax: (0.7 + Math.random() * 1.1) * amp, ay: (0.6 + Math.random() * 1.1) * amp,
             fx: 0.45 + Math.random() * 0.6, fy: 0.35 + Math.random() * 0.6, px: Math.random() * 6.28, py: Math.random() * 6.28 },
      });
    }));
  }

  setTempo(delayMs) { this.delay = delayMs; }
  /** Motion speed multiplier: 1 at 1x (900 ms/min), faster at 2x/5x, slightly slow-mo during highlights. */
  get speed() { return clamp(900 / this.delay, 0.75, 5); }

  ent(p) { return p ? this.ents.get(p.id ?? p) : null; }
  attackDir(side) { return side === 0 ? 1 : -1; }

  kick(to, dur, { loft = 0, ease = easeInOut, follow = true, power = false } = {}) {
    const b = this.ball;
    b.from = { ...b.pos }; b.to = { ...to }; b.t = 0; b.dur = Math.max(0.05, dur);
    b.loft = loft; b.ease = ease; b.follow = follow;
    b.power = power; b.trail = power || loft > 0;   // shots and long balls leave a trail
  }

  /** Live substitution: the incoming player inherits the dot (position, slot, motion). */
  substitute(outId, inP) {
    const e = this.ents.get(outId);
    if (!e) return;
    this.ents.delete(outId);
    e.id = inP.id; e.p = inP; e.number = inP.number; e.involved = false;
    this.ents.set(inP.id, e);
    this.fx.push({ type: 'bark', id: inP.id, key: 'bark.sub', cls: 'good', imp: true });
  }

  /** Diegetic effects for one engine event: barks above heads, screen shake, CRT surge. */
  emitFx(ev, eng) {
    const bark = (p, key, cls = '', imp = false) => { if (p) this.fx.push({ type: 'bark', id: p.id ?? p, key, cls, imp }); };
    const keeperOf = side => [...this.ents.values()].find(e => e.gk && e.side === side);
    switch (ev.kind) {
      case 'intercept': bark(ev.d, 'bark.mine', 'good'); if (Math.random() < 0.6) bark(ev.a, 'bark.huh'); break;
      case 'tackle':    bark(ev.d, 'bark.tackle', 'good'); bark(ev.a, 'bark.huh'); break;
      case 'dribble':   if (Math.random() < 0.35) bark(ev.a, 'bark.ole', 'good'); if (Math.random() < 0.4) bark(ev.d, 'bark.huh'); break;
      case 'foul':      bark(ev.a, 'bark.ouch', 'bad', true); bark(ev.d, 'bark.yellow', 'card-y', true); this.fx.push({ type: 'shake' }); break;
      case 'save':      bark(ev.k, 'bark.saved', 'good', true); break;
      case 'block':     bark(ev.d, 'bark.block', 'good'); break;
      case 'wide':      bark(ev.a, 'bark.argh', 'bad'); break;
      case 'goal': {
        bark(ev.a, 'bark.goal', 'goal', true);
        const k = keeperOf(1 - ev.side); if (k) bark(k.id, 'bark.nooo', 'bad', true);
        this.fx.push({ type: 'shake' }, { type: 'flash', tone: 'goal' });
        break;
      }
    }
  }

  /** Where the man on the ball ends up, from the engine's zone (relative to the team in possession). */
  spotFor(eng, e) {
    if (!e) return { x: 50, y: 50 };
    if (e.gk) return { x: eng.poss === 0 ? 7 : 93, y: 50 + jit(5) };
    const zx = [22, 50, 77][eng.zone] + jit(7);
    return { x: eng.poss === 0 ? zx : 100 - zx, y: clamp(e.base.y * 0.65 + 17.5 + jit(6), 7, 93) };
  }

  /** Called once per engine event: sets TARGETS only. Movement itself happens in update(). */
  onEvent(eng) {
    if (!eng || eng.seq === this.lastSeq) return;
    // effects for EVERY event since last time (a foul and a free kick can happen in the same tick)
    for (const rec of eng.evLog || []) if (rec.seq > this.lastSeq) this.emitFx(rec.ev, eng);
    if (eng.sentOff.size > this.sentCount) {   // red card: second yellow
      for (const id of eng.sentOff) if (!this.ents.get(id)?.off) this.fx.push({ type: 'bark', id, key: 'bark.red', cls: 'card-r', imp: true });
      this.fx.push({ type: 'shake' }, { type: 'flash', tone: 'red' });
      this.sentCount = eng.sentOff.size;
    }
    this.lastSeq = eng.seq;
    const ev = eng.ev || {};
    this.zoomHint = ['aim', 'strike', 'goal', 'save', 'wide', 'block'].includes(ev.kind) ? 1.16 : 1;
    const sec = this.delay / 1000;
    const travel = clamp(sec * 0.8, 0.12, 1.6);
    const carrier = this.ent(eng.carrier);
    const b = this.ball;

    // restart after a goal / ball out: the ball "re-spots" (brief fade) instead of flying back across the pitch
    if ((this.prevKind === 'goal' || this.prevKind === 'wide') && ev.kind !== this.prevKind) {
      b.pos = this.prevKind === 'goal' ? { x: 50, y: 50 } : carrier ? { ...carrier.pos } : { x: 50, y: 50 };
      b.hiddenUntil = this.t + 0.25;
    }

    for (const e of this.ents.values()) {
      e.involved = false; e.sprint = 1; e.off = eng.sentOff.has(e.id);
      e.smooth = clamp(sec * 0.75, 0.18, 0.65);
    }

    // 1) where does the ball go?
    let ballTo = this.spotFor(eng, carrier), dur = travel, opts = {};
    const dir = this.attackDir(eng.poss);
    switch (ev.kind) {
      case 'kickoff': case 'halftime':
        ballTo = { x: 50, y: 50 }; dur = 0.5; break;
      case 'pass': {
        const d = dist(b.pos, ballTo);
        if (d > 28) opts.loft = Math.min(1, d / 55);   // long ball: lofted
        dur = travel * clamp(d / 30, 0.6, 1.3); break;
      }
      case 'intercept': {
        const d = this.ent(ev.d);
        ballTo = d ? { x: lerp(b.pos.x, d.pos.x, 0.65), y: lerp(b.pos.y, d.pos.y, 0.65) } : ballTo;
        dur = travel * 0.7; break;
      }
      case 'tackle': {
        const d = this.ent(ev.d);
        ballTo = d ? { x: lerp(b.pos.x, d.pos.x, 0.4), y: lerp(b.pos.y, d.pos.y, 0.4) } : b.pos;
        dur = travel * 0.5; break;
      }
      case 'foul': ballTo = { ...b.pos }; dur = 0.1; break;
      case 'aim':
        ballTo.x = eng.poss === 0 ? Math.max(ballTo.x, eng.zone === 2 ? 72 : 60) : Math.min(ballTo.x, eng.zone === 2 ? 28 : 40);
        dur = travel * 0.8; break;
      case 'strike':
        this.shotY = 43 + Math.random() * 14;
        ballTo = { x: ev.side === 0 ? 96 : 4, y: lerp(b.pos.y, this.shotY, 0.9) };
        dur = 0.3; opts = { ease: easeOut, follow: false, power: true }; break;   // the ball ZIPS
      case 'goal':
        ballTo = { x: ev.side === 0 ? 101.4 : -1.4, y: this.shotY }; dur = 0.16; opts = { ease: easeOut, follow: false, power: true }; break;
      case 'wide': {
        const wy = this.shotY < 50 ? 37 - Math.random() * 6 : 63 + Math.random() * 6;
        ballTo = { x: ev.side === 0 ? 104 : -4, y: wy }; dur = 0.3; opts = { ease: easeOut, follow: false, power: true }; break;
      }
      case 'save': {
        const k = this.ent(ev.k);
        ballTo = { x: k ? (k.side === 0 ? 4 : 96) : b.pos.x, y: this.shotY }; dur = 0.12; opts = { ease: easeOut }; break;
      }
      case 'block': {
        const d = this.ent(ev.d);
        ballTo = d ? { x: lerp(b.pos.x, d.pos.x, 0.8), y: lerp(b.pos.y, d.pos.y, 0.8) } : b.pos; dur = 0.15; break;
      }
    }
    this.kick(ballTo, dur, opts);

    // 2) team shape: whole blocks slide with the ball (attackers push up more than defenders drop), squeeze towards its side
    const bxc = clamp(ballTo.x, 0, 100) - 50;
    const shiftAtt = clamp(bxc * 0.55, -22, 22), shiftDef = clamp(bxc * 0.38, -13, 13);
    for (const e of this.ents.values()) {
      if (e.off) continue;
      if (ev.kind === 'kickoff' || ev.kind === 'halftime') { e.target = { ...e.base }; continue; }
      const inPoss = e.side === eng.poss;
      const shift = inPoss ? shiftAtt : shiftDef;
      if (e.gk) {
        e.target = { x: clamp(e.base.x + shift * 0.15, 2, 98), y: clamp(50 + (ballTo.y - 50) * 0.3, 40, 60) };
        continue;
      }
      const push = (inPoss ? 4 : -3) * this.attackDir(e.side);
      e.target = { x: clamp(e.base.x + shift + push, 7, 93), y: clamp(e.base.y + (ballTo.y - 50) * 0.16, 5, 95) };
    }

    // 3) swarm: nearest defenders press the ball, one team-mate offers support
    const free = [...this.ents.values()].filter(e => !e.off && !e.gk && (!carrier || e.id !== carrier.id));
    const near = side => free.filter(e => e.side === side).sort((a, c) => dist(a.pos, ballTo) - dist(c.pos, ballTo));
    const oppSide = 1 - eng.poss;
    near(oppSide).slice(0, ev.kind === 'aim' ? 3 : 2).forEach((e, i) => {
      const own = this.attackDir(e.side);   // a defender stands goal-side of the ball
      e.target = { x: ballTo.x - own * (2.2 + i * 2.5), y: ballTo.y + (i === 0 ? 1.5 : (i % 2 ? -5 : 5)) };
      e.involved = true; e.sprint = 1.25; e.smooth *= 0.75;
    });
    near(eng.poss).slice(0, 1).forEach(e => {
      e.target = { x: clamp(ballTo.x - dir * 6, 5, 95), y: clamp(ballTo.y + (ballTo.y > 50 ? -11 : 11), 6, 94) };
      e.involved = true;
    });

    // 4) the actors of this event
    if (carrier && !carrier.off && ev.kind !== 'goal' && ev.kind !== 'wide') {
      carrier.target = { x: ballTo.x - dir * 1.3, y: ballTo.y + 0.8 };
      carrier.involved = true; carrier.sprint = 1.3;
      if (ev.kind === 'pass' && b.loft) carrier.smooth = Math.max(carrier.smooth, dur * 0.6);   // arrives with the ball
    }
    const beaten = this.ent(ev.d);
    if (ev.kind === 'dribble' && beaten) { beaten.target = { x: lerp(beaten.pos.x, b.from.x, 0.5), y: lerp(beaten.pos.y, b.from.y, 0.5) }; beaten.involved = true; beaten.sprint = 0.8; }
    if (ev.kind === 'intercept') { const r = this.ent(ev.b); if (r) { r.target = { x: lerp(r.pos.x, ballTo.x, 0.6), y: lerp(r.pos.y, ballTo.y, 0.6) }; r.involved = true; r.sprint = 1.2; } }
    if (ev.kind === 'tackle' || ev.kind === 'foul') { const a = this.ent(ev.a); if (a) { a.target = { x: ballTo.x + dir * 1.5, y: ballTo.y + 2.5 }; a.involved = true; } }
    if (ev.kind === 'foul' && beaten) { beaten.target = { x: ballTo.x - dir * 1, y: ballTo.y - 1.5 }; beaten.involved = true; }

    // keeper behaviour: set position on the aim, DIVE on the strike
    const keeperOf = side => [...this.ents.values()].find(e => e.gk && e.side === side);
    const defKeeper = keeperOf(oppSide);
    if (defKeeper && (ev.kind === 'aim' || ev.kind === 'strike' || ev.kind === 'goal' || ev.kind === 'save')) {
      defKeeper.involved = true;
      const gx = defKeeper.side === 0 ? 4 : 96;
      if (ev.kind === 'aim') { defKeeper.target = { x: gx, y: clamp(50 + (ballTo.y - 50) * 0.45, 42, 58) }; defKeeper.smooth = 0.35; }
      if (ev.kind === 'strike') { defKeeper.target = { x: gx, y: lerp(defKeeper.pos.y, this.shotY, 0.85) }; defKeeper.smooth = 0.13; defKeeper.sprint = 3; }
      if (ev.kind === 'save') { defKeeper.target = { x: gx, y: this.shotY }; defKeeper.smooth = 0.08; defKeeper.sprint = 3; }
      if (ev.kind === 'goal') { defKeeper.target = { x: gx, y: this.shotY + (this.shotY > 50 ? -3.5 : 3.5) }; defKeeper.smooth = 0.1; defKeeper.sprint = 3; }  // dives… too late
    }
    if (ev.kind === 'goal') {   // scorer wheels away to the corner flag
      const s = this.ent(ev.a);
      if (s) { s.target = { x: ev.side === 0 ? 92 : 8, y: this.shotY > 50 ? 92 : 8 }; s.involved = true; s.sprint = 1.4; s.smooth = 0.6; }
    }
    this.prevKind = ev.kind;
  }

  /** Advances DATA by dt seconds (called every animation frame). */
  update(dt, eng) {
    this.t += dt;
    const sp = this.speed;
    for (const e of this.ents.values()) {
      if (e.off) continue;
      const w = e.w, amp = e.involved ? 0.2 : 1;                 // idle micro-movements: nobody stands still
      const gx = e.target.x + Math.sin(this.t * w.fx * Math.min(sp, 2) + w.px) * w.ax * amp;
      const gy = e.target.y + Math.cos(this.t * w.fy * Math.min(sp, 2) + w.py) * w.ay * amp;
      const smooth = e.smooth / Math.sqrt(sp);
      const maxSpeed = 32 * sp * e.sprint;                        // % of pitch per second
      e.pos.x = smoothDamp(e.pos.x, gx, e.vx, smooth, maxSpeed, dt);
      e.pos.y = smoothDamp(e.pos.y, gy, e.vy, smooth, maxSpeed, dt);
      // facing: turn (smoothly, shortest way) towards the ball; y scaled by pitch aspect 68/105
      const want = Math.atan2((this.ball.pos.y - e.pos.y) * 0.648, this.ball.pos.x - e.pos.x);
      let d = want - e.face;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      e.face += d * (1 - Math.exp(-dt * 9));
    }
    const b = this.ball;
    if (b.t < 1) {                                                // ball in flight: explicit trajectory, faster than any player
      b.t = Math.min(1, b.t + dt / b.dur);
      const k = b.ease(b.t);
      b.pos.x = lerp(b.from.x, b.to.x, k);
      b.pos.y = lerp(b.from.y, b.to.y, k);
      b.h = b.loft * Math.sin(Math.PI * b.t);
      b.vx.v = 0; b.vy.v = 0;
    } else {
      b.h = 0;
      const c = eng && !eng.finished && b.follow ? this.ent(eng.carrier) : null;
      if (c && !c.off) {                                          // at the feet of the man on the ball
        const d = this.attackDir(c.side);
        b.pos.x = smoothDamp(b.pos.x, c.pos.x + d * 1.3, b.vx, 0.06, 200, dt);
        b.pos.y = smoothDamp(b.pos.y, c.pos.y + 0.6, b.vy, 0.06, 200, dt);
      }
    }
  }
}

/* RENDER layer. Owns presentation-only state (camera, trail buffer, live bark nodes);
   reads PitchModel data and consumes its fx queue. Writes only transforms/opacity. */
class PitchRenderer {
  static ZOOM = 1.3;          // the world (pitch) is 30% larger than the viewport → room for the camera to pan
  static GHOSTS = 6;
  static MAX_BARKS = 5;

  constructor(viewEl, worldEl, { onShake, onFlash } = {}) {
    this.view = viewEl;
    this.el = worldEl;
    this.onShake = onShake;
    this.onFlash = onFlash;
    this.nodes = new Map();
    this.cam = { x: 0, y: 0, z: 1, init: false };
    this.trail = [];            // recent ball positions (world px)
    this.trailI = 0;            // trail intensity 0..1 (fades out over ~200 ms)
    this.barks = [];
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => { this.measure(); this.cam.init = false; }).observe(viewEl);
  }
  measure() {
    this.vw = this.view.clientWidth; this.vh = this.view.clientHeight;
    this.W = this.el.clientWidth; this.H = this.el.clientHeight;
  }

  build(model) {
    this.el.innerHTML = RadarView.LINES;
    this.nodes.clear();
    this.barks = [];
    for (const e of model.ents.values()) {
      const d = document.createElement('div');
      d.className = `pl ${e.side === 0 ? 'home' : 'away'}${e.gk ? ' gk' : ''}`;
      d.innerHTML = `<i class="face"></i><b>${e.number}</b>`;
      d.title = L.name(e.p.name);
      d.dataset.pid = e.id;     // v1.5: right-click → Player Profile Card
      this.el.appendChild(d);
      this.nodes.set(e.id, { el: d, face: d.firstChild, has: false, off: false, deg: 999 });
    }
    this.ghosts = Array.from({ length: PitchRenderer.GHOSTS }, () => {
      const g = document.createElement('div'); g.className = 'ghost'; this.el.appendChild(g); return g;
    });
    this.shadow = document.createElement('div'); this.shadow.className = 'ball-sh';
    this.ballEl = document.createElement('div'); this.ballEl.className = 'ball';
    this.el.append(this.shadow, this.ballEl);
    this.trail = []; this.trailI = 0; this.power = false; this.ballHidden = false;
    this.cam.init = false;
    this.measure();
  }

  relabel(model) { for (const e of model.ents.values()) { const n = this.nodes.get(e.id); if (n) n.el.title = L.name(e.p.name); } }

  substitute(outId, inP) {
    const n = this.nodes.get(outId);
    if (!n) return;
    this.nodes.delete(outId);
    this.nodes.set(inP.id, n);
    n.el.querySelector('b').textContent = inP.number;
    n.el.title = L.name(inP.name);
    n.el.dataset.pid = inP.id;
    n.el.classList.remove('sub-in'); void n.el.offsetWidth; n.el.classList.add('sub-in');
  }

  draw(model, carrierId, dt) {
    if (!this.W) this.measure();
    const W = this.W, H = this.H;
    if (!W || !this.vw) return;

    // players + facing indicator
    for (const e of model.ents.values()) {
      const n = this.nodes.get(e.id);
      if (!n) continue;
      if (e.off !== n.off) { n.el.classList.toggle('off', e.off); n.off = e.off; }
      if (e.off) continue;
      n.el.style.transform = `translate3d(${(e.pos.x * W / 100).toFixed(1)}px,${(e.pos.y * H / 100).toFixed(1)}px,0)`;
      const deg = e.face * 57.2958;
      if (Math.abs(deg - n.deg) > 0.8) { n.face.style.transform = `rotate(${deg.toFixed(1)}deg)`; n.deg = deg; }
      const has = e.id === carrierId;
      if (has !== n.has) { n.el.classList.toggle('has', has); n.has = has; }
    }

    // ball, shadow, power glow
    const b = model.ball;
    const hidden = model.t < b.hiddenUntil;
    if (hidden !== this.ballHidden) { this.ballEl.classList.toggle('respot', hidden); this.shadow.classList.toggle('respot', hidden); this.ballHidden = hidden; }
    const power = b.power && b.t < 1;
    if (power !== this.power) { this.ballEl.classList.toggle('power', power); this.power = power; }
    const bx = b.pos.x * W / 100, by = b.pos.y * H / 100, lift = b.h * 16;
    this.shadow.style.transform = `translate3d(${bx.toFixed(1)}px,${by.toFixed(1)}px,0) scale(${1 + b.h * 0.4})`;
    this.ballEl.style.transform = `translate3d(${bx.toFixed(1)}px,${(by - lift).toFixed(1)}px,0) scale(${1 + b.h * 0.55})`;

    // trail: fading ghosts at previous ball positions (shots & long balls)
    this.trail.push({ x: bx, y: by - lift });
    if (this.trail.length > PitchRenderer.GHOSTS * 2 + 2) this.trail.shift();
    this.trailI = b.trail && b.t < 1 && !hidden ? 1 : Math.max(0, this.trailI - dt / 0.2);
    for (let i = 0; i < this.ghosts.length; i++) {
      const g = this.ghosts[i], p = this.trail[this.trail.length - 2 - i * 2];
      const op = p ? this.trailI * (0.55 - i * 0.085) : 0;
      if (op <= 0.01) { if (g._v) { g.style.opacity = 0; g._v = false; } continue; }
      g._v = true;
      g.style.opacity = op.toFixed(2);
      g.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0) scale(${(1 - i * 0.12).toFixed(2)})`;
      g.classList.toggle('hot', this.power);
    }

    // camera: lazy lerp towards the ball (+ a little look-ahead), gentle push-in on shots
    const zT = model.zoomHint;
    const look = b.t < 1 ? 0.25 : 0;
    const fx = (lerp(b.pos.x, b.to.x, look) * W) / 100, fy = (lerp(b.pos.y, b.to.y, look) * H) / 100;
    const k = 1 - Math.exp(-dt * (zT > 1 ? 4 : 2.4));
    const z = this.cam.init ? lerp(this.cam.z, zT, 1 - Math.exp(-dt * 2)) : zT;
    let tx = clamp(this.vw / 2 - fx * z, this.vw - W * z, 0);
    let ty = clamp(this.vh / 2 - fy * z, this.vh - H * z, 0);
    if (this.cam.init) { tx = lerp(this.cam.x, tx, k); ty = lerp(this.cam.y, ty, k); }
    this.cam = { x: tx, y: ty, z, init: true };
    this.el.style.transform = `translate3d(${tx.toFixed(1)}px,${ty.toFixed(1)}px,0) scale(${z.toFixed(4)})`;

    // effects queued by the model
    if (model.fx.length) { this.stack = 0; for (const f of model.fx) this.playFx(f, model); model.fx.length = 0; }
  }

  playFx(f, model) {
    if (f.type === 'shake') { this.onShake?.(); return; }
    if (f.type === 'flash') { this.onFlash?.(f.tone); return; }
    if (f.type !== 'bark') return;
    if (model.speed >= 3 && !f.imp) return;               // at 5x only the big moments talk
    const e = model.ents.get(f.id);
    if (!e || e.off) return;
    const d = document.createElement('div');
    d.className = 'bark ' + (f.cls || '');
    d.textContent = L.t(f.key);
    d.style.setProperty('--x', (e.pos.x * this.W / 100).toFixed(1) + 'px');
    d.style.setProperty('--y', (e.pos.y * this.H / 100 - (this.stack++ || 0) * 15).toFixed(1) + 'px');   // same-frame barks stack upwards
    d.addEventListener('animationend', () => { d.remove(); this.barks = this.barks.filter(x => x !== d); }, { once: true });
    this.el.appendChild(d);
    this.barks.push(d);
    while (this.barks.length > PitchRenderer.MAX_BARKS) this.barks.shift().remove();
  }
}

class MatchView {
  constructor(viewEl, worldEl, hooks = {}) {
    this.model = new PitchModel();
    this.renderer = new PitchRenderer(viewEl, worldEl, hooks);
    this.eng = null;
    this.raf = 0;
    this.loop = this.loop.bind(this);
  }
  setup(sides) { this.eng = null; this.model.setup(sides); this.renderer.build(this.model); this.start(); }
  onEngineUpdate(eng) { this.eng = eng; this.model.onEvent(eng); }
  setTempo(delayMs) { this.model.setTempo(delayMs); }
  relabel() { this.renderer.relabel(this.model); }
  substitute(outId, inP) { this.model.substitute(outId, inP); this.renderer.substitute(outId, inP); }
  start() { if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); } }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
  loop(now) {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const t0 = performance.now();
    this.model.update(dt, this.eng);
    if (this.renderer.view.offsetParent) {   // skip DOM writes while the Match window is hidden
      const c = this.eng && !this.eng.finished && this.model.prevKind !== 'goal' ? this.eng.carrier.id : null;
      this.renderer.draw(this.model, c, dt);
    } else this.model.fx.length = 0;          // nobody is watching: drop queued effects
    this.frameCost = (this.frameCost ?? 0) * 0.95 + (performance.now() - t0) * 0.05;   // ms, smoothed (debug)
    this.raf = requestAnimationFrame(this.loop);
  }
}

