// Launches the headless, muted browsers the browser tests drive.
//
// launchBrowser(): Playwright's Chromium inside WSL.
//
// By default this is exactly the launch the scripts always made: Playwright's Chromium,
// headless, drawing WebGL in software (SwiftShader). That is slow, it loads the CPU, and its
// pixels are the same on every run. GitHub's runners have no graphics card, so CI always runs
// this way.
//
// With TEST_GPU=1 in the environment, and on WSL2 with a graphics card, the same headless
// browser draws on the graphics card instead, through Mesa's D3D12 driver (/dev/dxg). Chromium's
// own headless display has no GPU path on WSL (it wants /dev/dri, which WSL does not have), so
// the browser is pointed at a private, invisible X display (Xvfb) of its own: nothing appears on
// the desktop, no window takes focus, and the display is stopped when the browser closes, when
// the process exits, and (through the kernel's parent-death signal) even when the process is
// killed outright. If the browser ends up drawing in software anyway, the launch fails rather
// than quietly running slow.
//
//   TEST_GPU=1 node lobby/test/e2e-room-pick.mjs --base=http://localhost:8791
//
// A browser that stands for a device without hardware 3D, or whose pictures are compared with
// earlier ones, passes { software: true } and always draws in software, whatever TEST_GPU says.
// GPU pixels differ from software ones (edges, mipmaps, shader precision) and can change with a
// driver update.
//
// openWindowsChrome(): a headless, muted Chrome on the Windows side, on the real graphics card
// (D3D11), driven over the debugging protocol. Each call gets its own throwaway profile folder
// and lets Chrome pick a free debugging port, so two runs at once never meet; every connect
// attempt has a timeout, and the Windows Chrome is stopped even if the script dies.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { chromium } from "playwright";

const SOFTWARE_ONLY = new Set(["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-gl=swiftshader"]);
const GPU_ARGS = ["--ozone-platform=x11", "--use-gl=angle", "--use-angle=gl", "--ignore-gpu-blocklist"];

/**
 * TEST_NO_GPU=1 keeps every test off the graphics card, whatever else is set: TEST_GPU=1 is
 * ignored (software, with a line saying so) and openWindowsChrome refuses. It is the one switch
 * to flip when the card is needed for something else or misbehaves.
 */
const cardOff = process.env.TEST_NO_GPU === "1";
if (cardOff && process.env.TEST_GPU === "1") console.log("(TEST_NO_GPU=1: TEST_GPU=1 ignored, the browser draws in software)");

/** Whether launches in this process draw on the graphics card (TEST_GPU=1, and not TEST_NO_GPU=1). */
export const gpu = process.env.TEST_GPU === "1" && !cardOff;

/**
 * A test browser is silent and has no sound device behind it. --mute-audio alone still opens the
 * machine's device (WSLg's PulseAudio here), and on a busy machine that device can fail under a page
 * ("The AudioContext encountered an error from the audio device or the WebAudio renderer"), which a
 * suite's "no page reported an error" check then rightly fails on. With --disable-audio-output the
 * browser plays into nothing: an AudioContext still runs and its clock still advances.
 */
export const QUIET = ["--mute-audio", "--disable-audio-output"];

/**
 * For page.evaluate, in the page: the address, in the page's own release, of the file at site
 * path `path` ("/lobby/look3d/space.js"). A release's files are served from its own folder
 * (/r/<release id>/, party-kit/build/folders.mjs), so a test that wants a module of the page it
 * drives must not import it by site path: that address is outside the folder. The folder is read
 * from the page's own scripts and stylesheets; a site without folders serves from "/".
 *
 *   const url = await page.evaluate(siteFile, "/lobby/look3d/space.js");
 *   const PX = await page.evaluate(async (url) => (await import(url)).PX, url);
 */
export function siteFile(path) {
  const own = [...document.querySelectorAll("script[src], link[rel=stylesheet][href]")].map((el) => /^(.*\/r\/[0-9a-f]{12}\/)/.exec(el.src || el.href)?.[1]).find(Boolean);
  return new URL(String(path).replace(/^\/+/, ""), own ?? `${location.origin}/`).href;
}

/**
 * chromium.launch with the scripts' usual settings (headless, muted), plus the caller's
 * Playwright launch options. Returns the Browser; its close() also stops the private display.
 */
export async function launchBrowser({ args = [], software = false, ...options } = {}) {
  if (!gpu || software) return chromium.launch({ headless: true, ...options, args: [...QUIET, ...args] });

  if (!existsSync("/dev/dxg")) throw new Error("TEST_GPU=1 needs WSL2's /dev/dxg (the graphics card); unset TEST_GPU to draw in software");
  await holdCard();
  const display = await startDisplay();
  let browser;
  try {
    const env = { ...process.env, ...options.env, DISPLAY: display.name, GALLIUM_DRIVER: "d3d12" };
    delete env.WAYLAND_DISPLAY; // never the desktop's display
    browser = await chromium.launch({
      headless: true,
      ...options,
      env,
      args: [...QUIET, ...args.filter((a) => !SOFTWARE_ONLY.has(a)), ...GPU_ARGS],
    });
    const renderer = await rendererOf(browser);
    if (!/D3D12/.test(renderer))
      throw new Error(`TEST_GPU=1 but WebGL draws in software (${renderer}): Mesa's d3d12 driver is missing or failed (sudo apt install libgl1-mesa-dri), or unset TEST_GPU`);
    console.log(`(browser drawing on the graphics card: ${renderer})`);
  } catch (e) {
    await browser?.close().catch(() => {});
    display.stop();
    throw e;
  }
  browser.on("disconnected", display.stop);
  const close = browser.close.bind(browser);
  browser.close = async (...a) => {
    try {
      return await close(...a);
    } finally {
      display.stop();
    }
  };
  return browser;
}

/**
 * The card's token pool: how many headless WebGL browser processes may draw on the card at once,
 * unless TEST_GPU_JOBS says otherwise. Measured on the owner's RX 7800 XT on 2026-11-15
 * (GPU-PLAYBOOK.md in the ops repo, "How many jobs at once"): real suites ran fine to about six
 * browsers at once and failed now and then from eight. The pool starts at three, and the owner
 * raises it (four, five) with TEST_GPU_JOBS as measured runs allow.
 * gpu-run (the owner's dotfiles) uses the same default; keep the two in step.
 */
export const DEFAULT_CARD_SLOTS = 3;

/**
 * The card is shared with the owner's desktop and with other GPU work (Blender renders), so only
 * so many browsers may draw on it for tests at once. Each one holds a token: a process takes one
 * before its first GPU browser and keeps it until it exits (every test script draws with one
 * browser process), and others wait their turn, first come first served, saying how many are
 * ahead of them.
 *
 * Where the tokens come from:
 * - Under a job that holds tokens (gpu-run, or the pre-deploy gate), TEST_GPU_TOKENS names them,
 *   and a process draws only on those: it claims one ("<token>.use"), so the processes below one
 *   job never draw more than the job holds, and takes nothing from the card's own pool.
 * - Otherwise from the card's pool, /tmp/test-gpu-<n>.lock, n = 1 to TEST_GPU_JOBS (default
 *   DEFAULT_CARD_SLOTS), the files gpu-run takes too.
 * - Under a gpu-run from before the token pool (TEST_GPU_SLOT_HELD=1 and no TEST_GPU_TOKENS),
 *   as that gpu-run expects: any free file of 1 to its TEST_GPU_JOBS, which is one more than its
 *   pool, without queueing.
 *
 * A token is taken while anyone holds any lock on its file: the taker checks it is free with an
 * exclusive lock and then holds it shared, and a process under a job also holds the job's card
 * token shared, so a token stays taken while any process of the job still runs, even when the
 * job's own process (gpu-run, the gate) was killed.
 *
 * Tokens are taken all at once or not at all, so nobody sits on some while waiting for others.
 * The first in line holds the pool's gate file while it waits, so a job that needs several is
 * not overtaken by single ones that come after it; it lets the gate go as soon as it is no longer
 * first, and after GATE_PRIORITY_S it goes to the back of the line, so one long holder and one
 * waiting big job cannot hold up everyone else for good. A gate held past GATE_WAIT_MAX_S (a
 * holder that hangs) is passed by, and a waiter says who holds the tokens after WAIT_REPORT_S.
 * Every lock is a kernel flock held by a small child (sh ... cat) that reads this process's stdin
 * pipe: when this process ends, however it ends, the pipe closes and the lock is released.
 *
 * A plain `flock /tmp/test-gpu-1.lock <command>` holds one token, not the card: the other tokens
 * still draw beside it. Work that needs the card to itself (a render, an image or language model)
 * runs through `gpu-run --kind blender|image|model`, which holds every token.
 */
const LOCK_DIR = process.env.TEST_GPU_LOCK_DIR || "/tmp"; // another folder only for the helper's own tests

/** Where this process's tokens come from (see above): { tokens, gate, queue, inherited, what }. */
function cardPool() {
  const inherited = (process.env.TEST_GPU_TOKENS ?? "").split(":").filter(Boolean);
  if (inherited.length)
    return {
      tokens: inherited.map((t) => t + ".use"),
      gate: inherited[0] + ".gate",
      queue: inherited[0] + ".queue",
      inherited: true,
      what: inherited.length > 1 ? `the ${inherited.length} tokens this job holds` : "the one token this job holds",
    };
  const legacy = process.env.TEST_GPU_SLOT_HELD === "1";
  const n = Math.max(1, Number(process.env.TEST_GPU_JOBS) || DEFAULT_CARD_SLOTS);
  return {
    tokens: Array.from({ length: n }, (_, i) => join(LOCK_DIR, `test-gpu-${i + 1}.lock`)),
    gate: legacy ? null : join(LOCK_DIR, "test-gpu-gate.lock"),
    queue: legacy ? null : join(LOCK_DIR, "test-gpu-queue"),
    inherited: false,
    what: n > 1 ? `the card's ${n} tokens` : "the card's one token",
  };
}

let cardHeld = null;
/** Takes one card token for this process (once; later calls wait for the same one). */
export function holdCard() {
  cardHeld ??= holdTokens(1);
  return cardHeld;
}

/**
 * Takes `want` card tokens (at most all there are) and holds them for the life of this process.
 * Resolves to their paths: put them in TEST_GPU_TOKENS for the processes this one starts, and
 * those draw only on them. The pre-deploy gate uses it to cap its own browsers.
 */
export async function holdTokens(want) {
  if (!which("flock")) throw new Error("TEST_GPU=1 needs flock (util-linux) to share the graphics card");
  const pool = cardPool();
  want = Math.max(1, Math.min(want, pool.tokens.length));
  // Written into the files this process locks, so a waiter can say who holds them.
  const owner = `pid=${process.pid} since=${Math.floor(Date.now() / 1000)} what=${basename(process.argv[1] ?? "node")}`;
  const gate = { held: null, since: 0 };
  // A free token is taken at once when nobody is waiting, and the line is joined only when too
  // few are free (or others are already waiting), so jobs that start together do not line up
  // behind each other for free tokens.
  if (!pool.queue || waiting(pool.queue) === 0) {
    // Another taker holds the gate only for the moment it takes its tokens, unless it is waiting
    // for tokens itself: so a busy gate is tried again for a short while before joining the line.
    for (const until = Date.now() + 2000; ; ) {
      const got = await gather(pool, want, { keepGate: false, gate, owner });
      if (Array.isArray(got)) return got;
      if (got !== GATE_BUSY || Date.now() > until) break;
      await sleep(50);
    }
  }
  const noQueue = { ahead: () => 0, leave: () => {} };
  let queue = pool.queue ? await joinQueue(pool.queue) : noQueue;
  const t0 = Date.now();
  let reportAt = t0 + WAIT_REPORT_S * 1000;
  let gateWaitFrom = null;
  let skipGate = false;
  try {
    for (let said = -1; ; ) {
      const ahead = queue.ahead();
      // Only the first in line may hold the gate: one that is no longer first (a waiter whose
      // entry sorts before it got into line) lets it go, or the new first could never take it.
      if (ahead !== 0 && gate.held) releaseGate(gate);
      if (ahead === 0) {
        const got = await gather(pool, want, { keepGate: true, gate, owner, skipGate });
        if (Array.isArray(got)) return got;
        if (got !== GATE_BUSY) gateWaitFrom = null;
        else if (!skipGate && Date.now() - (gateWaitFrom ??= Date.now()) > GATE_WAIT_MAX_S * 1000) {
          console.log(`(the card's gate ${pool.gate} has been held for over ${GATE_WAIT_MAX_S} s by ${holderOf(pool.gate)}; taking tokens without it)`);
          skipGate = true;
        }
        if (gate.held && Date.now() - gate.since > GATE_PRIORITY_S * 1000 && pool.queue) {
          // First in line too long: to the back of the line, so the ones behind get a turn.
          releaseGate(gate);
          queue.leave();
          queue = await joinQueue(pool.queue);
          console.log(`(still waiting after ${GATE_PRIORITY_S} s first in line: going to the back of the line, so jobs that need fewer tokens can start)`);
          said = -2;
          await sleep(GATE_YIELD_S * 1000);
          continue;
        }
      }
      if (ahead !== said) {
        const n = pool.tokens.length;
        const why = want > 1 ? `it needs ${want} of ${pool.what}` : n > 1 ? `all ${pool.what} are in use` : `${pool.what} is in use`;
        const hint = pool.inherited ? "" : "; TEST_GPU_JOBS changes the number";
        console.log(said === -1 ? `(waiting for a card token, ${ahead} ahead: ${why}${hint})` : `(waiting for a card token, ${ahead} ahead)`);
        said = ahead;
      }
      if (Date.now() >= reportAt) {
        const held = pool.tokens.filter(isLocked).map((t) => `${basename(t)}: ${holderOf(t)}`);
        console.log(`(still waiting after ${Math.round((Date.now() - t0) / 1000)} s; held now: ${held.join("; ") || "none (another job is about to take them)"})`);
        reportAt = Date.now() + WAIT_REPORT_EVERY_S * 1000;
      }
      await sleep(500);
    }
  } finally {
    releaseGate(gate);
    queue.leave();
  }
}

/** Limits on waiting, in seconds, as in gpu-run; the environment changes them for the helper's own tests. */
const limit = (name, value) => (process.env[name] ? Math.max(0, Number(process.env[name])) || 0 : value);
const GATE_PRIORITY_S = limit("TEST_GPU_GATE_PRIORITY_S", 180);
const GATE_YIELD_S = 5;
const GATE_WAIT_MAX_S = limit("TEST_GPU_GATE_WAIT_MAX_S", 600);
const WAIT_REPORT_S = limit("TEST_GPU_WAIT_REPORT_S", 60);
const WAIT_REPORT_EVERY_S = 300;
const GATE_BUSY = "gate busy";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function releaseGate(gate) {
  gate.held?.release();
  gate.held = null;
}

/** The card token a claim file stands for: the path without its ".use" endings. */
const rootToken = (path) => path.replace(/(\.use)+$/, "");

/** Who holds `file`, as its holder wrote it into the file, when that holder is still running. */
function holderOf(file) {
  try {
    const d = Object.fromEntries(
      readFileSync(file, "utf8")
        .trim()
        .split(" ")
        .map((kv) => kv.split("=")),
    );
    const pid = Number(d.pid);
    process.kill(pid, 0);
    const s = Math.round(Date.now() / 1000 - Number(d.since));
    return `${d.what ?? "?"} (pid ${pid}) for ${s >= 60 ? Math.round(s / 60) + " min" : s + " s"}`;
  } catch {
    return "no details (an older gpu-run or test helper)";
  }
}

/**
 * One try at `want` tokens of `pool`, all or nothing, under its gate. Resolves to the paths held,
 * GATE_BUSY when someone else holds the gate, or null when too few tokens are free. With keepGate
 * the gate stays held (in gate.held) after a failed try, so the next try is still first; it is
 * let go by the caller. With skipGate the gate is not taken at all.
 */
async function gather(pool, want, { keepGate, gate, owner, skipGate = false }) {
  if (pool.gate && !gate.held && !skipGate) {
    gate.held = await lockFile(pool.gate, { info: owner });
    if (!gate.held) return GATE_BUSY;
    gate.since = Date.now();
  }
  const held = [];
  try {
    for (const path of pool.tokens) {
      const locks = await claim(pool, path, owner);
      if (!locks) continue;
      held.push({ path, locks });
      if (held.length === want) return held.map((h) => h.path);
    }
    for (const h of held) for (const l of h.locks) l.release();
    return null;
  } finally {
    if (!keepGate || held.length === want) releaseGate(gate);
  }
}

/**
 * One token, if free: its locks, or null. A card token is checked free (exclusive) and then held
 * shared, so the processes of this job can hold it too. A claim on a job's token is exclusive
 * among the job's processes, and comes with a shared hold on the card token behind it, which
 * keeps that token taken while this process runs, whatever happens to the job's own process.
 */
async function claim(pool, path, owner) {
  if (!pool.inherited) {
    const lock = await lockFile(path, { mode: "take", info: owner });
    return lock && [lock];
  }
  const lock = await lockFile(path, { info: owner });
  if (!lock) return null;
  const keep = await lockFile(rootToken(path), { mode: "shared" });
  return keep ? [lock, keep] : [lock];
}

// Holds the lock on $1 on file descriptor 9, which `cat` keeps open until this process's stdin
// pipe closes. $2 is "x" (exclusive), "s" (shared) or "take" (exclusive to check the file is
// free, then shared); $3, when set, is written into the file to say who holds it.
const HOLD_LOCK = `exec 9<>"$1" || exit 1
if [ "$2" = s ]; then flock -n -s 9 || exit 1; else flock -n -x 9 || exit 1; fi
if [ "$2" = take ]; then flock -n -s 9 || exit 1; fi
[ -z "$3" ] || printf '%s\\n' "$3" >"$1"
echo held
exec cat >/dev/null`;

/**
 * Holds a flock on `file` for the life of this process, or until release() is called, through a
 * small child (sh, then cat) that reads this process's stdin pipe: when this process ends,
 * however it ends, the pipe closes and the lock is released. Resolves to null when the file is
 * locked by someone else. mode: "exclusive" (the default), "shared", or "take" (see HOLD_LOCK).
 */
async function lockFile(file, { mode = "exclusive", info = "" } = {}) {
  const how = { exclusive: "x", shared: "s", take: "take" }[mode];
  const holder = spawn("sh", ["-c", HOLD_LOCK, "hold-lock", file, how, info], { stdio: ["pipe", "pipe", "ignore"] });
  holder.stdin.on("error", () => {});
  const held = await new Promise((resolve) => {
    holder.stdout.once("data", () => resolve(true));
    holder.once("exit", () => resolve(false)); // locked by someone else
    holder.once("error", () => resolve(false));
  });
  if (!held) return null;
  holder.unref();
  holder.stdin.unref?.();
  holder.stdout.unref?.();
  return {
    release() {
      holder.stdin.end();
      holder.kill();
    },
  };
}

/** Whether someone holds a flock on `file` (it is checked without waiting, and never kept). */
function isLocked(file) {
  return spawnSync("flock", ["-n", "-E", "200", file, "true"], { stdio: "ignore" }).status === 200;
}

/**
 * The line of processes waiting for tokens: one empty file per waiter in the pool's queue folder
 * (/tmp/test-gpu-queue for the card's pool, "<first token>.queue" for a job's own), named by when
 * it got into line (the monotonic clock) and its process id. Only the first in line tries for
 * tokens, so a job that has waited longest goes next. Order in line is only fairness: a waiter
 * that finds another ahead of it lets the gate go, so no ordering mistake can stop the line.
 *
 * A waiter holds a flock on its own file while it waits, and a file nobody holds a lock on no
 * longer counts and is removed by whoever sees it. That is what makes a waiter killed outright
 * (SIGKILL, or a SIGTERM with no handler, so its exit hook never removes the file) drop out of
 * line: the kernel releases its lock. The process id in the name is never trusted, since after
 * a restart (/tmp persists on WSL) or once ids wrap, it can belong to any live process.
 * A waiter locks its file under a dot name and only then renames it into line, so nobody ever
 * sees a fresh file before its lock is held.
 */

/** How many live waiters are in line in `queue` before `me` (every one when `me` is left out). */
function waiting(queue, me = "~") {
  let names;
  try {
    names = readdirSync(queue);
  } catch {
    return 0;
  }
  let n = 0;
  for (const name of names) {
    const file = join(queue, name);
    if (name.startsWith(".")) {
      // A waiter killed between locking its file and putting it in line; never in line itself.
      try {
        if (Date.now() - statSync(file).mtimeMs > 60000 && !isLocked(file)) unlinkSync(file);
      } catch {}
      continue;
    }
    if (name >= me) continue;
    if (isLocked(file)) n++;
    else
      try {
        unlinkSync(file);
      } catch {}
  }
  return n;
}

async function joinQueue(queue) {
  const temp = `.${process.pid}-${Math.random().toString(36).slice(2)}`;
  let me = null;
  const noQueue = { ahead: () => 0, leave: () => {} }; // every waiter simply tries
  let lock;
  try {
    mkdirSync(queue, { recursive: true, mode: 0o1777 });
    writeFileSync(join(queue, temp), "");
    lock = await lockFile(join(queue, temp));
    if (!lock) throw new Error("could not lock its own queue file");
    // The place in line is read from the system's monotonic clock (the same for every process on
    // the machine, and never stepped) once the entry is ready, right before it goes into line.
    me = `${String(process.hrtime.bigint()).padStart(20, "0")}-${process.pid}`;
    renameSync(join(queue, temp), join(queue, me));
  } catch {
    lock?.release();
    for (const name of [temp, me])
      try {
        if (name) unlinkSync(join(queue, name));
      } catch {}
    return noQueue;
  }
  const leave = () => {
    try {
      unlinkSync(join(queue, me));
    } catch {}
    lock.release();
    process.off("exit", leave);
  };
  process.on("exit", leave);
  return { ahead: () => waiting(queue, me), leave };
}

/** The full path of a program on PATH, or null. */
function which(name) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    try {
      accessSync(join(dir, name), constants.X_OK);
      return join(dir, name);
    } catch {}
  }
  return null;
}

/**
 * A private Xvfb, never shown anywhere. WSLg mounts /tmp/.X11-unix read-only, so Xvfb's path
 * socket fails there (it says so on stderr) and the browser reaches it on Linux's abstract socket
 * of the same name instead. That is also why -displayfd cannot pick the number: a random one is
 * tried until one starts. Two helpers that draw the same number cannot both have it: Xvfb's lock
 * file (/tmp/.X<n>-lock) lets only one start, and a display counts as ours only when that file
 * names our own Xvfb, not merely when something answers on the socket.
 *
 * Xvfb is started through setpriv --pdeathsig, so the kernel stops it if this process dies
 * without running its exit hooks (SIGKILL, a crash). It never keeps this process alive by itself.
 */
async function startDisplay() {
  if (!which("Xvfb")) throw new Error("TEST_GPU=1 needs Xvfb (sudo apt install xvfb), or unset TEST_GPU");
  const setpriv = which("setpriv");
  let lastErr = "";
  for (let tries = 0; tries < 20; tries++) {
    const n = 200 + Math.floor(Math.random() * 3800);
    const xvfb = ["Xvfb", ":" + n, "-screen", "0", "1920x1080x24", "-nolisten", "tcp", "-noreset"];
    const [cmd, ...cmdArgs] = setpriv ? [setpriv, "--pdeathsig", "TERM", "--", ...xvfb] : xvfb;
    const x = spawn(cmd, cmdArgs, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    x.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
    x.unref();
    x.stderr.unref?.();
    const alive = () => x.exitCode === null && x.signalCode === null;
    const stop = () => {
      if (alive()) x.kill("SIGTERM");
      process.off("exit", stop);
    };
    process.on("exit", stop);
    const up = await new Promise((resolve) => {
      x.once("error", () => resolve(false));
      x.once("exit", () => resolve(false)); // that number was taken, or Xvfb could not start
      const from = Date.now();
      const ours = () => {
        try {
          return Number(readFileSync(`/tmp/.X${n}-lock`, "utf8").trim()) === x.pid;
        } catch {
          return false;
        }
      };
      const knock = () => {
        if (!alive()) return resolve(false);
        connect("\0/tmp/.X11-unix/X" + n)
          .once("connect", function () {
            this.destroy();
            if (ours() && alive()) resolve(true);
            else retry();
          })
          .once("error", retry);
      };
      const retry = () => (Date.now() - from > 10000 ? resolve(false) : setTimeout(knock, 50));
      knock();
    });
    if (up) return { name: ":" + n, stop };
    stop();
    lastErr = stderr.trim().split("\n").filter((l) => !/_XSERVTrans|X11-unix|^\(EE\)\s*$/.test(l)).slice(-3).join(" / ");
  }
  throw new Error(`TEST_GPU=1 could not start a private Xvfb display${lastErr ? ` (Xvfb said: ${lastErr})` : ""}`);
}

/** The WebGL renderer a page of this browser gets. */
async function rendererOf(browser) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl ? gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : "no WebGL";
    });
  } finally {
    await page.context().close();
  }
}

const WINDOWS_CHROME = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";

/**
 * A headless, muted Chrome on the Windows side, on the real graphics card, driven over the
 * debugging protocol. The same shape as Cork & Bell's tools/browser.mjs openBrowser({ win: true })
 * ({ browser, newContext, close }), without its shared profile folder, its guessed port and its
 * connect that can hang for minutes on a port nobody answers.
 *
 * The profile is a fresh folder under the WSL temp directory (not inside the repository: wrangler
 * dev watches it, and every file Chrome wrote there would restart the local server). Chrome picks
 * its own free debugging port (--remote-debugging-port=0) and writes it to DevToolsActivePort in
 * that folder. If the script dies before close(), an exit or signal hook stops the Windows Chrome
 * that uses this profile folder, and nothing else.
 */
export async function openWindowsChrome({ width = 1920, height = 1080, uncapped = false, attemptMs = 5000, startMs = 45000 } = {}) {
  if (cardOff) throw new Error("TEST_NO_GPU=1: the Windows Chrome draws on the graphics card, so it is not started (use the script's software option, e.g. --soft=1)");
  if (!existsSync(WINDOWS_CHROME)) throw new Error("no Chrome on the Windows side at " + WINDOWS_CHROME);
  await holdCard();
  const profile = mkdtempSync(join(tmpdir(), "party-test-chrome-"));
  const winProfile = execFileSync("wslpath", ["-w", profile]).toString().trim();
  const child = spawn(
    WINDOWS_CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      "--user-data-dir=" + winProfile,
      "--no-first-run",
      "--no-default-browser-check",
      "--enable-gpu",
      "--use-angle=d3d11",
      "--window-size=" + width + "," + height,
      "--force-device-scale-factor=1",
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio", // nobody should hear a test browser
      ...(uncapped ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : []),
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let exited = false;
  child.once("exit", () => (exited = true));
  child.once("error", () => (exited = true));

  // Killing the WSL side of the process leaves the Windows one running, so Windows is asked to
  // stop every chrome.exe whose command line names this profile folder: its name is unique to
  // this call, so that matches no other Chrome.
  const stopOnWindows = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${basename(profile)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  // A watcher outside this process does the same if this process is killed outright (SIGKILL),
  // when no hook of ours can run: it waits for its stdin to close without the word "done".
  const watcher = spawn(
    "bash",
    ["-c", 'trap "" INT TERM HUP; read -r word; [ "$word" = done ] && exit 0; powershell.exe -NoProfile -NonInteractive -Command "$1" >/dev/null 2>&1; rm -rf -- "$2"', "watch", stopOnWindows, profile],
    { stdio: ["pipe", "ignore", "ignore"], detached: true },
  );
  watcher.unref();
  watcher.stdin.on("error", () => {});
  watcher.stdin.unref?.();

  let cleaned = false;
  /** Stops the Windows Chrome of this profile, synchronously (it may run from an exit hook). */
  const kill = () => {
    if (cleaned) return;
    cleaned = true;
    process.off("exit", kill);
    for (const s of SIGNALS) process.off(s, onSignal);
    child.kill();
    try {
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", stopOnWindows], { stdio: "ignore", timeout: 20000 });
    } catch {}
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    try {
      watcher.stdin.end("done\n");
    } catch {}
  };
  const onSignal = (signal) => {
    kill();
    process.exit(128 + ({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[signal] ?? 0));
  };
  process.on("exit", kill);
  for (const s of SIGNALS) process.once(s, onSignal);

  const deadline = Date.now() + startMs;
  let browser = null;
  let why = "Chrome did not write its debugging port";
  try {
    while (!browser && Date.now() < deadline) {
      if (exited) throw new Error("the Windows Chrome exited at once (is another Chrome using this profile?)");
      let port = null;
      try {
        port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]) || null;
      } catch {}
      if (port) {
        browser = await connectWithin("http://localhost:" + port, attemptMs).catch((e) => ((why = e.message), null));
        if (browser) break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!browser) throw new Error(`could not reach the Windows Chrome within ${startMs / 1000} s: ${why}`);
  } catch (e) {
    kill();
    throw e;
  }
  return {
    browser,
    newContext: (opts = {}) => browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...opts }),
    close: async () => {
      // Ask Chrome itself to quit first, then make sure of it.
      const session = await browser.newBrowserCDPSession().catch(() => null);
      await session?.send("Browser.close").catch(() => {});
      await browser.close().catch(() => {});
      kill();
    },
  };
}

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

/** connectOverCDP that gives up after ms, and closes a connection that arrives too late. */
function connectWithin(url, ms) {
  const attempt = chromium.connectOverCDP(url, { timeout: ms });
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => {
      attempt.then((b) => b.close().catch(() => {}), () => {});
      reject(new Error(`no answer on ${url} within ${ms} ms`));
    }, ms + 500);
  });
  return Promise.race([attempt, late]).finally(() => clearTimeout(timer));
}
