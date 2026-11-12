// Shared by both mockups. Mockup behaviour only: nothing here talks to a server.

// The site name is undecided. Change it here and every page follows.
const SITE = {
  name: "n8 Party",
  address: "games.n8builds.dev",
};

for (const el of document.querySelectorAll("[data-site-name]")) el.textContent = SITE.name;
for (const el of document.querySelectorAll("[data-site-address]")) el.textContent = SITE.address;
document.title = document.title.replace("{name}", SITE.name);

const params = new URLSearchParams(location.search);
const body = document.body;

// Page states: "normal", "full" (hosted rooms are used up for today), "screen" (the big-screen room step).
function setState(state) {
  body.dataset.state = state;
  for (const b of document.querySelectorAll("[data-set-state]")) {
    b.setAttribute("aria-pressed", String(b.dataset.setState === state));
  }
  for (const b of document.querySelectorAll("[data-room]")) b.disabled = state === "full";
}
for (const b of document.querySelectorAll("[data-set-state]")) {
  b.addEventListener("click", () => setState(b.dataset.setState));
}
for (const b of document.querySelectorAll("[data-room]")) {
  b.addEventListener("click", () => setState("screen"));
}
for (const b of document.querySelectorAll("[data-close-sheet]")) {
  b.addEventListener("click", () => setState("normal"));
}
setState(params.get("state") ?? "normal");

// ?strip=0 hides the preview strip (used for the screenshots).
if (params.get("strip") === "0") body.dataset.strip = "off";

// The filter: one answer at a time; pressing the chosen answer again shows everything.
const filters = [...document.querySelectorAll("[data-filter]")];
function setFilter(value) {
  body.dataset.filter = value;
  for (const b of filters) b.setAttribute("aria-pressed", String(b.dataset.filter === value));
  for (const card of document.querySelectorAll("[data-fits]")) {
    card.hidden = value !== "all" && !card.dataset.fits.split(" ").includes(value);
  }
}
for (const b of filters) {
  b.addEventListener("click", () => setFilter(body.dataset.filter === b.dataset.filter ? "all" : b.dataset.filter));
}
setFilter(params.get("have") ?? "all");

// PIN boxes: one digit each, moving on as you type. ?join=6894 fills them, as a scanned QR code would.
const digits = [...document.querySelectorAll(".pin input")];
digits.forEach((input, i) => {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(-1);
    if (input.value && digits[i + 1]) digits[i + 1].focus();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !input.value && digits[i - 1]) digits[i - 1].focus();
  });
});
const join = (params.get("join") ?? "").replace(/\D/g, "");
digits.forEach((input, i) => { input.value = join[i] ?? ""; });
