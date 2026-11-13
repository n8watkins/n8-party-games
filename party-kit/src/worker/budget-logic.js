// The pure part of the room budget, so it can be tested without the Workers runtime.
//
// Rooms are the only part of a party game that costs money to host: a Durable Object is billed for
// every second it is awake, at 128 MB. The budget caps how much of the account's included room time
// the hosted rooms may use, per calendar month and per day (UTC).
// Figures: https://developers.cloudflare.com/durable-objects/platform/pricing/

/** A Durable Object is billed as 128 MB for as long as it is awake. */
export const ROOM_MEMORY_GB = 0.128;
/** Compute duration included in the Workers Paid plan each month, for the whole account. */
export const INCLUDED_GB_S = 400_000;
/** With no daily share set, one day may use at most this part of the month's budget. */
export const DEFAULT_DAY_SHARE = 0.1;
/** A room reports its awake time in steps of this size. */
export const REPORT_EVERY_MS = 60_000;
/** Requests to Durable Objects included in the Workers Paid plan each month, for the whole account. */
export const INCLUDED_REQUESTS = 1_000_000;
/** Incoming WebSocket messages are billed as requests at 20 to 1. */
export const MESSAGES_PER_REQUEST = 20;
/**
 * The least one event (a message, an alarm, a join) is counted as. A handler that only does
 * arithmetic finishes in well under a millisecond, and the Workers clock does not move while code
 * runs, so the time it took cannot be read; this floor is charged instead. It is set high on purpose.
 */
export const EVENT_FLOOR_MS = 2;

function share(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1) : null;
}

/**
 * The limits in GB-seconds, or null when no budget is set (then rooms are unlimited).
 * PARTY_ROOM_BUDGET_SHARE is the part of the plan's included duration rooms may use ("0.05" is 5%).
 * PARTY_ROOM_BUDGET_DAY_SHARE is the part of that monthly budget one day may use.
 */
export function limitsFromEnv(env) {
  const monthShare = share(env.PARTY_ROOM_BUDGET_SHARE);
  if (monthShare === null) return null;
  const month = INCLUDED_GB_S * monthShare;
  const day = month * (share(env.PARTY_ROOM_BUDGET_DAY_SHARE) ?? DEFAULT_DAY_SHARE);
  return { month, day };
}

/** The UTC month and day a moment falls in. */
export function periods(now) {
  const iso = new Date(now).toISOString();
  return { month: iso.slice(0, 7), day: iso.slice(0, 10) };
}

export function emptyUsage(now) {
  return { ...periods(now), monthUsed: 0, dayUsed: 0, monthRequests: 0, dayRequests: 0 };
}

/** The usage carried into `now`: a new day or month starts its own count from zero. */
export function rollOver(usage, now) {
  const p = periods(now);
  return {
    month: p.month,
    day: p.day,
    monthUsed: usage && usage.month === p.month ? usage.monthUsed : 0,
    dayUsed: usage && usage.day === p.day ? usage.dayUsed : 0,
    monthRequests: usage && usage.month === p.month ? (usage.monthRequests ?? 0) : 0,
    dayRequests: usage && usage.day === p.day ? (usage.dayRequests ?? 0) : 0,
  };
}

/**
 * The usage after a room was awake for `ms` more milliseconds. `requests` is what the room was
 * billed in requests over the same time (messages count one twentieth each); it is kept for the
 * owner's report and does not close anything: the budget is a budget of time.
 */
export function addRoomTime(usage, ms, now, requests = 0) {
  const next = rollOver(usage, now);
  const gbSeconds = (Math.max(0, ms) / 1000) * ROOM_MEMORY_GB;
  next.monthUsed += gbSeconds;
  next.dayUsed += gbSeconds;
  next.monthRequests += Math.max(0, requests);
  next.dayRequests += Math.max(0, requests);
  return next;
}

/**
 * Adds up everything a room is billed for while it is awake, so all of it reaches the budget.
 *
 * Cloudflare bills a Durable Object for the time it runs code, and for the time it sits in memory
 * unable to sleep (a timer is pending). So there are two kinds of awake time:
 *   - an event: one message, alarm, join or close. Counted as the time its handler took, and never
 *     less than EVENT_FLOOR_MS.
 *   - a hold: a span with a timer running (a game's tick loop). Counted in full, second for second;
 *     events inside a hold add no time of their own.
 * Requests are counted beside the time: a message is a twentieth of one, anything else is one.
 */
export class AwakeMeter {
  constructor() {
    this.ms = 0;
    this.requests = 0;
    this.heldFrom = null;
  }

  /** An event ran from `startedAt` to `endedAt`. `kind` is "message" or "request". */
  event(startedAt, endedAt, kind = "request") {
    if (this.heldFrom === null) this.ms += Math.max(EVENT_FLOOR_MS, endedAt - startedAt);
    this.requests += kind === "message" ? 1 / MESSAGES_PER_REQUEST : 1;
  }

  /** A timer started: the room cannot sleep until release(). */
  hold(now) {
    if (this.heldFrom === null) this.heldFrom = now;
  }

  release(now) {
    this.settle(now);
    this.heldFrom = null;
  }

  /** Moves the held time so far into the total. */
  settle(now) {
    if (this.heldFrom === null) return;
    this.ms += Math.max(0, now - this.heldFrom);
    this.heldFrom = now;
  }

  /** Adds what was carried somewhere else for a while (a socket's share that survived a sleep). */
  add(ms, requests) {
    this.ms += Math.max(0, ms);
    this.requests += Math.max(0, requests);
  }

  /** What is owed since the last take, and a clean slate. */
  take(now) {
    this.settle(now);
    const owed = { ms: this.ms, requests: this.requests };
    this.ms = 0;
    this.requests = 0;
    return owed;
  }
}

/** "open", or which limit is spent: "day" or "month". */
export function budgetState(usage, limits, now) {
  if (!limits) return "open";
  const current = rollOver(usage, now);
  if (current.monthUsed >= limits.month) return "month";
  if (current.dayUsed >= limits.day) return "day";
  return "open";
}

/** What 'the rooms are full' reads like for the party room, where there is no solo play to point at. */
export function partyFullMessage(state) {
  return state === "month" ? "The party rooms are full for this month. Each game still plays on its own page." : "The party rooms are full for today. They reopen tomorrow, and each game still plays on its own page.";
}

export function fullMessage(state) {
  return state === "month"
    ? "Battles are full for this month. Solo play still works."
    : "Battles are full for today. Solo play still works, and battles reopen tomorrow.";
}
