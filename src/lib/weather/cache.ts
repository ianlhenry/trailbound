import { getDb } from "../db";

interface CacheRow {
  cache_key: string;
  payload: string;
  expires_at: string;
}

export function ensureWeatherCache(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS weather_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
}

export function getWeatherCache<T>(key: string): T | null {
  ensureWeatherCache();
  const row = getDb()
    .prepare(
      `SELECT cache_key, payload, expires_at FROM weather_cache WHERE cache_key = ?`
    )
    .get(key) as CacheRow | undefined;
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    getDb().prepare(`DELETE FROM weather_cache WHERE cache_key = ?`).run(key);
    return null;
  }
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
}

export function setWeatherCache(
  key: string,
  payload: unknown,
  ttlHours = 3
): void {
  ensureWeatherCache();
  const expires = new Date();
  expires.setUTCHours(expires.getUTCHours() + ttlHours);
  getDb()
    .prepare(
      `INSERT INTO weather_cache (cache_key, payload, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         payload = excluded.payload,
         expires_at = excluded.expires_at`
    )
    .run(key, JSON.stringify(payload), expires.toISOString());
}
