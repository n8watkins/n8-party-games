// The names: the live game's lists, copied with their checks (the who-am-i repository's
// test/content.test.ts), and the rules for dealing two of them.
import { describe, expect, it } from "vitest";
import { BLOCKED_PAIRS, DIFFICULTY_POOLS, IDENTITIES, PACK_IDS, PACKS, SOURCE, SOURCE_PACK_IDS, drawPair, getIdentity, identitiesClash, mentions, normalizeName, packIdentities, pairable, publicIdentity } from "../deck.js";
import { MIXED_WEIGHTS, ROWS } from "../deck-data.js";
import { testRandom } from "./random-match.js";

const EM_DASH = String.fromCharCode(0x2014);
const byName = (name) => IDENTITIES.find((i) => i.name === name);

describe("the lists, as live", () => {
  it("are the live game's six packs of about 40 names, copied from a recorded commit", () => {
    expect(SOURCE).toMatchObject({ repo: "n8watkins/who-am-i", path: "src/worker/content" });
    expect(SOURCE.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(IDENTITIES).toHaveLength(ROWS.length);
    expect(IDENTITIES.length).toBeGreaterThanOrEqual(240);
    for (const pack of SOURCE_PACK_IDS) {
      expect(packIdentities(pack).length, pack).toBeGreaterThanOrEqual(38);
      expect(packIdentities(pack).length, pack).toBeLessThanOrEqual(45);
      expect(MIXED_WEIGHTS[pack], pack).toBeGreaterThan(0);
    }
    expect(packIdentities("mixed")).toHaveLength(IDENTITIES.length);
    expect(PACKS.map((p) => p.id)).toEqual(PACK_IDS);
  });

  it("use unique ids and no names that could be mistaken for each other", () => {
    expect(new Set(IDENTITIES.map((i) => i.id)).size).toBe(IDENTITIES.length);
    const clashes = [];
    for (let i = 0; i < IDENTITIES.length; i++) {
      for (let j = i + 1; j < IDENTITIES.length; j++) if (identitiesClash(IDENTITIES[i], IDENTITIES[j])) clashes.push(`${IDENTITIES[i].name} / ${IDENTITIES[j].name}`);
    }
    expect(clashes).toEqual([]);
    expect(normalizeName("The Kool-Aid Man")).toBe("kool aid man");
    expect(normalizeName("Timothée Chalamet")).toBe("timothee chalamet");
  });

  it("give every name three different hints, 8 to 90 characters, none naming it", () => {
    for (const i of IDENTITIES) {
      expect(["easy", "medium", "hard"]).toContain(i.difficulty);
      expect(i.name.trim()).toBe(i.name);
      expect(i.hints, i.id).toHaveLength(3);
      expect(new Set(i.hints).size, i.id).toBe(3);
      for (const h of i.hints) {
        expect(h.length, `${i.id}: ${h}`).toBeGreaterThanOrEqual(8);
        expect(h.length, `${i.id}: ${h}`).toBeLessThanOrEqual(90);
        expect(h).not.toContain(EM_DASH);
        for (const n of [i.name, ...i.aliases]) expect(` ${normalizeName(h)} `, `${i.id}: "${h}"`).not.toContain(` ${normalizeName(n)} `);
      }
    }
  });

  it("give pictures only on the one picture host, each with a file page and a licence", () => {
    let pictures = 0;
    for (const i of IDENTITIES) {
      if (!i.picture) continue;
      pictures++;
      expect(i.picture.imageUrl.startsWith("https://upload.wikimedia.org/wikipedia/"), i.id).toBe(true);
      expect(i.picture.filePage, i.id).toMatch(/^https:\/\/(commons\.wikimedia\.org|en\.wikipedia\.org)\/wiki\/File:/);
      expect(i.picture.license.trim(), i.id).not.toBe("");
      expect(typeof i.picture.free).toBe("boolean");
    }
    expect(pictures).toBeGreaterThan(150);
  });
});

describe("dealing two names", () => {
  it("never deals two names where one gives the other away (found in the live lists)", () => {
    const pairs = [
      ["Princess Zelda", "Link from The Legend of Zelda"], // her picture is "Link_to_the_Past_Zelda.png"; his name says Zelda
      ["Katniss Everdeen", "Jennifer Lawrence"], // her picture is a file named after the actress
      ["The Joker", "Batman"],
      ["Tails", "Sonic the Hedgehog"],
      ["Donkey Kong", "King Kong"],
    ];
    for (const [a, b] of pairs) {
      expect(byName(a), a).toBeTruthy();
      expect(byName(b), b).toBeTruthy();
      expect(identitiesClash(byName(a), byName(b)), `${a} / ${b}`).toBe(false);
      expect(pairable(byName(a), byName(b)), `${a} / ${b}`).toBe(false);
      expect(pairable(byName(b), byName(a)), `${b} / ${a}`).toBe(false);
    }
    expect(mentions(byName("Princess Zelda"), byName("Link from The Legend of Zelda"))).toBe(true);
    expect(pairable(byName("Tom Hanks"), byName("Meryl Streep"))).toBe(true);
  });

  it("never deals the pairs that give each other away in other words (the hand-kept list), nor a name in an author's run-together credit", () => {
    const ids = (a, b) => [getIdentity(a), getIdentity(b)];
    const pairs = [
      ["video-games.dr-eggman", "video-games.sonic"],
      ["anime-cartoons.road-runner", "anime-cartoons.wile-e-coyote"],
      ["video-games.tom-nook", "video-games.isabelle"],
      ["video-games.chun-li", "video-games.street-fighter-ryu"],
      ["anime-cartoons.homer-simpson", "anime-cartoons.bart-simpson"],
      ["video-games.minecraft-steve", "video-games.creeper"],
      ["movie-characters.luke-skywalker", "movie-characters.darth-vader"],
      ["historical-figures.marco-polo", "historical-figures.genghis-khan"],
      ["anime-cartoons.snoopy", "anime-cartoons.charlie-brown"],
      ["anime-cartoons.snoopy", "brand-mascots.mr-peanut"],
      ["anime-cartoons.charlie-brown", "brand-mascots.mr-peanut"],
      // Both pictures are credited to "Kingkongphoto & www.celebrity-photos.com".
      ["actors.robin-williams", "movie-characters.king-kong"],
      ["historical-figures.nelson-mandela", "movie-characters.king-kong"],
    ];
    for (const [a, b] of pairs) {
      expect(pairable(...ids(a, b)), `${a} / ${b}`).toBe(false);
      expect(pairable(...ids(b, a)), `${b} / ${a}`).toBe(false);
    }
    for (const id of BLOCKED_PAIRS.flat()) expect(() => getIdentity(id)).not.toThrow();
    expect(mentions(getIdentity("actors.robin-williams"), getIdentity("movie-characters.king-kong"))).toBe(true);
    // The pictures stay.
    expect(getIdentity("actors.robin-williams").picture).not.toBeNull();
    expect(getIdentity("historical-figures.nelson-mandela").picture).not.toBeNull();
  });

  it("reads picture addresses with their percent-encoding undone", () => {
    // Pikachu's picture is "Pok%C3%A9mon_Pikachu_art.png"; Julius Caesar's "Retrato_de_Julio_C%C3%A9sar".
    const pikachu = getIdentity("video-games.pikachu");
    expect(pikachu.picture.imageUrl).toContain("Pok%C3%A9mon");
    const named = (name) => ({ id: `test.${name}`, name, aliases: [] });
    expect(mentions(pikachu, named("Pokémon"))).toBe(true);
    expect(mentions(getIdentity("historical-figures.julius-caesar"), named("Julio César"))).toBe(true);
  });

  it("keeps every name dealable: each has a partner it may be dealt beside, in every pack and level it is in", () => {
    for (const packId of PACK_IDS) {
      for (const [level, difficulties] of Object.entries(DIFFICULTY_POOLS)) {
        const pool = packIdentities(packId).filter((c) => difficulties.includes(c.difficulty));
        for (const c of pool) expect(pool.some((d) => pairable(c, d)), `${c.id} in ${packId}/${level}`).toBe(true);
      }
    }
  });

  it("deals two different names from the chosen pack and level that may be dealt together", () => {
    for (const packId of PACK_IDS) {
      for (const difficulty of ["easy", "medium", "hard"]) {
        const random = testRandom(packId.length * 31 + difficulty.length);
        for (let n = 0; n < 40; n++) {
          const { pair, reshuffled } = drawPair({ packId, difficulty, usedIds: [], random });
          expect(reshuffled).toBe(false);
          const [a, b] = pair.map(getIdentity);
          expect(pairable(a, b), `${a.name} / ${b.name}`).toBe(true);
          for (const i of [a, b]) {
            if (packId !== "mixed") expect(i.pack).toBe(packId);
            expect(DIFFICULTY_POOLS[difficulty]).toContain(i.difficulty);
          }
        }
      }
    }
  });

  it("draws the generator the same number of times whatever comes out", () => {
    for (const packId of PACK_IDS) {
      const counts = new Set();
      for (let seed = 1; seed <= 60; seed++) {
        const inner = testRandom(seed);
        let calls = 0;
        const random = () => {
          calls++;
          return inner();
        };
        drawPair({ packId, difficulty: "medium", usedIds: [], random });
        counts.add(calls);
      }
      expect([...counts], packId).toEqual([packId === "mixed" ? 4 : 2]);
    }
  });

  it("reshuffles only when the names used so far leave nothing to deal, decided before the draw", () => {
    const random = testRandom(5);
    const pool = packIdentities("brand-mascots").filter((i) => DIFFICULTY_POOLS.hard.includes(i.difficulty));
    const used = [];
    let rounds = 0;
    for (;;) {
      const { pair, reshuffled } = drawPair({ packId: "brand-mascots", difficulty: "hard", usedIds: used, random });
      if (reshuffled) break;
      for (const id of pair) expect(used).not.toContain(id);
      used.push(...pair);
      rounds++;
    }
    expect(rounds).toBeGreaterThan(3);
    expect(used.length).toBeLessThanOrEqual(pool.length);
    // The same used list reshuffles whatever the generator would have dealt.
    for (let seed = 1; seed < 20; seed++) expect(drawPair({ packId: "brand-mascots", difficulty: "hard", usedIds: used, random: testRandom(seed) }).reshuffled).toBe(true);
  });

  it("shows a name with its pack and picture only, never its id, slug, aliases or hints", () => {
    const i = byName("Tom Hanks");
    const shown = publicIdentity(i.id);
    expect(Object.keys(shown).sort()).toEqual(["name", "pack", "picture"]);
    expect(shown).toMatchObject({ name: "Tom Hanks", pack: "actors" });
    expect(JSON.stringify(shown)).not.toContain(i.id);
    expect(JSON.stringify(shown)).not.toContain(i.hints[0]);
  });
});
