// "New version available", end to end (site/release-switch.js, and the room's side in
// lobby/server/release-points.js and lobby/server/lobby-room.js).
//
// It runs a local Worker of its own and deploys to it: each "deploy" builds the site into a
// folder of its own under --out with a new salt (scripts/build-public.mjs --out --salt: the same
// files are another release) and restarts the Worker on it over the same Durable Object storage,
// as a real deploy restarts the rooms. It never writes into a folder a local build watches and
// never touches dist/public, so it runs in the pre-deploy gate beside the other suites' Workers
// (.github/scripts/predeploy-steps.mjs).
//
//   - The Floor, in the lobby: two phones are older; it is a safe point, so each reloads once,
//     by itself, back in its own seat, asking /api/ no more than a reload may
//     (site/test/release-budget.js). A phone in full screen reloads by itself too, and its next
//     tap takes it back into full screen. A big screen does not reload by itself: it shows "New
//     version, tap to load" in its bottom bar, and the tap loads it.
//   - Protocol, the newer side: a page of a newer protocol than its room, whose own build
//     /api/version calls live, shows the notice in the bottom bar, is never let go and never
//     reloads; stills of it in both looks and at every size. Once the room's build is the live
//     one, the page reloads into it.
//   - Protocol, the older side: a page of an older protocol is let go at once in the lobby and
//     reloads into its seat speaking the room's.
//   - The Floor, a game in progress (over sockets, as pages of another build): the count makes the
//     room busy and one called off makes it safe again; nothing more is said while the game is
//     played, and it is safe once it is over; a page of an older protocol plays on and is let go
//     only then.
//   - The Table, in a game (Count to ten, turn-based: it outlives the restart): the phones show
//     "New version ready after this round" and do not reload; when the host ends
//     the game, each reloads once, back in its seat.
//   - The front page and Hot Potato, shown again after a deploy (Hot Potato only on its start screen).
//   - A rollback: the build before comes back, and the pages go back to it, once each.
//   - Blocked storage: a page whose browser keeps no session storage could not come back to its
//     seat after a reload: it says the new version loads the next time it joins, and stays seated.
//   - No page reloads twice for one build, none runs modules of two builds, none reports an error.
//
//   node lobby/test/e2e-release.mjs [--port=9540] [--out=/tmp/party-games-release-test]
//
// --out holds the builds and the Worker's storage (removed at the end) and the stills (kept, in
// <out>/shots). The browser is headless, muted, and draws in software.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browser.mjs";
import { partyApi, sleep } from "./client.mjs";
import { COUNT_MS } from "../shared/vote.js";
import { boxCentre } from "../shared/world.js";
import { API_REQUESTS_PER_RELOAD } from "../../site/test/release-budget.js";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = Number(opt("port", "9540"));
const OUT = resolve(opt("out", "/tmp/party-games-release-test"));
const base = `http://localhost:${port}`;
// The lines site/release-switch.js shows (it imports /release.js, so this script cannot import it).
const NOTICE = "New version ready after this round";
const TAP_NOTICE = "New version, tap to load";
const BEHIND_NOTICE = "New version ready, room catching up";
const STAY_NOTICE = "New version next time you join";
const SESSION = "party-kit:session:/api/lobby";
/** A build id no deploy makes: what a page "of another build" says it is, where a test needs one. */
const FAKE = "0123456789ab";
const PHONE_UA = "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(OUT, "run-"));
const shots = join(OUT, "shots");
mkdirSync(shots, { recursive: true });
const persist = join(work, "state");

const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const section = (name) => console.log(`\n     -- ${name}`);

// ---------------------------------------------------------------- the Worker, and deploys to it

const { unstable_readConfig } = await import("wrangler");
const local = unstable_readConfig({ config: join(ROOT, "wrangler.jsonc"), env: "local" });

/** Builds the site for `salt` into a folder of its own; returns {dir, id}. */
function buildFor(salt) {
  const dir = join(work, `build-${salt}`);
  execFileSync(process.execPath, [join(ROOT, "scripts", "build-public.mjs"), "--preview", `--out=${dir}`, `--salt=${salt}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const id = /"id":"([0-9a-f]{12})"/.exec(readFileSync(join(dir, "release.js"), "utf8"))[1];
  return { dir, id };
}

/**
 * The Worker's settings for a build: the local environment's (wrangler.jsonc, env.local), with
 * no build step (nothing is rebuilt or watched), its static files and its release record from
 * the build's own folder, and `vars` added to the local ones.
 */
function configFor({ dir }, vars = {}) {
  const abs = (path) => resolve(ROOT, path);
  const config = {
    name: "n8-party-games-release-test",
    main: abs(local.main ?? "worker.js"),
    compatibility_date: local.compatibility_date,
    compatibility_flags: local.compatibility_flags,
    alias: { ...Object.fromEntries(Object.entries(local.alias ?? {}).map(([k, v]) => [k, abs(v)])), "n8-party-games/release": join(dir, "release.js") },
    assets: { directory: join(dir, "public"), binding: local.assets.binding, run_worker_first: local.assets.run_worker_first },
    version_metadata: local.version_metadata,
    durable_objects: local.durable_objects,
    migrations: local.migrations,
    vars: { ...local.vars, ...vars },
  };
  const path = join(dir, "wrangler.json");
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
}

/** The build the live site serves now. */
async function live() {
  const res = await fetch(`${base}/api/version`, { cache: "no-store" });
  return (await res.json()).release;
}

let worker = null;
/** Starts the Worker on `build`, in a process group of its own, and waits until /api/version names it. */
async function startWorker(build, vars) {
  const wrangler = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  const child = spawn(process.execPath, [wrangler, "dev", "--config", configFor(build, vars), "--local", "--port", String(port), "--persist-to", persist], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
  });
  let log = "";
  const keep = (d) => (log = (log + d).slice(-8000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  let died = false;
  child.on("exit", () => (died = true));
  worker = { child, log: () => log };
  for (const until = Date.now() + 120_000; Date.now() < until && !died; ) {
    if ((await live().catch(() => null)) === build.id) return;
    await sleep(300);
  }
  throw new Error(`the local Worker did not come up on ${base} with build ${build.id}:\n${log.split("\n").slice(-20).join("\n")}`);
}

/** Stops the Worker, workerd included (its whole process group). */
async function stopWorker() {
  if (!worker) return;
  const group = -worker.child.pid;
  const alive = () => {
    try {
      process.kill(group, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    process.kill(group, "SIGTERM");
  } catch {}
  for (const until = Date.now() + 8000; alive() && Date.now() < until; ) await sleep(100);
  if (alive())
    try {
      process.kill(group, "SIGKILL");
    } catch {}
  for (const until = Date.now() + 5000; alive() && Date.now() < until; ) await sleep(100);
  worker = null;
}

// The Worker runs in a process group of its own (so it can be stopped whole), which a signal to
// this script's group does not reach: however this script ends (the gate stopping it with
// SIGTERM, Ctrl-C, a crash), the Worker's group is killed with it and its storage removed.
process.on("exit", () => {
  if (worker)
    try {
      process.kill(-worker.child.pid, "SIGKILL");
    } catch {}
  rmSync(work, { recursive: true, force: true });
});
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) process.on(signal, () => process.exit(code));

const builds = new Map();
/** A deploy of the build for `salt` (built the first time; deployed again later, a rollback), with `vars`. Returns its id. */
async function deploy(salt, vars = {}) {
  if (!builds.has(salt)) builds.set(salt, buildFor(salt));
  await stopWorker();
  await startWorker(builds.get(salt), vars);
  return builds.get(salt).id;
}

const { call, connect } = partyApi(base);
const browser = await launchBrowser({ software: true });
const errors = [];
try {
  const first = await deploy("s1");
  console.log(`     the Worker is up on ${base} with build ${first}`);

  /** A page in a context of its own; every main-frame load, navigation and request to /api/ is counted. */
  async function open(name, { width = 390, height = 844, mobile = true, init = null } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile, ...(mobile && { userAgent: PHONE_UA }) });
    if (init) await context.addInitScript(init);
    // Whether the release line ever showed on this tab, remembered across its reloads (a check
    // made after a reload could not see a line the old page showed and took away).
    await context.addInitScript(() => {
      new MutationObserver(() => {
        if (!document.querySelector(".status-release, .release-note")) return;
        try {
          sessionStorage.setItem("e2e:saw-release-line", "1");
        } catch {}
      }).observe(document, { childList: true, subtree: true });
    });
    const page = await context.newPage();
    page.label = name;
    page.loads = 0;
    page.api = [];
    page.navs = [];
    page.on("load", () => (page.loads += 1));
    page.on("request", (r) => {
      // A new document in the main frame (a load or a reload; not a history change within the page).
      if (r.isNavigationRequest() && r.frame() === page.mainFrame()) page.navs.push(Date.now());
    });
    // Requests to /api/ that really went to the network (the zone's rule counts only those): one
    // served from the browser's cache is not counted. Read from the browser itself (CDP).
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    const fromCache = new Set();
    const sent = new Map();
    cdp.on("Network.requestWillBeSent", (e) => new URL(e.request.url).pathname.startsWith("/api/") && sent.set(e.requestId, e.request.url));
    cdp.on("Network.requestServedFromCache", (e) => fromCache.add(e.requestId));
    cdp.on("Network.responseReceived", (e) => {
      if (!sent.has(e.requestId) || fromCache.has(e.requestId) || e.response.fromDiskCache || e.response.fromServiceWorker || e.response.fromPrefetchCache) return;
      page.api.push({ at: Date.now(), url: sent.get(e.requestId) });
    });
    cdp.on("Network.webSocketCreated", (e) => new URL(e.url).pathname.startsWith("/api/") && page.api.push({ at: Date.now(), url: e.url }));
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebSocket connection/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
    return page;
  }
  /** The build a page is running: its own copy of /release.js (a module is fetched once per page load). */
  const buildOf = (page) => page.evaluate(async () => (await import("/release.js")).RELEASE.id);
  const sessionOf = (page) => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "null"), SESSION).catch(() => null);
  /** The page is shown again, as when a phone is unlocked. */
  const shownAgain = (page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  /** Waits until the page has reloaded into build `id` (a new load, and its /release.js is that build). */
  async function reloadedInto(page, id, loads, ms = 60_000) {
    for (const until = Date.now() + ms; Date.now() < until; ) {
      if (page.loads > loads) {
        try {
          if ((await buildOf(page)) === id) return true;
        } catch {
          // Mid-navigation.
        }
      }
      await page.waitForTimeout(200);
    }
    return false;
  }
  /** The release line in the Floor's bottom bar, or null; `tap` says whether it is a button. */
  const barNote = (page) =>
    page.evaluate(() => {
      const el = document.querySelector(".status-release");
      return el ? { text: el.textContent, tap: el.localName === "button" } : null;
    });
  const waitBarNote = (page, text, ms = 30_000) =>
    page.waitForFunction((t) => document.querySelector(".status-release")?.textContent === t, text, { timeout: ms }).then(
      () => true,
      () => false,
    );
  /** Joins the party with `pin` on the Floor as `name`; `query` is more of the address. */
  async function joinParty(page, pin, name, query = "&look=flat") {
    await page.goto(`${base}/lobby/?join=${pin}${query}`);
    await page.fill("input[name=nickname]", name);
    await page.click("button[type=submit]");
    await page.waitForSelector(".bar", { timeout: 90_000 });
  }
  /** The page is told its build is FAKE, and (with `live`) that FAKE is the live one: a page of another build, made in the test. */
  async function pretend(page, { live: says = false } = {}) {
    await page.context().route(`${base}/release.js`, async (route) => {
      const res = await route.fetch();
      // Never kept by the browser: with the real file's ETag, a reload after the test stops
      // pretending would revalidate it, get a 304, and run this copy again.
      const body = (await res.text()).replace(/"id":"[0-9a-f]{12}"/, `"id":"${FAKE}"`);
      await route.fulfill({ status: 200, contentType: "text/javascript", headers: { "cache-control": "no-store" }, body });
    });
    if (says) await page.context().route(`${base}/api/version`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, release: FAKE }) }));
  }
  const unpretend = (page) => page.context().unrouteAll({ behavior: "ignoreErrors" });
  /** The /api/ requests a page made since its document was last loaded. */
  const apiSinceNav = (page) => page.api.filter((r) => r.at >= (page.navs.at(-1) ?? 0));
  /** A socket that says its build (FAKE: another one) and `protocol` in its hello, as a page of another build does. */
  async function pageSocket(session, protocol = "2") {
    const c = connect(session, { hello: false });
    await c.opened;
    c.ws.send(JSON.stringify({ t: "hello", token: session.token, release: FAKE, protocol }));
    // It says nothing else on its own: the keep-alive a page sends, so the room does not let it go.
    const alive = setInterval(() => c.ws.readyState === 1 && c.ws.send("ping"), 10_000);
    void c.closed.then(() => clearInterval(alive));
    return c;
  }

  // ================================================================ the Floor, in the lobby
  section("the Floor in the lobby: phones reload by themselves, one in full screen too; a big screen offers the tap");
  const ann = await open("Ann");
  await ann.goto(`${base}/lobby/?start&look=flat`);
  await ann.fill("input[name=nickname]", "Ann");
  await ann.click("button[type=submit]");
  await ann.waitForSelector(".bar", { timeout: 90_000 });
  const pin = (await sessionOf(ann)).pin;
  const bo = await open("Bo", { width: 844, height: 390 });
  await joinParty(bo, pin, "Bo");
  // A second party: its big screen, and a phone that went fullscreen as it joined.
  const tv = await open("TV", { width: 1280, height: 720, mobile: false });
  await tv.goto(`${base}/lobby/?start&as=screen&look=flat`);
  await tv.click("button[type=submit]");
  await tv.waitForSelector(".bar", { timeout: 90_000 });
  const tvPin = (await sessionOf(tv)).pin;
  const fay = await open("Fay", { width: 844, height: 390 });
  await joinParty(fay, tvPin, "Fay", "&look=flat&full=on");
  check(await fay.evaluate(() => !!document.fullscreenElement), "Fay's phone went fullscreen as she joined");
  check((await buildOf(ann)) === first && (await buildOf(tv)) === first, `the pages run the live build (${first})`);
  const seats = { Ann: await sessionOf(ann), Bo: await sessionOf(bo), TV: await sessionOf(tv), Fay: await sessionOf(fay) };
  const loads = { Ann: ann.loads, Bo: bo.loads, TV: tv.loads, Fay: fay.loads };

  const second = await deploy("s2");
  console.log(`     deployed: ${first} -> ${second}`);
  for (const [name, page] of [["Ann", ann], ["Bo", bo], ["Fay (full screen)", fay]]) {
    const key = name.split(" ")[0];
    check(await reloadedInto(page, second, loads[key]), `${name}'s phone reloaded itself into the new build`);
    await page.waitForSelector(".bar", { timeout: 60_000 });
    const now = await sessionOf(page);
    check(now?.token === seats[key].token && now?.seat === seats[key].seat, `${name} is back in the same seat (${seats[key].seat}) with the same session`);
    check(!(await page.evaluate(() => sessionStorage.getItem("e2e:saw-release-line"))), `${name} never saw the notice, before or after the reload: the lobby is a safe point`);
  }
  // The reload took Fay's phone out of full screen; her next tap anywhere takes it back in.
  check(!(await fay.evaluate(() => !!document.fullscreenElement)), "the reload took Fay's phone out of full screen");
  await fay.tap(".bar .status");
  check(await fay.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 }).then(() => true, () => false), "and her next tap took it back into full screen");
  check(await waitBarNote(tv, TAP_NOTICE), `the big screen shows "${TAP_NOTICE}"`);
  check((await barNote(tv))?.tap === true, "the big screen's line is a button");
  // The repo's rule for every tap target: at least 44 pixels each way. Its words take the tap, in a
  // row of their own: inside the bar, under the bar's other words, never over them.
  const target = await tv.evaluate(() => {
    const words = document.querySelector(".status-release > span").getBoundingClientRect();
    const button = document.querySelector(".status-release").getBoundingClientRect();
    const bar = document.querySelector(".bar").getBoundingClientRect();
    const above = [...document.querySelectorAll(".bar .status > :not(.status-release)")].map((el) => el.getBoundingClientRect());
    const hit = document.elementFromPoint(words.left + words.width / 2, words.top + 3);
    return {
      words: [Math.round(words.width), Math.round(words.height)],
      button: [Math.round(button.width), Math.round(button.height)],
      inBar: words.top >= bar.top - 1 && words.bottom <= bar.bottom + 1,
      clear: above.every((r) => r.bottom <= words.top + 1),
      takes: !!hit?.closest(".status-release"),
    };
  });
  check(target.words[0] >= 44 && target.words[1] >= 44 && target.button[1] >= 44, `its tap target is at least 44 pixels (its words ${target.words.join("x")}, the button ${target.button.join("x")})`);
  check(target.inBar && target.clear && target.takes, "inside the bar, under the bar's other words and not over them, and its top edge takes the tap");
  await tv.screenshot({ path: join(shots, "release-tap-screen-1280x720.png") });
  await ann.waitForTimeout(4000);
  check(tv.loads === loads.TV, "the big screen did not reload by itself");
  check(ann.loads === loads.Ann + 1 && bo.loads === loads.Bo + 1 && fay.loads === loads.Fay + 1, `each phone reloaded exactly once (Ann ${ann.loads - loads.Ann}, Bo ${bo.loads - loads.Bo}, Fay ${fay.loads - loads.Fay})`);
  for (const [name, page] of [["Ann", ann], ["Bo", bo]]) {
    const asked = apiSinceNav(page);
    check(asked.length <= API_REQUESTS_PER_RELOAD, `${name}'s reload asked /api/ ${asked.length} time(s), within the ${API_REQUESTS_PER_RELOAD} a reload may (${asked.map((r) => new URL(r.url).pathname).join(", ")})`);
  }
  // The tap loads it, back in the same seat.
  await tv.click(".status-release > span");
  check(await reloadedInto(tv, second, loads.TV), "the tap on the big screen loads the new build");
  await tv.waitForSelector(".bar", { timeout: 60_000 });
  check((await sessionOf(tv))?.token === seats.TV.token, "and the big screen is back as the party's screen");
  await tv.context().close();
  await fay.context().close();

  // ================================================================ protocol: the newer side
  section("a page of a newer protocol than its room: the notice in the bottom bar, never let go, never reloaded");
  const hal = await call("POST", "/rooms", { nickname: "Hal" });
  const halSocket = connect(hal);
  await halSocket.opened;
  const sizes = [
    ["390x844", { width: 390, height: 844 }, "flat"],
    ["844x390", { width: 844, height: 390 }, "flat"],
    ["1024x768", { width: 1024, height: 768, mobile: false }, "flat"],
    ["390x844-3d", { width: 390, height: 844 }, "3d&gl=any"],
    ["844x390-3d", { width: 844, height: 390 }, "3d&gl=any"],
  ];
  const newer = [];
  const hosts = [];
  for (const [size, viewport, look] of sizes) {
    const page = await open(`Nia ${size}`, viewport);
    await pretend(page, { live: true });
    // The first in Hal's party (Oto joins it below), each other in a party of its own: a party has four places.
    let party = hal;
    if (newer.length) {
      party = await call("POST", "/rooms", { nickname: `H${newer.length}` });
      const host = connect(party);
      await host.opened;
      hosts.push(host);
    }
    await joinParty(page, party.pin, `N${newer.length}`, `&look=${look}&protocol=3`);
    newer.push([size, page]);
  }
  for (const [size, page] of newer) {
    check(await waitBarNote(page, BEHIND_NOTICE), `${size}: "${BEHIND_NOTICE}" is a line of the bottom bar`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, `release-notice-${size}.png`) });
    // One line, inside the bar, clear of the corner's buttons.
    const fit = await page.evaluate(() => {
      const el = document.querySelector(".status-release");
      const note = el.getBoundingClientRect();
      const bar = document.querySelector(".bar").getBoundingClientRect();
      const corner = [...document.querySelectorAll(".corner, .door-btn")].map((c) => c.getBoundingClientRect());
      const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      return { height: note.height, line: parseFloat(getComputedStyle(el).lineHeight), whole: el.scrollWidth <= el.clientWidth, inBar: note.top >= bar.top - 1 && note.bottom <= bar.bottom + 1, clear: corner.every((c) => !overlaps(note, c)) };
    });
    check(fit.inBar && fit.clear && fit.height <= fit.line + 2 && fit.whole, `${size}: one whole line (${Math.round(fit.height)} px${fit.whole ? "" : ", cut short"}), inside the bar, clear of the corner's buttons`);
  }
  const nia = newer[0][1];
  await nia.waitForTimeout(6000);
  check(
    newer.every(([, page]) => page.loads === 1),
    "no page of the newer protocol reloaded",
  );
  check(await nia.evaluate(() => location.pathname === "/lobby/" && !!document.querySelector(".bar")), "and the room did not let it go");
  for (const [, page] of newer.slice(1)) await page.context().close();
  for (const host of hosts) host.ws.close();
  // The room's build becomes the live one (the page's own is not any more): the page goes to it, once.
  await unpretend(nia);
  await nia.waitForTimeout(11_000); // the last answer from /api/version is kept ten seconds (ASK_AGAIN_MS)
  await shownAgain(nia);
  check(await reloadedInto(nia, second, 1, 45_000), "once the room's build is the live one, the page reloads into it");
  await nia.waitForSelector(".bar", { timeout: 60_000 });
  check(!(await barNote(nia)), "and its notice is gone");
  await nia.context().close();

  // ================================================================ protocol: the older side
  section("a page of an older protocol: let go at once in the lobby, back in its seat speaking the room's");
  const oto = await open("Oto", { width: 844, height: 390 });
  await oto.goto(`${base}/lobby/?join=${hal.pin}&look=flat&protocol=1`);
  await oto.fill("input[name=nickname]", "Oto");
  await oto.click("button[type=submit]");
  check(await reloadedInto(oto, second, 1, 30_000), "the room let the older page go, and it reloaded");
  await oto.waitForSelector(".bar", { timeout: 60_000 });
  await oto.waitForTimeout(3000);
  check(oto.loads === 2, `it reloaded once (${oto.loads - 1})`);
  check(!!(await sessionOf(oto))?.token && (await oto.evaluate(() => !location.search.includes("protocol"))), "back in its seat, its address without the test protocol");
  await oto.context().close();
  halSocket.ws.close();

  // ================================================================ the Floor, a game in progress
  section("the Floor, a game in progress (over sockets): busy and safe said both ways; an older protocol let go after the game");
  const mab = await call("POST", "/rooms", { nickname: "Mabel" });
  const tomSeat = await call("POST", "/join/" + mab.pin, { nickname: "Tom" });
  const mabel = await pageSocket(mab);
  const tom = await pageSocket(tomSeat);
  await mabel.wait((m) => m.t === "hello", 8000, 0);
  await tom.wait((m) => m.t === "hello", 8000, 0);
  await mabel.wait((m) => m.room?.members.filter((x) => x?.connected).length === 2, 8000, 0);
  const said = (c) => c.seen.filter((m) => m.t === "release").map((m) => m.safe);
  check(mabel.seen.find((m) => m.t === "hello")?.release?.safe === true, "the hello says the room's build and that the lobby is safe");
  const N = mabel.room.boxes.length;
  const coin = mabel.room.boxes.findIndex((b) => b.id === "coin-flip");
  const tomHome = tom.x;
  // A count, called off: busy, then safe again.
  for (const c of [mabel, tom]) c.goto(Math.round(boxCentre(coin, N)));
  await mabel.wait((m) => m.t === "release" && m.safe === false, 8000, 0);
  tom.goto(tomHome);
  await mabel.wait((m) => m.t === "release" && m.safe === true, 8000, 0);
  check(JSON.stringify(said(mabel)) === "[false,true]", `a count that starts says busy, and one called off says safe (${JSON.stringify(said(mabel))})`);
  // The game: busy from the count on, nothing more while it is played, safe once it is over.
  const from = mabel.seen.length;
  tom.goto(Math.round(boxCentre(coin, N)));
  await mabel.wait((m) => m.t === "start", COUNT_MS + 8000, from);
  // A big screen of an older protocol joins in the middle of it: it plays on.
  const old = await pageSocket(await call("POST", "/join/" + mab.pin, { as: "screen" }), "1");
  await old.wait((m) => m.t === "hello", 8000, 0).catch(() => null);
  check((await Promise.race([old.closed, sleep(300).then(() => null)])) === null, "a page of an older protocol is not let go in the middle of a game");
  await mabel.wait((m) => m.t === "end", 20_000, from);
  await mabel.wait((m) => m.t === "release" && m.safe === true, 8000, from);
  check(JSON.stringify(said(mabel)) === "[false,true,false,true]", `the game: busy once, then safe once it is over (${JSON.stringify(said(mabel))})`);
  const closedAfter = await Promise.race([old.closed, sleep(5000).then(() => null)]);
  check(closedAfter?.code === 4000 && closedAfter?.reason === "update_required", `once it is over, the older protocol is let go (${closedAfter ? `${closedAfter.code} ${closedAfter.reason}` : "still open"})`);
  for (const c of [mabel, tom]) c.ws.close();

  // ================================================================ the Table, in a game
  section("the Table, in a game: the notice, no reload until the host ends the game");
  await ann.click(".rooms-btn");
  await ann.waitForSelector(".mode-choice:visible");
  await ann.click(".mode-choice");
  for (const p of [ann, bo]) await p.waitForSelector(".digits", { timeout: 30_000 });
  await ann.evaluate(() => (location.hash = "#dev"));
  await ann.waitForSelector(".game.test button.game-row");
  await ann.click(".game.test button.game-row");
  for (const p of [ann, bo]) await p.waitForSelector(".stage:not([hidden]) .ctt-count", { timeout: 30_000 });
  check(true, "at the Table, Count to ten is on for both");
  const tableSeats = { Ann: await sessionOf(ann), Bo: await sessionOf(bo) };
  const tableLoads = { Ann: ann.loads, Bo: bo.loads };
  const third = await deploy("s3");
  console.log(`     deployed: ${second} -> ${third}`);
  for (const [name, p] of [["Ann", ann], ["Bo", bo]]) {
    const text = await p.waitForFunction(() => document.querySelector(".release-note")?.textContent, null, { timeout: 45_000 }).then(
      (h) => h.jsonValue(),
      () => null,
    );
    check(text === NOTICE, `${name} sees "${NOTICE}" (${JSON.stringify(text)})`);
  }
  check(ann.loads === tableLoads.Ann && bo.loads === tableLoads.Bo, "and nobody reloads while the game is on");
  check((await ann.locator(".stage:not([hidden]) .ctt-count").count()) === 1, "the game is still on Ann's phone");
  const notice = await ann.locator(".release-note").boundingBox();
  await ann.screenshot({ path: join(shots, "release-table-notice-390x844.png") });
  check(notice && notice.height <= 24, `the notice is one small line (${notice ? Math.round(notice.height) : "none"} px)`);
  await ann.click(".stop");
  await ann.click(".confirm .button:not(.quiet)");
  for (const [name, p] of [["Ann", ann], ["Bo", bo]]) {
    check(await reloadedInto(p, third, tableLoads[name]), `the game over: ${name}'s phone reloaded itself into the new build`);
    await p.waitForSelector(".digits", { timeout: 60_000 });
    check((await sessionOf(p))?.token === tableSeats[name].token, `${name} is back at the Table in the same seat`);
    check(!(await p.locator(".release-note").count()), `${name}'s notice is gone`);
  }
  await ann.waitForTimeout(3000);
  check(ann.loads === tableLoads.Ann + 1 && bo.loads === tableLoads.Bo + 1, `each phone reloaded exactly once for this build (Ann ${ann.loads - tableLoads.Ann}, Bo ${bo.loads - tableLoads.Bo})`);

  // ================================================================ outside a room
  section("outside a room: the front page and Hot Potato, shown again");
  const front = await open("front page");
  await front.goto(`${base}/`);
  await front.waitForSelector("#releaseLine:not(:empty)");
  const potato = await open("Hot Potato");
  await potato.goto(`${base}/one-device/hot-potato/`);
  await potato.waitForSelector("#s-start");
  const played = await open("Hot Potato in a round");
  await played.goto(`${base}/one-device/hot-potato/`);
  await played.waitForSelector("#s-start");
  await played.click("#s-start");
  const inRound = await played.waitForFunction(() => document.getElementById("game")?.dataset.screen === "turn", null, { timeout: 20_000 }).then(
    () => true,
    () => false,
  );
  const outside = { front: front.loads, potato: potato.loads, played: played.loads, Ann: ann.loads, Bo: bo.loads };
  const fourth = await deploy("s4");
  console.log(`     deployed: ${third} -> ${fourth}`);
  for (const p of [front, potato, played]) await shownAgain(p);
  check(await reloadedInto(front, fourth, outside.front), "the front page, shown again, reloaded into the new build");
  check((await front.locator("#releaseLine").textContent()).includes(fourth), "and its footer line names it");
  check(await reloadedInto(potato, fourth, outside.potato), "Hot Potato on its start screen, shown again, reloaded into the new build");
  if (inRound) {
    await played.waitForTimeout(4000);
    check(played.loads === outside.played && (await buildOf(played)) === third, "Hot Potato in a round, shown again, did not reload");
  } else console.log("     (Hot Potato did not reach a round in this browser: its in-round check is left out)");
  // The Table's phones were at a safe point: they went too.
  for (const [name, p] of [["Ann", ann], ["Bo", bo]]) check(await reloadedInto(p, fourth, outside[name]), `${name}, at the Table's list, reloaded into it`);
  for (const p of [front, potato]) check((await buildOf(p)) === (await live()), `${p.label} runs one build, the live one`);
  for (const p of [front, potato, played]) await p.context().close();

  // ================================================================ a rollback
  section("a rollback: the build before comes back, and the pages go back to it, once");
  for (const p of [ann, bo]) await p.waitForSelector(".digits", { timeout: 60_000 });
  const rolled = { Ann: ann.loads, Bo: bo.loads };
  const back = await deploy("s3");
  check(back === third, `the rollback serves the build before (${back})`);
  for (const [name, p] of [["Ann", ann], ["Bo", bo]]) {
    check(await reloadedInto(p, third, rolled[name]), `${name} went back to the build before`);
    await p.waitForSelector(".digits", { timeout: 60_000 });
  }
  await ann.waitForTimeout(4000);
  check(ann.loads === rolled.Ann + 1 && bo.loads === rolled.Bo + 1, `once each (Ann ${ann.loads - rolled.Ann}, Bo ${bo.loads - rolled.Bo})`);

  // ================================================================ blocked storage
  section("a browser that keeps no session storage: a reload would cost its seat, so it says the new version loads next time, and stays");
  const blocked = () => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
  };
  const ida = await call("POST", "/rooms", { nickname: "Ida" });
  const idaSocket = connect(ida);
  await idaSocket.opened;
  const blo = await open("Blo", { width: 844, height: 390, init: blocked });
  await joinParty(blo, ida.pin, "Blo");
  const bloLoads = blo.loads;
  const bloSeat = await blo.evaluate(() => document.querySelector(".hud") && !!document.querySelector(".bar"));
  const fifth = await deploy("s5");
  console.log(`     deployed: ${back} -> ${fifth}`);
  check(await waitBarNote(blo, STAY_NOTICE, 45_000), `the page shows "${STAY_NOTICE}"`);
  check((await barNote(blo))?.tap === false, "and it is no button: nothing on it reloads the page");
  await blo.waitForTimeout(5000);
  check(blo.loads === bloLoads, "it did not reload by itself");
  // Still in the party, in its seat: its socket came back after the deploy from the session it holds in memory.
  // The room's own view (the local test door): Blo's seat is held and its socket is connected
  // (a name alone would be there for a dropped seat too).
  const roomNow = (await (await fetch(`${base}/api/lobby/debug/${ida.code}`)).json()).room?.view;
  const bloMember = roomNow?.members?.find((m) => m?.name === "Blo");
  check(bloSeat && bloMember?.connected === true && (await blo.evaluate(() => location.pathname === "/lobby/" && !!document.querySelector(".bar"))), `and it is still in the party, in its seat, connected (${JSON.stringify(bloMember && { connected: bloMember.connected })})`);
  idaSocket.ws.close();
  await blo.context().close();

  // ================================================================ one build per page
  section("one build per page");
  for (const [name, p] of [["Ann", ann], ["Bo", bo]]) check(await reloadedInto(p, fifth, 0), `${name}, at the Table's list, reloaded into the last deploy`);
  for (const p of [ann, bo]) {
    const mixed = await p.evaluate(async () => {
      const own = (await import("/release.js")).RELEASE.id;
      const now = (await (await fetch("/api/version", { cache: "no-store" })).json()).release;
      return { own, now };
    });
    check(mixed.own === mixed.now, `${p.label} runs one build, the live one (${mixed.own})`);
  }
  check(!errors.length, `no page reported an error${errors.length ? `: ${errors.slice(0, 5).join(" | ")}` : ""}`);
} catch (err) {
  problems.push(`stopped: ${err.message}`);
  console.log(`FAIL stopped: ${err.stack ?? err.message}`);
  if (worker) console.log(`--- the last lines of the local Worker ---\n${worker.log().split("\n").slice(-15).join("\n")}`);
} finally {
  await browser.close().catch(() => {});
  await stopWorker();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\nstills in ${shots}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("\nall passed");
process.exit(0);
