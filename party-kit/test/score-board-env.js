// A Worker environment with one real ScoreBoard on in-memory storage, for the score board's tests.
// The test file that imports this must mock "cloudflare:workers" (vi.mock, which vitest hoists),
// as score-runs.test.js does.
import { handlePartyApi } from "../src/worker/index.js";
import { ScoreBoard } from "../src/worker/score-board.js";

/** A Durable Object's storage, in memory: get, put, delete (one key or many) and list in key order. */
export function memoryStorage() {
  const map = new Map();
  return {
    map,
    async get(key) {
      return structuredClone(map.get(key));
    },
    async put(key, value) {
      map.set(key, structuredClone(value));
    },
    async delete(keys) {
      for (const key of [keys].flat()) map.delete(key);
    },
    async list({ prefix = "", end, limit = Infinity } = {}) {
      const keys = [...map.keys()].filter((k) => k.startsWith(prefix) && (end === undefined || k < end)).sort();
      return new Map(keys.slice(0, limit).map((k) => [k, structuredClone(map.get(k))]));
    },
  };
}

/** {env, storage, board, hits}: one board for every game, and a limiter that always allows, or never. */
export function boardEnv({ allow = true } = {}) {
  const storage = memoryStorage();
  const board = new ScoreBoard({ storage }, {});
  const hits = [];
  const env = {
    PARTY_RATE_LIMIT: "on",
    PARTY_LIMITER: { getByName: (name) => ({ hit: async (rule) => (hits.push({ name, rule }), allow) }) },
    PARTY_SCORES: { getByName: () => board },
  };
  return { env, storage, board, hits };
}

/** POSTs to /api/party/scores/<path> through the kit's door, as a page would: {status, ...body}. */
export async function postScore(env, scores, path, body) {
  const request = new Request(`https://party.test/api/party/scores/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handlePartyApi(request, env, { scores });
  return { status: res.status, ...(await res.json()) };
}
