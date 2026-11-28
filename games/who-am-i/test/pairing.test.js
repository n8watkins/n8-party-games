// One name giving the other away. During a round your phone shows the OTHER player's name, its
// picture with its credit, and, once they ask for them, its hints. If any word of your own name is
// in there, you can read who you are: "Link from The Legend of Zelda" says "Zelda" to Princess
// Zelda's player, Donkey Kong's card says "Kong" to King Kong's, Minnie Mouse's says "Mouse" to
// Mickey's. The live game fixed this in n8watkins/who-am-i#50 (src/worker/content/pairing.ts and
// test/pairing.test.ts); these are its checks, on the Table's rules.
//
// The scan here is written apart from the rule it checks (deck.js `pairable`): it reads what a
// phone is sent (`view`, and `publicIdentity` for the whole deck), splits it into words, and looks
// for any word of the viewer's own name.
import { describe, expect, it } from "vitest";
import { DIFFICULTIES, DIFFICULTY_POOLS, IDENTITIES, PACK_IDS, drawPair, getIdentity, identitiesClash, packIdentities, pairable, publicIdentity } from "../deck.js";
import { MIXED_WEIGHTS } from "../deck-data.js";
import { testRandom } from "./random-match.js";
import { Table } from "./table.js";

const FILLER = new Set(["the", "of", "a", "an", "and", "from", "in", "on", "to"]);

function words(text) {
  let decoded = String(text);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Not percent-encoded: read as it is.
  }
  return decoded
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Every word of a JSON value's strings (keys too: they are fixed field names, never a name). */
const wordsOf = (value) => new Set(words(JSON.stringify(value)));

/**
 * Works out a name's words once per deck name. The deck scan compares every name with every
 * other, so working them out per pair made this file take over 5 s on a loaded machine and time
 * out the deploy gate.
 */
function once(compute) {
  const seen = new Map();
  return (identity) => {
    if (identity.id === undefined) return compute(identity);
    if (!seen.has(identity.id)) seen.set(identity.id, compute(identity));
    return seen.get(identity.id);
  };
}

/** The words of a name and its aliases that would tell its player who they are. */
const own = once((identity) =>
  [...new Set([identity.name, ...identity.aliases].flatMap(words))].filter((w) => w.length > 1 && !FILLER.has(w)),
);

/** Every word the other phone can read about `identity` in a round: what `view` gives of it, and its hints. */
const readable = once((identity) => new Set([...wordsOf(publicIdentity(identity.id)), ...identity.hints.flatMap(words)]));

/** The words of `viewer`'s own name that the viewer's phone shows while `opponent` is the card. */
const leak = (viewer, opponent) => own(viewer).filter((w) => readable(opponent).has(w));

const byId = (id) => getIdentity(id);

describe("at the Table", () => {
  it("never shows a player a word of their own name on the other player's card, over many matches", () => {
    // Each match: one pack and level, ten rounds; in each turn the guesser asks for all three
    // hints (so the other phone gets them in the log), then gives up. Every view each player gets
    // while a round is on is read: the opponent card and the hints the other player asked for.
    const problems = [];
    let rounds = 0;
    let seed = 0;
    for (const pack of PACK_IDS) {
      for (const difficulty of DIFFICULTIES) {
        for (let n = 0; n < 8; n++) {
          const t = new Table([0, 1], { host: 0 }, ++seed);
          t.do(0, { t: "choose", pack, difficulty, match: "rounds-10", turnFormat: "keep_going", mode: "twenty_questions", hints: true });
          t.begin();
          while (t.phase !== "over") {
            if (t.phase === "playing") {
              const mine = { 0: t.secretOf(0), 1: t.secretOf(1) };
              const seen = { 0: new Set(), 1: new Set() };
              const look = () => {
                for (const seat of [0, 1]) {
                  const v = t.view(seat);
                  if (!v.opponent) continue;
                  for (const w of wordsOf({ ...v.opponent, seat: null })) seen[seat].add(w);
                  // Hints in the log of the other player's turn are about the other player's name.
                  if (v.turn.seat !== seat) for (const e of v.turn.log) if (e.kind === "hint") for (const w of words(e.text)) seen[seat].add(w);
                }
              };
              look();
              while (t.phase === "playing") {
                for (let h = 0; h < 3; h++) {
                  t.do(t.guesser, { t: "hint" }, 500);
                  look();
                }
                t.do(t.guesser, { t: "skip" }, 500);
                if (t.phase === "playing") look();
              }
              rounds++;
              for (const seat of [0, 1]) {
                const words = own(mine[seat]).filter((w) => seen[seat].has(w));
                if (words.length) problems.push(`${pack}/${difficulty} seed ${seed}: ${mine[seat].name}'s phone shows "${words.join(", ")}" on ${mine[1 - seat].name}'s card`);
              }
            }
            if (t.phase === "reveal") t.do(0, { t: "next" }, 500);
          }
        }
      }
    }
    expect(rounds).toBe(PACK_IDS.length * DIFFICULTIES.length * 8 * 10);
    expect(problems).toEqual([]);
  });
});

describe("the deck scan", () => {
  it("never lets a pair be dealt when either phone could read its own name on the other's card", () => {
    const dealtAnyway = [];
    for (const a of IDENTITIES) {
      for (const b of IDENTITIES) {
        if (a === b) continue;
        const found = leak(a, b);
        if (found.length && pairable(a, b)) dealtAnyway.push(`${a.name} reads "${found.join(", ")}" on ${b.name}'s card`);
      }
    }
    expect(dealtAnyway).toEqual([]);
  });

  it("never deals the pairs the live game found giving each other away", () => {
    const known = [
      ["video-games.link", "video-games.princess-zelda"],
      ["actors.jennifer-lawrence", "movie-characters.katniss-everdeen"],
      ["movie-characters.batman", "movie-characters.the-joker"],
      ["video-games.donkey-kong", "movie-characters.king-kong"],
      ["brand-mascots.burger-king", "movie-characters.king-kong"],
      ["historical-figures.napoleon-bonaparte", "historical-figures.nikola-tesla"],
      ["movie-characters.dorothy-gale", "brand-mascots.gerber-baby"],
      ["video-games.creeper", "video-games.minecraft-steve"],
      ["anime-cartoons.mickey-mouse", "anime-cartoons.minnie-mouse"],
    ];
    for (const [x, y] of known) {
      expect(pairable(byId(x), byId(y)), `${x} / ${y}`).toBe(false);
      expect(pairable(byId(y), byId(x)), `${y} / ${x}`).toBe(false);
    }
  });

  it("never deals an actor beside a character they played, nor a character whose hints describe the other", () => {
    // The live game's reviewed list (REVEALING_PAIRS in its pairing.ts): no shared word, but one
    // card brings the other to mind.
    const pointing = [
      ["actors.daniel-radcliffe", "movie-characters.harry-potter"],
      ["actors.emma-watson", "movie-characters.hermione-granger"],
      ["actors.jennifer-lawrence", "movie-characters.katniss-everdeen"],
      ["actors.robert-downey-jr", "movie-characters.iron-man"],
      ["actors.harrison-ford", "movie-characters.indiana-jones"],
      ["actors.tom-holland", "movie-characters.spider-man"],
      ["actors.keanu-reeves", "movie-characters.neo"],
      ["actors.tom-hanks", "movie-characters.forrest-gump"],
      ["actors.tom-hanks", "movie-characters.woody"],
      ["actors.george-clooney", "movie-characters.batman"],
      ["movie-characters.the-joker", "movie-characters.batman"],
      ["movie-characters.darth-vader", "movie-characters.luke-skywalker"],
      ["video-games.luigi", "video-games.mario"],
      ["video-games.bowser", "video-games.princess-peach"],
      ["video-games.ganondorf", "video-games.link"],
      ["video-games.dr-eggman", "video-games.sonic"],
      ["anime-cartoons.patrick-star", "anime-cartoons.spongebob"],
      ["anime-cartoons.ash-ketchum", "video-games.pikachu"],
      ["anime-cartoons.wile-e-coyote", "anime-cartoons.road-runner"],
    ];
    for (const [x, y] of pointing) {
      expect(pairable(byId(x), byId(y)), `${x} / ${y}`).toBe(false);
      expect(pairable(byId(y), byId(x)), `${y} / ${x}`).toBe(false);
    }
  });

  it("still deals ordinary pairs, including two names from one franchise", () => {
    expect(pairable(byId("video-games.mario"), byId("video-games.princess-zelda"))).toBe(true);
    expect(pairable(byId("movie-characters.luke-skywalker"), byId("movie-characters.yoda"))).toBe(true);
    expect(pairable(byId("actors.tom-hanks"), byId("historical-figures.albert-einstein"))).toBe(true);
  });

  it("gives no picture an address or file page that names another name in the deck", () => {
    const problems = [];
    for (const identity of IDENTITIES) {
      if (!identity.picture) continue;
      const inAddress = new Set([...words(identity.picture.imageUrl), ...words(identity.picture.filePage)]);
      // "King_Kong_1933.png" is King Kong's own name, not The Burger King's.
      const itsOwn = new Set(own(identity));
      for (const other of IDENTITIES) {
        if (other === identity) continue;
        for (const name of [other.name, ...other.aliases]) {
          const nameWords = words(name).filter((w) => !FILLER.has(w) && !itsOwn.has(w));
          if (nameWords.length && nameWords.every((w) => inAddress.has(w))) problems.push(`${identity.id}'s picture names "${name}" (${other.id})`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("fair dealing", () => {
  it("leaves every name dealable beside many others, in every pack, at every level", () => {
    const thin = [];
    for (const packId of PACK_IDS) {
      for (const level of DIFFICULTIES) {
        const pool = packIdentities(packId).filter((i) => DIFFICULTY_POOLS[level].includes(i.difficulty));
        for (const identity of pool) {
          const partners = pool.filter((o) => pairable(identity, o)).length;
          const before = pool.filter((o) => !identitiesClash(identity, o)).length;
          // The rule takes some partners from a name, never most of them.
          if (partners < 5 || partners < 0.6 * before) thin.push(`${packId}/${level}: ${identity.id} has ${partners} of ${before}`);
        }
      }
    }
    expect(thin).toEqual([]);
  });

  // 20,000 deals, so the shares are tight enough for a 1% bound: about 1 s on a quiet machine, and
  // over the default 5 s beside the whole suite on a loaded one. The limit is only a hang guard.
  it("keeps the Mixed weights: each pack's share of dealt names matches its weight", { timeout: 30_000 }, () => {
    const random = testRandom(2024);
    const draws = 20_000;
    const counts = {};
    for (let i = 0; i < draws; i++) {
      const { pair } = drawPair({ packId: "mixed", difficulty: "medium", usedIds: [], random });
      for (const id of pair) counts[byId(id).pack] = (counts[byId(id).pack] ?? 0) + 1;
    }
    const total = Object.values(MIXED_WEIGHTS).reduce((s, w) => s + w, 0);
    for (const [packId, weight] of Object.entries(MIXED_WEIGHTS)) {
      const share = (counts[packId] ?? 0) / (2 * draws);
      expect(Math.abs(share - weight / total), `${packId}: ${share.toFixed(3)} vs ${(weight / total).toFixed(3)}`).toBeLessThan(0.01);
    }
  });
});
