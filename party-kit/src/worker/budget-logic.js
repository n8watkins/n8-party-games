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
  return { ...periods(now), monthUsed: 0, dayUsed: 0 };
}

/** The usage carried into `now`: a new day or month starts its own count from zero. */
export function rollOver(usage, now) {
  const p = periods(now);
  return {
    month: p.month,
    day: p.day,
    monthUsed: usage && usage.month === p.month ? usage.monthUsed : 0,
    dayUsed: usage && usage.day === p.day ? usage.dayUsed : 0,
  };
}

/** The usage after a room was awake for `ms` more milliseconds. */
export function addRoomTime(usage, ms, now) {
  const next = rollOver(usage, now);
  const gbSeconds = (Math.max(0, ms) / 1000) * ROOM_MEMORY_GB;
  next.monthUsed += gbSeconds;
  next.dayUsed += gbSeconds;
  return next;
}

/** "open", or which limit is spent: "day" or "month". */
export function budgetState(usage, limits, now) {
  if (!limits) return "open";
  const current = rollOver(usage, now);
  if (current.monthUsed >= limits.month) return "month";
  if (current.dayUsed >= limits.day) return "day";
  return "open";
}

export function fullMessage(state) {
  return state === "month"
    ? "Battles are full for this month. Solo play still works."
    : "Battles are full for today. Solo play still works, and battles reopen tomorrow.";
}
