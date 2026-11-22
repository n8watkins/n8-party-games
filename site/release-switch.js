// "New version available": a page that is older than the live site loads the new one, at a moment
// when nothing is lost by it (plan step 3; the room's side is lobby/server/release-points.js).
//
// In a room (the Floor, the Table, and any game played in them):
//   - The page says its build in its hello (party-client.js `release`), and the room answers with
//     its own and whether now is a safe point. The room says it again (`{t: "release"}`) each time
//     it comes to a safe point, and a page that hears from somewhere else that a new build is out
//     (below) asks it (`release?`).
//   - When the two differ, /api/version says which one is live. Only when the room's build is the
//     live one is the page the older side: at a safe point it reloads, and its saved session puts
//     it straight back in its seat; otherwise it shows "New version ready, it will load after this
//     round" and waits for the room's next word. When the page's own build is the live one, the
//     room is the older side (a busy room keeps its old code for up to five minutes after a
//     deploy, DEPLOY.md): the page waits and shows nothing. When neither is (a deploy still on its
//     way round the world), it waits too.
//   - A room that speaks a newer protocol closes an older page's socket with "update_required"
//     (party-client.js): the page reloads into its seat.
// Outside a room (the front page, Hot Potato on one device): the page asks /api/version when it is
// shown again and before a new game, and reloads only where its caller says nothing is lost.
//
// Never a reload loop: a page reloads at most once for each release id (sessionStorage). A page
// that is still old after that reload stays as it is.
import { RELEASE } from "/release.js";

/** The build this page is. */
export const PAGE_RELEASE = RELEASE.id;
/** The one notice an older page shows while its room is busy. */
export const NOTICE = "New version ready, it will load after this round";
const RELOADED_KEY = "party:reloaded-for";
/** How long a page waits for /api/version before it gives up and decides nothing. */
const VERSION_TIMEOUT_MS = 4000;

/**
 * What a page in a room does about the room's build (pure; release-switch.test.js):
 *   "same"   the room is this page's build: nothing (and any notice goes);
 *   "reload" the page is older and now is safe: it reloads;
 *   "notice" the page is older and the room is busy: the notice, and wait;
 *   "wait"   the room is older, or it cannot be told which is live yet: nothing;
 *   "done"   the page already reloaded once for this build and is still older: nothing more.
 */
export function decide({ mine, room, live, safe, reloadedFor }) {
  if (!room || room === mine) return "same";
  if (!live || live !== room) return "wait";
  if (reloadedFor === room) return "done";
  return safe ? "reload" : "notice";
}

/** The release this tab last reloaded for, if any. */
export function reloadedFor(storage = safeSession()) {
  try {
    return storage?.getItem(RELOADED_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Reloads the page for `id`, unless it already did once in this tab; returns whether it reloads. */
export function reloadFor(id, { storage = safeSession(), reload = () => location.reload() } = {}) {
  if (reloadedFor(storage) === id) return false;
  try {
    storage?.setItem(RELOADED_KEY, id);
  } catch {
    // No storage (a private window, blocked site data): no memory either, so no reload, or it could loop.
    return false;
  }
  reload();
  return true;
}

/** The live build's id, from /api/version (never cached), or null when it cannot be told. */
export async function liveRelease({ fetchImpl = fetch, timeoutMs = VERSION_TIMEOUT_MS } = {}) {
  try {
    const res = await fetchImpl("/api/version", { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const id = (await res.json())?.release;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/**
 * Watches a room page's link (a PartyClient made with `release: PAGE_RELEASE`). `notice(text)`
 * shows the notice, and `notice(null)` takes it away. `canReload()`, when given, is the page's own
 * say: false while something on this page alone would be lost (a form being typed in).
 */
export function watchRoomRelease(link, { notice = pill, canReload = () => true, live = liveRelease } = {}) {
  let busy = false;
  let shown = false;
  const show = (text) => {
    if (shown === !!text) return;
    shown = !!text;
    notice(text);
  };
  // While /api/version is being asked, the room's latest word waits its turn (it is never dropped).
  let next = null;
  const onRelease = async (said) => {
    if (said.id === PAGE_RELEASE) return show(null);
    if (busy) {
      next = said;
      return;
    }
    busy = true;
    try {
      const what = decide({ mine: PAGE_RELEASE, room: said.id, live: await live(), safe: said.safe && canReload(), reloadedFor: reloadedFor() });
      if (what === "reload") {
        if (!reloadFor(said.id)) show(null);
      } else if (what === "notice") show(NOTICE);
      else show(null);
    } finally {
      busy = false;
    }
    if (next) {
      const later = next;
      next = null;
      await onRelease(later);
    }
  };
  link.on("release", (said) => void onRelease(said));
  // A room of a newer protocol let this page go: it reloads into its seat (once for this build).
  link.on("closed", (why) => {
    if (why === "update_required") reloadFor(`protocol:${link.roomRelease ?? "unknown"}`) || location.assign("/");
  });
  // Shown again (a phone unlocked, a tab come back to): if a new build is out, ask the room for its own.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    const id = await live();
    if (id && id !== PAGE_RELEASE) link.askRelease();
  });
}

/**
 * Outside a room: whether a newer build is live, and if so reload into it (once per build) when
 * `canReload()` says nothing is lost. Resolves to whether the page is reloading. Called when the
 * page is shown again (watchOutsideRelease) and before a new game.
 */
export async function reloadIfNewer({ canReload = () => true, live = liveRelease } = {}) {
  const id = await live();
  if (!id || id === PAGE_RELEASE || !canReload()) return false;
  return reloadFor(id);
}

/** Outside a room: checks for a newer build each time the page is shown again. */
export function watchOutsideRelease({ canReload = () => true } = {}) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void reloadIfNewer({ canReload });
  });
}

/**
 * The notice as a small line of its own at the foot of the screen (`.release-note`, styled by each
 * room page's stylesheet), never covering the game's controls: `pill(null)` takes it away.
 */
function pill(text) {
  let el = document.querySelector(".release-note");
  if (!text) return el?.remove();
  if (!el) {
    el = document.createElement("p");
    el.className = "release-note";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = text;
}

function safeSession() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}
