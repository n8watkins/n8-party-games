// A mounted game view hears the room view as it changes only if it asks to (tellRoom, lobby/shared/stage.js).
import { describe, expect, it, vi } from "vitest";
import { tellRoom } from "../shared/stage.js";

const room = (screens) => ({ phase: "playing", screens, game: { id: "tin-derby", round: 1 } });

describe("a game view and the room's updates", () => {
  it("a view without the hook is not touched", () => {
    const view = { events: vi.fn(), snapshot: vi.fn(), unmount: vi.fn() };
    expect(tellRoom(view, room(1))).toBe(false);
    expect(view.events).not.toHaveBeenCalled();
    expect(tellRoom(null, room(1))).toBe(false);
    expect(tellRoom({ room: "not a function" }, room(1))).toBe(false);
  });

  it("a view with it hears the big screen leave and come back", () => {
    const heard = [];
    const view = { room: (r) => heard.push(r.screens) };
    for (const n of [1, 0, 1]) expect(tellRoom(view, room(n))).toBe(true);
    expect(heard).toEqual([1, 0, 1]);
  });

  it("a view whose hook throws does not stop the room's page", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => tellRoom({ room() { throw new Error("broken game"); } }, room(0))).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("broken game"));
    warn.mockRestore();
  });
});
