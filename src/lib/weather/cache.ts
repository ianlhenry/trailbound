import { getDb } from "../db";

interface CacheRow {
  cache_key: string;
  payload: string;
  expires_at: string;
}

export async function getWeatherCache<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const row = await db
    .prepare(
      `SELECT cache_key, payload, expires_at FROM weather_cache WHERE cache_key = ?`
    )
    .bind(key)
    .first<CacheRow>();
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    await db
      .prepare(`DELETE FROM weather_cache WHERE cache_key = ?`)
      .bind(key)
      .run();
    return null;
  }
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
}

export async function setWeatherCache(
  key: string,
  payload: unknown,
  ttlHours = 3
): Promise<void> {
  const db = await getDb();
  const expires = new Date();
  expires.setUTCHours(expires.getUTCHours() + ttlHours);
  await db
    .prepare(
      `INSERT INTO weather_cache (cache_key, payload, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         payload = excluded.payload,
         expires_at = excluded.expires_at`
    )
    .bind(key, JSON.stringify(payload), expires.toISOString())
    .run();
}
