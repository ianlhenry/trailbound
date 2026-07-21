import { fetchJson } from "../http";
import { getWeatherCache, setWeatherCache } from "./cache";

export interface NwsDaily {
  date: string;
  pop: number | null; // 0-100
  precipIn: number | null;
  windMph: number | null;
  tempF: number | null;
  shortForecast: string | null;
}

interface PointsResponse {
  properties: {
    forecast: string;
    forecastHourly: string;
    forecastGridData: string;
  };
}

interface ForecastPeriod {
  startTime: string;
  endTime: string;
  temperature: number;
  probabilityOfPrecipitation?: { value: number | null };
  windSpeed?: string;
  shortForecast?: string;
  isDaytime?: boolean;
}

interface ForecastResponse {
  properties: { periods: ForecastPeriod[] };
}

interface GridValue {
  validTime: string;
  value: number | null;
}

interface GridDataResponse {
  properties: {
    probabilityOfPrecipitation?: { values: GridValue[] };
    quantitativePrecipitation?: { values: GridValue[] };
    windSpeed?: { values: GridValue[] };
  };
}

function parseWindMph(windSpeed?: string): number | null {
  if (!windSpeed) return null;
  const nums = [...windSpeed.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
  if (!nums.length) return null;
  return Math.max(...nums);
}

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

function expandGridValues(
  values: GridValue[] | undefined,
  dates: Set<string>
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  if (!values) return map;
  for (const entry of values) {
    // validTime like 2026-07-21T18:00:00+00:00/PT6H
    const [start, duration] = entry.validTime.split("/");
    if (!start || entry.value == null) continue;
    const startDate = new Date(start);
    let hours = 1;
    const durMatch = duration?.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (durMatch) {
      hours = Number(durMatch[1] ?? 0) + Number(durMatch[2] ?? 0) / 60 || 1;
    }
    const end = new Date(startDate.getTime() + hours * 3600_000);
    for (let t = startDate.getTime(); t < end.getTime(); t += 3600_000) {
      const key = new Date(t).toISOString().slice(0, 10);
      if (!dates.has(key) && dates.size > 0) {
        // still record; caller filters
      }
      const arr = map.get(key) ?? [];
      arr.push(entry.value);
      map.set(key, arr);
    }
  }
  return map;
}

export async function fetchNwsDailyForecast(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<NwsDaily[]> {
  const cacheKey = `nws:${lat.toFixed(3)},${lon.toFixed(3)}:${startDate}:${endDate}`;
  const cached = await getWeatherCache<NwsDaily[]>(cacheKey);
  if (cached) return cached;

  const points = await fetchJson<PointsResponse>(
    `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`
  );

  const [forecast, grid] = await Promise.all([
    fetchJson<ForecastResponse>(points.properties.forecast),
    fetchJson<GridDataResponse>(points.properties.forecastGridData).catch(
      () => null
    ),
  ]);

  const dates = new Set<string>();
  for (
    let d = new Date(startDate + "T12:00:00Z");
    d <= new Date(endDate + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    dates.add(d.toISOString().slice(0, 10));
  }

  const byDate = new Map<string, NwsDaily>();
  for (const date of dates) {
    byDate.set(date, {
      date,
      pop: null,
      precipIn: null,
      windMph: null,
      tempF: null,
      shortForecast: null,
    });
  }

  for (const period of forecast.properties.periods ?? []) {
    const key = dateKey(period.startTime);
    const day = byDate.get(key);
    if (!day) continue;
    const pop = period.probabilityOfPrecipitation?.value ?? null;
    if (pop != null) day.pop = Math.max(day.pop ?? 0, pop);
    const wind = parseWindMph(period.windSpeed);
    if (wind != null) day.windMph = Math.max(day.windMph ?? 0, wind);
    if (period.isDaytime !== false) {
      day.tempF = period.temperature;
      day.shortForecast = period.shortForecast ?? day.shortForecast;
    }
  }

  if (grid) {
    const pops = expandGridValues(
      grid.properties.probabilityOfPrecipitation?.values,
      dates
    );
    const qpf = expandGridValues(
      grid.properties.quantitativePrecipitation?.values,
      dates
    );
    const winds = expandGridValues(grid.properties.windSpeed?.values, dates);

    for (const date of dates) {
      const day = byDate.get(date)!;
      const popVals = pops.get(date);
      if (popVals?.length) day.pop = Math.max(...popVals);
      const qpfVals = qpf.get(date);
      if (qpfVals?.length) {
        // grid QPF often mm over intervals; sum approx and convert mm->in
        const mm = qpfVals.reduce((a, b) => a + b, 0);
        day.precipIn = mm / 25.4;
      }
      const windVals = winds.get(date);
      if (windVals?.length) {
        // m/s -> mph
        day.windMph = Math.max(...windVals) * 2.23694;
      }
    }
  }

  const result = [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  await setWeatherCache(cacheKey, result);
  return result;
}
