// A code the front page looked up is handed to the party room's way in once, so a join from the
// front page costs no more look-ups than one typed straight into the way in
// (lobby/public/door-handoff.js).
import { describe, expect, it } from "vitest";
import { HANDOFF_MS, passLookup, takeLookup } from "../public/door-handoff.js";

/** A stand-in for sessionStorage. */
function memory() {
  const items = new Map();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, String(v)), removeItem: (k) => items.delete(k), size: () => items.size };
}
const PREVIEW = { code: "abc123", players: ["Ann"], full: false, screen: false, mode: "turn-based" };

describe("a looked-up code handed to the way in", () => {
  it("is taken once, for that code", () => {
    const s = memory();
    passLookup(s, "4821", PREVIEW, 1000);
    expect(takeLookup(s, "4821", 2000)).toEqual(PREVIEW);
    expect(takeLookup(s, "4821", 2000)).toBeNull();
    expect(s.size()).toBe(0);
  });

  it("is not used for another code, and does not linger", () => {
    const s = memory();
    passLookup(s, "4821", PREVIEW, 1000);
    expect(takeLookup(s, "1111", 2000)).toBeNull();
    expect(takeLookup(s, "4821", 2000)).toBeNull();
  });

  it("goes stale, so an old answer is asked again", () => {
    const s = memory();
    passLookup(s, "4821", PREVIEW, 1000);
    expect(takeLookup(s, "4821", 1000 + HANDOFF_MS + 1)).toBeNull();
  });

  it("asks again when storage is refused or holds something else", () => {
    const refused = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => {} };
    expect(() => passLookup(refused, "4821", PREVIEW)).not.toThrow();
    expect(takeLookup(refused, "4821")).toBeNull();
    expect(takeLookup(null, "4821")).toBeNull();
    const s = memory();
    s.setItem("party-kit:looked-up", "not json");
    expect(takeLookup(s, "4821")).toBeNull();
  });
});
