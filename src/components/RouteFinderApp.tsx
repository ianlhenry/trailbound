"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  PermitPreference,
  ScoredRoute,
  WeatherTolerance,
} from "@/lib/types";
import { relevantTripReportExcerpt } from "@/lib/wta/excerpts";

const CRITERIA_STORAGE_KEY = "trailbound:criteria";

const RESULT_LIMITS = [10, 20, 30, 40, 50] as const;
type ResultLimit = (typeof RESULT_LIMITS)[number];

type SavedCriteria = {
  dateStart: string;
  dateEnd: string;
  nights: number;
  minMilesPerDay: number;
  maxMilesPerDay: number;
  weatherTolerance: WeatherTolerance;
  maxDriveHours: number;
  permitPreference: PermitPreference;
  resultLimit: ResultLimit;
};

function isResultLimit(v: unknown): v is ResultLimit {
  return RESULT_LIMITS.includes(v as ResultLimit);
}

function defaultDates() {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return {
    dateStart: start.toISOString().slice(0, 10),
    dateEnd: end.toISOString().slice(0, 10),
  };
}

function loadSavedCriteria(): SavedCriteria | null {
  try {
    const raw = localStorage.getItem(CRITERIA_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedCriteria>;
    if (
      typeof parsed.dateStart !== "string" ||
      typeof parsed.dateEnd !== "string" ||
      typeof parsed.nights !== "number" ||
      typeof parsed.minMilesPerDay !== "number" ||
      typeof parsed.maxMilesPerDay !== "number" ||
      typeof parsed.maxDriveHours !== "number" ||
      (parsed.weatherTolerance !== "none" &&
        parsed.weatherTolerance !== "low" &&
        parsed.weatherTolerance !== "medium" &&
        parsed.weatherTolerance !== "high") ||
      (parsed.permitPreference !== "any" &&
        parsed.permitPreference !== "no_permit" &&
        parsed.permitPreference !== "permit_ok")
    ) {
      return null;
    }
    const resultLimit = isResultLimit(parsed.resultLimit)
      ? parsed.resultLimit
      : 10;
    return { ...(parsed as SavedCriteria), resultLimit };
  } catch {
    return null;
  }
}

function formatHours(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const h = minutes / 60;
  if (h < 10) return `${h.toFixed(1)} h`;
  return `${Math.round(h)} h`;
}

function ScoreBar({
  label,
  value,
  tip,
}: {
  label: string;
  value: number;
  tip?: string;
}) {
  return (
    <div className="score-bar">
      <div className="score-bar__meta">
        <span className="score-bar__label">
          {label}
          {tip ? <InfoTip text={tip} /> : null}
        </span>
        <span>{Math.round(value)}</span>
      </div>
      <div className="score-bar__track">
        <div
          className="score-bar__fill"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="info-tip">
      <button
        type="button"
        className="info-tip__btn"
        aria-label={text}
        title={text}
      >
        <svg
          className="info-tip__icon"
          viewBox="0 0 16 16"
          width="14"
          height="14"
          aria-hidden="true"
        >
          <circle
            cx="8"
            cy="8"
            r="6.25"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="8" cy="5.25" r="0.9" fill="currentColor" />
          <path
            d="M8 7.2v4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <span className="info-tip__bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}

function FieldLabel({
  children,
  tip,
}: {
  children: React.ReactNode;
  tip?: string;
}) {
  return (
    <span className="field__label">
      {children}
      {tip ? <InfoTip text={tip} /> : null}
    </span>
  );
}

export function RouteFinderApp() {
  const defaults = useMemo(() => defaultDates(), []);
  const [dateStart, setDateStart] = useState(defaults.dateStart);
  const [dateEnd, setDateEnd] = useState(defaults.dateEnd);
  const [nights, setNights] = useState(2);
  const [minMilesPerDay, setMinMilesPerDay] = useState(0);
  const [maxMilesPerDay, setMaxMilesPerDay] = useState(10);
  const [weatherTolerance, setWeatherTolerance] =
    useState<WeatherTolerance>("low");
  const [maxDriveHours, setMaxDriveHours] = useState(4);
  const [permitPreference, setPermitPreference] =
    useState<PermitPreference>("any");
  const [resultLimit, setResultLimit] = useState<ResultLimit>(10);
  const [criteriaReady, setCriteriaReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ScoredRoute[] | null>(null);
  const [routesLoaded, setRoutesLoaded] = useState<number | null>(null);

  useEffect(() => {
    const saved = loadSavedCriteria();
    if (saved) {
      setDateStart(saved.dateStart);
      setDateEnd(saved.dateEnd);
      setNights(saved.nights);
      setMinMilesPerDay(saved.minMilesPerDay);
      setMaxMilesPerDay(saved.maxMilesPerDay);
      setWeatherTolerance(saved.weatherTolerance);
      setMaxDriveHours(saved.maxDriveHours);
      setPermitPreference(saved.permitPreference);
      setResultLimit(saved.resultLimit);
    }
    setCriteriaReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/recommend");
        const data = (await res.json()) as { routesLoaded?: number };
        if (!cancelled && typeof data.routesLoaded === "number") {
          setRoutesLoaded(data.routesLoaded);
        }
      } catch {
        if (!cancelled) setRoutesLoaded(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!criteriaReady) return;
    const payload: SavedCriteria = {
      dateStart,
      dateEnd,
      nights,
      minMilesPerDay,
      maxMilesPerDay,
      weatherTolerance,
      maxDriveHours,
      permitPreference,
      resultLimit,
    };
    try {
      localStorage.setItem(CRITERIA_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore quota / private mode
    }
  }, [
    criteriaReady,
    dateStart,
    dateEnd,
    nights,
    minMilesPerDay,
    maxMilesPerDay,
    weatherTolerance,
    maxDriveHours,
    permitPreference,
    resultLimit,
  ]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateStart,
          dateEnd,
          nights,
          minMilesPerDay,
          maxMilesPerDay,
          weatherTolerance,
          maxDriveHours,
          permitPreference,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setResults(data.results as ScoredRoute[]);
    } catch (err) {
      setResults(null);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="brand">Trailbound</p>
        <h1 className="hero__title">Find your next WA overnight</h1>
        <p className="hero__lede">
          Rank backpacking routes by weather window, mileage, drive from
          Seattle, permits, and recent WTA trip reports.
        </p>
        <p className="hero__db muted">
          {routesLoaded == null
            ? "Checking route database…"
            : routesLoaded === 0
              ? "No routes in the database yet — run ingest / D1 import."
              : `Searching ${routesLoaded} overnight route${routesLoaded === 1 ? "" : "s"}`}
        </p>
      </header>

      <form className="criteria" onSubmit={onSubmit}>
        <div className="criteria__fields">
          <div className="criteria__row criteria__row--5">
            <label className="field">
              <FieldLabel tip="Preferred trip window. The scorer picks the best contiguous stretch of nights+1 days inside this range.">
                Window start
              </FieldLabel>
              <input
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <FieldLabel tip="End of the date window used when searching for the clearest weather stretch.">
                Window end
              </FieldLabel>
              <input
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                required
              />
            </label>
            <label className="field field--center">
              <FieldLabel tip="Trip length in nights. Used for daily mileage (total miles ÷ nights+1) and to size the weather window.">
                Nights
              </FieldLabel>
              <input
                type="number"
                min={1}
                max={14}
                value={nights}
                onChange={(e) => setNights(Number(e.target.value))}
                required
              />
            </label>
            <label className="field field--center">
              <FieldLabel tip="Hard filter: drops routes whose average miles per day fall below this.">
                Min miles/day
              </FieldLabel>
              <input
                type="number"
                min={0}
                step={0.5}
                value={minMilesPerDay}
                onChange={(e) => setMinMilesPerDay(Number(e.target.value))}
                required
              />
            </label>
            <label className="field field--center">
              <FieldLabel tip="Hard filter: drops routes that would require more miles per day than this.">
                Max miles/day
              </FieldLabel>
              <input
                type="number"
                min={1}
                step={0.5}
                value={maxMilesPerDay}
                onChange={(e) => setMaxMilesPerDay(Number(e.target.value))}
                required
              />
            </label>
          </div>

          <div className="criteria__row criteria__row--4">
            <label className="field">
              <FieldLabel tip="How much bad weather you’ll accept. The best NWS+Windy window inside your dates is scored against this; lower tolerance prefers clearer days.">
                Weather tolerance
              </FieldLabel>
              <select
                value={weatherTolerance}
                onChange={(e) =>
                  setWeatherTolerance(e.target.value as WeatherTolerance)
                }
              >
                <option value="none">None — near-zero rain</option>
                <option value="low">Low — light chance OK</option>
                <option value="medium">Medium — moderate rain OK</option>
                <option value="high">High — storms OK</option>
              </select>
            </label>
            <label className="field">
              <FieldLabel tip="Any / Permit OK keep all routes. No overnight permit drops permit-required trips. Does not affect ranking.">
                Permits
              </FieldLabel>
              <select
                value={permitPreference}
                onChange={(e) =>
                  setPermitPreference(e.target.value as PermitPreference)
                }
              >
                <option value="any">Any</option>
                <option value="no_permit">No overnight permit</option>
                <option value="permit_ok">Permit OK</option>
              </select>
            </label>
            <label className="field field--center">
              <FieldLabel tip="Hard filter on Mapbox drive time from Seattle. Shorter drives also score higher within the cap.">
                Max drive from Seattle (h)
              </FieldLabel>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={maxDriveHours}
                onChange={(e) => setMaxDriveHours(Number(e.target.value))}
                required
              />
            </label>
            <label className="field field--center">
              <FieldLabel tip="How many top-ranked routes to show after scoring.">
                Show top
              </FieldLabel>
              <select
                value={resultLimit}
                onChange={(e) =>
                  setResultLimit(Number(e.target.value) as ResultLimit)
                }
              >
                {RESULT_LIMITS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <button className="cta" type="submit" disabled={loading}>
          {loading ? "Scoring routes…" : "Rank routes"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {results && (
        <section className="results" aria-live="polite">
          <h2 className="results__heading">
            {Math.min(results.length, resultLimit)} of {results.length} route
            {results.length === 1 ? "" : "s"}, best first
          </h2>
          {results.length === 0 && (
            <p className="muted">
              Nothing matched those hard filters. Loosen mileage (min/max), drive
              time, or permit preference.
            </p>
          )}
          <ol className="result-list">
            {results.slice(0, resultLimit).map((item, index) => (
              <li key={item.route.id} className="result">
                <div className="result__top">
                  <div>
                    <h3 className="result__name">
                      <span className="result__rank">#{index + 1}</span>
                      <a
                        href={item.route.wtaUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {item.route.name}
                      </a>
                    </h3>
                    <p className="result__region">{item.route.region}</p>
                  </div>
                  <div className="result__score">
                    <span className="result__score-value">
                      {Math.round(item.score.total)}
                    </span>
                    <span className="result__score-label">score</span>
                  </div>
                </div>

                <div className="result__meta">
                  <span>{item.route.totalMiles.toFixed(1)} mi</span>
                  <span>{item.route.suggestedNights} nt suggested</span>
                  <span>
                    {formatHours(item.route.driveMinutesFromSeattle)} drive
                  </span>
                  <span
                    className={
                      item.route.permitRequired
                        ? "badge badge--permit"
                        : "badge"
                    }
                  >
                    {item.route.permitRequired
                      ? item.route.permitNotes || "Permit required"
                      : "No overnight permit flagged"}
                  </span>
                </div>

                <div className="breakdown">
                  <ScoreBar
                    label="Weather"
                    value={item.score.weather}
                    tip={item.scoreExplain.weather}
                  />
                  <ScoreBar
                    label="Mileage"
                    value={item.score.mileage}
                    tip={item.scoreExplain.mileage}
                  />
                  <ScoreBar
                    label="Drive"
                    value={item.score.drive}
                    tip={item.scoreExplain.drive}
                  />
                  <ScoreBar
                    label="Reports"
                    value={item.score.tripReports}
                    tip={item.scoreExplain.tripReports}
                  />
                  <ScoreBar
                    label="Nights fit"
                    value={item.score.nights}
                    tip={item.scoreExplain.nights}
                  />
                </div>

                {item.weatherWindow && (
                  <div className="detail-block">
                    <h4>Best weather window</h4>
                    <ul>
                      {item.weatherWindow.days.map((d) => {
                        const detail = [
                          d.nwsLine ? `NWS: ${d.nwsLine}` : null,
                          d.windyLine ? `Windy: ${d.windyLine}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        const nwsUrl = `https://forecast.weather.gov/MapClick.php?lat=${item.route.latitude}&lon=${item.route.longitude}`;
                        const windyUrl = `https://www.windy.com/${item.route.latitude.toFixed(3)}/${item.route.longitude.toFixed(3)}`;
                        return (
                          <li key={d.date}>
                            {d.date} —{" "}
                            <span title={detail || undefined}>
                              {d.headline}
                            </span>
                            {(d.nwsLine || d.windyLine) && (
                              <span
                                className="weather-day__sources"
                                title={detail || undefined}
                              >
                                {" "}
                                (
                                {d.nwsLine ? (
                                  <a
                                    href={nwsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    NWS
                                  </a>
                                ) : null}
                                {d.nwsLine && d.windyLine ? " · " : null}
                                {d.windyLine ? (
                                  <a
                                    href={windyUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Windy
                                  </a>
                                ) : null}
                                )
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {item.weatherWindow.toleranceExceeded ? (
                      <p className="weather-warning" role="status">
                        Warning: even the clearest stretch still exceeds your “
                        {weatherTolerance}” weather tolerance.
                      </p>
                    ) : null}
                    {item.weatherWindow.note ? (
                      <p className="muted">{item.weatherWindow.note}</p>
                    ) : null}
                  </div>
                )}

                {item.recentReports.length > 0 && (
                  <div className="detail-block">
                    <h4>Recent trip reports</h4>
                    <ul>
                      {item.recentReports.map((r) => (
                        <li key={r.id}>
                          <a href={r.url} target="_blank" rel="noreferrer">
                            {r.reportDate}
                          </a>
                          {r.issues ? ` — ${r.issues}` : ""}
                          {r.snippet ? (
                            <p className="detail-block__snippet">
                              {relevantTripReportExcerpt(r.snippet)}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
