// Stills are best-effort (stills.mjs): one that fails, takes too long or outlives its page is
// skipped with a line saying so, never a failure of the run.
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STILL_TIMEOUT_MS, still } from "./stills.mjs";

/** A stand-in page: its screenshot answers after `ms` with `result`, or fails with `error`. */
function page({ ms = 0, result = Buffer.from("png"), error = null } = {}) {
  const p = new EventEmitter();
  const frame = {};
  p.mainFrame = () => frame;
  p.frame = frame;
  p.asked = null;
  p.screenshot = (opts) => {
    p.asked = opts;
    return new Promise((done, fail) => setTimeout(() => (error ? fail(error) : done(result)), ms));
  };
  return p;
}

describe("a still", () => {
  afterEach(() => vi.useRealTimers());

  it("is taken with a short timeout, never a long one", async () => {
    const p = page();
    expect(await still(p, { path: "/tmp/x/a.png", timeout: 120000 })).toEqual(Buffer.from("png"));
    expect(p.asked).toMatchObject({ path: "/tmp/x/a.png", timeout: STILL_TIMEOUT_MS });
  });

  it("that fails is skipped and said so, not thrown", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await still(page({ error: new Error("Timeout 10000ms exceeded.\nmore") }), { path: "/tmp/x/b.png" })).toBeNull();
    expect(log).toHaveBeenCalledWith("     (still skipped: b.png: Timeout 10000ms exceeded.)");
    log.mockRestore();
  });

  it("of a page on its way elsewhere is dropped the moment it navigates", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const p = page({ ms: 5000 });
    const taking = still(p, { path: "/tmp/x/c.png", leaving: true });
    p.emit("framenavigated", p.frame);
    expect(await taking).toBeNull();
    expect(log).toHaveBeenCalledWith("     (still skipped: c.png: the page moved on while it was taken)");
    // The screenshot still on its way, ending later, says nothing more.
    await vi.advanceTimersByTimeAsync(6000);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
