// The bot check before making a room (Cloudflare Turnstile). It does nothing unless the server
// hands out a site key (GET /api/party/config), so local play and tests never see it. Joining a
// friend's room by PIN never asks for it.
//
//   const token = await botCheck(container, siteKey);   // null when there is no site key
//
// The widget is "managed" and only shows itself when Turnstile wants the visitor to click.
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TIMEOUT_MS = 60_000;
let loading = null;

function loadTurnstile() {
  if (globalThis.turnstile) return Promise.resolve(globalThis.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (globalThis.turnstile ? resolve(globalThis.turnstile) : reject(new Error("The bot check did not load.")));
    s.onerror = () => {
      loading = null;
      reject(new Error("The bot check could not load. Check the connection and try again."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Resolves with a fresh, single-use token, or null when no site key is configured. */
export async function botCheck(container, siteKey) {
  if (!siteKey) return null;
  const turnstile = await loadTurnstile();
  container.hidden = false;
  container.replaceChildren();
  return new Promise((resolve, reject) => {
    let id = null;
    const done = (fn, value) => {
      clearTimeout(timer);
      if (id !== null) turnstile.remove(id);
      container.hidden = true;
      fn(value);
    };
    const timer = setTimeout(() => done(reject, new Error("The bot check took too long. Try again.")), TIMEOUT_MS);
    id = turnstile.render(container, {
      sitekey: siteKey,
      action: "create-room",
      appearance: "interaction-only",
      callback: (token) => done(resolve, token),
      "error-callback": () => done(reject, new Error("The bot check did not pass. Try again.")),
      "expired-callback": () => done(reject, new Error("The bot check expired. Try again.")),
    });
  });
}
