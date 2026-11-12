// The short-lived PIN directory: one Durable Object maps 4-digit PINs to rooms.
// Lifted from Who Am I (src/worker/pin-directory.ts). A PIN is only an alias for typing on a
// phone; the room code stays the real address. All state changes run synchronously against
// SQLite, so two rooms can never share a PIN.
import { DurableObject } from "cloudflare:workers";

import { MAX_LIVE_PINS, PIN_COOLDOWN_MS, PIN_TTL_MS, pickFreePin } from "./pin-logic.js";

export * from "./pin-logic.js";

export class PinDirectory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // A row is live until expires_at and stays reserved until free_at.
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS pins (
        pin TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        free_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pins_code ON pins (code);
    `);
  }

  /** Gives the room a new PIN, replacing any it had. Returns null when the directory is at capacity. */
  async issue(code, now = Date.now()) {
    this.purge(now);
    this.expire(code, now);
    const sql = this.ctx.storage.sql;
    const live = sql.exec("SELECT COUNT(*) AS n FROM pins WHERE expires_at > ?", now).one().n;
    if (live >= MAX_LIVE_PINS) return null;
    const occupied = new Set(sql.exec("SELECT pin FROM pins").toArray().map((row) => row.pin));
    const value = pickFreePin(occupied);
    if (!value) return null;
    const expiresAt = now + PIN_TTL_MS;
    sql.exec("INSERT INTO pins (pin, code, expires_at, free_at) VALUES (?, ?, ?, ?)", value, code, expiresAt, expiresAt + PIN_COOLDOWN_MS);
    await this.scheduleCleanup();
    return { value, expiresAt };
  }

  /** Extends the room's live PIN. Returns the new expiry, or null if it has no live PIN. */
  async refresh(code, now = Date.now()) {
    const expiresAt = now + PIN_TTL_MS;
    const updated = this.ctx.storage.sql.exec(
      "UPDATE pins SET expires_at = ?, free_at = ? WHERE code = ? AND expires_at > ?",
      expiresAt,
      expiresAt + PIN_COOLDOWN_MS,
      code,
      now,
    );
    return updated.rowsWritten > 0 ? expiresAt : null;
  }

  /** Ends the room's PIN now; it stays reserved for the cooldown. */
  async release(code, now = Date.now()) {
    this.expire(code, now);
    await this.scheduleCleanup();
  }

  /** The room code behind a live PIN, or null. */
  async resolve(pin, now = Date.now()) {
    const rows = this.ctx.storage.sql.exec("SELECT code FROM pins WHERE pin = ? AND expires_at > ?", pin, now).toArray();
    return rows[0] ? rows[0].code : null;
  }

  async alarm() {
    this.purge(Date.now());
    await this.scheduleCleanup();
  }

  expire(code, now) {
    this.ctx.storage.sql.exec("UPDATE pins SET expires_at = ?, free_at = ? WHERE code = ? AND expires_at > ?", now, now + PIN_COOLDOWN_MS, code, now);
  }

  purge(now) {
    this.ctx.storage.sql.exec("DELETE FROM pins WHERE free_at <= ?", now);
  }

  async scheduleCleanup() {
    const next = this.ctx.storage.sql.exec("SELECT MIN(free_at) AS at FROM pins").one().at;
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }
}
