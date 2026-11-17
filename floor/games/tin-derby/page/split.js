// Tin Derby: the big screen's split view. One pane for each player in the race (house cars get none), each with
// that player's own chase camera (view.js's ChaseRig, the phone's camera), and on it their name and colour, their
// place and lap, the power they hold, who is near, the spring, and a word when the house is driving their car.
// The phone is the controller; the big screen is where each player watches their car.
//
// Layouts (README.md, "The big screen"):
//   1 player    the whole screen, the table and the places small in the bottom right corner
//   2 players   side by side, the table and the places small between them at the bottom
//   3 players   a 2 by 2 grid; the fourth cell holds the whole table and the places
//   4 players   a 2 by 2 grid; the whole table small in the middle (each pane has its own place)
import { ChaseRig } from "./view.js";
import { TableMap, Places, MAP_ASPECT } from "./map.js";

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Split {
  /**
   * @param {object} dom  {panes, mapbox, map, standings}: the page's elements
   * @param {object[]} cars  the race's cars (the room's word): the players among them get a pane each, in grid order
   * @param {object} say  {ORD, itemSvg, itemName, lapText, dot}: the page's words and pictures
   * @param {{stacked?: boolean, rigs?: boolean}} opts  stacked: two players one above the other; rigs: false where there is no 3D
   */
  constructor(dom, cars, say, { stacked = false, rigs = true } = {}) {
    this.dom = dom; this.say = say; this.stacked = stacked;
    this.seats = cars.filter((c) => !c.house).map((c) => c.i);
    this.n = this.seats.length;
    this.rigs = rigs ? this.seats.map((i) => new ChaseRig(i)) : [];
    this.rects = this.seats.map(() => ({ x: 0, y: 0, w: 1, h: 1 }));
    this.map = new TableMap(dom.map);
    this.places = new Places(dom.standings);
    dom.panes.textContent = "";
    this.panes = this.seats.map((i) => {
      const c = cars[i];
      const p = el("div", "pane", `<div class="pbox"><div class="plabel"><i></i><span class="pn"></span><b class="pp"></b><span class="pl"></span></div>
        <div class="pnear"><span class="ahead"></span><span class="behind"></span></div>
        <div class="pheld"><span class="ico"></span><span class="hname"></span></div></div>
        <div class="pspring"><i></i></div><div class="ppep"></div><div class="pnote" role="status"><b></b><small></small></div>`);
      p.dataset.car = String(i);
      p.style.setProperty("--c", c.colour);
      dom.panes.appendChild(p);
      const q = (s) => p.querySelector(s);
      q(".plabel i").style.setProperty("--c", c.colour);
      return { el: p, i, name: q(".pn"), place: q(".pp"), lap: q(".pl"), ahead: q(".ahead"), behind: q(".behind"), held: q(".pheld"), heldIco: q(".pheld .ico"), heldName: q(".pheld .hname"), spring: q(".pspring"), fill: q(".pspring i"), pep: q(".ppep"), note: q(".pnote"), noteB: q(".pnote b"), noteS: q(".pnote small"), memo: {}, boostMax: 1, lastBoost: 0 };
    });
  }
  reset() { for (const r of this.rigs) r.reset(); }

  /** The panes' places on a screen w by h (CSS pixels), the table's box, and which cell is which. */
  layout(w, h) {
    const n = this.n, R = this.rects, half = (v) => Math.round(v / 2);
    R.forEach((r, k) => {
      if (n === 1) Object.assign(r, { x: 0, y: 0, w, h });
      else if (n === 2 && !this.stacked) Object.assign(r, { x: k ? half(w) : 0, y: 0, w: k ? w - half(w) : half(w), h });
      else if (n === 2) Object.assign(r, { x: 0, y: k ? half(h) : 0, w, h: k ? h - half(h) : half(h) });
      else Object.assign(r, { x: k % 2 ? half(w) : 0, y: k >= 2 ? half(h) : 0, w: k % 2 ? w - half(w) : half(w), h: k >= 2 ? h - half(h) : half(h) });
    });
    this.panes.forEach((p, k) => {
      const r = R[k];
      Object.assign(p.el.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
      // The right-hand panes keep their spring to the right, clear of the table between the panes; with four, the
      // bottom right pane's words go to its right too, clear of the table in the middle.
      p.el.classList.toggle("rcol", (n === 2 && !this.stacked && k === 1) || (n >= 3 && k % 2 === 1));
      p.el.classList.toggle("right", n === 4 && k === 3);
    });
    // The table's box: its width, and where it sits.
    const mb = this.dom.mapbox;
    let mw, mx, my, list = true;
    const listH = (rows) => rows * Math.max(16, 0.026 * h) * 1.25 + 16;
    if (n === 1) { mw = Math.min(w * 0.24, h * 0.42); mx = w - mw - 16; my = h - mw / MAP_ASPECT - listH(4) - 30; }
    else if (n === 2 && !this.stacked) { mw = Math.min(w * 0.22, 420); mx = w / 2 - mw / 2; my = h - mw / MAP_ASPECT - listH(4) - 30; }
    else if (n === 2) { mw = Math.min(w * 0.2, 380); mx = w - mw - 16; my = h / 2 - (mw / MAP_ASPECT + listH(4)) / 2; }
    else if (n === 3) { const r = R.length > 3 ? R[3] : { x: half(w), y: half(h), w: w - half(w), h: h - half(h) }; mw = Math.min(r.w * 0.86, (r.h - listH(4) - 40) * MAP_ASPECT); mx = r.x + (r.w - mw) / 2; my = r.y + (r.h - mw / MAP_ASPECT - listH(4) - 20) / 2; }
    else { mw = Math.min(w * 0.18, 340); mx = w / 2 - mw / 2; my = h / 2 - mw / MAP_ASPECT / 2 - 8; list = false; }
    Object.assign(mb.style, { left: Math.round(mx) + "px", top: Math.round(my) + "px", width: Math.round(mw) + "px" });
    mb.classList.toggle("nolist", !list);
    mb.classList.toggle("cell", n === 3);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.map.size((mw - 16) * dpr, ((mw - 16) / MAP_ASPECT) * dpr);
  }

  /** No 3D on this screen: no panes, the table large in the middle and the places under it. */
  layoutBoard(w, h) {
    const listH = 4 * Math.max(20, 0.045 * h) * 1.25 + 24;
    const mw = Math.max(200, Math.min(w * 0.8, (h - listH - 120) * MAP_ASPECT));
    const mb = this.dom.mapbox;
    Object.assign(mb.style, { left: Math.round((w - mw) / 2) + "px", top: Math.round(Math.max(60, (h - mw / MAP_ASPECT - listH) / 2)) + "px", width: Math.round(mw) + "px" });
    mb.classList.remove("nolist", "cell");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.map.size((mw - 16) * dpr, ((mw - 16) / MAP_ASPECT) * dpr);
  }

  /** Each pane's camera this frame, as views for World.render. */
  views(st, world, dt) {
    return this.rigs.map((rig, k) => { const r = this.rects[k], v = rig.update(st, world, dt, r.w / r.h); Object.assign(v.rect, r); return v; });
  }

  /** The words on each pane, the table and the places. */
  draw(st, order, time, racing) {
    const S = this.say;
    for (const p of this.panes) {
      const c = st.cars[p.i], m = p.memo, place = order.indexOf(c) + 1;
      const set = (node, key, value) => { if (m[key] !== value) { m[key] = value; node.textContent = value; } };
      set(p.name, "name", c.name || "Player");
      set(p.place, "place", S.ORD[place - 1] || "");
      set(p.lap, "lap", c.fin ? "Home" : S.lapText(c, st));
      // Who is near: the car just ahead and just behind, and how far, as on the phone.
      const near = (node, key, o, word) => {
        const d = o && !c.fin && racing ? Math.abs(o.s - c.s) : -1, text = d >= 0 ? `${o.name} ${d < 9.95 ? d.toFixed(1) : Math.round(d)} ${word}` : "";
        if (m[key] === o?.i + text) return;
        m[key] = o?.i + text;
        node.textContent = text;
        if (text) node.prepend(S.dot(o.colour));
      };
      near(p.ahead, "ahead", order[place - 2], "ahead"); near(p.behind, "behind", order[place], "behind");
      // The power in hand: while it unwraps the pictures flick through; then its name.
      let it = c.item || "";
      if (it && c.itemT > 0) it = S.items[Math.floor(time * 14) % S.items.length];
      const ready = !!c.item && !(c.itemT > 0);
      const sig = `${it}|${ready}`;
      if (m.item !== sig) {
        m.item = sig;
        p.heldIco.innerHTML = it ? S.itemSvg(it) : "";
        p.heldName.textContent = ready ? S.itemName(c.item) : it ? "..." : "";
        p.held.classList.toggle("on", !!it); p.held.classList.toggle("ready", ready);
      }
      // Pepper in this player's face greys their pane for a moment.
      const P = S.pepperT, pep = c.pepperT > 2 - P ? ((c.pepperT - (2 - P)) / P).toFixed(2) : "0";
      if (m.pep !== pep) { m.pep = pep; p.pep.style.opacity = pep; }
      // The spring: the drift's charge, or the boost running down.
      if (c.boostT > p.lastBoost + 0.05) p.boostMax = c.boostT;
      p.lastBoost = c.boostT;
      const f = Math.round(100 * (c.boostT > 0 ? clampN(c.boostT / p.boostMax, 0, 1) : c.drOn ? clampN(c.drT / S.drift2, 0, 1) : 0));
      if (m.f !== f) { m.f = f; p.fill.style.width = f + "%"; p.spring.classList.toggle("boost", c.boostT > 0); }
      // A word over the live picture: the house has this player's car (their phone is away), or they are home.
      let note = "", small = "", kind = "";
      if (c.fin) { note = `${S.ORD[c.place - 1] || ""}!`; small = `${c.name} is home`; kind = "home"; }
      else if (c.auto && st.t >= 0) { note = "The house is driving"; small = `${c.name}'s phone is away: it is theirs again when it is back`; kind = "house"; }
      if (m.note !== note + small) {
        m.note = note + small;
        p.noteB.textContent = note; p.noteS.textContent = small;
        p.el.dataset.note = kind;
      }
    }
    if (this.dom.mapbox.offsetParent !== null) {
      this.map.draw(st);
      this.places.draw(st, order, S.lapText);
    }
  }
}
