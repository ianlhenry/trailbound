import type {
  DailyWeatherRisk,
  WeatherTolerance,
  WeatherWindow,
} from "../types";
import { fetchNwsDailyForecast, type NwsDaily } from "./nws";
import { fetchWindyDailyForecast, type WindyDaily } from "./windy";

/** Higher = worse weather for backpacking */
function dayRisk(
  pop: number | null,
  precipIn: number | null,
  windMph: number | null
): number {
  const p = pop ?? 0;
  const q = precipIn ?? 0;
  const w = windMph ?? 0;
  return Math.min(
    100,
    p * 0.55 + Math.min(q, 1.5) * 40 + Math.max(0, w - 15) * 1.5
  );
}

function toleranceThreshold(tolerance: WeatherTolerance): number {
  switch (tolerance) {
    case "none":
      return 20;
    case "low":
      return 35;
    case "medium":
      return 55;
    case "high":
      return 80;
  }
}

function mergeDay(
  date: string,
  nws: NwsDaily | undefined,
  windy: WindyDaily | undefined
): DailyWeatherRisk {
  const nwsRisk = nws
    ? dayRisk(nws.pop, nws.precipIn, nws.windMph)
    : null;
  const windyRisk = windy
    ? dayRisk(windy.pop, windy.precipIn, windy.windMph)
    : null;

  let riskScore: number;
  let agreement: number;
  if (nwsRisk != null && windyRisk != null) {
    riskScore = (nwsRisk + windyRisk) / 2;
    const delta = Math.abs(nwsRisk - windyRisk);
    agreement = Math.max(0, 1 - delta / 50);
    // disagreement slightly worsens score
    riskScore += delta * 0.1;
  } else if (nwsRisk != null) {
    riskScore = nwsRisk;
    agreement = 0.5;
  } else if (windyRisk != null) {
    riskScore = windyRisk;
    agreement = 0.5;
  } else {
    riskScore = 50;
    agreement = 0;
  }

  const nwsBits = [
    nws?.shortForecast?.trim() || null,
    nws?.pop != null ? `PoP ${Math.round(nws.pop)}%` : null,
  ].filter(Boolean) as string[];
  const windyBits = [
    windy?.precipIn != null
      ? `~${windy.precipIn.toFixed(2)}" precip`
      : null,
    windy?.windMph != null
      ? `~${Math.round(windy.windMph)} mph wind`
      : null,
  ].filter(Boolean) as string[];

  const nwsLine = nwsBits.length ? nwsBits.join(", ") : null;
  const windyLine = windyBits.length ? windyBits.join(", ") : null;
  const headline =
    nws?.shortForecast?.trim() ||
    windyBits.join(", ") ||
    "Limited forecast data";

  return {
    date,
    headline,
    nwsLine,
    windyLine,
    nwsPop: nws?.pop ?? null,
    nwsPrecipIn: nws?.precipIn ?? null,
    nwsWindMph: nws?.windMph ?? null,
    windyPop: windy?.pop ?? null,
    windyPrecipIn: windy?.precipIn ?? null,
    windyWindMph: windy?.windMph ?? null,
    riskScore: Math.min(100, riskScore),
    agreement,
    summary: headline,
  };
}

function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (
    let d = new Date(start + "T12:00:00Z");
    d <= new Date(end + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export async function pickBestWeatherWindow(
  lat: number,
  lon: number,
  dateStart: string,
  dateEnd: string,
  tripDays: number,
  tolerance: WeatherTolerance
): Promise<WeatherWindow> {
  const today = new Date().toISOString().slice(0, 10);
  const forecastHorizon = new Date();
  forecastHorizon.setUTCDate(forecastHorizon.getUTCDate() + 7);
  const horizon = forecastHorizon.toISOString().slice(0, 10);

  const clippedStart = dateStart < today ? today : dateStart;
  const clippedEnd = dateEnd > horizon ? horizon : dateEnd;

  let note = "";
  if (dateEnd > horizon) {
    note = `Forecast only reliable through ${horizon}; dates beyond that were excluded.`;
  }

  if (clippedStart > clippedEnd) {
    return {
      startDate: dateStart,
      endDate: dateEnd,
      avgRisk: 100,
      days: [],
      nwsAvailable: false,
      windyAvailable: false,
      note:
        note ||
        "Requested window is outside the available forecast horizon (~7 days).",
      toleranceExceeded: true,
    };
  }

  let nws: NwsDaily[] = [];
  let windy: WindyDaily[] | null = null;
  let nwsAvailable = false;
  let windyAvailable = false;

  try {
    nws = await fetchNwsDailyForecast(lat, lon, clippedStart, clippedEnd);
    nwsAvailable = nws.length > 0;
  } catch (err) {
    note = [note, `NWS unavailable: ${(err as Error).message}`]
      .filter(Boolean)
      .join(" ");
  }

  try {
    windy = await fetchWindyDailyForecast(lat, lon, clippedStart, clippedEnd);
    windyAvailable = Boolean(windy && windy.length);
  } catch (err) {
    note = [note, `Windy unavailable: ${(err as Error).message}`]
      .filter(Boolean)
      .join(" ");
  }

  const nwsMap = new Map(nws.map((d) => [d.date, d]));
  const windyMap = new Map((windy ?? []).map((d) => [d.date, d]));
  const allDates = eachDate(clippedStart, clippedEnd);
  const days = allDates.map((date) =>
    mergeDay(date, nwsMap.get(date), windyMap.get(date))
  );

  if (days.length < tripDays) {
    return {
      startDate: clippedStart,
      endDate: clippedEnd,
      avgRisk: 100,
      days,
      nwsAvailable,
      windyAvailable,
      note:
        note ||
        `Not enough forecast days (${days.length}) for a ${tripDays}-day trip.`,
      toleranceExceeded: true,
    };
  }

  const threshold = toleranceThreshold(tolerance);
  let best: WeatherWindow | null = null;

  for (let i = 0; i <= days.length - tripDays; i++) {
    const slice = days.slice(i, i + tripDays);
    const avgRisk =
      slice.reduce((s, d) => s + d.riskScore, 0) / slice.length;
    const avgAgreement =
      slice.reduce((s, d) => s + d.agreement, 0) / slice.length;
    // prefer lower risk; slight bonus for source agreement
    const adjusted = avgRisk - avgAgreement * 5;
    const candidate: WeatherWindow = {
      startDate: slice[0].date,
      endDate: slice[slice.length - 1].date,
      avgRisk: adjusted,
      days: slice,
      nwsAvailable,
      windyAvailable,
      note,
      toleranceExceeded: false,
    };
    if (!best || candidate.avgRisk < best.avgRisk) best = candidate;
  }

  const window = best!;
  if (window.avgRisk > threshold) {
    window.toleranceExceeded = true;
  }
  return window;
}

export function weatherScoreForTolerance(
  avgRisk: number,
  tolerance: WeatherTolerance
): number {
  const threshold = toleranceThreshold(tolerance);
  if (avgRisk <= threshold * 0.5) return 100;
  if (avgRisk <= threshold) return 85 - ((avgRisk / threshold) * 25);
  if (avgRisk <= threshold + 20) return 50 - (avgRisk - threshold);
  return Math.max(0, 25 - (avgRisk - threshold - 20));
}
