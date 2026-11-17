// The robot's and the slime's moves, moment by moment (lobby/shared/robot.js, slime.js): the hook
// (a pull), the hook jumped, the hook kicked away, the hook train, the bonk, the stilt legs over a
// kick, the harden a kick bounces off, the absorb that turns a hook around, and the shove, in the
// flat and the 3D look, on a big screen (1280 x 720) and an upright phone (390 x 844).
//
// Real pages against a running local server, with each page's clock held still so every still is
// the moment named. The players are sockets, so the moments are exact; what the room says back is
// held on the page and let through at the moment it would have arrived (the room's word on a hook
// comes a third of a second after the throw), so the pictures follow the real timings. The browser
// is headless and muted, and is closed at the end whatever happens. Each story becomes one strip of
// captioned frames (ffmpeg). The pictures are for a person to look at; nothing is compared.
//
//   node lobby/test/shoot-moves.mjs [--base=http://localhost:8791] [--out=/tmp/claude-moves/stills] [--looks=flat,3d]
//
// Software drawing whatever TEST_GPU says, as the other still tools.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { HOLD_MS } from "../shared/slime.js";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "/tmp/claude-moves/stills"));
const looks = opt("looks", "flat,3d").split(",");
mkdirSync(out, { recursive: true });
const { api, call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};

/** On every page: messages from the room that match window.__hold are kept back until released, one at a time, by the test. */
function holdBack() {
  window.__held = [];
  window.__hold = null;
  const desc = Object.getOwnPropertyDescriptor(WebSocket.prototype, "onmessage");
  Object.defineProperty(WebSocket.prototype, "onmessage", {
    configurable: true,
    get() {
      return desc.get.call(this);
    },
    set(fn) {
      desc.set.call(this, (ev) => {
        if (window.__hold && typeof ev.data === "string" && window.__hold.test(ev.data)) return void window.__held.push([fn, this, ev]);
        fn.call(this, ev);
      });
    },
  });
  window.__releaseOne = () => {
    const next = window.__held.shift();
    if (next) next[0].call(next[1], next[2]);
    return !!next;
  };
}

/** Each frame with its caption under it, then all side by side, into one picture. */
function strip(files, captions, title, to) {
  try {
    const inputs = files.flatMap((f) => ["-i", f]);
    // An apostrophe cannot be escaped inside drawtext's quotes: the typographic one reads the same.
    const esc = (t) => t.replace(/'/g, "’").replace(/[:\\]/g, (c) => "\\" + c);
    const each = files.map((_, i) => `[${i}:v]pad=iw:ih+44:0:0:color=0x140e0a,drawtext=text='${esc(captions[i])}':fontcolor=0xf3ecd9:fontsize=20:x=(w-text_w)/2:y=h-32[f${i}]`).join(";");
    const stack = `${files.map((_, i) => `[f${i}]`).join("")}hstack=inputs=${files.length}[row];[row]pad=iw:ih+46:0:46:color=0x140e0a,drawtext=text='${esc(title)}':fontcolor=0xf4b453:fontsize=24:x=16:y=12`;
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", `${each};${stack}`, to]);
    console.log(`     strip: ${to}`);
  } catch (e) {
    console.log(`     (no strip: ${e.message.split("\n")[0]})`);
    problems.push(`no strip for ${to}`);
  }
}

const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const errors = [];
  async function open(name, viewport, extra = {}) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...extra });
    await context.addInitScript(holdBack);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    return page;
  }

  for (const look of looks) {
    console.log(`\n     -- the ${look} look`);
    const query = { "3d": "look=3d&gl=any", real: "look=real&gl=any", baked: "look=baked&gl=any" }[look] ?? "look=flat";
    const drawn = look === "flat" ? "svg.scene text" : ".look3d canvas";
    for (const device of ["screen", "phone"]) {
      // A party of its own for each device: Rob (a robot), Pat (a pawn) and Ada (a second robot, then a slime) are sockets.
      const screen = await open(`${look} screen`, { width: 1280, height: 720 });
      await screen.goto(`${base}/lobby/?start&${query}`);
      await screen.click("text=Use this as the room's screen");
      await screen.click("text=Show the room here");
      await screen.waitForSelector(drawn, { timeout: 60000 });
      await screen.waitForSelector(".code-digits");
      const pin = (await screen.locator(".code-digits").textContent()).trim();
      let page = screen;
      let bea = null;
      if (device === "phone") {
        bea = await open(`${look} Bea`, { width: 390, height: 844 }, { hasTouch: true });
        await bea.goto(`${base}/lobby/?join=${pin}&${query}`);
        await bea.fill("input[name=nickname]", "Bea");
        await bea.click("text=Join the party");
        await bea.waitForSelector(drawn, { timeout: 60000 });
        page = bea;
      }
      const [rob, pat, ada] = await Promise.all(["Rob", "Pat", "Ada"].map(async (nickname) => connect(await call("POST", "/join/" + pin, { nickname }))));
      await Promise.all([rob, pat, ada].map((c) => c.opened));
      await rob.wait((m) => m.room?.members.filter((x) => x?.connected).length === (device === "phone" ? 4 : 3), 8000, 0);
      const debug = async () => (await (await fetch(`${api}/debug/${rob.room.code}`)).json()).room.view.members;
      /** Puts a socket player's piece at x, facing `face`, starting from where the room says it is now. */
      const place = async (c, x, face = 1) => {
        const me = (await debug())[c.seat];
        c.x = me.x;
        c.rev = me.rev;
        c.goto(x);
        c.send({ t: "m", x, d: face, r: c.rev });
        c.send({ t: "m", x, d: 0, r: c.rev });
      };
      const become = async (c, character) => {
        c.send({ t: "look", c: character });
        await c.wait((m) => m.room?.members[c.seat]?.character === character, 4000, 0).catch(() => null);
        await sleep(1100);
      };
      await become(rob, "robot");
      await become(ada, "robot");
      // The action on the floor's left, Bea's own piece (the phone's camera follows it) standing by
      // just behind it, so an upright phone frames all of it; every hook flies away from her.
      const X = 620;
      if (bea) {
        const B = rob.room.members.find((m) => m?.name === "Bea").seat;
        const gap = X - 60 - (await debug())[B].x;
        await bea.keyboard.down(gap > 0 ? "ArrowRight" : "ArrowLeft");
        await sleep(Math.max(60, (Math.abs(gap) / 430) * 1000));
        await bea.keyboard.up(gap > 0 ? "ArrowRight" : "ArrowLeft");
      }
      await sleep(look !== "flat" ? 2500 : 900);

      /**
       * One story: `act` sends what the players do (at the page's held moment), then `steps` are
       * [caption, page ms] stills and ["release", page ms] lets the next held message from the room through.
       */
      const story = async (name, title, hold, act, steps) => {
        await sleep(400);
        await page.evaluate((h) => {
          window.__held.length = 0;
          window.__hold = h ? new RegExp(h) : null;
        }, hold);
        await page.clock.install();
        await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 300));
        await act();
        // Everything the room says comes back to the page, and is held there as asked.
        await sleep(1200);
        let at = 0;
        const files = [];
        const captions = [];
        for (const [what, ms] of steps) {
          await page.clock.runFor(Math.max(0, Math.round(ms - at)));
          at = Math.round(ms);
          if (what === "release") {
            const ok = await page.evaluate(() => window.__releaseOne());
            if (!ok) check(false, `${look} ${device} ${name}: a word from the room to let through at ${ms} ms`);
            continue;
          }
          // A software-drawn 3D frame can lag a step behind the clock: one more frame.
          if (look !== "flat") await page.clock.runFor(17).then(() => (at += 17));
          const file = `${out}/${look}-${device}-${name}-${String(files.length + 1).padStart(2, "0")}.png`;
          await page.screenshot({ path: file, timeout: 120000 });
          files.push(file);
          captions.push(`${what} (${ms} ms)`);
        }
        await page.evaluate(() => {
          window.__hold = null;
          while (window.__releaseOne());
        });
        await page.clock.resume();
        strip(files, captions, `${title}: ${look} look, ${device === "phone" ? "390 x 844 phone" : "1280 x 720 screen"}`, `${out}/strip-${look}-${device}-${name}.png`);
        for (const f of files) rmSync(f);
      };
      const said = (c, test, from) => c.wait(test, 3000, from).catch(() => null);

      // ------------------------------------------------ the hook: a pull
      await place(ada, 1700);
      await place(rob, X, 1);
      await place(pat, X + 200, -1);
      let mark = rob.seen.length;
      await story("1-hook", "The hook: a pull", '"t":"hk"', async () => rob.send({ t: "hook" }), [
        ["wind-up, the tell on the floor", 70],
        ["the tell", 140],
        ["the hook flies", 190],
        ["it reaches Pat", 240],
        ["release", 330],
        ["the pull", 400],
        ["dragged, upright", 470],
        ["at the robot", 600],
      ]);
      check((await said(rob, (m) => m.t === "hk" && m.s === rob.seat, mark))?.o === "pull", `${look} ${device}: the hook pulls Pat`);
      await sleep(6200);

      // ------------------------------------------------ jumped
      await place(rob, X, 1);
      await place(pat, X + 200, -1);
      mark = rob.seen.length;
      await story("2-hook-jumped", "A jump clears the hook", '"t":"(hk|m)"', async () => {
        rob.send({ t: "hook" });
        await sleep(90);
        pat.send({ t: "m", x: pat.x, d: 0, r: pat.rev, j: 1 });
      }, [
        ["wind-up", 80],
        ["release", 90],
        ["Pat jumps", 160],
        ["the hook flies", 230],
        ["under Pat's feet", 290],
        ["release", 330],
        ["flies on", 380],
        ["release", 410],
        ["winds back", 470],
      ]);
      check((await said(rob, (m) => m.t === "hk" && m.s === rob.seat, mark))?.o === "jumped", `${look} ${device}: Pat's jump clears the hook`);
      await sleep(6200);

      // ------------------------------------------------ kicked away
      await place(rob, X, 1);
      await place(pat, X + 200, -1);
      mark = rob.seen.length;
      await story("3-hook-kicked-away", "A kick bats the hook away", '"t":"(hk|b)"', async () => {
        rob.send({ t: "hook" });
        await sleep(110);
        pat.send({ t: "b" });
      }, [
        ["wind-up", 80],
        ["release", 110],
        ["Pat kicks", 190],
        ["the kick meets the hook", 280],
        ["release", 330],
        ["batted away", 380],
        ["winds back", 440],
      ]);
      check((await said(rob, (m) => m.t === "hk" && m.s === rob.seat, mark))?.o === "parry", `${look} ${device}: Pat's kick bats the hook away`);
      await sleep(6200);

      // ------------------------------------------------ the hook train
      await place(ada, X, 1);
      await place(rob, X + 80, 1);
      await place(pat, X + 240, -1);
      mark = rob.seen.length;
      await story("4-hook-train", "The hook train", '"t":"(hk|hook)"', async () => {
        rob.send({ t: "hook" });
        await sleep(170);
        ada.send({ t: "hook" });
      }, [
        ["release", 0],
        ["Rob throws", 120],
        ["release", 170],
        ["Ada throws", 240],
        ["Rob's reaches Pat", 290],
        ["release", 330],
        ["Rob drags Pat in", 420],
        ["release", 470],
        ["Ada drags Rob, Pat comes along", 560],
        ["all three in a line", 900],
      ]);
      const train = rob.seen.slice(mark).filter((m) => m.t === "hk").map((m) => m.o + (m.tr ? "+train" : ""));
      check(train.includes("pull+train"), `${look} ${device}: the hook train (${train.join(", ")})`);
      await sleep(6200);

      // ------------------------------------------------ the bonk
      await place(ada, X + 20, 1);
      await place(rob, X + 240, -1);
      await place(pat, 1600);
      mark = rob.seen.length;
      await story("5-hook-back-bonk", "The hook back: a bonk", '"t":"hk"', async () => {
        rob.send({ t: "hook" });
        ada.send({ t: "hook" });
      }, [
        ["both throw", 80],
        ["the hooks fly", 220],
        ["release", 330],
        ["yanked together", 420],
        ["bonk", 560],
        ["seeing stars", 760],
      ]);
      check((await said(rob, (m) => m.t === "hk", mark))?.o === "bonk", `${look} ${device}: the robots bonk`);
      await sleep(6200);

      // ------------------------------------------------ stilt legs over a kick
      // Ada (bonked into the middle just now) out of the way: the kick must have nobody but Rob before it.
      await place(ada, 1700);
      await place(rob, X + 160, 1);
      await place(pat, X + 80, 1);
      mark = rob.seen.length;
      await story("6-stilt-legs", "Stilt legs: a kick swings under", '"t":"b"', async () => {
        rob.send({ t: "stilts" });
        await sleep(250);
        pat.send({ t: "b" });
      }, [
        ["the squat (the tell)", 60],
        ["the legs telescope out", 160],
        ["up", 260],
        ["release", 270],
        ["Pat's kick swings under", 420],
        ["the shake: time running out", 950],
        ["down with a clank", 1120],
        ["the flash: it can be hit again", 1250],
      ]);
      check((await said(rob, (m) => m.t === "b" && m.s === pat.seat, mark))?.to === -1, `${look} ${device}: the kick swings under the legs`);
      await sleep(3000);

      // ------------------------------------------------ the slime: harden, a kick bounces off
      await become(ada, "slime");
      await place(rob, 1600);
      await place(ada, X + 160, -1);
      await place(pat, X + 80, 1);
      mark = rob.seen.length;
      await story("7-harden", "Harden: a kick bounces off", '"t":"b"', async () => {
        ada.send({ t: "slime", k: "harden" });
        await sleep(120);
        pat.send({ t: "b" });
      }, [
        ["the slime hardens", 60],
        ["a gem", 120],
        ["release", 130],
        ["Pat kicks", 250],
        ["bounces off", 380],
        ["Pat knocked back: a wince (> <)", 560],
        ["lying, eyes squeezed shut", 640],
        ["soft again", 1250],
      ]);
      check((await said(rob, (m) => m.t === "b" && m.s === pat.seat, mark))?.bo === ada.seat, `${look} ${device}: the kick bounces off the hardened slime`);
      await sleep(5200);

      // ------------------------------------------------ absorb: the hook turned around
      await place(pat, 1500);
      await place(ada, X + 200, -1);
      await place(rob, X, 1);
      mark = rob.seen.length;
      await story("8-absorb", "Absorb: the hook turned around", '"t":"(hk|slime)"', async () => {
        ada.send({ t: "slime", k: "harden" });
        await sleep(HOLD_MS);
        ada.send({ t: "slime", k: "absorb" });
        await sleep(40);
        rob.send({ t: "hook" });
      }, [
        ["release", 0],
        ["the press: hard", 120],
        ["release", HOLD_MS],
        ["held: soft and sticky", HOLD_MS + 120],
        ["the hook flies", HOLD_MS + 240],
        ["release", HOLD_MS + 360],
        ["it sticks", HOLD_MS + 400],
        ["the robot is dragged in", HOLD_MS + 480],
        ["at the slime", HOLD_MS + 700],
      ]);
      check(rob.seen.slice(mark).some((m) => m.t === "hk" && m.o === "stuck"), `${look} ${device}: the hook sticks to the soft slime`);
      await sleep(5200);

      // ------------------------------------------------ heavy: the shove
      await place(rob, 1600);
      await place(ada, X, 1);
      await place(pat, X + 100, 1);
      mark = rob.seen.length;
      await story("9-shove", "Heavy: the slime shoves", '"t":"shove"', async () => {
        ada.send({ t: "m", x: ada.x, d: 1, r: ada.rev });
        for (let i = 0; i < 4; i++) {
          await sleep(220);
          ada.send({ t: "shove", to: pat.seat });
        }
        await sleep(100);
        ada.send({ t: "m", x: ada.x + 430, d: 0, r: ada.rev });
      }, [
        ["the slime walks", 80],
        ["release", 220],
        ["into Pat: a shove", 300],
        ["release", 440],
        ["and on", 520],
        ["release", 660],
        ["pushed along", 740],
        ["release", 880],
        ["upright all the way", 1000],
      ]);
      check(rob.seen.slice(mark).filter((m) => m.t === "shove").length >= 2, `${look} ${device}: the slime shoves Pat along`);

      for (const c of [rob, pat, ada]) c.ws.close();
      if (bea) await bea.context().close();
      await screen.context().close();
      check(!errors.length, `no page reported an error (${look} ${device})` + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
      errors.length = 0;
    }
  }
} catch (err) {
  console.log("FAIL the run stopped: " + (err?.stack ?? err));
  problems.push("the run stopped");
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good. Strips are in " + out);
process.exit(problems.length ? 1 : 0);
