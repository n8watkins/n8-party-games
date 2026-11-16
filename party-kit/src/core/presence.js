// Presence during a turn-based game: who among the game's seats is here, away or gone, and what
// the game is told about it. A turn-based game is humans only: nobody stands in for a player, so
// a dropped or locked phone keeps its seat for a grace the game chooses, the game hears about
// every change through `game.presence`, and a seat gone for good ends the game early through
// `game.abandon`.
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

/**
 * Whether a seat in the game is gone for good, and why: `"left"` when its player is no longer in
 * the room (they left the party, or were put out), `"gone"` when the phone dropped and the grace
 * ran out, or null while the seat is held. Only the game's seats are ever asked about: a member
 * of the party who is not playing never ends a game. Being away (connected, page hidden) never
 * runs the grace down: that phone can still be reached.
 */
export function goneWhy(member, now, grace) {
  if (!member) return "left";
  if (member.connected || member.droppedAt === null || member.droppedAt === undefined) return null;
  return now - member.droppedAt >= grace ? "gone" : null;
}

/** When a dropped seat's grace runs out, or null while it is connected or held forever. */
export function graceEndsAt(member, grace) {
  if (!member || member.connected || member.droppedAt === null || member.droppedAt === undefined) return null;
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
  for (const name of ["presence", "abandon"]) {
    if (game[name] !== undefined && typeof game[name] !== "function") problems.push(`${name}, when given, is a function.`);
  }
  return problems;
}
