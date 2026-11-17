// Tin Derby in the party room: the race the room is running, on a player's phone or on the big screen.
//
// The room runs the race and its word is final (README.md). This page keeps a copy of it (shared/replica.js):
// it hears every snapshot and event the room sends, and each frame asks the copy for the race as it is now.
//   A player's phone   its own car from behind (round five's chase camera and thumbs). Its own inputs are applied
//                      to the copy at once, so steering answers before the room has heard it; rivals are run on
//                      from the hands the room last relayed for them. With a big screen in the party it can be a
//                      controller only (no picture, big thumbs), and a phone that cannot draw in 3D becomes one.
//   The big screen     where the players race: one pane per player with that player's own chase camera
//                      (split.js); or, the host's choice, the whole table from above (round five's wide camera),
//                      every car, and the places. Without 3D at all: the table as a flat drawing and the places.
//   Anyone else        (a phone that joined in the middle of a race) watches the whole table.
// A phone whose socket dropped gets its car back from the house when it returns; a reload or a reconnect starts
// the copy again from the full snapshot the room sends it. The room's word is checked against the copy at every
// snapshot, and the copy starts again from the snapshot whenever they differ or the page missed something.
//
// The drawing files (art.js, table.js, view.js, sound.js) are round five's; the hands and the strip are its app.js,
// cut down to a race that someone else started.
import { rules } from "../shared/rules.js";
import { makeReplica } from "../shared/replica.js";
import { BTN } from "../shared/house.js";
import { TUNE, LEN, DT, trackAt, segAt, wrapU, wrapS } from "./env.js";
import { CSS, clampN, grainUrl } from "./art.js";
import { World, ChaseRig, TvRig } from "./view.js";
import { Sound } from "./sound.js";
import { Split } from "./split.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
/** A small colour dot: built in code, since the site's Content-Security-Policy refuses style attributes in markup. */
const dot = (colour) => { const i = document.createElement("i"); i.style.setProperty("--c", colour); return i; };
const ORD = ["1st", "2nd", "3rd", "4th"];
/** What the party room's view hands this page on its frame element (party-view.js): you, snapshot, send, now ... */
const host = window.frameElement?.partyHost;
// Test switches (auto, lag, touch): only what the room's view hands over, which it does only where the room has
// its test games on. Never this page's own address, which anyone could add them to.
const params = new URLSearchParams(typeof host?.switches === "string" ? host.switches : "");
const REDUCED_MOTION = (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } })();
// Only once someone has touched this page: before that the browser refuses (and says so in the console).
const buzz = (p) => { try { if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(p); } catch (e) { /* no haptics here */ } };
const finePointer = (() => { try { return matchMedia("(hover: hover) and (pointer: fine)").matches; } catch (e) { return false; } })();
const NAMES = { pawn: "Pawn", ghost: "Ghost", slime: "Slime", robot: "Robot" };
/** How much larger the big screen draws each car on its whole-table picture (view.js, sizeCars). */
const TV_CAR_SIZE = 3;
/** How long a lost WebGL context may take to come back before this phone gives its car to the house. */
const LOST_WAIT_MS = 1500;
/** What this device remembers (the frame shares the site's storage): the big screen's view, a phone's controller-only switch. */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: not remembered */ } },
};
const VIEW_KEY = "tin-derby-big-screen-view"; // "split" or "table"
const PAD_KEY = "tin-derby-controller-only"; // "1" or "0"
/** The camera stand-in on a phone that draws no picture: what the race's events ask of a camera, done to nothing. */
const NO_RIG = { kick: 0, bump() {}, reset() {} };
/** WebGL that draws on the processor, not a graphics card: four pictures a frame would be too slow there. */
const SOFTWARE_GL = /SwiftShader|llvmpipe|softpipe|Software Rasterizer|Basic Render/i;

/** The four characters as small flat drawings (the trait badge). */
function charSvg(id, colour) {
  const N = CSS.navy, st = `stroke="${N}" stroke-width="4" stroke-linejoin="round"`;
  const eye = (x, y, w = 4, h = 6) => `<ellipse cx="${x}" cy="${y}" rx="${w}" ry="${h}" fill="${N}"/>`;
  let b = "";
  if (id === "pawn") b = `<path d="M30 88 Q30 80 36 78 L42 56 Q36 54 38 50 L42 48 Q32 42 32 32 A18 18 0 1 1 68 32 Q68 42 58 48 L62 50 Q64 54 58 56 L64 78 Q70 80 70 88 Z" fill="${colour}" ${st}/>${eye(43, 32)}${eye(57, 32)}`;
  else if (id === "ghost") b = `<path d="M24 80 L24 44 A26 26 0 0 1 76 44 L76 80 Q70 90 63 80 Q56 90 50 80 Q44 90 37 80 Q30 90 24 80 Z" fill="#fff4dc" ${st}/><path d="M24.5 70 L75.5 70 L75.5 80 Q70 90 63 80 Q56 90 50 80 Q44 90 37 80 Q30 90 24.5 80 Z" fill="${colour}"/><path d="M24 80 L24 44 A26 26 0 0 1 76 44 L76 80 Q70 90 63 80 Q56 90 50 80 Q44 90 37 80 Q30 90 24 80 Z" fill="none" ${st}/>${eye(41, 44, 4, 6)}${eye(59, 44, 4, 6)}<ellipse cx="50" cy="57" rx="3.5" ry="4.5" fill="${N}"/>`;
  else if (id === "slime") b = `<path d="M14 84 Q12 74 20 66 Q22 30 50 26 Q78 30 80 66 Q88 74 86 84 Z" fill="${colour}" ${st}/><ellipse cx="36" cy="40" rx="7" ry="3.5" fill="#fff4dc" transform="rotate(-30 36 40)"/>${eye(40, 58, 5, 8)}${eye(60, 58, 5, 8)}`;
  else b = `<line x1="50" y1="10" x2="50" y2="22" ${st}/><circle cx="50" cy="9" r="5" fill="${CSS.mustard}" ${st}/><rect x="26" y="22" width="48" height="32" rx="9" fill="${colour}" ${st}/><rect x="32" y="29" width="36" height="17" rx="5" fill="${N}"/><rect x="38" y="34" width="5" height="7" rx="1" fill="#fff4dc"/><rect x="57" y="34" width="5" height="7" rx="1" fill="#fff4dc"/><rect x="28" y="58" width="44" height="26" rx="8" fill="${colour}" ${st}/><circle cx="50" cy="70" r="5" fill="#fff4dc" ${st}/>`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${b}</svg>`;
}

/** The spring: twelve notches round a brass key. It winds up while you drift and runs down while a boost runs. */
function drawGauge(cv, s) {
  const css = cv.clientWidth || 112, dpr = Math.min(2, window.devicePixelRatio || 1), S = Math.round(css * dpr);
  if (cv.width !== S) { cv.width = S; cv.height = S; }
  const x = cv.getContext("2d");
  x.setTransform(S / 150, 0, 0, S / 150, 0, 0); x.clearRect(0, 0, 150, 150);
  x.lineJoin = "round";
  x.beginPath(); x.arc(75, 75, 71, 0, 7); x.fillStyle = s.boost ? "#fff3d6" : "rgba(253,236,203,0.92)"; x.fill(); x.lineWidth = 3; x.strokeStyle = CSS.navy; x.stroke();
  const total = 12, a0 = Math.PI * 0.75, sweep = Math.PI * 1.5, seg = sweep / total;
  for (let n = 0; n < total; n++) {
    const lit = s.wind >= n + 0.5;
    const b0 = a0 + n * seg + 0.03, b1 = a0 + (n + 1) * seg - 0.03;
    x.beginPath(); x.arc(75, 75, 66, b0, b1); x.arc(75, 75, 51, b1, b0, true); x.closePath();
    x.fillStyle = lit ? (s.boost ? CSS.orange : n >= 6 ? CSS.red : CSS.mustard) : "rgba(36,42,62,0.13)";
    x.fill(); x.lineWidth = 2; x.strokeStyle = CSS.navy; x.stroke();
  }
  x.save(); x.translate(75, 75); x.rotate(s.angle);
  const body = (grow, col) => { x.fillStyle = col; x.beginPath(); for (const cx of [-19, 19]) { x.moveTo(cx + 18 + grow, 0); x.arc(cx, 0, 18 + grow, 0, 7); } x.moveTo(11 + grow, 0); x.arc(0, 0, 11 + grow, 0, 7); x.fill(); };
  body(3.5, CSS.navy); body(0, CSS.mustard);
  for (const cx of [-19, 19]) { x.beginPath(); x.arc(cx, 0, 9.5, 0, 7); x.fillStyle = CSS.navy; x.fill(); x.beginPath(); x.arc(cx, 0, 6.5, 0, 7); x.fillStyle = "#fdeccb"; x.fill(); }
  x.restore();
}
/** The kitchen powers: what each is called on screen, and its little picture (for the Use button and the slot). */
const ITEM_INFO = {
  overwind: { name: "Overwind", say: "Overwind!", how: ["Use: big boost", "E: big boost"] },
  pepper: { name: "Pepper shot", say: "Pepper shot!", how: ["Use: fire at the car ahead", "E: fire at the car ahead"] },
  butter: { name: "Butter pat", say: "Butter pat!", how: ["Use: drop it behind you", "E: drop it behind you"] },
};
function itemSvg(id) {
  const N = CSS.navy, st = `stroke="${N}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
  let b = "";
  if (id === "overwind") b = `<path d="M5 13 L11 9 M4 22 L10 22 M5 31 L11 35" ${st} fill="none"/><circle cx="21" cy="13" r="7" fill="${CSS.mustard}" ${st}/><circle cx="21" cy="31" r="7" fill="${CSS.mustard}" ${st}/><rect x="17" y="19" width="18" height="6" rx="2" fill="${CSS.mustard}" ${st}/><circle cx="21" cy="13" r="2.5" fill="${N}"/><circle cx="21" cy="31" r="2.5" fill="${N}"/>`;
  else if (id === "butter") b = `<ellipse cx="20" cy="29" rx="17" ry="7" fill="#f9c53e" ${st}/><path d="M9 22 L20 16 L31 21 L31 25 L20 31 L9 26 Z" fill="#f9c53e" ${st}/><path d="M9 22 L20 27 L31 21 M20 27 L20 31" ${st} fill="none"/><path d="M14 20 L20 17" stroke="#fdeccb" stroke-width="3" stroke-linecap="round"/>`;
  else b = `<path d="M3 12 L14 15 M2 20 L13 20 M3 28 L14 25" stroke="#8a8d96" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="25" cy="20" r="11" fill="#5a3a30" ${st}/><path d="M18 17 Q25 12 32 18" stroke="#3a2626" stroke-width="2.5" fill="none"/><circle cx="21" cy="15" r="2.6" fill="#a9aaa2"/>`;
  return `<svg viewBox="0 0 40 40" aria-hidden="true">${b}</svg>`;
}
/** The racers' traits, in six words, and a short badge name. */
const TRAIT_INFO = {
  pawn: { badge: "Steady", line: "Barely slowed by bumps" },
  ghost: { badge: "Fades", line: "Fades through a knock, every 8 s" },
  slime: { badge: "Sticky", line: "Spills never slide or spin it" },
  robot: { badge: "Quick charge", line: "Drift boosts charge faster" },
};
const ARROW = (d) => `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="${d < 0 ? "M27 6 L9 20 L27 34 Z" : "M13 6 L31 20 L13 34 Z"}" fill="${CSS.navy}"/></svg>`;
/** Laps in the race shown (a test run's short race has one). */
const lapsIn = (st) => rules.lapsOf(st);
const lapOf = (c, st) => clampN(Math.floor(Math.max(0, c.s) / LEN) + 1, 1, lapsIn(st));
/**
 * Where a car's token sits on a strip's line `lw` px long: its share of the lap, kept whole inside the line, so a
 * finished car's token ends against the line's end mark and never runs over what follows the line (the places).
 * A token is drawn centred on this point (its CSS margin), hence half its width in from each end.
 */
function alongLine(c, lw, tok) {
  const f = c.fin ? 1 : (((c.s % LEN) + LEN) % LEN) / LEN;
  const half = tok.halfW || (tok.halfW = (tok.offsetWidth || 18) / 2); // measured once a layout (App.layout forgets it)
  return half + f * Math.max(0, lw - 2 * half - 3); // 3: the end mark's own width
}

/** One player's overlay and hands: it shows their race and turns what they do into the seat's message. */
class Hands {
  constructor(app, carIndex) {
    this.app = app; this.i = carIndex;
    const h = (this.el = el("div", "hud", `
      <div class="topmid"><div class="strip"><span class="lap"></span><div class="line"></div><span class="place"></span></div>
      <div class="near"><span class="ahead"></span><span class="behind"></span><span class="trait"><i class="tico"></i><b class="tname"></b><small class="tstate"></small></span></div></div>
      <div class="held"><span class="ico"></span><span class="hname"></span></div>
      <div class="gauge"><canvas width="224" height="224"></canvas><span class="cap"></span></div>
      <div class="steerzone"><div class="ring"><i class="knob"></i><span class="lbl">Steer</span></div></div>
      <button class="tb steer sl" type="button" aria-label="Steer left">${ARROW(-1)}</button>
      <button class="tb steer sr" type="button" aria-label="Steer right">${ARROW(1)}</button>
      <button class="tb brake" type="button" aria-label="Brake, hold to back up"><span><b>Brake</b></span></button>
      <button class="tb drift" type="button" aria-label="Drift: hold through a turn, let go to boost"><span><b>Drift</b><small>let go: boost</small></span></button>
      <button class="tb use" type="button" aria-label="Use your power"><span class="ico"></span><b>Use</b></button>
      <div class="slot"><span class="ico"></span><span class="sname"></span><kbd>E</kbd></div>
      <div class="chevs"></div><div class="words"></div>`));
    const q = (s) => h.querySelector(s);
    this.lapEl = q(".lap"); this.lineEl = q(".line"); this.placeEl = q(".place"); this.aheadEl = q(".ahead"); this.behindEl = q(".behind");
    this.cv = q(".gauge canvas"); this.cap = q(".gauge .cap"); this.zone = q(".steerzone"); this.ring = q(".ring"); this.knob = q(".knob");
    this.chevs = q(".chevs"); this.words = q(".words");
    this.useBtn = q(".tb.use"); this.useIco = q(".tb.use .ico"); this.slot = q(".slot"); this.slotIco = q(".slot .ico"); this.slotName = q(".slot .sname");
    this.held = q(".held"); this.heldIco = q(".held .ico"); this.heldName = q(".held .hname");
    this.traitEl = q(".trait"); this.traitIco = q(".tico"); this.traitName = q(".tname"); this.traitState = q(".tstate");
    this.releasers = [];
    this.keys = { left: false, right: false, up: false, down: false, drift: false, use: false };
    this.touch = { left: false, right: false, drift: false, brake: false, use: false };
    this.padPtr = null; this.padSteer = 0; this.memo = {}; this.usePending = false;
    this.everDrifted = false; this.boostMax = 1; this.lastBoost = 0; this.keyA = 0;
    // The thumb pad: put a thumb down anywhere on the left; sliding it sideways steers, as far as the ring.
    this.zone.addEventListener("pointerdown", (e) => {
      if (this.padPtr !== null) return;
      e.preventDefault(); this.app.touchSeen(); this.padPtr = e.pointerId; this.px0 = e.clientX; this.padSteer = 0;
      const r = this.zone.getBoundingClientRect();
      this.ring.style.left = Math.round(e.clientX - r.left) + "px"; this.ring.style.top = Math.round(e.clientY - r.top) + "px"; this.ring.classList.add("on");
      try { this.zone.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
    });
    this.zone.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.padPtr) return;
      const dx = e.clientX - this.px0, R = 48, dead = 5;
      this.padSteer = Math.abs(dx) < dead ? 0 : clampN((dx - Math.sign(dx) * dead) / (R - dead), -1, 1);
      this.knob.style.transform = `translateX(${Math.round(clampN(dx, -R, R))}px)`;
      this.app.handsMoved();
    });
    const padUp = (e) => { if (e.pointerId !== this.padPtr) return; this.padPtr = null; this.padSteer = 0; this.knob.style.transform = ""; this.ring.classList.remove("on"); this.ring.style.left = this.ring.style.top = ""; this.app.handsMoved(); };
    this.zone.addEventListener("pointerup", padUp); this.zone.addEventListener("pointercancel", padUp);
    // Hold buttons: left, right, drift, brake, use. Each follows its own finger, so two thumbs never fight.
    const hold = (sel, key) => {
      const b = q(sel), ptrs = new Set();
      const set = () => { this.touch[key] = ptrs.size > 0; b.classList.toggle("down", ptrs.size > 0); this.app.handsMoved(); };
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); this.app.touchSeen(); ptrs.add(e.pointerId); if (key === "use") this.usePending = true; try { b.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } set(); });
      for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(t, (e) => { ptrs.delete(e.pointerId); set(); });
      this.releasers.push(() => { ptrs.clear(); set(); });
    };
    hold(".tb.sl", "left"); hold(".tb.sr", "right"); hold(".tb.drift", "drift"); hold(".tb.brake", "brake"); hold(".tb.use", "use");
  }
  releaseAll() { this.keys = { left: false, right: false, up: false, down: false, drift: false, use: false }; for (const r of this.releasers) r(); this.padPtr = null; this.padSteer = 0; }
  /** The token on the strip and the chevron for each car, in its colour. */
  paint(cars) {
    this.lineEl.textContent = ""; this.chevs.textContent = "";
    this.toks = cars.map((c, n) => { const t = el("i", "tok" + (n === this.i ? " me" : "")); t.style.setProperty("--c", c.colour); this.lineEl.appendChild(t); return t; });
    this.chev = cars.map((c) => { const ch = el("div", "chev", `<svg viewBox="0 0 44 30"><path d="M5 26 L22 7 L39 26" fill="none" stroke="${CSS.navy}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 26 L22 7 L39 26" fill="none" stroke="${c.colour}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`); this.chevs.appendChild(ch); return ch; });
    this.el.style.setProperty("--seat", cars[this.i].colour);
  }
  /** What the hands say right now, as the rules take it: steer, go, brake, drift, use. */
  reading() {
    const k = this.keys, t = this.touch, touching = this.app.touch;
    let st = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    if (touching) { const b = (t.right ? 1 : 0) - (t.left ? 1 : 0); if (this.padPtr !== null) st = this.padSteer; else if (b) st = b; }
    // On a phone it drives itself forward; on a keyboard, up or W.
    const brake = k.down || t.brake, go = !brake && (k.up || (touching && !k.down));
    // A quick tap of Use (or E) between two frames holds until it has been sent.
    return [st, go ? 1 : 0, brake ? 1 : 0, k.drift || t.drift ? 1 : 0, k.use || t.use || this.usePending ? 1 : 0];
  }
  set(node, key, value) { if (this.memo[key] !== value) { this.memo[key] = value; node.textContent = value; } }
  word(text, cls = "") {
    // A big word clears the board; a small one may sit under the last big one.
    while (this.words.children.length > (cls.includes("small") ? 1 : 0)) this.words.firstChild.remove();
    const w = el("span", "word " + cls); w.textContent = text; this.words.appendChild(w);
    const tilt = (Math.random() * 10 - 5).toFixed(1);
    let anim = null;
    // Reduced motion: the word fades in and out where it stands, with no pop, tilt or drift.
    if (REDUCED_MOTION) try { anim = w.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: cls.includes("small") ? 1300 : 1100 }); } catch (e) { /* shown briefly below */ }
    else try { anim = w.animate([{ transform: `translate(-50%,-50%) scale(0.3) rotate(${-tilt}deg)`, opacity: 0 }, { transform: `translate(-50%,-50%) scale(1.18) rotate(${tilt}deg)`, opacity: 1, offset: 0.16 }, { transform: `translate(-50%,-50%) scale(1) rotate(${tilt}deg)`, opacity: 1, offset: 0.3 }, { transform: `translate(-50%,-58%) scale(1) rotate(${tilt}deg)`, opacity: 1, offset: 0.8 }, { transform: `translate(-50%,-70%) scale(0.9) rotate(${tilt}deg)`, opacity: 0 }], { duration: cls.includes("small") ? 1100 : 950, easing: "ease-out" }); } catch (e) { /* no animation: just show briefly */ }
    if (anim) anim.onfinish = () => w.remove(); else setTimeout(() => w.remove(), 900);
  }
  flashTrait() { const e = this.traitEl; e.classList.remove("flash"); void e.offsetWidth; e.classList.add("flash"); }
  /** Once a frame: the strip, who is near, the spring, the power in hand, the chevrons. */
  draw(state, time, order, racing) {
    const c = state.cars[this.i], place = order.indexOf(c) + 1, T = TUNE;
    this.set(this.lapEl, "lap", c.fin ? "Finished" : `Lap ${lapOf(c, state)} of ${lapsIn(state)}`);
    this.set(this.placeEl, "place", ORD[place - 1]);
    const lw = this.lineW || (this.lineW = this.lineEl.clientWidth || 100);
    for (const o of state.cars) { const px = Math.round(alongLine(o, lw, this.toks[o.i]) * 2) / 2; if (this.memo["tok" + o.i] !== px) { this.memo["tok" + o.i] = px; this.toks[o.i].style.transform = `translateX(${px}px)`; } }
    const near = (node, key, o, word) => {
      const d = o && !c.fin ? Math.abs(o.s - c.s) : -1, text = d >= 0 ? `${o.name} ${d < 9.95 ? d.toFixed(1) : Math.round(d)} ${word}` : "";
      if (this.memo[key] === o?.i + text) return;
      this.memo[key] = o?.i + text;
      node.textContent = text;
      if (text) node.prepend(dot(o.colour));
    };
    near(this.aheadEl, "ahead", order[place - 2], "ahead"); near(this.behindEl, "behind", order[place], "behind");
    // The spring: winding with the drift's charge, running down with a boost.
    if (c.boostT > this.lastBoost + 0.05) this.boostMax = c.boostT;
    this.lastBoost = c.boostT;
    const boosting = c.boostT > 0;
    const wind = boosting ? 12 * clampN(c.boostT / this.boostMax, 0, 1) : c.drOn ? 12 * clampN(c.drT / T.DRIFT_2, 0, 1) : 0;
    this.keyA += boosting ? -0.5 : c.drOn ? 0.25 + 0.15 * c.drLvl : 0;
    const sig = `${wind.toFixed(1)}|${Math.round(this.keyA * 5)}|${boosting}|${this.cv.clientWidth}`;
    if (sig !== this.memo.gauge) { this.memo.gauge = sig; drawGauge(this.cv, { wind, angle: this.keyA, boost: boosting }); }
    let cap = "";
    if (racing && !c.fin) {
      if (c.auto) cap = "House driving";
      else if (c.fallT > 0) cap = "Off the table";
      else if (boosting) cap = c.boostKind === "pad" ? "Wound up!" : c.boostKind === "drift2" ? "Big boost" : "Boost";
      else if (c.drOn) cap = c.drLvl === 2 ? "Let go!" : c.drLvl === 1 ? "Hold..." : "Drift";
    }
    this.set(this.cap, "cap", cap);
    // The power in hand: on the Use button (a phone) or in the slot by the spring (keys). While it unwraps, the
    // pictures flick through; then it settles and the button lights.
    let it = c.item || "";
    if (it && c.itemT > 0) it = TUNE.ITEMS[Math.floor(time * 14) % TUNE.ITEMS.length];
    const ready = !!c.item && !(c.itemT > 0) && racing;
    const sig3 = `${it}|${ready}`;
    if (this.memo.item !== sig3) {
      this.memo.item = sig3;
      const svg = it ? itemSvg(it) : "";
      this.useIco.innerHTML = svg; this.slotIco.innerHTML = svg; this.heldIco.innerHTML = svg;
      this.slotName.textContent = c.item && ready ? ITEM_INFO[c.item].name : c.item ? "..." : "No power";
      this.heldName.textContent = c.item && ready ? ITEM_INFO[c.item].name : "...";
      this.held.classList.toggle("on", !!it); this.held.classList.toggle("ready", ready);
      this.useBtn.classList.toggle("ready", ready); this.useBtn.classList.toggle("empty", !it); this.slot.classList.toggle("ready", ready); this.slot.classList.toggle("empty", !it);
      this.useBtn.setAttribute("aria-label", ready ? `Use your power: ${ITEM_INFO[c.item].name}` : "Use your power (none yet: drive through a sweet)");
    }
    // The racer's trait, as a badge under the strip: the ghost's shows when its fade is ready again.
    const tr = TRAIT_INFO[c.trait] || TRAIT_INFO.pawn;
    const ts = c.trait === "ghost" ? (c.phaseT > 0 ? "fading" : c.phaseCD > 0 ? Math.ceil(c.phaseCD) + " s" : "ready") : "";
    const sig4 = `${c.trait}|${ts}|${c.colour}`;
    if (this.memo.trait !== sig4) {
      this.memo.trait = sig4;
      if (this.memo.traitKind !== c.trait + c.colour) { this.memo.traitKind = c.trait + c.colour; this.traitIco.innerHTML = charSvg(c.trait, c.colour); this.traitName.textContent = tr.badge; this.traitEl.title = tr.line; }
      this.traitState.textContent = ts; this.traitEl.classList.toggle("dim", ts !== "" && ts !== "ready" && ts !== "fading");
    }
    // Cars coming up fast behind: a chevron each.
    for (const o of state.cars) {
      const ch = this.chev[o.i];
      let op = 0, tx = 0, sc = 1;
      if (o !== c && racing && !c.fin) {
        const ds = c.s - o.s, closing = o.v - c.v;
        if (ds > 0.2 && ds < 6 && closing > 0.6) { const close = 1 - clampN((ds - 0.9) / 5, 0, 1); op = 0.45 + 0.55 * close; sc = 0.7 + close; tx = clampN((o.lat - c.lat) * 60, -150, 150); }
      }
      const sig2 = `${op.toFixed(2)}|${Math.round(tx)}|${sc.toFixed(2)}`;
      if (this.memo["ch" + o.i] !== sig2) { this.memo["ch" + o.i] = sig2; ch.style.opacity = op.toFixed(2); ch.style.transform = `translateX(${Math.round(tx)}px) scale(${sc.toFixed(2)})`; }
    }
  }
}

/** The page's own measurements, for the tests and for anyone curious (window.__derby.stats). */
const stats = {
  frames: 0, snapshots: 0, compared: 0, diverged: 0, gaps: 0, restarts: 0, full: 0, sent: 0, beats: 0, late: 0, lateSteps: 0,
  /** What this phone showed of a car at a step, against what the room made of that step: car lengths. */
  ownErr: { n: 0, sum: 0, max: 0 }, rivalErr: { n: 0, sum: 0, max: 0 },
  predictMs: { n: 0, sum: 0, max: 0 },
  /** Frame to frame, in ms (the big screen's frame rate), and what the last frame drew. */
  frameMs: { n: 0, sum: 0, max: 0 }, workMs: { n: 0, sum: 0, max: 0 }, slowFrames: 0, draws: 0, triangles: 0, renderer: "",
};
const tally = (t, v) => { t.n++; t.sum += v; if (v > t.max) t.max = v; };

class App {
  constructor(host) {
    this.host = host;
    this.root = $("app");
    this.you = host.you || { role: "screen", seat: -1 };
    this.seat = this.you.role === "player" ? this.you.seat : null;
    this.lag = Math.max(0, Number(params.get("lag")) || 0);
    this.autoDrive = params.has("auto");
    this.screens = Math.max(0, Number(host.screens) || 0);
    this.start(host.snapshot);
    /** The room's big screen (a phone that joined mid-race is a screen too, but with a seat: it watches the whole table). */
    this.big = this.me < 0 && !(this.you.seat >= 0);
    /** A player's phone in a party with a big screen: its car is on that screen, so this phone may be a controller only. */
    this.padOk = this.me >= 0 && this.screens > 0;
    const cars = this.replica.auth.cars;
    // The picture. Without 3D a phone whose car is on a big screen carries on as a controller, and the big screen
    // shows the table as a flat drawing; anyone else gets the plain card (noPicture, below).
    let world = null;
    try {
      if (!window.THREE) throw new Error("the 3D library did not load");
      world = new World($("gl"), new URL("cloth.jpg", import.meta.url).href, cars.map((c) => ({ character: c.character, colour: c.colour })));
    } catch (err) {
      if (!(this.big || this.padOk)) throw err;
      console.warn(`Tin Derby: no 3D here (${err.message}): ${this.big ? "the table as a flat drawing" : "this phone is a controller; its car is on the big screen"}`);
    }
    this.world = world;
    if (world) {
      world.me = Math.max(0, this.me);
      world.renderer.info.autoReset = false;
      try { const gl = world.renderer.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info"); stats.renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch (e) { /* unknown: taken as a graphics card */ }
    }
    this.mode = this.me >= 0 ? "phone" : !this.big ? "tvwide" : !world ? "board" : this.tvView();
    this.root.dataset.mode = this.mode;
    this.touch = this.mode === "phone" && (!finePointer || params.has("touch"));
    if (this.touch) this.root.dataset.touch = "1";
    this.root.style.setProperty("--inset-r", `${host.inset?.right ?? 0}px`);
    $("grain").style.backgroundImage = `url(${grainUrl()})`;
    this.sound = new Sound();
    this.rig = this.me >= 0 ? (world ? new ChaseRig(this.me) : NO_RIG) : null;
    this.tv = world ? new TvRig() : null;
    if (this.big) {
      const say = { ORD, itemSvg, itemName: (id) => ITEM_INFO[id]?.name || "", items: TUNE.ITEMS, lapText: (c, st) => `Lap ${lapOf(c, st)} of ${lapsIn(st)}`, dot, pepperT: TUNE.PEPPER_T, drift2: TUNE.DRIFT_2 };
      this.split = new Split({ panes: $("panes"), mapbox: $("mapbox"), map: $("map"), standings: $("standings") }, cars, say, { rigs: !!world });
      this.root.dataset.panes = String(this.split.n);
      if (world) {
        $("bview").hidden = false;
        $("bview").addEventListener("click", () => this.setView(this.mode === "split" ? "tvwide" : "split", true));
        this.viewButton();
      }
    }
    if (this.me >= 0) { this.hands = new Hands(this, this.me); $("huds").appendChild(this.hands.el); this.hands.paint(cars); }
    $("padinfo").style.setProperty("--c", this.me >= 0 ? cars[this.me].colour : CSS.red);
    if (this.padOk) {
      // Without 3D the switch is not offered: this phone is a controller, and says so.
      $("bpad").hidden = !world;
      // A press with a finger or the mouse gives the focus back, so Space drifts again; a keyboard user keeps it.
      $("bpad").addEventListener("click", (e) => { this.setPad(!this.pad); if (e.detail > 0) e.currentTarget.blur(); });
      this.setPad(!world || store.get(PAD_KEY) === "1", !world);
    }
    this.tags = cars.map((c) => { const t = el("div", "tag"); t.hidden = true; t.style.setProperty("--c", c.colour); $("tags").appendChild(t); return t; });
    this.padPlace = $("padinfo").querySelector(".pplace"); this.padLap = $("padinfo").querySelector(".plap"); this.padHouse = $("padinfo").querySelector(".phouse");
    this.tvToks = cars.map((c) => { const t = el("i", "tok"); t.style.setProperty("--c", c.colour); $("tvline").appendChild(t); return t; });
    this.order = []; this.frames = []; this.scale = 1; this.slow = 0; this.fast = 0; this.time = 0; this.lastT = -Infinity; this.countShown = 9;
    this.shown = new Map(); // what this phone showed of each car, by step, to compare with the room's word
    this.bind();
    this.layout();
    try {
      const watch = new ResizeObserver(() => this.layout());
      watch.observe($("stage"));
      // The strip and chips change height as the chips come and go (and wrap on a narrow phone): names stay below them.
      if (this.hands) watch.observe(this.hands.el.querySelector(".topmid"));
    } catch (e) { window.addEventListener("resize", () => this.layout()); }
    host.on("events", (list) => this.heard(list));
    host.on("snapshot", (s, at, full) => this.snapshot(s, full));
    host.dispose = () => this.dispose();
    host.ready();
    // If the picture goes (the browser took the WebGL context back) and does not come back, this phone cannot race:
    // the house drives its car. three.js asks for the context back; a short wait gives it the chance.
    const gl = $("gl");
    gl.addEventListener("webglcontextlost", () => { clearTimeout(this.lostT); this.lostT = setTimeout(() => this.cannotDraw(), LOST_WAIT_MS); });
    gl.addEventListener("webglcontextrestored", () => clearTimeout(this.lostT));
    // The first word: the room drove this car while the page loaded, and hands it back now. Then a beat whenever
    // there is nothing else to say, so a phone that stalls without closing its socket is noticed (README, "In the party room").
    this.speak(host.now());
    stats.upAt = +((host.now() - this.replica.auth.startAt) / 1000 - TUNE.COUNT_IN).toFixed(2); // race time the page was up and said so
    this.beatT = setInterval(() => { if (!document.hidden) this.speak(this.host.now()); }, 100);
    this.loop();
  }

  /** A copy of the race from a snapshot: at the start, after a reconnect (a full snapshot), or when the copy went wrong. */
  start(snapshot) {
    this.replica = makeReplica(rules, snapshot, { seat: this.seat });
    this.me = this.replica.car;
    this.counts = this.replica.auth.room.count.slice();
    this.stale = false;
  }

  /** What the room told everyone at a tick. A numbered event that skips one means the page missed something. */
  heard(list) {
    for (const e of list) {
      if ((e.k === "i" || e.k === "a") && e.j > this.counts[e.c] + 1) { stats.gaps++; this.stale = true; }
      if ((e.k === "i" || e.k === "a") && e.j > this.counts[e.c]) this.counts[e.c] = e.j;
      // One of this phone's own inputs, as the room took it: was it in time for the step the phone gave it?
      if (e.k === "i" && e.c === this.me && e.q && this.wanted?.has(e.q)) {
        const late = e.n - this.wanted.get(e.q);
        this.wanted.delete(e.q);
        if (late > 0) { stats.late++; stats.lateSteps += late; }
      }
    }
    this.replica.events(list);
    this.compare();
  }

  /** A snapshot: checked against the copy when they are of the same step, and the copy carries on from it. */
  snapshot(s, full) {
    stats.snapshots++;
    if (full) {
      stats.full++;
      // A reconnect or a reload: whatever this page had in flight may be lost, so it starts again from the room's word.
      if (s.n >= this.replica.auth.n) { this.start(s); return; }
    }
    const auth = this.replica.auth;
    if (s.n === auth.n) {
      stats.compared++;
      if (rules.fingerprint(auth) !== rules.fingerprint(rules.load(s))) { stats.diverged++; this.start(s); return; }
    }
    if (this.stale && s.n >= auth.n) { stats.restarts++; this.start(s); return; }
    this.replica.snapshot(s);
    this.counts = this.counts.map((j, i) => Math.max(j, this.replica.auth.room.count[i]));
  }

  /** What this page showed at the step the room has now reached, against the room's own: how far off each car was. */
  compare() {
    const auth = this.replica.auth, kept = this.shown.get(auth.n);
    if (kept && auth.t >= 0 && !auth.over) {
      for (const c of auth.cars) {
        const k = kept[c.i], d = Math.hypot(k[0] - c.x, k[1] - c.z);
        if (c.fin || c.fallT > 0) continue;
        tally(c.i === this.me ? stats.ownErr : stats.rivalErr, d);
      }
    }
    for (const n of this.shown.keys()) if (n <= auth.n) this.shown.delete(n);
  }

  /**
   * The hands, sent as the room takes them: only what changed, and a steer at most 15 times a second (the replica
   * decides); and a beat when there was nothing else to say. `force`: the page is letting go (hidden, closed, out
   * of focus), so the hands as they are now, all released, go at once.
   */
  send(now, force = false) {
    if (!this.hands || this.me < 0 || this.out) return;
    const car = this.replica.auth.cars[this.me];
    if (car.fin) return;
    let r;
    if (this.autoDrive && !force) {
      // A test switch: the house's own driver holds this phone's hands, through the same path as a thumb.
      const p = this.view || this.replica.auth, out = {};
      rules.house.drive(p, p.cars[this.me], out);
      r = [out.st, out.b & BTN.GO ? 1 : 0, out.b & BTN.BRAKE ? 1 : 0, out.b & BTN.DRIFT ? 1 : 0, out.b & BTN.USE ? 1 : 0];
    } else r = this.hands.reading();
    const msg = this.replica.input(now, ...r, { force });
    if (!msg) return this.speak(now);
    if (r[4]) this.hands.usePending = false;
    stats.sent++;
    (this.wanted || (this.wanted = new Map())).set(msg.q, rules.stepOf(this.replica.auth, now) + 1);
    if (this.wanted.size > 64) this.wanted.delete(this.wanted.keys().next().value);
    this.post(msg);
  }
  /**
   * A thumb or a key moved: the hands go to the room now, not at the next frame. The big screen draws this car from
   * what the room relays, so a frame's wait here would be a frame more between the thumb and the car on the screen.
   */
  handsMoved() {
    if (!this.autoDrive && !this.gone) this.send(this.host.now());
  }
  /** A beat ({h: 1}) when this page has said nothing for a while (replica.beat): the room then knows it is still here. */
  speak(now) {
    if (!this.hands || this.me < 0 || this.out) return;
    const beat = this.replica.beat(now);
    if (beat) { stats.beats++; this.post(beat); }
  }
  post(msg) {
    if (this.lag) setTimeout(() => this.host.send(msg), this.lag);
    else this.host.send(msg);
  }
  /** This page is letting go of the race for now (hidden, closed, out of focus): nothing stays held. */
  letGo() {
    if (!this.hands) return;
    this.hands.releaseAll();
    this.send(this.host.now(), true);
  }
  /** The picture cannot be drawn any more (the WebGL context was lost and not restored): the house drives this car. */
  cannotDraw() {
    if (this.out || this.gone || !this.world) return;
    // A phone whose car is on the big screen carries on as a controller; the big screen itself as the flat table.
    if (this.padOk || this.big) {
      this.dropWorld();
      if (this.big) { this.mode = "board"; this.root.dataset.mode = "board"; $("bview").hidden = true; this.layout(); }
      else { $("bpad").hidden = true; this.setPad(true, true); }
      if (window.__derby) window.__derby.lostPicture = true;
      return;
    }
    this.hands?.releaseAll();
    this.out = true;
    clearInterval(this.beatT);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    try { this.sound.disable(); } catch (e) { /* nothing to stop */ }
    noPicture(this.host, this.replica.auth);
    if (window.__derby) window.__derby.noPicture = true;
  }

  /** A finger touched a control: show the thumb controls even on a computer with a touch screen. */
  touchSeen() {
    if (!this.touch) { this.touch = true; this.root.dataset.touch = "1"; }
    if (!this.sound.on && this.sound.enable()) this.soundButton();
  }
  soundButton() { $("bsound").setAttribute("aria-pressed", String(this.sound.on)); $("bsound").textContent = this.sound.on ? "Sound off" : "Sound on"; }

  /**
   * The big screen's view at the start: the host's last choice on this screen, else the split view, unless this
   * screen draws 3D on its processor (four pictures a frame would crawl there): then the whole table, one picture.
   * A test switch (derby-tvview=split|table) decides it outright.
   */
  tvView() {
    const asked = params.get("tvview") || store.get(VIEW_KEY);
    if (asked === "split" || asked === "table") return asked === "split" ? "split" : "tvwide";
    return SOFTWARE_GL.test(stats.renderer) ? "tvwide" : "split";
  }
  /** The host switched the big screen's view (one button): the split view or the whole table, remembered on this screen. */
  setView(mode, remember = false) {
    if (!this.world || !this.big) return;
    this.mode = mode;
    this.root.dataset.mode = mode;
    if (remember) store.set(VIEW_KEY, mode === "split" ? "split" : "table");
    this.split.reset();
    for (const t of this.tags) t.hidden = true;
    this.tvKey = ""; this.tvLap = "";
    this.viewButton();
    this.layout();
  }
  viewButton() {
    const b = $("bview");
    b.textContent = this.mode === "split" ? "Whole table" : "Split screen";
    b.setAttribute("aria-label", this.mode === "split" ? "Show the whole table instead of a picture for each player" : "Show a picture for each player");
  }
  /**
   * Controller only: the phone stops drawing the race (its car is on the big screen) and shows big thumbs, the
   * place and the power in hand. The player's choice is remembered on this phone; `forced`: this phone cannot draw
   * in 3D at all, so it is a controller and the switch is not offered.
   */
  setPad(on, forced = false) {
    this.pad = !!on;
    this.root.toggleAttribute("data-pad", this.pad);
    $("bpad").setAttribute("aria-pressed", String(this.pad));
    $("padinfo").querySelector(".pline").textContent = forced ? "This phone can't show the race. Steer here: your car is on the big screen." : "Your car is on the big screen. Steer here.";
    if (forced) this.root.dataset.flat = "1";
    else store.set(PAD_KEY, this.pad ? "1" : "0");
    // The picture again: the camera starts behind the car, not where it was when the picture stopped.
    if (!this.pad) { this.rig?.reset(); this.layout?.(); }
    this.padKey = "";
  }
  /** The controller's own words: the place, the lap, and the house when it has the car. */
  drawPad(st, c) {
    const place = this.order.indexOf(c) + 1;
    const lap = c.fin ? "Home" : st.t < 0 ? "Get ready" : `Lap ${lapOf(c, st)} of ${lapsIn(st)}`;
    const line = c.auto && st.t >= 0 && !c.fin ? "The house is driving your car for a moment." : "";
    const key = `${place}|${lap}|${line}`;
    if (this.padKey === key) return;
    this.padKey = key;
    this.padPlace.textContent = ORD[place - 1] || "";
    this.padLap.textContent = lap;
    this.padHouse.textContent = line;
  }

  bind() {
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
    $("bsound").addEventListener("click", () => {
      if (this.sound.on) this.sound.disable(); else if (this.sound.enable()) this.sound.beep(880);
      this.soundButton();
    });
    const KEYMAP = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", Space: "drift", ShiftLeft: "drift", ShiftRight: "drift", KeyE: "use", Enter: "use", NumpadEnter: "use" };
    if (this.big) {
      // The big screen's buttons fade off the picture after a few quiet seconds; a mouse or a key brings them back.
      const wake = () => { $("btns").classList.remove("idle"); clearTimeout(this.idleT); this.idleT = setTimeout(() => $("btns").classList.add("idle"), 4000); };
      for (const t of ["pointermove", "pointerdown", "keydown"]) window.addEventListener(t, wake, { passive: true });
      wake();
      // V switches the view too (a keyboard by the television).
      window.addEventListener("keydown", (e) => { if (e.code === "KeyV" && !e.repeat && !this.out) this.setView(this.mode === "split" ? "tvwide" : "split", true); });
    }
    const keys = (e, down) => {
      const act = KEYMAP[e.code];
      if (!act || !this.hands) return;
      if ((e.code === "Enter" || e.code === "Space") && e.target?.closest?.("button")) return;
      e.preventDefault();
      if (down && !this.sound.on && this.sound.enable()) this.soundButton();
      this.hands.keys[act] = down;
      this.handsMoved();
      if (act === "use" && down && !e.repeat) this.hands.usePending = true;
    };
    window.addEventListener("keydown", (e) => keys(e, true));
    window.addEventListener("keyup", (e) => keys(e, false));
    // Switching tab or app, or the page going away: let go of everything at once and tell the room, so an arrow held
    // at that moment is not held on; with the page hidden it says nothing more, and the house takes the car in a second.
    window.addEventListener("blur", () => this.letGo());
    window.addEventListener("pagehide", () => this.letGo());
    document.addEventListener("visibilitychange", () => {
      this.sound.pause(document.hidden);
      if (document.hidden) this.letGo();
      else if (!this.out && !this.gone) { this.last = null; this.loop(); this.speak(this.host.now()); }
    });
  }

  layout() {
    // A touch screen draws at most TOUCH_DPR_CAP pixels per CSS pixel; a big screen DPR_CAP.
    // The split view draws up to four pictures a frame: at most SPLIT_DPR_CAP pixels per CSS pixel.
    const s = $("stage"), w = Math.max(2, s.clientWidth), h = Math.max(2, s.clientHeight), cap = this.mode === "split" ? TUNE.SPLIT_DPR_CAP : this.touch ? TUNE.TOUCH_DPR_CAP : TUNE.DPR_CAP;
    if (this.world && (w !== this.w || h !== this.h || this.scale !== this.appliedScale || cap !== this.appliedCap)) { this.appliedScale = this.scale; this.appliedCap = cap; this.world.resize(w, h, this.scale, cap); }
    this.w = w; this.h = h;
    if (this.split) { if (this.mode === "board") this.split.layoutBoard(w, h); else this.split.layout(w, h); }
    if (this.hands) { this.hands.lineW = 0; this.hands.memo.gauge = ""; for (const t of this.hands.toks || []) t.halfW = 0; }
    this.tvLineW = 0;
    for (const t of this.tvToks || []) t.halfW = 0;
    // Names are not drawn under the player's strip and chips (whatever height they wrap to on this screen).
    const top = this.hands?.el.querySelector(".topmid");
    this.tagTop = top ? Math.ceil(top.getBoundingClientRect().bottom) + 4 : 0;
    this.tagH = 0;
  }

  flash(colour, ms = 350) {
    const f = $("flash"); f.style.setProperty("--fc", colour);
    try { f.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: ms, easing: "ease-out" }); } catch (e) { /* no animation support */ }
  }

  /** The race as this page shows it now: the copy run on to the room's clock, or the room's word when that would be too much at once. */
  raceNow(now) {
    const auth = this.replica.auth, ahead = rules.stepOf(auth, now) - auth.n;
    // Far behind (a page that woke, or a room that stopped talking): draw the room's word and wait for the next snapshot.
    if (ahead > 2 / DT || auth.over) return auth;
    const t0 = performance.now();
    const st = this.replica.predict(now);
    tally(stats.predictMs, performance.now() - t0);
    // Kept to be checked once the room's word reaches the same step (compare).
    if (st.n > auth.n && !this.shown.has(st.n)) this.shown.set(st.n, st.cars.map((c) => [c.x, c.z]));
    if (this.shown.size > 600) this.shown.delete(this.shown.keys().next().value);
    return st;
  }

  /** What the race said happened (new since the last frame), turned into feedback for whoever it happened to. */
  onEvent(e, st) {
    const S = this.sound, me = this.me, h = this.hands;
    const mine = h && e.car === me && !st.cars[me].auto, rig = this.rig;
    if (e.k === "start") { if (h) h.word("GO!", "teal"); else this.count("GO!", true); S.beep(1320); }
    else if (e.k === "pad") { if (mine) { h.word("Wound up!", "small teal"); S.pad(); buzz(20); this.flash(CSS.mustard, 300); rig.kick = 1; } }
    else if (e.k === "drift") { if (mine) { h.everDrifted = true; S.noise(0.08, 1200, 2, 0.2); } }
    else if (e.k === "charge") { if (mine) { S.charge(e.lvl); buzz(8); } }
    else if (e.k === "mini") { if (mine) { h.word(e.lvl === 2 ? "Big boost!" : "Boost!", "small"); S.mini(e.lvl); buzz(e.lvl === 2 ? [20, 30, 40] : 20); rig.kick = e.lvl === 2 ? 1 : 0.6; } }
    else if (e.k === "bump") { if (h && (e.car === me || e.into === me)) { S.knock(Math.min(1.4, 0.5 + e.hard * 0.25)); buzz(25); rig.bump(TUNE.SHAKE_BUMP * Math.min(1.5, e.hard / 2)); } }
    else if (e.k === "wall" || e.k === "knock") { if (mine) { S.knock(Math.min(1.2, 0.4 + (e.hard || 2) * 0.15)); buzz(12); rig.bump(0.03); } }
    else if (e.k === "clunk") { if (mine) S.thud(); }
    else if (e.k === "fall") { if (mine) { h.word("OFF THE TABLE!"); S.fall(); buzz([120, 60, 120]); } if (!h && this.tv && this.mode === "tvwide") this.tv.cut(this.world, st, e); } // the split view's panes show their own falls
    else if (e.k === "back") { if (mine) h.word("Back on", "small teal"); }
    else if (e.k === "land") { if (mine && e.hard > 2.5) { S.thud(); buzz(18); rig.bump(TUNE.SHAKE_LAND); } }
    else if (e.k === "lap") { if (mine) { h.word(e.lap >= lapsIn(st) ? "Last lap!" : `Lap ${e.lap}`, "small teal"); S.beep(990); } }
    else if (e.k === "finish") {
      if (h && e.car === me) { h.word(ORD[e.place - 1] + "!", e.place === 1 ? "" : "teal"); S.ding(); buzz([40, 40, 120]); h.releaseAll(); }
      else if (e.place === 1) S.ding();
      // The winner's close shot at the line: across the whole big screen, in either view.
      if (!h && this.tv) this.tv.cut(this.world, st, e);
    } else if (e.k === "item") {
      if (mine) {
        const info = ITEM_INFO[e.item], told = (this.toldItem = this.toldItem || {});
        if (!told[e.item]) { told[e.item] = true; this.pendingHow = e.item; } else h.word(info.say, "small teal");
        S.pick(); buzz(15);
      }
    } else if (e.k === "use") {
      if (mine) { S.use(e.item); buzz(20); if (e.item === "overwind") { rig.kick = 1.2; this.flash(CSS.orange, 350); } else if (e.item === "pepper") h.word("Pepper shot!", "small"); else if (e.item === "butter") h.word("Butter dropped", "small teal"); }
      else if (h && e.to === me) { h.word(`${st.cars[e.car].name}'s pepper, coming!`, "small"); S.beep(520); }
    } else if (e.k === "hit") {
      if (mine) {
        const who = e.by >= 0 ? st.cars[e.by].name : "";
        const say = { butter: who ? `${who}'s butter! Spun` : "Butter! Spun", pepper: who ? `Peppered by ${who}!` : "Achoo!", "pepper cloud": "Achoo!", steam: "Steam!", cherry: "Cherry!", egg: "Egg! Knocked" }[e.what] || "Bump!";
        h.word(say, "small"); buzz(e.what === "steam" ? 10 : [30, 30, 30]); rig.bump(0.05);
        if (e.what === "pepper") { this.pepperFx(); S.sneeze(); } else if (e.what === "pepper cloud") S.sneeze(); else if (e.what === "butter") S.slip(); else if (e.what !== "steam") S.knock(1.1);
      } else if (h && e.by === me && (e.what === "pepper" || e.what === "butter")) {
        h.word(e.what === "pepper" ? `Pepper! Got ${st.cars[e.car].name}` : `Butter! Got ${st.cars[e.car].name}`, "small teal"); S.got(); buzz(15);
      }
    } else if (e.k === "spill") {
      if (mine) {
        const said = (this.saidSpill = this.saidSpill || {});
        const word = { spin: "Spun out", slide: "Slide!", slow: "Sticky! Slow", stuck: "Slime sticks!" }[e.does] || "";
        const name = e.what[0].toUpperCase() + e.what.slice(1);
        if (!said[e.what + e.does]) { said[e.what + e.does] = true; h.word(e.does === "stuck" ? `${name}! Slime sticks` : `${name}! ${word}`, "small"); }
        if (e.does === "spin") { S.slip(); buzz([20, 20, 20]); rig.bump(0.04); } else if (e.does === "slow") S.squelch(); else if (e.does === "slide") S.slip();
      }
    } else if (e.k === "trait") {
      if (mine) { h.flashTrait(); if (e.trait === "ghost") { h.word("Ghosted through!", "small teal"); S.whoosh(); } }
    } else if (e.k === "kettle") { if (this.near(st, TUNE.KETTLE.u, 30)) S.whistle(); }
    else if (e.k === "toaster") { if (this.near(st, TUNE.TOASTER.u, 30)) S.tick(); }
    else if (e.k === "eggwarn") { if (this.near(st, TUNE.EGG.u, 30)) S.rumble(); }
    else if (e.k === "syrupwarn") { if (this.near(st, TUNE.SYRUP.u, 30)) S.drip(); }
  }
  /** Is this phone's car within `d` before u (coming up to it)? The big screen hears every warning. */
  near(st, u, d) { if (this.me < 0) return true; const c = st.cars[this.me], gap = wrapS(u - c.u); return gap > -4 && gap < d; }
  pepperFx() { try { $("pepper").animate([{ opacity: 0.92 }, { opacity: 0.92, offset: 0.3 }, { opacity: 0 }], { duration: TUNE.PEPPER_T * 1000, easing: "ease-in" }); } catch (e) { /* no animation: no cloud */ } }
  /** The big screen's count: 3, 2, 1, GO (which clears itself), or `kind` "late": a line that stays a little longer. */
  count(text, go = false, kind = "") {
    const c = $("count"); c.textContent = text; c.classList.toggle("go", go); c.classList.toggle("late", kind === "late");
    // While the count is up the table in the middle of four panes makes way for it.
    this.root.toggleAttribute("data-counting", !!text);
    clearTimeout(this.countT);
    if (go) this.countT = setTimeout(() => { c.textContent = ""; this.root.removeAttribute("data-counting"); }, kind === "late" ? 2200 : 900);
  }

  hint(st) {
    let t = "";
    const c = this.me >= 0 ? st.cars[this.me] : null;
    if (this.mode !== "phone") t = this.you.role === "player" ? "You joined in the middle of a race: you race in the next one." : this.mode === "board" ? "This screen can't draw the race in 3D: here is the table from above." : "";
    else if (c.auto) t = "Your phone was away, so the house is driving your car. It is yours again in a moment.";
    else if (c.fin) t = `You finished ${ORD[c.place - 1] || ""}. ${st.firstFin >= 0 && !st.over ? "The others are still racing." : ""}`;
    else if (st.t < 0) t = this.touch ? "It drives itself. Left thumb: slide to steer round things. Right thumb: hold Drift through a turn; Use fires a power from a sweet." : "Up to go, left and right to steer. Hold Space through a turn to drift. Drive through a sweet for a power; E uses it.";
    else if (st.t < 8 && !this.hands.everDrifted) t = this.touch ? "Hold Drift through a turn, let go to boost." : "Hold Space through a turn, let go to boost.";
    if (this.hintText !== t) { this.hintText = t; $("hint").textContent = t; }
  }

  drawTags(view, st) {
    const tv = !!view.tv, lead = this.order[0], placed = this.placed || (this.placed = []);
    placed.length = 0;
    for (const c of this.order) {
      const tag = this.tags[c.i];
      let p = null;
      if (tv) p = this.world.project(c.i, view, 1.2 * (this.carK || 1), this.tagP || (this.tagP = {}));
      else if (c.i !== this.me) {
        const d = this.world.cars[c.i].pos.distanceTo(view.cam.position);
        if (d > 2.6 && d < 24) p = this.world.project(c.i, view, this.world.cars[c.i].top + 0.25, this.tagP || (this.tagP = {}));
        // Never a name over your own car.
        const me = p && this.world.project(this.me, view, 0.4, this.meP || (this.meP = {}));
        if (me && Math.abs(p.x - me.x) < Math.max(70, this.w * 0.09) && p.y > me.y - this.h * 0.2 && p.y < me.y + this.h * 0.12) p = null;
      }
      // A tag hangs above its point (its bottom edge is p.y): it is not drawn where it would cover the strip and chips.
      const th = this.tagH || 22, top = tv ? 0 : (this.tagTop || 0) + th;
      if (!p || p.x < -40 || p.x > this.w + 40 || p.y < top || p.y > this.h) { if (!tag.hidden) tag.hidden = true; continue; }
      if (tag.hidden) tag.hidden = false;
      const isLead = tv && c === lead && st.t > 2, label = c.name || "House";
      if (tag.dataset.l !== label + isLead) { tag.dataset.l = label + isLead; tag.textContent = label; tag.prepend(el("i")); tag.classList.toggle("lead", isLead); tag.w = 0; }
      if (!this.tagH) this.tagH = tag.offsetHeight || 22;
      if (!tag.w) tag.w = tag.offsetWidth || 60;
      // Kept whole on the screen: a car at the edge of the picture keeps its name in full.
      const x = clampN(p.x, tag.w / 2 + 4, Math.max(tag.w / 2 + 4, this.w - tag.w / 2 - 4));
      // Tags of cars running together step up over any they would cover (tags grow with a big screen, and so do the steps).
      let y = p.y;
      const tall = th - 1;
      for (let k = 0; k < placed.length; k += 3) if (Math.abs(placed[k] - x) < (placed[k + 2] + tag.w) / 2 + 2 && Math.abs(placed[k + 1] - y) < tall) { y = placed[k + 1] - th; k = -3; }
      // Stepped up over the strip and chips: not drawn after all.
      if (!tv && y - th < (this.tagTop || 0)) { tag.hidden = true; continue; }
      placed.push(x, y, tag.w);
      tag.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    }
  }

  /** The big screen's strip: the leader's lap, every car along the line, and the places. */
  drawTv(st) {
    const lead = this.order[0];
    const lapText = st.over ? "Finished" : st.t < 0 ? "Get ready" : `Lap ${lapOf(lead, st)} of ${lapsIn(st)}`;
    if (this.tvLap !== lapText) { this.tvLap = lapText; $("tvlap").textContent = lapText; }
    const lw = this.tvLineW || (this.tvLineW = $("tvline").clientWidth || 100);
    for (const c of st.cars) this.tvToks[c.i].style.transform = `translateX(${Math.round(alongLine(c, lw, this.tvToks[c.i]))}px)`;
    const key = this.order.map((c) => c.i + (c.fin ? "f" : "")).join();
    if (this.tvKey === key) return;
    this.tvKey = key;
    const box = $("tvplaces");
    box.textContent = "";
    this.order.forEach((c, n) => {
      const s = el("span"), b = el("b");
      b.textContent = String(n + 1);
      s.append(b, dot(c.colour), document.createTextNode(c.house ? `${c.name} (house)` : c.name));
      box.append(s);
    });
  }

  loop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    const frame = (ts) => {
      if (document.hidden || this.gone || this.out) { this.raf = 0; return; }
      this.raf = requestAnimationFrame(frame);
      const raw = this.last ? ts - this.last : 16.7; this.last = ts;
      const dt = Math.min(0.1, raw / 1000);
      this.time += dt;
      stats.frames++;
      const work0 = performance.now();
      const now = this.host.now();
      this.send(now);
      const st = (this.view = this.raceNow(now));
      // The race's own events, each once: those of steps this page has not shown before.
      for (const e of st.ev) if (e.t > this.lastT) { this.world?.event(e); this.onEvent(e, st); }
      if (st.t > this.lastT) this.lastT = st.t;
      if (st.t < 0) {
        const n = Math.ceil(-st.t);
        if (n < this.countShown && n >= 1) { this.countShown = n; if (this.hands) this.hands.word(String(n), "teal"); else this.count(String(n)); this.sound.beep(660); }
      } else if (this.countShown !== 0) {
        // The count is over. GO itself is the race's own start event (onEvent); a page that did not see it says so.
        const late = this.countShown === 9 && !st.over && st.t > 0.5;
        this.countShown = 0;
        if (late) {
          // It came up after GO (it loaded slowly, or joined late): it says so, instead of nothing at all.
          stats.lateWord = +st.t.toFixed(2);
          if (this.hands) this.hands.word("Race under way", "small teal");
          else this.count("Race under way", true, "late");
        } else if (!this.hands && !$("count").classList.contains("go")) this.count(""); // a missed GO (frames skipped) leaves no number up
      }
      const me = this.me >= 0 ? st.cars[this.me] : null;
      this.root.toggleAttribute("data-house", !!me?.auto);
      rules.raceOrder(st, this.order);
      tally(stats.frameMs, raw);
      if (raw > 25) stats.slowFrames++;
      // The picture, unless this page has none (no 3D, or a phone that is a controller only).
      let view = null;
      const W = this.world;
      if (W && !this.pad) {
        W.sync(st, dt);
        const w = this.w || 2, h = this.h || 2;
        let views;
        if (this.rig) views = [(view = this.rig.update(st, W, dt, w / h))];
        else {
          // The big screen: the whole table (with its close shots), or a pane for each player. The winner's close shot
          // at the line takes the whole screen in the split view too.
          const tv = this.tv.update(st, W, dt, w / h);
          // The panes' cameras keep following their cars through the close shot, so each pane comes back where its car is.
          const panes = this.mode === "split" ? this.split.views(st, W, dt) : null;
          if (panes && !tv.close) views = panes;
          else views = [(view = tv)];
        }
        if (view) { view.rect.x = 0; view.rect.y = 0; view.rect.w = w; view.rect.h = h; }
        // The whole table: cars drawn larger, to be seen across a room (true size in its close shots and in the panes).
        if (!this.rig) { this.carK = view && !view.close && this.mode === "tvwide" ? TV_CAR_SIZE : 1; W.sizeCars(this.carK); }
        W.renderer.info.reset();
        W.render(views);
        stats.draws = W.renderer.info.render.calls; stats.triangles = W.renderer.info.render.triangles;
      }
      this.root.toggleAttribute("data-close", this.mode === "split" && !!view);
      const racing = st.t >= 0 && !st.over;
      if (this.hands) this.hands.draw(st, this.time, this.order, racing);
      // The first corners tell a player who has not drifted yet how, at the moment it would help.
      if (this.hands && racing && st.t > 0 && !this.hands.everDrifted && (this.nudges | 0) < 3 && !me.fin && !me.auto) {
        const ahead = trackAt(me.u + 10, 0, this.nudgeQ || (this.nudgeQ = {})), seg = segAt(wrapU(me.u + 10));
        if (ahead.turn && this.nudgeSeg !== seg.i && !trackAt(me.u, 0, this.nudgeQ).turn) { this.nudgeSeg = seg.i; this.nudges = (this.nudges | 0) + 1; this.hands.word(this.touch ? "Hold Drift here" : "Hold Space to drift", "small teal"); }
      }
      // The first time you hold each power: say what the button does with it, once it is unwrapped.
      if (this.hands && racing && this.pendingHow && me.item === this.pendingHow && me.itemT <= 0 && !me.fin) {
        const info = ITEM_INFO[this.pendingHow]; this.pendingHow = null;
        this.hands.word(`${info.name}. ${info.how[this.touch ? 0 : 1]}`, "small teal how");
      }
      if (view) this.drawTags(view, st);
      if (this.mode === "tvwide") this.drawTv(st);
      else if (this.split && !view) this.split.draw(st, this.order, this.time, racing);
      if (this.pad) this.drawPad(st, me);
      // Speed lines at the bottom corners, and the whirr.
      const fastness = me && racing && !this.pad ? clampN((me.v - 7.5) / 4, 0, 1) : 0;
      if (Math.abs(fastness - (this.speedOp || 0)) > 0.04) { this.speedOp = fastness; $("speed").style.opacity = fastness.toFixed(2); }
      if (fastness > 0.05) $("speed").style.transform = `translate(${(Math.random() * 4 - 2).toFixed(1)}px, ${(Math.random() * 3).toFixed(1)}px)`;
      if (me) this.sound.run(Math.abs(me.v) * 0.7, racing && Math.abs(me.v) > 0.2, me.drOn ? 1 + me.drLvl : 0);
      this.hint(st);
      tally(stats.workMs, performance.now() - work0);
      this.govern(raw);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** Cork & Bell's rule: forty slow frames in a row lower the resolution, six hundred fast ones raise it. */
  govern(ms) {
    if (!this.world || this.pad) return;
    // Slow frames are counted, and timed too: at a few frames a second, forty in a row would take half a minute
    // (three in a row at least, so one long frame, a picture's first, is not taken for a slow screen).
    if (ms > TUNE.GOV_SLOW_MS) { this.slow++; this.slowMs = (this.slowMs || 0) + ms; this.fast = 0; } else { this.slow = 0; this.slowMs = 0; if (ms < TUNE.GOV_FAST_MS) this.fast++; else this.fast = 0; }
    if ((this.slow >= 40 || (this.slow >= 3 && this.slowMs >= 1500)) && this.scale > 0.5) { this.scale = Math.max(0.5, this.scale - 0.15); this.slow = 0; this.slowMs = 0; this.layout(); }
    if (this.fast >= 600 && this.scale < 1) { this.scale = Math.min(1, this.scale + 0.15); this.fast = 0; this.layout(); }
  }

  /** No more 3D on this page (the picture was lost for good): everything that drew it goes. */
  dropWorld() {
    try { this.world?.renderer.dispose(); } catch (e) { /* lost already */ }
    this.world = null; this.tv = null;
    if (this.rig) this.rig = NO_RIG;
  }

  dispose() {
    this.gone = true;
    clearInterval(this.beatT);
    clearTimeout(this.lostT);
    if (this.raf) cancelAnimationFrame(this.raf);
    try { this.sound.disable(); } catch (e) { /* nothing to stop */ }
    try { this.world?.renderer.dispose(); this.world?.renderer.forceContextLoss(); } catch (e) { /* the frame goes with it anyway */ }
  }
}

/**
 * This page cannot show the race (no WebGL, a context that could not be made or was lost for good, no 3D library, a
 * race from other rules). A player's car must still race: the page tells the room to give it to the house ({house:
 * 1}, which the room takes from a seat for its own car only) and says so plainly. Nothing else is left on the page:
 * no picture, no thumbs, no sound button.
 * @param {object} host  the room's view (party-view.js)
 * @param {object|null} race  the race as the page last had it, to know whether this phone has a car in it
 */
function noPicture(host, race) {
  const you = host.you || {}, player = you.role === "player";
  const mine = player && race ? race.cars.some((c) => c.seat === you.seat && !c.house) : player;
  if (player) try { host.send({ house: 1 }); } catch (e) { /* the room is gone too: nothing to drive */ }
  const app = $("app");
  app.dataset.mode = "nopicture";
  const box = $("nopic");
  box.querySelector("b").textContent = player ? "This phone can't show the race." : "This screen can't show the race.";
  box.querySelector("p").textContent = mine ? "The house is driving your car. Watch the big screen." : "Watch it on the big screen.";
  box.hidden = false;
  $("hint").textContent = "";
  $("huds").textContent = "";
  $("tags").textContent = "";
}

/**
 * The big screen's panes as this page has them, for the tests: which car each pane's camera follows and how far
 * behind it the camera is, where that car falls in the picture, the pane's box and the size of its words.
 */
function paneCheck(app) {
  const sp = app.split, W = app.world, st = app.view;
  if (!sp) return { mode: app.mode, n: 0, panes: [] };
  const font = (node) => (node && node.offsetParent !== null ? parseFloat(getComputedStyle(node).fontSize) : 0);
  const panes = sp.panes.map((p, k) => {
    const rig = sp.rigs[k], r = p.el.getBoundingClientRect(), car = st?.cars[p.i];
    let camDist = -1, nearest = -1, inPane = false, at = null;
    if (rig && W) {
      const cp = rig.cam.position, d = W.cars.map((v) => v.pos.distanceTo(cp));
      camDist = d[p.i]; nearest = d.indexOf(Math.min(...d));
      at = W.project(p.i, rig.view, 0.3, {});
      if (at) at = { x: Math.round(at.x), y: Math.round(at.y) };
      // In its pane: a car dropping off a step dips to the pane's lower edge for a moment (the camera follows a drop
      // with a short lag, as on the phone), so a tenth of the pane's height below it still counts.
      const R = sp.rects[k];
      inPane = !!at && at.x >= R.x && at.x <= R.x + R.w && at.y >= R.y && at.y <= R.y + R.h * 1.1;
    }
    const words = [...p.el.querySelectorAll(".plabel, .pnear span, .pheld .hname, .pnote b, .pnote small")].filter((e) => e.offsetParent !== null && e.textContent.trim());
    return {
      car: p.i, name: car?.name, focus: rig ? rig.i : -1, camDist: +camDist.toFixed(2), nearest, inPane, at, auto: !!car?.auto, fall: (car?.fallT ?? 0) > 0, fin: !!car?.fin,
      box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      label: p.el.querySelector(".plabel").innerText.replace(/\s+/g, " ").trim(), note: p.el.querySelector(".pnote").innerText.replace(/\s+/g, " ").trim(),
      smallest: Math.min(...words.map(font)), words: words.map((e) => { const q = e.getBoundingClientRect(); return { t: e.textContent.trim().slice(0, 24), x: Math.round(q.left), y: Math.round(q.top), r: Math.round(q.right), b: Math.round(q.bottom), f: font(e) }; }),
    };
  });
  const mb = document.getElementById("mapbox"), m = mb.offsetParent !== null ? mb.getBoundingClientRect() : null;
  return { mode: app.mode, n: sp.n, t: st ? +st.t.toFixed(2) : null, h: innerHeight, w: innerWidth, close: app.root.hasAttribute("data-close"), map: m && { x: Math.round(m.left), y: Math.round(m.top), r: Math.round(m.right), b: Math.round(m.bottom) }, panes };
}

if (!host) {
  // Opened on its own: Tin Derby is played in a party room, which starts the race for everyone in it.
  $("hint").textContent = "Tin Derby is raced in a party room. Start a party on the front page and vote for it there.";
  $("app").dataset.mode = "tvwide";
} else {
  let app = null;
  try {
    app = new App(host);
    window.__derby = { app, stats, rules, get race() { return app.view; }, get car() { return app.me; }, panes: () => paneCheck(app) };
  } catch (err) {
    // No WebGL here (three.js could not make a context), or a snapshot from other rules (the site was updated mid-race).
    console.warn(`Tin Derby: this page cannot show the race (${err.message})`);
    let race = null;
    try { race = rules.load(host.snapshot); } catch (e) { /* other rules: we cannot know the seats */ }
    noPicture(host, race);
    host.ready();
    window.__derby = { app: null, stats, rules, noPicture: true, race: null, car: -1 };
  }
}
