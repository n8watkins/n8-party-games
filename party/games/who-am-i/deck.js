// The names Who Am I? deals, read from deck-data.js (copied from the live game by
// tools/copy-deck.mjs), with the live game's rules for drawing them: difficulty pools, Mixed's
// weights, and no two names that could be mistaken for each other.
//
// SERVER ONLY. Nothing here may reach a page except through rules.js `view`, which shows a name
// (with its pack and picture) only to a viewer allowed to see it. `PACKS` (names and descriptions
// of the packs, no identities) is the one export a page may be given as it is.
import { MIXED_WEIGHTS, ROWS, SOURCE } from "./deck-data.js";

export { SOURCE };

/** The packs a host can choose, in the live game's order, with what a page may show of them. */
export const PACKS = Object.freeze([
  { id: "mixed", name: "Mixed", description: "A bit of everything, drawn from every pack." },
  { id: "actors", name: "Actors", description: "Film and TV stars, past and present." },
  { id: "movie-characters", name: "Movie Characters", description: "Heroes, villains and icons of the big screen." },
  { id: "historical-figures", name: "Historical Figures", description: "Leaders, scientists, artists and explorers." },
  { id: "video-games", name: "Video Games", description: "Characters from classic and modern games." },
  { id: "brand-mascots", name: "Brand Mascots", description: "The faces behind cereals, snacks and ads." },
  { id: "anime-cartoons", name: "Anime & Cartoons", description: "Animated favorites from TV and comics." },
].map((p) => Object.freeze(p)));
export const PACK_IDS = Object.freeze(PACKS.map((p) => p.id));
export const SOURCE_PACK_IDS = Object.freeze(PACK_IDS.filter((id) => id !== "mixed"));

export const DIFFICULTIES = Object.freeze(["easy", "medium", "hard"]);
/** Which name difficulties each level draws from. They overlap because hard names are scarce (as live). */
export const DIFFICULTY_POOLS = Object.freeze({ easy: ["easy"], medium: ["easy", "medium"], hard: ["medium", "hard"] });

/**
 * Pictures on or off for every name. The live site has a Worker switch (PICTURES=off); the Table's
 * rules see no environment, so here it is this constant. To pull one picture, delete its row's
 * picture in the who-am-i repository and copy the deck again.
 */
export const PICTURES_ON = true;

/** Every name: { id, slug, pack, name, difficulty, aliases, hints, picture }. Frozen. */
export const IDENTITIES = Object.freeze(
  ROWS.map(([slug, pack, name, difficulty, aliases, hints, picture]) =>
    Object.freeze({
      id: `${pack}.${slug}`,
      slug,
      pack,
      name,
      difficulty,
      aliases: Object.freeze([...aliases]),
      hints: Object.freeze([...hints]),
      picture: picture ? Object.freeze({ imageUrl: picture[0], filePage: picture[1], author: picture[2], license: picture[3], free: picture[4] }) : null,
    }),
  ),
);
const BY_ID = new Map(IDENTITIES.map((i) => [i.id, i]));

export function getIdentity(id) {
  const identity = BY_ID.get(id);
  if (!identity) throw new Error(`Unknown name ${id}`);
  return identity;
}

/** The names a pack can deal (Mixed: every pack). */
export function packIdentities(packId) {
  return packId === "mixed" ? IDENTITIES : IDENTITIES.filter((i) => i.pack === packId);
}

const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/** As the live game: case, accents, punctuation and a leading "the" do not count. */
export function normalizeName(name) {
  return String(name)
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

/** Each name's normalised forms, worked out once: ` name ` and the set of its name and aliases. */
const KEYS = new Map(
  IDENTITIES.map((i) => [i.id, { padded: ` ${normalizeName(i.name)} `, all: new Set([i.name, ...i.aliases].map(normalizeName).filter(Boolean)) }]),
);
const keysOf = (identity) =>
  KEYS.get(identity.id) ?? { padded: ` ${normalizeName(identity.name)} `, all: new Set([identity.name, ...identity.aliases].map(normalizeName).filter(Boolean)) };

/**
 * Two names clash when either contains the other as whole words, or they share a name or alias
 * (as live): clashing names are never dealt together, nor as "different" names in one match.
 */
export function identitiesClash(a, b) {
  if (a.id === b.id) return true;
  const ka = keysOf(a);
  const kb = keysOf(b);
  if (ka.padded.includes(kb.padded) || kb.padded.includes(ka.padded)) return true;
  for (const k of ka.all) if (kb.all.has(k)) return true;
  return false;
}

/**
 * Everything of a name that reaches the OTHER player's phone during a round: the name itself, its
 * hints (in the shared turn log once asked for) and its picture's addresses and author; normalised
 * whole words, padded with spaces.
 */
const SHOWN_WORDS = new Map(
  IDENTITIES.map((i) => {
    const picture = i.picture ? [i.picture.imageUrl, i.picture.filePage, i.picture.author ?? ""] : [];
    return [i.id, ` ${normalizeName([i.name, ...i.hints, ...picture].join(" | "))} `];
  }),
);

/**
 * Whether what `a`'s player shows the other phone (`a`'s name, hints or picture) names `b` or one
 * of its aliases as whole words. The live lists have such pairs: "Link from The Legend of Zelda"
 * carries "Zelda" to Princess Zelda's player, Katniss Everdeen's picture is a file named after
 * Jennifer Lawrence, and Princess Zelda's is "Link_to_the_Past_Zelda.png".
 */
export function mentions(a, b) {
  const words = SHOWN_WORDS.get(a.id) ?? ` ${normalizeName(a.name)} `;
  for (const k of keysOf(b).all) if (words.includes(` ${k} `)) return true;
  return false;
}

/** Two names that may be dealt in the same round: no clash, and neither gives the other away. */
export function pairable(a, b) {
  return !identitiesClash(a, b) && !mentions(a, b) && !mentions(b, a);
}

function pickUniform(items, random) {
  return items[Math.floor(random() * items.length)];
}

/** One name from the candidates: uniform in a single pack; in Mixed, a pack by weight first. */
function pickOne(candidates, packId, random) {
  if (packId !== "mixed") return pickUniform(candidates, random);
  const groups = new Map();
  for (const c of candidates) {
    if (!groups.has(c.pack)) groups.set(c.pack, []);
    groups.get(c.pack).push(c);
  }
  const entries = [...groups.entries()];
  const total = entries.reduce((sum, [id]) => sum + MIXED_WEIGHTS[id], 0);
  let roll = random() * total;
  for (const [id, list] of entries) {
    roll -= MIXED_WEIGHTS[id];
    if (roll < 0) return pickUniform(list, random);
  }
  return pickUniform(entries[entries.length - 1][1], random);
}

/** The names that can still be dealt: unused, and each with at least one partner it may be dealt beside. */
function dealable(pool, used) {
  const unused = pool.filter((c) => !used.some((u) => identitiesClash(c, u)));
  return unused.filter((c) => unused.some((d) => pairable(c, d)));
}

/**
 * Two different names that clash with nothing used earlier in the match, the first for the round's
 * first guesser; when the pack runs out, the used list starts again (`reshuffled`).
 * Whether it reshuffles is settled before anything is drawn, from the names already used (shown at
 * earlier reveals) alone, so the "reshuffled" note says nothing about the names being dealt now.
 * The generator is called the same number of times whatever is dealt.
 * Returns { pair: [id, id], reshuffled }.
 */
export function drawPair({ packId, difficulty, usedIds, random }) {
  const pool = packIdentities(packId).filter((c) => DIFFICULTY_POOLS[difficulty].includes(c.difficulty));
  let candidates = dealable(pool, usedIds.map(getIdentity));
  const reshuffled = candidates.length === 0;
  if (reshuffled) candidates = dealable(pool, []);
  if (!candidates.length) throw new Error(`The ${packId} pack is too small to deal two names`);
  const first = pickOne(candidates, packId, random);
  const second = pickOne(
    candidates.filter((c) => pairable(c, first)),
    packId,
    random,
  );
  return { pair: [first.id, second.id], reshuffled };
}

/** What a viewer allowed to see a name gets of it: the name, its pack and its picture. Never its id. */
export function publicIdentity(id) {
  const i = getIdentity(id);
  return { name: i.name, pack: i.pack, picture: PICTURES_ON && i.picture ? { ...i.picture } : null };
}
