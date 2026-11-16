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

const nameKeys = (identity) => [identity.name, ...identity.aliases].map(normalizeName).filter(Boolean);

/**
 * Two names clash when either contains the other as whole words, or they share a name or alias
 * (as live): clashing names are never dealt together, nor as "different" names in one match.
 */
export function identitiesClash(a, b) {
  if (a.id === b.id) return true;
  const an = ` ${normalizeName(a.name)} `;
  const bn = ` ${normalizeName(b.name)} `;
  if (an.includes(bn) || bn.includes(an)) return true;
  const bKeys = new Set(nameKeys(b));
  return nameKeys(a).some((k) => bKeys.has(k));
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

function drawFrom(pool, used, packId, random) {
  const unused = pool.filter((c) => !used.some((u) => identitiesClash(c, u)));
  if (!unused.length) return null;
  const first = pickOne(unused, packId, random);
  const rest = unused.filter((c) => !identitiesClash(c, first));
  if (!rest.length) return null;
  return [first, pickOne(rest, packId, random)];
}

/**
 * Two different names that clash with nothing used earlier in the match, the first for the round's
 * first guesser; when the pack runs out, the used list starts again (`reshuffled`).
 * Returns { pair: [id, id], reshuffled }.
 */
export function drawPair({ packId, difficulty, usedIds, random }) {
  const pool = packIdentities(packId).filter((c) => DIFFICULTY_POOLS[difficulty].includes(c.difficulty));
  const used = usedIds.map(getIdentity);
  const pair = drawFrom(pool, used, packId, random);
  if (pair) return { pair: pair.map((i) => i.id), reshuffled: false };
  const again = drawFrom(pool, [], packId, random);
  if (!again) throw new Error(`The ${packId} pack is too small to deal two names`);
  return { pair: again.map((i) => i.id), reshuffled: true };
}

/** What a viewer allowed to see a name gets of it: the name, its pack and its picture. Never its id. */
export function publicIdentity(id) {
  const i = getIdentity(id);
  return { name: i.name, pack: i.pack, picture: PICTURES_ON && i.picture ? { ...i.picture } : null };
}
