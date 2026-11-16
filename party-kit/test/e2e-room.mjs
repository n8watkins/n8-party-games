// An end-to-end check of the room over real sockets, against a running local server
// (npm run dev). No browser: plain fetch and WebSocket from Node.
//   node party-kit/test/e2e-room.mjs [--base=http://localhost:8791] [--full=1]
// It makes a room, joins it by PIN, readies both players, starts a round, drops one player and
// brings them back inside the grace, and (with --full=1) waits for the round to end and times it.
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const full = opt("full", "0") === "1";
const api = base + "/api/party";
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
// "X-Party-Protocol" is the mark the kit's client puts on its requests (party-client.js, PROTOCOL).
const post = async (path, body, mark = { "X-Party-Protocol": "2" }) => (await fetch(api + path, { method: "POST", headers: { "Content-Type": "application/json", ...mark }, body: JSON.stringify(body) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Opens a socket for a session. The seat's token is never in the address: it is the socket's
 * first message, sent the moment the socket opens, as the page's client does. `hello: false`
 * opens the socket and says nothing, and `oldForm: true` puts the token in the address the way
 * pages did before (taken as that hello, for now). `from` is the address the socket comes from, as
 * Cloudflare would put it on the request (the local runtime passes it through).
 */
function connect(session, lag = 0, { hello = true, oldForm = false, from = null } = {}) {
  const url = new URL(api + "/rooms/" + session.code + "/ws", base);
  url.protocol = "ws:";
  if (oldForm) url.searchParams.set("token", session.token);
  if (lag) url.searchParams.set("lag", String(lag));
  const ws = from ? new WebSocket(url, { headers: { "CF-Connecting-IP": from } }) : new WebSocket(url);
  const seen = [];
  const waiters = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    msg.at = Date.now();
    seen.push(msg);
    for (const w of [...waiters]) {
      if (w.test(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  };
  return {
    ws,
    seen,
    send: (m) => ws.send(JSON.stringify(m)),
    wait: (test, ms = 8000) =>
      new Promise((resolve, reject) => {
        const old = seen.find(test);
        if (old) return resolve(old);
        const w = { test, resolve };
        waiters.push(w);
        setTimeout(() => reject(new Error("timed out waiting")), ms);
      }),
    opened: new Promise((resolve) => {
      ws.onopen = () => {
        if (hello && !oldForm) ws.send(JSON.stringify({ t: "hello", token: session.token }));
        resolve();
      };
    }),
    closed: new Promise((r) => (ws.onclose = (e) => r(e.code))),
    closedWith: new Promise((r) => ws.addEventListener("close", (e) => r({ code: e.code, reason: e.reason }))),
  };
}
const within = (promise, ms) => Promise.race([promise, sleep(ms).then(() => null)]);

const a = await post("/rooms", { nickname: "Ann" });
check(a.ok && /^\d{4}$/.test(a.pin) && a.seat === 0, "create a room: a 4-digit PIN and seat 1 (" + a.pin + ")");
const preview = await (await fetch(api + "/join/" + a.pin)).json();
check(preview.ok && preview.preview.players.join() === "Ann", "look the PIN up: the room and who is in it");
const qr = await fetch(api + "/qr.svg?text=" + encodeURIComponent(base + "/?join=" + a.pin));
check(qr.ok && (await qr.text()).includes("<svg"), "QR code as SVG");
const b = await post("/join/" + a.pin, { nickname: "Bo" });
check(b.ok && b.seat === 1 && b.code === a.code, "join by PIN with a nickname: seat 2");
const bad = await post("/join/0000", { nickname: "X" });
check(!bad.ok, "a wrong PIN is turned away");
// A page loaded before the seat's token left the socket's address does not mark its requests.
const stale = await post("/join/" + a.pin, { nickname: "Old" }, {});
check(stale.ok === false && stale.error === "page_outdated" && /reload/i.test(stale.message ?? ""), `a request to join without the client's mark is refused, with a line the old page shows: "${stale.message}"`);
const staleRoom = await post("/rooms", { nickname: "Old" }, {});
check(staleRoom.error === "page_outdated" && !staleRoom.token, "and so is one to make a room: no seat, no token");

const A = connect(a);
const B = connect(b, 150);
await Promise.all([A.opened, B.opened]);
const helloA = await A.wait((m) => m.t === "hello");
check(helloA.you.seat === 0 && !("seed" in helloA.room), "hello: your seat, and the room's seed stays in the room");
check(!A.ws.url.includes("token") && !A.ws.url.includes(a.token) && !B.ws.url.includes(b.token), "the socket's address names no token: " + new URL(A.ws.url).pathname + new URL(A.ws.url).search);

// The handshake. A socket that has not said whose it is has no seat and hears nothing.
const c = await post("/join/" + a.pin, { nickname: "Cy" });
const quiet = connect(c, 0, { hello: false });
await quiet.opened;
await A.wait((m) => m.t === "room" && m.room.seats[2]?.name === "Cy");
A.send({ t: "name", v: "Anna" });
await A.wait((m) => m.t === "room" && m.room.seats[0].name === "Anna");
await sleep(400);
check(quiet.seen.length === 0 && quiet.ws.readyState === 1, "a socket that has not said hello hears nothing of the room, and Cy is not connected by it");
check(A.seen.findLast((m) => m.room).room.seats[2].connected === false, "the seat it might have named is still not connected");
quiet.ws.send(JSON.stringify({ t: "ready", v: true }));
const shut = await within(quiet.closedWith, 3000);
check(shut?.code === 4001 && quiet.seen.length === 0, "anything but a hello as its first message closes it (4001), having heard nothing: " + JSON.stringify(shut));
const wrong = connect({ code: a.code, token: "not-a-token" });
const wrongShut = await within(wrong.closedWith, 3000);
check(wrongShut?.code === 4003 && wrongShut.reason === "bad_token" && wrong.seen.length === 0, "a hello with a wrong token is refused (4003), having heard nothing");
// The old form: the token in the address, as a page loaded before the deploy still opens its
// socket. Taken, for now, as a socket that said hello with that token at once.
const old = connect(c, 0, { oldForm: true });
const oldHello = await old.wait((m) => m.t === "hello", 3000).catch(() => null);
check(oldHello?.you?.seat === 2, "the old form, ?token= in the address, is taken as its hello: Cy's old page is seated in her seat");
const cyBack = await A.wait((m) => m.t === "room" && m.room.seats[2]?.connected === true, 3000).catch(() => null);
check(!!cyBack, "and the others see her connected");
// It plays as her seat: her leave, said on it, gives the seat up.
old.send({ t: "leave" });
const cyGone = await A.wait((m) => m.t === "room" && m.room.seats[2] === null, 3000).catch(() => null);
check(!!cyGone, "and a leave said on it gives her seat up");
// With a token that names nobody: closed, and told nothing, as a wrong hello is. (The room closes
// that socket before it has said anything, and the local runtime does not finish closing such a
// socket: a browser gives up waiting after two seconds and reports the close, Node does not. So
// the close is read here from the socket's state; its code is checked in the unit tests.)
const oldWrong = connect({ code: a.code, token: "not-a-token" }, 0, { oldForm: true });
await sleep(800);
check(oldWrong.ws.readyState >= 2 && oldWrong.seen.length === 0, "the old form with a token that names nobody is closed, having heard nothing");
// More sockets that say nothing than one address may keep waiting: its oldest are let go.
const idle = Array.from({ length: 12 }, () => connect(a, 0, { hello: false, from: "198.51.100.9" }));
await Promise.all(idle.map((s) => s.opened));
await sleep(500);
const stillOpen = idle.filter((s) => s.ws.readyState === 1).length;
check(stillOpen === 6 && idle.every((s) => s.seen.length === 0), `twelve sockets from one address that say nothing: the room keeps ${stillOpen} (six at most), and tells none of them anything`);
for (const s of idle) s.ws.close();
// Someone who knows the code opens 300 silent sockets from 40 addresses of their own while a
// phone's hello is on its way, more than the room lets wait at once: the phone is still seated.
{
  const cy = await post("/join/" + a.pin, { nickname: "Di" });
  const home = "203.0.113.70";
  const phone = connect(cy, 0, { hello: false, from: home });
  await phone.opened;
  const flood = Array.from({ length: 300 }, (_, i) => connect(a, 0, { hello: false, from: `2001:db8:${(100 + (i % 40)).toString(16)}::1` }));
  await Promise.all(flood.map((s) => s.opened));
  await sleep(250);
  phone.send({ t: "hello", token: cy.token });
  const seated = await phone.wait((m) => m.t === "hello", 3000).catch(() => null);
  check(!!seated && flood.every((s) => s.seen.length === 0), "a phone whose hello lands after 300 silent sockets from 40 other addresses is still seated, and none of them heard anything");
  // Leaving with a second socket of the same seat open: both are closed, not only the one that said so.
  const tab = connect(cy, 0, { from: home });
  await tab.wait((m) => m.t === "hello");
  phone.send({ t: "leave" });
  const tabShut = await within(tab.closedWith, 3000);
  check(tabShut?.code === 4003 && tabShut.reason === "left", "leaving closes the seat's other socket too (4003 left): " + JSON.stringify(tabShut));
  for (const s of flood) s.ws.close();
  await A.wait((m) => m.t === "room" && m.room.seats.filter(Boolean).length === 2, 3000);
  await sleep(300);
}
A.send({ t: "name", v: "Ann" });
await A.wait((m) => m.t === "room" && m.room.seats[0].name === "Ann");
const t1 = Date.now();
B.send({ t: "ping", c: t1 });
const pong = await B.wait((m) => m.t === "pong");
check(pong.at - t1 >= 290, "simulated latency: a ping at 150 ms each way takes " + (pong.at - t1) + " ms");
A.send({ t: "ready", v: true });
B.send({ t: "ready", v: true });
await A.wait((m) => m.t === "room" && m.room.canStart);
A.send({ t: "start" });
const start = await B.wait((m) => m.t === "start");
check(start.room.phase === "playing" && start.s && start.room.seats.filter(Boolean).length === 2, "start: both players get the round and its first snapshot");

// Inputs only: fire once and see the room relay it to the other player.
const fireAt = (Date.now() - start.s.startAt) / 1000 - 3 + 3.5;
await sleep(3600);
A.send({ t: "in", d: { f: [fireAt, 0, 1.12] } });
const relayed = await B.wait((m) => m.t === "ev" && m.ev.some((e) => e.k === "f" && e.seat === 0), 5000).catch(() => null);
check(!!relayed, "an input from one seat reaches the other as an event");

// Drop and come back.
B.ws.close();
const away = await A.wait((m) => m.t === "room" && m.room.seats[1].kind === "bot" && m.room.seats[1].away);
check(!!away, "a dropped player's seat is played by a stand-in at once");
await sleep(1500);
const B2 = connect(b);
await B2.opened;
const hello2 = await B2.wait((m) => m.t === "hello");
check(hello2.you.seat === 1, "the same token gets the same seat back");
const snap = await B2.wait((m) => m.t === "snap" && m.full);
check(snap.s.stalls.length === 2, "and a full snapshot to rebuild the picture from");
const back = await A.wait((m) => m.t === "room" && m.at > away.at && m.room.seats[1].kind === "human" && m.room.seats[1].connected);
check(!!back, "everyone sees them back");

if (full) {
  console.log("waiting for the round to end (up to about 95 seconds from its start)...");
  const end = await A.wait((m) => m.t === "end", 130000).catch(() => null);
  check(!!end, "the round ends");
  if (end) {
    // Timed on the room's clock, from what the room sent: the game's start, the moment it called
    // time ({k: "time"}, in round seconds), the last snapshot (the game over) and the end. This
    // run is a kit test, run from a game's own repository too, so it knows none of the game's
    // numbers and reads them all off the wire: the count-in is how far before round time 0 the
    // first snapshot was, and a round ends early when the game says so (Cork & Bell: when its
    // stalls run out of corks). What the room must do is end the round when the game is over,
    // no sooner and no later: the end comes with the game's last snapshot, which says it is over,
    // a short hold after the game called time, and never before.
    const seconds = (end.now - start.s.startAt) / 1000;
    const countIn = (start.now - start.s.startAt) / 1000 - start.s.t - start.s.delay;
    const called = A.seen.find((m) => m.t === "ev" && m.ev.some((e) => e.k === "time"));
    const timeAt = called?.ev.find((e) => e.k === "time").t ?? null;
    const last = A.seen.findLast((m) => m.t === "snap" && m.now <= end.now);
    const hold = called ? (end.now - called.now) / 1000 : null;
    const scoring = last?.s.stalls?.filter((s) => !s.over).length ?? null;
    check(
      called && last?.now === end.now && last.s.over === true && hold > 0 && hold < 2 && Math.abs(seconds - (countIn + start.s.delay + timeAt + hold)) < 0.05,
      `it lasts the count-in (${countIn.toFixed(1)} s), the round until the game called time (${timeAt?.toFixed(1)} s: ${scoring >= 2 ? "its clock ran out" : "its stalls ran dry"}) and the hold (${hold?.toFixed(2)} s), and the room ends it with the game's last snapshot: ${seconds.toFixed(1)} s`,
    );
    check(Array.isArray(end.result) && end.result.length === 2, "with a result for every seat");
    A.send({ t: "ready", v: true });
    B2.send({ t: "ready", v: true });
    const again = await A.wait((m) => m.t === "start" && m.at > end.at, 5000).catch(() => null);
    check(!!again && again.room.round === 2, "instant rematch when everyone is ready again");
  }
}
// The score board, on the board kept for these runs (never a game's own).
const scoresUrl = api + "/scores/e2e-test";
const postScore = async (body, headers = {}) => {
  const res = await fetch(scoresUrl, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const mark = 1 + Math.floor(Math.random() * 999);
const posted = await postScore({ name: "eto", score: mark });
check(posted.ok && posted.top.some((r) => r.name === "ETO" && r.score === mark) === posted.place >= 0, "score board: a score with three letters is taken (and chalked up if it makes the ten)");
const listed = await (await fetch(scoresUrl)).json();
check(listed.ok && listed.top.length <= 10 && listed.top.every((r, i, all) => i === 0 || all[i - 1].score >= r.score), "score board: at most ten, best first");
check((await postScore({ name: "ab", score: 5 })).error === "bad_name", "score board: two letters are turned away");
check((await postScore({ name: "ass", score: 5 })).error === "bad_name", "score board: rude letters are turned away");
check((await postScore({ name: "ETO", score: 1001 })).status === 400, "score board: a score above what a round can reach is turned away");
check((await postScore({ name: "ETO", score: 5, pad: "x".repeat(300) })).status === 400, "score board: a large body is turned away");
check((await postScore({ name: "ETO", score: 5 }, { Origin: "https://elsewhere.example" })).status === 403, "score board: another site's page is turned away");
check((await fetch(api + "/scores/no-such-game")).status === 404, "score board: no board for a game that has none");

A.ws.close();
B2.ws.close();
console.log(problems.length ? "FAILED: " + problems.length : "PASSED");
process.exit(problems.length ? 1 : 0);
