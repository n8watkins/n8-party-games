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
const post = async (path, body) => (await fetch(api + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(session, lag = 0) {
  const url = new URL(api + "/rooms/" + session.code + "/ws", base);
  url.protocol = "ws:";
  url.searchParams.set("token", session.token);
  if (lag) url.searchParams.set("lag", String(lag));
  const ws = new WebSocket(url);
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
    opened: new Promise((r) => (ws.onopen = r)),
    closed: new Promise((r) => (ws.onclose = (e) => r(e.code))),
  };
}

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

const A = connect(a);
const B = connect(b, 150);
await Promise.all([A.opened, B.opened]);
const helloA = await A.wait((m) => m.t === "hello");
check(helloA.you.seat === 0 && helloA.room.seed > 0, "hello: your seat and the room's seed");
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
  console.log("waiting for the round to end (about 95 seconds from its start)...");
  const end = await A.wait((m) => m.t === "end", 130000).catch(() => null);
  check(!!end, "the round ends");
  if (end) {
    const seconds = (end.at - start.s.startAt) / 1000;
    check(Math.abs(seconds - 94.5) < 2.5, "it lasts 3 s count-in + 90 s + the hold: " + seconds.toFixed(1) + " s");
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
