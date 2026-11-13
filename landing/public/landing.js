// The landing page reads and works without this file. All it adds: the code box keeps only
// digits, so a pasted "48 27" or "code: 4827" still joins.
// The start and join routes are not here: they are in index.html, in the block marked "THE WAY IN".
const code = document.getElementById("join-code");
if (code) {
  code.addEventListener("input", () => {
    const digits = code.value.replace(/\D+/g, "").slice(0, 4);
    if (digits !== code.value) code.value = digits;
  });
}
