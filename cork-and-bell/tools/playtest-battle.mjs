// The multiplayer playtest: a full match with four headless players at 150 ms simulated
// latency (each way), one of them dropping and rejoining, then a rematch. Screenshots from
// each player's screen: the lobby, the start, the middle with an attack landing and one
// being blocked, the end, and the rematch.
// Run the local server first (npm run dev), then: npm run playtest:battle
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791/cork-and-bell/");
const out = opt("out", "cork-and-bell/shots/battle");
const lag = Number(opt("lag", 150));
const withScreen = opt("screen", "1") === "1";
mkdirSync(out, { recursive: true });
const names = ["Ann", "Bo", "Cy", "Di"];
const errors = [];
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const players = [];
async function open(name, query, size) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: size.width < 600, isMobile: size.width < 600 });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && !/WebSocket|ERR_/.test(m.text()) && errors.push(name + ": " + m.text()));
  page.on("pageerror", (e) => errors.push(name + ": " + String(e)));
  await page.goto(base + "?" + query);
  await page.waitForFunction(() => window.__cab, null, { timeout: 90000 });
  return { name, page, seen: new Set() };
}
const phone = { width: 390, height: 844 };
const q = (extra) => "auto=1&quality=low&lag=" + lag + "&" + extra;

// The host makes the room; the others join with its PIN.
players.push(await open(names[0], q("host=1&seats=4&name=" + names[0]), phone));
await players[0].page.waitForFunction(() => window.__cab.party.session?.pin, null, { timeout: 20000 });
const pin = await players[0].page.evaluate(() => window.__cab.party.session.pin);
log("room PIN", pin);
for (let i = 1; i < 4; i++) players.push(await open(names[i], q("join=" + pin + "&name=" + names[i]), phone));
let screen = null;
if (withScreen) {
  screen = await open("screen", "quality=low&lag=" + lag, { width: 1600, height: 900 });
  // The shared screen joins through the lobby, as a person would.
  await screen.page.locator("#battle").click();
  await screen.page.locator(".pk-pin-input").fill(pin);
  await screen.page.getByRole("button", { name: "Use this screen as the shared screen" }).click();
}
const all = () => (screen ? [...players, screen] : players);
const shotAll = async (label, list = all()) => {
  for (const p of list) await p.page.screenshot({ path: out + "/" + label + "-" + p.name + ".png" });
};
const room = (p) => p.page.evaluate(() => window.__cab.party.room);
const sum = (p) => p.page.evaluate(() => window.__cab.summary());

// Lobby: everyone seated and ready.
await players[0].page.waitForFunction(() => window.__cab.party.room?.seats.filter((s) => s && s.kind === "human" && s.ready).length === 4, null, { timeout: 30000 }).catch(() => errors.push("four ready players never showed in the lobby"));
await new Promise((r) => setTimeout(r, 700));
await shotAll("1-lobby");
let r = await room(players[0]);
log("lobby:", r.seats.map((s) => s && s.name + (s.ready ? " (ready)" : "")).join(", "), "| screens", r.screens);

// Start.
await players[0].page.waitForFunction(() => window.__cab.mode === "battle", null, { timeout: 30000 }).catch(() => errors.push("the round never started"));
await new Promise((r) => setTimeout(r, 1500));
await shotAll("2-start");

// The middle: watch every player's screen for a warning, a landing and a block.
const want = ["warning", "landed", "blocked"];
const got = {};
let dropped = false;
let rejoined = false;
let dropInfo = "";
const t0 = Date.now();
for (;;) {
  const s = await sum(players[0]).catch(() => null);
  if (!s || s.over) break;
  if (Date.now() - t0 > 150000) {
    errors.push("the round did not end");
    break;
  }
  for (const p of players) {
    const moments = await p.page.evaluate(() => window.__cab.moments.splice(0)).catch(() => []);
    for (const m of moments) {
      const key = m.k + (m.type ? "-" + m.type : "");
      if (!got[key]) {
        got[key] = p.name;
        await new Promise((r) => setTimeout(r, m.k === "warning" ? 500 : 250));
        await p.page.screenshot({ path: out + "/3-middle-" + key + "-" + p.name + ".png" });
        if (screen && (m.k === "landed" || m.k === "blocked") && !got["screen-" + m.k]) {
          got["screen-" + m.k] = true;
          await screen.page.screenshot({ path: out + "/3-middle-" + m.k + "-screen.png" });
        }
      }
    }
  }
  // One player drops for a few seconds and comes back to the same seat.
  if (!dropped && s.t > 22) {
    dropped = true;
    const before = await sum(players[2]);
    await players[2].page.evaluate(() => window.__cab.party.dropConnection({ reconnectAfterMs: 7000 }));
    await new Promise((r) => setTimeout(r, 2500));
    r = await room(players[0]);
    dropInfo = "while away: " + JSON.stringify(r.seats[2] && { name: r.seats[2].name, kind: r.seats[2].kind, away: r.seats[2].away });
    if (!(r.seats[2] && r.seats[2].kind === "bot" && r.seats[2].away)) errors.push("the dropped seat was not held by a stand-in: " + dropInfo);
    await players[2].page.screenshot({ path: out + "/3-middle-dropped-" + players[2].name + ".png" });
    log("drop: Cy dropped at t", before.t, "score", before.stalls[2].score, "|", dropInfo);
  }
  if (dropped && !rejoined && s.t > 36) {
    rejoined = true;
    r = await room(players[0]);
    const mine = await sum(players[2]);
    log("rejoin:", JSON.stringify({ name: r.seats[2].name, kind: r.seats[2].kind, connected: r.seats[2].connected }), "| Cy's own seat", mine.mySeat, "score", mine.stalls[2].score);
    if (!(r.seats[2].kind === "human" && r.seats[2].connected && r.seats[2].name === "Cy")) errors.push("the dropped player did not get the same seat back");
    if (mine.mySeat !== 2) errors.push("the rejoined page lost its seat");
    await players[2].page.screenshot({ path: out + "/3-middle-rejoined-" + players[2].name + ".png" });
  }
  if (!got.mid && s.t > 45) {
    got.mid = true;
    await shotAll("3-middle");
  }
  await new Promise((r) => setTimeout(r, 200));
}
log("moments seen:", JSON.stringify(got));
for (const k of want) if (!Object.keys(got).some((key) => key.startsWith(k))) errors.push("never saw: " + k);
if (!rejoined) errors.push("the drop and rejoin did not complete");

// The end.
await new Promise((r) => setTimeout(r, 1500));
await shotAll("4-end");
const results = [];
for (const p of players) results.push(await p.page.evaluate(() => window.__cab.session.result().map((x) => x.name + " " + x.score).join(", ")));
log("end, as each player sees it:");
results.forEach((line, i) => log("  " + names[i] + ": " + line));
if (new Set(results).size !== 1) errors.push("the players do not agree on the result");
const drift = await Promise.all(players.map((p) => p.page.evaluate(() => window.__cab.party.rtt)));
log("measured round trips (ms):", drift.map((d) => Math.round(d)).join(", "), "(simulated latency " + lag + " ms each way)");

// The rematch: every bot taps Rematch a moment after the end.
await players[0].page.waitForFunction(() => window.__cab.party.room?.round === 2 && window.__cab.mode === "battle" && !window.__cab.session.over, null, { timeout: 30000 }).catch(() => errors.push("the rematch never started"));
await new Promise((r) => setTimeout(r, 5200));
await shotAll("5-rematch");
const s2 = await sum(players[0]);
log("rematch: round 2 at t", s2.t, "scores", s2.stalls.map((x) => x.score).join(", "));
const fps = await Promise.all(all().map((p) => p.page.evaluate(() => window.__cab.fps().fps)));
log("frame rates in this run (software rendering, five pages at once, not a measure of real speed):", fps.join(", "));
log(errors.length ? "FAILED:\n  " + errors.join("\n  ") : "PASSED");
await browser.close();
process.exit(errors.length ? 1 : 0);
