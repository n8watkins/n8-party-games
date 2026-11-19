// Tin Derby: the table from above as a flat drawing, and the places beside it. The big screen's split view shows it
// beside the players' panes (or in the fourth cell of a three-player race), and a big screen that cannot draw in 3D
// shows it alone, large: never a black screen. Plain 2D canvas, no three.js, so it works where 3D does not.
// Round five's reviewed split-view map (its app.js, buildPanes and drawPanes), with the reviewer's fixes: the pancake
// stacks, the lazy Susan and the shakers are marked, each at its true size.
import { TUNE, LEN, trackAt, halfAt } from "./env.js";

const NAVY = "#242a3e", CREAM = "#fdeccb", MUSTARD = "#f4ab16";
const ORD = ["1st", "2nd", "3rd", "4th"];

/** The table's extent in car lengths, as table.js works it out (the loop and a margin round it). */
const BOUNDS = (() => {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  const q = {};
  for (let u = 0; u < LEN; u += 1) for (const l of [-halfAt(u), halfAt(u)]) { trackAt(u, l, q); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
  return { x0: x0 - 6, x1: x1 + 6, z0: z0 - 6, z1: z1 + 6 };
})();
/** The drawing's width over its height. */
export const MAP_ASPECT = (BOUNDS.x1 - BOUNDS.x0) / (BOUNDS.z1 - BOUNDS.z0);

/** The table from above on a canvas: the track drawn once, the cars as dots in their colours each frame. */
export class TableMap {
  /** @param {HTMLCanvasElement} canvas  drawn at its own width and height (CSS sizes it) */
  constructor(canvas) {
    this.cv = canvas;
    this.pt = {};
    this.size(canvas.width, canvas.height);
  }
  size(W, H) {
    W = Math.max(40, Math.round(W)); H = Math.max(20, Math.round(H));
    if (this.base && this.W === W && this.H === H) return;
    this.W = this.cv.width = W; this.H = this.cv.height = H;
    const { x0, x1, z0, z1 } = BOUNDS, pad = Math.max(8, W * 0.02);
    const s = (this.s = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (z1 - z0)));
    this.at = (px, pz, out) => { out.x = W / 2 + (px - (x0 + x1) / 2) * s; out.y = H / 2 + (pz - (z0 + z1) / 2) * s; return out; };
    const base = (this.base = document.createElement("canvas"));
    base.width = W; base.height = H;
    const b = base.getContext("2d"), pt = {}, q = {}, k = W / 400;
    b.lineCap = "round"; b.lineJoin = "round";
    const path = (u0, u1) => { b.beginPath(); for (let u = u0; u <= u1 + 1e-6; u += 0.5) { trackAt(u, 0, q); this.at(q.x, q.z, pt); u === u0 ? b.moveTo(pt.x, pt.y) : b.lineTo(pt.x, pt.y); } };
    for (const [w, c] of [[TUNE.HALF * 2 * s + 4 * k, NAVY], [TUNE.HALF * 2 * s - 1 * k, CREAM]]) { b.lineWidth = w; b.strokeStyle = c; path(0, LEN + 0.5); b.stroke(); }
    // The set pieces, as small marks: the ramps in wood, the cereal box in mustard.
    for (const dk of TUNE.DECKS) { b.lineWidth = Math.min(dk.lat[1] - dk.lat[0], 2 * TUNE.HALF) * s; b.strokeStyle = "#e2a35a"; path(dk.pts[0][0], dk.pts[dk.pts.length - 1][0]); b.stroke(); }
    b.lineWidth = TUNE.HALF * 2 * s; b.strokeStyle = MUSTARD; path(TUNE.TUNNEL.u - 3, TUNE.TUNNEL.u + 3); b.stroke();
    const dot = (u, lat, ru, rl, fill) => { trackAt(u, lat, q); this.at(q.x, q.z, pt); b.save(); b.translate(pt.x, pt.y); b.rotate(q.th); b.beginPath(); b.ellipse(0, 0, Math.max(2.5, ru * s), Math.max(2.5, rl * s), 0, 0, 7); b.fillStyle = fill; b.fill(); b.lineWidth = 1.5 * k; b.strokeStyle = NAVY; b.stroke(); b.restore(); };
    for (const st of TUNE.STACKS) dot(st.u, st.lat, st.ru, st.rl, "#d99a4e");
    dot(TUNE.SUSAN.u, TUNE.SUSAN.lat, TUNE.SUSAN.r, TUNE.SUSAN.r, "#e2a35a");
    for (const [u, lat] of TUNE.SHAKERS) dot(u, lat, TUNE.SHAKER_R, TUNE.SHAKER_R, NAVY);
    // The start line.
    trackAt(TUNE.LINE_U, -TUNE.HALF, q); this.at(q.x, q.z, pt); const l0 = { ...pt }; trackAt(TUNE.LINE_U, TUNE.HALF, q); this.at(q.x, q.z, pt);
    b.lineWidth = 3 * k; b.strokeStyle = NAVY; b.beginPath(); b.moveTo(l0.x, l0.y); b.lineTo(pt.x, pt.y); b.stroke();
  }
  /** The cars, each a dot in its colour; a player's car (not the house's) with a ring round it. */
  draw(st) {
    const x = this.cv.getContext("2d"), k = this.W / 400;
    x.clearRect(0, 0, this.W, this.H); x.drawImage(this.base, 0, 0);
    // Where each dot goes: on its car; cars running together are eased apart (a few passes), so each dot stays whole
    // instead of a pile, and no dot goes more than its own width from its car.
    const P = (this.dots || (this.dots = st.cars.map(() => ({ x: 0, y: 0, x0: 0, y0: 0, r: 0 }))));
    st.cars.forEach((c, i) => { this.at(c.x, c.z, this.pt); Object.assign(P[i], { x: this.pt.x, y: this.pt.y, x0: this.pt.x, y0: this.pt.y, r: (c.house ? 8 : 14) * k }); });
    for (let pass = 0; pass < 4; pass++) for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const a = P[i], b = P[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), want = a.r + b.r;
      if (d >= want) continue;
      const ux = d > 0.01 ? dx / d : 1, uy = d > 0.01 ? dy / d : 0, push = (want - d) / 2;
      a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
    }
    for (const p of P) { const dx = p.x - p.x0, dy = p.y - p.y0, d = Math.hypot(dx, dy), max = 2 * p.r; if (d > max) { p.x = p.x0 + (dx / d) * max; p.y = p.y0 + (dy / d) * max; } }
    // The house cars first, so the players' dots sit on top.
    for (const pass of [true, false]) for (const c of st.cars) {
      if (c.house !== pass) continue;
      const p = P[c.i];
      x.beginPath(); x.arc(p.x, p.y, (c.house ? 7.5 : 9) * k, 0, 7); x.fillStyle = c.colour; x.fill(); x.lineWidth = 2.5 * k; x.strokeStyle = NAVY; x.stroke();
      if (!c.house) { x.beginPath(); x.arc(p.x, p.y, 13.5 * k, 0, 7); x.lineWidth = 2.5 * k; x.stroke(); }
    }
  }
}

/** The places as a list: place, colour, name, and the lap each is on (or done). Rebuilt only when it changes. */
export class Places {
  constructor(list) { this.el = list; this.key = ""; }
  draw(st, order, lapText) {
    const rows = order.map((c, n) => [n + 1, c.colour, c.house ? `${c.name} (house)` : c.name, c.fin ? "Home" : lapText(c, st)]);
    const key = JSON.stringify(rows);
    if (key === this.key) return;
    this.key = key;
    this.el.textContent = "";
    for (const [place, colour, name, lap] of rows) {
      const li = document.createElement("li"), b = document.createElement("b"), i = document.createElement("i"), nm = document.createElement("span"), lp = document.createElement("span");
      b.textContent = ORD[place - 1]; i.style.setProperty("--c", colour); nm.textContent = name; lp.textContent = lap;
      li.append(b, i, nm, lp);
      this.el.append(li);
    }
  }
}
