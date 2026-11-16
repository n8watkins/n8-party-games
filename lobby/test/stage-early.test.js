// A phone that joins (or reloads) in the middle of a turn-based match. Seen in a browser with
// Who Am I?: the room sends the hello and then the game as the phone may see it while the page
// is still drawing the room, the page dropped that snapshot, and the phone showed no game until
// the next turn changed something (it can be minutes in a game with no tick).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EarlySnapshot } from "../shared/stage.js";

const playing = { phase: "playing", game: { id: "who-am-i", round: 1, turns: true, seats: [0, 1], audience: true, late: [2] } };

describe("a game's snapshot that comes before the room is drawn", () => {
  it("is kept, and handed over once when the room is up and the match is still on", () => {
    const early = new EarlySnapshot();
    expect(early.take(playing)).toBe(null);
    early.hold({ version: 4 });
    early.hold({ version: 5 });
    expect(early.take(playing)).toEqual({ version: 5 });
    expect(early.take(playing)).toBe(null);
  });

  it("is dropped when the match ended meanwhile, or the page is put away", () => {
    const early = new EarlySnapshot();
    early.hold({ version: 5 });
    expect(early.take({ phase: "lobby", game: null })).toBe(null);
    early.hold({ version: 6 });
    expect(early.take(null)).toBe(null);
    expect(early.take(playing)).toBe(null);
  });

  it("is wired into the page: held when there is no stage box yet, started at the end of drawing the room, and cleared on teardown", () => {
    const main = readFileSync(new URL("../public/main.js", import.meta.url), "utf8");
    expect(main).toMatch(/if \(!stageBox\) return void early\.hold\(snapshot\);/);
    expect(main).toMatch(/const first = early\.take\(room\);\n\s*if \(first\) startStage\(first\);/);
    expect(main).toMatch(/early\.take\(null\);/);
  });
});
