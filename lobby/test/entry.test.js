// What the way in offers a device (lobby/shared/entry.js): a phone leads with playing, a wide
// screen is offered both, and a party that has its screen offers only playing.
import { describe, expect, it } from "vitest";
import { doorPlan, isSmall, roleCards } from "../shared/entry.js";

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
    expect(roleCards().map((card) => card[0])).toEqual(["player", "screen"]);
    expect(roleCards().map((card) => card[1])).toEqual(["Play on this device", "Use this as the room's screen"]);
  });

  it("speaks of a piece only for a party on the Floor, never at the Table", () => {
    expect(roleCards()[0][2]).toBe("Join as a player, with your own piece.");
    expect(roleCards("party-games")[0][2]).toBe("Join as a player, with your own piece.");
    const table = roleCards("turn-based");
    expect(table.map((card) => card[1])).toEqual(["Play on this device", "Use this as the room's screen"]);
    for (const [, , text] of table) expect(text).not.toMatch(/piece/);
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

describe("a way in for the Table (the front page's /table/)", () => {
  it("names the Table and says nothing of a QR code on a wall", () => {
    for (const small of [true, false]) {
      const plan = doorPlan({ small, starting: true, as: "player", room: "turn-based" });
      expect(plan.title).toBe("Start a party at the Table");
      expect(plan.sub).not.toMatch(/QR|wall/);
      expect(plan.sub).toBe("You get a room and a code. Friends join with the code on their phones.");
    }
  });

  it("leaves the party room's own way in as it was", () => {
    for (const room of [undefined, null, "party-games"]) {
      const plan = doorPlan({ small: false, starting: true, as: "player", room });
      expect([plan.title, plan.sub]).toEqual(["Start a party", "You get a room and a code. Friends join with the code or the QR code on the wall."]);
      expect(doorPlan({ small: false, starting: false, as: "player", room }).sub).toBe("It is on the sign by the door in the room.");
    }
  });
});
