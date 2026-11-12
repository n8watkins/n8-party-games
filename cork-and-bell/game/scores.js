// The high scores: everybody's, kept by the server, and this device's own best.
//
// Nobody signs in. A score that makes the board is chalked up under three letters, arcade style.
// If the board cannot be reached the game carries on with the house's scores and the device's
// best, and says so.

/** The house's own players, chalked up before anyone else has played. */
export const HOUSE = [
  { name: "MAB", score: 4120, house: true },
  { name: "TOM", score: 3375, house: true },
  { name: "FIT", score: 2640, house: true },
  { name: "DOL", score: 1890, house: true },
  { name: "WRN", score: 1200, house: true },
];

const API = "/api/party/scores/cork-and-bell";
const BEST_KEY = "cork-and-bell:own-best";
const SERVER_ROWS = 10;

export class Scores {
  constructor() {
    this.top = null; // the server's rows, or null while it has not answered (or cannot be reached)
    this.mine = null; // {name, score}: the row this device has just chalked up
    this.onChange = () => {};
  }

  get reachable() {
    return this.top !== null;
  }

  /** Asks the server for the board. Never throws: no answer leaves `top` as it was. */
  async load() {
    try {
      const res = await fetch(API, { headers: { Accept: "application/json" } });
      const body = res.ok ? await res.json() : null;
      if (body?.ok && Array.isArray(body.top)) {
        this.top = body.top;
        this.onChange();
      }
    } catch {
      // Offline, or a server without a board: the house's scores stand.
    }
    return this.top;
  }

  /** Would this score be chalked up? (The server decides in the end; this only saves asking for letters in vain.) */
  makesBoard(score) {
    if (!this.reachable || score <= 0) return false;
    return this.top.length < SERVER_ROWS || score > this.top[this.top.length - 1].score;
  }

  /**
   * Sends a score. Answers {ok: true, place} (place -1: it did not make the board after all),
   * {ok: false, error: "bad_name"} when the letters are refused, or {ok: false, error: "offline"}.
   */
  async submit(name, score) {
    try {
      const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, score }) });
      const body = await res.json().catch(() => null);
      if (body?.ok) {
        this.top = body.top;
        this.mine = body.place >= 0 ? { name: body.top[body.place].name, score } : null;
        this.onChange();
        return { ok: true, place: body.place };
      }
      return { ok: false, error: body?.error === "bad_name" ? "bad_name" : body?.error === "rate_limited" ? "rate_limited" : "offline" };
    } catch {
      return { ok: false, error: "offline" };
    }
  }

  /** This device's own best: {score, name} or null. */
  ownBest() {
    try {
      const saved = JSON.parse(localStorage.getItem(BEST_KEY) ?? "null");
      return saved && Number.isFinite(saved.score) ? saved : null;
    } catch {
      return null;
    }
  }

  /** Remembers a score if it is this device's best. Returns true when it is. */
  keepOwnBest(score, name = this.ownBest()?.name ?? "") {
    const best = this.ownBest();
    if (best && best.score >= score) return false;
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify({ score, name }));
    } catch {
      // Not saved; it still shows for this visit.
    }
    return true;
  }

  /** The letters this device used last, to offer again. */
  lastInitials() {
    return this.ownBest()?.name ?? "";
  }

  rememberInitials(name) {
    const best = this.ownBest();
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify({ score: best?.score ?? 0, name }));
    } catch {
      // Nothing to do.
    }
  }

  /**
   * What the chalk board shows: five rows, best first, each {rank, name, score, mine}.
   * Everybody's scores with the house's among them; with no server, the house's and this
   * device's best. If this device's row is further down than fifth, it takes the last line.
   */
  rows() {
    let all;
    if (this.reachable) all = [...this.top, ...HOUSE];
    else {
      const best = this.ownBest();
      all = best?.score ? [{ name: best.name || "YOU", score: best.score, own: true }, ...HOUSE] : [...HOUSE];
    }
    all = all.map((r, i) => ({ ...r, order: i })).sort((a, b) => b.score - a.score || a.order - b.order);
    const mine = this.mine ? all.findIndex((r) => !r.house && r.name === this.mine.name && r.score === this.mine.score) : all.findIndex((r) => r.own);
    const ranked = all.map((r, i) => ({ rank: i + 1, name: r.name, score: r.score, mine: i === mine }));
    const shown = ranked.slice(0, 5);
    if (mine >= 5) shown[4] = ranked[mine];
    return shown;
  }
}
