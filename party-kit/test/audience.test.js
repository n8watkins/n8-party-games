// A game for fewer seats than the party, its audience, and the upright phone: the plain logic
// (party-kit/src/core/audience.js and views.js).
import { describe, expect, it } from "vitest";
import { hasAudience, isUpright, needsSpots, openSpots, spotSeats, spotsFull, takeSpots, validSpots } from "../src/core/audience.js";
import { eventsFor, viewerFor, viewerKey } from "../src/core/views.js";

describe("who is the audience", () => {
  it("is opted into by the game or its manifest, and by nothing else", () => {
    expect(hasAudience({ audience: true }, {})).toBe(true);
    expect(hasAudience({}, { audience: true })).toBe(true);
    expect(hasAudience({}, {})).toBe(false);
    expect(hasAudience({ audience: "yes" }, { audience: 1 })).toBe(false);
    expect(hasAudience(null, null)).toBe(false);
  });

  it("gives a member who is not in the round the audience's viewer only with the opt-in", () => {
    const round = new Set([0, 1]);
    expect(viewerFor({ role: "player", seat: 2 }, round, { audience: true })).toEqual({ role: "audience", seat: 2 });
    expect(viewerFor({ role: "player", seat: 2 }, round)).toEqual({ role: "screen", seat: 2 });
    expect(viewerFor({ role: "player", seat: 1 }, round, { audience: true })).toEqual({ role: "player", seat: 1 });
    // The big screen stays the screen, and before a round everyone is a player.
    expect(viewerFor({ role: "screen", seat: -1 }, round, { audience: true })).toEqual({ role: "screen" });
    expect(viewerFor({ role: "player", seat: 2 }, null, { audience: true })).toEqual({ role: "player", seat: 2 });
  });

  it("keys the audience apart from the screen, and never sends it an event addressed to a seat", () => {
    expect(viewerKey({ role: "audience", seat: 2 })).toBe("audience:2");
    expect(viewerKey({ role: "screen", seat: 2 })).toBe("screen:2");
    const events = [{ k: "said" }, { k: "psst", only: 2 }];
    expect(eventsFor(events, { role: "audience", seat: 2 })).toEqual([{ k: "said" }]);
    expect(eventsFor(events, { role: "player", seat: 2 })).toEqual(events);
  });
});

describe("spots", () => {
  it("are needed only by a game with an audience, for a party larger than its seats", () => {
    expect(needsSpots({ audience: true, seats: 2 }, 3)).toBe(true);
    expect(needsSpots({ audience: true, seats: 2 }, 2)).toBe(false);
    expect(needsSpots({ audience: false, seats: 2 }, 4)).toBe(false);
    expect(needsSpots({ audience: true, seats: undefined }, 4)).toBe(false);
  });

  it("go to the first to stand on them, are kept by the piece on them, and freed when it steps off or goes", () => {
    let spots = openSpots(["a", "b"]);
    expect(spots).toEqual([
      { place: "a", seat: null },
      { place: "b", seat: null },
    ]);
    // Cy stands on a first.
    let next = takeSpots(spots, { 0: null, 2: "a" });
    expect(next).toMatchObject({ changed: true, spots: [{ seat: 2 }, { seat: null }] });
    spots = next.spots;
    // Ann comes to a as well: Cy keeps it.
    next = takeSpots(spots, { 0: "a", 2: "a" });
    expect(next.changed).toBe(false);
    // Two arrive on b together: the lower seat takes it.
    spots = takeSpots(spots, { 0: "a", 1: "b", 2: "a", 3: "b" }).spots;
    expect(spotSeats(spots)).toEqual([1, 2]);
    expect(spotsFull(spots)).toBe(true);
    // Cy steps off; Ann, still standing there, takes a.
    spots = takeSpots(spots, { 0: "a", 1: "b", 2: null, 3: "b" }).spots;
    expect(spots.map((s) => s.seat)).toEqual([0, 1]);
    // Bo is gone (no longer in the list): b is Di's, who still stands there.
    spots = takeSpots(spots, { 0: "a", 3: "b" }).spots;
    expect(spots.map((s) => s.seat)).toEqual([0, 3]);
    // A piece holds one spot at most.
    expect(takeSpots(openSpots(["a", "a"]), { 1: "a" }).spots.map((s) => s.seat)).toEqual([1, null]);
    expect(spotsFull(openSpots([]))).toBe(false);
  });

  it("are taken only by a piece standing still on one, and kept by a holder that moves inside its light", () => {
    // Cy walks through a: she does not take it.
    let next = takeSpots(openSpots(["a", "b"]), { 2: "a" }, { moving: [2] });
    expect(next).toMatchObject({ changed: false, spots: [{ seat: null }, { seat: null }] });
    // She stops there: it is hers.
    next = takeSpots(next.spots, { 2: "a" }, { moving: [] });
    expect(next.spots.map((s) => s.seat)).toEqual([2, null]);
    // She shuffles inside the light: she keeps it, and Ann, walking in, does not take b in passing.
    next = takeSpots(next.spots, { 0: "b", 2: "a" }, { moving: [0, 2] });
    expect(next).toMatchObject({ changed: false, spots: [{ seat: 2 }, { seat: null }] });
  });

  it("read back from a save only in their own shape", () => {
    expect(validSpots([{ place: "a", seat: null }, { place: "b", seat: 3 }])).toBe(true);
    expect(validSpots([])).toBe(false);
    expect(validSpots([{ place: 1, seat: null }])).toBe(false);
    expect(validSpots([{ place: "a", seat: "3" }])).toBe(false);
    expect(validSpots(null)).toBe(false);
  });
});

describe("upright", () => {
  it("is a game whose manifest's devices say so", () => {
    expect(isUpright({ devices: { phone: true, upright: true } })).toBe(true);
    expect(isUpright({ devices: { sideways: "preferred" } })).toBe(false);
    expect(isUpright({})).toBe(false);
  });
});
