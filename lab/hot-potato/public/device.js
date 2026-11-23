// What kind of device and microphone the page is on, read from the browser's own descriptions.
// Pure functions (no DOM), so the unit tests can check them against real user agents.

/**
 * Desktop, phone or tablet, the system and the browser, from the user agent string, the
 * user-agent hints (navigator.userAgentData, Chromium only) and navigator.maxTouchPoints (an iPad
 * says it is a Mac, but has touch).
 */
export function deviceInfo(agent = "", hints = null, touchPoints = 0) {
  const iPad = /iPad/.test(agent) || (/Macintosh/.test(agent) && touchPoints > 1);
  const iPhone = /iPhone|iPod/.test(agent);
  const android = /Android/.test(agent);
  const kind = iPad ? "tablet" : iPhone ? "phone" : android ? (/Mobile/.test(agent) ? "phone" : "tablet") : hints?.mobile ? "phone" : "desktop";
  const os = iPad
    ? "iPadOS"
    : iPhone
      ? "iOS"
      : android
        ? "Android"
        : /CrOS/.test(agent)
          ? "ChromeOS"
          : /Windows/.test(agent)
            ? "Windows"
            : /Macintosh|Mac OS X/.test(agent)
              ? "macOS"
              : /Linux/.test(agent)
                ? "Linux"
                : "unknown system";
  const pick = [
    ["Edge", /Edg(?:e|A|iOS)?\/(\d+)/],
    ["Opera", /OPR\/(\d+)/],
    ["Samsung Internet", /SamsungBrowser\/(\d+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/],
    ["Chrome", /(?:Chrome|CriOS)\/(\d+)/],
    ["Safari", /Version\/(\d+).*Safari/],
  ].find(([, re]) => re.test(agent));
  const browser = pick ? `${pick[0]} ${agent.match(pick[1])[1]}` : "unknown browser";
  return { kind, os, browser, ios: iPad || iPhone, label: `${kind} (${os}, ${browser})` };
}

/** A generic kind for a microphone's label, so the report never carries a device's own name. */
export function micKind(label) {
  const l = String(label || "").toLowerCase();
  if (!l) return "unnamed";
  if (/headset|headphone|earbud|earphone|airpods|buds|hands-free|handsfree|bluetooth/.test(l)) return "headset";
  if (/webcam|camera|\bcam\b|c9\d\d|brio/.test(l)) return "webcam";
  if (/built-in|builtin|internal|array|realtek|intel|macbook|laptop/.test(l)) return "built-in";
  if (/usb|yeti|snowball|rode|shure|fifine|hyperx/.test(l)) return "usb";
  return "other";
}
