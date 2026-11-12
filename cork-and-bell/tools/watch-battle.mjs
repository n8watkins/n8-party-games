// A small look at a two-bot battle through the page's own summary, once a second.
//   node cork-and-bell/tools/watch-battle.mjs [--seconds=20] [--lag=150]
import { openBrowser, opt } from "./browser.mjs";

const args = process.argv.slice(2);
const seconds = Number(opt(args, "seconds", 20));
const lag = opt(args, "lag", "150");
const base = opt(args, "base", "http://localhost:8791/cork-and-bell/");
const b = await openBrowser({ win: opt(args, "win", "1") === "1", width: 900, height: 700 });
try {
  const open = async (query) => {
    const context = await b.newContext({ viewport: { width: 420, height: 800 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("PAGE ERROR", String(e)));
    page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text().slice(0, 200)));
    await page.goto(base + "?" + query);
    await page.waitForFunction(() => window.__cab, null, { timeout: 60000 });
    return page;
  };
  const host = await open("auto=1&quality=low&host=1&seats=2&name=Ann&lag=" + lag);
  await host.waitForFunction(() => window.__cab.party.session?.pin);
  const pin = await host.evaluate(() => window.__cab.party.session.pin);
  const guest = await open("auto=1&quality=low&join=" + pin + "&name=Bo&lag=" + lag);
  for (let i = 0; i < seconds; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const line = async (page) => {
      const s = await page.evaluate(() => {
        const c = window.__cab;
        const s = c.summary();
        return s && { mode: s.mode, t: s.t, over: s.over, round: s.round, phase: s.phase, scores: s.stalls.map((x) => x.score + "/" + x.shots), room: c.party.room && { phase: c.party.room.phase, round: c.party.room.round } };
      }).catch((e) => String(e).slice(0, 120));
      return JSON.stringify(s);
    };
    console.log(i, await line(host), "|", await line(guest));
  }
} finally {
  await b.close();
}
