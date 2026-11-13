// Who may put this site's pages in a frame, checked in a real browser against a running server.
// The party room shows a hosted game by framing the game's own page, so the site's pages may be
// framed by the site's own pages, and by nobody else. The browser is headless and muted.
//
//   node lobby/test/e2e-frames.mjs [--base=http://localhost:8791]
//
// A page of another origin (a little server this script starts on a spare local port) tries to
// frame the room and the game and must be refused; a page of the site itself must succeed.
import http from "node:http";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const PATHS = ["/lobby/", "/cork-and-bell/", "/"];

// What every page of the site says about frames.
for (const path of PATHS) {
  const res = await fetch(base + path);
  const csp = res.headers.get("content-security-policy") ?? "";
  check(/frame-ancestors 'self'(;|$)/.test(csp) && res.headers.get("x-frame-options") === "SAMEORIGIN" && /frame-src 'self' /.test(csp), `${path} is served with frame-ancestors 'self', X-Frame-Options: SAMEORIGIN and frame-src 'self'`);
}

// Another site: a page that frames each of them.
const other = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><title>another site</title>${PATHS.map((p, i) => `<iframe id="f${i}" src="${base + p}"></iframe>`).join("")}`);
});
await new Promise((r) => other.listen(0, "127.0.0.1", r));
const elsewhere = `http://127.0.0.1:${other.address().port}/`;

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
try {
  /** What ended up in each frame of a page: the site's page, or the browser's refusal. */
  const framed = async (page) => {
    await page.waitForLoadState("load");
    await page.waitForTimeout(1500);
    const out = [];
    for (const frame of page.frames().filter((f) => f !== page.mainFrame())) {
      const url = frame.url();
      const has = url.startsWith(base) ? await frame.evaluate(() => !!document.querySelector("#app, #stage, .site, main, body > *")).catch(() => false) : false;
      out.push({ url, has });
    }
    return out;
  };

  const outsider = await (await browser.newContext()).newPage();
  const refusals = [];
  outsider.on("console", (m) => /frame-ancestors|X-Frame-Options|Refused to (frame|display)/i.test(m.text()) && refusals.push(m.text()));
  await outsider.goto(elsewhere);
  const from = await framed(outsider);
  check(new URL(elsewhere).origin !== new URL(base).origin && from.length === PATHS.length && from.every((f) => !f.has && !f.url.startsWith(base)), `a page on another origin (${new URL(elsewhere).origin}) cannot frame any of them: each frame holds the browser's refusal (${from.map((f) => f.url.split(":")[0]).join(", ")})`);
  check(refusals.length >= PATHS.length, `and the browser says why, ${refusals.length} times: "${(refusals[0] ?? "").slice(0, 110)}"`);

  const insider = await (await browser.newContext()).newPage();
  await insider.goto(base + "/");
  await insider.evaluate((paths) => {
    for (const p of paths) {
      const f = document.createElement("iframe");
      f.src = p;
      document.body.append(f);
    }
  }, PATHS);
  const within = await framed(insider);
  check(within.length === PATHS.length && within.every((f) => f.has && f.url.startsWith(base)), "a page of the site itself can frame all of them, as the party room does with a game");
} catch (err) {
  console.log("FAIL the run stopped: " + (err?.stack ?? err));
  problems.push("the run stopped");
} finally {
  await browser.close();
  other.close();
}
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.");
process.exit(problems.length ? 1 : 0);
