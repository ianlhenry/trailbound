import { getTripReportsForRoute, listRoutes } from "../db";
import type {
  RecommendCriteria,
  RouteRow,
  ScoreBreakdown,
  ScoreExplain,
  ScoredRoute,
  TripReportRow,
  WeatherTolerance,
  WeatherWindow,
} from "../types";
import {
  pickBestWeatherWindow,
  weatherScoreForTolerance,
} from "../weather/window";

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function nightsFitScore(route: RouteRow, nights: number): number {
  const ideal = route.suggestedNights;
  const delta = Math.abs(ideal - nights);
  if (delta === 0) return 100;
  if (delta === 1) return 80;
  if (delta === 2) return 55;
  return Math.max(0, 40 - delta * 10);
}

function explainNightsFit(route: RouteRow, nights: number): string {
  const ideal = route.suggestedNights;
  const delta = Math.abs(ideal - nights);
  if (delta === 0) {
    return `Matches suggested length (${ideal} night${ideal === 1 ? "" : "s"}).`;
  }
  return `You asked for ${nights} night${nights === 1 ? "" : "s"}; this route suggests ${ideal} (off by ${delta}).`;
}

function driveScore(minutes: number | null, maxHours: number): number {
  if (minutes == null) return 50;
  const maxMinutes = maxHours * 60;
  if (minutes > maxMinutes) return 0;
  // 100 at 0, ~60 at max
  return clamp(100 - (minutes / maxMinutes) * 40);
}

function explainDrive(minutes: number | null, maxHours: number): string {
  if (minutes == null) {
    return "No Mapbox drive time cached yet — neutral mid score.";
  }
  const hours = minutes / 60;
  return `${hours.toFixed(1)} h from Seattle (cap ${maxHours} h). Shorter drives score higher within the cap.`;
}

function mileageScore(
  route: RouteRow,
  nights: number,
  minMilesPerDay: number,
  maxMilesPerDay: number
): number {
  const tripDays = nights + 1;
  const perDay = route.totalMiles / tripDays;
  if (perDay > maxMilesPerDay || perDay < minMilesPerDay) return 0;
  const span = Math.max(0.1, maxMilesPerDay - minMilesPerDay);
  const ratio = (perDay - minMilesPerDay) / span;
  // Prefer mid-to-upper band of the requested range
  if (ratio < 0.25) return 70;
  if (ratio <= 0.85) return 100;
  return 85;
}

function explainMileage(
  route: RouteRow,
  nights: number,
  minMilesPerDay: number,
  maxMilesPerDay: number
): string {
  const tripDays = nights + 1;
  const perDay = route.totalMiles / tripDays;
  return `${route.totalMiles.toFixed(1)} mi over ${tripDays} days ≈ ${perDay.toFixed(1)} mi/day (your range ${minMilesPerDay}–${maxMilesPerDay}). Mid–upper band scores highest.`;
}

function tripReportScore(reports: TripReportRow[]): {
  score: number;
  reasons: string[];
} {
  if (!reports.length) {
    return { score: 55, reasons: ["No trip reports in the last 30 days"] };
  }

  let score = 70;
  const reasons: string[] = [`${reports.length} report(s) in last 30 days`];
  const blob = reports
    .map((r) => `${r.issues ?? ""} ${r.tagsJson} ${r.snippet}`.toLowerCase())
    .join(" ");

  const negatives: Array<[RegExp, number, string]> = [
    [/\bclosed\b|\bclosure\b/, 25, "Recent closure mentions"],
    [/wash\s*out|washed out/, 20, "Washout mentions"],
    [/\bsnow\b|posthole|ice/, 12, "Snow/ice mentions"],
    [/\bbugs?\b|mosquito/, 8, "Bugs mentioned"],
    [/road condition|impassable road/, 10, "Road condition issues"],
  ];
  const positives: Array<[RegExp, number, string]> = [
    [/clear|great shape|in good shape|melted out/, 10, "Positive trail conditions"],
    [/open|accessible|easy access/, 6, "Access looks open"],
  ];

  for (const [re, penalty, label] of negatives) {
    if (re.test(blob)) {
      score -= penalty;
      reasons.push(label);
    }
  }
  for (const [re, bonus, label] of positives) {
    if (re.test(blob)) {
      score += bonus;
      reasons.push(label);
    }
  }

  return { score: clamp(score), reasons };
}

function explainWeather(
  weather: number,
  weatherWindow: WeatherWindow | null,
  tolerance: WeatherTolerance
): string {
  if (!weatherWindow) {
    return weather === 45
      ? "Weather fetch failed — using a low fallback score."
      : "No usable weather window for this date range.";
  }
  const sources = [
    weatherWindow.nwsAvailable ? "NWS" : null,
    weatherWindow.windyAvailable ? "Windy" : null,
  ]
    .filter(Boolean)
    .join(" + ");
  return `Best window ${weatherWindow.startDate} → ${weatherWindow.endDate} vs your "${tolerance}" tolerance${sources ? ` (${sources})` : ""}. Clearer windows score higher.`;
}

function passesHardFilters(
  route: RouteRow,
  criteria: RecommendCriteria
): string | null {
  const tripDays = criteria.nights + 1;
  const perDay = route.totalMiles / tripDays;
  if (perDay < criteria.minMilesPerDay) {
    return `Only ${perDay.toFixed(1)} mi/day < min ${criteria.minMilesPerDay}`;
  }
  if (perDay > criteria.maxMilesPerDay) {
    return `Needs ${perDay.toFixed(1)} mi/day > max ${criteria.maxMilesPerDay}`;
  }
  if (
    route.driveMinutesFromSeattle != null &&
    route.driveMinutesFromSeattle > criteria.maxDriveHours * 60
  ) {
    return `Drive ${(route.driveMinutesFromSeattle / 60).toFixed(1)}h > max ${criteria.maxDriveHours}h`;
  }
  if (criteria.permitPreference === "no_permit" && route.permitRequired) {
    return "Requires overnight/wilderness permit";
  }
  return null;
}

function combineScore(parts: Omit<ScoreBreakdown, "total">): ScoreBreakdown {
  const total =
    parts.mileage * 0.2 +
    parts.drive * 0.15 +
    parts.nights * 0.1 +
    parts.weather * 0.4 +
    parts.tripReports * 0.15;
  return { ...parts, total: clamp(total) };
}

export async function recommendRoutes(
  criteria: RecommendCriteria
): Promise<ScoredRoute[]> {
  const routes = listRoutes();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const sinceDate = since.toISOString().slice(0, 10);
  const tripDays = criteria.nights + 1;

  const candidates = routes.filter(
    (route) => passesHardFilters(route, criteria) == null
  );

  const scored: ScoredRoute[] = [];
  const batchSize = 5;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (route) => {
        const reports = getTripReportsForRoute(route.id, sinceDate).slice(0, 5);
        const reportEval = tripReportScore(reports);

        let weatherWindow = null;
        let weather = 50;
        try {
          weatherWindow = await pickBestWeatherWindow(
            route.latitude,
            route.longitude,
            criteria.dateStart,
            criteria.dateEnd,
            tripDays,
            criteria.weatherTolerance
          );
          weather = weatherScoreForTolerance(
            weatherWindow.avgRisk,
            criteria.weatherTolerance
          );
        } catch {
          weather = 45;
        }

        const breakdown = combineScore({
          mileage: mileageScore(
            route,
            criteria.nights,
            criteria.minMilesPerDay,
            criteria.maxMilesPerDay
          ),
          drive: driveScore(
            route.driveMinutesFromSeattle,
            criteria.maxDriveHours
          ),
          nights: nightsFitScore(route, criteria.nights),
          weather,
          tripReports: reportEval.score,
        });

        const scoreExplain: ScoreExplain = {
          weather: explainWeather(
            weather,
            weatherWindow,
            criteria.weatherTolerance
          ),
          mileage: explainMileage(
            route,
            criteria.nights,
            criteria.minMilesPerDay,
            criteria.maxMilesPerDay
          ),
          drive: explainDrive(
            route.driveMinutesFromSeattle,
            criteria.maxDriveHours
          ),
          nights: explainNightsFit(route, criteria.nights),
          tripReports: reportEval.reasons.join(" · "),
        };

        return {
          route,
          score: breakdown,
          scoreExplain,
          weatherWindow,
          recentReports: reports.slice(0, 3),
        } satisfies ScoredRoute;
      })
    );
    scored.push(...batchResults);
  }

  scored.sort((a, b) => b.score.total - a.score.total);
  return scored;
}
