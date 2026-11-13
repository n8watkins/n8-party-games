// What can be touched on the wall, in either drawing of the room: the Tonight board, each game's
// poster, the join sign and, in the 3D look, the room's own feature (the jukebox, the globe, the
// claw...). One language for all of them: a small round mark in a corner says "you can tap
// this", a tap gives a press and does its thing, and a laptop's pointer turns to a hand.
//
// The spots are a layer of plain buttons over the picture, placed from where things are on the
// wall in world units (the same for both drawings) and the part of the room on the screen, so
// neither drawing needs to know about them. None of it sends anything to the room, blocks a vote
// or stops a piece: a card opened from a poster closes by itself, and walking closes it.
import { h, icon } from "./dom.js";
import { BADGES, playersLabel } from "./shared/vote.js";
import { boxCentre, boxWidth } from "./shared/world.js";

/** Where things are on the wall, in world units (lobby/public/scene.js draws them there). */
const JOIN_SIGN = { x: 62, y: 133, w: 212, h: 314 };
const BOARD = { x: 1606, y: 136, w: 252, h: 352 };
const POSTER = { top: 140, bottom: 548 };
/** The 3D room's feature stands on the floor under the board: this much around its middle can be tapped. */
const FEATURE = { w: 220, top: 600, bottom: 880 };
/** A tapped feature plays its reaction at most this often on one device. */
const FEATURE_COOLDOWN_MS = 1500;
const HINT_KEY = "party-room:touch-hint";
const POSTER_CARD_MS = 7000;

const TAP_ICON = ["M9 11V5.5a1.5 1.5 0 0 1 3 0V10", "M12 10V8.5a1.5 1.5 0 0 1 3 0V11", "M15 11a1.5 1.5 0 0 1 3 0v3a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-2.5-3.5a1.5 1.5 0 0 1 2.3-1.9L9 14"];

/** A short flash over what was tapped. */
function press(el) {
  el.classList.remove("pressed");
  void el.offsetWidth;
  el.classList.add("pressed");
}

export class TouchSpots {
  /**
   * @param {HTMLElement} root  the page's #app; the layer goes in just above the room's picture
   * @param {HTMLElement} before  the element the layer goes before (the dim over the room)
   * @param {{code: () => {pin: string, qr: string, host: string}, scene: () => object}} on
   *   code: the party's code, its QR code's address and the site's address, for the sign shown large.
   */
  constructor(root, before, on) {
    this.on = on;
    this.el = h("div", "touch-layer");
    root.insertBefore(this.el, before);
    this.spots = [];
    this.key = "";
    this.card = null;
    this.featureAt = -Infinity;
  }

  /** Builds a spot for everything that can be touched in this room. */
  build(room) {
    for (const s of this.spots) s.el.remove();
    const n = room.boxes.length;
    // The board opens itself in both drawings; its spot is only the mark (and the press), so the
    // board keeps its own button, its keyboard handling and its place in the tab order.
    const board = this.spot("", BOARD, null, "board");
    this.spots = [
      board,
      this.spot("Show the code large", JOIN_SIGN, () => this.codeSheet(), "sign"),
      ...room.boxes.map((box, i) => {
        const w = boxWidth(n);
        const spot = this.spot(`About ${box.name}`, { x: boxCentre(i, n) - w / 2, y: POSTER.top, w, h: POSTER.bottom - POSTER.top }, () => this.poster(box), "poster");
        spot.box = box;
        return spot;
      }),
    ];
    this.feature = this.spot("Set off the room's own thing", { x: 0, y: FEATURE.top, w: FEATURE.w, h: FEATURE.bottom - FEATURE.top }, () => this.kick(), "feature");
    this.spots.push(this.feature);
    this.key = "";
    this.hint();
  }

  /** A spot over a thing on the wall. Without `act` it is only the mark, and taps go through to the drawing. */
  spot(label, at, act, kind) {
    const el = h(act ? "button" : "div", `spot spot-${kind}${act ? "" : " spot-only"}`, "", this.el);
    const mark = h("span", "spot-mark", "", el);
    mark.append(icon(TAP_ICON, 14));
    const spot = { el, at, kind, press: () => press(el) };
    if (!act) return spot;
    el.type = "button";
    el.setAttribute("aria-label", label);
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      spot.press();
      this.on.tap?.();
      act();
    });
    return spot;
  }

  /** The drawing's own board button was tapped: the same press as every other spot. */
  pressBoard() {
    this.spots.find((s) => s.kind === "board")?.press();
  }

  /** The join sign, large: the QR code and the four digits, for showing a friend. Any tap closes it. */
  codeSheet() {
    this.closeCard();
    const { pin, qr, host } = this.on.code();
    const back = (this.card = h("div", "sheet-back code-back", "", this.el.parentElement));
    const box = h("div", "sheet code-large", "", back);
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "The party's code");
    const img = h("img", "", "", box);
    img.src = qr;
    img.alt = `QR code to join party ${pin}`;
    h("p", "picker-line", "Scan it, or type the code", box);
    h("div", "code-digits-large", pin ?? "----", box);
    h("p", "picker-line", host, box);
    back.addEventListener("click", () => this.closeCard());
  }

  /** The first time this device is in a room, the marks say "tap" once, then go quiet. */
  hint() {
    let seen = false;
    try {
      seen = localStorage.getItem(HINT_KEY) === "1";
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      seen = true;
    }
    if (seen) return;
    this.el.classList.add("hinting");
    setTimeout(() => this.el.classList.remove("hinting"), 6000);
  }

  /** Every frame: puts each spot over its thing for the part of the room on the screen. Only touches the page when that changes. */
  place(view, scene) {
    const life = scene?.life;
    const spotX = scene?.look === "3d" && life?.feature ? life.spotX : null;
    const key = [view.x, view.y, view.width, innerWidth, spotX].map((n) => Math.round(n ?? -1)).join();
    if (key === this.key) return;
    this.key = key;
    const k = innerWidth / view.width;
    if (this.feature) {
      this.feature.el.hidden = spotX === null;
      if (spotX !== null) this.feature.at.x = spotX - FEATURE.w / 2;
    }
    for (const s of this.spots) {
      const { x, y, w, h: hh } = s.at;
      s.el.style.transform = `translate(${((x - view.x) * k).toFixed(1)}px, ${((y - view.y) * k).toFixed(1)}px)`;
      s.el.style.width = `${(w * k).toFixed(1)}px`;
      s.el.style.height = `${(hh * k).toFixed(1)}px`;
    }
    this.cardPlace?.();
  }

  /** The room's own feature is tapped: it plays the reaction a bump by it would, on this device only. */
  kick() {
    const now = performance.now();
    const life = this.on.scene()?.life;
    if (!life?.feature || now - this.featureAt < FEATURE_COOLDOWN_MS) return;
    this.featureAt = now;
    life.onBump(life.spotX, null);
  }

  /** A small card about a game, beside its poster: the line, who can play, on what, and how to vote. */
  poster(box) {
    this.closeCard();
    const card = (this.card = h("div", "poster-card", "", this.el.parentElement));
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", box.name);
    h("strong", "poster-name", box.name, card);
    if (box.blurb) h("p", "poster-line", box.blurb, card);
    const facts = h("p", "poster-facts", "", card);
    h("span", "", playersLabel(box.min, box.max), facts);
    h("span", `poster-badge badge-${box.badge}`, BADGES[box.badge], facts);
    h("p", "poster-how", box.soon ? "Coming soon: it cannot be played yet." : box.url ? "Stand under its lamp to vote. It opens on its own site." : "Stand under its lamp to vote.", card);
    if (!box.soon && !box.url && !box.test) {
      const best = h("p", "poster-best", "", card);
      best.hidden = true;
      fetch(`/api/party/scores/${encodeURIComponent(box.id)}`)
        .then((r) => r.json())
        .then((d) => {
          const top = d?.ok ? d.top?.[0] : null;
          if (!top || this.card !== card) return;
          best.textContent = `High score: ${top.name} ${Number(top.score).toLocaleString("en-US")}`;
          best.hidden = false;
        })
        .catch(() => {});
    }
    card.addEventListener("click", () => this.closeCard());
    this.cardTimer = setTimeout(() => this.closeCard(), POSTER_CARD_MS);
    const spot = this.spots.find((s) => s.kind === "poster" && s.box === box);
    this.cardPlace = () => {
      const r = spot?.el.getBoundingClientRect();
      if (!r) return;
      const w = card.offsetWidth;
      const left = Math.min(innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
      card.style.transform = `translate(${left.toFixed(0)}px, ${Math.max(8, r.top + 8).toFixed(0)}px)`;
    };
    this.cardPlace();
  }

  closeCard() {
    clearTimeout(this.cardTimer);
    this.card?.remove();
    this.card = null;
    this.cardPlace = null;
  }

  destroy() {
    this.closeCard();
    this.el.remove();
  }
}
