import { fetchJson } from "../http";
import { getWeatherCache, setWeatherCache } from "./cache";

export interface WindyDaily {
  date: string;
  pop: number | null;
  precipIn: number | null;
  windMph: number | null;
  tempF: number | null;
}

interface WindyResponse {
  ts?: number[];
  "past3hprecip-surface"?: number[];
  "precip-surface"?: number[];
  "wind-surface"?: number[];
  "windGust-surface"?: number[];
  "temp-surface"?: number[];
  "rh-surface"?: number[];
  [key: string]: unknown;
}

function dateKeyFromTs(ts: number): string {
  // Windy Point Forecast returns Unix ms; some models may return seconds.
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

export async function fetchWindyDailyForecast(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<WindyDaily[] | null> {
  const key = process.env.WINDY_API_KEY;
  if (!key) {
    return null;
  }

  const cacheKey = `windy:${lat.toFixed(3)},${lon.toFixed(3)}:${startDate}:${endDate}`;
  const cached = await getWeatherCache<WindyDaily[]>(cacheKey);
  if (cached) return cached;

  const body = {
    lat,
    lon,
    model: "namConus",
    parameters: ["temp", "precip", "wind", "windGust", "rh"],
    levels: ["surface"],
    key,
  };

  let data: WindyResponse;
  try {
    data = await fetchJson<WindyResponse>(
      "https://api.windy.com/api/point-forecast/v2",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
  } catch {
    // fallback model
    data = await fetchJson<WindyResponse>(
      "https://api.windy.com/api/point-forecast/v2",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, model: "gfs" }),
      }
    );
  }

  const ts = data.ts ?? [];
  if (!ts.length) return [];

  const precipKey = Object.keys(data).find((k) =>
    k.toLowerCase().includes("precip")
  );
  const windKey = Object.keys(data).find(
    (k) => k.toLowerCase().includes("wind") && !k.toLowerCase().includes("gust")
  );
  const tempKey = Object.keys(data).find((k) => k.toLowerCase().includes("temp"));

  const precipArr = (precipKey ? (data[precipKey] as number[]) : []) ?? [];
  const windArr = (windKey ? (data[windKey] as number[]) : []) ?? [];
  const tempArr = (tempKey ? (data[tempKey] as number[]) : []) ?? [];

  const byDate = new Map<
    string,
    { precipMm: number; windMs: number[]; tempsK: number[] }
  >();

  for (let i = 0; i < ts.length; i++) {
    const date = dateKeyFromTs(ts[i]);
    if (date < startDate || date > endDate) continue;
    const bucket = byDate.get(date) ?? {
      precipMm: 0,
      windMs: [],
      tempsK: [],
    };
    const p = precipArr[i];
    if (typeof p === "number") bucket.precipMm += p;
    const w = windArr[i];
    if (typeof w === "number") bucket.windMs.push(w);
    const t = tempArr[i];
    if (typeof t === "number") bucket.tempsK.push(t);
    byDate.set(date, bucket);
  }

  const result = [...byDate.entries()]
    .map(([date, bucket]) => {
      const precipIn = bucket.precipMm / 25.4;
      // rough PoP proxy from precip amount
      let pop = 0;
      if (precipIn > 0.01) pop = 40;
      if (precipIn > 0.1) pop = 60;
      if (precipIn > 0.25) pop = 80;
      if (precipIn > 0.5) pop = 95;
      const windMph = bucket.windMs.length
        ? Math.max(...bucket.windMs) * 2.23694
        : null;
      const tempF = bucket.tempsK.length
        ? ((bucket.tempsK.reduce((a, b) => a + b, 0) / bucket.tempsK.length -
            273.15) *
            9) /
            5 +
          32
        : null;
      return {
        date,
        pop,
        precipIn,
        windMph,
        tempF,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  await setWeatherCache(cacheKey, result);
  return result;
}
