// The pure part of the rate limiter, so it can be tested without the Workers runtime.
export const RATE_LIMITS = {
  create: { limit: 30, windowMs: 60_000 },
  join: { limit: 40, windowMs: 60_000 },
  // PINs are only 4 digits, so guessing them is limited far harder than room codes.
  pin_short: { limit: 20, windowMs: 10 * 60_000 },
  pin_long: { limit: 60, windowMs: 60 * 60_000 },
};

/** The window after one more attempt at `now`. */
export function nextWindow(current, rule, now) {
  const window = now - current.start >= rule.windowMs ? { start: now, count: 0 } : { ...current };
  window.count += 1;
  return window;
}

/**
 * The key a client is limited by. One IPv6 customer usually holds a whole /64, so all of it counts
 * as one client; IPv4 addresses, including IPv4-mapped IPv6 ones, are used as they are.
 */
export function clientKey(ip) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const zeros = tail === undefined ? [] : new Array(Math.max(0, 8 - left.length - right.length)).fill("0");
  const groups = [...left, ...zeros, ...right].slice(0, 4);
  return `${groups.map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

