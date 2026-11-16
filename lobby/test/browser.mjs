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
import { execFileSync, spawn } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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
 * chromium.launch with the scripts' usual settings (headless, muted), plus the caller's
 * Playwright launch options. Returns the Browser; its close() also stops the private display.
 */
export async function launchBrowser({ args = [], software = false, ...options } = {}) {
  if (!gpu || software) return chromium.launch({ headless: true, ...options, args: ["--mute-audio", ...args] });

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
      args: ["--mute-audio", ...args.filter((a) => !SOFTWARE_ONLY.has(a)), ...GPU_ARGS],
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
 * How many test processes may draw on the card at once, unless TEST_GPU_JOBS says otherwise.
 * Measured on the owner's RX 7800 XT on 2026-11-15 (GPU-PLAYBOOK.md in the ops repo, "How many
 * jobs at once"): copies of e2e-room-pick scale almost in step up to six at once, fail now and
 * then from eight, and at twelve some browsers do not get the card at all; heavy drawing fills
 * the card at three or four. Four is half the point where failures start and leaves the
 * owner's desktop room on the card.
 * gpu-run (the owner's dotfiles) uses the same default; keep the two in step.
 */
export const DEFAULT_CARD_SLOTS = 4;

/**
 * The card is shared with the owner's desktop and with other GPU work (Blender renders), so
 * only TEST_GPU_JOBS processes (default DEFAULT_CARD_SLOTS) may use it for tests at once. A
 * process takes one of the machine-wide locks /tmp/test-gpu-<n>.lock (one per slot) before its
 * first GPU browser and keeps it until it exits; others wait their turn, first come first
 * served, and say how many are ahead of them. The lock is a kernel flock held by a small child
 * (flock ... cat) that reads this process's stdin pipe: when this process ends, however it ends,
 * the pipe closes and the lock is released. Other GPU work can wait for, or hold, a slot:
 *   flock /tmp/test-gpu-1.lock <command>
 * and gpu-run's heavy jobs (renders, models) hold every slot, so no test draws beside them.
 */
const LOCK_DIR = process.env.TEST_GPU_LOCK_DIR || "/tmp"; // another folder only for the helper's own tests
let cardHeld = null;
export function holdCard() {
  cardHeld ??= (async () => {
    const jobs = Math.max(1, Number(process.env.TEST_GPU_JOBS) || DEFAULT_CARD_SLOTS);
    if (!which("flock")) throw new Error("TEST_GPU=1 needs flock (util-linux) to share the graphics card");
    // Under gpu-run, which already holds a slot for this job and adds one for it to take
    // (TEST_GPU_SLOT_HELD=1), the slot is not queued for: it is this job's own. Otherwise a
    // free slot is taken at once when nobody is waiting, and the line is joined only when
    // every slot is in use (or others are already waiting), so jobs that start together do not
    // line up behind each other for free slots.
    const held = process.env.TEST_GPU_SLOT_HELD === "1";
    if ((held || waiting() === 0) && (await takeSlot(jobs))) return;
    const queue = held ? { ahead: () => 0, leave: () => {} } : joinQueue();
    try {
      for (let said = -1; ; ) {
        const ahead = queue.ahead();
        if (ahead === 0 && (await takeSlot(jobs))) return;
        if (ahead !== said) {
          console.log(
            said < 0
              ? `(waiting for a card slot, ${ahead} ahead: all ${jobs} slot${jobs > 1 ? "s are" : " is"} in use; TEST_GPU_JOBS changes the number of slots)`
              : `(waiting for a card slot, ${ahead} ahead)`,
          );
          said = ahead;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    } finally {
      queue.leave();
    }
  })();
  return cardHeld;
}

/** Takes the first free slot of 1..jobs and keeps it for the life of this process. */
async function takeSlot(jobs) {
  for (let n = 1; n <= jobs; n++) {
    const holder = spawn("flock", ["-n", join(LOCK_DIR, `test-gpu-${n}.lock`), "sh", "-c", "echo held; exec cat >/dev/null"], { stdio: ["pipe", "pipe", "ignore"] });
    const held = await new Promise((resolve) => {
      holder.stdout.once("data", () => resolve(true));
      holder.once("exit", () => resolve(false)); // that slot is taken
      holder.once("error", () => resolve(false));
    });
    if (held) {
      holder.unref();
      holder.stdin.unref?.();
      holder.stdout.unref?.();
      holder.stdin.on("error", () => {});
      return true;
    }
  }
  return false;
}

/**
 * The line of processes waiting for a slot: one empty file per waiter in /tmp/test-gpu-queue,
 * named by when it started waiting and its process id. Only the first in line tries for a slot,
 * so a job that has waited longest goes next. A file whose process has gone (killed outright)
 * no longer counts and is removed by whoever sees it.
 */
const QUEUE = join(LOCK_DIR, "test-gpu-queue");

/** How many live waiters are in line before `me` (every one when `me` is left out). */
function waiting(me = "~") {
  let names;
  try {
    names = readdirSync(QUEUE);
  } catch {
    return 0;
  }
  let n = 0;
  for (const name of names) {
    if (name >= me) continue;
    let alive;
    try {
      process.kill(Number(name.split("-")[1]), 0);
      alive = true;
    } catch (e) {
      alive = e.code === "EPERM";
    }
    if (alive) n++;
    else
      try {
        unlinkSync(join(QUEUE, name));
      } catch {}
  }
  return n;
}

function joinQueue() {
  const me = `${String(Date.now()).padStart(15, "0")}-${process.pid}`;
  try {
    mkdirSync(QUEUE, { recursive: true, mode: 0o1777 });
    writeFileSync(join(QUEUE, me), "");
  } catch {
    return { ahead: () => 0, leave: () => {} }; // no queue: every waiter simply tries
  }
  const leave = () => {
    try {
      unlinkSync(join(QUEUE, me));
    } catch {}
    process.off("exit", leave);
  };
  process.on("exit", leave);
  return { ahead: () => waiting(me), leave };
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
