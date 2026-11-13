// The soundboard's player on one device, without a browser: what it keeps, and that it never
// plays (or queues) anything before sound is allowed. The sounds themselves are rendered and
// checked in a real, muted browser by lobby/test/e2e-emotes.mjs.
import { describe, expect, it } from "vitest";
import { PREFS_KEY, SoundBoard, recipeOf, seeded, soundNames } from "../client/sounds.js";
import { SOUNDS } from "../client/emotes.js";

function memory() {
  const kept = new Map();
  return { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, String(v)), kept };
}

describe("the sound recipes", () => {
  it("has a recipe for every sound on the board, each under three seconds", () => {
    for (const { id } of SOUNDS) expect(soundNames()).toContain(id);
    for (const name of soundNames()) {
      expect(typeof recipeOf(name).build, name).toBe("function");
      expect(recipeOf(name).length, name).toBeLessThanOrEqual(3.2);
    }
  });

  it("makes the same noise every time", () => {
    const a = seeded(9);
    const b = seeded(9);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });
});

describe("one device's player", () => {
  it("starts at a sensible volume, unmuted", () => {
    const board = new SoundBoard({ storage: memory() });
    expect(board.volume).toBe(0.7);
    expect(board.muted).toBe(false);
  });

  it("keeps the volume and mute on the device", () => {
    const storage = memory();
    const board = new SoundBoard({ storage });
    board.setVolume(0.3);
    board.setMuted(true);
    const again = new SoundBoard({ storage });
    expect(again.volume).toBe(0.3);
    expect(again.muted).toBe(true);
    expect(JSON.parse(storage.kept.get(PREFS_KEY)).volume).toBe(0.3);
  });

  it("keeps muted players for this party only", () => {
    const storage = memory();
    const board = new SoundBoard({ storage, room: "1234" });
    board.mutePlayer("Tom", true);
    expect(board.isPlayerMuted("tom")).toBe(true);
    expect(new SoundBoard({ storage, room: "1234" }).isPlayerMuted("Tom")).toBe(true);
    expect(new SoundBoard({ storage, room: "9999" }).isPlayerMuted("Tom")).toBe(false);
    board.mutePlayer("Tom", false);
    expect(board.isPlayerMuted("Tom")).toBe(false);
  });

  it("says why it played nothing, and queues nothing while sound is not allowed", async () => {
    const board = new SoundBoard({ storage: null, room: "1234" });
    expect(await board.play("horn")).toBe("locked");
    expect(await board.play("nope")).toBe("unknown");
    board.mutePlayer("Tom", true);
    expect(await board.play("horn", { from: "Tom" })).toBe("muted");
    board.setMuted(true);
    expect(await board.play("horn")).toBe("muted");
    expect(board.voices).toEqual([]);
    expect(board.log.map((l) => l.what)).toEqual(["locked", "unknown", "muted", "muted"]);
  });

  it("does not break where storage is refused", () => {
    const refusing = {
      getItem() {
        throw new Error("no");
      },
      setItem() {
        throw new Error("no");
      },
    };
    const board = new SoundBoard({ storage: refusing });
    expect(() => board.setVolume(0.5)).not.toThrow();
    expect(board.volume).toBe(0.5);
  });
});
