// The pure part of the rate limiter, so it can be tested without the Workers runtime.
export const RATE_LIMITS = {
  // A person makes a room now and then; a script makes many. Two windows: a burst and a day.
  create_short: { limit: 5, windowMs: 10 * 60_000 },
  create_long: { limit: 20, windowMs: 24 * 60 * 60_000 },
  join: { limit: 40, windowMs: 60_000 },
  // PINs are only 4 digits, so guessing them is limited far harder than room codes.
  pin_short: { limit: 20, windowMs: 10 * 60_000 },
  pin_long: { limit: 60, windowMs: 60 * 60_000 },
  // A round takes a minute and a half, so nobody honest posts a score more often than this.
  score_short: { limit: 6, windowMs: 10 * 60_000 },
  score_long: { limit: 60, windowMs: 24 * 60 * 60_000 },
  // Opening a room's socket. The door cannot tell a good socket from a bad one (the seat's token
  // is the first message, not part of the address), so it limits how many one address may open:
  // each one wakes the room. A party of five devices on one address, each reconnecting as fast as
  // the client's back-off allows (every four seconds), opens 75 a minute; a script opens far more.
  socket: { limit: 120, windowMs: 60_000 },
};

/**
 * What one open socket may send. A bucket holds `burst` messages and refills at `perSecond`; a
 * message that finds it empty is dropped and counts as a strike, and a socket that reaches
 * `strikes` is closed. Incoming messages are billed whether or not they are dropped, so a client
 * that keeps flooding has to lose its connection, not only its messages.
 */
export const SOCKET_RATE = { burst: 40, perSecond: 20, strikes: 60 };

/** A full bucket for a socket that has just opened (or a room that has just woken). */
export function newBucket(now, rule = SOCKET_RATE) {
  return { tokens: rule.burst, at: now, strikes: 0 };
}

/**
 * Takes one message out of the bucket. Returns "ok", "drop" (over the rate, the message is
 * ignored) or "close" (too many drops: the socket goes). `weight` lets a malformed or oversized
 * message count for more than one strike.
 */
export function takeMessage(bucket, now, rule = SOCKET_RATE, weight = 1) {
  bucket.tokens = Math.min(rule.burst, bucket.tokens + (Math.max(0, now - bucket.at) / 1000) * rule.perSecond);
  bucket.at = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return "ok";
  }
  bucket.strikes += weight;
  return bucket.strikes >= rule.strikes ? "close" : "drop";
}

/** A message that could not be read at all (too long, not JSON, not an object) is a strike on its own. */
export function strike(bucket, rule = SOCKET_RATE, weight = 5) {
  bucket.strikes += weight;
  return bucket.strikes >= rule.strikes ? "close" : "drop";
}

/** The window after one more attempt at `now`. */
export function nextWindow(current, rule, now) {
  const window = now - current.start >= rule.windowMs ? { start: now, count: 0 } : { ...current };
  window.count += 1;
  return window;
}

/**
 * The key a client is limited by. One IPv6 customer usually holds a whole /64, so all of it counts
 * as one client (`prefix`, 64 or 48); IPv4 addresses, including IPv4-mapped IPv6 ones, are used as
 * they are.
 */
export function clientKey(ip, prefix = 64) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const zeros = tail === undefined ? [] : new Array(Math.max(0, 8 - left.length - right.length)).fill("0");
  const groups = [...left, ...zeros, ...right].slice(0, prefix / 16);
  return `${groups.map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/${prefix}`;
}

/**
 * The client a room's socket comes from, only for sharing out the sockets a room lets wait for
 * their hello (hello-logic.js), where a client only ever pushes out its own. IPv6 counts by the
 * /48: that is what a home or a small host is commonly given, and one /48 holds 65,536 /64s, each
 * of which would otherwise count as a client of its own. Never for the door's rate limits (those
 * keep the /64, clientKey): they are one allowance across every room and refuse outright, and a
 * carrier's phones share /48s. With no address (a local run, a test) every socket is the one local
 * client, as the rate limiter has always counted them.
 */
export function socketClient(ip) {
  return clientKey(ip || "local", 48);
}

