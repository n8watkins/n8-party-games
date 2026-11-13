// Small helpers for building the page. Everything is made with the DOM, never with markup in
// strings and never with style attributes, so the site's Content-Security-Policy stays strict.

const SVG = "http://www.w3.org/2000/svg";

/** Sets attributes; null, undefined and false remove one. */
export function set(el, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) el.removeAttribute(key);
    else el.setAttribute(key, String(value));
  }
  return el;
}

/** An SVG element: s("circle", {cx: 1, cy: 2, r: 3}, ...children). */
export function s(tag, attrs = {}, ...kids) {
  const el = set(document.createElementNS(SVG, tag), attrs);
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}

/** An SVG text element. */
export function label(text, attrs = {}) {
  const el = s("text", attrs);
  el.textContent = text;
  return el;
}

/**
 * Makes sure a line of SVG text is no wider than `max`, whatever font the device has, by
 * shrinking it. The element must be in the page. Returns the width it ended up with.
 */
export function fit(el, max) {
  let size = Number(el.getAttribute("font-size"));
  let width = el.getComputedTextLength();
  for (let i = 0; i < 6 && width > max && size > 6; i++) {
    size = Math.max(6, Math.floor(size * Math.min(0.96, max / width) * 10) / 10);
    el.setAttribute("font-size", size);
    width = el.getComputedTextLength();
  }
  return width;
}

/** An HTML element: h("div", "class names", "text", parent). */
export function h(tag, className = "", text = "", parent = null) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  if (parent) parent.append(el);
  return el;
}

/** A small icon: one or more SVG paths on a 24 x 24 grid, drawn with the current colour. */
export function icon(paths, size = 24) {
  const svg = s("svg", { viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", "stroke-width": 2.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
  for (const d of [].concat(paths)) svg.append(s("path", { d }));
  return svg;
}

/** The pictures on a player's four buttons are in controls.js. */
export const ICONS = {
  door: ["M14 4h5v16h-5", "M10 12H3", "M7 8l-4 4 4 4"],
  zoomOut: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-4-4", "M8 11h6"],
  zoomIn: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-4-4", "M8 11h6", "M11 8v6"],
  turn: ["M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M11 18h2"],
};

/** A colour mixed toward white (amount above 0) or black (below 0). `hex` is "#rrggbb". */
export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const to = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  const mix = (c) => Math.round(c + (to - c) * k);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}
