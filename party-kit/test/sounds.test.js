// The player for the room's sounds on one device, without a browser: what it keeps, and that it
// never plays (or queues) anything before sound is allowed. Playing real recordings is checked
// in a real, muted browser by lobby/test/e2e-emotes.mjs.
import { describe, expect, it } from "vitest";
import { PREFS_KEY, SoundBoard, defineSound, hasSound } from "../client/sounds.js";

function memory() {
  const kept = new Map();
  return { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, String(v)), kept };
}

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

  it("knows a sound only once it is defined", () => {
    expect(hasSound("test-ding")).toBe(false);
    defineSound("test-ding", "data:audio/mpeg;base64,");
    expect(hasSound("test-ding")).toBe(true);
  });

  it("says why it played nothing, and queues nothing while sound is not allowed", async () => {
    defineSound("test-clap", "data:audio/mpeg;base64,");
    const board = new SoundBoard({ storage: null, room: "1234" });
    expect(await board.play("test-clap")).toBe("locked");
    expect(await board.play("nope")).toBe("unknown");
    board.mutePlayer("Tom", true);
    expect(await board.play("test-clap", { from: "Tom" })).toBe("muted");
    board.setMuted(true);
    expect(await board.play("test-clap")).toBe("muted");
    expect(board.voices).toEqual([]);
    expect(board.log.map((l) => l.what)).toEqual(["locked", "unknown", "muted", "muted"]);
  });

  it("keeps the ambience volume apart, and an ambience at nothing plays nothing", async () => {
    defineSound("test-owl", "data:audio/mpeg;base64,");
    const storage = memory();
    const board = new SoundBoard({ storage });
    expect(board.ambience).toBe(0.6);
    board.setAmbience(0);
    expect(new SoundBoard({ storage }).ambience).toBe(0);
    expect(await board.play("test-owl", { bus: "ambient" })).toBe("muted");
    expect(await board.play("test-owl")).toBe("locked");
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
