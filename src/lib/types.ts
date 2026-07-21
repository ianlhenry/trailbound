export type WeatherTolerance = "none" | "low" | "medium" | "high";
export type PermitPreference = "no_permit" | "permit_ok" | "any";

export interface RecommendCriteria {
  dateStart: string; // YYYY-MM-DD
  dateEnd: string;
  nights: number;
  minMilesPerDay: number;
  maxMilesPerDay: number;
  weatherTolerance: WeatherTolerance;
  maxDriveHours: number;
  permitPreference: PermitPreference;
}

export interface RouteRow {
  id: string;
  name: string;
  region: string;
  wtaUrl: string;
  totalMiles: number;
  elevationGainFt: number | null;
  highPointFt: number | null;
  latitude: number;
  longitude: number;
  featuresJson: string;
  permitRequired: number;
  permitNotes: string | null;
  suggestedNights: number;
  driveMinutesFromSeattle: number | null;
  driveMilesFromSeattle: number | null;
  summary: string | null;
  updatedAt: string;
}

export interface TripReportRow {
  id: string;
  routeId: string;
  reportDate: string;
  title: string;
  snippet: string;
  issues: string | null;
  tagsJson: string;
  url: string;
}

export interface ScoreBreakdown {
  total: number;
  mileage: number;
  drive: number;
  nights: number;
  weather: number;
  tripReports: number;
}

export interface ScoreExplain {
  weather: string;
  mileage: string;
  drive: string;
  nights: string;
  tripReports: string;
}

export interface DailyWeatherRisk {
  date: string;
  headline: string;
  nwsLine: string | null;
  windyLine: string | null;
  nwsPop: number | null;
  nwsPrecipIn: number | null;
  nwsWindMph: number | null;
  windyPop: number | null;
  windyPrecipIn: number | null;
  windyWindMph: number | null;
  riskScore: number;
  agreement: number;
  summary: string;
}

export interface WeatherWindow {
  startDate: string;
  endDate: string;
  avgRisk: number;
  days: DailyWeatherRisk[];
  nwsAvailable: boolean;
  windyAvailable: boolean;
  note: string;
}

export interface ScoredRoute {
  route: RouteRow;
  score: ScoreBreakdown;
  scoreExplain: ScoreExplain;
  weatherWindow: WeatherWindow | null;
  recentReports: TripReportRow[];
}
