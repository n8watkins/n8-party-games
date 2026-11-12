// The pure part of the PIN directory, so it can be tested without the Workers runtime.
export const PIN_DIRECTORY_NAME = "pins";
export const PIN_LENGTH = 4;
/** A PIN lasts this long unless it is refreshed. */
export const PIN_TTL_MS = 15 * 60_000;
/** A released PIN is not reused for this long, so a late typist never lands in another room. */
export const PIN_COOLDOWN_MS = 10 * 60_000;
export const PIN_SPACE = 10 ** PIN_LENGTH;
/** Above this many live PINs none are issued, which keeps guessing odds at 50% or lower. */
export const MAX_LIVE_PINS = PIN_SPACE / 2;

export function isPin(value) {
  return typeof value === "string" && /^\d{4}$/.test(value);
}

export function randomIndex(size) {
  // Rejection sampling keeps every index equally likely.
  const limit = 2 ** 32 - (2 ** 32 % size);
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % size;
  }
}

/** Picks uniformly among the PINs not in `occupied`, or null when none are free. */
export function pickFreePin(occupied, pick = randomIndex) {
  const free = [];
  for (let n = 0; n < PIN_SPACE; n++) {
    const pin = String(n).padStart(PIN_LENGTH, "0");
    if (!occupied.has(pin)) free.push(pin);
  }
  return free.length ? free[pick(free.length)] : null;
}

