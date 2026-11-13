// The room, drawn: one SVG in world units (lobby/shared/world.js), the same picture on every
// device. The big screen shows all of it; a phone moves the viewBox (lobby/shared/camera.js).
//
// The wall, the boxes and the board are built once. What changes is small: which lights are on,
// who stands where, the count, the toss. Pieces are moved every frame: the player's own from
// its Pilot, everyone else's carried forward from the last thing heard and eased toward it, so
// movement looks smooth whatever the network does.
import { drawArt } from "./art.js";
import { BumpDraw, poseTransform } from "./bump-draw.js";
import { fit, label, s, set, shade } from "./dom.js";
import { Expressions, poseTop } from "./emotes/play.js";
import { EmoteFigure, Sticker, bodyTransform } from "./emotes/svg.js";
import { IMPACT_MS } from "./shared/bump.js";
import { standings } from "./shared/tonight.js";
import { BADGES, COUNT_MS, playersLabel } from "./shared/vote.js";
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
    /** Who is doing which emote (emotes/play.js). */
    this.expressions = new Expressions();
    this.calmQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
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
    this.layers = { lamps: s("g"), wall: s("g"), cones: s("g"), pools: s("g"), shadows: s("g"), pieces: s("g"), emotes: s("g"), tags: s("g"), stickers: s("g"), over: s("g") };
    for (const layer of Object.values(this.layers)) svg.append(layer);
    this.layers.cones.setAttribute("pointer-events", "none");
    this.joinSign(room);
    this.door();
    this.board();
    this.signs = this.planSigns(room.boxes, boxWidth(n));
    this.boxes = room.boxes.map((box, i) => this.box(box, i, n));
    this.overlay();
    this.bumpLayer();
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
    this.boardButton(g, x, y, w, hh);
  }

  /**
   * The board is a button: tapping or clicking it (or Enter on it) asks for the large view
   * (opts.onBoard). A small mark in its corner says so.
   */
  boardButton(g, x, y, w, hh) {
    if (!this.opts.onBoard) return;
    g.append(s("path", { d: `M${x + w - 44},${y + 24} h14 v14 M${x + w - 30},${y + 24} l-13,13`, fill: "none", stroke: "#f3ecd9", "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.7 }));
    const hit = s("rect", { x, y, width: w, height: hh, rx: 6, fill: "#000", "fill-opacity": 0, class: "board-hit", role: "button", tabindex: 0, "aria-label": "Open the Tonight board" });
    hit.addEventListener("click", () => this.opts.onBoard());
    hit.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      this.opts.onBoard();
    });
    g.append(hit);
  }

  /** Where the bump's bursts and dust are drawn (over the pieces, under their name tags), and the ring under the viewer's piece. */
  bumpLayer() {
    const fx = s("g");
    this.layers.tags.before(fx);
    this.bumps = new BumpDraw({ fx, floor: this.layers.shadows });
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
    // A band across the foot of the poster says what kind of box it is, when it is not a game
    // that simply starts here: not built yet, or played on a site of its own.
    const band = (text, spacing) => [
      s("rect", { y: POSTER.height - 46, width: w, height: 46, fill: "#120b08", opacity: 0.94 }),
      label(text, { x: w / 2, y: POSTER.height - 17, "font-size": 16, fill: "#f6ead2", "text-anchor": "middle", "letter-spacing": spacing, class: "t-mono t-bold", "data-fit": w - 20 }),
    ];
    if (box.url) art.append(...band(box.url.startsWith("https://") ? "ON ITS OWN SITE" : "ON ITS OWN PAGE", 3));
    b.dim = s("rect", { width: w, height: POSTER.height, fill: "#0d0705", opacity: 0 });
    art.append(b.dim);
    if (box.soon) art.append(...band("COMING SOON", 4));
    b.goldFrame = s("rect", { x: x - 8, y: POSTER.top - 8, width: w + 16, height: POSTER.height + 16, rx: 3, fill: "none", stroke: "#f4b453", "stroke-width": 6, display: "none" });
    frame.append(art, b.goldFrame);

    // The sign under the poster: one line about the game, the device badge and how many play.
    // The game's name is on the poster and nowhere else. Every sign on a wall is laid out alike
    // (this.signs, worked out once for the wall): the line of words broken to fit, then how many
    // play and the device badge, side by side where there is room and one above the other where not.
    const plan = this.signs;
    const lines = plan.lines ? wrap(box.blurb, plan.chars) : [];
    const firstY = SIGN_TOP + (compact ? 33 : 30) + ((plan.lines - lines.length) * plan.step) / 2;
    b.blurbs = lines.map((line, k) => label(line, { x: cx, y: firstY + k * plan.step, "font-size": plan.size, "text-anchor": "middle", class: "t-ui t-semi", "data-fit": w - 18 }));
    b.rowY = SIGN_TOP + (plan.lines ? (compact ? 33 : 30) + (plan.lines - 1) * plan.step + (compact ? 34 : 30) : compact ? 30 : 24);
    b.rowY2 = plan.stacked ? b.rowY + (compact ? 40 : 27) : b.rowY;
    b.sign = s("rect", { x, y: SIGN_TOP, width: w, height: b.rowY2 - SIGN_TOP + (compact ? 30 : 24), rx: 7, "stroke-width": 2 });
    const [badgeFill, badgeInk] = BADGE_COLOURS[box.badge];
    // The longest badge is cut short where a sign is too narrow to hold it at a size worth reading.
    b.badge = pill(plan.tight && box.badge === "screen" ? "Big screen" : BADGES[box.badge], compact ? 21 : 13.5, badgeFill, badgeInk);
    b.players = label(playersLabel(box.min, box.max), { "font-size": compact ? 22 : 13.5, fill: "#cdbfa6", class: "t-ui t-semi" });
    b.reason = pill("Coming soon", compact ? 21 : 14, "#fbe3da", "#7a1d12");
    b.chip = pill("HEADS", compact ? 22 : 16, "#f4b453", "#1e1410");
    set(b.chip.g, { display: "none" });
    frame.append(b.sign, ...b.blurbs, b.badge.g, b.players, b.reason.g, b.chip.g);
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
    sizePill(b.badge, b.w - 12);
    sizePill(b.reason, b.w - 12);
    sizePill(b.chip);
    place(b.reason, b.cx - b.reason.w / 2, (b.rowY + b.rowY2) / 2);
    place(b.chip, b.cx - b.chip.w / 2, SIGN_TOP - 4);
    const drop = compact ? 7.5 : 4.5; // from a row's middle to the baseline of its words
    const playersW = b.players.getComputedTextLength();
    if (this.signs.stacked) {
      // A narrow sign: how many play, and the badge under it.
      set(b.players, { x: b.cx - playersW / 2, y: b.rowY + drop });
      return place(b.badge, b.cx - b.badge.w / 2, b.rowY2);
    }
    const gap = compact ? 10 : 8;
    const left = b.cx - (b.badge.w + gap + playersW) / 2;
    place(b.badge, left, b.rowY);
    set(b.players, { x: left + b.badge.w + gap, y: b.rowY + drop });
  }

  /**
   * How every sign on this wall is laid out, from how wide a box is: the size of the line of
   * words and how many lines it may take, and whether the count and the badge share a row.
   * A phone's sign is too narrow for the words once there are five boxes or more (they would
   * need three lines of small print): there the sign keeps the count and the badge, and the
   * words are read on a bigger screen.
   */
  planSigns(boxes, w) {
    const compact = this.opts.compact;
    const size = compact ? 24 : 17;
    const chars = Math.floor((w - 18) / (size * 0.56));
    const needed = Math.max(1, ...boxes.map((box) => wrap(box.blurb, chars).length));
    const lines = compact ? (needed > 2 ? 0 : 2) : Math.min(3, needed);
    // The widest row any sign needs: the longest badge and "2-4 players", at about 0.6 of the size a letter.
    const badge = Math.max(...boxes.map((box) => BADGES[box.badge].length)) * (compact ? 21 : 13.5) * 0.6 + (compact ? 30 : 20);
    const count = 11 * (compact ? 22 : 13.5) * 0.58;
    return { size, step: compact ? 29 : 22, chars, lines, stacked: badge + 10 + count > w - 14, tight: BADGES.screen.length * (compact ? 21 : 13.5) * 0.6 + (compact ? 30 : 20) > w - 12 };
  }

  /** What floats over the room: the count ring and the coin toss. */
  overlay() {
    const o = (this.over = {});
    o.count = s("g", { display: "none" });
    o.arc = s("circle", { r: 60, fill: "none", stroke: "#f4b453", "stroke-width": 7, "stroke-linecap": "round", transform: "rotate(-90)" });
    o.digit = label("3", { y: 36, "font-size": 70, fill: "#fbf3e2", "text-anchor": "middle", class: "t-ui t-bold" });
    o.count.append(s("circle", { r: 70, fill: "#120b08", stroke: "#2c1c14", "stroke-width": 2 }), o.arc, (o.verb = label("STARTS IN", { y: -24, "font-size": 12.5, fill: "#f6ead2", "text-anchor": "middle", "letter-spacing": 3, class: "t-mono t-bold" })), o.digit);
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
      this.bumps.resume(p, m.x, m.down ?? 0, m.safe ?? 0, now);
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
        // A game that is not built says so on its poster, so its sign still says how many will
        // play it. A game this party does not fit says why instead ("Needs 2 players").
        const say = why && !b.box.soon ? why : null;
        set(b.badge.g, { display: say ? "none" : null, opacity: on ? 1 : 0.5 });
        set(b.players, { display: say ? "none" : null, opacity: on ? 1 : 0.6 });
        set(b.reason.g, { display: say ? null : "none" });
        if (say) {
          b.reason.text.textContent = say;
          sizePill(b.reason, b.w - 12);
          place(b.reason, b.cx - b.reason.w / 2, (b.rowY + b.rowY2) / 2);
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
      const fade = b.on || gold ? 1 : 0.45;
      for (const line of b.blurbs) set(line, { fill: gold ? "#1e1410" : "#f1e6d0", opacity: fade });
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
    const rows = standings(room.members);
    this.boardRows.replaceChildren();
    const fresh = room.last && room.last.ago < 9000 ? new Map(room.last.rows.map((r) => [r.seat, r.points])) : new Map();
    rows.forEach((m, i) => {
      const y = POSTER.top + 124 + i * 46;
      const name = label(m.name, { x: x + 76, y, "font-size": 27, fill: "#f3ecd9", class: "t-chalk" });
      this.boardRows.append(
        // Equal points share a place; before the first game there are no places to speak of.
        label(room.tonight.games ? String(m.place) : "", { x: x + 30, y, "font-size": 21, fill: "#d9d2bf", class: "t-chalk", opacity: 0.8 }),
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
    const p = { seat: m.seat, rx: m.x, net: { x: m.x, d: m.d, t: 0 }, face: 1, rev: m.rev, jumpAt: -Infinity, attack: null, knock: null, leaving: 0, level: 0, look: "" };
    p.shadow = s("ellipse", { cy: ROOM.floorY + 5, rx: 40, ry: 9, fill: "#000", opacity: 0.42 });
    p.base = s("ellipse", { cx: 0, cy: -8, rx: 39, ry: 11.5 });
    p.body = s("path", { d: "M-32,-10 C-31,-36 -15,-54 -13.5,-84 L13.5,-84 C15,-54 31,-36 32,-10 Z" });
    p.collar = s("ellipse", { cx: 0, cy: -84, rx: 22, ry: 8 });
    p.head = s("circle", { cx: 0, cy: -113, r: 28 });
    p.eyes = s("g", {}, s("ellipse", { cx: -9, cy: -113, rx: 3.8, ry: 5.6, fill: "#1a1210" }), s("ellipse", { cx: 9, cy: -113, rx: 3.8, ry: 5.6, fill: "#1a1210" }), s("circle", { cx: -8, cy: -115.5, r: 1.3, fill: "#fff" }), s("circle", { cx: 10, cy: -115.5, r: 1.3, fill: "#fff" }));
    // The pawn itself, in a group of its own that an emote can lean and lift (emotes/svg.js draws over it).
    p.inner = s("g", {}, p.base, p.body, p.collar, p.head, s("ellipse", { cx: -10, cy: -125, rx: 9, ry: 6, fill: "#fff", opacity: 0.26 }), p.eyes);
    p.g = s("g", { "data-seat": m.seat }, p.inner);
    p.colour = m.colour;
    p.emote = null;
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
    p.emote?.remove();
    p.sticker?.remove();
    this.expressions.stop(p.seat);
  }

  // ---------------------------------------------------------------- emotes

  /** Someone sent an emote: it starts over their piece now, in place of any they were doing. */
  onExpress(msg, now) {
    const where = [...this.pieces.values()].filter((p) => !p.leaving).map((p) => ({ seat: p.seat, x: p.rx, face: p.face }));
    this.expressions.start(msg.s, msg.e, now, where);
  }

  /** Draws a piece's emote for this frame, or puts its last one away. */
  express(p, now) {
    const e = this.expressions.pose(p.seat, now, (seat) => this.pieces.get(seat)?.rx, !!this.calmQuery?.matches);
    if (!e) {
      if (p.emote) {
        p.emote.remove();
        p.emote = null;
        p.sticker.show(null);
        set(p.inner, { transform: null });
        set(p.eyes, { display: null });
      }
      return;
    }
    if (!p.emote) {
      p.emote = new EmoteFigure(p.colour);
      p.inner.append(p.emote.body);
      this.layers.emotes.append(p.emote.stage);
      p.sticker ??= new Sticker(this.layers.stickers);
    }
    set(p.inner, { transform: bodyTransform(e.pose.body) });
    set(p.eyes, { display: "none" });
    set(p.emote.stage, { transform: `translate(${p.rx.toFixed(1)}, ${ROOM.floorY})` });
    p.emote.draw(e.pose, e.toward);
    // The word over the head, clear of the name tag and of whatever the emote holds up; as easy to read as the tag, and larger on a screen read from across the room.
    const tagTop = ROOM.floorY - 156 - p.up - p.level * (this.tagSize + 20) - (this.tagSize + 14);
    const y = Math.min(tagTop - 4, ROOM.floorY - p.up + poseTop(e.pose));
    p.sticker.show(e.word, p.rx + e.pose.body.dx, y, (this.tagSize / 21) * (this.opts.compact ? 1 : 1.25), e.pop);
  }

  /** Someone moved: where they are and which way they walk, as of now. */
  onMove(msg, now) {
    const p = this.pieces.get(msg.s);
    if (!p) return;
    p.net = { x: msg.x, d: msg.d, t: now };
    if (msg.d) p.face = msg.d;
    if (msg.j) p.jumpAt = now;
  }

  /**
   * A bump, as the room judged it: the bumper winds up and strikes, and whoever it lands on is
   * thrown to where the room put them (lobby/shared/bump.js has the timings, bump-draw.js draws).
   */
  onBump(msg, now) {
    const by = this.pieces.get(msg.s);
    const landed = msg.to >= 0;
    let began = now;
    if (by) {
      by.face = msg.f || by.face;
      if (msg.s === this.opts.own && by.attack && now - by.attack.at < 600) {
        // The viewer's own bump began when the button went down (ownBump), not when the room answered.
        by.attack.landed = landed;
        began = Math.max(by.attack.at, now - IMPACT_MS);
      } else this.bumps.attack(by, msg.f, now, landed);
    }
    const hit = landed ? this.pieces.get(msg.to) : null;
    if (hit) {
      hit.net = { x: msg.x, d: 0, t: now };
      hit.rev = msg.rev;
      this.bumps.knock(hit, msg.x, began);
    }
  }

  /** The viewer's own piece jumped (its Pilot says so; nothing comes back from the room). */
  ownJump(now) {
    const p = this.pieces.get(this.opts.own);
    if (p) p.jumpAt = now;
  }

  /** The viewer pressed bump: the wind-up starts at once, before the room has answered. */
  ownBump(now) {
    const p = this.pieces.get(this.opts.own);
    if (p) this.bumps.attack(p, p.face, now);
  }

  /** How far the whole picture is jolted by a blow right now, in world units. */
  jolt(now) {
    return this.bumps.jolt(now);
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
      // Winding up, striking, thrown, lying or getting up: the bump's pose, on top of the walk.
      const pose = this.bumps.pose(p, now);
      if (pose.x !== null) p.rx = pose.x;
      set(p.g, { transform: poseTransform(p.rx, ROOM.floorY - up - bob, pose) });
      set(p.eyes, { transform: `translate(${p.face * 5}, 0)` });
      this.bumps.dress(p, pose, now);
      const air = up + Math.max(0, pose.lift);
      const squeeze = 1 - Math.min(0.45, air / 260);
      set(p.shadow, { cx: (p.rx + pose.dx).toFixed(1), rx: (40 * squeeze).toFixed(1), ry: (9 * squeeze).toFixed(1) });
      p.up = air + bob;
      ordered.push(p);
    }
    const mine = own ? this.pieces.get(this.opts.own) : null;
    if (mine) this.bumps.cooldown(mine.rx, own.cooling(now), now);
    this.bumps.frame(now);
    // Name tags that would sit on top of each other step up instead.
    ordered.sort((a, b) => a.rx - b.rx);
    let prev = null;
    for (const p of ordered) {
      const want = prev && p.rx - prev.rx < (p.tagW + prev.tagW) / 2 + 8 ? (prev.want + 1) % 4 : 0;
      p.want = want;
      p.level += (want - p.level) * Math.min(1, dt * 12);
      set(p.tag, { transform: `translate(${p.rx.toFixed(1)}, ${(ROOM.floorY - 156 - p.up - p.level * (this.tagSize + 20)).toFixed(1)})` });
      this.express(p, now);
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
    set(o.arc, { "stroke-dasharray": `${((left / COUNT_MS) * round).toFixed(1)} ${round.toFixed(1)}` });
    o.digit.textContent = String(Math.max(1, Math.ceil(left / 1000)));
    // An outside game does not start here: it opens on a site of its own.
    const lead = vote.leaders.length === 1 && this.room.boxes.find((b) => b.id === vote.leaders[0]);
    const verb = lead?.url ? "OPENS IN" : vote.leaders.length > 1 ? "TOSS IN" : "STARTS IN";
    if (o.verb.textContent !== verb) o.verb.textContent = verb;
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

/**
 * A line of words broken at spaces into as few lines as hold it at `chars` letters a line, and
 * then evened out, so no line is much longer than the others.
 */
function wrap(text, chars) {
  const words = text.split(" ");
  const fill = (limit) => {
    const lines = [];
    for (const word of words) {
      const last = lines[lines.length - 1];
      if (last !== undefined && last.length + 1 + word.length <= limit) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    return lines;
  };
  let best = fill(chars);
  // The same number of lines, with the narrowest limit that still gives it.
  for (let limit = chars - 1; limit > 0; limit--) {
    const tighter = fill(limit);
    if (tighter.length !== best.length) break;
    best = tighter;
  }
  return best;
}

/** A rounded label: {g, back, text, w, h}. Its size is worked out by sizePill once it is in the page. */
function pill(text, size, fill, ink) {
  const back = s("rect", { fill });
  const t = label(text, { "font-size": size, fill: ink, class: "t-ui t-bold" });
  return { g: s("g", {}, back, t), back, text: t, size, w: 0, h: 0 };
}

/** Sizes a pill around its words. With `max`, the words are made smaller until the pill is no wider than that. */
function sizePill(p, max = Infinity) {
  p.size = p.full ??= p.size;
  set(p.text, { "font-size": p.size });
  for (let i = 0; i < 5 && p.text.getComputedTextLength() + p.size * 1.44 > max && p.size > 8; i++) {
    p.size = Math.max(8, Math.floor(p.size * Math.min(0.95, max / (p.text.getComputedTextLength() + p.size * 1.44)) * 10) / 10);
    set(p.text, { "font-size": p.size });
  }
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

