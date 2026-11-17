// The graphics card's tokens (lobby/test/browser.mjs, holdCard and holdTokens): each process holds
// its tokens until it exits, waiters say how many are ahead of them, and they go first come first
// served; under a job that holds tokens (TEST_GPU_TOKENS), processes draw only on those.
// Real processes and real flocks, in a folder of their own (TEST_GPU_LOCK_DIR), so the
// machine's own tokens in /tmp are never touched. No graphics card is needed.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const helper = fileURLToPath(new URL("./browser.mjs", import.meta.url));
// Holds the card (or WANT tokens) until its stdin closes, printing "held <token paths>" once it
// has them.
const holder = `const m = await import(${JSON.stringify(helper)}); const t = process.env.WANT ? await m.holdTokens(Number(process.env.WANT)) : await m.holdCard(); console.log("held " + t.join(":")); process.stdin.resume(); process.stdin.on("end", () => process.exit(0));`;

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
    env: { ...process.env, TEST_GPU_LOCK_DIR: dir, TEST_GPU_JOBS: "", TEST_GPU_SLOT_HELD: "", TEST_GPU_TOKENS: "", WANT: "", ...env },
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
  p.tokens = () => /held (\S+)/.exec(p.out)?.[1];
  p.release = () => new Promise((r) => (p.once("exit", r), p.stdin.end()));
  return p;
}
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const token = (n) => join(dir, `test-gpu-${n}.lock`);

// Each job is a fresh Node process that loads Playwright, which takes seconds on a loaded PC
// (the pre-deploy gate runs these tests while other agents build and test), so the limits are
// generous; a test that passes takes about as long as it did before.
describe("card tokens", { timeout: 60000 }, () => {
  it("lets the default number of browsers draw at once, and makes the next one wait", async () => {
    const { DEFAULT_CARD_SLOTS } = await import("./browser.mjs");
    expect(DEFAULT_CARD_SLOTS).toBe(3);
    const first = Array.from({ length: DEFAULT_CARD_SLOTS }, () => job());
    await Promise.all(first.map((p) => p.until(/held/)));
    // Jobs that start together while tokens are free take them at once, without lining up.
    for (const p of first) expect(p.out).not.toMatch(/waiting/);
    expect(first.map((p) => p.tokens()).sort()).toEqual([1, 2, 3].map(token));
    const next = job();
    await next.until(/waiting for a card token, 0 ahead: all the card's 3 tokens are in use; TEST_GPU_JOBS changes the number/);
    expect(next.out).not.toMatch(/held/);
    await first[0].release();
    await next.until(/held/);
  });

  it("serves waiters first come first served, saying how many are ahead", async () => {
    const env = { TEST_GPU_JOBS: "1" };
    const a = job(env);
    await a.until(/held/);
    const b = job(env);
    await b.until(/0 ahead: the card's one token is in use/);
    const c = job(env);
    await c.until(/1 ahead/);
    await a.release();
    await b.until(/held/);
    await c.until(/waiting for a card token, 0 ahead\)/); // moved up, still waiting
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
    await c.until(/waiting for a card token, 0 ahead\)/);
    await a.release();
    await c.until(/held/);
  });

  it("frees the tokens of a holder that was killed outright", async () => {
    const env = { TEST_GPU_JOBS: "2" };
    const a = job({ ...env, WANT: "2" });
    await a.until(/held/);
    const b = job(env);
    await b.until(/0 ahead/);
    a.kill("SIGKILL");
    await b.until(/held/);
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
    // With every token free, a job takes one at once instead of queueing behind the stale entry.
    const free = job({ TEST_GPU_JOBS: "1" });
    await free.until(/held/);
    expect(free.out).not.toMatch(/waiting/);
    // With the token taken, the next waiter is first in line, and gets the token when it frees.
    writeFileSync(join(queue, stale), "");
    const next = job({ TEST_GPU_JOBS: "1" });
    await next.until(/waiting for a card token, 0 ahead/);
    await free.release();
    await next.until(/held/);
    expect(readdirSync(queue)).not.toContain(stale);
  });

  it("takes several tokens all at once, and is not overtaken by single ones that come after it", async () => {
    const env = { TEST_GPU_JOBS: "3" };
    const a = job(env);
    await a.until(/held/);
    const big = job({ ...env, WANT: "3" });
    await big.until(/waiting for a card token, 0 ahead: it needs 3 of the card's 3 tokens/);
    // Two tokens are free, and the big job sits on neither while it waits.
    const b = job(env);
    await b.until(/waiting for a card token, 1 ahead/);
    await settle();
    expect(b.out).not.toMatch(/held/);
    await a.release();
    await big.until(/held/);
    expect(big.tokens().split(":").sort()).toEqual([1, 2, 3].map(token));
    await settle();
    expect(b.out).not.toMatch(/held/);
    await big.release();
    await b.until(/held/);
  });

  it("asks for no more tokens than the pool has", async () => {
    const p = job({ TEST_GPU_JOBS: "2", WANT: "5" });
    await p.until(/held/);
    expect(p.tokens().split(":")).toHaveLength(2);
  });

  it("under a job that holds tokens, draws only on those, never more of them at once", async () => {
    const parent = job({ TEST_GPU_JOBS: "3", WANT: "2" });
    await parent.until(/held/);
    const tokens = parent.tokens();
    expect(tokens.split(":")).toEqual([token(1), token(2)]);
    // The variables a gpu-run with the token pool also sets for older helpers are ignored.
    const env = { TEST_GPU_TOKENS: tokens, TEST_GPU_JOBS: "4", TEST_GPU_SLOT_HELD: "1" };
    const kids = [job(env), job(env)];
    await Promise.all(kids.map((k) => k.until(/held/)));
    expect(kids.map((k) => k.tokens()).sort()).toEqual([token(1) + ".use", token(2) + ".use"]);
    const third = job(env);
    await third.until(/waiting for a card token, 0 ahead: all the 2 tokens this job holds are in use\)/);
    // The card's third token is still free for anyone else: the job's processes took none.
    const outside = job({ TEST_GPU_JOBS: "3" });
    await outside.until(/held/);
    expect(outside.tokens()).toBe(token(3));
    expect(existsSync(token(3) + ".use")).toBe(false);
    await kids[0].release();
    await third.until(/held/);
  });

  it("lets two one-token jobs each draw at once (the old shared extra slot did not)", async () => {
    // Two jobs as gpu-run holds them, one token each; each job's test script under it.
    const env = { TEST_GPU_JOBS: "2" };
    const parents = [job(env), job(env)];
    await Promise.all(parents.map((p) => p.until(/held/)));
    const kids = parents.map((p) => job({ TEST_GPU_TOKENS: p.tokens(), TEST_GPU_JOBS: "3", TEST_GPU_SLOT_HELD: "1" }));
    await Promise.all(kids.map((k) => k.until(/held/)));
    for (const k of kids) expect(k.out).not.toMatch(/waiting/);
  });

  it("under a gpu-run from before the token pool (TEST_GPU_SLOT_HELD=1) takes its own slot without queueing", async () => {
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
