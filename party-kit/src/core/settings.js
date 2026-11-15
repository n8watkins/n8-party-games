// A game's settings and what a rematch carries: the plain logic any room can use.
//
// Settings. A game may declare `game.settings(value)`, which checks a settings object and returns
// it clean (with its defaults filled in), or refuses it with `{ok: false, error, message}`. Its
// manifest describes the choices for the page (`manifest.settings`): a list of fields, each with
// its options and its default. A room that hosts such a game lets one person (the party's host)
// pick them before the game starts, and passes the clean object to `game.create` as `settings`.
//
// Carry. A game may declare `game.carry(state)`, which returns a small plain-JSON object when a
// game ends. The room keeps it for that game and those seats, and passes it to the next `create`
// of the same game with the same seats as `carry` (a rematch: avoid the last match's draw, let the
// loser start). Different seats, and it is dropped.
//
// No network, no clock, no storage.

import { ERROR_MAX, MESSAGE_MAX } from "./answers.js";
import { plainJson } from "./turns.js";

/** The longest a field's key may be, and its label or an option's label. */
export const KEY_MAX = 32;
export const LABEL_MAX = 40;
/** At most this many fields, and this many options in one field. */
export const FIELDS_MAX = 16;
export const OPTIONS_MAX = 24;
/** The most a clean settings object and a carry may weigh, as JSON. Both are saved with the room. */
export const SETTINGS_MAX_BYTES = 2048;
export const CARRY_MAX_BYTES = 4096;

/** Whether a game has settings to choose before it starts. */
export function hasSettings(game) {
  return typeof game?.settings === "function";
}

/** Whether a game leaves something for a rematch. */
export function hasCarry(game) {
  return typeof game?.carry === "function";
}

const isChoice = (v) => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));

/**
 * The fields a manifest describes (`manifest.settings`), checked and in one shape:
 * `{fields: [{key, label, options: [{value, label}], default}], problems: [sentences]}`.
 * An option may be written as its bare value (its label is then the value as text), a field
 * without a label is labelled by its key, and a field without a default defaults to its first
 * option. A field with a problem is left out, and the problem said.
 */
export function settingFields(described) {
  const out = { fields: [], problems: [] };
  if (described === undefined || described === null) return out;
  if (!Array.isArray(described)) {
    out.problems.push("manifest.settings is a list of fields.");
    return out;
  }
  if (described.length > FIELDS_MAX) out.problems.push(`manifest.settings has at most ${FIELDS_MAX} fields.`);
  const keys = new Set();
  for (const [i, field] of described.slice(0, FIELDS_MAX).entries()) {
    const at = `manifest.settings[${i}]`;
    if (!field || typeof field !== "object") {
      out.problems.push(`${at} is an object.`);
      continue;
    }
    const key = field.key;
    if (typeof key !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || key.length > KEY_MAX) {
      out.problems.push(`${at}.key is a name of letters, digits and _, of up to ${KEY_MAX} characters.`);
      continue;
    }
    if (keys.has(key)) {
      out.problems.push(`${at}.key "${key}" is used twice.`);
      continue;
    }
    if (!Array.isArray(field.options) || !field.options.length || field.options.length > OPTIONS_MAX) {
      out.problems.push(`${at}.options is a list of 1 to ${OPTIONS_MAX} choices.`);
      continue;
    }
    const options = field.options.map((o) => (o && typeof o === "object" ? { value: o.value, label: o.label } : { value: o, label: undefined }));
    if (!options.every((o) => isChoice(o.value))) {
      out.problems.push(`${at}.options are strings, numbers or true and false.`);
      continue;
    }
    if (new Set(options.map((o) => JSON.stringify(o.value))).size !== options.length) {
      out.problems.push(`${at}.options has the same value twice.`);
      continue;
    }
    const value = field.default === undefined ? options[0].value : field.default;
    if (!options.some((o) => o.value === value)) {
      out.problems.push(`${at}.default is one of its options.`);
      continue;
    }
    keys.add(key);
    out.fields.push({
      key,
      label: labelOf(field.label, key),
      options: options.map((o) => ({ value: o.value, label: labelOf(o.label, String(o.value)) })),
      default: value,
    });
  }
  return out;
}

function labelOf(label, fallback) {
  return (typeof label === "string" && label.trim() ? label.trim() : fallback).slice(0, LABEL_MAX);
}

/** The defaults the fields describe, as one object. */
export function fieldDefaults(fields) {
  return Object.fromEntries(fields.map((f) => [f.key, f.default]));
}

/**
 * What is wrong with a game's settings and carry, as sentences: `settings` and `carry`, when
 * given, are functions; a game with settings describes them (`manifest.settings`, passed as
 * `described`), and the description is sound.
 */
export function settingsProblems(game, described) {
  const problems = [];
  if (game?.settings !== undefined && !hasSettings(game)) problems.push("settings, when given, is a function.");
  if (game?.carry !== undefined && !hasCarry(game)) problems.push("carry, when given, is a function.");
  if (!hasSettings(game)) return problems;
  const { fields, problems: wrong } = settingFields(described);
  problems.push(...wrong);
  if (!fields.length && !wrong.length) problems.push("A game with settings describes them in manifest.settings: a list of fields with their options.");
  return problems;
}

/**
 * Asks the game to check a settings object. Returns `{ok: true, settings}` with the game's clean
 * object, or `{ok: false, error, message}`: the game's own refusal (`{ok: false, error,
 * message}`, cut to the usual lengths), or `bad_settings` when it threw or gave back something that
 * is not a plain-JSON object of at most SETTINGS_MAX_BYTES. `thrown` carries what it threw, for
 * the room's log.
 */
export function checkSettings(game, value) {
  let returned;
  try {
    returned = game.settings(structuredClone(value));
  } catch (err) {
    return { ...refusal("bad_settings", "Those settings cannot be used."), thrown: err };
  }
  if (returned && typeof returned === "object" && returned.ok === false) {
    return refusal(
      typeof returned.error === "string" && returned.error ? returned.error.slice(0, ERROR_MAX) : "bad_settings",
      typeof returned.message === "string" && returned.message ? returned.message.slice(0, MESSAGE_MAX) : "Those settings cannot be used.",
    );
  }
  try {
    const clean = smallObject(returned, "settings()", SETTINGS_MAX_BYTES);
    return { ok: true, settings: clean };
  } catch (err) {
    return { ...refusal("bad_settings", "Those settings cannot be used."), thrown: err };
  }
}

/**
 * One change the host asks for (`{key: value, ...}`), checked against the fields first: every
 * key is a field and every value one of its options. Returns the picks with the change made, or
 * a refusal. The game's own check (checkSettings) comes after.
 */
export function applyChange(fields, picks, change) {
  if (!change || typeof change !== "object" || Array.isArray(change) || !Object.keys(change).length) return refusal("bad_setting", "That is not a change of settings.");
  const next = { ...picks };
  for (const [key, value] of Object.entries(change)) {
    const field = fields.find((f) => f.key === key);
    if (!field) return refusal("bad_setting", "That is not one of this game's settings.");
    if (!field.options.some((o) => o.value === value)) return refusal("bad_setting", `That is not a choice for ${field.label}.`);
    next[key] = value;
  }
  return { ok: true, picks: next };
}

/**
 * What a game that ended leaves for a rematch: `game.carry(state)` as plain JSON, or null when
 * the game has no carry or gave back nothing. Throws when carry threw, or gave back something
 * that is not a plain-JSON object of at most CARRY_MAX_BYTES (the room logs it and keeps nothing).
 */
export function carryOf(game, state) {
  if (!hasCarry(game)) return null;
  const returned = game.carry(state);
  if (returned === undefined || returned === null) return null;
  return smallObject(returned, "carry()", CARRY_MAX_BYTES);
}

/**
 * Who a carry is for: the game's seats, each with whoever sits in it (`[{seat, who}]`, `who` a
 * room's own name for the person, never shown). Two lists are the same set when every seat has
 * the same person, in any order.
 */
export function seatsKey(seats) {
  return [...seats]
    .map((s) => `${s.seat}:${s.who}`)
    .sort()
    .join("|");
}

/**
 * The carry kept for a game (`kept`, as `{[gameId]: {seats, carry}}`) that fits these seats, or
 * null. One that does not fit is dropped from `kept`: a rematch is the same people, or nothing.
 */
export function carryFor(kept, id, seats) {
  const entry = kept[id];
  if (!entry) return null;
  if (entry.seats === seatsKey(seats)) return entry.carry;
  delete kept[id];
  return null;
}

function smallObject(value, what, max) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${what} gives back a plain object.`);
  const clean = plainJson(value, what);
  const bytes = new TextEncoder().encode(JSON.stringify(clean)).length;
  if (bytes > max) throw new RangeError(`${what} gave back ${bytes} bytes; at most ${max} are kept.`);
  return clean;
}

function refusal(error, message) {
  return { ok: false, error, message };
}
