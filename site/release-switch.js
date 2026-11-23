// "New version available": a page that is older than the live site loads the new one, at a moment
// when nothing is lost by it (plan step 3; the room's side is lobby/server/release-points.js).
//
// In a room (the Floor, the Table, and any game played in them):
//   - The page says its build and its protocol in its hello (party-client.js `release`), and the
//     room answers with its own build, its own protocol and whether now is a safe point. The room
//     says it again (`{t: "release"}`) each time that changes, both ways, and a page that hears
//     from somewhere else that a new build is out (below) asks it (`release?`).
//   - When the two builds differ, /api/version says which one is live. Only when the room's build
//     is the live one is the page the older side: at a safe point it reloads, and its saved
//     session puts it straight back in its seat; otherwise it shows "New version ready after
//     this round" and waits for the room's next word. When the page's own build is the
//     live one, the room is the older side (a busy room keeps its old code for up to five minutes
//     after a deploy, DEPLOY.md): the page waits and shows nothing, unless the room also speaks an
//     older protocol than the page, when it shows the notice (it may not understand everything the
//     room says until the room has the new code too). When neither is live (a deploy still on its
//     way round the world), it waits too, and asks /api/version again a little later.
//   - A page that must not reload by itself (a big screen, nobody near it; a page in fullscreen,
//     which a reload would leave) shows "New version, tap to load" at the safe point instead, and
//     loads on the tap. A browser that keeps no session storage could not come back to its seat
//     after a reload: it only says a new version loads the next time it joins.
//   - A room that speaks a newer protocol closes an older page's socket with "update_required"
//     (party-client.js): the page, which has no socket left, reloads into its seat with the same
//     guards as any reload (the spread, its own sheet, once per build).
//   - A whole party behind one address reloads at once after a round: every request counts
//     against the zone's limit on /api/ requests from one address. So each page asks
//     /api/version once per room build (the answer is kept), and each waits a random moment
//     within a spread that grows with the size of the party before it asks and reloads
//     (spreadMs; site/test/release-crowd.test.js holds a party of 30 under the limit).
// Outside a room (the front page, Hot Potato on one device): the page asks /api/version when it is
// shown again and before a new game, and reloads only where its caller says nothing is lost.
//
// Never a reload loop: a page reloads by itself at most once for each release id (sessionStorage).
// A page that is still old after that reload offers the tap instead.
import { RELEASE } from "/release.js";

/** The build this page is. */
export const PAGE_RELEASE = RELEASE.id;
// Every line is short enough to fit, whole, on one line of the bottom bar of a 390-pixel phone
// held upright (about 36 characters): the bar cuts a longer one short.
/** The one notice an older page shows while its room is busy. */
export const NOTICE = "New version ready after this round";
/** An older page at a safe point that waits for something of its own (a sheet, the result card). */
export const SOON_NOTICE = "New version ready in a moment";
/** A page of a newer protocol than its room: the room has to take the new code first. */
export const BEHIND_NOTICE = "New version ready, room catching up";
/** What a page that may not reload by itself shows at a safe point: the line is a button. */
export const TAP_NOTICE = "New version, tap to load";
/** A page that cannot come back to its seat after a reload (no session storage): it says so, and offers nothing. */
export const STAY_NOTICE = "New version next time you join";
/** A page the room let go for its protocol, on its way to the new version. */
export const LOADING_NOTICE = "Loading the new version";
/** A page the room let go that cannot come back to its seat: one tap, and it is honest about the seat. */
export const REJOIN_NOTICE = "Out of date: tap, then join again";
const RELOADED_KEY = "party:reloaded-for";
/** How long a page waits for /api/version before it gives up and decides nothing. */
const VERSION_TIMEOUT_MS = 4000;
/** An answer from /api/version that did not name the room's build is asked again after this long at the soonest. */
export const ASK_AGAIN_MS = 10_000;
/** While nobody can tell (or the room is the older side), the page asks again after these waits, then stops. */
export const RECHECK_MS = [15_000, 30_000, 60_000, 120_000, 240_000];
/** A reload held back by the page itself (a sheet open) is looked at again this often. */
export const LOCAL_WAIT_MS = 1000;
/** The spread of a party's reloads: this much per person in the room, within the bounds below. */
export const SPREAD_PER_PERSON_MS = 1000;
export const MIN_SPREAD_MS = 1500;
export const MAX_SPREAD_MS = 30_000;

/** Over how long a party of `people` (players and screens) spreads its reloads. */
export function spreadMs(people) {
  const n = Number.isFinite(people) && people > 0 ? people : 1;
  return Math.min(MAX_SPREAD_MS, Math.max(MIN_SPREAD_MS, Math.round(n * SPREAD_PER_PERSON_MS)));
}

/**
 * What a page in a room does about the room's build (pure; release-switch.test.js):
 *   "same"   the room is this page's build: nothing (and any notice goes);
 *   "reload" the page is older and now is safe: it reloads by itself;
 *   "notice" the page is older and the room is busy: the notice, and wait;
 *   "tap"    the page is older, now is safe, but it may not reload by itself (`auto` false, or it
 *            already did once for this build and is still older): the tap notice;
 *   "behind" the room is not the live build and speaks an older protocol than the page: the
 *            notice, and wait for the room to take the new code;
 *   "stay"   the page is older and now is safe, but it cannot remember its seat across a reload
 *            (`remembers` false: no session storage): it says so, and offers no reload that would
 *            cost the seat in the middle of a party;
 *   "wait"   the room is older, or it cannot be told which is live yet: nothing.
 * `myProtocol` and `roomProtocol` are protocol numbers as strings; a room that says none is taken
 * to speak the page's own.
 */
export function decide({ mine, room, live, safe, reloadedFor, auto = true, remembers = true, myProtocol = null, roomProtocol = null }) {
  if (!room || room === mine) return "same";
  if (!live || live !== room) return roomProtocol != null && myProtocol != null && Number(roomProtocol) < Number(myProtocol) ? "behind" : "wait";
  if (!remembers) return safe ? "stay" : "wait";
  if (!safe) return auto && reloadedFor !== room ? "notice" : "wait";
  return auto && reloadedFor !== room ? "reload" : "tap";
}

/** The release this tab last reloaded for, if any. */
export function reloadedFor(storage = safeSession()) {
  try {
    return storage?.getItem(RELOADED_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Whether this tab can remember a reload (a private window or blocked site data cannot). */
export function canRemember(storage = safeSession()) {
  if (!storage) return false;
  try {
    const was = storage.getItem(RELOADED_KEY);
    storage.setItem(RELOADED_KEY, was ?? "");
    if (was === null) storage.removeItem?.(RELOADED_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Reloads the page for `id`, unless it already did once in this tab; returns whether it reloads. */
export function reloadFor(id, { storage = safeSession(), reload = () => location.reload() } = {}) {
  if (reloadedFor(storage) === id) return false;
  try {
    storage?.setItem(RELOADED_KEY, id);
    if (!storage) return false;
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
 * The protocol a page says in its hello when its address asks for another one, for the end-to-end
 * tests only (`?protocol=3`, lobby/test/e2e-release.mjs): honoured on a local server alone, so no
 * link to the live site can make a page say what it does not speak. Null otherwise.
 */
export function testProtocol(search = globalThis.location?.search ?? "", hostname = globalThis.location?.hostname ?? "") {
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname)) return null;
  const asked = new URLSearchParams(search).get("protocol");
  return asked && /^[0-9]{1,4}$/.test(asked) ? asked : null;
}

/** The page's address without the test protocol: what a page let go for its protocol reloads into. */
export function withoutTestProtocol(href) {
  const url = new URL(href);
  url.searchParams.delete("protocol");
  return url.href;
}

/**
 * Watches a room page's link (a PartyClient made with `release: PAGE_RELEASE`).
 * - `notice(text, tap)` shows the notice, `notice(null)` takes it away; `tap`, when given, is what
 *   tapping the line does (it is then a button).
 * - `canReload()` is the page's own say: false while something on this page alone would be lost
 *   (a sheet being filled in). The reload waits for it.
 * - `auto()`: whether this page may reload by itself at all (false for a big screen or a page in
 *   fullscreen); without session storage it never does, and offers no tap either (decide, "stay").
 * - `people()`: how many are in the room, for the spread of the reloads.
 * - `live`, `random`, `storage`, `reload`, `reloadClean`, `timers` and `visibility` stand in for the browser's in
 *   the tests.
 */
export function watchRoomRelease(link, opts = {}) {
  const {
    notice = pill,
    canReload = () => true,
    auto = () => !globalThis.document?.fullscreenElement,
    people = () => (link.room?.members?.length ?? 1) + (link.room?.screens ?? 0),
    live = liveRelease,
    random = Math.random,
    storage = safeSession(),
    reload = () => location.reload(),
    // A page let go for its protocol loads its address again without the test protocol.
    reloadClean = () => location.replace(withoutTestProtocol(location.href)),
    timers = globalThis,
    visibility = globalThis.document,
  } = opts;
  const remembers = canRemember(storage);

  // What is on show now, so the page is touched only when it changes.
  let shown = null;
  const show = (text, tap = null) => {
    const key = text ? `${text}|${tap ? "tap" : ""}` : null;
    if (key === shown) return;
    shown = key;
    notice(text, tap ?? undefined);
  };
  const tapToLoad = () => {
    try {
      storage?.setItem(RELOADED_KEY, latest?.id ?? "");
    } catch {
      // A tap is a person: it may reload without the memory.
    }
    reload();
  };

  // What /api/version said. Any answer is kept ASK_AGAIN_MS, so a room that changes its mind often
  // (a count started and stopped) costs one request; a room build once found live stays so for
  // this page (it never needs asking again about that room).
  const confirmed = new Set();
  let asked = null; // {live, at}
  const askLive = async () => {
    if (asked && Date.now() - asked.at < ASK_AGAIN_MS) return asked.live;
    const id = await live();
    asked = { live: id, at: Date.now() };
    return id;
  };
  const liveFor = async (room) => {
    if (confirmed.has(room)) return room;
    const id = await askLive();
    if (id === room) confirmed.add(room);
    return id;
  };

  let latest = null; // the room's last word: {id, safe, protocol}
  let forced = false; // the room let this page go for its protocol
  let pending = null; // the timer of what is to be done next
  let rechecks = 0;
  let run = 0;
  const later = (ms, fn) => {
    timers.clearTimeout(pending);
    pending = timers.setTimeout(fn, ms);
  };
  const jitter = () => Math.floor(random() * spreadMs(people()));

  // Decides about `said`, now: asks /api/version if need be, and acts.
  const act = async (said) => {
    const mine = ++run;
    const id = await liveFor(said.id);
    if (mine !== run || said !== latest) return; // a newer word came meanwhile: it decides
    const what = decide({
      mine: PAGE_RELEASE,
      room: said.id,
      live: id,
      safe: said.safe,
      reloadedFor: reloadedFor(storage),
      auto: auto(),
      remembers,
      myProtocol: link.helloProtocol ?? null,
      roomProtocol: said.protocol ?? null,
    });
    if (what === "reload") {
      if (!canReload()) {
        show(SOON_NOTICE);
        return later(LOCAL_WAIT_MS, () => void act(said));
      }
      if (!reloadFor(said.id, { storage, reload })) show(TAP_NOTICE, tapToLoad);
      return;
    }
    if (what === "notice") show(NOTICE);
    else if (what === "behind") show(BEHIND_NOTICE);
    else if (what === "tap") show(TAP_NOTICE, tapToLoad);
    else if (what === "stay") show(STAY_NOTICE);
    else show(null);
    // Nobody could tell yet, or the room is the older side: ask again a little later, a few times.
    if ((what === "wait" || what === "behind") && !confirmed.has(said.id) && rechecks < RECHECK_MS.length) {
      later(RECHECK_MS[rechecks++] + jitter(), () => void act(said));
    }
  };

  const onRelease = (said) => {
    if (forced) return; // let go for its protocol: that path decides (below)
    // The same word again (a room that woke and says it once more) keeps the wait already running.
    if (pending && latest && said.id === latest.id && said.safe === latest.safe && (said.protocol ?? null) === (latest.protocol ?? null)) return;
    latest = said;
    timers.clearTimeout(pending);
    pending = null;
    run += 1; // anything still waiting on /api/version for an older word is dropped
    if (said.id === PAGE_RELEASE) {
      rechecks = 0;
      return show(null);
    }
    // What costs a request (asking /api/version) or makes one (a reload) waits a random moment
    // of the party's spread, so a party never asks or reloads all at once. A busy room the page
    // already knows is live shows its notice at once.
    if (said.safe || !confirmed.has(said.id)) later(jitter(), () => void act(said));
    else void act(said);
  };
  link.on("release", onRelease);
  // A room of a newer protocol let this page go (it lets every such page go in the same moment).
  // The page has no socket any more, so the only way back is a reload, and it takes it by itself,
  // a big screen and a fullscreen page too, but with the same guards as any reload: a random
  // moment of the party's spread, after its own sheet or result card, and once per room build,
  // under the same key as every other reload (so no two paths can take turns reloading). A page
  // that cannot come back to its seat (no session storage) says so and reloads only on a tap.
  link.on("closed", (why) => {
    if (why !== "update_required") return;
    forced = true;
    timers.clearTimeout(pending);
    pending = null;
    run += 1;
    const id = link.roomRelease ?? "unknown";
    latest = { id, safe: true, protocol: null };
    const go = reloadClean;
    if (!remembers) return show(REJOIN_NOTICE, go);
    if (reloadedFor(storage) === id) return show(TAP_NOTICE, go);
    show(LOADING_NOTICE);
    const attempt = () => {
      if (!canReload()) return later(LOCAL_WAIT_MS, attempt);
      if (!reloadFor(id, { storage, reload: go })) show(TAP_NOTICE, go);
    };
    later(jitter(), attempt);
  });
  // Shown again (a phone unlocked, a tab come back to): if a new build is out, ask the room for its own.
  visibility?.addEventListener?.("visibilitychange", async () => {
    if (visibility.visibilityState !== "visible" || forced) return;
    const id = await askLive();
    if (!id || id === PAGE_RELEASE) return;
    rechecks = 0;
    // The room already said that build: decide again (its earlier checks may have run out).
    if (latest && id === latest.id) later(jitter(), () => void act(latest));
    else link.askRelease();
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
 * room page's stylesheet), for a page that gives no place of its own: `pill(null)` takes it away.
 */
function pill(text, tap) {
  let el = document.querySelector(".release-note");
  if (!text) return el?.remove();
  if (el && (el.tagName === "BUTTON") !== !!tap) {
    el.remove();
    el = null;
  }
  if (!el) {
    el = document.createElement(tap ? "button" : "p");
    el.className = "release-note";
    el.setAttribute("role", "status");
    if (tap) {
      el.type = "button";
      el.addEventListener("click", () => el.onTap?.());
    }
    document.body.append(el);
  }
  el.onTap = tap;
  el.textContent = text;
}

function safeSession() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}
