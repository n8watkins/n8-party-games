// End to end: a tiny room budget closes battles after one minute of room time, and the
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
console.log("     room open, waiting 66 s for its first report to the budget");
await new Promise((r) => setTimeout(r, 66_000));

const b = await post("/api/party/rooms", { nickname: "Bo" });
say(b.status === 503 && b.error === "battles_full", `second room is refused: ${b.status} ${b.error} "${b.message}"`);

ws.send(JSON.stringify({ t: "addBot" }));
ws.send(JSON.stringify({ t: "ready", v: true }));
ws.send(JSON.stringify({ t: "start" }));
await new Promise((r) => setTimeout(r, 1500));
say(errors.some((m) => m.error === "battles_full"), "the open room cannot start a round: " + JSON.stringify(errors.map((m) => m.error)));
ws.close();

const rest = [];
for (let i = 0; i < 4; i++) rest.push((await post("/api/party/rooms", { nickname: "X" })).status);
say(rest.at(-1) === 429, "sixth room from one address in ten minutes is rate limited: " + rest.join(", "));
