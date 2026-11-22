// What a page does about a new build (site/release-switch.js): it reloads only when it is the
// older side (the room's build is the live one) and the room is at a safe point, at most once per
// build; it shows the notice while the room is busy, and waits whenever the room is the older one
// or nobody can tell yet. Outside a room it reloads only where its caller says nothing is lost.
import { describe, expect, it, vi } from "vitest";
import { NOTICE, PAGE_RELEASE, decide, liveRelease, reloadFor, reloadIfNewer, reloadedFor, watchRoomRelease } from "../release-switch.js";

const MINE = PAGE_RELEASE;
const NEW = "cccccccccccc";

function memory() {
  const kept = new Map();
  return { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => void kept.set(k, v) };
}

describe("decide", () => {
  it.each([
    ["the room is this page's build", { room: MINE, live: NEW, safe: true }, "same"],
    ["the room says no build", { room: null, live: NEW, safe: true }, "same"],
    ["the page is older and the room is at a safe point", { room: NEW, live: NEW, safe: true }, "reload"],
    ["the page is older and the room is busy", { room: NEW, live: NEW, safe: false }, "notice"],
    ["the room is older (a busy room on its old code after a deploy)", { room: "bbbbbbbbbbbb", live: MINE, safe: true }, "wait"],
    ["nobody can tell which is live", { room: NEW, live: null, safe: true }, "wait"],
    ["a deploy on its way: the live build is neither", { room: NEW, live: "dddddddddddd", safe: true }, "wait"],
    ["the page already reloaded for this build and is still older", { room: NEW, live: NEW, safe: true, reloadedFor: NEW }, "done"],
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
    const broken = { getItem: () => null, setItem: () => { throw new Error("blocked"); } };
    expect(reloadFor(NEW, { storage: broken, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("the live build", () => {
  it("comes from /api/version, never cached, and is null when it cannot be read", async () => {
    const seen = [];
    const ok = async (url, init) => (seen.push([url, init.cache]), { ok: true, json: async () => ({ release: NEW }) });
    expect(await liveRelease({ fetchImpl: ok })).toBe(NEW);
    expect(seen).toEqual([["/api/version", "no-store"]]);
    expect(await liveRelease({ fetchImpl: async () => ({ ok: false }) })).toBeNull();
    expect(await liveRelease({ fetchImpl: async () => { throw new Error("offline"); } })).toBeNull();
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
  /** A stand-in for the PartyClient: its events, and whether it was asked for the room's build. */
  function fakeLink() {
    const handlers = new Map();
    return {
      on: (t, h) => handlers.set(t, h),
      fire: (t, ...a) => handlers.get(t)?.(...a),
      roomRelease: null,
      askRelease: vi.fn(),
    };
  }

  it("shows the notice while the room is busy, then reloads at its safe point, once", async () => {
    vi.stubGlobal("sessionStorage", memory());
    vi.stubGlobal("document", { addEventListener: () => {} });
    const reload = vi.fn();
    vi.stubGlobal("location", { reload, assign: vi.fn() });
    try {
      const link = fakeLink();
      const notes = [];
      watchRoomRelease(link, { notice: (t) => notes.push(t), live: async () => NEW });
      link.fire("release", { id: NEW, safe: false });
      await vi.waitFor(() => expect(notes).toEqual([NOTICE]));
      expect(reload).not.toHaveBeenCalled();
      link.fire("release", { id: NEW, safe: true });
      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      link.fire("release", { id: NEW, safe: true });
      await new Promise((r) => setTimeout(r, 0));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does nothing when the room is the older side, and takes a notice away when the builds agree", async () => {
    vi.stubGlobal("sessionStorage", memory());
    vi.stubGlobal("document", { addEventListener: () => {} });
    const reload = vi.fn();
    vi.stubGlobal("location", { reload, assign: vi.fn() });
    try {
      const link = fakeLink();
      const notes = [];
      let live = NEW;
      watchRoomRelease(link, { notice: (t) => notes.push(t), live: async () => live });
      link.fire("release", { id: NEW, safe: false });
      await vi.waitFor(() => expect(notes).toEqual([NOTICE]));
      live = MINE;
      link.fire("release", { id: "bbbbbbbbbbbb", safe: true });
      await vi.waitFor(() => expect(notes).toEqual([NOTICE, null]));
      link.fire("release", { id: MINE, safe: true });
      await new Promise((r) => setTimeout(r, 0));
      expect(notes).toEqual([NOTICE, null]);
      expect(reload).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("waits for its own sheet to close before it reloads", async () => {
    vi.stubGlobal("sessionStorage", memory());
    vi.stubGlobal("document", { addEventListener: () => {} });
    const reload = vi.fn();
    vi.stubGlobal("location", { reload, assign: vi.fn() });
    try {
      const link = fakeLink();
      let sheet = true;
      const notes = [];
      watchRoomRelease(link, { notice: (t) => notes.push(t), live: async () => NEW, canReload: () => !sheet });
      link.fire("release", { id: NEW, safe: true });
      await vi.waitFor(() => expect(notes).toEqual([NOTICE]));
      sheet = false;
      link.fire("release", { id: NEW, safe: true });
      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reloads into its seat when a room of a newer protocol lets it go", () => {
    vi.stubGlobal("sessionStorage", memory());
    vi.stubGlobal("document", { addEventListener: () => {} });
    const reload = vi.fn();
    vi.stubGlobal("location", { reload, assign: vi.fn() });
    try {
      const link = fakeLink();
      watchRoomRelease(link, { notice: () => {}, live: async () => NEW });
      link.fire("closed", "update_required");
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
