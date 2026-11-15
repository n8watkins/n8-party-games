// End to end against the production settings (the top level of wrangler.jsonc), run locally.
// It needs its own server with fresh storage, so earlier runs do not count against the limits:
//
//   npx wrangler dev --local --env="" --port 8804 --local-upstream localhost:8804 --persist-to <empty folder>
//   node party-kit/test/e2e-production.mjs http://localhost:8804
//
// --local-upstream keeps the local address: without it, the top level's custom domain would be
// the Worker's own address, and this site's local join links would not get a QR code.
//
// Checks: no test switch is on, ?lag= is refused, a sixth room from one address in ten minutes is
// rate limited, other sites' pages are turned away, the QR endpoint draws only join links, and the
// API's security headers.
import http from "node:http";

const base = process.argv[2] ?? "http://localhost:8804";
const api = base + "/api/party";
const problems = [];
const say = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
// Each run uses its own made-up address, so the limits start from zero.
const ip = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
const post = (path, body, headers = {}) =>
  fetch(api + path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...headers } }).then(async (r) => ({ status: r.status, headers: r.headers, ...(await r.json()) }));

/**
 * Opens a socket and says hello with `token` (the seat's token is the first message, never in
 * the address); resolves with the first message, the close, or the failure.
 */
function socket(path, token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(base.replace(/^http/, "ws") + path);
    const t = setTimeout(() => resolve({ outcome: "timeout" }), 8000);
    const done = (result) => {
      clearTimeout(t);
      resolve(result);
    };
    ws.onopen = () => token && ws.send(JSON.stringify({ t: "hello", token }));
    ws.onmessage = (e) => {
      done({ outcome: "message", msg: JSON.parse(e.data) });
      ws.close();
    };
    ws.onclose = (e) => done({ outcome: "closed", code: e.code, reason: e.reason });
    ws.onerror = () => done({ outcome: "refused" });
  });
}

/** Asks for a socket with a plain HTTP request, to see the status (fetch() may not send Upgrade). */
function upgradeStatus(path, headers = {}) {
  return new Promise((resolve) => {
    const r = http.get(base + path, { headers: { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    r.on("upgrade", (res, sock) => {
      sock.destroy();
      resolve(101);
    });
    r.on("error", () => resolve("error"));
  });
}

const config = await (await fetch(api + "/config")).json();
say(config.simLatency === false, "simulated latency is off");
say(config.turnstileSiteKey === null, "no bot check without keys");

const a = await post("/rooms", { nickname: "Ann" });
say(a.status === 201, `a room is made (${a.status})`);
say(a.headers.get("x-content-type-options") === "nosniff" && a.headers.get("cache-control") === "no-store", "API answers carry nosniff and no-store");

const lagged = await socket(`/api/party/rooms/${a.code}/ws?lag=150`, a.token);
say(lagged.outcome === "refused", `a socket asking for ?lag=150 is refused (${lagged.outcome})`);
const lagStatus = await upgradeStatus(`/api/party/rooms/${a.code}/ws?lag=150`);
say(lagStatus === 400, `and the refusal is a 400 with no room touched (${lagStatus})`);
const plain = await socket(`/api/party/rooms/${a.code}/ws`, a.token);
say(plain.outcome === "message" && plain.msg.t === "hello", "the same socket without ?lag, with the token as its first message, connects");

// The old form, with the token in the address: refused, and the seat it named is given up.
const b = await post(`/join/${a.pin}`, { nickname: "Bo" });
// (Node does not hear the room close a socket that never spoke, so the refusal is read from what
// it did; the close code is checked in the unit tests and from a real page in lobby/test/e2e-cork.mjs.)
const old = new WebSocket(base.replace(/^http/, "ws") + `/api/party/rooms/${a.code}/ws?token=${b.token}`);
let oldHeard = 0;
old.onmessage = () => (oldHeard += 1);
await new Promise((r) => setTimeout(r, 800));
say(old.readyState >= 2 && oldHeard === 0, `the old form, ?token= in the address, is refused: the socket is closed and told nothing (state ${old.readyState})`);
const burned = await socket(`/api/party/rooms/${a.code}/ws`, b.token);
say(burned.outcome === "closed" && burned.code === 4003, `and the token that came in an address opens nothing any more (${JSON.stringify(burned)})`);

// One address may open only so many sockets a minute, good token or none: each one wakes the room.
{
  const from = { "CF-Connecting-IP": `198.51.100.${1 + Math.floor(Math.random() * 250)}` };
  const got = [];
  for (let i = 0; i < 125; i++) got.push(await upgradeStatus(`/api/party/rooms/${a.code}/ws`, from));
  const through = got.filter((status) => status === 101).length;
  say(through === 120 && got.slice(120).every((status) => status === 429), `sockets from one address: 120 in a minute go through, the rest are limited (${through} of 125, then ${got.at(-1)})`);
  say((await upgradeStatus(`/api/party/rooms/${a.code}/ws`, { "CF-Connecting-IP": "203.0.113.200" })) === 101, "and another address is not held up by it");
}

const foreign = await post("/rooms", { nickname: "Eve" }, { Origin: "https://evil.example" });
say(foreign.status === 403 && foreign.error === "forbidden_origin", `a page on another site cannot make rooms (${foreign.status})`);

const qrOwn = await fetch(api + "/qr.svg?text=" + encodeURIComponent(`${base}/cork-and-bell/?join=${a.pin}`));
say(qrOwn.ok && (await qrOwn.text()).includes("<svg"), "the QR endpoint draws this site's join link");
const qrOther = await fetch(api + "/qr.svg?text=" + encodeURIComponent("https://evil.example/pay-me"));
say(qrOther.status === 400, `and refuses anything else (${qrOther.status})`);

const statuses = [];
for (let i = 0; i < 5; i++) statuses.push((await post("/rooms", { nickname: "Bo" })).status);
say(statuses.slice(0, 4).every((s) => s === 201) && statuses[4] === 429, "the sixth room from one address in ten minutes is rate limited: " + [a.status, ...statuses].join(", "));

console.log(problems.length ? "FAILED: " + problems.length : "PASSED");
process.exit(problems.length ? 1 : 0);
