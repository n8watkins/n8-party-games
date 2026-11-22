// The room views' one interface (public/view-api.js): every view answers to all of it, the
// stand-in the page uses while the next view loads answers to all of it and hands on what it
// heard, and the page calls nothing on a view outside it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HEARD, OWN, VIEW_METHODS, standIn } from "../public/view-api.js";

const { FlatRoomView } = await import("../public/room-view.js");
const { Room3D } = await import("../public/look3d/room3d.js");

describe("the room views' interface", () => {
  it("is answered to in full by the flat view, the 3D view and the stand-in", () => {
    for (const [name, view] of [
      ["flat", FlatRoomView.prototype],
      ["3D", Room3D.prototype],
      ["stand-in", standIn(500)],
    ]) {
      const missing = VIEW_METHODS.filter((m) => typeof view[m] !== "function");
      expect(missing, name).toEqual([]);
    }
  });

  it("is all the page calls on a view", () => {
    const main = readFileSync(new URL("../public/main.js", import.meta.url), "utf8");
    // Properties the page reads (not calls) and the stand-in's own hand-over.
    const read = new Set(["look", "pieces", "wall", "paused", "replay"]);
    const called = new Set([...main.matchAll(/\bscene\??\.([A-Za-z]+)\(/g)].map((m) => m[1]));
    expect([...called].filter((m) => !VIEW_METHODS.includes(m) && !read.has(m))).toEqual([]);
  });

  it("keeps what the stand-in heard and tells the next view, after the whole room it was built from", () => {
    const held = standIn(640);
    expect(held.ownX()).toBe(640);
    held.onHook({ t: "hook", s: 1 }, 1000);
    held.onStilts({ t: "stilts", s: 2 }, 1200);
    held.ownSlime("harden", 1300);
    held.frame(1400, 0.016, null, {});
    const told = [];
    const next = Object.fromEntries([...HEARD, ...OWN].map((m) => [m, (...args) => told.push([m, args])]));
    held.replay(next, 1100);
    expect(told).toEqual([
      ["onStilts", [{ t: "stilts", s: 2 }, 1200]],
      ["ownSlime", ["harden", 1300]],
    ]);
  });
});
