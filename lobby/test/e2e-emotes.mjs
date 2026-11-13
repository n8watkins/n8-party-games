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
//   the wheel          a tap opens it, a pick sends it; a number key sends one; the piece
//                      performs it with its word over its head; the ring shows the cooldown
//   an emote's sound   with no big screen, on the players' devices; with one, on the screen
//                      only; nothing before a tap and nothing late after it; a muted player;
//                      the one-tap mute, kept on the device
//   the room's sounds  a phone hears its own steps and jump; with a big screen the room's
//                      shared sounds (someone joining) come from the screen, not the phones;
//                      no sound file is fetched before the room is drawn
//
// The sounds are the room's own recordings (lobby/public/sounds).
import { chromium } from "playwright";
import { EMOTE_COOLDOWN_MS } from "../../party-kit/client/emotes.js";
import { COUNT_MS } from "../shared/vote.js";
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
  /** What a page's player did with the emote sounds it was asked to play, oldest first. */
  const heard = (page) => page.evaluate(() => globalThis.__partyRoom.sounds.log.filter((l) => l.name.startsWith("emote-")).map((l) => l.what));
  /** Every sound a page was asked for, by name, with what came of it. */
  const asked = (page) => page.evaluate(() => globalThis.__partyRoom.sounds.log.map((l) => `${l.name}:${l.what}`));
  /** The word over a piece's head, if an emote is on. */
  const sticker = (page, word) =>
    page
      .waitForFunction((w) => [...document.querySelectorAll(".emote-sticker")].some((g) => g.getAttribute("display") !== "none" && g.textContent === w), word, { timeout: 2500 })
      .then(() => word, async () => page.evaluate(() => [...document.querySelectorAll(".emote-sticker")].map((g) => g.getAttribute("display") + "/" + g.textContent).join(" ")));

  // ================================================================ the room's word
  section("the room's word: relays once, enforces the cooldown");
  const host = await call("POST", "/rooms", { nickname: "Mabel" });
  const tomSeat = await call("POST", "/join/" + host.pin, { nickname: "Tom" });
  const [mabel, tom] = [host, tomSeat].map(connect);
  await Promise.all([mabel.opened, tom.opened]);
  await mabel.wait((m) => m.room?.members.filter((x) => x?.connected).length === 2, 8000, 0);
  const before = await debug(host.code);

  mabel.send({ t: "e", e: "tomato" });
  const got = await tom.wait((m) => m.t === "e", 3000);
  check(got.s === mabel.seat && got.e === "tomato", "Tom sees Mabel's tomato");
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
  await mabel.wait((m) => m.t === "start", COUNT_MS + 6000, gameFrom);
  await sleep(EMOTE_COOLDOWN_MS);
  mabel.send({ t: "e", e: "lighter" });
  check((await tom.wait((m) => m.t === "e" && m.e === "lighter", 3000)).s === mabel.seat, "an emote during the game goes through");
  await mabel.wait((m) => m.t === "end", 15000, gameFrom);
  mabel.ws.close();
  tom.ws.close();

  // ================================================================ an emote's sound
  section("no big screen: an emote's sound plays on the players' devices, after a tap");
  const phone = await open("phone");
  const fetched = [];
  phone.on("request", (r) => r.url().includes("/lobby/sounds/") && fetched.push({ url: r.url(), at: Date.now() }));
  const party = await call("POST", "/rooms", { nickname: "Ada" });
  const ada = connect(party);
  await ada.opened;
  await phone.goto(base + "/lobby/?join=" + party.pin);
  await phone.waitForSelector(".door-title");
  await phone.fill("input[name=nickname]", "Bea");
  await phone.click("text=Join the party");
  await phone.waitForSelector("svg.scene text");
  // A reload: the page comes back to its seat with no tap yet, as a phone that was put away does.
  fetched.length = 0;
  await phone.reload();
  await phone.waitForSelector("svg.scene text");
  fetched.length = 0;
  await sleep(1500);
  check(fetched.length === 0, `no sound file is fetched before sound is allowed (${fetched.map((f) => f.url.split("/").pop()).join(", ")})`);
  ada.send({ t: "e", e: "slowclap" });
  await phone.waitForFunction(() => globalThis.__partyRoom.sounds.log.some((l) => l.name.startsWith("emote-")), null, { timeout: 4000 });
  check((await heard(phone)).join() === "locked", "before any tap, the sound is not played: " + (await heard(phone)).join());
  check((await sticker(phone, "*clap*")) === "*clap*", "but Ada's piece claps, with its word over its head");
  await phone.locator("svg.scene").dispatchEvent("pointerdown");
  await phone.waitForFunction(() => globalThis.__partyRoom.sounds.unlocked, null, { timeout: 4000 });
  await sleep(500);
  check((await heard(phone)).join() === "locked" && (await phone.evaluate(() => globalThis.__partyRoom.sounds.voices.length)) === 0, "a tap unlocks sound, and the one from before does not play late");
  await phone.waitForFunction(() => globalThis.__partyRoom.sounds.decoded.size >= 20, null, { timeout: 15000 }).catch(() => {});
  check(fetched.length >= 20, `once sound is allowed, the room's sounds are fetched (${fetched.length} files)`);
  await sleep(EMOTE_COOLDOWN_MS);
  ada.send({ t: "e", e: "slowclap" });
  await phone.waitForFunction(() => globalThis.__partyRoom.sounds.log.filter((l) => l.name.startsWith("emote-")).length >= 2, null, { timeout: 4000 });
  check((await heard(phone)).at(-1) === "played", "after the tap the next one plays on the phone");

  section("the wheel: tap to open, tap one to send; a number key; the ring");
  await phone.locator(".ctl-emote").click();
  await phone.waitForSelector(".wheel-pick");
  check((await phone.locator(".wheel-pick").count()) === 6, "the wheel holds six");
  const names = await phone.locator(".wheel-name").allTextContents();
  check(names.join() === "Popcorn,Slow clap,Laugh,Red card,Thumbs up,Tomato", "the starter six: " + names.join(", "));
  const adaFrom = ada.seen.length;
  await phone.locator(".wheel-pick").nth(5).click();
  const thrown = await ada.wait((m) => m.t === "e", 3000, adaFrom);
  check(thrown.e === "tomato" && (await phone.locator(".wheel-pick").count()) === 0, "a tap on the tomato sends it to the room, and the wheel closes");
  await sleep(300);
  check((await sticker(phone, "splat!")) === "splat!", "Bea's own piece throws it at once, on her phone");
  check(await phone.locator(".ctl-emote.cooling").count() === 1, "the button recharges, with its ring");
  check((await asked(phone)).at(-1)?.startsWith("emote-tomato"), "and with no big screen, her own phone plays its sound");
  await phone.keyboard.press("2");
  await sleep(400);
  check(ada.seen.slice(adaFrom).filter((m) => m.t === "e").length === 1, "a number key during the cooldown sends nothing");
  await sleep(EMOTE_COOLDOWN_MS);
  check(await phone.locator(".ctl-emote.cooling").count() === 0, "after 1.5 s it is ready again");
  await phone.keyboard.press("2");
  check((await ada.wait((m) => m.t === "e" && m.e === "slowclap", 3000, adaFrom)).s !== ada.seat, "key 2 sends the second on the wheel");

  section("the wheel's six are the player's own, kept on the device");
  await phone.keyboard.press("Escape");
  await phone.click("text=Your emote wheel");
  await phone.locator(".loadout-slot").nth(0).click();
  await phone.locator(".loadout-emote", { hasText: "Fuming" }).click();
  await phone.click("text=Done");
  const kept6 = await phone.evaluate(() => JSON.parse(localStorage.getItem("party-room:wheel")));
  check(kept6[0] === "steam" && kept6.length === 6, "Fuming is on slot 1, and kept: " + kept6.join(", "));

  section("muting a player: their sound is silent here, their emote still shows");
  await phone.evaluate(() => globalThis.__partyRoom.sounds.mutePlayer("Ada", true));
  await sleep(EMOTE_COOLDOWN_MS);
  ada.send({ t: "e", e: "slowclap" });
  await phone.waitForFunction(() => globalThis.__partyRoom.sounds.log.filter((l) => l.name === "emote-slowclap").length >= 3, null, { timeout: 4000 });
  check((await heard(phone)).at(-1) === "muted", "Ada's slow clap is muted on Bea's phone");
  const kept = await phone.evaluate(() => JSON.parse(localStorage.getItem("party-kit:sound")));
  check(kept.players.names.includes("ada") && kept.players.room === party.code, "the mute is kept on the device, for this party");
  await phone.evaluate(() => globalThis.__partyRoom.sounds.mutePlayer("Ada", false));

  section("the room's own sounds on a phone with no screen");
  const mark = (await asked(phone)).length;
  await phone.keyboard.down("ArrowRight");
  await sleep(1200);
  await phone.keyboard.up("ArrowRight");
  await phone.keyboard.press("ArrowUp");
  await sleep(900);
  const mine = (await asked(phone)).slice(mark);
  check(mine.some((x) => x.startsWith("step-")) && mine.some((x) => x.startsWith("jump:")) && mine.some((x) => x.startsWith("land:")), "Bea hears her own steps, jump and landing: " + [...new Set(mine.map((x) => x.split(":")[0]))].join(", "));

  section("the one-tap mute: everything off, kept on the device");
  await phone.locator(".sound-btn").click();
  check((await phone.evaluate(() => JSON.parse(localStorage.getItem("party-kit:sound")).muted)) === true, "one tap, and sound is off on this device");
  await phone.keyboard.press("ArrowUp");
  await sleep(300);
  check((await asked(phone)).at(-1) === "jump:muted", "and a jump is silent");
  await phone.locator(".sound-btn").click();

  section("with a big screen: shared sounds come from the screen only");
  const screen = await open("screen", { width: 1280, height: 720 });
  await screen.goto(base + "/lobby/?join=" + party.pin + "&as=screen");
  await screen.waitForSelector(".door-title");
  await screen.click("text=Show the room here");
  await screen.waitForSelector("svg.scene text");
  await sleep(800);
  const phoneBefore = (await heard(phone)).length;
  await sleep(EMOTE_COOLDOWN_MS);
  ada.send({ t: "e", e: "slowclap" });
  await screen.waitForFunction(() => globalThis.__partyRoom.sounds.log.some((l) => l.name === "emote-slowclap"), null, { timeout: 4000 });
  await sleep(400);
  check((await heard(screen)).at(-1) === "played", "the screen plays the emote's sound (it was clicked on its way in)");
  check((await heard(phone)).length === phoneBefore, "the phone does not");
  check((await sticker(phone, "*clap*")) === "*clap*" && (await sticker(screen, "*clap*")) === "*clap*", "both show it");
  const phoneMark = (await asked(phone)).length;
  const screenMark = (await asked(screen)).length;
  const cy = connect(await call("POST", "/join/" + party.pin, { nickname: "Cy" }));
  await cy.opened;
  await screen.waitForFunction((n) => globalThis.__partyRoom.sounds.log.slice(n).some((l) => l.name === "join"), screenMark, { timeout: 4000 });
  await phone.keyboard.press("ArrowUp");
  await sleep(500);
  const phoneHeard = (await asked(phone)).slice(phoneMark);
  check(!phoneHeard.some((x) => x.startsWith("join:")), "Cy coming in chimes on the screen, not on Bea's phone");
  check(phoneHeard.some((x) => x.startsWith("jump:")), "while Bea's own jump still sounds on her phone");
  cy.ws.close();
  ada.ws.close();

  check(errors.length === 0, "no page reported an error" + (errors.length ? ": " + errors.join(" | ") : ""));
} finally {
  await browser.close();
}

console.log(problems.length ? `\n${problems.length} problem(s).` : "\nAll good.");
process.exit(problems.length ? 1 : 0);
