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
// With --browser=1 it also makes a room through the lobby in a real browser (the widget renders
// and hands over its token) and joins it by PIN from a second page that never loads Turnstile.
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const passBase = opt("pass", "http://localhost:8805");
const failBase = opt("fail", "http://localhost:8806");
const browser = opt("browser", "0") === "1";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX"; // what the test site keys hand out
const problems = [];
const say = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const post = (base, path, body) =>
  fetch(base + "/api/party" + path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }).then(async (r) => ({ status: r.status, ...(await r.json()) }));

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
const refused = await post(failBase, "/rooms", { nickname: "Cy", turnstile: DUMMY_TOKEN });
say(refused.status === 403 && refused.error === "bot_check", `with a failing secret the room is refused (${refused.status} ${refused.error})`);
say(typeof refused.message === "string" && !/secret|siteverify|error-codes/i.test(refused.message), `and the message gives nothing away: "${refused.message}"`);

if (browser) {
  const { chromium } = await import("playwright");
  const b = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    const host = await b.newPage();
    const hostErrors = [];
    host.on("pageerror", (e) => hostErrors.push(String(e)));
    await host.goto(passBase + "/cork-and-bell/?quality=low", { waitUntil: "domcontentloaded", timeout: 90000 });
    await host.waitForFunction(() => window.__cab, null, { timeout: 90000 });
    await host.locator("#battle").click();
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
    if (!(await guest.locator(".pk-door").isVisible())) await guest.locator("#battle").click();
    await guest.locator(".pk-door input.pk-input").first().fill("Guest");
    await guest.locator(".pk-pin-input").fill(pin);
    await guest.getByRole("button", { name: "Join with PIN" }).click();
    await guest.waitForFunction(() => window.__cab.party.session?.seat >= 0, null, { timeout: 30000 });
    say(turnstileLoads.length === 0, `a friend joins by PIN in one step, and Turnstile never loads on their page (${turnstileLoads.length} requests)`);
  } finally {
    await b.close();
  }
}

console.log(problems.length ? "FAILED: " + problems.length : "PASSED");
process.exit(problems.length ? 1 : 0);
