// Presence during a turn-based game: who among the game's seats is here, away or gone, and what
// the game is told about it. A turn-based game is humans only: nobody stands in for a player, so
// a dropped phone or a hidden page keeps its seat for a grace the game chooses (one clock for
// both: absenceClock), the game hears about every change through `game.presence`, and a seat gone
// for good ends the game early through `game.abandon`.
//
// Plain logic: no network, no clock, no storage. Any room class (the party room today, the kit's
// own room later) can use it to decide what a game is told and when a seat is gone.

/** The socket messages a page sends when it is hidden (a locked phone, another app) and shown again. */
export const PRESENCE_AWAY = "away";
export const PRESENCE_BACK = "back";

/** Whether a page is reporting that it is hidden (`true`) or shown again (`false`); null for any other message. */
export function presenceSignal(msg) {
  if (msg?.t === PRESENCE_AWAY) return true;
  if (msg?.t === PRESENCE_BACK) return false;
  return null;
}

/** A player with several sockets (two tabs) is away only when every open one is hidden. */
export function allAway(sockets) {
  let n = 0;
  for (const s of sockets) {
    if (!s.away) return false;
    n++;
  }
  return n > 0;
}

/** What a game is told about one seat: `{connected, away}`. A seat whose player is not in the room is not connected. */
export function reportOf(member) {
  if (!member?.connected) return { connected: false, away: false };
  return { connected: true, away: !!member.away };
}

export function sameReport(a, b) {
  return !!a && !!b && a.connected === b.connected && a.away === b.away;
}

/**
 * How long a seat whose phone dropped keeps its place in the game: the game's
 * `reconnectGraceMs` (Infinity: while the room lives), or `fallback` when it says nothing.
 */
export function graceOf(game, fallback) {
  const ms = game?.reconnectGraceMs;
  return typeof ms === "number" && ms >= 0 ? ms : fallback;
}

/** Whether a seat's player is missing from the game: their phone dropped, or their page is hidden (away). */
export function isMissing(member) {
  return !member?.connected || !!member.away;
}

/**
 * Whether the game needs this seat's player right now (`game.needs(state, seat)`, say the player
 * whose turn it is): only then does a hidden page run the seat's grace. False for a game without
 * the hook, and for one whose hook throws or says anything but `true`.
 */
export function seatNeeded(game, state, seat) {
  if (typeof game?.needs !== "function") return false;
  try {
    return game.needs(state, seat) === true;
  } catch (err) {
    console.error(`party room: ${game.id} needs() failed; the seat is taken as not needed`, err);
    return false;
  }
}

/**
 * The clock a seat's grace runs on during a turn-based game. A dropped phone and a hidden page
 * (away) run the same clock: one clock per seat, so a page that is hidden and then drops is not
 * given a second grace. The rule:
 *   - While the seat is missing its clock runs, one millisecond of the grace for each.
 *   - When the player is back it winds back up at the same speed: back for as long as they were
 *     missing, they have the whole grace again. So blinking in and out (hidden 50 seconds, shown
 *     2, hidden again) does not start it over: each second missing needs a second back.
 *   - A move the game takes from the seat (an input it accepts) gives the whole grace back at once.
 *   - Held still (`still`): a hidden page the game does not need right now (`game.needs`, say
 *     while the other player has the turn) neither runs nor winds back: the time it has used waits
 *     for the seat's next turn, and nothing runs out meanwhile.
 * `{since, used, at, still?}`: `since` is when the seat went missing (null while it is here or
 * held still), `used` is how much of the grace was used then (or, while it is here, at `at`, when
 * it came back; or, held still, all it has used).
 */
export function absenceClock(now = -Infinity) {
  return { since: null, used: 0, at: now };
}

/** How much of the grace a seat's clock has used at `now`. */
export function graceUsed(clock, now) {
  if (clock.still) return clock.used;
  if (clock.since !== null) return clock.used + Math.max(0, now - clock.since);
  return Math.max(0, clock.used - Math.max(0, now - clock.at));
}

/** The clock held still at `now`: what it has used is kept, and nothing runs or winds back until trackAbsence looks again. */
export function stillClock(clock, now) {
  if (clock.still) return clock;
  return { since: null, used: graceUsed(clock, now), at: now, still: true };
}

/**
 * The clock after a look at whether the seat is missing: it starts running when the seat goes
 * missing (from `from`, when it dropped earlier than now, never before its own last change), and
 * stops when the seat is back. A clock held still starts again from `now`, either way. The same
 * clock comes back when nothing changed.
 */
export function trackAbsence(clock, missing, now, from = now) {
  if (clock.still) clock = { since: null, used: clock.used, at: now };
  if (missing && clock.since === null) {
    const since = Math.max(Number.isFinite(clock.at) ? clock.at : -Infinity, Math.min(now, from));
    return { since, used: graceUsed(clock, since), at: since };
  }
  if (!missing && clock.since !== null) return { since: null, used: graceUsed(clock, now), at: now };
  return clock;
}

/** When a running clock uses up the grace, or null while the seat is here or the grace never ends. */
export function clockEndsAt(clock, grace) {
  if (!clock || clock.since === null) return null;
  const at = clock.since + grace - clock.used;
  return Number.isFinite(at) ? at : null;
}

/** Whether a clock read back from storage has the right shape. */
export function isClock(clock) {
  return !!clock && typeof clock === "object" && (clock.since === null || typeof clock.since === "number") && typeof clock.used === "number" && typeof clock.at === "number" && (clock.still === undefined || clock.still === true);
}

/** How much of the grace a seat has left by its clock, in ms, or null when the grace never ends. */
export function graceLeft(clock, grace, now) {
  return Number.isFinite(grace) ? Math.max(0, grace - graceUsed(clock, now)) : null;
}

/**
 * Whether a seat in the game is gone for good, and why: `"left"` when its player is no longer in
 * the room (they left the party, or were put out), `"gone"` when the player has been missing
 * (dropped, or away with the page hidden) for the whole grace by the seat's clock, or null while
 * the seat is held. Only the game's seats are ever asked about: a member of the party who is not
 * playing never ends a game. Without a clock (a room class that keeps none), only a dropped
 * phone's grace runs, from when it dropped.
 */
export function goneWhy(member, now, grace, clock = null) {
  if (!member) return "left";
  if (clock) {
    const at = clockEndsAt(clock, grace);
    return at !== null && now >= at ? "gone" : null;
  }
  if (member.connected || member.droppedAt === null || member.droppedAt === undefined) return null;
  return now - member.droppedAt >= grace ? "gone" : null;
}

/** When a seat's grace runs out (by its clock, or without one from when it dropped), or null while it is here or held forever. */
export function graceEndsAt(member, grace, clock = null) {
  if (!member) return null;
  if (clock) return clockEndsAt(clock, grace);
  if (member.connected || member.droppedAt === null || member.droppedAt === undefined) return null;
  const at = member.droppedAt + grace;
  return Number.isFinite(at) ? at : null;
}

/**
 * What `game.presence` gave back. Nothing, `false` or `null`: nothing changed, so nothing is
 * saved or sent. `true`: the state changed. A list: the state changed and these are events for
 * the viewers, like tick's. An object: `events` on it, and `changed: false` to say nothing did.
 */
export function presenceOutcome(returned) {
  if (returned === true) return { changed: true, events: [] };
  if (Array.isArray(returned)) return { changed: true, events: returned };
  if (returned && typeof returned === "object") {
    const events = Array.isArray(returned.events) ? returned.events : [];
    return { changed: returned.changed !== false || events.length > 0, events };
  }
  return { changed: false, events: [] };
}

/**
 * What `game.abandon` gave back, as the room ends the game with it. Nothing: the game ends with no
 * points and no result. An object may carry `standings` (`[{seat, place}]`, as `game.standings`
 * returns: places become points), `result` (sent to everyone with the end, as `game.result`) and
 * `events` (sent to the viewers before the end).
 */
export function abandonOutcome(returned) {
  if (!returned || typeof returned !== "object" || Array.isArray(returned)) return { standings: [], result: null, events: [] };
  return {
    standings: Array.isArray(returned.standings) ? returned.standings : [],
    result: returned.result ?? null,
    events: Array.isArray(returned.events) ? returned.events : [],
  };
}

/**
 * How long a room waits, while this game is being played, before it closes as empty
 * (`idleShutdownMs`) or as forgotten (`staleRoomMs`): the game's own, or the room's defaults.
 */
export function lifetimesOf(game, defaults) {
  const pick = (ms, fallback) => (typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : fallback);
  return { idleShutdownMs: pick(game?.idleShutdownMs, defaults.idleShutdownMs), staleRoomMs: pick(game?.staleRoomMs, defaults.staleRoomMs) };
}

/** What is wrong with a game's presence and lifetime fields, as sentences (gameProblems adds these). */
export function presenceProblems(game) {
  const problems = [];
  const grace = game.reconnectGraceMs;
  if (grace !== undefined && !(typeof grace === "number" && grace >= 0 && !Number.isNaN(grace))) problems.push("reconnectGraceMs is a number of milliseconds, 0 or more (Infinity: while the room lives).");
  for (const name of ["idleShutdownMs", "staleRoomMs"]) {
    const ms = game[name];
    if (ms !== undefined && !(typeof ms === "number" && Number.isFinite(ms) && ms > 0)) problems.push(`${name} is a number of milliseconds, more than 0.`);
  }
  for (const name of ["presence", "abandon", "needs"]) {
    if (game[name] !== undefined && typeof game[name] !== "function") problems.push(`${name}, when given, is a function.`);
  }
  return problems;
}
