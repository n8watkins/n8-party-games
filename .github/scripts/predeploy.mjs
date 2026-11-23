// The full gate that runs once before a deploy, on the combined result: unit tests, then the
// end-to-end scripts that need a local Worker (the room, the party room, Cork & Bell, Hot Potato,
// Hot Potato's hearing test, the switch between the Floor and the Table, both rooms side by side,
// a game at the Table, and the rest in predeploy-steps.mjs). One step, test:release, runs and
// restarts a Worker of its own (its deploys): the gate gives it a free port and nothing else.
//
//   npm run gate                      (locally, from the owner's PC, on any tree)
//   .github/workflows/predeploy-gate.yml   (the same script, on a GitHub-hosted runner)
//
// The npm script `predeploy` runs it with --deploy on purpose: npm runs `pre<name>` before
// `npm run <name>`, so `npm run deploy` runs this gate first by itself and stops if it fails, and
// with --deploy it first refuses a tree a deploy may not ship (below). `npm run gate` runs the
// gate alone without deploying. In an emergency, and only on the owner's word,
// `npx wrangler deploy --env=''` deploys without the gate (its build still refuses such a tree).
//
// Needs `npm ci` first, and Playwright's Chromium for the browser steps
// (`npx playwright install chromium`). The Windows-Chrome playtest (`npm run playtest:battle`)
// and the production-settings check in DEPLOY.md stay manual: they need the owner's PC and a
// second server.
//
// Two ways to run the end-to-end steps:
//
// - One after another (the default, and always on GitHub's runners): one local Worker on
//   PREDEPLOY_PORT (default 8853), the steps in turn, stopping at the first failure. Its
//   browser draws in software, which loads the CPU, so nothing else runs beside it.
// - Side by side, with TEST_GPU=1 (the browser draws on the graphics card, see
//   lobby/test/browser.mjs, and takes little CPU): every step gets a local Worker of its own, on
//   its own port (PREDEPLOY_PORT, then +2, +3 and on, one per step; a free one if that is taken) with its own empty
//   storage folder, because test:cork reads the server-wide room budget and must be alone on
//   its server, and test:room writes to a score board. The unit tests run first, alone; then
//   the Workers start one at a time (each start-up rebuilds dist/public, which they all serve),
//   then the steps run together. Each step's output is kept and printed whole when the step
//   ends; the first failure stops the others. PREDEPLOY_SEQUENTIAL=1 keeps the steps one after
//   another on the card too.
//   The gate holds CARD_TOKENS of the card's tokens (one per browser drawing at once, see
//   holdTokens in lobby/test/browser.mjs) and passes them to the steps in TEST_GPU_TOKENS, so
//   never more than that many of its card browsers draw at once; the others wait their turn with
//   their Workers up. Steps without a card browser (test:room, test:lobby, test:mode, and those
//   whose browser draws in software) take no token and run beside them. Under gpu-run
//   (`gpu-run --label gate --kind browser-test --tokens 3 --admit-timeout-runs -- npm run
//   gate`), the tokens come from the ones gpu-run holds for it instead of from the card's
//   pool, and gpu-run's admission check (card load, video memory, heat, recent driver events)
//   runs first; --admit-timeout-runs makes a busy card delay the gate, never fail it.
//   Run bare (`npm run gate`, and `npm run deploy`, which runs it first), the gate has no
//   admission check: it takes its tokens and starts whatever the card's state.
//
// One gate at a time on this machine: a gate holds the flock on
// $TMPDIR/n8-party-games-predeploy.lock while it runs, and a second one waits for it and says
// so, instead of both choosing the same free port or the same 8853. A Worker counts as up only
// when its own wrangler has said "Ready on" its port, so a server something else started on that
// port (between the gate's check and wrangler's bind) makes the gate fail, never test the wrong
// server.
//
// The scripts get this process's environment unchanged, so TEST_GPU=1 and TEST_NO_GPU=1 reach
// them as they were set. GitHub's runners have no card and set neither.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STEPS, stepPort } from "./predeploy-steps.mjs";

// The deploy's own run of the gate (`npm run deploy` runs `predeploy`, which passes --deploy):
// before anything else, the tree must be what a deploy may ship (scripts/release.mjs,
// releaseProblem): one clean commit already on origin/main, and no RELEASE_ALLOW_DIRTY. Wrangler's
// build checks the same again, but only after the gate's minutes. `npm run gate` runs the gate
// alone, on any tree.
if (process.argv.includes("--deploy")) {
  const { execFileSync } = await import("node:child_process");
  console.log("Fetching origin/main (20 s at most) to check this commit is on it...");
  try {
    // Never waits for ever (a bad proxy hung it once) and never asks for a password.
    execFileSync("git", ["fetch", "--quiet", "origin", "main"], { stdio: ["ignore", "ignore", "pipe"], timeout: 20_000, killSignal: "SIGKILL", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  } catch (err) {
    console.log(`(could not fetch origin/main${err.signal ? " in 20 s" : ""}; checking against this clone's copy of it)`);
  }
  const { repoState } = await import("../../scripts/build-public.mjs");
  const { releaseProblem } = await import("../../scripts/release.mjs");
  const problem = releaseProblem(repoState(), { upload: true });
  if (problem) {
    console.error(`\nNot deploying: ${problem}\n\n(\`npm run gate\` runs the gate alone on any tree.)`);
    process.exit(1);
  }
}

const port = Number(process.env.PREDEPLOY_PORT ?? "8853");
// How many of the gate's card browsers may draw at once when the steps run side by side.
const CARD_TOKENS = 3;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const cardOff = process.env.TEST_NO_GPU === "1";
const onCard = process.env.TEST_GPU === "1" && !cardOff;
const sideBySide = onCard && process.env.PREDEPLOY_SEQUENTIAL !== "1";
const card = cardOff ? "off (TEST_NO_GPU=1)" : onCard ? "on (TEST_GPU=1)" : "off";
console.log(`Browser steps on the graphics card: ${card}`);
console.log(`End-to-end steps: ${sideBySide ? "side by side, each with its own local Worker" : "one after another" + (onCard ? " (PREDEPLOY_SEQUENTIAL=1)" : "")}`);


const gateStarted = Date.now();
const results = [];
const seconds = (from) => Math.round((Date.now() - from) / 1000);

function summary() {
  console.log("\n=== predeploy gate ===");
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) console.log(`${r.status.padEnd(7)} ${r.name.padEnd(width)}  ${String(r.seconds).padStart(4)} s`);
  console.log(`${"".padEnd(7)} ${"total".padEnd(width)}  ${String(seconds(gateStarted)).padStart(4)} s`);
  const failed = results.some((r) => r.status !== "ok");
  console.log(failed ? "\nGATE FAILED: do not deploy." : "\nGATE PASSED.");
  return failed ? 1 : 0;
}

/** Runs a command with its output on this terminal; resolves to its exit code. */
const run = (cmd, args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

/**
 * Holds the machine-wide gate lock for the life of this process, waiting (and saying so) while
 * another gate holds it. The lock is a kernel flock held by a small child (flock ... cat) that
 * reads this process's stdin pipe, so it is released however this process ends. Without flock
 * (not on Linux) the gate runs without it and says so.
 */
async function holdGateLock() {
  const file = join(tmpdir(), "n8-party-games-predeploy.lock");
  const take = (wait) =>
    new Promise((resolve) => {
      const args = [...(wait ? [] : ["-n"]), file, "sh", "-c", "echo held; exec cat >/dev/null"];
      const holder = spawn("flock", args, { stdio: ["pipe", "pipe", "ignore"] });
      holder.stdin.on("error", () => {});
      const gone = () => holder.exitCode === null && holder.signalCode === null && holder.kill();
      process.on("exit", gone); // a gate given up while waiting leaves no waiting flock behind
      holder.stdout.once("data", () => {
        process.off("exit", gone);
        holder.unref();
        holder.stdin.unref?.();
        holder.stdout.unref?.();
        resolve("held");
      });
      holder.once("exit", () => {
        process.off("exit", gone);
        resolve("taken");
      });
      holder.once("error", (e) => resolve(e.code === "ENOENT" ? "no flock" : "taken"));
    });
  let got = await take(false);
  if (got === "taken") {
    let who = "";
    try {
      who = readFileSync(file, "utf8").trim();
    } catch {}
    console.log(`Another pre-deploy gate is running on this machine${who ? ` (${who})` : ""}; waiting for it to finish (Ctrl-C gives up).`);
    const t = Date.now();
    got = await take(true);
    if (got === "held") console.log(`The other gate has finished; this one starts after waiting ${seconds(t)} s.`);
  }
  if (got === "no flock") return console.log("(no flock on this machine: nothing stops a second gate from running at the same time)");
  if (got !== "held") throw new Error("could not take the gate lock " + file);
  try {
    writeFileSync(file, `process ${process.pid} in ${process.cwd()}, since ${new Date().toISOString()}\n`);
  } catch {}
}

/** Whether anything of the process group `pgid` is still running. */
function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/**
 * Stops a whole process group: a SIGTERM first, then a SIGKILL for whatever is left after
 * `grace` ms. Resolves once nothing of the group is left (or two seconds after the SIGKILL).
 * The group is signalled even when its leader has exited, so a child it left behind (wrangler's
 * workerd, a test script's browser) is stopped too.
 */
async function stopGroup(pgid, grace = 5000) {
  const waitGone = async (ms) => {
    for (const until = Date.now() + ms; groupAlive(pgid) && Date.now() < until; ) await new Promise((r) => setTimeout(r, 100));
  };
  if (!groupAlive(pgid)) return;
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {}
  await waitGone(grace);
  if (groupAlive(pgid))
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {}
  await waitGone(2000);
}

/**
 * A local Worker on `port`, in its own process group so it can be stopped whole. With
 * `persist`, its Durable Objects live in that folder instead of the repo's .wrangler/state.
 * With `quiet`, its output is kept (the last lines) instead of printed. `env` is the wrangler
 * environment: "local", or "" for the production settings (as DEPLOY.md starts them by hand).
 */
function startWorker(port, { persist = null, quiet = false, env = "local" } = {}) {
  const args = ["wrangler", "dev", "--local", `--env=${env}`, "--port", String(port)];
  if (env === "") args.push("--local-upstream", `localhost:${port}`);
  if (persist) args.push("--persist-to", persist);
  const child = spawn("npx", args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    // A local server with the production settings builds with --production, which refuses a
    // dirty tree (scripts/release.mjs); the gate may run on one, and only the deploy after it
    // must come from a commit, so its own servers are let through.
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1", ...(env === "" && { RELEASE_ALLOW_DIRTY: "1" }) },
  });
  let log = "";
  // Wrangler's own word that it listens on this port: a server something else started there
  // also answers the config request, and must not pass for this one.
  // Colour codes are taken out first: with colour on (as on GitHub's runners) wrangler colours
  // the address, "Ready on \x1b[32mhttp://localhost:8853\x1b[39m".
  const readyLine = new RegExp(`Ready on https?://[^\\s]*:${port}\\b`);
  let said = false;
  const keep = (to) => (d) => {
    log = (log + d).slice(-20000);
    said ||= readyLine.test(log.replace(/\x1b\[[0-9;]*m/g, ""));
    if (!quiet) to.write(d);
  };
  child.stdout.on("data", keep(process.stdout));
  child.stderr.on("data", keep(process.stderr));
  let died = false;
  child.on("exit", () => (died = true));
  const base = `http://localhost:${port}`;
  return {
    base,
    log: () => log,
    async ready() {
      for (let i = 0; i < 180 && !died; i++) {
        if (said && (await fetch(base + "/api/party/config").then((r) => r.ok, () => false))) return !died;
        await new Promise((r) => setTimeout(r, 1000));
      }
      return false;
    },
    /** Stops the whole process group, workerd included, even once npx itself has exited. */
    stop: () => stopGroup(child.pid),
  };
}

/** `wanted` if nothing listens there, else a free port the system picks. */
async function freePort(wanted) {
  const tryPort = (p) =>
    new Promise((resolve) => {
      const s = createServer();
      s.once("error", () => resolve(null));
      s.listen({ port: p, host: "127.0.0.1" }, () => {
        const got = s.address().port;
        s.close(() => resolve(got));
      });
    });
  return (await tryPort(wanted)) ?? (await tryPort(0));
}

// What to stop and remove at the end, last first; also on Ctrl-C or SIGTERM, since the
// side-by-side steps and the Workers run in process groups of their own, which the terminal's
// Ctrl-C does not reach.
const cleanups = [];
const cleanUp = async () => {
  while (cleanups.length) await cleanups.pop()();
};
let ending = false;
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]])
  process.on(signal, async () => {
    if (ending) return;
    ending = true;
    await cleanUp();
    process.exit(code);
  });

/** One after another, against one local Worker: the gate as it always ran. */
async function oneAfterAnother() {
  const started = Date.now();
  const code = await run(npm, ["test"]);
  results.push({ name: "unit tests (npm test)", status: code === 0 ? "ok" : "FAIL", seconds: seconds(started) });
  if (code !== 0) return;
  const worker = startWorker(port);
  cleanups.push(() => worker.stop());
  if (!(await worker.ready())) {
    console.log("The local Worker did not come up on " + worker.base);
    results.push({ name: "start local Worker", status: "FAIL", seconds: 0 });
    return;
  }
  // Stop at the first failure: the later scripts only add noise once the room is broken.
  for (const [name, script, options] of STEPS) {
    console.log(`\n=== ${name} ===`);
    const t = Date.now();
    // A step that runs a Worker of its own (`own`) gets a free port and nothing else.
    if (options?.own) {
      const c = await run(npm, ["run", script, "--", `--port=${await freePort(port + 1)}`]);
      results.push({ name, status: c === 0 ? "ok" : "FAIL", seconds: seconds(t) });
      if (c !== 0) break;
      continue;
    }
    // A step that asks for an environment of its own gets a fresh Worker for it, with empty storage.
    const own = options?.env === undefined ? null : await ownWorker(await freePort(port + 1), options.env);
    const c = own?.ok === false ? 1 : await run(npm, ["run", script, "--", `--base=${(own ?? worker).base}`]);
    await own?.stop();
    results.push({ name, status: c === 0 ? "ok" : "FAIL", seconds: seconds(t) });
    if (c !== 0) break;
  }
}

/** A Worker of a step's own, in `env`, with an empty storage folder; stop() also removes the folder. */
async function ownWorker(p, env) {
  const persist = mkdtempSync(join(tmpdir(), `predeploy-${p}-`));
  const worker = startWorker(p, { persist, quiet: true, env });
  const stop = async () => {
    await worker.stop();
    rmSync(persist, { recursive: true, force: true });
  };
  cleanups.push(stop);
  const ok = await worker.ready();
  if (!ok) console.log(`The step's own Worker did not come up on ${worker.base}:\n${worker.log().split("\n").slice(-20).join("\n")}`);
  return { base: worker.base, ok, stop };
}

/** Side by side, each step against a local Worker of its own (TEST_GPU=1 only). */
async function sideBySideSteps() {
  // The unit tests first, alone: they are timed (card-slots.test.js) and must not share the CPU
  // with three Worker start-ups, and nothing a test does should ever meet a Worker's build.
  const started = Date.now();
  const code = await run(npm, ["test"]);
  results.push({ name: "unit tests (npm test)", status: code === 0 ? "ok" : "FAIL", seconds: seconds(started) });
  if (code !== 0) return;

  // Then the Workers, one at a time: each runs the site's build (scripts/build-public.mjs),
  // which empties dist/public and fills it again, so two starting at once could serve a
  // half-built folder.
  const workers = [];
  const begun = Date.now();
  for (let i = 0; i < STEPS.length; i++) {
    const p = await freePort(stepPort(port, i));
    // A step that runs a Worker of its own gets only its port (`--port`, below).
    if (STEPS[i][2]?.own) {
      workers.push({ own: true, port: p, base: `http://localhost:${p}`, log: () => "(the step's own Worker: its output is above)", stop: async () => {} });
      continue;
    }
    const persist = mkdtempSync(join(tmpdir(), `predeploy-${p}-`));
    const worker = startWorker(p, { persist, quiet: true, env: STEPS[i][2]?.env ?? "local" });
    cleanups.push(async () => {
      await worker.stop();
      rmSync(persist, { recursive: true, force: true });
    });
    workers.push(worker);
    if (!(await worker.ready())) {
      console.log(`The local Worker did not come up on ${worker.base}:\n${worker.log().split("\n").slice(-20).join("\n")}`);
      results.push({ name: "start local Workers", status: "FAIL", seconds: seconds(begun) });
      return;
    }
  }
  results.push({ name: "start local Workers", status: "ok", seconds: seconds(begun) });

  // The card tokens last, once everything else is ready, so they are never held idle.
  const waitedFrom = Date.now();
  const { holdTokens } = await import("../../lobby/test/browser.mjs");
  const tokens = await holdTokens(CARD_TOKENS);
  process.env.TEST_GPU_TOKENS = tokens.join(":"); // the steps inherit this process's environment
  results.push({ name: `hold ${tokens.length} card token${tokens.length > 1 ? "s" : ""}`, status: "ok", seconds: seconds(waitedFrom) });
  console.log(`\nHolding ${tokens.length} card token${tokens.length > 1 ? "s" : ""}: at most ${tokens.length} of this gate's card browsers draw at once.`);
  if (tokens.length < CARD_TOKENS)
    console.log(
      `(only ${tokens.length} of the ${CARD_TOKENS} it wants: the job it runs under holds no more, or TEST_GPU_JOBS is smaller, ` +
        `so its card browsers take turns; under gpu-run, give the gate its ${CARD_TOKENS}: gpu-run --tokens ${CARD_TOKENS} --admit-timeout-runs ...)`,
    );

  console.log("\nStarted side by side:");
  STEPS.forEach(([name], i) => console.log(`  ${name} against ${workers[i].base}`));
  let failed = false;
  const stopping = [];
  const running = STEPS.map(([name, script], i) => {
    const t = Date.now();
    const target = workers[i].own ? `--port=${workers[i].port}` : `--base=${workers[i].base}`;
    const child = spawn(npm, ["run", script, "--", target], { stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "";
    const keep = (d) => {
      // Everything is printed when the step ends; a wait for a card token is said at once too.
      for (const line of String(d).split("\n")) if (/waiting for a card (token|slot)/.test(line)) console.log(`  (${script}) ${line.trim()}`);
      out += d;
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const step = { name, child, stopped: false };
    step.done = new Promise((resolve) => {
      let ended = false;
      let drainLimit = null;
      const finish = (code) => {
        if (ended) return;
        ended = true;
        clearTimeout(drainLimit);
        const status = step.stopped ? "stopped" : code === 0 ? "ok" : "FAIL";
        const r = { name, status, seconds: seconds(t) };
        results.push(r);
        console.log(`\n=== ${name}: ${status} after ${r.seconds} s (${workers[i].base}) ===`);
        process.stdout.write(out.endsWith("\n") || !out ? out : out + "\n");
        if (status === "FAIL") {
          console.log(`--- the last lines of its local Worker ---\n${workers[i].log().split("\n").slice(-15).join("\n")}`);
          if (!failed) {
            failed = true;
            // The others only add noise once one has failed: stop them, whole process groups.
            for (const s of running) if (s !== step) stopping.push(stopStep(s));
          }
        }
        resolve();
      };
      // The output is printed once both pipes have drained ("close"), not at "exit": the e2e
      // scripts print their list of problems last, and those lines may still be in the pipe
      // when the process exits. A process the step left running that holds the pipes open
      // could delay "close" for good, so five seconds after the exit the step ends anyway.
      child.on("close", (code) => finish(code ?? 1));
      child.on("exit", (code) => {
        drainLimit = setTimeout(() => finish(code ?? 1), 5000);
      });
      child.on("error", () => finish(1));
    });
    cleanups.push(() => stopStep(step));
    return step;
  });
  await Promise.all(running.map((s) => s.done));
  await Promise.all(stopping);
  // The summary lists the steps in the gate's order, whatever order they finished in.
  const order = new Map(STEPS.map(([name], i) => [name, i]));
  results.sort((a, b) => (order.get(a.name) ?? -1) - (order.get(b.name) ?? -1));
}

/**
 * Stops a step's whole process group: npm, the test script and its browser. A SIGTERM first;
 * Playwright catches it to close its browser and then leaves the script running, so whatever is
 * left after five seconds gets a SIGKILL (the private display and the card slot go with it).
 * Resolves once nothing of the group is left.
 */
async function stopStep(step) {
  if (!groupAlive(step.child.pid)) return;
  if (step.child.exitCode === null && step.child.signalCode === null) step.stopped = true;
  await stopGroup(step.child.pid);
}

try {
  await holdGateLock();
  await (sideBySide ? sideBySideSteps() : oneAfterAnother());
} finally {
  await cleanUp();
}
process.exit(summary());
