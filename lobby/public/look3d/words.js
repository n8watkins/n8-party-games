// Every word in the 3D look: the join sign, the Tonight board, the signs under the boxes, the
// name tags, the count and the coin toss banner.
//
// The words are HTML, never drawn into the 3D picture, so they are as sharp as the device can
// make them at any size. They are laid out in the room's own world units (lobby/shared/world.js)
// and sized by one number, --k: screen pixels per world unit. Because the camera only ever
// slides and scales the picture (look3d/space.js), the layer of words on the wall follows it
// with one translate, and the tags follow their pieces along the walking line the same way.
import { h } from "../dom.js";
import { BADGES, playersLabel } from "../shared/vote.js";
import { FEET_Y, worldX } from "./space.js";
import { PAWN_HEIGHT } from "./pieces.js";

const BADGE_CLASS = { any: "any", phones: "phones", screen: "screen" };
const SVG = "http://www.w3.org/2000/svg";
/** The middle of the join sign and of the Tonight board, in world units: clear of the first and last box. */
const JOIN_X = 181;
const BOARD_X = 1722;

/** Puts an element's corner at a world position inside a layer sized by --k. */
function at(el, x, y, w = null) {
  el.style.left = `calc(var(--k) * ${x.toFixed(1)}px)`;
  el.style.top = `calc(var(--k) * ${y.toFixed(1)}px)`;
  if (w !== null) el.style.width = `calc(var(--k) * ${w.toFixed(1)}px)`;
  return el;
}

export class Words {
  /**
   * @param {HTMLElement} root  the 3D look's own element
   * @param {{compact: boolean, own: number, host: string, qr: string}} opts
   * @param {object} skin       look3d/skins.js
   */
  constructor(root, opts, skin) {
    this.root = root;
    this.opts = opts;
    this.skin = skin;
    this.wall = h("div", "l3-wall", "", root);
    this.tags = h("div", "l3-tags", "", root);
    this.over = h("div", "l3-over", "", root);
    this.signs = [];
    this.k = 0;
    this.needsFit = true;
    for (const [name, value] of Object.entries(skin.words?.vars ?? {})) root.style.setProperty(name, value);
    root.classList.toggle("l3-led", !!skin.words?.led);
    root.classList.toggle("l3-neon", !!skin.words?.neon);
    root.classList.toggle("l3-compact", !!opts.compact);
    // Lettering that arrives late changes how wide the words are.
    this.refit = () => (this.needsFit = true);
    document.fonts.addEventListener("loadingdone", this.refit);
  }

  // ---------------------------------------------------------------- building

  build(room, L) {
    this.L = L;
    this.wall.replaceChildren();
    this.over.replaceChildren();
    this.joinSign(room);
    this.board();
    this.signs = room.boxes.map((box, i) => this.sign(box, i));
    this.overlay();
    this.needsFit = true;
  }

  /** "Scan or type the code": the QR code, the four digits and the address, over the door. */
  joinSign(room) {
    const el = at(h("div", "l3-join", "", this.wall), JOIN_X - 106, 133, 212);
    h("small", "", "Scan or type the code", el);
    const qr = h("img", "l3-qr", "", el);
    qr.alt = "";
    qr.src = this.opts.qr;
    this.pin = h("div", "l3-pin", room.pin ?? "----", el);
    h("div", "l3-addr l3-fit", this.opts.host, el);
  }

  /** The Tonight board. Its rows are filled in by setRoom. */
  board() {
    const el = at(h("div", "l3-board", "", this.wall), BOARD_X - 118, 136, 236);
    h("h3", "", "Tonight", el);
    h("div", "l3-rule", "", el);
    this.rows = h("div", "l3-rows", "", el);
    this.foot = h("small", "", "", el);
    // The board can be opened: tapping it calls the page (opts.onBoard), as the flat drawing's does.
    if (!this.opts.onBoard) return;
    el.classList.add("l3-opens");
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", "Open the Tonight board");
    h("span", "l3-open-mark", "", el);
    el.addEventListener("click", () => this.opts.onBoard());
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      this.opts.onBoard();
    });
  }

  /**
   * The sign under a box: one line about the game, how many play and the device badge. The
   * game's name is on its box and nowhere else, as on the flat wall.
   */
  sign(box, i) {
    const L = this.L;
    const el = at(h("div", `l3-sign n${i % 6}`, "", this.wall), worldX(L.xs[i]) - L.signW / 2, L.signTop, L.signW);
    const sign = { box, el, key: "" };
    sign.chip = h("span", "l3-chip", "", el);
    sign.chip.hidden = true;
    if (box.blurb) h("span", "l3-about", box.blurb, el);
    sign.row = h("span", "l3-row l3-fits", "", el);
    sign.seats = h("span", "l3-seats", playersLabel(box.min, box.max), sign.row);
    sign.badge = h("span", `l3-need ${BADGE_CLASS[box.badge] ?? "any"}`, BADGES[box.badge] ?? "", sign.row);
    sign.why = h("span", "l3-why", "", sign.row);
    sign.why.hidden = true;
    return sign;
  }

  /** What floats over the room: the count ring and the coin toss's banner. */
  overlay() {
    const count = (this.count = h("div", "l3-count", "", this.over));
    count.hidden = true;
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    const circle = (cls) => {
      const c = document.createElementNS(SVG, "circle");
      for (const [key, value] of Object.entries({ cx: 50, cy: 50, r: 43, class: cls })) c.setAttribute(key, value);
      svg.append(c);
      return c;
    };
    circle("l3-count-back");
    this.arc = circle("l3-count-arc");
    this.arc.setAttribute("transform", "rotate(-90 50 50)");
    count.append(svg);
    h("small", "", "Starts in", count);
    this.digit = h("b", "", "3", count);
    const toss = (this.toss = h("div", "l3-toss", "", this.over));
    toss.hidden = true;
    h("b", "", "Tie!", toss);
    h("span", "", "Coin toss decides", toss);
  }

  // ---------------------------------------------------------------- what changes

  setCompact(compact) {
    this.opts.compact = compact;
    this.root.classList.toggle("l3-compact", compact);
    this.needsFit = true;
  }

  setRoom(room) {
    this.pin.textContent = room.pin ?? "----";
    const rows = room.members.filter(Boolean).sort((a, b) => b.points - a.points || a.seat - b.seat);
    const fresh = room.last && room.last.ago < 9000 ? new Map(room.last.rows.map((r) => [r.seat, r.points])) : new Map();
    this.rows.replaceChildren();
    rows.forEach((m, i) => {
      const line = h("div", "l3-line", "", this.rows);
      h("u", "", String(i + 1), line);
      h("i", m.connected ? "" : "grey", "", line).style.background = m.connected ? m.colour : "";
      h("span", "l3-name", m.name, line);
      h("s", fresh.get(m.seat) ? "fresh" : "", String(m.points), line);
    });
    if (!rows.length) h("div", "l3-nobody", "Nobody yet", this.rows);
    const games = room.tonight.games;
    this.foot.replaceChildren(games === 0 ? "no games yet" : `after ${games} ${games === 1 ? "game" : "games"}`, document.createElement("br"), "1st 3 pts, 2nd 2, 3rd 1");
  }

  /**
   * Signs in the colours of the moment. `states` is one per box:
   * {on, why, here, gold, tied, landed, side}.
   */
  paint(states) {
    states.forEach((st, i) => {
      const sign = this.signs[i];
      const key = `${st.on}/${st.why}/${st.gold}/${st.tied}/${st.landed}/${st.side}`;
      if (!sign || sign.key === key) return;
      sign.key = key;
      this.needsFit = true;
      sign.el.classList.toggle("shut", !st.on && !!st.why && !st.gold);
      sign.el.classList.toggle("off", !st.on && !st.why && !st.gold);
      sign.el.classList.toggle("lead", st.gold);
      sign.el.classList.toggle("tied", st.tied && !st.gold);
      sign.badge.hidden = !!st.why;
      sign.seats.hidden = !!st.why;
      sign.why.hidden = !st.why;
      sign.why.textContent = st.why ?? "";
      sign.chip.hidden = !(st.tied && !st.landed);
      sign.chip.textContent = st.side ?? "";
    });
  }

  // ---------------------------------------------------------------- name tags

  /** A name tag for a piece: {el}. */
  tag() {
    const el = h("div", "l3-tag", "", this.tags);
    const dot = h("i", "", "", el);
    const text = h("span", "", "", el);
    return { el, dot, text, w: 0, look: "" };
  }

  dressTag(tag, m) {
    const own = m.seat === this.opts.own;
    const look = `${m.name}/${m.connected}/${own}/${this.opts.compact}`;
    if (tag.look === look) return;
    tag.look = look;
    tag.text.textContent = own ? "You" : m.connected ? m.name : `${m.name} - reconnecting...`;
    tag.el.classList.toggle("you", own);
    tag.el.classList.toggle("grey", !m.connected);
    tag.dot.style.background = m.connected ? m.colour : "";
    tag.w = 0;
  }

  /** Puts a tag over its piece. `x` is the piece's world x, `up` how far its head is above standing, `level` how many tags it has stepped over. */
  placeTag(tag, view, x, up, level, shock, alpha) {
    const k = view.scale;
    // Measured once per look, in world units, so tags that would overlap can step up.
    if (!tag.w) tag.w = tag.el.offsetWidth / k;
    if (!tag.h) tag.h = tag.el.offsetHeight / k;
    const y = FEET_Y - PAWN_HEIGHT - 16 - up - level * (tag.h + 6);
    tag.el.style.transform = `translate(${((x - view.x) * k).toFixed(1)}px, ${((y - view.y) * k).toFixed(1)}px) translate(-50%, -100%)`;
    if (tag.shock !== shock) tag.el.classList.toggle("hit", (tag.shock = shock));
    if (tag.alpha !== alpha) tag.el.style.opacity = String((tag.alpha = alpha));
  }

  // ---------------------------------------------------------------- every frame

  /** Slides the words to where the camera looks. Returns true when the view changed. */
  frame(view) {
    const k = view.scale;
    if (Math.abs(k - this.k) > 1e-5) {
      this.k = k;
      this.root.style.setProperty("--k", k.toFixed(5));
      this.movedKey = "";
    }
    const key = `${(view.x * k).toFixed(1)},${(view.y * k).toFixed(1)}`;
    const moved = key !== this.movedKey;
    if (moved) {
      this.movedKey = key;
      this.wall.style.transform = `translate(${(-view.x * k).toFixed(1)}px, ${(-view.y * k).toFixed(1)}px)`;
    }
    if (this.needsFit) this.fit();
    return moved;
  }

  /** Makes every line marked to fit its place fit it, whatever font the device has. */
  fit() {
    this.needsFit = false;
    for (const el of this.wall.querySelectorAll(".l3-fit, .l3-fits")) {
      el.style.removeProperty("--fit");
      const room = el.clientWidth;
      const need = el.scrollWidth;
      if (room > 0 && need > room) el.style.setProperty("--fit", (Math.floor(((room - 2) / need) * 96) / 100).toFixed(2));
    }
  }

  /** The count ring: over the corner of the leading box, or the middle of the room for a tie, and always in view. */
  drawCount(view, left, total, cx) {
    if (left === null) return void (this.count.hidden = true);
    const k = view.scale;
    const big = this.opts.compact ? 1.35 : 1;
    const x = Math.min(view.x + view.width - 80 * big, Math.max(view.x + 80 * big, cx));
    const y = Math.max(view.y + 84 * big, 122);
    this.count.hidden = false;
    this.count.style.transform = `translate(${((x - view.x) * k).toFixed(1)}px, ${((y - view.y) * k).toFixed(1)}px) translate(-50%, -50%)`;
    const round = 2 * Math.PI * 43;
    this.arc.setAttribute("stroke-dasharray", `${((left / total) * round).toFixed(1)} ${round.toFixed(1)}`);
    const digit = String(Math.max(1, Math.ceil(left / 1000)));
    if (this.digit.textContent !== digit) this.digit.textContent = digit;
  }

  /** The banner over a coin toss, between the tied boxes. */
  drawToss(view, mid) {
    if (mid === null) return void (this.toss.hidden = true);
    const k = view.scale;
    const x = Math.min(view.x + view.width - 170, Math.max(view.x + 170, mid));
    const y = Math.max(view.y + 20, 0) + 8;
    this.toss.hidden = false;
    this.toss.style.transform = `translate(${((x - view.x) * k).toFixed(1)}px, ${((y - view.y) * k).toFixed(1)}px) translate(-50%, 0)`;
  }

  destroy() {
    document.fonts.removeEventListener("loadingdone", this.refit);
    this.wall.remove();
    this.tags.remove();
    this.over.remove();
  }
}
