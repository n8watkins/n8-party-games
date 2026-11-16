// Reads the page's own copied report (v1, v2 or v3) back into turns, so a real run can be
// replayed through the matcher. Used by logic.test.js and tools/replay-report.mjs.
import { CATEGORIES } from "../public/categories.js";

/**
 * Each turn: {n, category (v3 names it after the rules version; earlier reports are all
 * cities), hard, need, verdict ("RIGHT", "WRONG", "NONE"), verdictText, decidedBy, interim (the
 * interim phrase that was answered, when the verdict was taken from one), alternatives
 * [{transcript, confidence}] of the final result}.
 */
export function parseReport(text) {
  const turns = [];
  for (const line of text.split("\n")) {
    if (!/^#\d+ /.test(line)) continue;
    const parts = line.split(" | ");
    const head = parts[0];
    const verdictText = parts[2] ?? "";
    const heard = parts[3] ?? "-";
    const n = Number(head.match(/^#(\d+)/)[1]);
    const words = head.split(" ");
    const category = words.find((w) => Object.hasOwn(CATEGORIES, w)) ?? "cities";
    const hard = words.includes("hard");
    const need = head.match(/need:(\S+)/)?.[1] ?? "-";
    const decidedBy = verdictText.match(/by (interim|final)\)/)?.[1] ?? "";
    const interim = decidedBy === "interim" ? (verdictText.match(/heard "([^"]*)"/)?.[1] ?? "") : "";
    const alternatives =
      heard === "-" || heard.startsWith("interim:")
        ? []
        : heard.split(" / ").map((s) => {
            const at = s.lastIndexOf("=");
            return { transcript: s.slice(0, at), confidence: Number(s.slice(at + 1)) };
          });
    turns.push({ n, category, hard, need: need === "-" ? "" : need, verdict: verdictText.split(" ")[0], verdictText, decidedBy, interim, alternatives });
  }
  return turns;
}
