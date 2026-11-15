// Keeping a phone's place in the room honest when its connection comes and goes.
//
//   - A phone that is locked or put away (the page is hidden) closes its connection at once, so
//     everyone else sees its piece turn grey straight away instead of a minute later; it opens
//     it again the moment the page is shown. Its seat is held meanwhile (lobby-core.js: the piece
//     fades after DROP_FADE_MS, the seat is kept for SEAT_HOLD_MS).
//   - Except during a turn-based game (`room.game.turns`, a match of people talking): there a
//     hidden page is away, not gone. It keeps its socket, tells the room it is away, and says it
//     is back when it is shown, so the game may pause its turn timer and nobody's grace runs down.
//     If the socket died while the page was hidden (the phone suspended it, the signal went),
//     the page reconnects the moment it is shown and takes its seat back; the room took the gap
//     for a drop, with the game's own grace.
//   - The browser saying it is offline closes the connection too.
//   - A connection that has quietly died (no reply to the keep-alive) is noticed here and opened
//     again: the page says "Reconnecting..." instead of looking alive and doing nothing.
// The keep-alive and the away and back messages are all the room hears of it. The keep-alive is
// answered by the runtime and never wakes the room; away and back wake it once each.

/** The page's keep-alive, which the runtime answers without waking the room. */
export const KEEP_ALIVE_MS = 10_000;
/** No word at all from the room for this long, with the keep-alive going: the connection is dead. */
export const DEAD_AFTER_MS = KEEP_ALIVE_MS + 6000;

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

/**
 * The page's side of it, with no browser in it: the caller says when the page is hidden or
 * shown, offline or online, and when the room changed; `check` looks for a dead connection.
 */
export class ConnectionWatch {
  /**
   * @param {import("/party-kit/client/party-client.js").PartyClient} link
   * @param {{player: () => boolean, touch: boolean}} opts
   */
  constructor(link, { player, touch }) {
    this.link = link;
    this.player = player;
    this.touch = touch;
    /** null, "parked" (the socket closed on purpose) or "away" (hidden in a turn-based game, socket open). */
    this.mode = null;
    /** When the page was last shown after being away: the keep-alive has not been answered since. */
    this.shownAt = -Infinity;
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
      this.shownAt = now;
      // Back, and a keep-alive to find out at once whether the socket lived through it.
      this.link.setAway(false);
      this.link.ping();
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

  /** Looked at every couple of seconds. */
  check(now = Date.now()) {
    const link = this.link;
    // Parked on purpose, or hidden and away: the keep-alive of a hidden page may be slowed or stopped, and that is not a dead connection.
    if (this.mode !== null || link.status !== "open" || !link.heardAt) return;
    const since = Math.max(link.heardAt, this.shownAt - KEEP_ALIVE_MS);
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
  setInterval(() => watch.check(), 2000);
  return watch;
}
