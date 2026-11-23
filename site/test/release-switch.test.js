// What a page does about a new build (site/release-switch.js): it reloads only when it is the
// older side (the room's build is the live one) and the room is at a safe point, at most once per
// build, a random moment of its party's spread later; it shows the notice while the room is busy,
// and takes it away when the room is safe again or the builds agree; it waits whenever the room is
// the older one or nobody can tell yet, and asks again later. A big screen, a page in fullscreen
// and a page without session storage never reload by themselves: they offer the tap. A page of a
// newer protocol than its room shows the notice and waits for the room. Outside a room it reloads
// only where its caller says nothing is lost.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASK_AGAIN_MS,
  BEHIND_NOTICE,
  LOADING_NOTICE,
  LOCAL_WAIT_MS,
  MAX_SPREAD_MS,
  MIN_SPREAD_MS,
  NOTICE,
  PAGE_RELEASE,
  RECHECK_MS,
  REJOIN_NOTICE,
  SOON_NOTICE,
  STAY_NOTICE,
  TAP_NOTICE,
  canRemember,
  decide,
  liveRelease,
  reloadFor,
  reloadIfNewer,
  reloadedFor,
  spreadMs,
  testProtocol,
  watchRoomRelease,
  withoutTestProtocol,
} from "../release-switch.js";

const MINE = PAGE_RELEASE;
const NEW = "cccccccccccc";
const OLDER = "bbbbbbbbbbbb";

function memory() {
  const kept = new Map();
  return { kept, getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => void kept.set(k, String(v)), removeItem: (k) => void kept.delete(k) };
}
const blocked = () => ({
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
});

describe("decide", () => {
  it.each([
    ["the room is this page's build", { room: MINE, live: NEW, safe: true }, "same"],
    ["the room says no build", { room: null, live: NEW, safe: true }, "same"],
    ["the page is older and the room is at a safe point", { room: NEW, live: NEW, safe: true }, "reload"],
    ["the page is older and the room is busy", { room: NEW, live: NEW, safe: false }, "notice"],
    ["the room is older (a busy room on its old code after a deploy)", { room: OLDER, live: MINE, safe: true }, "wait"],
    ["nobody can tell which is live", { room: NEW, live: null, safe: true }, "wait"],
    ["a deploy on its way: the live build is neither", { room: NEW, live: "dddddddddddd", safe: true }, "wait"],
    ["the page already reloaded for this build and is still older: the tap, at a safe point", { room: NEW, live: NEW, safe: true, reloadedFor: NEW }, "tap"],
    ["... and nothing while the room is busy", { room: NEW, live: NEW, safe: false, reloadedFor: NEW }, "wait"],
    ["a page that may not reload by itself, at a safe point: the tap", { room: NEW, live: NEW, safe: true, auto: false }, "tap"],
    ["... and nothing while the room is busy (no promise it cannot keep)", { room: NEW, live: NEW, safe: false, auto: false }, "wait"],
    ["the room is older and speaks an older protocol: the notice, and wait for it", { room: OLDER, live: MINE, safe: true, myProtocol: "3", roomProtocol: "2" }, "behind"],
    ["... compared as numbers (9 < 10)", { room: OLDER, live: MINE, safe: true, myProtocol: "10", roomProtocol: "9" }, "behind"],
    ["the room is older but speaks the page's protocol: nothing", { room: OLDER, live: MINE, safe: true, myProtocol: "2", roomProtocol: "2" }, "wait"],
    ["a room of an older protocol that IS live (a rollback): the page goes back to it", { room: OLDER, live: OLDER, safe: true, myProtocol: "3", roomProtocol: "2" }, "reload"],
    ["a room that says no protocol is taken to speak the page's", { room: OLDER, live: MINE, safe: true, myProtocol: "3", roomProtocol: null }, "wait"],
    ["a page that cannot remember its seat, at a safe point: it says so and offers nothing", { room: NEW, live: NEW, safe: true, remembers: false }, "stay"],
    ["... and nothing while the room is busy", { room: NEW, live: NEW, safe: false, remembers: false }, "wait"],
  ])("%s", (_, given, what) => {
    expect(decide({ mine: MINE, reloadedFor: null, ...given })).toBe(what);
  });
});

describe("reloading", () => {
  it("happens at most once for each build in a tab", () => {
    const storage = memory();
    const reload = vi.fn();
    expect(reloadFor(NEW, { storage, reload })).toBe(true);
    expect(reloadFor(NEW, { storage, reload })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadedFor(storage)).toBe(NEW);
    // A later build may reload once more.
    expect(reloadFor("eeeeeeeeeeee", { storage, reload })).toBe(true);
  });

  it("never happens without storage to remember it in, which could loop", () => {
    const reload = vi.fn();
    expect(reloadFor(NEW, { storage: blocked(), reload })).toBe(false);
    expect(reloadFor(NEW, { storage: null, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(canRemember(blocked())).toBe(false);
    expect(canRemember(null)).toBe(false);
    const fine = memory();
    expect(canRemember(fine)).toBe(true);
    expect(fine.kept.size).toBe(0);
  });

  it("spreads a party's reloads over a time that grows with the party, within bounds", () => {
    expect(spreadMs(1)).toBe(MIN_SPREAD_MS);
    expect(spreadMs(0)).toBe(MIN_SPREAD_MS);
    expect(spreadMs(Number.NaN)).toBe(MIN_SPREAD_MS);
    expect(spreadMs(5)).toBe(5000);
    expect(spreadMs(20)).toBe(20_000);
    expect(spreadMs(30)).toBe(MAX_SPREAD_MS);
    expect(spreadMs(500)).toBe(MAX_SPREAD_MS);
  });
});

describe("the test protocol", () => {
  it("is honoured on a local server only, and only as a number", () => {
    expect(testProtocol("?protocol=3", "localhost")).toBe("3");
    expect(testProtocol("?start&protocol=1", "127.0.0.1")).toBe("1");
    expect(testProtocol("?protocol=3", "partygames.n8builds.dev")).toBeNull();
    expect(testProtocol("?protocol=three", "localhost")).toBeNull();
    expect(testProtocol("?start", "localhost")).toBeNull();
  });

  it("is left out of the address a page let go for its protocol reloads into", () => {
    expect(withoutTestProtocol("http://localhost:9540/lobby/?protocol=1&look=flat")).toBe("http://localhost:9540/lobby/?look=flat");
    expect(withoutTestProtocol("https://partygames.n8builds.dev/lobby/")).toBe("https://partygames.n8builds.dev/lobby/");
  });
});

describe("the live build", () => {
  it("comes from /api/version, never cached, and is null when it cannot be read", async () => {
    const seen = [];
    const ok = async (url, init) => (seen.push([url, init.cache]), { ok: true, json: async () => ({ release: NEW }) });
    expect(await liveRelease({ fetchImpl: ok })).toBe(NEW);
    expect(seen).toEqual([["/api/version", "no-store"]]);
    expect(await liveRelease({ fetchImpl: async () => ({ ok: false }) })).toBeNull();
    expect(
      await liveRelease({
        fetchImpl: async () => {
          throw new Error("offline");
        },
      }),
    ).toBeNull();
  });

  it("outside a room, a newer one reloads the page only where nothing is lost", async () => {
    vi.stubGlobal("sessionStorage", memory());
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    try {
      expect(await reloadIfNewer({ live: async () => MINE })).toBe(false);
      expect(await reloadIfNewer({ live: async () => null })).toBe(false);
      expect(await reloadIfNewer({ live: async () => NEW, canReload: () => false })).toBe(false);
      expect(reload).not.toHaveBeenCalled();
      expect(await reloadIfNewer({ live: async () => NEW })).toBe(true);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("a page in a room", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_700_000_000_000 }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A stand-in for the PartyClient: its events, the room it last heard, and whether it was asked for the room's build. */
  function fakeLink({ people = 4, protocol = "2" } = {}) {
    const handlers = new Map();
    return {
      on: (t, h) => handlers.set(t, h),
      fire: (t, ...a) => handlers.get(t)?.(...a),
      room: { members: Array.from({ length: people }, () => ({})), screens: 0 },
      roomRelease: null,
      helloProtocol: protocol,
      askRelease: vi.fn(),
    };
  }

  /**
   * A page watching `link`, with everything the browser would give it stood in for. `live` is what
   * /api/version answers now (a function, so a test can change it); every ask is counted.
   */
  function page({ live = () => NEW, storage = memory(), auto = () => true, canReload = () => true, people, protocol } = {}) {
    const link = fakeLink({ people, protocol });
    const notes = [];
    const taps = [];
    const reload = vi.fn();
    const reloadClean = vi.fn();
    const asks = { n: 0 };
    let visible = null;
    const visibility = {
      visibilityState: "visible",
      addEventListener: (_, fn) => (visible = fn),
    };
    watchRoomRelease(link, {
      notice: (text, tap) => {
        notes.push(text);
        taps.push(tap ?? null);
      },
      live: async () => (asks.n++, live()),
      random: () => 0.5,
      storage,
      reload,
      reloadClean,
      auto,
      canReload,
      visibility,
    });
    return { link, notes, taps, reload, reloadClean, asks, storage, shownAgain: () => visible?.() };
  }
  /** Lets every timer due within `ms` run, and the promises after them. */
  const wait = (ms) => vi.advanceTimersByTimeAsync(ms);
  const SPREAD = spreadMs(4);

  it("shows the notice while the room is busy, then reloads at its safe point, once, within its party's spread", async () => {
    const p = page();
    p.link.fire("release", { id: NEW, safe: false, protocol: "2" });
    await wait(SPREAD);
    expect(p.notes).toEqual([NOTICE]);
    expect(p.reload).not.toHaveBeenCalled();
    p.link.fire("release", { id: NEW, safe: true, protocol: "2" });
    // Not at once: half the spread later (random 0.5), so a party never reloads all at once.
    await wait(SPREAD / 2 - 100);
    expect(p.reload).not.toHaveBeenCalled();
    await wait(200);
    expect(p.reload).toHaveBeenCalledTimes(1);
    expect(reloadedFor(p.storage)).toBe(NEW);
    // The reload did not happen (a stand-in): the same word again does not reload a second time.
    p.link.fire("release", { id: NEW, safe: true, protocol: "2" });
    await wait(SPREAD);
    expect(p.reload).toHaveBeenCalledTimes(1);
  });

  it("asks /api/version once for a room build it found live, however often the room changes its mind", async () => {
    const p = page();
    for (let i = 0; i < 6; i++) {
      p.link.fire("release", { id: NEW, safe: false, protocol: "2" });
      await wait(SPREAD);
    }
    expect(p.asks.n).toBe(1);
    expect(p.notes).toEqual([NOTICE]);
  });

  it("asks again about an answer that did not name the room's build no sooner than ASK_AGAIN_MS", async () => {
    const p = page({ live: () => MINE });
    p.link.fire("release", { id: OLDER, safe: false, protocol: "2" });
    await wait(SPREAD);
    p.link.fire("release", { id: OLDER, safe: true, protocol: "2" });
    await wait(SPREAD);
    expect(p.asks.n).toBe(1);
    await wait(ASK_AGAIN_MS);
    p.link.fire("release", { id: OLDER, safe: false, protocol: "2" });
    await wait(SPREAD);
    expect(p.asks.n).toBe(2);
    expect(p.notes).toEqual([]);
    expect(p.reload).not.toHaveBeenCalled();
  });

  it("a word that comes while it waits its turn decides instead: a count that starts stops the reload", async () => {
    const p = page();
    p.link.fire("release", { id: NEW, safe: true, protocol: "2" });
    await wait(SPREAD / 4);
    p.link.fire("release", { id: NEW, safe: false, protocol: "2" });
    await wait(SPREAD);
    expect(p.reload).not.toHaveBeenCalled();
    expect(p.notes).toEqual([NOTICE]);
    // The count is called off: the room says safe again, and the page goes (no notice left up).
    p.link.fire("release", { id: NEW, safe: true, protocol: "2" });
    await wait(SPREAD);
    expect(p.reload).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the room is the older side, and takes a notice away when the builds agree", async () => {
    let live = NEW;
    const p = page({ live: () => live });
    p.link.fire("release", { id: NEW, safe: false, protocol: "2" });
    await wait(SPREAD);
    expect(p.notes).toEqual([NOTICE]);
    live = MINE;
    p.link.fire("release", { id: OLDER, safe: true, protocol: "2" });
    await wait(SPREAD + ASK_AGAIN_MS);
    expect(p.notes).toEqual([NOTICE, null]);
    p.link.fire("release", { id: MINE, safe: true, protocol: "2" });
    await wait(SPREAD);
    expect(p.notes).toEqual([NOTICE, null]);
    expect(p.reload).not.toHaveBeenCalled();
  });

  it("asks again later while nobody can tell, and reloads once the deploy has gone round", async () => {
    let live = OLDER; // the edge still serves the build before
    const p = page({ live: () => live });
    p.link.fire("release", { id: NEW, safe: true, protocol: "2" });
    await wait(SPREAD);
    expect(p.reload).not.toHaveBeenCalled();
    live = NEW;
    await wait(RECHECK_MS[0] + SPREAD);
    expect(p.reload).toHaveBeenCalledTimes(1);
  });

  it("stops asking after its few rechecks, and asks again when it is shown again", async () => {
    const p = page({ live: () => null });
    p.link.fire("release", { id: NEW, safe: true, protocol: "2" });
    await wait(RECHECK_MS.reduce((a, b) => a + b, 0) + RECHECK_MS.length * SPREAD + SPREAD);
    const asked = p.asks.n;
    expect(asked).toBe(1 + RECHECK_MS.length);
    await wait(10 * 60_000);
    expect(p.asks.n).toBe(asked);
    p.shownAgain();
    await wait(0);
    expect(p.asks.n).toBe(asked + 1);
  });

  it("waits for its own sheet to close before it reloads, without a new word from the room", async () => {
    let sheet = true;
    const p = page({ canReload: () => !sheet });
    p.link.fire("release", { id: NEW, safe: true, protocol: "2" });
    await wait(SPREAD);
    // "In a moment", not "after this round": the room is at a safe point, the page is what waits.
    expect(p.notes).toEqual([SOON_NOTICE]);
    expect(p.reload).not.toHaveBeenCalled();
    sheet = false;
    await wait(LOCAL_WAIT_MS);
    expect(p.reload).toHaveBeenCalledTimes(1);
  });

  it("the same word again keeps the wait already running (a room that woke says it once more)", async () => {
    const p = page();
    p.link.fire("release", { id: NEW, safe: true, protocol: "2" });
    // Just before its moment comes, the room says the same again, and again: the moment holds.
    await wait(SPREAD / 2 - 100);
    p.link.fire("release", { id: NEW, safe: true, protocol: "2" });
    p.link.fire("release", { id: NEW, safe: true, protocol: "2" });
    await wait(200);
    expect(p.reload).toHaveBeenCalledTimes(1);
  });

  it("a big screen or a page in fullscreen never reloads by itself: the tap, at a safe point, and the tap loads", async () => {
    const p = page({ auto: () => false });
    p.link.fire("release", { id: NEW, safe: false, protocol: "2" });
    await wait(SPREAD);
    expect(p.notes).toEqual([]);
    p.link.fire("release", { id: NEW, safe: true, protocol: "2" });
    await wait(SPREAD);
    expect(p.reload).not.toHaveBeenCalled();
    expect(p.notes).toEqual([TAP_NOTICE]);
    expect(typeof p.taps[0]).toBe("function");
    // Busy again: the tap goes, so nobody reloads a screen in the middle of a round.
    p.link.fire("release", { id: NEW, safe: false, protocol: "2" });
    await wait(SPREAD);
    expect(p.notes).toEqual([TAP_NOTICE, null]);
    p.link.fire("release", { id: NEW, safe: true, protocol: "2" });
    await wait(SPREAD);
    p.taps.at(-1)();
    expect(p.reload).toHaveBeenCalledTimes(1);
  });

  it("without session storage a reload would cost the seat: it says the new version loads next time, and offers nothing", async () => {
    const p = page({ storage: blocked() });
    p.link.fire("release", { id: NEW, safe: false, protocol: "2" });
    await wait(SPREAD);
    expect(p.notes).toEqual([]);
    p.link.fire("release", { id: NEW, safe: true, protocol: "2" });
    await wait(SPREAD);
    expect(p.reload).not.toHaveBeenCalled();
    expect(p.notes).toEqual([STAY_NOTICE]);
    expect(p.taps).toEqual([null]);
  });

  it("still older after its one reload for a build: the tap, never a second reload by itself", async () => {
    const storage = memory();
    storage.setItem("party:reloaded-for", NEW);
    const p = page({ storage });
    p.link.fire("release", { id: NEW, safe: true, protocol: "2" });
    await wait(SPREAD);
    expect(p.reload).not.toHaveBeenCalled();
    expect(p.notes).toEqual([TAP_NOTICE]);
  });

  it("a page of a newer protocol than its room shows the notice, never reloads, and is done when the room has the new code", async () => {
    const p = page({ live: () => MINE, protocol: "3" });
    p.link.fire("release", { id: OLDER, safe: true, protocol: "2" });
    await wait(SPREAD);
    expect(p.notes).toEqual([BEHIND_NOTICE]);
    // The room becomes busy and safe again: it stays, and it waits.
    p.link.fire("release", { id: OLDER, safe: false, protocol: "2" });
    await wait(SPREAD);
    p.link.fire("release", { id: OLDER, safe: true, protocol: "2" });
    await wait(RECHECK_MS[0] + SPREAD);
    expect(p.reload).not.toHaveBeenCalled();
    expect(p.notes).toEqual([BEHIND_NOTICE]);
    // The room took the new code (its socket came back): the page's own build, and the notice goes.
    p.link.fire("release", { id: MINE, safe: true, protocol: "3" });
    await wait(0);
    expect(p.notes).toEqual([BEHIND_NOTICE, null]);
  });

  it("shown again with a new build out, it asks the room for its own", async () => {
    let live = MINE;
    const p = page({ live: () => live });
    p.link.fire("release", { id: MINE, safe: true, protocol: "2" });
    live = NEW;
    p.shownAgain();
    await wait(0);
    expect(p.link.askRelease).toHaveBeenCalledTimes(1);
  });

  /** The room lets the page go for its protocol, as party-client.js says it (after the hello's word). */
  const letGo = (p, id = NEW) => {
    p.link.roomRelease = id;
    p.link.fire("closed", "update_required");
  };

  it("let go by a room of a newer protocol, it reloads into its seat a moment of the spread later, not at once", async () => {
    const p = page();
    letGo(p);
    expect(p.notes).toEqual([LOADING_NOTICE]);
    expect(p.reloadClean).not.toHaveBeenCalled();
    await wait(SPREAD / 2 + 10);
    expect(p.reloadClean).toHaveBeenCalledTimes(1);
    expect(p.reload).not.toHaveBeenCalled();
  });

  it("by default that reload leaves the test protocol out of the address", () => {
    const replace = vi.fn();
    vi.stubGlobal("location", { href: "http://localhost:9540/lobby/?protocol=1&look=flat", replace });
    const handlers = new Map();
    watchRoomRelease({ on: (t, h) => handlers.set(t, h), room: null, roomRelease: NEW, helloProtocol: "1", askRelease: () => {} }, { notice: () => {}, storage: memory(), random: () => 0, visibility: null });
    handlers.get("closed")("update_required");
    vi.advanceTimersByTime(0);
    expect(replace).toHaveBeenCalledWith("http://localhost:9540/lobby/?look=flat");
  });

  it("let go, it waits for its own sheet or result card first", async () => {
    let sheet = true;
    const p = page({ canReload: () => !sheet });
    letGo(p);
    await wait(SPREAD);
    expect(p.reloadClean).not.toHaveBeenCalled();
    sheet = false;
    await wait(LOCAL_WAIT_MS);
    expect(p.reloadClean).toHaveBeenCalledTimes(1);
  });

  it("let go, a big screen reloads by itself too: it has no socket left, and a reload is the only way back", async () => {
    const p = page({ auto: () => false });
    letGo(p);
    await wait(SPREAD);
    expect(p.reloadClean).toHaveBeenCalledTimes(1);
  });

  it("let go without session storage: it cannot come back to its seat, so it says so, and reloads only on a tap", async () => {
    const p = page({ storage: blocked() });
    letGo(p);
    await wait(SPREAD);
    expect(p.reloadClean).not.toHaveBeenCalled();
    expect(p.notes).toEqual([REJOIN_NOTICE]);
    p.taps[0]();
    expect(p.reloadClean).toHaveBeenCalledTimes(1);
  });

  it("never loops between being let go and the room's word, when each reload still comes up old (review probe)", async () => {
    // Each "load" is a fresh page over the same session storage: the room's hello says a newer
    // build at a safe point, then lets the page go for its protocol. Before, the two paths kept
    // two keys in one place and took turns reloading: 6 reloads in 6 loads.
    const storage = memory();
    let reloads = 0;
    for (let load = 0; load < 6; load++) {
      const handlers = new Map();
      let dead = false;
      const count = () => {
        if (!dead) reloads++;
      };
      watchRoomRelease(
        { on: (t, h) => handlers.set(t, h), room: { members: [{}, {}, {}, {}], screens: 0 }, roomRelease: NEW, helloProtocol: "2", askRelease: () => {} },
        { notice: () => {}, live: async () => NEW, random: () => 0.5, storage, reload: count, reloadClean: count, visibility: null, auto: () => true },
      );
      handlers.get("release")({ id: NEW, safe: true, protocol: "3" });
      handlers.get("closed")("update_required");
      await wait(SPREAD);
      dead = true;
      vi.clearAllTimers();
    }
    expect(reloads).toBe(1);
  });
});
