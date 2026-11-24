// Keeping a phone's place in the room honest when its connection comes and goes.
//
//   - A phone that is locked or put away (the page is hidden) closes its connection at once, so
//     everyone else sees its piece turn grey straight away instead of a minute later; it opens
//     it again the moment the page is shown. Its seat is held meanwhile (lobby-core.js: the piece
//     fades after DROP_FADE_MS, the seat is kept for SEAT_HOLD_MS).
//   - Except during a turn-based game (`room.game.turns`, a match of people talking): there a
//     hidden page is away, not gone. It keeps its socket, tells the room it is away, and says it
//     is back when it is shown, so the game may pause its turn timer. While the game needs that
//     seat (`game.needs`: Who Am I?'s guesser on their turn) its grace runs meanwhile, as a
//     dropped phone's does: hidden for the whole of it, the player forfeits (lobby-core.js,
//     trackClocks), everyone else is shown the time left, and the player, back, how much was left.
//     If the socket died while the page was hidden (the phone suspended it, the signal went),
//     the page reconnects the moment it is shown and takes its seat back; the room took the gap
//     for a drop, with the game's own grace.
//   - The browser saying it is offline closes the connection too.
//   - A connection that has quietly died (no reply to the keep-alive) is noticed here and opened
//     again: the page says "Reconnecting..." instead of looking alive and doing nothing. A page
//     that was itself not running for a while (a slow phone loading the 3D look) heard nothing
//     because it was not listening: it asks the room at once and is judged on the answer.
// The keep-alive and the away and back messages are all the room hears of it. The keep-alive is
// answered by the runtime and never wakes the room; away and back wake it once each.

/** The page's keep-alive, which the runtime answers without waking the room. */
export const KEEP_ALIVE_MS = 10_000;
/** No word at all from the room for this long, with the keep-alive going: the connection is dead. */
export const DEAD_AFTER_MS = KEEP_ALIVE_MS + 6000;
/** How often the page looks for a dead connection. */
export const CHECK_EVERY_MS = 2000;
/**
 * A look this long after the one before it means the page itself was not running in between (a
 * slow phone busy loading the 3D look, a frozen or throttled tab): that silence is not the room's.
 */
export const STALLED_AFTER_MS = 2 * CHECK_EVERY_MS;

/** A turn-based game is what the room is doing (the room view's `game.turns`). */
export const turnBased = (room) => room?.phase === "playing" && !!room.game?.turns;

/**
 * What a page does when it is hidden: "park" (close the socket, as a locked phone always did),
 * "away" (keep the socket and tell the room), or "stay" (nothing: a desktop tab in the lobby or
 * a ticking game, and the room's screen, which is a screen and has a grace of its own).
 * @param {{touch: boolean, player: boolean, room: object | null}} at
 */
export function whenHidden({ touch, player, room }) {
  if (!player) return "stay";
  if (turnBased(room)) return "away";
  return touch ? "park" : "stay";
}

/**
 * The other members whose page is hidden, as this device (`you`, {role, seat}) should hear of
 * them: never itself, and during a game with an audience only the game's seats (an audience page
 * that is hidden holds nothing up).
 */
export function awayOthers(room, you) {
  const seats = room.game?.audience && Array.isArray(room.game.seats) ? room.game.seats : null;
  return room.members.filter((m) => m?.away && !(you?.role === "player" && m.seat === you.seat) && (!seats || seats.includes(m.seat)));
}

/** What the page says of other players whose page is hidden: "Bo is away", "Ann, Bo and Cy are away", or "" for nobody. */
export function awayLine(names) {
  if (!names.length) return "";
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${who} ${names.length === 1 ? "is" : "are"} away`;
}

/** The time left as the page shows it: "0:45", "1:00", rounded up to the second, never below "0:00". */
export function clockText(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The Table's away note in its two parts, as the page lays it out on two lines: `who` ("Bo is away") and `left` ("back within 0:45 or the match ends", or ""). */
export function awayParts(names, leftMs = null) {
  return { who: awayLine(names), left: names.length && leftMs !== null ? `back within ${clockText(leftMs)} or the match ends` : "" };
}

/**
 * What a player's own page says when it is shown again after an absence that ran their clock
 * (`awaySpare` on their member): the time they have left, plainly, in two lines, as the away note.
 * The hidden player cannot see the countdown the others see: this is where they learn it.
 */
export function backParts(spareMs) {
  const left = clockText(spareMs);
  return { who: `You're back, with ${left} to spare`, left: `Hidden on your turn for ${left} more, you forfeit. Time comes back while this page is shown.` };
}

/** How long a returning page at the Table says how close it came (party/public/away.js). */
export const BACK_NOTE_MS = 6000;

/**
 * At the Table: the other members of the game being played whose page is hidden or whose grace is
 * running, as this device (`you`) should see them: never itself, and only the game's seats.
 */
export function awayAtTable(room, you) {
  if (room?.phase !== "playing" || !room.game) return [];
  const seats = Array.isArray(room.game.seats) ? room.game.seats : [];
  return room.members.filter((m) => m && seats.includes(m.seat) && (m.away || typeof m.awayIn === "number") && !(you?.role === "player" && m.seat === you.seat));
}

/**
 * What the Table's away note says now (party/public/away.js): `{kind, who, left, dots}` ("back"
 * for this player's own return, "away" for others), or null for nothing. `seenAt` is when `room`
 * arrived, on the clock of `now`; `back` is `{spare, until}` while this player's return is told.
 */
export function awayNote(room, you, seenAt, now, back = null) {
  if (back && now < back.until) return { kind: "back", ...backParts(back.spare), dots: [] };
  const away = awayAtTable(room, you);
  if (!away.length) return null;
  const { who, left } = awayParts(
    away.map((m) => m.name),
    awayLeft(away, seenAt, now),
  );
  return { kind: "away", who, left, dots: away.map((m) => m.colour) };
}

/**
 * The time left before the first of these members runs out, in ms, counted down from when the
 * room view that said so arrived (`seenAt`, on the same clock as `now`), or null when none of them
 * has a limit. The room's word, not this page's guess: every room view carries it afresh.
 */
export function awayLeft(members, seenAt, now) {
  const limits = members.map((m) => m.awayIn).filter((ms) => typeof ms === "number");
  return limits.length ? Math.max(0, Math.min(...limits) - (now - seenAt)) : null;
}

/**
 * Whether a room view answers this player's return (the "You're back" note waits for it): the
 * room has heard the page is shown (its member is connected and not away) and runs no clock for
 * it. A view sent before the room heard "back" still says away, and is not the answer.
 */
export function returnHeard(member) {
  return !!member?.connected && !member.away && typeof member.awayIn !== "number";
}

/**
 * Keeps a Table player's screen awake while they play a turn-based game: a phone left on the
 * table mid-conversation must not lock itself and be taken for hidden. With no browser in it: the
 * caller says when the room changed and when the page is shown or tapped.
 *   - Wanted while the room plays a turn-based game this player is in; let go when it ends.
 *   - Taken again when the page is shown (a browser lets a lock go when the page is hidden) and on
 *     a tap (some browsers need one first). Let go by the browser while showing (low battery), it
 *     is asked for again.
 *   - When the page cannot hold one (no `wakeLock`, refused, low-power mode) it tells the room
 *     (`link.setWake(false)`), and the room then never charges this seat for being hidden, only for
 *     a dropped phone; once it holds one it says so (`setWake(true)`).
 */
export class WakeKeeper {
  /**
   * @param {{setWake: (held: boolean) => boolean, you: object | null}} link
   * @param {{wakeLock?: {request: (type: string) => Promise<any>} | null, hidden?: () => boolean}} opts
   */
  constructor(link, { wakeLock = null, hidden = () => false } = {}) {
    this.link = link;
    this.wakeLock = wakeLock;
    this.hidden = hidden;
    this.want = false;
    this.lock = null;
    this.asking = null;
  }

  /** The room view: a lock is wanted while this player plays a turn-based game. */
  room(room) {
    const you = this.link.you;
    const want = turnBased(room) && you?.role === "player" && Array.isArray(room.game.seats) && room.game.seats.includes(you.seat);
    if (want === this.want) return null;
    this.want = want;
    if (want) return this.take();
    const lock = this.lock;
    this.lock = null;
    lock?.release?.()?.catch?.(() => {});
    return null;
  }

  /** The page is shown again, or tapped: the lock is taken if it is wanted and not held. */
  shown() {
    return this.take();
  }

  take() {
    if (!this.want || this.lock || this.asking || this.hidden()) return this.asking;
    if (!this.wakeLock?.request) {
      this.link.setWake(false);
      return null;
    }
    this.asking = (async () => {
      try {
        const lock = await this.wakeLock.request("screen");
        if (!this.want) return void lock?.release?.()?.catch?.(() => {});
        this.lock = lock;
        lock?.addEventListener?.("release", () => {
          if (this.lock !== lock) return;
          this.lock = null;
          // Let go while showing (low battery, the system's own say): asked for again, or said it cannot.
          if (this.want && !this.hidden()) queueMicrotask(() => void this.take());
        });
        this.link.setWake(true);
      } catch {
        this.link.setWake(false);
      } finally {
        this.asking = null;
      }
    })();
    return this.asking;
  }
}

/**
 * The page's side of it, with no browser in it: the caller says when the page is hidden or
 * shown, offline or online, and when the room changed; `check` looks for a dead connection.
 */
export class ConnectionWatch {
  /**
   * @param {import("/party-kit/client/party-client.js").PartyClient} link
   * @param {{player: () => boolean, touch: boolean}} opts
   */
  constructor(link, { player, touch, now = Date.now() }) {
    this.link = link;
    this.player = player;
    this.touch = touch;
    /** null, "parked" (the socket closed on purpose) or "away" (hidden in a turn-based game, socket open). */
    this.mode = null;
    /**
     * When the page last sent a keep-alive to find out at once whether the socket lived through a
     * time it could not hear the room (hidden and away, or not running): the silence before it is
     * not counted, and the answer gets a few seconds.
     */
    this.askedAt = -Infinity;
    /** When `check` last looked. */
    this.checkedAt = now;
  }

  /** A keep-alive now, and the room's silence counted from here (see `askedAt`). */
  ask(now) {
    this.askedAt = now;
    this.link.ping();
  }

  hidden() {
    const what = whenHidden({ touch: this.touch, player: this.player(), room: this.link.room });
    if (what === "park") this.park();
    else if (what === "away" && this.mode === null) {
      this.mode = "away";
      this.link.setAway(true);
    }
  }

  shown(online = true, now = Date.now()) {
    if (this.mode === "away") {
      this.mode = null;
      // Back, and a keep-alive to find out at once whether the socket lived through it.
      this.link.setAway(false);
      this.ask(now);
      // The page runs again from here: the time hidden is accounted for by the question.
      this.checkedAt = now;
    } else if (online) this.unpark();
  }

  offline() {
    this.park();
  }

  online(hidden) {
    if (!hidden) this.unpark();
  }

  /**
   * The room changed while the page is hidden. A turn-based game that began finds a hidden page
   * with its socket open (a desktop tab) away; one that ended leaves the page as it would be in
   * the lobby.
   */
  roomChanged(hidden) {
    if (!hidden) return;
    const turns = turnBased(this.link.room);
    if (this.mode === null && turns) return this.hidden();
    if (this.mode !== "away" || turns) return;
    this.mode = null;
    if (whenHidden({ touch: this.touch, player: this.player(), room: this.link.room }) === "park") this.park();
    else this.link.setAway(false);
  }

  park() {
    const link = this.link;
    if (this.mode === "parked" || !link.session || link.status === "closed" || link.status === "idle") return;
    this.mode = "parked";
    link.dropConnection();
    // A page that comes back opens a socket that is showing.
    link.setAway(false);
  }

  unpark() {
    if (this.mode !== "parked") return;
    this.mode = null;
    this.link.connect();
  }

  /** Looked at every CHECK_EVERY_MS, by the page's own timer. */
  check(now = Date.now()) {
    const link = this.link;
    const stalled = now - this.checkedAt > STALLED_AFTER_MS;
    this.checkedAt = now;
    // Parked on purpose, or hidden and away: the keep-alive of a hidden page may be slowed or stopped, and that is not a dead connection.
    if (this.mode !== null || link.status !== "open" || !link.heardAt) return;
    // This look comes late: the page was not running (no keep-alive went out, and what the room
    // said meanwhile may still be waiting to be read). Its silence says nothing of the socket: ask.
    if (stalled) return this.ask(now);
    const since = Math.max(link.heardAt, this.askedAt - KEEP_ALIVE_MS);
    if (now - since > DEAD_AFTER_MS) link.dropConnection({ reconnectAfterMs: 0 });
  }
}

/**
 * @param {import("/party-kit/client/party-client.js").PartyClient} link
 * @param {{player: () => boolean}} opts  player: whether this device holds a seat
 */
export function watchConnection(link, { player }) {
  const watch = new ConnectionWatch(link, { player, touch: matchMedia("(pointer: coarse)").matches });
  document.addEventListener("visibilitychange", () => (document.hidden ? watch.hidden() : watch.shown(navigator.onLine !== false)));
  addEventListener("offline", () => watch.offline());
  addEventListener("online", () => watch.online(document.hidden));
  link.on("room", () => watch.roomChanged(document.hidden));
  setInterval(() => watch.check(), CHECK_EVERY_MS);
  return watch;
}
