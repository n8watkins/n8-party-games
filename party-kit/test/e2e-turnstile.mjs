// End to end: the bot check on new rooms, with Cloudflare's public Turnstile TEST keys (they never
// guard anything real). Two local servers, one whose secret always passes and one whose secret
// always fails; both hand out the always-pass site key, so the failing one proves the server
// enforces the check on its own:
//
//   npx wrangler dev --local --env local --port 8805 --persist-to <empty folder> \
//     --var TURNSTILE_SITE_KEY:1x00000000000000000000AA --var TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA
//   npx wrangler dev --local --env local --port 8806 --persist-to <another empty folder> \
//     --var TURNSTILE_SITE_KEY:1x00000000000000000000AA --var TURNSTILE_SECRET_KEY:2x0000000000000000000000000000000AA
//   node party-kit/test/e2e-turnstile.mjs --pass=http://localhost:8805 --fail=http://localhost:8806 [--browser=1]
//
// Test keys: https://developers.cloudflare.com/turnstile/troubleshooting/testing/
// It needs the network (the widget and siteverify are Cloudflare's), so it is not one of the
// pre-deploy gate's steps, which must not.
//
// With --browser=1 it also makes a room through the lobby in a real browser (the widget renders
// and hands over its token) and joins it by PIN from a second page that never loads Turnstile.
//
// With --lobby=1 (the party site only: a game's own repository has no party room) it goes through
// the party room's own way in (/lobby/) as a player would, on phones and a big screen:
//   - making a party passes the check without a click and sends its token once, under the site's
//     CSP with no violation; a reload of the host's page or of the big screen is not checked again;
//   - joining by code, as a player or as the big screen, never loads Turnstile;
//   - on the failing server the page says "Could not check you are a person. Try again." and the
//     button works again; trying again checks again with a fresh token;
//   - when Turnstile's script never answers, is blocked, or is not Turnstile, the page says so,
//     sends no room request and gives the button back, and the next try loads it afresh.
// --fail=skip leaves out the failing-secret checks, so the two below can each run beside the
// passing server alone. Two more servers may be named for it:
//   --failsite=<base>  a server handing out the always-FAIL site key 2x00000000000000000000AB (with
//                      the passing secret): the widget itself refuses, and no room request is sent;
//   --off=<base>       a server with neither key: nothing loads from Turnstile and parties are made.
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const passBase = opt("pass", "http://localhost:8805");
const failBase = opt("fail", "http://localhost:8806");
const failSiteBase = opt("failsite", "");
const offBase = opt("off", "");
const browser = opt("browser", "0") === "1";
const lobby = opt("lobby", "0") === "1";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX"; // what the test site keys hand out
const REFUSED = "Could not check you are a person. Try again.";
// What client/bot-check.js says when its script is blocked, or never answers (in 15 seconds).
const BOT_BLOCKED = "Could not check you are a person. A content blocker may be stopping the check. Try again, or join a party with a code instead.";
const BOT_STALLED = "Could not check you are a person: the check did not load. Check the connection and try again.";
const problems = [];
const say = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const post = (base, path, body) =>
  fetch(base + "/api/party" + path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", "X-Party-Protocol": "2" } }).then(async (r) => ({ status: r.status, ...(await r.json()) }));

const config = await (await fetch(passBase + "/api/party/config")).json();
say(config.turnstileSiteKey === "1x00000000000000000000AA", "the server hands out the site key");

// The always-pass secret.
const none = await post(passBase, "/rooms", { nickname: "Ann" });
say(none.status === 403 && none.error === "bot_check", `no token, no room (${none.status} ${none.error})`);
const ok = await post(passBase, "/rooms", { nickname: "Ann", turnstile: DUMMY_TOKEN });
say(ok.status === 201 && /^\d{4}$/.test(ok.pin), `with a passing token the room is made (${ok.status})`);
const screen = await post(passBase, "/rooms", { as: "screen" });
say(screen.status === 403, `a shared screen making a room needs it too (${screen.status})`);
const joined = await post(passBase, "/join/" + ok.pin, { nickname: "Bo" });
say(joined.ok && joined.seat === 1, "joining by PIN needs no bot check");
const preview = await (await fetch(passBase + "/api/party/join/" + ok.pin)).json();
say(preview.ok, "nor does looking a PIN up");

// The always-fail secret: the same dummy token is refused.
if (failBase !== "skip") {
  const refused = await post(failBase, "/rooms", { nickname: "Cy", turnstile: DUMMY_TOKEN });
  say(refused.status === 403 && refused.error === "bot_check", `with a failing secret the room is refused (${refused.status} ${refused.error})`);
  say(refused.message === REFUSED, `and the message gives nothing away and says to try again: "${refused.message}"`);
}

if (browser || lobby) {
  const { chromium } = await import("playwright");
  // Stays on Playwright's own software launch, not lobby/test/browser.mjs: this file ships with the kit to game repos, which have no lobby.
  const b = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"] });
  try {
    if (browser) await kitLobby(b);
    if (lobby) await partyRoom(b);
  } finally {
    await b.close();
  }
}

/** A game's own page (Cork & Bell's), with the kit's lobby. */
async function kitLobby(b) {
  const host = await b.newPage();
  const hostErrors = [];
  host.on("pageerror", (e) => hostErrors.push(String(e)));
  await host.goto(passBase + "/cork-and-bell/?quality=low", { waitUntil: "domcontentloaded", timeout: 90000 });
  await host.waitForFunction(() => window.__cab, null, { timeout: 90000 });
  // The game's page draws its 3D look in software here: on a busy machine its button can take a while.
  await host.locator("#battle").click({ timeout: 90000 });
  await host.locator(".pk-door input.pk-input").first().fill("Host");
  const sentToken = host.waitForRequest((r) => r.url().endsWith("/api/party/rooms") && r.method() === "POST", { timeout: 60000 });
  await host.getByRole("button", { name: "Make a room" }).click();
  const body = JSON.parse((await sentToken).postData() ?? "{}");
  say(body.turnstile === DUMMY_TOKEN, "in the browser the widget hands its token to the room request");
  await host.waitForFunction(() => window.__cab.party.session?.pin, null, { timeout: 30000 });
  const pin = await host.evaluate(() => window.__cab.party.session.pin);
  say(/^\d{4}$/.test(pin) && hostErrors.length === 0, `the room is made through the lobby (PIN ${pin}, page errors: ${hostErrors.length})`);

  const guest = await b.newPage();
  const turnstileLoads = [];
  guest.on("request", (r) => r.url().startsWith("https://challenges.cloudflare.com") && turnstileLoads.push(r.url()));
  await guest.goto(passBase + "/cork-and-bell/?quality=low&join=" + pin, { waitUntil: "domcontentloaded", timeout: 90000 });
  await guest.waitForFunction(() => window.__cab, null, { timeout: 90000 });
  if (!(await guest.locator(".pk-door").isVisible())) await guest.locator("#battle").click({ timeout: 90000 });
  await guest.locator(".pk-door input.pk-input").first().fill("Guest");
  await guest.locator(".pk-pin-input").fill(pin);
  await guest.getByRole("button", { name: "Join with PIN" }).click();
  await guest.waitForFunction(() => window.__cab.party.session?.seat >= 0, null, { timeout: 30000 });
  say(turnstileLoads.length === 0, `a friend joins by PIN in one step, and Turnstile never loads on their page (${turnstileLoads.length} requests)`);
  await host.close();
  await guest.close();
}

/** The party room's own way in (/lobby/), on phones and a big screen. */
async function partyRoom(b) {
  const PHONE = { viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const SCREEN = { viewport: { width: 1280, height: 720 } };
  /** A fresh device, with what it asked Turnstile and the room API for, and any CSP refusal or page error. */
  async function device(kind) {
    const context = await b.newContext(kind);
    const page = await context.newPage();
    const seen = { turnstile: [], creates: [], csp: [], errors: [] };
    page.on("request", (r) => {
      if (r.url().startsWith("https://challenges.cloudflare.com")) seen.turnstile.push(r.url());
      if (r.url().endsWith("/api/lobby/rooms") && r.method() === "POST") seen.creates.push(JSON.parse(r.postData() ?? "{}"));
    });
    page.on("console", (m) => /Content Security Policy/i.test(m.text()) && seen.csp.push(m.text()));
    page.on("pageerror", (e) => seen.errors.push(String(e)));
    return { page, seen };
  }
  const inRoom = (page) => page.waitForSelector(".bar", { timeout: 60000 });
  const session = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("party-kit:session:/api/lobby") ?? "null"));
  /** Waits until the door has answered: in the room, or an error line shown. */
  const answered = (page) => page.waitForFunction(() => document.querySelector(".bar") || (document.querySelector(".door-error") && !document.querySelector(".door-error").hidden), null, { timeout: 60000 });

  // A phone starts a party: no click on any widget, one token sent.
  const host = await device(PHONE);
  await host.page.goto(passBase + "/lobby/?start");
  await host.page.fill("input[name=nickname]", "Host");
  await host.page.tap("button[type=submit]");
  await inRoom(host.page);
  const made = await session(host.page);
  say(/^\d{4}$/.test(made?.pin ?? "") && host.seen.creates.length === 1 && host.seen.creates[0].turnstile === DUMMY_TOKEN, `a phone starts a party with one tap; the check hands its token to the one room request (PIN ${made?.pin})`);
  say(host.seen.turnstile.length > 0 && host.seen.csp.length === 0 && host.seen.errors.length === 0, `Turnstile ran under the site's CSP with no refusal (${host.seen.turnstile.length} requests, CSP: ${host.seen.csp.join(" | ") || "none"}, errors: ${host.seen.errors.length})`);
  say(await host.page.locator(".botcheck").isHidden(), "and its box is gone again once it passed");

  // A reload of the host's page comes back to the same party, unchecked.
  const before = { turnstile: host.seen.turnstile.length, creates: host.seen.creates.length };
  await host.page.reload();
  await inRoom(host.page);
  say(host.seen.turnstile.length === before.turnstile && host.seen.creates.length === before.creates && (await session(host.page))?.code === made.code, "a reload of the host's phone is the same party, with no check and no new room");

  // Joining by code: a phone, and the big screen.
  const guest = await device(PHONE);
  await guest.page.goto(`${passBase}/lobby/?join=${made.pin}`);
  await guest.page.fill("input[name=nickname]", "Guest");
  await guest.page.tap("button[type=submit]");
  await inRoom(guest.page);
  say(guest.seen.turnstile.length === 0 && guest.seen.creates.length === 0, `a friend joins by code in one tap, and Turnstile never loads on their phone (${guest.seen.turnstile.length} requests)`);
  const tv = await device(SCREEN);
  await tv.page.goto(`${passBase}/lobby/?join=${made.pin}&as=screen`);
  await tv.page.click("button[type=submit]");
  await inRoom(tv.page);
  await tv.page.reload();
  await inRoom(tv.page);
  say(tv.seen.turnstile.length === 0 && tv.seen.creates.length === 0, `the big screen joins by code and reloads, and Turnstile never loads on it (${tv.seen.turnstile.length} requests)`);

  // The big screen starting a party is checked once, and its reload is not checked again.
  const tv2 = await device(SCREEN);
  await tv2.page.goto(passBase + "/lobby/?start&as=screen");
  await tv2.page.click("button[type=submit]");
  await inRoom(tv2.page);
  const tvMade = { turnstile: tv2.seen.turnstile.length, creates: tv2.seen.creates.length, code: (await session(tv2.page))?.code };
  await tv2.page.reload();
  await inRoom(tv2.page);
  say(tvMade.creates === 1 && tv2.seen.creates[0].turnstile === DUMMY_TOKEN && tv2.seen.creates.length === 1 && tv2.seen.turnstile.length === tvMade.turnstile && (await session(tv2.page))?.code === tvMade.code, "the big screen starting a party is checked once; its reload is the same party, unchecked");

  // The failing secret: the page says so, and trying again checks again.
  if (failBase !== "skip") {
    const no = await device(PHONE);
    await no.page.goto(failBase + "/lobby/?start");
    await no.page.fill("input[name=nickname]", "Cy");
    await no.page.tap("button[type=submit]");
    await answered(no.page);
    const line = await no.page.locator(".door-error").textContent();
    say(line === REFUSED && (await no.page.locator(".bar").count()) === 0, `a refused check makes no party, and the page says: "${line}"`);
    say(await no.page.locator("button[type=submit]").isEnabled(), "the button works again, so the player can try again");
    await no.page.locator(".door-error").evaluate((el) => (el.hidden = true));
    await no.page.tap("button[type=submit]");
    await answered(no.page);
    say(no.seen.creates.length === 2 && no.seen.creates.every((c) => c.turnstile === DUMMY_TOKEN) && (await no.page.locator(".door-error").textContent()) === REFUSED, `trying again runs the check again and sends a fresh token (${no.seen.creates.length} room requests)`);
  }

  // Turnstile's script stalled, blocked, or answering with something that is not Turnstile: each
  // time the page says so, sends no room request and gives the button back, and once the script
  // can load again the next try makes the party (the failed load was forgotten).
  const cases = [
    ["never answers", BOT_STALLED, () => new Promise(() => {})],
    ["is blocked outright", BOT_BLOCKED, (route) => route.abort("blockedbyclient")],
    ["loads, but is not Turnstile", REFUSED, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "/* not turnstile */" })],
  ];
  for (const [what, message, handle] of cases) {
    const d = await device(PHONE);
    await d.page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", handle);
    await d.page.goto(passBase + "/lobby/?start");
    await d.page.fill("input[name=nickname]", "Flo");
    const began = Date.now();
    await d.page.tap("button[type=submit]");
    await answered(d.page);
    const said = await d.page.locator(".door-error").textContent();
    say(said === message && d.seen.creates.length === 0 && (await d.page.locator("button[type=submit]").isEnabled()), `when Turnstile's script ${what}, the page says so after ${((Date.now() - began) / 1000).toFixed(0)} s ("${said}"), sends no room request, and the button works again`);
    await d.page.unrouteAll({ behavior: "ignoreErrors" });
    await d.page.tap("button[type=submit]");
    await inRoom(d.page);
    say(d.seen.creates.length === 1 && d.seen.creates[0].turnstile === DUMMY_TOKEN, "and once it can load, trying again makes the party");
    await d.page.context().close();
  }

  if (failSiteBase) {
    const site = await device(PHONE);
    await site.page.goto(failSiteBase + "/lobby/?start");
    await site.page.fill("input[name=nickname]", "Di");
    await site.page.tap("button[type=submit]");
    await answered(site.page);
    const said = await site.page.locator(".door-error").textContent();
    say(said === REFUSED && site.seen.creates.length === 0, `when the widget itself refuses (always-fail site key), no room request is sent and the page says: "${said}"`);
    say(await site.page.locator("button[type=submit]").isEnabled(), "and the button works again");
  }

  if (offBase) {
    const off = await device(PHONE);
    await off.page.goto(offBase + "/lobby/?start");
    await off.page.fill("input[name=nickname]", "Ed");
    await off.page.tap("button[type=submit]");
    await inRoom(off.page);
    say(off.seen.turnstile.length === 0 && off.seen.creates.length === 1 && !("turnstile" in off.seen.creates[0]), "with the check off, a party is made as before and nothing loads from Turnstile");
  }
}

console.log(problems.length ? "FAILED: " + problems.length : "PASSED");
process.exit(problems.length ? 1 : 0);
