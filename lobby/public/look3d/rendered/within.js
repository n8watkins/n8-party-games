// How long a rendered room waits for its layers before the room is drawn the 3D look's way instead.
// While a room view loads, the room is dimmed (main.js, showRoom): a layer stuck on a slow
// connection must not hold everyone's room dark. Plain logic, so it is tested without a browser.

/** The most a rendered room waits for its layers, in ms. Its ~0.9 MB arrives in about a second on 4G. */
export const LAYERS_MS = 5500;

/**
 * Resolves with what `loading` gives if it comes within `ms`; otherwise rejects at once (the
 * caller falls back), and when `loading` does arrive later, what it gave is handed to `late`, so
 * the caller can give it back (never uploaded, never kept). `onTimeout` is called when the time runs
 * out (to abort what can be aborted, such as a fetch).
 */
export function within(loading, ms, { late = () => {}, onTimeout = () => {} } = {}) {
  return new Promise((done, fail) => {
    let over = false;
    const timer = setTimeout(() => {
      over = true;
      onTimeout();
      fail(new Error(`the rendered room's layers took longer than ${ms / 1000} s`));
    }, ms);
    loading.then(
      (value) => {
        clearTimeout(timer);
        if (over) late(value);
        else done(value);
      },
      (err) => {
        clearTimeout(timer);
        if (!over) fail(err);
      },
    );
  });
}
