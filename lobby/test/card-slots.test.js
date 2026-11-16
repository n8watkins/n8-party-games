// The graphics card's test slots (lobby/test/browser.mjs, holdCard): each process holds one slot
// until it exits, waiters say how many are ahead of them, and they go first come first served.
// Real processes and real flocks, in a folder of their own (TEST_GPU_LOCK_DIR), so the
// machine's own slots in /tmp are never touched. No graphics card is needed.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const helper = fileURLToPath(new URL("./browser.mjs", import.meta.url));
// Holds a slot until its stdin closes, printing "held" once it has one.
const holder = `const { holdCard } = await import(${JSON.stringify(helper)}); await holdCard(); console.log("held"); process.stdin.resume(); process.stdin.on("end", () => process.exit(0));`;

let dir;
const procs = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "card-slots-"));
});
afterEach(async () => {
  for (const p of procs.splice(0)) if (p.exitCode === null) p.kill();
  await new Promise((r) => setTimeout(r, 100));
  rmSync(dir, { recursive: true, force: true });
});

function job(env = {}) {
  const p = spawn(process.execPath, ["--input-type=module", "-e", holder], {
    env: { ...process.env, TEST_GPU_LOCK_DIR: dir, TEST_GPU_JOBS: "", TEST_GPU_SLOT_HELD: "", ...env },
    stdio: ["pipe", "pipe", "inherit"],
  });
  procs.push(p);
  p.out = "";
  p.stdout.on("data", (d) => (p.out += d));
  p.until = (re, ms = 30000) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no ${re} within ${ms} ms; said: ${p.out}`)), ms);
      const look = () => (re.test(p.out) ? (clearTimeout(t), resolve()) : setTimeout(look, 25));
      look();
    });
  p.release = () => new Promise((r) => (p.once("exit", r), p.stdin.end()));
  return p;
}
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));

// Each job is a fresh Node process that loads Playwright, which takes seconds on a loaded PC
// (the pre-deploy gate runs these tests while other agents build and test), so the limits are
// generous; a test that passes takes about as long as it did before.
describe("card slots", { timeout: 60000 }, () => {
  it("lets the default number of jobs draw at once, and makes the next one wait", async () => {
    const { DEFAULT_CARD_SLOTS } = await import("./browser.mjs");
    expect(DEFAULT_CARD_SLOTS).toBeGreaterThanOrEqual(1);
    const first = Array.from({ length: DEFAULT_CARD_SLOTS }, () => job());
    await Promise.all(first.map((p) => p.until(/held/)));
    // Jobs that start together while slots are free take them at once, without lining up.
    for (const p of first) expect(p.out).not.toMatch(/waiting/);
    expect(readdirSync(dir).filter((f) => /^test-gpu-\d+\.lock$/.test(f)).length).toBe(DEFAULT_CARD_SLOTS);
    const next = job();
    await next.until(/waiting for a card slot, 0 ahead/);
    expect(next.out).not.toMatch(/held/);
    await first[0].release();
    await next.until(/held/);
  });

  it("serves waiters first come first served, saying how many are ahead", async () => {
    const env = { TEST_GPU_JOBS: "1" };
    const a = job(env);
    await a.until(/held/);
    const b = job(env);
    await b.until(/0 ahead/);
    const c = job(env);
    await c.until(/1 ahead/);
    await a.release();
    await b.until(/held/);
    await c.until(/waiting for a card slot, 0 ahead\)/); // moved up, still waiting
    expect(c.out).not.toMatch(/held/);
    await b.release();
    await c.until(/held/);
    await c.release();
    expect(readdirSync(join(dir, "test-gpu-queue"))).toEqual([]);
  });

  it("does not count a waiter that was killed outright", async () => {
    const env = { TEST_GPU_JOBS: "1" };
    const a = job(env);
    await a.until(/held/);
    const gone = job(env);
    await gone.until(/0 ahead/);
    const c = job(env);
    await c.until(/1 ahead/);
    gone.kill("SIGKILL");
    await c.until(/waiting for a card slot, 0 ahead\)/);
    await a.release();
    await c.until(/held/);
  });

  it("does not count a queue entry that nobody holds, even when its process id is in use", async () => {
    // A waiter killed outright leaves its file; after a restart (/tmp persists on WSL) or a
    // process id reused, that id can belong to a live, unrelated process. This one is that.
    const unrelated = spawn("sleep", ["30"]);
    procs.push(unrelated);
    const queue = join(dir, "test-gpu-queue");
    mkdirSync(queue);
    const stale = `${String(Date.now() - 60000).padStart(15, "0")}-${unrelated.pid}`;
    writeFileSync(join(queue, stale), "");
    // With every slot free, a job takes one at once instead of queueing behind the stale entry.
    const free = job({ TEST_GPU_JOBS: "1" });
    await free.until(/held/);
    expect(free.out).not.toMatch(/waiting/);
    // With the slot taken, the next waiter is first in line, and gets the slot when it frees.
    writeFileSync(join(queue, stale), "");
    const next = job({ TEST_GPU_JOBS: "1" });
    await next.until(/waiting for a card slot, 0 ahead/);
    await free.release();
    await next.until(/held/);
    expect(readdirSync(queue)).not.toContain(stale);
  });

  it("under gpu-run (TEST_GPU_SLOT_HELD=1) takes its own slot without queueing", async () => {
    const a = job({ TEST_GPU_JOBS: "1" });
    await a.until(/held/);
    const waiting = job({ TEST_GPU_JOBS: "1" });
    await waiting.until(/0 ahead/);
    const child = job({ TEST_GPU_JOBS: "2", TEST_GPU_SLOT_HELD: "1" });
    await child.until(/held/);
    await settle();
    expect(waiting.out).not.toMatch(/held/);
  });
});
