// The room, drawn: one SVG in world units (lobby/shared/world.js), the same picture on every
// device. The big screen shows all of it; a phone moves the viewBox (lobby/shared/camera.js).
//
// The wall, the boxes and the board are built once. What changes is small: which lights are on,
// who stands where, the count, the toss. Pieces are moved every frame: the player's own from
// its Pilot, everyone else's carried forward from the last thing heard and eased toward it, so
// movement looks smooth whatever the network does.
import { drawArt } from "./art.js";
import { fit, label, s, set, shade } from "./dom.js";
import { BADGES, playersLabel } from "./shared/vote.js";
import { ROOM, boxCentre, boxWidth, jumpHeight, lightHalf, posAt } from "./shared/world.js";

const GREY = "#9b948b";
const BADGE_COLOURS = { any: ["#3db8ff", "#06263a"], phones: ["#b79cf7", "#24124d"], screen: ["#ffc93c", "#3a2a00"] };
const POSTER = { top: 140, height: 300 };
const SIGN_TOP = 454;
/** How quickly another player's piece closes on where it should be (per second). */
const EASE = 14;

export class Scene {
  /**
   * @param {SVGSVGElement} svg  an empty <svg>, already in the page
   * @param {{compact: boolean, own: number, host: string, qr: string}} opts
   *   compact: the bigger, shorter signs and tags a phone needs. own: the viewer's seat, or -1.
   *   host: the address to print under the code. qr: the QR image's address.
   */
  constructor(svg, opts) {
    this.svg = svg;
    this.opts = opts;
    this.boxes = [];
    this.pieces = new Map();
    this.room = null;
    this.vote = null;
    this.voteAt = 0;
    this.tagSize = opts.compact ? 26 : 21;
  }

  // ---------------------------------------------------------------- building

  /** Draws everything that does not move, for this room's boxes. */
  build(room) {
    const svg = this.svg;
    svg.replaceChildren();
    this.pieces.clear();
    const n = room.boxes.length;
    this.n = n;
    this.half = lightHalf(n);
    svg.append(this.defs());
    svg.append(this.backdrop());
    this.layers = { lamps: s("g"), wall: s("g"), cones: s("g"), pools: s("g"), shadows: s("g"), pieces: s("g"), tags: s("g"), over: s("g") };
    for (const layer of Object.values(this.layers)) svg.append(layer);
    this.layers.cones.setAttribute("pointer-events", "none");
    this.joinSign(room);
    this.door();
    this.board();
    this.boxes = room.boxes.map((box, i) => this.box(box, i, n));
    this.overlay();
    // Now that it is all in the page, make every line of text fit its place.
    for (const el of svg.querySelectorAll("[data-fit]")) fit(el, Number(el.dataset.fit));
    for (const b of this.boxes) this.layoutSign(b);
  }

  defs() {
    const stop = (offset, color, opacity = 1) => s("stop", { offset, "stop-color": color, "stop-opacity": opacity });
    return s(
      "defs",
      {},
      s("linearGradient", { id: "g-wall", x1: 0, y1: 0, x2: 0, y2: 1 }, stop(0, "#1d120d"), stop(1, "#150c09")),
      s("linearGradient", { id: "g-floor", x1: 0, y1: 0, x2: 0, y2: 1 }, stop(0, "#3b2217"), stop(0.35, "#2a1710"), stop(1, "#150c08")),
      s("linearGradient", { id: "g-cone", x1: 0, y1: 0, x2: 0, y2: 1 }, stop(0, "#ffd9a0", 0.3), stop(0.55, "#ffd9a0", 0.1), stop(1, "#ffd9a0", 0.06)),
      s("radialGradient", { id: "g-pool" }, stop(0, "#ffe2b0", 0.62), stop(0.6, "#f0b877", 0.3), stop(1, "#c8824a", 0.05)),
      s("radialGradient", { id: "g-pool-hot" }, stop(0, "#fff3d6", 0.95), stop(0.6, "#ffd28a", 0.6), stop(1, "#f0a850", 0.12)),
      s("radialGradient", { id: "g-bulb" }, stop(0, "#ffe9c4", 0.75), stop(1, "#ffe9c4", 0)),
      s("linearGradient", { id: "g-edge-l", x1: 0, y1: 0, x2: 1, y2: 0 }, stop(0, "#080403", 0.82), stop(1, "#080403", 0)),
      s("linearGradient", { id: "g-edge-r", x1: 0, y1: 0, x2: 1, y2: 0 }, stop(0, "#080403", 0), stop(1, "#080403", 0.82)),
      s("linearGradient", { id: "g-coin", x1: 0, y1: 0, x2: 1, y2: 1 }, stop(0, "#ffe07a"), stop(1, "#c98a1b")),
    );
  }

  /** Wall, wainscot, floor and the string of lights. They run on past the room so any screen is filled. */
  backdrop() {
    const g = s("g");
    const [x0, x1] = [-1600, 3520];
    g.append(s("rect", { x: x0, y: -900, width: x1 - x0, height: 1525, fill: "url(#g-wall)" }));
    let planks = "";
    for (let x = x0; x <= x1; x += 64) planks += `M${x},-900V625`;
    g.append(s("path", { d: planks, stroke: "#0d0705", "stroke-width": 2.5, opacity: 0.75 }));
    g.append(s("rect", { x: x0, y: 625, width: x1 - x0, height: 160, fill: "#11302a" }), s("rect", { x: x0, y: 622, width: x1 - x0, height: 6, fill: "#b9853a" }));
    g.append(s("rect", { x: x0, y: 785, width: x1 - x0, height: 1200, fill: "url(#g-floor)" }), s("rect", { x: x0, y: 781, width: x1 - x0, height: 5, fill: "#c9b48a", opacity: 0.45 }));
    let boards = "";
    for (let y = 800, step = 20; y < 1900; y += step, step *= 1.22) boards += `M${x0},${y.toFixed(0)}H${x1}`;
    g.append(s("path", { d: boards, stroke: "#120a07", "stroke-width": 2.5, opacity: 0.7 }));
    // The string of lights: a sagging cable and a bulb every so often.
    const sag = (x) => 50 + 21 * Math.sin((x / 73) * 0.86 + 0.6);
    let cable = "";
    const bulbs = s("g");
    for (let x = -640; x <= 2560; x += 12) cable += `${cable ? "L" : "M"}${x},${(sag(x) - 7).toFixed(1)}`;
    for (let x = -640; x <= 2560; x += 73) {
      bulbs.append(s("circle", { cx: x, cy: sag(x), r: 17, fill: "url(#g-bulb)" }), s("circle", { cx: x, cy: sag(x), r: 6, fill: "#ffeccb" }));
    }
    g.append(s("path", { d: cable, stroke: "#0a0504", "stroke-width": 2, fill: "none" }), bulbs);
    // The room fades out at its ends.
    g.append(s("rect", { x: x0, y: -900, width: -x0 + 4, height: 2900, fill: "#080403", opacity: 0.82 }), s("rect", { x: 0, y: -900, width: 120, height: 2900, fill: "url(#g-edge-l)" }));
    g.append(s("rect", { x: 1916, y: -900, width: x1 - 1916, height: 2900, fill: "#080403", opacity: 0.82 }), s("rect", { x: 1800, y: -900, width: 120, height: 2900, fill: "url(#g-edge-r)" }));
    return g;
  }

  /** "Scan or type the code": the QR code, the four digits and the address, on the wall by the door. */
  joinSign(room) {
    const g = s("g");
    const [x, y, w] = [62, POSTER.top - 7, 212];
    g.append(s("rect", { x, y, width: w, height: 314, rx: 12, fill: "#150d0a", stroke: "#3b2a1f", "stroke-width": 2 }));
    g.append(label("SCAN OR TYPE THE CODE", { x: x + w / 2, y: y + 30, "font-size": 12.5, fill: "#f2a93b", "text-anchor": "middle", "letter-spacing": 2.2, class: "t-mono", "data-fit": w - 24 }));
    g.append(s("rect", { x: x + 28, y: y + 44, width: 156, height: 156, rx: 10, fill: "#f4ead2" }));
    this.qr = s("image", { x: x + 32, y: y + 48, width: 148, height: 148, href: this.opts.qr });
    this.pin = label(room.pin ?? "----", { x: x + w / 2, y: y + 262, "font-size": 66, fill: "#fbf3e2", "text-anchor": "middle", "letter-spacing": 4, class: "t-mono t-bold", "data-fit": w - 24 });
    g.append(this.qr, this.pin);
    g.append(label(this.opts.host, { x: x + w / 2, y: y + 294, "font-size": 14, fill: "#cbb89a", "text-anchor": "middle", class: "t-mono", "data-fit": w - 20 }));
    this.layers.wall.append(g);
  }

  door() {
    const g = s("g");
    g.append(s("rect", { x: 122, y: 498, width: 150, height: 288, fill: "#2a1a12" }), s("rect", { x: 133, y: 509, width: 128, height: 277, fill: "#17352d" }));
    g.append(s("circle", { cx: 197, cy: 584, r: 34, fill: "url(#g-bulb)" }), s("circle", { cx: 197, cy: 584, r: 19, fill: "#ffe6b0", stroke: "#2a1a12", "stroke-width": 4 }), s("circle", { cx: 243, cy: 654, r: 4.5, fill: "#c8963e" }));
    this.layers.wall.append(g);
  }

  /** The Tonight chalkboard. Its rows are filled in by setRoom. */
  board() {
    const [x, y, w, hh] = [1606, POSTER.top - 4, 252, 352];
    const g = s("g");
    g.append(s("rect", { x, y, width: w, height: hh, rx: 6, fill: "#7a4b22" }), s("rect", { x: x + 10, y: y + 10, width: w - 20, height: hh - 20, rx: 2, fill: "#142b26" }));
    g.append(label("Tonight", { x: x + w / 2, y: y + 58, "font-size": 36, fill: "#f3ecd9", "text-anchor": "middle", class: "t-chalk" }));
    g.append(s("rect", { x: x + 28, y: y + 74, width: w - 56, height: 2, fill: "#f3ecd9", opacity: 0.5 }));
    this.boardRows = s("g");
    this.boardFoot = label("", { x: x + w / 2, y: y + hh - 52, "font-size": 17, fill: "#d9d2bf", "text-anchor": "middle", class: "t-chalk" });
    g.append(this.boardRows, this.boardFoot, label("1st 3 pts, 2nd 2, 3rd 1", { x: x + w / 2, y: y + hh - 28, "font-size": 16, fill: "#d9d2bf", "text-anchor": "middle", class: "t-chalk", "data-fit": w - 44 }));
    this.boardBox = { x, y, w };
    this.layers.wall.append(g);
  }

  /** One game box: lamp, cone of light, poster, sign and the pool on the floor. */
  box(box, i, n) {
    const cx = boxCentre(i, n);
    const w = boxWidth(n);
    const x = cx - w / 2;
    const half = this.half;
    const compact = this.opts.compact;
    const b = { box, cx, w, on: null, gold: null };

    b.shade = s("path", { d: `M${cx - 17},62 L${cx + 17},62 L${cx + 54},102 L${cx - 54},102 Z` });
    b.bulb = s("ellipse", { cx, cy: 103, rx: 30, ry: 6 });
    this.layers.lamps.append(s("rect", { x: cx - 2, y: -900, width: 4, height: 962, fill: "#0a0504" }), s("rect", { x: cx - 9, y: 52, width: 18, height: 12, rx: 3, fill: "#0a0504" }), b.shade, b.bulb);

    const frame = s("g");
    frame.append(s("rect", { x: x - 8, y: POSTER.top - 8, width: w + 16, height: POSTER.height + 16, rx: 3, fill: "#120a07", stroke: "#2e1c13", "stroke-width": 2 }));
    const clip = `clip-${i}`;
    frame.append(s("clipPath", { id: clip }, s("rect", { width: w, height: POSTER.height })));
    const art = s("g", { transform: `translate(${x}, ${POSTER.top})`, "clip-path": `url(#${clip})` });
    drawArt(box.art, art, w, POSTER.height, box.name);
    if (box.test) {
      // A corner ribbon, so nobody takes the placeholder for a real game.
      const ribbon = s("g", { transform: `translate(${w - 46}, 46) rotate(45)` });
      ribbon.append(s("rect", { x: -90, y: -14, width: 180, height: 28, fill: "#f6ead2" }), label("TEST GAME", { x: 0, y: 5, "font-size": 14, fill: "#1e1410", "text-anchor": "middle", "letter-spacing": 2, class: "t-mono t-bold" }));
      art.append(ribbon);
    }
    b.dim = s("rect", { width: w, height: POSTER.height, fill: "#0d0705", opacity: 0 });
    art.append(b.dim);
    if (box.soon) {
      art.append(s("rect", { y: POSTER.height - 46, width: w, height: 46, fill: "#120b08", opacity: 0.94 }), label("COMING SOON", { x: w / 2, y: POSTER.height - 17, "font-size": 16, fill: "#f6ead2", "text-anchor": "middle", "letter-spacing": 4, class: "t-mono t-bold", "data-fit": w - 20 }));
    }
    b.goldFrame = s("rect", { x: x - 8, y: POSTER.top - 8, width: w + 16, height: POSTER.height + 16, rx: 3, fill: "none", stroke: "#f4b453", "stroke-width": 6, display: "none" });
    frame.append(art, b.goldFrame);

    // The sign under the poster: name, one line about it, the device badge and how many play.
    const signH = compact ? 132 : 122;
    b.sign = s("rect", { x, y: SIGN_TOP, width: w, height: signH, rx: 7, "stroke-width": 2 });
    b.name = label(box.name, { x: cx, y: SIGN_TOP + (compact ? 54 : 44), "font-size": compact ? 42 : 34, "text-anchor": "middle", class: "t-display", "data-fit": w - 20 });
    b.blurb = label(box.blurb, { x: cx, y: SIGN_TOP + 71, "font-size": 15.5, "text-anchor": "middle", class: "t-ui", "data-fit": w - 20, display: compact ? "none" : null });
    const [badgeFill, badgeInk] = BADGE_COLOURS[box.badge];
    const pillSize = compact ? 23 : 13.5;
    b.badge = pill(BADGES[box.badge], pillSize, badgeFill, badgeInk);
    b.players = label(playersLabel(box.min, box.max), { "font-size": 13.5, fill: "#cdbfa6", class: "t-ui t-semi", display: compact ? "none" : null });
    b.reason = pill("Coming soon", compact ? 21 : 14, "#fbe3da", "#7a1d12");
    b.rowY = SIGN_TOP + (compact ? 96 : 99);
    b.chip = pill("HEADS", compact ? 22 : 16, "#f4b453", "#1e1410");
    set(b.chip.g, { display: "none" });
    frame.append(b.sign, b.name, b.blurb, b.badge.g, b.players, b.reason.g, b.chip.g);
    this.layers.wall.append(frame);

    b.cone = s("polygon", { points: `${cx - 54},102 ${cx + 54},102 ${cx + half + 26},${ROOM.floorY + 8} ${cx - half - 26},${ROOM.floorY + 8}`, fill: "url(#g-cone)" });
    this.layers.cones.append(b.cone);
    b.pool = s("ellipse", { cx, cy: ROOM.floorY + 6, rx: half + 12, ry: 31 });
    b.ring = s("ellipse", { cx, cy: ROOM.floorY + 6, rx: half + 12, ry: 31, fill: "none", "stroke-width": 3 });
    this.layers.pools.append(b.pool, b.ring);
    return b;
  }

  /** Places the badge, the player count or the reason on a sign's bottom row, centred. */
  layoutSign(b) {
    const compact = this.opts.compact;
    sizePill(b.badge);
    sizePill(b.reason);
    sizePill(b.chip);
    place(b.reason, b.cx - b.reason.w / 2, b.rowY);
    place(b.chip, b.cx - b.chip.w / 2, SIGN_TOP - 4);
    if (compact) return place(b.badge, b.cx - b.badge.w / 2, b.rowY);
    const gap = 8;
    const playersW = b.players.getComputedTextLength();
    const left = b.cx - (b.badge.w + gap + playersW) / 2;
    place(b.badge, left, b.rowY);
    set(b.players, { x: left + b.badge.w + gap, y: b.rowY + 4.5 });
  }

  /** What floats over the room: the count ring and the coin toss. */
  overlay() {
    const o = (this.over = {});
    o.count = s("g", { display: "none" });
    o.arc = s("circle", { r: 60, fill: "none", stroke: "#f4b453", "stroke-width": 7, "stroke-linecap": "round", transform: "rotate(-90)" });
    o.digit = label("3", { y: 36, "font-size": 70, fill: "#fbf3e2", "text-anchor": "middle", class: "t-ui t-bold" });
    o.count.append(s("circle", { r: 70, fill: "#120b08", stroke: "#2c1c14", "stroke-width": 2 }), o.arc, label("STARTS IN", { y: -24, "font-size": 12.5, fill: "#f6ead2", "text-anchor": "middle", "letter-spacing": 3, class: "t-mono t-bold" }), o.digit);
    o.toss = s("g", { display: "none" });
    o.tie = label("Tie!", { x: 960, "font-size": 64, fill: "#fbf3e2", "text-anchor": "middle", class: "t-display" });
    o.tiePill = pill("Coin toss decides", 20, "#f4b453", "#1e1410");
    o.coin = s("g");
    o.coinFace = s("g");
    o.coinFace.append(s("circle", { r: 48, fill: "url(#g-coin)", stroke: "#8a5a10", "stroke-width": 4 }), s("circle", { r: 37, fill: "none", stroke: "#a8780f", "stroke-width": 2.5 }));
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const k = i % 2 ? 11 : 25;
      pts.push(`${(Math.cos(a) * k).toFixed(1)},${(Math.sin(a) * k).toFixed(1)}`);
    }
    o.coinFace.append(s("polygon", { points: pts.join(" "), fill: "#a8780f" }));
    o.coin.append(s("circle", { r: 78, fill: "url(#g-bulb)" }), o.coinFace);
    // A dark plate behind the words, so they read over the lamps and the string of lights.
    o.tieBack = s("rect", { width: 320, height: 132, rx: 18, fill: "#120b08", stroke: "#3b2a1f", "stroke-width": 2, opacity: 0.94 });
    o.toss.append(o.tieBack, o.tie, o.tiePill.g, o.coin);
    this.layers.over.append(o.count, o.toss);
    sizePill(o.tiePill);
  }

  // ---------------------------------------------------------------- what changes

  /** The room changed: who is here, the code, the board. */
  setRoom(room, now) {
    this.room = room;
    this.pin.textContent = room.pin ?? "----";
    const seen = new Set();
    for (const m of room.members) {
      if (!m) continue;
      seen.add(m.seat);
      let p = this.pieces.get(m.seat);
      if (!p || p.leaving) {
        if (p) this.removePiece(p);
        p = this.piece(m);
        this.pieces.set(m.seat, p);
      }
      // The room's word on where a piece is: news for everyone's piece but the viewer's own,
      // which is moved by its Pilot.
      p.net = { x: m.x, d: m.d, t: now };
      if (m.d) p.face = m.d;
      if (p.rev !== m.rev) p.rx = m.x; // the room put it somewhere: no sliding across the floor
      p.rev = m.rev;
      this.dress(p, m);
    }
    for (const [seat, p] of this.pieces) {
      if (!seen.has(seat) && !p.leaving) p.leaving = now;
    }
    this.fillBoard(room);
    this.setVote(room.vote, now);
  }

  setVote(vote, now) {
    this.vote = vote;
    this.voteAt = now;
    for (const b of this.boxes) {
      const why = vote.lights[b.box.id];
      const on = why === null && this.room.phase === "lobby";
      if (b.on !== on || b.why !== why) {
        b.on = on;
        b.why = why;
        set(b.shade, { fill: on ? "#8a231d" : "#3a1512" });
        set(b.bulb, { fill: on ? "#ffe2a8" : "#2a1a14" });
        set(b.cone, { display: on ? null : "none" });
        set(b.dim, { opacity: on ? 0 : 0.58 });
        set(b.badge.g, { display: why ? "none" : null, opacity: on ? 1 : 0.5 });
        set(b.players, { display: why || this.opts.compact ? "none" : null });
        set(b.reason.g, { display: why ? null : "none" });
        if (why) {
          b.reason.text.textContent = why;
          sizePill(b.reason);
          place(b.reason, b.cx - b.reason.w / 2, b.rowY);
        }
      }
    }
    this.paint(now);
  }

  /** Signs, pools and frames in the colours of the moment: plain, off, leading (gold) or tied. */
  paint(now) {
    const vote = this.vote;
    const tossLeft = vote.toss ? vote.toss.endsIn - (now - this.voteAt) : 0;
    const landed = vote.toss && tossLeft < vote.toss.of * 0.3;
    for (const b of this.boxes) {
      const id = b.box.id;
      const here = Object.values(vote.standing).filter((v) => v === id).length;
      const leading = !!vote.count && vote.leaders.length === 1 && vote.leaders[0] === id;
      const tied = !!vote.toss && vote.toss.between.includes(id);
      const gold = leading || (tied && landed && vote.toss.winner === id);
      const key = `${b.on}/${here > 0}/${gold}/${tied}/${landed}`;
      if (b.key === key) continue;
      b.key = key;
      set(b.pool, { fill: b.on ? (here ? "url(#g-pool-hot)" : "url(#g-pool)") : "none", opacity: b.on ? 1 : 0 });
      set(b.ring, { stroke: gold ? "#f4b453" : b.on ? "#ffe2b0" : "#f6ead2", opacity: gold ? 1 : b.on ? (here ? 0.75 : 0.3) : 0.13 });
      set(b.cone, { opacity: here || gold ? 1 : 0.62 });
      set(b.sign, { fill: gold ? "#f4b453" : "#17100c", stroke: gold ? "#f4b453" : tied ? "#f4b453" : "#3b2a1f", "stroke-dasharray": b.on || !b.why ? null : "7 6", opacity: 0.97 });
      const ink = gold ? "#1e1410" : "#fbf3e2";
      const fade = b.on || gold ? 1 : 0.45;
      set(b.name, { fill: ink, opacity: fade });
      set(b.blurb, { fill: gold ? "#3a2a1c" : "#cdbfa6", opacity: fade });
      set(b.players, { fill: gold ? "#3a2a1c" : "#cdbfa6" });
      set(b.goldFrame, { display: gold ? null : "none" });
      set(b.chip.g, { display: tied && !landed ? null : "none" });
      if (tied) {
        const names = vote.toss.between.length === 2 ? ["HEADS", "TAILS"] : ["A", "B", "C", "D", "E"];
        b.chip.text.textContent = names[vote.toss.between.indexOf(id)];
        sizePill(b.chip);
        place(b.chip, b.cx - b.chip.w / 2, SIGN_TOP - 4);
      }
    }
  }

  fillBoard(room) {
    const { x, w } = this.boardBox;
    const rows = room.members.filter(Boolean).sort((a, b) => b.points - a.points || a.seat - b.seat);
    this.boardRows.replaceChildren();
    const fresh = room.last && room.last.ago < 9000 ? new Map(room.last.rows.map((r) => [r.seat, r.points])) : new Map();
    rows.forEach((m, i) => {
      const y = POSTER.top + 124 + i * 46;
      const name = label(m.name, { x: x + 76, y, "font-size": 27, fill: "#f3ecd9", class: "t-chalk" });
      this.boardRows.append(
        label(String(i + 1), { x: x + 30, y, "font-size": 21, fill: "#d9d2bf", class: "t-chalk", opacity: 0.8 }),
        s("circle", { cx: x + 58, cy: y - 9, r: 8, fill: m.connected ? shade(m.colour, 0.18) : GREY, stroke: "#f3ecd9", "stroke-width": 1.5 }),
        name,
        label(String(m.points), { x: x + w - 30, y, "font-size": 30, fill: fresh.get(m.seat) ? "#ffd75e" : "#f3ecd9", "text-anchor": "end", class: "t-chalk" }),
      );
      fit(name, w - 76 - 66);
    });
    if (!rows.length) this.boardRows.append(label("Nobody yet", { x: x + w / 2, y: POSTER.top + 150, "font-size": 22, fill: "#d9d2bf", "text-anchor": "middle", class: "t-chalk", opacity: 0.8 }));
    const games = room.tonight.games;
    this.boardFoot.textContent = games === 0 ? "no games yet" : `after ${games} ${games === 1 ? "game" : "games"}`;
  }

  // ---------------------------------------------------------------- pieces

  /** A pawn in a seat's colour, with a shadow and a name tag. */
  piece(m) {
    const p = { seat: m.seat, rx: m.x, net: { x: m.x, d: m.d, t: 0 }, face: 1, rev: m.rev, jumpAt: -Infinity, lungeAt: -Infinity, lungeDir: 1, hitAt: -Infinity, leaving: 0, level: 0, look: "" };
    p.shadow = s("ellipse", { cy: ROOM.floorY + 5, rx: 40, ry: 9, fill: "#000", opacity: 0.42 });
    p.base = s("ellipse", { cx: 0, cy: -8, rx: 39, ry: 11.5 });
    p.body = s("path", { d: "M-32,-10 C-31,-36 -15,-54 -13.5,-84 L13.5,-84 C15,-54 31,-36 32,-10 Z" });
    p.collar = s("ellipse", { cx: 0, cy: -84, rx: 22, ry: 8 });
    p.head = s("circle", { cx: 0, cy: -113, r: 28 });
    p.eyes = s("g", {}, s("ellipse", { cx: -9, cy: -113, rx: 3.8, ry: 5.6, fill: "#1a1210" }), s("ellipse", { cx: 9, cy: -113, rx: 3.8, ry: 5.6, fill: "#1a1210" }), s("circle", { cx: -8, cy: -115.5, r: 1.3, fill: "#fff" }), s("circle", { cx: 10, cy: -115.5, r: 1.3, fill: "#fff" }));
    p.star = s("g", { display: "none" }, label("!", { x: 0, y: -160, "font-size": 40, fill: "#ffd75e", "text-anchor": "middle", class: "t-display" }));
    p.g = s("g", {}, p.base, p.body, p.collar, p.head, s("ellipse", { cx: -10, cy: -125, rx: 9, ry: 6, fill: "#fff", opacity: 0.26 }), p.eyes, p.star);
    p.tagBack = s("rect", { rx: (this.tagSize + 14) / 2, "stroke-width": 1.5 });
    p.tagDot = s("circle", { r: this.tagSize * 0.3 });
    p.tagText = label("", { "font-size": this.tagSize, class: "t-ui t-semi" });
    p.tagTip = s("path", { d: "M-8,0 L8,0 L0,9 Z", display: "none" });
    p.tag = s("g", {}, p.tagBack, p.tagTip, p.tagDot, p.tagText);
    this.layers.shadows.append(p.shadow);
    this.layers.pieces.append(p.g);
    this.layers.tags.append(p.tag);
    return p;
  }

  /** Colours and names a piece for how its player is doing: here, or dropped and expected back. */
  dress(p, m) {
    const own = m.seat === this.opts.own;
    const look = `${m.name}/${m.connected}/${own}`;
    if (p.look === look) return;
    p.look = look;
    const colour = m.connected ? shade(m.colour, 0.16) : GREY;
    set(p.base, { fill: m.connected ? shade(m.colour, -0.28) : "#6f6a63" });
    set(p.body, { fill: colour });
    set(p.collar, { fill: m.connected ? shade(m.colour, 0.3) : "#b5afa6" });
    set(p.head, { fill: colour });
    set(p.g, { opacity: m.connected ? 1 : 0.85 });
    p.tagText.textContent = own ? "You" : m.connected ? m.name : `${m.name} - reconnecting...`;
    set(p.tagText, { fill: own ? "#1e1410" : "#fbf3e2", "font-style": m.connected ? null : "italic" });
    set(p.tagBack, { fill: own ? "#fbf3e2" : "#17100c", stroke: own ? "#fbf3e2" : "#3b2a1f", opacity: 0.96 });
    set(p.tagTip, { display: own ? null : "none", fill: "#fbf3e2" });
    set(p.tagDot, { fill: m.connected ? shade(m.colour, 0.16) : GREY, stroke: own ? "#1e1410" : "none", "stroke-width": 1.5 });
    // Lay the tag out around its own middle.
    const size = this.tagSize;
    const padX = size * 0.62;
    const dot = size * 0.3;
    const textW = p.tagText.getComputedTextLength();
    const w = padX + dot * 2 + size * 0.36 + textW + padX;
    const hh = size + 14;
    p.tagW = w;
    set(p.tagBack, { x: -w / 2, y: -hh, width: w, height: hh });
    set(p.tagDot, { cx: -w / 2 + padX + dot, cy: -hh / 2 });
    set(p.tagText, { x: -w / 2 + padX + dot * 2 + size * 0.36, y: -hh / 2 + size * 0.35 });
  }

  removePiece(p) {
    p.shadow.remove();
    p.g.remove();
    p.tag.remove();
  }

  /** Someone moved: where they are and which way they walk, as of now. */
  onMove(msg, now) {
    const p = this.pieces.get(msg.s);
    if (!p) return;
    p.net = { x: msg.x, d: msg.d, t: now };
    if (msg.d) p.face = msg.d;
    if (msg.j) p.jumpAt = now;
  }

  /** A bump: the bumper lunges, and whoever it lands on is knocked along. */
  onBump(msg, now) {
    const by = this.pieces.get(msg.s);
    if (by) {
      by.lungeAt = now;
      by.lungeDir = msg.f || 1;
      by.face = msg.f || by.face;
    }
    const hit = msg.to >= 0 ? this.pieces.get(msg.to) : null;
    if (hit) {
      hit.net = { x: msg.x, d: hit.net.d, t: now };
      hit.rev = msg.rev;
      hit.hitAt = now;
    }
  }

  /** The viewer's own piece jumped (its Pilot says so; nothing comes back from the room). */
  ownJump(now) {
    const p = this.pieces.get(this.opts.own);
    if (p) p.jumpAt = now;
  }

  /** Where the viewer's own piece is drawn, for the camera. */
  ownX() {
    return this.pieces.get(this.opts.own)?.rx ?? 960;
  }

  /**
   * Draws one frame. `own` is the viewer's Pilot (or null for a screen), `view` the camera's
   * viewBox, so things that must stay in sight (the count) can be kept inside it.
   */
  frame(now, dt, own, view) {
    const ordered = [];
    for (const [seat, p] of this.pieces) {
      if (p.leaving) {
        const gone = (now - p.leaving) / 900;
        if (gone >= 1) {
          this.removePiece(p);
          this.pieces.delete(seat);
          continue;
        }
        set(p.g, { opacity: (1 - gone) * 0.8 });
        set(p.tag, { opacity: 1 - gone });
        set(p.shadow, { opacity: 0.42 * (1 - gone) });
      }
      let walking = false;
      if (own && seat === this.opts.own) {
        p.rx = own.x;
        p.face = own.face;
        walking = own.d !== 0 && own.x > ROOM.minX && own.x < ROOM.maxX;
      } else {
        const target = posAt(p.net, now);
        p.rx += (target - p.rx) * (1 - Math.exp(-dt * EASE));
        if (Math.abs(target - p.rx) < 0.3) p.rx = target;
        walking = p.net.d !== 0 && target > ROOM.minX && target < ROOM.maxX;
      }
      const up = jumpHeight(now - p.jumpAt);
      const bob = walking && !up ? Math.abs(Math.sin(now / 95)) * 5 : 0;
      const lunge = Math.max(0, 1 - (now - p.lungeAt) / 190) * 24 * p.lungeDir;
      const hit = now - p.hitAt < 420;
      const tilt = hit ? Math.sin(((now - p.hitAt) / 420) * Math.PI) * 9 * (p.net.x > p.rx ? 1 : -1) : 0;
      set(p.g, { transform: `translate(${(p.rx + lunge).toFixed(1)}, ${(ROOM.floorY - up - bob).toFixed(1)}) rotate(${tilt.toFixed(1)})` });
      set(p.eyes, { transform: `translate(${p.face * 5}, 0)` });
      set(p.star, { display: hit ? null : "none" });
      const squeeze = 1 - Math.min(0.45, up / 260);
      set(p.shadow, { cx: p.rx.toFixed(1), rx: (40 * squeeze).toFixed(1), ry: (9 * squeeze).toFixed(1) });
      p.up = up + bob;
      ordered.push(p);
    }
    // Name tags that would sit on top of each other step up instead.
    ordered.sort((a, b) => a.rx - b.rx);
    let prev = null;
    for (const p of ordered) {
      const want = prev && p.rx - prev.rx < (p.tagW + prev.tagW) / 2 + 8 ? (prev.want + 1) % 4 : 0;
      p.want = want;
      p.level += (want - p.level) * Math.min(1, dt * 12);
      set(p.tag, { transform: `translate(${p.rx.toFixed(1)}, ${(ROOM.floorY - 156 - p.up - p.level * (this.tagSize + 20)).toFixed(1)})` });
      prev = p;
    }
    this.paint(now);
    this.drawCount(now, view);
    this.drawToss(now, view);
  }

  drawCount(now, view) {
    const vote = this.vote;
    const o = this.over;
    if (!vote?.count || this.room.phase !== "lobby") return void set(o.count, { display: "none" });
    const left = Math.max(0, vote.count.endsIn - (now - this.voteAt));
    const b = vote.leaders.length === 1 ? this.boxes.find((x) => x.box.id === vote.leaders[0]) : null;
    // Over the leading box's lamp, or over the middle of the room for a tie, and always in view.
    const k = this.opts.compact ? 1.35 : 1;
    const x = Math.min(view.x + view.width - 80 * k, Math.max(view.x + 80 * k, b ? b.cx + b.w / 2 - 6 : 960));
    const y = Math.max(view.y + 84 * k, 122);
    set(o.count, { display: null, transform: `translate(${x.toFixed(1)}, ${y.toFixed(1)}) scale(${k})` });
    const round = 2 * Math.PI * 60;
    set(o.arc, { "stroke-dasharray": `${((left / 3000) * round).toFixed(1)} ${round.toFixed(1)}` });
    o.digit.textContent = String(Math.max(1, Math.ceil(left / 1000)));
  }

  drawToss(now, view) {
    const vote = this.vote;
    const o = this.over;
    if (!vote?.toss) return void set(o.toss, { display: "none" });
    const toss = vote.toss;
    const u = Math.min(1, Math.max(0, 1 - (toss.endsIn - (now - this.voteAt)) / toss.of));
    const centres = toss.between.map((id) => this.boxes.find((b) => b.box.id === id)?.cx ?? 960);
    const mid = (Math.min(...centres) + Math.max(...centres)) / 2;
    const win = centres[toss.between.indexOf(toss.winner)];
    const top = Math.max(view.y + 20, 0);
    set(o.toss, { display: null });
    const at = Math.min(view.x + view.width - 170, Math.max(view.x + 170, mid));
    set(o.tieBack, { x: at - 160, y: top + 4 });
    set(o.tie, { x: at, y: top + 70 });
    place(o.tiePill, at - o.tiePill.w / 2, top + 104);
    // The coin spins in the air between the tied boxes, then comes down on the winner.
    const fall = Math.max(0, (u - 0.62) / 0.38);
    const ease = fall * fall * (3 - 2 * fall);
    const x = mid + (win - mid) * ease;
    const y = Math.max(view.y + 215, 250) - Math.sin(Math.min(1, u / 0.62) * Math.PI) * 60 + ease * 40;
    const spin = u < 0.7 ? Math.cos(u * 46) : 1;
    set(o.coin, { transform: `translate(${x.toFixed(1)}, ${y.toFixed(1)})` });
    set(o.coinFace, { transform: `scale(1, ${(Math.abs(spin) * 0.92 + 0.08).toFixed(3)})` });
  }
}

/** A rounded label: {g, back, text, w, h}. Its size is worked out by sizePill once it is in the page. */
function pill(text, size, fill, ink) {
  const back = s("rect", { fill });
  const t = label(text, { "font-size": size, fill: ink, class: "t-ui t-bold" });
  return { g: s("g", {}, back, t), back, text: t, size, w: 0, h: 0 };
}

function sizePill(p) {
  const padX = p.size * 0.72;
  p.h = Math.round(p.size * 1.62);
  p.w = p.text.getComputedTextLength() + padX * 2;
  set(p.back, { width: p.w, height: p.h, rx: p.h / 2, y: -p.h / 2 });
  set(p.text, { x: padX, y: p.size * 0.35 });
}

/** Puts a pill's left edge at x and its middle at y. */
function place(p, x, y) {
  set(p.g, { transform: `translate(${x.toFixed(1)}, ${y.toFixed(1)})` });
}

