// End to end: a tiny room budget closes battles after one round, waiting in the lobby is free, and the
// per-address limit refuses a burst of new rooms. It needs its own server with a tiny budget:
//
//   npx wrangler dev --local --port 8793 --persist-to <empty folder> \
//     --var PARTY_ROOM_BUDGET_SHARE:0.00001 --var PARTY_RATE_LIMIT:on
//   node party-kit/test/e2e-budget.mjs http://localhost:8793
const base = process.argv[2];
const post = (path, body) => fetch(base + path, { method: "POST", body: JSON.stringify(body), headers: { "CF-Connecting-IP": "203.0.113.9" } }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
const say = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) process.exitCode = 1;
};

const a = await post("/api/party/rooms", { nickname: "Ann" });
say(a.status === 201, "first room is made (" + a.status + ")");

const ws = new WebSocket(base.replace("http", "ws") + `/api/party/rooms/${a.code}/ws?token=${a.token}`);
const errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.t === "error") errors.push(m);
});
await new Promise((r) => ws.addEventListener("open", r));

// Waiting in the lobby is free: the room sleeps, so nothing is spent however long people wait.
await new Promise((r) => setTimeout(r, 5000));
const early = await post("/api/party/rooms", { nickname: "Bo" });
say(early.status === 201, "after waiting in the lobby, a second room is still allowed (" + early.status + ")");

// A round is what counts. Play one to the end; the room reports its awake time as it goes.
let ended = false;
ws.addEventListener("message", (e) => {
  if (JSON.parse(e.data).t === "end") ended = true;
});
ws.send(JSON.stringify({ t: "ready", v: true }));
ws.send(JSON.stringify({ t: "start" }));
console.log("     round started, waiting for it to end");
for (let i = 0; i < 150 && !ended; i++) await new Promise((r) => setTimeout(r, 1000));
say(ended, "the round ran to its end");
await new Promise((r) => setTimeout(r, 1000));

const b = await post("/api/party/rooms", { nickname: "Cy" });
say(b.status === 503 && b.error === "battles_full", `after the round, a new room is refused: ${b.status} ${b.error} "${b.message}"`);

ws.send(JSON.stringify({ t: "ready", v: true }));
await new Promise((r) => setTimeout(r, 1500));
say(errors.some((m) => m.error === "battles_full"), "the open room cannot start another round: " + JSON.stringify(errors.map((m) => m.error)));
ws.close();

const rest = [];
for (let i = 0; i < 3; i++) rest.push((await post("/api/party/rooms", { nickname: "X" })).status);
say(rest.at(-1) === 429, "sixth room from one address in ten minutes is rate limited: " + rest.join(", "));
