// Emotes and the soundboard, end to end: real pages and real sockets in one room, against a
// running local server. The browser is headless and MUTED (it also asks for a tap before sound,
// as phones do), and is closed at the end whatever happens.
//
//   node lobby/test/e2e-emotes.mjs [--base=http://localhost:8791]
//
// What it goes through:
//   the room's word    an emote or a sound reaches everybody else once; the cooldowns are the
//                      room's (1.5 s and 4 s), and it says how long is left; a game in play
//                      refuses sounds; nothing it does sets a wake-up or a timer
//   flooding           a script hammering the button is closed; the others hear one
//   where it plays     with no big screen, on the players' devices; with one, on the screen only
//   unlocking          nothing plays before a tap, nothing queued plays after it
//   muting             a muted player's sounds are silent here, and their name still shows
//   the sounds         every sound rendered offline and its waveform looked at: length, silence
//                      at both ends, no clipping, a loudness in line with the rest, and its shape
//                      (three blasts, falling notes, a run of chirps...)
import { chromium } from "playwright";
import { EMOTE_COOLDOWN_MS, SOUND_COOLDOWN_MS } from "../../party-kit/client/emotes.js";
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
const quiet = (c, ms = 600) => sleep(ms).then(() => c.seen.filter((m) => m.t === "e" || m.t === "sb" || m.t === "wait"));

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
  /** What a page's soundboard did with the sounds it was asked to play, oldest first. */
  const heard = (page) => page.evaluate(() => globalThis.__partyRoom.sounds.log.map((l) => l.what));
  const notes = (page) => page.evaluate(() => [...document.querySelectorAll(".note")].map((n) => n.textContent));

  // ================================================================ the room's word
  section("the room's word: relays once, enforces the cooldowns");
  const host = await call("POST", "/rooms", { nickname: "Mabel" });
  const tomSeat = await call("POST", "/join/" + host.pin, { nickname: "Tom" });
  const [mabel, tom] = [host, tomSeat].map(connect);
  await Promise.all([mabel.opened, tom.opened]);
  await mabel.wait((m) => m.room?.members.filter((x) => x?.connected).length === 2, 8000, 0);
  const before = await debug(host.code);

  mabel.send({ t: "e", e: "wave" });
  const got = await tom.wait((m) => m.t === "e", 3000);
  check(got.s === mabel.seat && got.e === "wave", "Tom sees Mabel's wave");
  mabel.send({ t: "e", e: "laugh" });
  const wait = await mabel.wait((m) => m.t === "wait", 3000);
  check(wait.k === "emote" && wait.in > EMOTE_COOLDOWN_MS - 600 && wait.in <= EMOTE_COOLDOWN_MS, `a second emote straight after is refused, with ${wait.in} ms left`);
  check((await quiet(tom)).filter((m) => m.t === "e").length === 1 && !mabel.seen.some((m) => m.t === "e"), "Tom saw one emote, and the room never echoes it back to Mabel");
  mabel.send({ t: "sb", k: "horn" });
  check((await tom.wait((m) => m.t === "sb", 3000)).k === "horn", "a sound has its own cooldown: the horn goes through right after the emote");
  mabel.send({ t: "sb", k: "boing" });
  const swait = await mabel.wait((m) => m.t === "wait" && m.k === "sound", 3000);
  check(swait.in > SOUND_COOLDOWN_MS - 800, `a second sound is refused, with ${swait.in} ms left`);
  await sleep(EMOTE_COOLDOWN_MS);
  mabel.send({ t: "e", e: "cheer" });
  check((await tom.wait((m) => m.t === "e" && m.e === "cheer", 3000)).s === mabel.seat, "after 1.5 s the next emote goes through");
  mabel.send({ t: "e", e: "no-such-emote" });
  mabel.send({ t: "sb", k: "__proto__" });
  check((await quiet(tom)).filter((m) => m.t === "e").length === 2, "a name that does not exist is ignored");
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
  const hammer = setInterval(() => pest.send({ t: "e", e: "taunt" }), 50);
  const closed = await Promise.race([pest.closed, sleep(6000).then(() => null)]);
  clearInterval(hammer);
  check(closed?.code === 4008, `the hammering socket is closed (${closed ? closed.code + " " + closed.reason : "still open"}) after ${Date.now() - started} ms`);
  const relayed = tom.seen.slice(tomBefore).filter((m) => m.t === "e" && m.s === pest.seat).length;
  check(relayed <= 2, `and the others saw ${relayed} of its emotes`);

  // ================================================================ a game in play
  section("during a game: emotes yes, sounds no (Coin Flip says nothing)");
  const N = mabel.room.boxes.length;
  const coin = mabel.room.boxes.findIndex((b) => b.id === "coin-flip");
  const { boxCentre } = await import("../shared/world.js");
  const gameFrom = mabel.seen.length;
  for (const c of [mabel, tom]) c.goto(Math.round(boxCentre(coin, N)));
  await mabel.wait((m) => m.t === "start", 9000, gameFrom);
  mabel.send({ t: "sb", k: "ding" });
  const nope = await mabel.wait((m) => m.t === "wait" && m.in === -1, 3000).catch(() => null);
  check(nope?.k === "sound", "a sound during the game is refused as not allowed now");
  await sleep(EMOTE_COOLDOWN_MS);
  mabel.send({ t: "e", e: "heart" });
  check((await tom.wait((m) => m.t === "e" && m.e === "heart", 3000)).s === mabel.seat, "an emote during the game goes through");
  await mabel.wait((m) => m.t === "end", 15000, gameFrom);
  mabel.ws.close();
  tom.ws.close();

  // ================================================================ pages: where it plays, unlocking, muting
  section("no big screen: sounds play on the players' devices, after a tap");
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
  await sleep(600);
  ada.send({ t: "sb", k: "horn" });
  await phone.waitForFunction(() => globalThis.__partyRoom.sounds.log.length >= 1, null, { timeout: 4000 });
  check((await heard(phone)).join() === "locked", "before any tap, the sound is not played: " + (await heard(phone)).join());
  check((await notes(phone)).some((t) => t.includes("Ada: Air horn")), "but the page still says who did it");
  await phone.locator("svg.scene").dispatchEvent("pointerdown");
  await phone.waitForFunction(() => globalThis.__partyRoom.sounds.unlocked, null, { timeout: 4000 });
  await sleep(500);
  check((await heard(phone)).join() === "locked" && (await phone.evaluate(() => globalThis.__partyRoom.sounds.voices.length)) === 0, "a tap unlocks sound, and the horn from before does not play late");
  await sleep(SOUND_COOLDOWN_MS);
  ada.send({ t: "sb", k: "ding" });
  await phone.waitForFunction(() => globalThis.__partyRoom.sounds.log.length >= 2, null, { timeout: 4000 });
  check((await heard(phone)).at(-1) === "played", "after the tap the next sound plays on the phone");

  section("muting a player: their sound is silent here, their name still shows");
  await phone.evaluate(() => globalThis.__partyRoom.sounds.mutePlayer("Ada", true));
  await sleep(SOUND_COOLDOWN_MS);
  ada.send({ t: "sb", k: "boing" });
  await phone.waitForFunction(() => globalThis.__partyRoom.sounds.log.length >= 3, null, { timeout: 4000 });
  check((await heard(phone)).at(-1) === "muted", "Ada's boing is muted on Bea's phone");
  check((await notes(phone)).some((t) => t.includes("Ada: Boing")), "and the note still names her");
  const kept = await phone.evaluate(() => JSON.parse(localStorage.getItem("party-kit:sound")));
  check(kept.players.names.includes("ada") && kept.players.room === party.code, "the mute is kept on the device, for this party");
  await phone.evaluate(() => globalThis.__partyRoom.sounds.mutePlayer("Ada", false));

  section("with a big screen: the sound comes from the screen only");
  const screen = await open("screen", { width: 1280, height: 720 });
  await screen.goto(base + "/lobby/?join=" + party.pin + "&as=screen");
  await screen.waitForSelector(".door-title");
  await screen.click("text=Show the room here");
  await screen.waitForSelector("svg.scene text");
  await phone.waitForFunction(() => document.querySelector(".hud") && true, null, { timeout: 4000 });
  await sleep(800);
  const phoneBefore = (await heard(phone)).length;
  await sleep(SOUND_COOLDOWN_MS);
  ada.send({ t: "sb", k: "applause" });
  await screen.waitForFunction(() => globalThis.__partyRoom.sounds.log.length >= 1, null, { timeout: 4000 });
  await sleep(400);
  check((await heard(screen)).at(-1) === "played", "the screen plays the applause (it was clicked on its way in)");
  check((await heard(phone)).length === phoneBefore, "the phone does not play it");
  check((await notes(phone)).some((t) => t.includes("Ada: Applause")) && (await notes(screen)).some((t) => t.includes("Ada: Applause")), "both say who did it");
  ada.ws.close();

  // ================================================================ the sounds themselves
  section("every sound, rendered and looked at");
  const report = await phone.evaluate(async () => {
    const { renderSound, soundNames } = await import("/party-kit/client/sounds.js");
    const out = {};
    for (const name of soundNames()) {
      const b = await renderSound(name, 44100);
      const L = b.getChannelData(0);
      const R = b.numberOfChannels > 1 ? b.getChannelData(1) : L;
      const n = L.length;
      const mono = new Float32Array(n);
      let peak = 0;
      let bad = 0;
      for (let i = 0; i < n; i++) {
        mono[i] = (L[i] + R[i]) / 2;
        peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
        if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) bad++;
      }
      // Loudness in 10 ms windows, and where the sound "starts" again after a near silence (an onset).
      const w = 441;
      const env = [];
      for (let i = 0; i + w <= n; i += w) {
        let s = 0;
        for (let j = i; j < i + w; j++) s += mono[j] * mono[j];
        env.push(Math.sqrt(s / w));
      }
      const top = Math.max(...env);
      // An onset: the loudness at least doubles within 40 ms and is a real part of the sound,
      // with 80 ms before the next can count. A ringing bell struck again counts; its ring does not.
      let onsets = 0;
      let quietUntil = -1;
      env.forEach((e, i) => {
        const before = Math.min(...env.slice(Math.max(0, i - 4), i).concat(i ? [] : [0]));
        if (i > quietUntil && e > top * 0.25 && e > before * 2) {
          onsets++;
          quietUntil = i + 8;
        }
      });
      // The pitch (by autocorrelation) at a few moments, for the sounds that have one.
      const pitchAt = (sec) => {
        const at = Math.floor(sec * 44100);
        const size = 2048;
        if (at + size * 2 > n) return 0;
        let best = 0;
        let bestLag = 0;
        for (let lag = 20; lag < 1000; lag++) {
          let s = 0;
          for (let i = 0; i < size; i++) s += mono[at + i] * mono[at + i + lag];
          if (s > best) [best, bestLag] = [s, lag];
        }
        return bestLag ? 44100 / bestLag : 0;
      };
      let loud = 0;
      let count = 0;
      for (const e of env) if (e > top * 0.05) [loud, count] = [loud + e * e, count + 1];
      out[name] = {
        seconds: b.duration,
        peak,
        bad,
        start: Math.abs(mono[0]),
        end: env.at(-1) / top,
        rms: Math.sqrt(loud / count),
        onsets,
        pitch: name === "trombone" ? [0.2, 0.62, 1.04, 1.6].map(pitchAt) : name === "slide" ? [0.05, 0.57, 1.1].map(pitchAt) : null,
      };
    }
    return out;
  });
  const loudest = Math.max(...Object.values(report).map((r) => r.rms));
  for (const [name, r] of Object.entries(report)) {
    const shape = `${r.seconds.toFixed(2)} s, peak ${r.peak.toFixed(2)}, ${(20 * Math.log10(r.rms)).toFixed(1)} dB, ${r.onsets} onsets, ends at ${(r.end * 100).toFixed(1)}% of its loudest`;
    const fine = r.bad === 0 && r.seconds > 0.05 && r.seconds <= 3 && r.peak <= 0.951 && r.peak > 0.15 && r.start < 0.01 && r.end < 0.05;
    const level = name === "crickets" || r.rms > loudest / 3.2;
    check(fine && level, `${name}: ${shape}`);
  }
  const shapes = [
    [report.horn.onsets === 3, "the air horn is three blasts"],
    [report.rimshot.onsets === 3, "ba-dum-tss is three hits"],
    [report.bell.onsets === 3, "the boxing bell rings three times"],
    [report.crickets.onsets >= 8, "the crickets chirp again and again"],
    // Measured by autocorrelation, which hears the trombone's sub-octave: the steps are what matter.
    [report.trombone.pitch.every((f, i, all) => i === 0 || (f < all[i - 1] && f > all[i - 1] * 0.9)), "the sad trombone steps down a semitone at a time: " + report.trombone.pitch.map((f) => f.toFixed(0)).join(" > ") + " Hz"],
    [report.slide.pitch[1] > report.slide.pitch[0] * 2 && report.slide.pitch[2] < report.slide.pitch[1] / 2, "the slide whistle goes up and comes down: " + report.slide.pitch.map((f) => f.toFixed(0)).join(", ") + " Hz"],
    [report.applause.onsets > 1 || report.applause.seconds > 2, "the applause swells and lasts"],
  ];
  for (const [ok, what] of shapes) check(ok, what);

  check(errors.length === 0, "no page reported an error" + (errors.length ? ": " + errors.join(" | ") : ""));
} finally {
  await browser.close();
}

console.log(problems.length ? `\n${problems.length} problem(s).` : "\nAll good.");
process.exit(problems.length ? 1 : 0);
