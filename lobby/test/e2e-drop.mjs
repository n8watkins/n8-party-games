// End to end: how quickly a dropped phone shows, fades and comes back.
//
//   node lobby/test/e2e-drop.mjs [--base=http://localhost:8791]
//
// - A phone that is locked (its page hidden) turns grey for everyone within a few seconds, fades
//   with "Nat left" about twelve seconds later, and, shown again within two minutes, is back in
//   its seat as itself, without the way in.
// - A phone whose browser goes offline turns grey as quickly, and comes back when it is online.
// - A phone that loses its signal without a word (a socket that just goes silent) is shown grey
//   at the next thing anyone does after 25 silent seconds.
// It takes about two minutes. A real lock screen and a real lost signal are emulated: see the
// report for what that cannot show.
import { chromium } from "playwright";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const { call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true };

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const timers = [];
try {
  // A party: a socket that watches (and moves now and then), and a phone.
  const w = await call("POST", "/rooms", { nickname: "Wes" });
  const W = connect(w);
  await W.opened;
  await W.wait((m) => m.t === "hello", 5000, 0);
  timers.push(setInterval(() => W.send("ping"), 10_000));
  const ctx = await browser.newContext(PHONE);
  const nat = await ctx.newPage();
  await nat.goto(`${base}/lobby/?join=${w.pin}`);
  await nat.fill("input[name=nickname]", "Nat");
  await nat.tap("button[type=submit]");
  await nat.waitForSelector(".bar");
  await W.wait((m) => m.room?.members[1]?.connected, 5000, 0);
  const seatOf = () => W.room.members.findIndex((m) => m?.name === "Nat");
  const hide = (hidden) =>
    nat.evaluate((h) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);

  // ---------------------------------------------------------------- locked
  let mark = W.seen.length;
  let t0 = Date.now();
  await hide(true);
  const grey = await W.wait((m) => m.t === "room" && m.room.members[1] && m.room.members[1].connected === false, 8000, mark).catch(() => null);
  const greyIn = Date.now() - t0;
  check(!!grey && greyIn < 3000, `a locked phone's piece turns grey for everyone in ${greyIn} ms`);
  const left = await W.wait((m) => m.t === "note" && m.k === "left" && m.name === "Nat", 20_000, mark).catch(() => null);
  const leftIn = Date.now() - t0;
  check(!!left && leftIn > 11_000 && leftIn < 15_000, `it fades with "Nat left" ${(leftIn / 1000).toFixed(1)} s after it dropped`);
  await sleep(8000);
  mark = W.seen.length;
  t0 = Date.now();
  await hide(false);
  const back = await W.wait((m) => m.t === "room" && m.room.members.some((x) => x?.name === "Nat" && x.connected), 8000, mark).catch(() => null);
  check(!!back && seatOf() === 1, `shown again ${((Date.now() - t0) / 1000).toFixed(1)} s later and 20 s after the lock, it is back in its seat as itself`);
  check(nat.url().startsWith(base + "/lobby/") && (await nat.locator(".bar").count()) === 1, "and the phone is in the room, not at the way in");

  // ---------------------------------------------------------------- offline
  mark = W.seen.length;
  t0 = Date.now();
  await ctx.setOffline(true);
  const off = await W.wait((m) => m.t === "room" && m.room.members[1]?.connected === false, 8000, mark).catch(() => null);
  check(!!off && Date.now() - t0 < 3000, `a phone whose browser goes offline turns grey in ${Date.now() - t0} ms`);
  await sleep(1500);
  check(/Reconnecting/.test(await nat.locator(".link-state").textContent().catch(() => "")), "and its own page says it is reconnecting");
  mark = W.seen.length;
  await ctx.setOffline(false);
  const on = await W.wait((m) => m.t === "room" && m.room.members[1]?.connected === true, 10_000, mark).catch(() => null);
  check(!!on, "online again, it is back at once");

  // ---------------------------------------------------------------- a signal that goes without a word
  const s = await call("POST", "/join/" + w.pin, { nickname: "Sil" });
  const S = connect(s, { keepAlive: false });
  await S.opened;
  await W.wait((m) => m.room?.members[s.seat]?.connected, 5000, 0);
  // From here S sends nothing, not even the keep-alive, and never closes: a phone out of signal.
  mark = W.seen.length;
  t0 = Date.now();
  let silent = null;
  for (let i = 0; i < 25 && !silent; i++) {
    await sleep(2000);
    W.goto(W.x + (i % 2 ? 20 : -20)); // someone in the room does something now and then
    silent = W.seen.slice(mark).find((m) => m.t === "room" && m.room.members[s.seat]?.connected === false);
  }
  const silentIn = Date.now() - t0;
  check(!!silent && silentIn >= 20_000 && silentIn < 36_000, `a phone that goes silent is shown grey ${(silentIn / 1000).toFixed(1)} s later, at the next thing anyone did`);
  S.ws.close();
} finally {
  for (const t of timers) clearInterval(t);
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.");
process.exit(problems.length ? 1 : 0);
