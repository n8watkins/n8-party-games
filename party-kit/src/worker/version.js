// GET /api/version: which build is live, for a player, a monitor or a page that wants to know
// whether a newer build is out. The same shape as Who Am I?'s (`versionInfo()` in that repo:
// ok, name, version, commit), with the release record's own fields beside it.
//
// `release` is the build's release record (scripts/release.mjs in the party site); the Worker
// version comes from the version metadata binding (CF_VERSION_METADATA) where the Worker has one.
import { json } from "./http.js";

export const VERSION_PATH = "/api/version";

/** A Worker version id is a UUID; anything else (a missing binding) is left out. */
const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What /api/version answers: `{ok, name, version, commit, release, dirty, pushed, builtAt, games, worker}`.
 * `worker` is `{id, tag, timestamp}` of the Worker version serving it, or null without the binding.
 */
export function versionInfo(release, env = {}, name = "n8-party-games") {
  const meta = env.CF_VERSION_METADATA;
  const worker = meta && VERSION_ID.test(meta.id ?? "") ? { id: meta.id, tag: meta.tag || null, timestamp: meta.timestamp || null } : null;
  return {
    ok: true,
    name,
    version: release.site,
    commit: release.commit,
    release: release.id,
    dirty: release.dirty,
    pushed: release.pushed,
    builtAt: release.builtAt,
    games: release.games,
    worker,
  };
}

/**
 * The response for a request to VERSION_PATH, or null for any other path. Never cached
 * (`no-store`, as every API answer): it says what is live now.
 */
export function handleVersion(request, release, env, name) {
  if (new URL(request.url).pathname !== VERSION_PATH) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return json({ ok: false, error: "bad_request", message: "Use GET." }, 405, { Allow: "GET, HEAD" });
  return json(versionInfo(release, env, name));
}

/** Where the pages import the release record from (scripts/release.mjs, RELEASE_FILE). */
export const RELEASE_SCRIPT_PATH = "/release.js";

/** The module a page imports as /release.js: the Worker's own record, as the build writes it. */
export function releaseScript(release) {
  return `export const RELEASE = Object.freeze(${JSON.stringify(release)});\n`;
}

/**
 * The response for a request to /release.js, or null for any other path. The Worker answers it
 * with the record it was built with (wrangler.jsonc runs the Worker first for this path), not
 * the copy in the static folder: so a page always names the build of the Worker that served it,
 * the one its rooms and /api/version name too. Before, several local Workers sharing one
 * dist/public (the pre-deploy gate) could serve a copy another build had just written there, and
 * every page believed a new version was out. Never kept by the browser without asking again
 * (`no-cache`), as the static file was not.
 */
export function handleReleaseScript(request, release) {
  if (new URL(request.url).pathname !== RELEASE_SCRIPT_PATH) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  return new Response(request.method === "HEAD" ? null : releaseScript(release), {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" },
  });
}
