// Everything laid over the room: the bottom line a big screen shows, a player's buttons and
// emote wheel, the door button and its sheet (leave, the emote wheel's six, sound), the one-tap
// mute, notes ("Tom left"), the card after a game, and what to say when the connection is gone. When the room is gone the page goes to the front page (farewell.js).
import { Controls } from "./controls.js";
import { ICONS, h, icon } from "./dom.js";
import { EmoteWheel, openLoadout } from "./emotes/wheel.js";
import { playerLine, statusLine } from "./shared/status.js";
import { SETTLE_MS, whereabouts } from "./shared/vote.js";

const PLACES = ["1st", "2nd", "3rd", "4th"];
/** A speaker with its sound, a speaker crossed out, and the wheel's six. */
const ICON_SOUND = ["M4 9.5v5h3.5l4.5 4V5.5l-4.5 4H4z", "M15.5 9a4 4 0 0 1 0 6", "M18.5 6.5a7.5 7.5 0 0 1 0 11"];
const ICON_MUTED = ["M4 9.5v5h3.5l4.5 4V5.5l-4.5 4H4z", "M16 9.5l5 5", "M21 9.5l-5 5"];
const WHEEL_ICON = ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z", "M12 3v18", "M4.2 7.5l15.6 9", "M4.2 16.5l15.6-9"];

export class Hud {
  /**
   * @param {HTMLElement} root
   * @param {{role: "player" | "screen", seat: number, sound: object, on: object}} opts  `sound` is the
   *   page's SoundBoard (party-kit/client/sounds.js); `on` holds the callbacks: steer(d), jump(),
   *   bump(), zoom(), leave(), away(url), emote(id) (true when it went), colour() (the player's seat colour)
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
  }

  build(role) {
    const door = h("button", "round door-btn", "", this.el);
    door.type = "button";
    door.setAttribute("aria-label", role === "screen" ? "Stop showing the room" : "Leave the party");
    door.append(icon(ICONS.door, 22));
    // Says what it does while the room is new to this device, then folds to its picture (lobby.css).
    h("span", "door-word", role === "screen" ? "Stop showing" : "Leave", door);
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
    // Walking under the left thumb, jump and bump under the right (controls.js).
    const left = h("div", "pad pad-left", "", bar);
    const right = h("div", "pad pad-right", "");
    this.pad = new Controls(left, right, this.on);
    this.wheel = new EmoteWheel(right, this.el, { send: (id) => this.on.emote(id), colour: () => this.on.colour() });
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

    bar.append(right);
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
    if (this.wheel) {
      const pick = h("button", "choice wheel-choice", "", box);
      pick.type = "button";
      h("span", "choice-icon", "", pick).append(icon(WHEEL_ICON, 22));
      const w = h("span", "choice-words", "", pick);
      h("strong", "", "Your emote wheel", w);
      h("span", "", "Choose the six on it.", w);
      pick.addEventListener("click", () => {
        close();
        this.loadout();
      });
    }
    this.soundSet(box);
    const stay = h("button", "plain", screen ? "Keep showing it" : "Stay", box);
    stay.type = "button";
    const close = () => {
      sheet.remove();
      this.sheet = null;
      this.offSound?.();
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

  // ---------------------------------------------------------------- emotes and sound

  /** The sheet for choosing the wheel's six. */
  loadout() {
    if (!this.wheel) return;
    this.loadoutSheet?.close();
    this.loadoutSheet = openLoadout(this.el, { ids: this.wheel.ids, colour: this.on.colour(), onSave: (ids) => this.wheel.setIds(ids) });
  }

  /** On the door button's sheet: sound on or off for everything, its volume, and the room's own life. */
  soundSet(parent) {
    const board = this.opts.sound;
    if (!board) return;
    const set = h("div", "sound-set", "", parent);
    const head = h("div", "sound-head", "", set);
    h("span", "", "Sound", head);
    const toggle = h("button", "sound-toggle", "", head);
    toggle.type = "button";
    toggle.addEventListener("click", () => board.setMuted(!board.muted));
    const slider = (name, value, change) => {
      const row = h("label", "sound-row", "", set);
      h("span", "", name, row);
      const input = h("input", "", "", row);
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.value = String(Math.round(value * 100));
      input.addEventListener("input", () => change(Number(input.value) / 100));
      return input;
    };
    const volume = slider("Volume", board.volume, (v) => board.setVolume(v));
    const ambience = slider("The room's own life", board.ambience, (v) => board.setAmbience(v));
    const draw = () => {
      toggle.textContent = board.muted ? "Off: turn on" : "On: turn off";
      toggle.setAttribute("aria-pressed", String(board.muted));
      toggle.setAttribute("aria-label", board.muted ? "Sound is off. Turn it on" : "Sound is on. Turn it off");
      set.classList.toggle("off", board.muted);
      volume.disabled = ambience.disabled = board.muted;
    };
    draw();
    this.offSound = board.onChange(draw);
  }

  /** The one-tap mute, first in the room's corner: everything on this device, kept on the device. */
  muteButton(corner) {
    const board = this.opts.sound;
    if (!board) return;
    const btn = (this.mute = h("button", "round corner-btn sound-btn", ""));
    btn.type = "button";
    corner.prepend(btn);
    btn.addEventListener("click", () => board.setMuted(!board.muted));
    const draw = () => {
      btn.replaceChildren(icon(board.muted ? ICON_MUTED : ICON_SOUND, 20));
      btn.setAttribute("aria-pressed", String(board.muted));
      btn.setAttribute("aria-label", board.muted ? "Sound is off. Turn it on" : "Sound is on. Turn it off");
    };
    draw();
    this.offMute = board.onChange(draw);
  }

  // ---------------------------------------------------------------- after a game

  /** The card everyone sees on the way back to the room: who came where, and what it adds tonight. */
  result(last) {
    this.card?.remove();
    const back = (this.card = h("div", "card-back", "", this.el));
    const card = h("div", "card", "", back);
    h("div", "card-kicker", "RESULT", card);
    h("h2", "card-title", last.name, card);
    const list = h("ol", "places", "", card);
    for (const row of last.rows) {
      const li = h("li", "", "", list);
      h("span", "place", PLACES[row.place - 1] ?? String(row.place), li);
      h("span", "dot", "", li).style.background = row.colour;
      h("span", "who-name", row.name, li);
      // A game that keeps score: the score is what was played for, the points are what it adds tonight.
      if (typeof row.score === "number") h("span", "score", row.score.toLocaleString("en-US"), li);
      h("span", "points", row.points ? `+${row.points}` : "0", li);
    }
    h("p", "card-foot", "Points go on the Tonight board.", card);
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

  // ---------------------------------------------------------------- off to an outside game

  /**
   * A game that plays on a site of its own won the vote. Leaving the page without a word would
   * be a surprise, so this says where everyone is going and what does not come along, counts
   * down, and then calls on.away(url). "Stay" keeps this device in the room.
   * @param {{name: string, url: string, in: number}} msg  the room's "away" message
   * @param {string | null} pin  the party's join code, which does not work on the other site
   */
  away(msg, pin) {
    this.card?.remove();
    clearInterval(this.awayTimer);
    const screen = this.opts.role === "screen";
    const back = (this.card = h("div", "card-back", "", this.el));
    const card = h("div", "card away", "", back);
    h("div", "card-kicker", "LEAVING THE ROOM", card);
    h("h2", "card-title", `Off to ${msg.name}`, card);
    const where = whereabouts(msg.url);
    const place = where === "its own page" ? where : `its own site, ${where}`;
    const code = pin ? `The party's code ${pin}` : "The party's code";
    h("p", "card-text", `It plays on ${place}, not in this room. ${code} does not work there: one of you makes a room and the others join it. No Tonight points for this one.`, card);
    const go = h("a", "button", "", card);
    go.href = msg.url;
    const stay = h("button", "plain", screen ? "Keep showing the room" : "Stay in the room", card);
    stay.type = "button";
    const endsAt = performance.now() + msg.in;
    const close = () => {
      clearInterval(this.awayTimer);
      back.remove();
      if (this.card === back) this.card = null;
    };
    const tick = () => {
      const left = endsAt - performance.now();
      go.textContent = `Go now (${Math.max(1, Math.ceil(left / 1000))})`;
      if (left > 0) return;
      clearInterval(this.awayTimer);
      go.textContent = `Opening ${msg.name}...`;
      this.on.away(msg.url);
    };
    this.awayTimer = setInterval(tick, 200);
    tick();
    stay.addEventListener("click", close);
  }

  destroy() {
    clearInterval(this.awayTimer);
    this.offSound?.();
    this.offMute?.();
    this.wheel?.destroy();
    this.loadoutSheet?.close();
    this.el.remove();
  }
}
