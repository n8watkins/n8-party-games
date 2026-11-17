// A code already looked up, handed to the party room's way in (door.js) so it does not ask again.
//
// Every look-up and every join counts against the same limit on guessing codes (20 in ten minutes
// for each address, party-kit/src/worker/limit-logic.js, pin_short). The front page's "Got a
// code? Join" looks the code up to say a wrong code or a full party at once; the way in then
// takes that answer instead of looking the same code up a second time, so a join from the front
// page costs what a join typed straight into the way in costs: one look-up and one join. A party
// of friends on one Wi-Fi shares that limit.
//
// The answer lives in this tab's sessionStorage, for a short while and for one read.

const KEY = "party-kit:looked-up";
/** How long an answer is trusted: the time it takes to follow the link it was looked up for. */
export const HANDOFF_MS = 30_000;

/** Keeps the room's answer for `code` ({code, players, full, screen, mode, ...}) for the way in. */
export function passLookup(storage, code, preview, now = Date.now()) {
  try {
    storage?.setItem(KEY, JSON.stringify({ code, preview, at: now }));
  } catch {
    // Private browsing: the way in looks the code up itself.
  }
}

/** The answer kept for `code`, once, if it is fresh; null otherwise (and then the way in asks). */
export function takeLookup(storage, code, now = Date.now()) {
  let saved = null;
  try {
    saved = JSON.parse(storage?.getItem(KEY) ?? "null");
    storage?.removeItem(KEY);
  } catch {
    return null;
  }
  if (!saved || saved.code !== code || typeof saved.at !== "number" || now - saved.at < 0 || now - saved.at > HANDOFF_MS) return null;
  return saved.preview && typeof saved.preview === "object" ? saved.preview : null;
}
