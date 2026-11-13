// What the way in offers a device (lobby/shared/entry.js): a phone leads with playing, a wide
// screen is offered both, and a party that has its screen offers only playing.
import { describe, expect, it } from "vitest";
import { ROLE_CARDS, doorPlan, isSmall } from "../shared/entry.js";

describe("which devices are phones", () => {
  it("goes by the short side of the window, upright or sideways", () => {
    expect(isSmall(390, 844)).toBe(true);
    expect(isSmall(844, 390)).toBe(true);
    expect(isSmall(1280, 720)).toBe(false);
    expect(isSmall(1024, 768)).toBe(false);
  });
});

describe("a phone", () => {
  it("leads with playing, and being the screen is a small link", () => {
    for (const starting of [true, false]) {
      const plan = doorPlan({ small: true, starting, as: "player" });
      expect(plan).toMatchObject({ as: "player", choice: "link", askName: true, note: "" });
      expect(plan.link).toEqual({ to: "screen", text: "Use this phone as the room's screen" });
    }
    expect(doorPlan({ small: true, starting: false, as: "player" }).go).toBe("Join the party");
    expect(doorPlan({ small: true, starting: true, as: "player" }).go).toBe("Start the party");
  });

  it("can be the screen when its owner says so, and can always go back", () => {
    const plan = doorPlan({ small: true, starting: false, as: "screen" });
    expect(plan).toMatchObject({ as: "screen", choice: "link", askName: false, go: "Show the room here" });
    expect(plan.link).toEqual({ to: "player", text: "Play on this phone instead" });
    expect(plan.sub).toMatch(/Nobody plays from it/);
  });
});

describe("a wide screen", () => {
  it("is offered both ways, side by side, and nothing is chosen behind its back", () => {
    for (const starting of [true, false]) {
      for (const as of ["player", "screen"]) {
        const plan = doorPlan({ small: false, starting, as });
        expect(plan).toMatchObject({ as, choice: "cards", link: null, askName: as === "player" });
      }
    }
    expect(ROLE_CARDS.map((card) => card[0])).toEqual(["player", "screen"]);
    expect(ROLE_CARDS.map((card) => card[1])).toEqual(["Play on this device", "Use this as the room's screen"]);
  });
});

describe("a party that already has its screen", () => {
  it("does not offer to be the screen, on any device, and says why", () => {
    for (const small of [true, false]) {
      for (const as of ["player", "screen"]) {
        const plan = doorPlan({ small, starting: false, as, screenTaken: true });
        expect(plan).toMatchObject({ as: "player", choice: "none", link: null, askName: true, go: "Join the party" });
        // A phone that only ever meant to play is not told about a choice it never had in front of it.
        if (small && as === "player") expect(plan.note).toBe("");
        else expect(plan.note).toMatch(/already has its screen/);
      }
    }
  });

  it("has nothing to do with starting a new party", () => {
    expect(doorPlan({ small: false, starting: true, as: "screen", screenTaken: true })).toMatchObject({ as: "screen", choice: "cards", note: "" });
  });
});
