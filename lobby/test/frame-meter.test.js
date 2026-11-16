// The frame meter (lobby/public/frame-meter.js): its arithmetic, its three seconds, and the
// switch that is kept on the device. The numbers it shows set the room's frame-time budget, so
// they must be the page's real frames, never the 3D look's skipped ones.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FrameMeter, GAP_MS, SHOW_MS, WINDOW_MS, Window, meterLine, meterWanted } from "../public/frame-meter.js";

/** A device's storage, as localStorage behaves. */
function storage() {
  const kept = new Map();
  return { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k), kept };
}
const q = (s) => new URLSearchParams(s);

describe("the meter's switch", () => {
  it("is off unless asked for", () => {
    expect(meterWanted(q(""), storage())).toBe(false);
  });

  it("is remembered with ?meter=1, so the room's own address (no query) keeps it", () => {
    const device = storage();
    expect(meterWanted(q("meter=1"), device)).toBe(true);
    expect(meterWanted(q(""), device)).toBe(true);
    expect(meterWanted(q("join=1234"), device)).toBe(true);
  });

  it("is switched off and forgotten with ?meter=0", () => {
    const device = storage();
    meterWanted(q("meter=1"), device);
    expect(meterWanted(q("meter=0"), device)).toBe(false);
    expect(device.kept.size).toBe(0);
    expect(meterWanted(q(""), device)).toBe(false);
  });

  it("leaves other values alone, and still works where storage throws (private browsing)", () => {
    const device = storage();
    meterWanted(q("meter=1"), device);
    expect(meterWanted(q("meter=yes"), device)).toBe(true);
    const locked = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
    expect(meterWanted(q("meter=1"), locked)).toBe(true);
    expect(meterWanted(q(""), locked)).toBe(false);
    expect(meterWanted(q("meter=1"), null)).toBe(true);
  });
});

describe("the window of samples", () => {
  it("averages and finds the worst", () => {
    const w = new Window();
    for (const [t, v] of [[100, 16], [116, 17], [150, 34], [166, 13]]) w.add(t, v);
    expect(w.count).toBe(4);
    expect(w.average).toBe(20);
    expect(w.worst).toBe(34);
  });

  it("is empty with nothing in it, not a division by nothing", () => {
    const w = new Window();
    expect(w.average).toBe(0);
    expect(w.worst).toBe(0);
  });

  it("keeps only the last three seconds", () => {
    expect(WINDOW_MS).toBe(3000);
    const w = new Window();
    w.add(0, 200); // a hitch at the start
    for (let t = 16; t <= 3000; t += 16) w.add(t, 16);
    // At three seconds the hitch is exactly three seconds old: it has gone.
    w.add(3000, 16);
    expect(w.worst).toBe(16);
    expect(w.at[0]).toBeGreaterThan(0);
    // Letting time pass with no frames lets everything go.
    w.trim(3000 + WINDOW_MS);
    expect(w.count).toBe(0);
  });
});

describe("the line", () => {
  const frames = (values, step = 16) => {
    const w = new Window();
    values.forEach((v, i) => w.add(i * step, v));
    return w;
  };

  it("reads like the Star Lounge preview's meter, with the look and room first", () => {
    // Ten frames of 20 ms and 30 ms in turn (40 a second), four of which drew a picture: 16 pictures a second.
    const drawing = new Window();
    for (let i = 0; i < 4; i++) drawing.add(i * 100, 4.25);
    const line = meterLine({ look: "3d", room: "star-lounge", frames: frames([20, 30, 20, 30, 20, 30, 20, 30, 20, 30]), drawing, sharpness: 1.6, now: 400 });
    expect(line).toBe("3d star-lounge · frame 25.0 ms (40 a second) · worst 30 ms · drawing 4.3 ms (16 a second) · 1.6x");
  });

  it("shows only what applies to the flat room", () => {
    expect(meterLine({ look: "flat", frames: frames([10, 10]), drawing: null, sharpness: null, now: 20 })).toBe("flat · frame 10.0 ms (100 a second) · worst 10 ms");
  });

  it("says so when nothing has been measured yet", () => {
    expect(meterLine({ look: "3d", room: "bar", frames: new Window(), drawing: new Window(), sharpness: 2, now: 0 })).toBe("3d bar · frame - · drawing - · 2x");
  });
});

describe("the meter on the page", () => {
  let made;
  beforeEach(() => {
    made = [];
    globalThis.document = {
      createElement: () => {
        const el = { textContent: "", className: "", setAttribute() {}, remove() {} };
        made.push(el);
        return el;
      },
    };
  });
  afterEach(() => delete globalThis.document);

  /** A 3D room that draws only every third frame (a still room) at 2 ms a picture. */
  function stillRoom() {
    const drawn = { frames: 0, cpu: 0 };
    return {
      look: "3d",
      drawn,
      tick(i) {
        if (i % 3 === 0) {
          drawn.frames++;
          drawn.cpu += 2;
        }
      },
      get drawing() {
        return { skin: "bar", frames: drawn.frames, cpu: drawn.cpu, sharpness: 1.5 };
      },
    };
  }

  it("times the page's frames, not the room's pictures, and the drawing per picture drawn", () => {
    const meter = new FrameMeter({ append() {} });
    const room = stillRoom();
    meter.start(room);
    // 50 frames a second for three and a half seconds; the room draws one in three.
    for (let i = 0; i <= 175; i++) {
      room.tick(i);
      meter.frame(i * 20);
    }
    expect(meter.frames.average).toBeCloseTo(20);
    expect(meter.drawing.average).toBeCloseTo(2);
    expect(made[0].textContent).toMatch(/^3d bar · frame 20\.0 ms \(50 a second\) · worst 20 ms · drawing 2\.0 ms \(1[67] a second\) · 1\.5x$/);
  });

  it("names a rendered room's rung, so a reading off a phone is never ambiguous", () => {
    const meter = new FrameMeter({ append() {} });
    const room = stillRoom();
    // A rendered room (look3d/rendered/room-rendered.js) is the 3D look to the page; it names its own look and rung.
    const rendered = {
      look: "3d",
      rendered: true,
      lookName: "real",
      rung: "star-lounge lite 1",
      tick: room.tick,
      get drawing() {
        return { ...room.drawing, skin: this.rung };
      },
    };
    meter.start(rendered);
    for (let i = 0; i <= 30; i++) {
      rendered.tick(i);
      meter.frame(i * 20);
    }
    expect(made[0].textContent).toMatch(/^real star-lounge lite 1 · frame /);
    // Fallen back to the 3D look's own drawing of the room.
    Object.assign(rendered, { lookName: "3d", rung: "star-lounge" });
    meter.frame(31 * 20 + SHOW_MS);
    expect(made[0].textContent).toMatch(/^3d star-lounge · frame /);
  });

  it("writes the line twice a second, not every frame", () => {
    expect(SHOW_MS).toBe(500);
    const meter = new FrameMeter({ append() {} });
    meter.start({ look: "flat" });
    const writes = [];
    let last = "";
    for (let t = 0; t <= 2000; t += 10) {
      meter.frame(t);
      if (made[0].textContent !== last) writes.push(t);
      last = made[0].textContent;
    }
    expect(writes.every((t, i) => i === 0 || t - writes[i - 1] >= SHOW_MS)).toBe(true);
  });

  it("does not count a page that drew nothing (hidden, or a room being swapped) as one slow frame", () => {
    const meter = new FrameMeter({ append() {} });
    meter.start({ look: "flat" });
    meter.frame(0);
    meter.frame(16);
    meter.frame(16 + GAP_MS + 500);
    meter.frame(32 + GAP_MS + 500);
    expect(meter.frames.worst).toBe(16);
    // A long frame that is still a frame is counted: that is a real hitch.
    meter.frame(32 + GAP_MS + 500 + 400);
    expect(meter.frames.worst).toBe(400);
  });

  it("starts afresh for each room view, and takes its line away when stopped", () => {
    const meter = new FrameMeter({ append() {} });
    meter.start({ look: "flat" });
    for (let t = 0; t < 200; t += 50) meter.frame(t);
    meter.start(stillRoom());
    expect(meter.frames.count).toBe(0);
    meter.stop();
    meter.frame(1000);
    expect(meter.el).toBe(null);
  });
});
