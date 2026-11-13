// Emotes, end to end: real pages and real sockets in one room, against a running local server.
// The browser is headless and MUTED (it also asks for a tap before sound, as phones do), and is
// closed at the end whatever happens.
//
//   node lobby/test/e2e-emotes.mjs [--base=http://localhost:8791]
//
// What it goes through:
//   the room's word    an emote reaches everybody else once; the 1.5 s cooldown is the room's,
//                      and it says how long is left; nothing it does sets a wake-up or a timer
//   flooding           a script hammering the button is closed; the others see one or two
//   a game in play     emotes go through; their sounds stay quiet unless the game allows them
//   an emote's sound   with no big screen, on the players' devices; with one, on the screen
//                      only; nothing before a tap and nothing late after it; a muted player
//
// No emote has a recording yet (they wait on the owner's picks), so the pages are given a tiny
// tone made here for one emote, as a data: URI.
import { chromium } from "playwright";
import { EMOTE_COOLDOWN_MS } from "../../party-kit/client/emotes.js";
import { boxCentre } from "../shared/world.js";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const { api, call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const section = (name) => console.log("\n     -- " + name);
const debug = async (code) => (await (await fetch(api + "/debug/" + code)).json()).room;
const quiet = (c, ms = 600) => sleep(ms).then(() => c.seen.filter((m) => m.t === "e" || m.t === "wait"));

/** A quarter of a second of a soft tone, as a WAV data: URI. */
function tone() {
  const rate = 8000;
  const n = rate / 4;
  const data = Buffer.alloc(44 + n * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + n * 2, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000 * Math.min(1, (n - i) / 400)), 44 + i * 2);
  return "data:audio/wav;base64," + data.toString("base64");
}
const TONE = tone();

const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--autoplay-policy=user-gesture-required"] });
try {
  const errors = [];
  async function open(name, viewport = { width: 844, height: 390 }) {
    const context = await browser.newContext({ viewport, hasTouch: true });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    return page;
  }
  /** What a page's player did with the sounds it was asked to play, oldest first. */
  const heard = (page) => page.evaluate(() => globalThis.__partyRoom.sounds.log.map((l) => l.what));
  const notes = (page) => page.evaluate(() => [...document.querySelectorAll(".note")].map((n) => n.textContent));
  const giveTone = (page) => page.evaluate((uri) => globalThis.__partyRoom.defineSound("slowclap", uri), TONE);

  // ================================================================ the room's word
  section("the room's word: relays once, enforces the cooldown");
  const host = await call("POST", "/rooms", { nickname: "Mabel" });
  const tomSeat = await call("POST", "/join/" + host.pin, { nickname: "Tom" });
  const [mabel, tom] = [host, tomSeat].map(connect);
  await Promise.all([mabel.opened, tom.opened]);
  await mabel.wait((m) => m.room?.members.filter((x) => x?.connected).length === 2, 8000, 0);
  const before = await debug(host.code);

  mabel.send({ t: "e", e: "violin" });
  const got = await tom.wait((m) => m.t === "e", 3000);
  check(got.s === mabel.seat && got.e === "violin", "Tom sees Mabel's violin");
  mabel.send({ t: "e", e: "popcorn" });
  const wait = await mabel.wait((m) => m.t === "wait", 3000);
  check(wait.in > EMOTE_COOLDOWN_MS - 600 && wait.in <= EMOTE_COOLDOWN_MS, `a second emote straight after is refused, with ${wait.in} ms left`);
  check((await quiet(tom)).filter((m) => m.t === "e").length === 1 && !mabel.seen.some((m) => m.t === "e"), "Tom saw one emote, and the room never echoes it back to Mabel");
  await sleep(EMOTE_COOLDOWN_MS);
  mabel.send({ t: "e", e: "slowclap" });
  check((await tom.wait((m) => m.t === "e" && m.e === "slowclap", 3000)).s === mabel.seat, "after 1.5 s the next emote goes through");
  mabel.send({ t: "e", e: "no-such-emote" });
  mabel.send({ t: "sb", k: "horn" });
  check((await quiet(tom)).filter((m) => m.t === "e").length === 2, "an emote that does not exist, and the soundboard message that no longer exists, are ignored");
  const after = await debug(host.code);
  check(!after.timer && (after.alarmIn === null || before.alarmIn === null || after.alarmIn >= before.alarmIn - 20_000), "nothing it did set a timer or brought a wake-up closer");

  // ================================================================ flooding
  section("flooding: a script hammering the button loses its connection");
  const pestSeat = await call("POST", "/join/" + host.pin, { nickname: "Pest" });
  const pest = connect(pestSeat);
  await pest.opened;
  await tom.wait((m) => m.room?.members[pest.seat]?.connected, 5000, 0);
  const tomBefore = tom.seen.length;
  const started = Date.now();
  const hammer = setInterval(() => pest.send({ t: "e", e: "boo" }), 50);
  const closed = await Promise.race([pest.closed, sleep(6000).then(() => null)]);
  clearInterval(hammer);
  check(closed?.code === 4008, `the hammering socket is closed (${closed ? closed.code + " " + closed.reason : "still open"}) after ${Date.now() - started} ms`);
  const relayed = tom.seen.slice(tomBefore).filter((m) => m.t === "e" && m.s === pest.seat).length;
  check(relayed <= 2, `and the others saw ${relayed} of its emotes`);

  // ================================================================ a game in play
  section("during a game: emotes go through (Coin Flip says nothing)");
  const N = mabel.room.boxes.length;
  const coin = mabel.room.boxes.findIndex((b) => b.id === "coin-flip");
  const gameFrom = mabel.seen.length;
  for (const c of [mabel, tom]) c.goto(Math.round(boxCentre(coin, N)));
  await mabel.wait((m) => m.t === "start", 9000, gameFrom);
  await sleep(EMOTE_COOLDOWN_MS);
  mabel.send({ t: "e", e: "heart" });
  check((await tom.wait((m) => m.t === "e" && m.e === "heart", 3000)).s === mabel.seat, "an emote during the game goes through");
  await mabel.wait((m) => m.t === "end", 15000, gameFrom);
  mabel.ws.close();
  tom.ws.close();

  // ================================================================ an emote's sound
  section("no big screen: an emote's sound plays on the players' devices, after a tap");
  const phone = await open("phone");
  const party = await call("POST", "/rooms", { nickname: "Ada" });
  const ada = connect(party);
  await ada.opened;
  await phone.goto(base + "/lobby/?join=" + party.pin);
  await phone.waitForSelector(".door-title");
  await phone.fill("input[name=nickname]", "Bea");
  await phone.click("text=Join the party");
  await phone.waitForSelector("svg.scene text");
  // A reload: the page comes back to its seat with no tap yet, as a phone that was put away does.
  await phone.reload();
  await phone.waitForSelector("svg.scene text");
  await giveTone(phone);
  await sleep(600);
  ada.send({ t: "e", e: "slowclap" });
  await phone.waitForFunction(() => globalThis.__partyRoom.sounds.log.length >= 1, null, { timeout: 4000 });
  check((await heard(phone)).join() === "locked", "before any tap, the sound is not played: " + (await heard(phone)).join());
  check((await notes(phone)).some((t) => t.includes("Ada: Slow clap")), "but the page still says who did it");
  await phone.locator("svg.scene").dispatchEvent("pointerdown");
  await phone.waitForFunction(() => globalThis.__partyRoom.sounds.unlocked, null, { timeout: 4000 });
  await sleep(500);
  check((await heard(phone)).join() === "locked" && (await phone.evaluate(() => globalThis.__partyRoom.sounds.voices.length)) === 0, "a tap unlocks sound, and the one from before does not play late");
  await sleep(EMOTE_COOLDOWN_MS);
  ada.send({ t: "e", e: "slowclap" });
  await phone.waitForFunction(() => globalThis.__partyRoom.sounds.log.length >= 2, null, { timeout: 4000 });
  check((await heard(phone)).at(-1) === "played", "after the tap the next one plays on the phone");
  await sleep(EMOTE_COOLDOWN_MS);
  ada.send({ t: "e", e: "violin" });
  await sleep(500);
  check((await heard(phone)).length === 2, "an emote with no sound plays nothing");

  section("muting a player: their sound is silent here, their name still shows");
  await phone.evaluate(() => globalThis.__partyRoom.sounds.mutePlayer("Ada", true));
  await sleep(EMOTE_COOLDOWN_MS);
  ada.send({ t: "e", e: "slowclap" });
  await phone.waitForFunction(() => globalThis.__partyRoom.sounds.log.length >= 3, null, { timeout: 4000 });
  check((await heard(phone)).at(-1) === "muted", "Ada's slow clap is muted on Bea's phone");
  const kept = await phone.evaluate(() => JSON.parse(localStorage.getItem("party-kit:sound")));
  check(kept.players.names.includes("ada") && kept.players.room === party.code, "the mute is kept on the device, for this party");
  await phone.evaluate(() => globalThis.__partyRoom.sounds.mutePlayer("Ada", false));

  section("with a big screen: the sound comes from the screen only");
  const screen = await open("screen", { width: 1280, height: 720 });
  await screen.goto(base + "/lobby/?join=" + party.pin + "&as=screen");
  await screen.waitForSelector(".door-title");
  await screen.click("text=Show the room here");
  await screen.waitForSelector("svg.scene text");
  await giveTone(screen);
  await sleep(800);
  const phoneBefore = (await heard(phone)).length;
  await sleep(EMOTE_COOLDOWN_MS);
  ada.send({ t: "e", e: "slowclap" });
  await screen.waitForFunction(() => globalThis.__partyRoom.sounds.log.length >= 1, null, { timeout: 4000 });
  await sleep(400);
  check((await heard(screen)).at(-1) === "played", "the screen plays it (it was clicked on its way in)");
  check((await heard(phone)).length === phoneBefore, "the phone does not");
  check((await notes(phone)).some((t) => t.includes("Ada: Slow clap")) && (await notes(screen)).some((t) => t.includes("Ada: Slow clap")), "both say who did it");
  ada.ws.close();

  check(errors.length === 0, "no page reported an error" + (errors.length ? ": " + errors.join(" | ") : ""));
} finally {
  await browser.close();
}

console.log(problems.length ? `\n${problems.length} problem(s).` : "\nAll good.");
process.exit(problems.length ? 1 : 0);
