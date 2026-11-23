// A game's view at the Table is kept out of sight until its own stylesheet has loaded
// (party/public/styled.js), so nobody sees its buttons unstyled after a reload on a slow
// connection; and it is never kept out of sight for good: a sheet that fails, or one that stalls
// past STYLE_WAIT_MS, shows the view anyway, and a box a game left early starts seen.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STYLE_WAIT_MS, hideUntilStyled } from "../../party/public/styled.js";

/** A stylesheet link: loaded already (`sheet`) or not, firing `load` or `error` when told. */
function sheetLink(loaded = false) {
  const handlers = new Map();
  return {
    sheet: loaded ? {} : null,
    addEventListener: (type, fn) => handlers.set(type, fn),
    fire: (type) => handlers.get(type)?.(),
  };
}
function box(...links) {
  return { style: { visibility: "" }, querySelectorAll: () => links };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a Table game's view and its stylesheet", () => {
  it("is hidden until its sheet loads, then shown", () => {
    const sheet = sheetLink();
    const b = box(sheet);
    hideUntilStyled(b);
    expect(b.style.visibility).toBe("hidden");
    sheet.fire("load");
    expect(b.style.visibility).toBe("");
  });

  it("waits for every sheet, and a failed one counts as done", () => {
    const one = sheetLink();
    const two = sheetLink();
    const b = box(one, two);
    hideUntilStyled(b);
    one.fire("load");
    expect(b.style.visibility).toBe("hidden");
    two.fire("error");
    expect(b.style.visibility).toBe("");
  });

  it("shows anyway when a sheet has neither loaded nor failed after STYLE_WAIT_MS", () => {
    const b = box(sheetLink());
    hideUntilStyled(b);
    vi.advanceTimersByTime(STYLE_WAIT_MS - 1);
    expect(b.style.visibility).toBe("hidden");
    vi.advanceTimersByTime(1);
    expect(b.style.visibility).toBe("");
    expect(STYLE_WAIT_MS).toBeLessThanOrEqual(5000);
  });

  it("is not hidden at all when its sheets are already there", () => {
    const b = box(sheetLink(true));
    hideUntilStyled(b);
    expect(b.style.visibility).toBe("");
  });

  it("a box an earlier view left hidden (it went before its sheet loaded) starts seen for the next", () => {
    const b = box(sheetLink());
    const show = hideUntilStyled(b);
    expect(b.style.visibility).toBe("hidden");
    // The stage shows it as the view goes.
    show();
    expect(b.style.visibility).toBe("");
    // And a next view whose sheet is cached is never hidden by the last one's leftovers.
    b.style.visibility = "hidden";
    b.querySelectorAll = () => [sheetLink(true)];
    hideUntilStyled(b);
    expect(b.style.visibility).toBe("");
  });
});
