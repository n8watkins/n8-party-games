// Everything laid over the room: the bottom line a big screen shows, a player's buttons, the
// door button and its "Leave the party" sheet, notes ("Tom left"), the card after a game, and
// what to say when the connection or the room is gone.
import { ICONS, h, icon } from "./dom.js";
import { playerLine, statusLine } from "./shared/status.js";
import { SETTLE_MS } from "./shared/vote.js";
import { BUMP_COOLDOWN_MS } from "./shared/world.js";

const PLACES = ["1st", "2nd", "3rd", "4th"];

const CLOSED = {
  room_idle: ["The room closed", "Nobody had moved for twenty minutes, so the room was put away."],
  room_expired: ["The party is over", "A room lasts four hours. Start a new one to carry on."],
  allowance_spent: ["The rooms are closed for today", "Today's hosting allowance is used up. Party rooms open again tomorrow, and each game still plays on its own page."],
  seat_lost: ["Your seat was given up", "You were away for a while, so the room let your seat go. Join again with the code."],
  left: ["You left the party", "Come back any time with the code."],
  room_closed: ["The party has ended", "Everyone left, so the room was put away."],
};

export class Hud {
  /**
   * @param {HTMLElement} root
   * @param {{role: "player" | "screen", seat: number, on: object}} opts  `on` holds the callbacks:
   *   steer(d), jump(), bump(), zoom(), leave()
   */
  constructor(root, opts) {
    this.opts = opts;
    this.on = opts.on;
    this.el = h("div", `hud hud-${opts.role}`, "", root);
    this.notes = h("div", "notes", "", this.el);
    this.banner = h("div", "banner", "", this.el);
    this.banner.hidden = true;
    this.build(opts.role);
    this.sheet = null;
    this.card = null;
    this.veil = null;
    this.last = "";
    this.bumpAt = -Infinity;
  }

  build(role) {
    const door = h("button", "round door-btn", "", this.el);
    door.type = "button";
    door.setAttribute("aria-label", role === "screen" ? "Stop showing the room" : "Leave the party");
    door.append(icon(ICONS.door, 22));
    door.addEventListener("click", () => this.openSheet());

    if (role === "screen") {
      const bar = (this.bar = h("div", "bar bar-screen", "", this.el));
      const brand = h("div", "brand", "", bar);
      h("span", "brand-mark", "", brand);
      h("span", "", "n8 Party", brand);
      const mid = h("div", "status", "", bar);
      this.chip = h("span", "chip", "VOTE", mid);
      this.main = h("span", "status-main", "", mid);
      this.sub = h("span", "status-sub", "", mid);
      const code = h("div", "code", "", bar);
      h("span", "code-label", "JOIN CODE", code);
      this.code = h("span", "code-digits", "", code);
      return;
    }

    const turn = h("div", "turn-hint", "", this.el);
    turn.append(icon(ICONS.turn, 20));
    h("span", "", "Turn your phone sideways to see the whole room", turn);

    const bar = (this.bar = h("div", "bar bar-player", "", this.el));
    const left = h("div", "pad", "", bar);
    this.hold(this.button(left, "round", "Walk left", ICONS.left), -1);
    this.hold(this.button(left, "round", "Walk right", ICONS.right), 1);
    this.zoomBtn = h("button", "pill-btn zoom-btn", "", left);
    this.zoomBtn.type = "button";
    this.zoomIcon = h("span", "pill-icon", "", this.zoomBtn);
    this.zoomText = h("span", "", "Whole room", this.zoomBtn);
    this.zoomBtn.addEventListener("click", () => {
      this.on.zoom();
      this.zoomBtn.blur();
    });

    const mid = h("div", "status", "", bar);
    h("span", "status-label", "Your vote", mid);
    this.dot = h("span", "dot", "", mid);
    this.mine = h("span", "status-main", "Not yet", mid);
    h("span", "status-rule", "", mid);
    this.rest = h("span", "status-sub", "", mid);

    const right = h("div", "pad", "", bar);
    this.bumpBtn = this.button(right, "round bump-btn", "Bump", ICONS.bump);
    this.tap(this.bumpBtn, () => this.on.bump());
    this.jumpBtn = this.button(right, "round jump-btn", "Jump", ICONS.up);
    this.tap(this.jumpBtn, () => this.on.jump());
  }

  button(parent, className, name, paths) {
    const b = h("button", className, "", parent);
    b.type = "button";
    b.setAttribute("aria-label", name);
    b.append(icon(paths, 26));
    return b;
  }

  /** A button that acts the moment it is touched, without waiting for the finger to lift. */
  tap(button, action) {
    button.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      action();
    });
    button.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") action();
    });
  }

  /** A walk button: held down to walk, let go to stop. */
  hold(button, d) {
    const stop = (e) => {
      if (!button.classList.contains("held")) return;
      button.classList.remove("held");
      if (e.pointerId !== undefined && button.hasPointerCapture?.(e.pointerId)) button.releasePointerCapture(e.pointerId);
      this.on.steer(d, false);
    };
    button.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      button.setPointerCapture?.(e.pointerId);
      button.classList.add("held");
      this.on.steer(d, true);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(type, stop);
    button.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** How tall the strip over the foot of the picture is, in CSS pixels. */
  barHeight() {
    return this.bar.offsetHeight;
  }

  // ---------------------------------------------------------------- the line of words

  /** Call every frame: cheap, and only touches the page when the words change. */
  update(room, vote, now, voteAt, zoom, idle = 0) {
    const live = { ...vote, countLeft: vote.count ? vote.count.endsIn - (now - voteAt) : null };
    const closingLeft = room.closing ? room.closing.in - (now - voteAt) : null;
    if (this.opts.role === "screen") {
      const line = statusLine(room, live, closingLeft);
      const key = JSON.stringify([line, room.pin]);
      if (key !== this.last) {
        this.last = key;
        this.chip.textContent = line.chip;
        this.main.textContent = line.main;
        this.sub.replaceChildren();
        if (line.sub) h("span", "", line.sub, this.sub);
        line.waiting.forEach((w, i) => {
          const who = h("span", "who", "", this.sub);
          const dot = h("span", "dot", "", who);
          dot.style.background = w.colour;
          h("span", "", w.name + (i < line.waiting.length - 1 ? "," : ""), who);
        });
        this.code.textContent = room.pin ?? "";
      }
    } else {
      const line = playerLine(room, live, this.opts.seat, closingLeft);
      const key = JSON.stringify([line, zoom]);
      if (key !== this.last) {
        this.last = key;
        this.mine.textContent = line.vote;
        this.mine.classList.toggle("muted", !line.voted);
        this.dot.style.background = room.members[this.opts.seat]?.colour ?? "#888";
        this.rest.textContent = line.rest;
        this.zoomText.textContent = zoom === "closer" ? "Whole room" : "Closer";
        this.zoomIcon.replaceChildren(icon(zoom === "closer" ? ICONS.zoomOut : ICONS.zoomIn, 18));
      }
      const cooling = now - this.bumpAt < BUMP_COOLDOWN_MS;
      if (cooling !== this.cooling) {
        this.cooling = cooling;
        this.bumpBtn.classList.toggle("cooling", cooling);
      }
    }
    // A room near the end of its four hours says so, and so does one nobody has touched for a while.
    const left = room.closesIn - (now - voteAt);
    const quiet = room.idleLimit - idle;
    let warn = "";
    if (!room.closing && room.phase === "lobby") {
      if (left < 5 * 60_000) warn = `This room closes in ${Math.max(1, Math.ceil(left / 60_000))} min. Rooms last four hours.`;
      else if (quiet < 2 * 60_000) warn = `Nobody has moved for a while. Move, or this room closes in ${Math.max(1, Math.ceil(quiet / 10_000)) * 10} seconds.`;
    }
    if (warn !== this.banner.textContent) {
      this.banner.textContent = warn;
      this.banner.hidden = !warn;
    }
  }

  bumped(now) {
    this.bumpAt = now;
  }

  /** A short note at the top of the room: "Tom left". */
  note(text, colour = null) {
    const n = h("div", "note", "", this.notes);
    if (colour) h("span", "dot", "", n).style.background = colour;
    h("span", "", text, n);
    setTimeout(() => n.classList.add("going"), 3600);
    setTimeout(() => n.remove(), 4300);
  }

  /** A quiet word about the connection ("Reconnecting..."), or nothing. */
  link(text) {
    this.linkEl ??= h("div", "link-state", "", this.el);
    this.linkEl.textContent = text;
    this.linkEl.hidden = !text;
  }

  // ---------------------------------------------------------------- the door button

  openSheet() {
    if (this.sheet) return;
    const screen = this.opts.role === "screen";
    const sheet = (this.sheet = h("div", "sheet-back", "", this.el));
    const box = h("div", "sheet", "", sheet);
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Leave");
    const leave = h("button", "choice", "", box);
    leave.type = "button";
    const mark = h("span", "choice-icon", "", leave);
    mark.append(icon(ICONS.door, 22));
    const words = h("span", "choice-words", "", leave);
    h("strong", "", screen ? "Stop showing the room" : "Leave the party", words);
    h("span", "", screen ? "Only this screen. The party carries on." : "Only you. Your piece walks out of the door.", words);
    const stay = h("button", "plain", screen ? "Keep showing it" : "Stay", box);
    stay.type = "button";
    const close = () => {
      sheet.remove();
      this.sheet = null;
    };
    leave.addEventListener("click", () => {
      close();
      this.on.leave();
    });
    stay.addEventListener("click", close);
    sheet.addEventListener("click", (e) => {
      if (e.target === sheet) close();
    });
    stay.focus();
  }

  // ---------------------------------------------------------------- after a game

  /** The card everyone sees on the way back to the room: who came where, and what it adds tonight. */
  result(last) {
    this.card?.remove();
    const back = (this.card = h("div", "card-back", "", this.el));
    const card = h("div", "card", "", back);
    h("div", "card-kicker", last.note?.kind === "stand-in" ? "NOT IN THE ROOM YET" : "RESULT", card);
    h("h2", "card-title", last.name, card);
    if (last.note?.kind === "stand-in") {
      h("p", "card-text", `${last.name} won the vote, but it does not open inside the party room yet. That is the next piece of work. For now it plays on its own page.`, card);
      const go = h("a", "button", `Open ${last.name}`, card);
      go.href = last.note.path;
      go.target = "_blank";
      go.rel = "noopener";
    } else {
      const list = h("ol", "places", "", card);
      for (const row of last.rows) {
        const li = h("li", "", "", list);
        h("span", "place", PLACES[row.place - 1] ?? String(row.place), li);
        h("span", "dot", "", li).style.background = row.colour;
        h("span", "who-name", row.name, li);
        h("span", "points", row.points ? `+${row.points}` : "0", li);
      }
      h("p", "card-foot", "Points go on the Tonight board.", card);
    }
    const again = h("button", "plain", "Back to the room", card);
    again.type = "button";
    const done = () => {
      clearTimeout(timer);
      back.remove();
      if (this.card === back) this.card = null;
    };
    const timer = setTimeout(done, SETTLE_MS - 400);
    again.addEventListener("click", done);
  }

  destroy() {
    this.el.remove();
  }
}

/** The room is gone, or this seat is: say why and offer the two ways back in. Returns the element. */
export function showClosed(root, reason) {
  const [title, text] = CLOSED[reason] ?? CLOSED.room_closed;
  const back = h("div", "card-back solid", "", root);
  const card = h("div", "card", "", back);
  h("h2", "card-title", title, card);
  h("p", "card-text", text, card);
  const start = h("a", "button", "Start a party", card);
  start.href = "/lobby/?start";
  const join = h("a", "plain", "Join with a code", card);
  join.href = "/lobby/";
  return back;
}
