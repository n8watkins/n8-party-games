// The emotes as the page draws them (lobby/public/emotes/rig.js and play.js): the same set as
// the kit's rules, every pose sound at every moment, a mirrored pose a true mirror, aiming at
// the nearest piece, and a sound file with a credit for each.
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMOTES } from "../../party-kit/client/emotes.js";
import { Expressions } from "../public/emotes/play.js";
import { REACH, RIG, mirrorPose, rigById } from "../public/emotes/rig.js";

const SOUNDS = new URL("../public/sounds/", import.meta.url);
const finite = (n) => typeof n === "number" && Number.isFinite(n);

describe("the rig", () => {
  it("draws exactly the kit's emotes, in the same order", () => {
    expect(RIG.map((e) => e.id)).toEqual(EMOTES.map((e) => e.id));
    expect(RIG.find((e) => e.id === "violin")).toBeUndefined();
  });

  it("gives every emote a word, a length, a moment for stills and a limb level", () => {
    for (const e of RIG) {
      expect(e.word.length, e.id).toBeGreaterThan(0);
      expect(e.hold, e.id).toBeGreaterThan(0);
      expect(e.hold, e.id).toBeLessThan(e.dur);
      expect(["none", "mitten", "hands"], e.id).toContain(e.limbs);
    }
  });

  it("poses every emote at every moment, near and far, with numbers only", () => {
    for (const e of RIG) {
      for (let t = 0; t <= e.dur; t += 50) {
        for (const reach of [90, REACH, 420]) {
          const p = e.pose(t, false, reach);
          for (const v of Object.values(p.body)) expect(finite(v), `${e.id} body at ${t}`).toBe(true);
          for (const h of p.hands) for (const v of [h.x, h.y, h.rot, h.s, h.arm.elbow.x, h.arm.elbow.y]) expect(finite(v), `${e.id} hand at ${t}`).toBe(true);
          if (e.limbs === "none") expect(p.hands.length, e.id).toBe(0);
          for (const h of p.hands) expect(h.style, e.id).toBe(e.limbs);
        }
      }
    }
  });

  it("mirrors a pose exactly: twice is the same pose", () => {
    for (const e of RIG) {
      const p = e.pose(e.hold, false, 250);
      const twice = mirrorPose(mirrorPose(p));
      expect(JSON.parse(JSON.stringify(twice))).toEqual(JSON.parse(JSON.stringify(p)));
      const once = mirrorPose(p);
      p.hands.forEach((h, i) => {
        expect(once.hands[i].x).toBeCloseTo(-h.x);
        expect(once.hands[i].side).toBe(-h.side);
      });
    }
  });

  it("throws the tomato at the floor short of the target, never at its body, and the target only flinches", () => {
    const tomato = rigById("tomato");
    let landed = null;
    for (let t = 0; t < tomato.dur; t += 10) {
      const p = tomato.pose(t, false, 250);
      const splat = p.props.find((x) => x.kind === "splat");
      if (splat && landed === null) landed = { t, x: splat.x, y: splat.y };
      for (const x of p.props.filter((q) => q.kind === "tomato" && q.space === "stage")) expect(x.x).toBeLessThan(250 - 20);
    }
    expect(landed).not.toBeNull();
    expect(landed.y).toBeGreaterThan(-6);
    expect(landed.x).toBeLessThan(250 - 20);
    expect(tomato.pose(landed.t + 50, false, 250).other.flinch).toBeGreaterThan(0);
    expect(tomato.pose(tomato.dur - 20, false, 250).other.flinch).toBe(0);
  });
});

describe("who does what (play.js)", () => {
  const pieces = [
    { seat: 0, x: 500, face: 1 },
    { seat: 1, x: 400, face: 1 },
    { seat: 2, x: 900, face: 1 },
  ];

  it("aims at the nearest piece and keeps that side", () => {
    const ex = new Expressions();
    ex.start(0, "redcard", 0, pieces);
    const at = { 0: 500, 1: 400, 2: 900 };
    const a = ex.pose(0, 1000, (s) => at[s], false);
    expect(a.toward).toBe(-100);
    expect(a.pose.hands[0].x).toBeLessThan(0);
    // The target walks round to the other side: the emote stays turned the way it started.
    at[1] = 650;
    expect(ex.pose(0, 1100, (s) => at[s], false).toward).toBeLessThan(0);
  });

  it("with nobody near, does it toward the way the piece faces", () => {
    const ex = new Expressions();
    ex.start(0, "redcard", 0, [{ seat: 0, x: 500, face: -1 }]);
    const a = ex.pose(0, 1000, () => 500, false);
    expect(a.toward).toBeNull();
    expect(a.pose.hands[0].x).toBeLessThan(0);
  });

  it("replaces a player's own emote, ends on time, and shows the word only in the middle", () => {
    const ex = new Expressions();
    ex.start(0, "popcorn", 0, pieces);
    ex.start(0, "boo", 500, pieces);
    const xOf = (s) => pieces[s].x;
    expect(ex.pose(0, 600, xOf, false).rig.id).toBe("boo");
    expect(ex.pose(0, 600 + 100, xOf, false).word).toBeNull();
    expect(ex.pose(0, 600 + 1000, xOf, false).word).toBe("BOO");
    expect(ex.pose(0, 500 + rigById("boo").dur + 1, xOf, false)).toBeNull();
    expect(ex.busy).toBe(false);
  });

  it("ignores an emote this page does not know", () => {
    expect(new Expressions().start(0, "violin", 0, pieces)).toBe(false);
  });
});

describe("the sounds", () => {
  const credits = readFileSync(new URL("CREDITS.txt", SOUNDS), "utf8");

  it("has a small sound file for every emote, credited", () => {
    for (const e of EMOTES) {
      const file = new URL(`emote-${e.id}.mp3`, SOUNDS);
      expect(existsSync(file), e.id).toBe(true);
      expect(statSync(file).size, e.id).toBeLessThan(40_000);
      expect(credits, e.id).toContain(`emote-${e.id}.mp3`);
    }
  });

  it("credits every file in the folder as CC0, and names no lighter brand", () => {
    const files = readFileSync(new URL("../../preview/recordings/sources.json", import.meta.url), "utf8");
    for (const s of JSON.parse(files)) {
      expect(s.source.licence, s.file).toBe("Creative Commons 0");
      expect(credits).toContain(s.file);
      expect(s.file).not.toMatch(/zippo/i);
    }
  });
});
