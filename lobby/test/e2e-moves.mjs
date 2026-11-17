// The robot's and the slime's moves, end to end: real pages and real sockets in one room, against
// a running local server, in the flat look and in 3D. The browser is headless and MUTED, and is
// closed at the end whatever happens. With TEST_GPU=1 it draws on the graphics card
// (lobby/test/browser.mjs).
//
//   node lobby/test/e2e-moves.mjs [--base=http://localhost:8791] [--looks=flat,3d]
//
// Three phones (Rob a robot, Sam a slime, Pat a pawn) and a bare socket (Ada, a second robot), in
// each look. What it goes through, by the keys a player presses and as every phone draws it:
//   the buttons     Rob's move button says Hook and his jump button Legs; Sam's says Harden
//   hook            Rob throws his hook at Pat: Pat is dragged across the floor to him, upright,
//                   and every phone draws the chain and the pull
//   jumped          Pat jumps as the hook arrives: it passes under him
//   kicked away     Pat kicks toward Rob as the hook arrives: it is batted away
//   hook train      Rob drags Pat in and Ada hooks Rob mid-pull: all three end in a line
//   bonk            Rob and Ada hook each other: both are yanked together and bonk heads
//   stilt legs      Rob's legs go up and Pat's kick swings under him; every phone draws the legs
//   harden          Sam taps Harden and Pat's kick bounces off; every phone draws the gem
//   absorb          Sam holds Harden (goes soft) and Rob's hook sticks: Rob is dragged to Sam
//   shove           Sam walks into Pat and shoves him along
//   a reload        a phone reloaded while Rob's legs are up, and Sam's own phone reloaded while
//                   it is soft, draw them so
import { LOOK_COOLDOWN_MS } from "../shared/characters.js";
import { HOOK_COOLDOWN_MS, STILT_COOLDOWN_MS, STILT_MS } from "../shared/robot.js";
import { ABSORB_MS, HOLD_MS, SLIME_COOLDOWN_MS } from "../shared/slime.js";
import { launchBrowser } from "./browser.mjs";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const looks = opt("looks", "flat,3d").split(",").filter(Boolean);
const { api, call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const section = (name) => console.log("\n     -- " + name);

/** Read in each page: what a seat's piece is doing with its moves, in either look, and the most of it seen over a while. */
function pageHelpers() {
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    window.__ws = this;
    // A message the test holds back on its way to the room (a slow network): {test, ms}.
    const late = window.__late;
    if (late && typeof data === "string" && late.test.test(data)) return void setTimeout(() => send.call(this, data), late.ms);
    return send.call(this, data);
  };
  // Frames held back (a page that stalls drawing) until performance.now() reaches window.__stallUntil.
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    const wait = (window.__stallUntil ?? 0) - performance.now();
    return wait > 0 ? setTimeout(() => raf(cb), wait) : raf(cb);
  };
  window.__send = (m) => window.__ws.send(JSON.stringify(m));
  const view = () => globalThis.__partyRoom?.view;
  window.movesOn = (seat) => {
    const v = view();
    const p = v?.pieces?.get(seat);
    if (!p) return null;
    const flat = !window.__room3d;
    const g = flat ? document.querySelector(`svg.scene g[data-seat="${seat}"]`) : null;
    const chainEl = flat ? document.querySelector(`.robot-hook[data-seat="${seat}"]`) : null;
    const chain = flat ? !!chainEl && !!chainEl.querySelector("path")?.getAttribute("d") : !!v.hooks?.hooks.get(seat)?.chain.count;
    const legs = flat ? (g?.querySelector(".robot-stilts")?.getAttribute("display") === "none" ? 0 : p.legs ?? 0) : p.body.legsG?.visible ? p.body.legs : 0;
    const gem = flat ? !!g?.querySelector(".slime-gem") && g.querySelector(".slime-gem").getAttribute("display") !== "none" : !!p.body.gem?.visible;
    return { x: p.rx, hook: p.hook ? (p.hook.verdict?.o ?? "out") : null, chain, legs, gem, soft: !!p.goo && p.goo.turnAt !== null, fright: p.fright?.kind ?? null, knock: !!p.knock, character: p.kind?.id };
  };
  window.__moves = {};
  window.watchMoves = (seat, ms) => {
    const most = (window.__moves[seat] = { legs: 0, chain: false, gem: false, soft: false, frights: [], knocked: false, hooks: [], minX: Infinity, maxX: -Infinity, frames: 0 });
    const until = performance.now() + ms;
    const look = () => {
      const m = window.movesOn(seat);
      if (m) {
        most.frames++;
        most.legs = Math.max(most.legs, m.legs);
        most.chain ||= m.chain;
        most.gem ||= m.gem;
        most.soft ||= m.soft;
        most.knocked ||= m.knock;
        if (m.fright && !most.frights.includes(m.fright)) most.frights.push(m.fright);
        if (m.hook && !most.hooks.includes(m.hook)) most.hooks.push(m.hook);
        most.minX = Math.min(most.minX, m.x);
        most.maxX = Math.max(most.maxX, m.x);
      }
      if (performance.now() < until) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  };
}

const browser = await launchBrowser({ args: ["--autoplay-policy=user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const sockets = [];
try {
  for (const look of looks) {
    const errors = [];
    const pages = [];
    async function open(name) {
      const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
      await context.addInitScript(pageHelpers);
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
      pages.push(context);
      return page;
    }
    const lookQuery = look === "flat" ? "look=flat" : "look=3d&gl=any";
    const drawn = (page) => (look === "flat" ? page.waitForSelector("svg.scene g[data-seat]", { timeout: 20000 }) : page.waitForFunction(() => window.__room3d?.pieces?.size > 0, null, { timeout: 40000 }));
    async function join(name, pin) {
      const page = await open(name);
      await page.goto(`${base}/lobby/?join=${pin}&${lookQuery}`);
      await page.waitForSelector(".door-title");
      await page.fill("input[name=nickname]", name);
      await page.click("text=Join the party");
      await drawn(page);
      return page;
    }

    section(`${look}: a party of four: Ada (a bare socket), Rob, Sam and Pat (phones)`);
    const host = await call("POST", "/rooms", { nickname: "Ada" });
    const ada = connect(host);
    sockets.push(ada);
    ada.ws.addEventListener("message", (ev) => {
      if (typeof ev.data !== "string" || ev.data === "pong") return;
      const m = JSON.parse(ev.data);
      // The room moves Ada's piece itself by a hook (shared/robot.js): she follows.
      if (m.t === "hk" && m.s === ada.seat && Number.isFinite(m.x)) [ada.x, ada.rev] = [m.x, m.rev];
      if (m.t === "hk" && m.to === ada.seat && Number.isFinite(m.x) && m.o === "pull") [ada.x, ada.rev] = [m.x, m.rev];
      if (m.t === "hk" && m.o === "bonk" && m.to === ada.seat) [ada.x, ada.rev] = [m.ox, m.orev];
    });
    await ada.opened;
    const rob = await join("Rob", host.pin);
    const sam = await join("Sam", host.pin);
    const pat = await join("Pat", host.pin);
    await ada.wait((m) => m.room?.members.filter((x) => x?.connected).length === 4, 10000, 0);
    const seat = (name) => ada.room.members.find((m) => m?.name === name).seat;
    const [A, R, S, P] = ["Ada", "Rob", "Sam", "Pat"].map(seat);
    const where = async () => (await (await fetch(`${api}/debug/${host.code}`)).json()).room.view.members;
    // Each phone becomes its character (the picker itself is test:characters' business).
    async function become(page, s, c) {
      const from = ada.seen.length;
      await page.evaluate((c) => window.__send({ t: "look", c }), c);
      const ok = await ada.wait((m) => m.room?.members[s]?.character === c, 4000, from).catch(() => null);
      await sleep(LOOK_COOLDOWN_MS);
      return !!ok;
    }
    check(await become(rob, R, "robot"), "Rob picks the robot");
    check(await become(sam, S, "slime"), "Sam picks the slime");
    ada.send({ t: "look", c: "robot" });
    await ada.wait((m) => m.room?.members[A]?.character === "robot", 4000, 0);
    await sleep(LOOK_COOLDOWN_MS);
    check((await rob.locator(".ctl-bump .ctl-word").textContent()) === "Hook" && (await rob.locator(".ctl-jump .ctl-word").textContent()) === "Legs", "Rob's move button says Hook, and his jump button Legs");
    check((await sam.locator(".ctl-bump .ctl-word").textContent()) === "Harden", "Sam's move button says Harden");
    check((await pat.locator(".ctl-bump .ctl-word").textContent()) === "Bump", "Pat's (a pawn) still says Bump");

    /** Walks a phone's piece (by its keys) to x, as the room has it, then faces `face`. */
    const walkTo = async (page, s, x, face = 0, near = 14) => {
      for (let i = 0; i < 16; i++) {
        const gap = x - (await where())[s].x;
        if (Math.abs(gap) < near) break;
        const key = gap > 0 ? "ArrowRight" : "ArrowLeft";
        await page.keyboard.down(key);
        await sleep(Math.max(25, Math.min(900, ((Math.abs(gap) - near / 3) / 430) * 1000)));
        await page.keyboard.up(key);
        await sleep(260);
      }
      if (face) {
        // A tap the other way first would walk it off: a tap toward `face` turns it there, a step at most.
        // Held past the page's send gap (60 ms), so the turn reaches the room.
        await page.keyboard.down(face > 0 ? "ArrowRight" : "ArrowLeft");
        await sleep(75);
        await page.keyboard.up(face > 0 ? "ArrowRight" : "ArrowLeft");
        await sleep(250);
      }
    };
    const after = (test, ms = 3000, from = ada.seen.length) => ada.wait(test, ms, from).catch(() => null);
    /** Waits until a seat's move is ready again and it is up and safe no more, by the room's word. */
    const rested = async (...seats) => {
      for (let i = 0; i < 80; i++) {
        const at = await where();
        if (seats.every((s) => !(at[s].safe > 0) && !(at[s].hookCool > 0) && !(at[s].slimeCool > 0) && !(at[s].cool > 0) && !(at[s].stiltCool > 0))) return;
        await sleep(200);
      }
    };
    // On every phone at once, and for longer than the move takes: on a busy machine each call into a
    // page can take a while, and a watch that began late would miss the start of the move.
    const watchAll = (s, ms) => Promise.all([rob, sam, pat].map((page) => page.evaluate(([s, ms]) => window.watchMoves(s, ms), [s, ms + 1500])));
    const seenOn = (page, s) => page.evaluate((s) => window.__moves[s] ?? {}, s);
    ada.goto(1700);

    // ================================================================ the hook
    section(`${look}: Rob throws his hook at Pat: Pat is dragged to him, upright, on every phone`);
    await walkTo(pat, P, 900);
    await walkTo(rob, R, 700, 1);
    await sleep(300);
    let at = await where();
    await watchAll(P, 1600);
    await watchAll(R, 1600);
    let mark = ada.seen.length;
    await rob.keyboard.press("KeyX");
    const thrown = await after((m) => m.t === "hook" && m.s === R, 2000, mark);
    const pulled = await after((m) => m.t === "hk" && m.s === R, 3000, mark);
    check(thrown?.f === 1, `the room tells everybody Rob threw his hook, to the right (${JSON.stringify(thrown && { f: thrown.f, x: thrown.x })})`);
    check(pulled?.o === "pull" && pulled.to === P && Math.abs(pulled.x - at[R].x - 64) <= 2, `it caught Pat and dragged him from ${at[P].x} to ${pulled?.x} (Rob at ${at[R].x})`);
    await sleep(1700);
    for (const [name, page] of [["Sam", sam], ["Pat", pat]]) {
      const pawn = await seenOn(page, P);
      check(pawn.frights.includes("pull") && !pawn.knocked && pawn.minX <= (pulled?.x ?? 0) + 6 && pawn.maxX >= at[P].x - 6,`${name}'s phone draws Pat pulled across the floor, upright, never knocked (${JSON.stringify(pawn)})`);
    }
    const chainFirst = await seenOn(sam, R);
    // On a busy machine a page may draw only a few frames in the 260 ms of the pull: the chain out is what must be seen.
    check(chainFirst.chain && chainFirst.hooks.length > 0, `Sam's phone drew Rob's chain out (${JSON.stringify(chainFirst.hooks)}, ${chainFirst.frames} frames)`);

    section(`${look}: a jump clears the hook; a kick toward the robot bats it away`);
    await rested(R, P);
    await walkTo(pat, P, 900);
    await walkTo(rob, R, 700, 1);
    await sleep(300);
    await sam.evaluate((s) => window.watchMoves(s, 900), R);
    mark = ada.seen.length;
    await rob.keyboard.press("KeyX");
    await sleep(90);
    await pat.keyboard.press("ArrowUp");
    const jumped = await after((m) => m.t === "hk" && m.s === R, 3000, mark);
    check(jumped?.o === "jumped" && jumped.to === P, `Pat jumps as it arrives: the hook passes under him (${JSON.stringify(jumped && { o: jumped.o, to: jumped.to })})`);
    const miss = await after((m) => m.t === "hk" && m.s === R && m.o !== "jumped", 3000, mark);
    check(miss?.o === "miss", `and flies on to the end of its reach and winds back (${miss?.o})`);
    await sleep(900);
    const chainSeen = await seenOn(sam, R);
    check(chainSeen.chain && chainSeen.hooks.length > 0, `Sam's phone drew the chain and the hook out (${JSON.stringify({ chain: chainSeen.chain, hooks: chainSeen.hooks })})`);
    await rested(R, P);
    // Pat out of a kick's reach of Rob (130), well within his hook's.
    await walkTo(pat, P, 960, -1);
    await walkTo(rob, R, 700, 1);
    await sleep(300);
    const before = (await where())[P].x;
    mark = ada.seen.length;
    await rob.keyboard.press("KeyX");
    await sleep(110);
    await pat.keyboard.press("KeyX");
    const parried = await after((m) => m.t === "hk" && m.s === R, 3000, mark);
    check(parried?.o === "parry" && parried.to === P, `Pat kicks toward Rob as it arrives: batted away (${JSON.stringify(parried && { o: parried.o })})`);
    check(Math.abs((await where())[P].x - before) < 2, "and Pat stays where he was");

    section(`${look}: the hook train, and the hook back (a bonk)`);
    await rested(R, P);
    at = await where();
    // Ada (a robot) on the left facing right, Rob in the middle facing right, Pat on the right.
    await walkTo(pat, P, 980);
    await walkTo(rob, R, 820, 1);
    ada.goto(560);
    ada.send({ t: "m", x: 560, d: 1, r: ada.rev });
    ada.send({ t: "m", x: 560, d: 0, r: ada.rev });
    await sleep(400);
    await watchAll(P, 2000);
    mark = ada.seen.length;
    await rob.keyboard.press("KeyX");
    // Ada throws as Rob's hook reaches Pat: hers reaches Rob while he drags Pat in.
    await sleep(170);
    ada.send({ t: "hook" });
    const robs = await after((m) => m.t === "hk" && m.s === R, 3000, mark);
    const adas = await after((m) => m.t === "hk" && m.s === A, 3000, mark);
    at = await where();
    check(robs?.o === "pull" && robs.to === P, `Rob's hook drags Pat in (${robs?.o})`);
    check(adas?.o === "pull" && adas.to === R && adas.tr?.s === P, `Ada's hook catches Rob mid-pull and Pat comes along behind (${JSON.stringify(adas && { o: adas.o, to: adas.to, tr: adas.tr })})`);
    check(at[A].x < at[R].x && at[R].x < at[P].x, `all three end in a line: Ada ${at[A].x}, Rob ${at[R].x}, Pat ${at[P].x}`);
    await sleep(1800);
    const train = await seenOn(sam, P);
    check(train.frights.includes("pull") && !train.knocked, `Sam's phone draws Pat pulled along, upright (${JSON.stringify(train.frights)})`);

    await rested(R, A);
    // Pat well out of the way, so each robot's hook meets the other first.
    await walkTo(pat, P, 1450);
    await walkTo(rob, R, 900, -1);
    ada.goto(680);
    ada.send({ t: "m", x: 680, d: 1, r: ada.rev });
    ada.send({ t: "m", x: 680, d: 0, r: ada.rev });
    await sleep(400);
    await watchAll(R, 1500);
    mark = ada.seen.length;
    await rob.keyboard.press("KeyX");
    ada.send({ t: "hook" });
    const bonk = await after((m) => m.t === "hk" && m.o !== "jumped", 3000, mark);
    at = await where();
    check(bonk?.o === "bonk", `Rob and Ada hook each other: both yanked together, and they bonk heads (${bonk?.o})`);
    check(Math.abs(at[R].x - at[A].x) <= 70, `they end head to head (${at[A].x} and ${at[R].x})`);
    await sleep(1600);
    const bonked = await seenOn(pat, R);
    check(bonked.frights.includes("bonk") && !bonked.knocked, `Pat's phone draws Rob's bonk, upright (${JSON.stringify(bonked.frights)})`);

    // ================================================================ the legs
    section(`${look}: Rob's legs go up, and Pat's kick swings under him; every phone draws the legs`);
    // Ada (bonked into the middle just now) well out of the way of every kick and hook from here on.
    await rested(A);
    ada.goto(1780);
    await rested(R, P);
    await walkTo(rob, R, 900);
    await walkTo(pat, P, 820, 1);
    await sleep(300);
    await watchAll(R, 1600);
    mark = ada.seen.length;
    await rob.keyboard.press("ArrowUp");
    const up = await after((m) => m.t === "stilts" && m.s === R, 2000, mark);
    const upAt = Date.now();
    check(up?.for === STILT_MS, `the room tells everybody Rob's legs are up for ${up?.for} ms`);
    await sleep(200);
    if (look === "flat") {
      // Up on its legs, the robot's name tag stays clear of the row of signs over the boxes.
      const overlap = await sam.evaluate((s) => {
        const v = globalThis.__partyRoom.view;
        const tag = v.pieces.get(s).tag.getBoundingClientRect();
        return v.boxes.some((b) => {
          const r = b.sign.getBoundingClientRect();
          return tag.left < r.right && tag.right > r.left && tag.top < r.bottom - 1 && tag.bottom > r.top;
        });
      }, R);
      check(!overlap, "Rob's name tag, lifted with his legs, stays clear of the signs");
    }
    await pat.keyboard.press("KeyX");
    const under = await after((m) => m.t === "b" && m.s === P, 2000, mark);
    check(under?.to === -1, `Pat's kick swings through the gap: it hits nobody (${JSON.stringify(under && { to: under.to })})`);
    // A phone reloaded while the legs are up draws them up.
    // The room's own address, as a reload of the room's page is (the join link would ask for a name again).
    await pat.goto(`${base}/lobby/?${lookQuery}`);
    await drawn(pat);
    await pat.evaluate((s) => window.watchMoves(s, 400), R);
    const back = Date.now() - upAt;
    await sleep(450);
    const legsAfter = (await seenOn(pat, R)).legs ?? 0;
    // Judged only if the page drew before the legs came down (a software-drawn 3D page may take longer than that to come back).
    check(back < STILT_MS - 150 && legsAfter > 30, `Pat's phone reloaded mid-legs draws Rob up on them (${Math.round(legsAfter)} units; it drew ${back} ms after they went up, of ${STILT_MS})`);
    await sleep(Math.max(0, STILT_MS + 200 - back));
    for (const [name, page] of [["Sam", sam], ["Rob", rob]]) {
      const robot = await seenOn(page, R);
      check(robot.legs > 80, `${name}'s phone drew Rob's legs out (${Math.round(robot.legs)} units)`);
    }

    // ================================================================ the slime
    section(`${look}: Sam taps Harden and Pat's kick bounces off; every phone draws the gem`);
    await rested(S, P);
    // Rob out of the way first: the heavy slime walking over to 1000 would push him along in front
    // of it, into Pat's kick (and Pat it pushes along too, so he walks back after).
    await walkTo(rob, R, 1500);
    await walkTo(sam, S, 1000);
    await rested(P);
    await walkTo(pat, P, 920, 1);
    await sleep(300);
    await watchAll(S, 1200);
    mark = ada.seen.length;
    await sam.keyboard.press("KeyX");
    const hard = await after((m) => m.t === "slime" && m.s === S, 2000, mark);
    check(hard?.k === "harden", `a tap: the room tells everybody Sam hardened (${hard?.k})`);
    await sleep(100);
    at = await where();
    await pat.keyboard.press("KeyX");
    const bounced = await after((m) => m.t === "b" && m.s === P, 2000, mark);
    check(bounced?.bo === S && bounced.to === -1, `Pat's kick bounces off and Pat is knocked back himself (${JSON.stringify(bounced && { to: bounced.to, bo: bounced.bo, x: bounced.x })})`);
    check(bounced && bounced.x < at[P].x - 60 && Math.abs((await where())[S].x - at[S].x) < 2, "Pat lands back the way he came; Sam stays put");
    await sleep(1300);
    for (const [name, page] of [["Rob", rob], ["Pat", pat]]) check((await seenOn(page, S)).gem, `${name}'s phone drew Sam as a gem`);

    section(`${look}: Sam holds Harden (goes soft), Rob's hook sticks, and Rob is dragged to Sam`);
    await rested(S, R, P);
    await walkTo(pat, P, 1500);
    await walkTo(sam, S, 1000);
    await walkTo(rob, R, 800, 1);
    await sleep(300);
    await watchAll(S, 1500);
    mark = ada.seen.length;
    await sam.keyboard.down("KeyX");
    await sleep(HOLD_MS + 120);
    const soft = await after((m) => m.t === "slime" && m.s === S && m.k === "absorb", 2000, mark);
    // When it did not: what the room said about Sam's moves meanwhile, and what Sam's own page thought.
    const softWhy = soft
      ? ""
      : `; the room said ${JSON.stringify(ada.seen.slice(mark).filter((m) => (m.s === S && m.t !== "m") || m.t === "vote").map((m) => m.t + (m.k ? ":" + m.k : "") + (m.t === "vote" ? (m.vote.count ? ":count" : "") : "")))}, Sam's room record ${JSON.stringify((await where())[S])}, his page ${JSON.stringify(await sam.evaluate(() => ({ phase: globalThis.__partyRoom?.view?.room?.phase, note: document.querySelector(".note")?.textContent ?? null, active: document.activeElement?.tagName })))}`;
    check(soft?.for === ABSORB_MS, `held: the room tells everybody Sam went soft (${soft?.k}${softWhy})`);
    // Sam's own phone, reloaded while soft, draws itself soft.
    await rob.keyboard.press("KeyX");
    const stuck = await after((m) => m.t === "hk" && m.s === R, 3000, mark);
    await sam.keyboard.up("KeyX");
    at = await where();
    check(stuck?.o === "stuck" && stuck.to === S, `Rob's hook sticks to Sam (${stuck?.o})`);
    check(Math.abs(at[R].x - (at[S].x - 64)) <= 2, `and Rob is dragged across to Sam (${at[R].x}, Sam at ${at[S].x})`);
    await sleep(1200);
    for (const [name, page] of [["Rob", rob], ["Pat", pat]]) check((await seenOn(page, S)).soft, `${name}'s phone drew Sam soft`);

    section(`${look}: Sam's own phone reloaded while it is soft draws it soft`);
    await rested(S);
    mark = ada.seen.length;
    await sam.keyboard.down("KeyX");
    await sleep(HOLD_MS + 80);
    await sam.keyboard.up("KeyX");
    await after((m) => m.t === "slime" && m.s === S && m.k === "absorb", 2000, mark);
    const softAt = Date.now();
    await sam.goto(`${base}/lobby/?${lookQuery}`);
    await drawn(sam);
    await sam.evaluate((s) => window.watchMoves(s, 300), S);
    const softBack = Date.now() - softAt;
    await sleep(350);
    const ownSoft = (await seenOn(sam, S)).soft;
    // Soft until ABSORB_MS, then melting (SLIME's MELT_MS): a page that drew within the absorb must show it.
    check(softBack < ABSORB_MS && ownSoft, `Sam's phone, back from the reload within the absorb (it drew ${softBack} ms in, of ${ABSORB_MS}), draws Sam soft`);

    section(`${look}: a hold survives a page that stalls drawing; an absorb the room refuses is taken back on Sam's own phone`);
    await rested(S);
    // Sam's page draws no frame for 900 ms from the press: the hold still turns soft (a timer, not a frame).
    mark = ada.seen.length;
    await sam.evaluate(() => (window.__stallUntil = performance.now() + 900));
    await sam.keyboard.down("KeyX");
    await sleep(HOLD_MS + 120);
    await sam.keyboard.up("KeyX");
    const stalled = await after((m) => m.t === "slime" && m.s === S && m.k === "absorb", 2000, mark);
    check(stalled?.for === ABSORB_MS, `held while the page drew nothing: Sam still goes soft (${stalled?.k ?? "no absorb"})`);
    await sleep(1400);
    await rested(S);
    // The absorb reaches the room 0.75 s late, after the harden it would turn: refused (slime-no),
    // and Sam's own phone takes back the soft it drew at once, not when its own absorb would have ended.
    await sam.evaluate(() => {
      window.__late = { test: /"k":"absorb"/, ms: 750 };
      window.__pressAt = performance.now();
    });
    mark = ada.seen.length;
    await sam.keyboard.down("KeyX");
    await sleep(HOLD_MS + 120);
    await sam.keyboard.up("KeyX");
    const drewSoft = await sam.evaluate((s) => window.movesOn(s)?.soft, S);
    // When, after the press, Sam's phone stopped drawing him soft: by about 1.05 s with the refusal,
    // 1.44 s (its own absorb's end and melt) without it.
    const backAt = await sam
      .waitForFunction((s) => !window.movesOn(s)?.soft && performance.now() - window.__pressAt, S, { timeout: 4000, polling: 15 })
      .then((h) => h.jsonValue())
      .catch(() => null);
    await sam.evaluate(() => (window.__late = null));
    check(drewSoft && backAt !== null && backAt < 1250 && !ada.seen.slice(mark).some((m) => m.t === "slime" && m.k === "absorb"), `the late absorb is refused, and Sam's phone, which drew it soft (${drewSoft}), stops ${Math.round(backAt ?? -1)} ms after the press`);

    section(`${look}: Sam walks into Pat and shoves him along`);
    await rested(S, P);
    await walkTo(pat, P, 1100);
    await walkTo(sam, S, 900, 1);
    await sleep(300);
    at = await where();
    await watchAll(P, 2200);
    mark = ada.seen.length;
    await sam.keyboard.down("ArrowRight");
    await sleep(1200);
    await sam.keyboard.up("ArrowRight");
    await sleep(400);
    const shoves = ada.seen.slice(mark).filter((m) => m.t === "shove" && m.s === S && m.to === P);
    const moved = (await where())[P].x - at[P].x;
    check(shoves.length >= 2 && moved >= 100, `Sam's walk shoves Pat ${shoves.length} times, ${moved} units along`);
    await sleep(900);
    const shoved = await seenOn(rob, P);
    check(shoved.frights.includes("shove") && !shoved.knocked, `Rob's phone draws Pat shoved, upright (${JSON.stringify(shoved.frights)})`);

    section(`${look}: the pages`);
    check(errors.length === 0, `no page reported an error${errors.length ? ":\n       " + [...new Set(errors)].slice(0, 8).join("\n       ") : ""}`);
    ada.ws.close();
    for (const context of pages) await context.close();
  }
} catch (err) {
  console.log("FAIL the run stopped: " + (err?.stack ?? err));
  problems.push("the run stopped");
} finally {
  for (const c of sockets) c.ws.close();
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.");
process.exit(problems.length ? 1 : 0);
