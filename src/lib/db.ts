import type { RouteRow, TripReportRow } from "./types";

type Stmt = {
  bind(...values: unknown[]): BoundStmt;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
};

type BoundStmt = {
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
};

/** D1 or local better-sqlite3 adapter. */
export interface AppDatabase {
  prepare(query: string): Stmt;
  exec(query: string): Promise<unknown>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  wta_url TEXT NOT NULL,
  total_miles REAL NOT NULL,
  elevation_gain_ft INTEGER,
  high_point_ft INTEGER,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  features_json TEXT NOT NULL DEFAULT '[]',
  permit_required INTEGER NOT NULL DEFAULT 0,
  permit_notes TEXT,
  suggested_nights INTEGER NOT NULL,
  drive_minutes_from_seattle REAL,
  drive_miles_from_seattle REAL,
  summary TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trip_reports (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL,
  report_date TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL,
  issues TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  url TEXT NOT NULL,
  FOREIGN KEY (route_id) REFERENCES routes(id)
);

CREATE INDEX IF NOT EXISTS idx_trip_reports_route ON trip_reports(route_id);
CREATE INDEX IF NOT EXISTS idx_trip_reports_date ON trip_reports(report_date);

CREATE TABLE IF NOT EXISTS weather_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`;

let sqliteAdapter: AppDatabase | null = null;

function wrapBetterSqlite(db: {
  prepare: (sql: string) => {
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
    run: (...params: unknown[]) => unknown;
  };
  exec: (sql: string) => unknown;
}): AppDatabase {
  return {
    prepare(query: string) {
      const stmt = db.prepare(query);
      const makeBound = (values: unknown[]): BoundStmt => ({
        async all<T = Record<string, unknown>>() {
          return { results: stmt.all(...values) as T[] };
        },
        async first<T = Record<string, unknown>>() {
          return (stmt.get(...values) as T) ?? null;
        },
        async run() {
          return stmt.run(...values);
        },
      });
      return {
        bind(...values: unknown[]) {
          return makeBound(values);
        },
        all: <T = Record<string, unknown>>() => makeBound([]).all<T>(),
        first: <T = Record<string, unknown>>() => makeBound([]).first<T>(),
        run: () => makeBound([]).run(),
      };
    },
    async exec(query: string) {
      db.exec(query);
    },
  };
}

async function getLocalSqlite(): Promise<AppDatabase> {
  if (sqliteAdapter) return sqliteAdapter;
  const fs = await import("fs");
  const path = await import("path");
  const { default: Database } = await import("better-sqlite3");
  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, "routes.db"));
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  sqliteAdapter = wrapBetterSqlite(db as never);
  return sqliteAdapter;
}

async function getD1(): Promise<AppDatabase | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const db = (ctx.env as { DB?: AppDatabase }).DB;
    return db ?? null;
  } catch {
    return null;
  }
}

export async function getDb(): Promise<AppDatabase> {
  // `next dev` with OpenNext's Cloudflare bindings points at an empty local D1.
  // Prefer the existing data/routes.db unless USE_D1_LOCAL=1.
  const preferLocalSqlite =
    process.env.USE_D1_LOCAL !== "1" &&
    process.env.NODE_ENV !== "production";

  if (!preferLocalSqlite) {
    const d1 = await getD1();
    if (d1) return d1;
  }
  return getLocalSqlite();
}

function mapRoute(row: Record<string, unknown>): RouteRow {
  return {
    id: String(row.id),
    name: String(row.name),
    region: String(row.region),
    wtaUrl: String(row.wta_url),
    totalMiles: Number(row.total_miles),
    elevationGainFt:
      row.elevation_gain_ft == null ? null : Number(row.elevation_gain_ft),
    highPointFt: row.high_point_ft == null ? null : Number(row.high_point_ft),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    featuresJson: String(row.features_json ?? "[]"),
    permitRequired: Number(row.permit_required ?? 0),
    permitNotes: row.permit_notes == null ? null : String(row.permit_notes),
    suggestedNights: Number(row.suggested_nights),
    driveMinutesFromSeattle:
      row.drive_minutes_from_seattle == null
        ? null
        : Number(row.drive_minutes_from_seattle),
    driveMilesFromSeattle:
      row.drive_miles_from_seattle == null
        ? null
        : Number(row.drive_miles_from_seattle),
    summary: row.summary == null ? null : String(row.summary),
    updatedAt: String(row.updated_at),
  };
}

function mapReport(row: Record<string, unknown>): TripReportRow {
  return {
    id: String(row.id),
    routeId: String(row.route_id),
    reportDate: String(row.report_date),
    title: String(row.title),
    snippet: String(row.snippet),
    issues: row.issues == null ? null : String(row.issues),
    tagsJson: String(row.tags_json ?? "[]"),
    url: String(row.url),
  };
}

export async function upsertRoute(route: RouteRow): Promise<void> {
  const db = await getDb();
  await db
    .prepare(
      `INSERT INTO routes (
      id, name, region, wta_url, total_miles, elevation_gain_ft, high_point_ft,
      latitude, longitude, features_json, permit_required, permit_notes,
      suggested_nights, drive_minutes_from_seattle, drive_miles_from_seattle,
      summary, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      region=excluded.region,
      wta_url=excluded.wta_url,
      total_miles=excluded.total_miles,
      elevation_gain_ft=excluded.elevation_gain_ft,
      high_point_ft=excluded.high_point_ft,
      latitude=excluded.latitude,
      longitude=excluded.longitude,
      features_json=excluded.features_json,
      permit_required=excluded.permit_required,
      permit_notes=excluded.permit_notes,
      suggested_nights=excluded.suggested_nights,
      drive_minutes_from_seattle=COALESCE(excluded.drive_minutes_from_seattle, routes.drive_minutes_from_seattle),
      drive_miles_from_seattle=COALESCE(excluded.drive_miles_from_seattle, routes.drive_miles_from_seattle),
      summary=excluded.summary,
      updated_at=excluded.updated_at`
    )
    .bind(
      route.id,
      route.name,
      route.region,
      route.wtaUrl,
      route.totalMiles,
      route.elevationGainFt,
      route.highPointFt,
      route.latitude,
      route.longitude,
      route.featuresJson,
      route.permitRequired,
      route.permitNotes,
      route.suggestedNights,
      route.driveMinutesFromSeattle,
      route.driveMilesFromSeattle,
      route.summary,
      route.updatedAt
    )
    .run();
}

export async function updateRouteDrive(
  id: string,
  driveMinutes: number,
  driveMiles: number
): Promise<void> {
  const db = await getDb();
  await db
    .prepare(
      `UPDATE routes SET drive_minutes_from_seattle = ?, drive_miles_from_seattle = ? WHERE id = ?`
    )
    .bind(driveMinutes, driveMiles, id)
    .run();
}

export async function replaceTripReports(
  routeId: string,
  reports: TripReportRow[]
): Promise<void> {
  const db = await getDb();
  await db
    .prepare(`DELETE FROM trip_reports WHERE route_id = ?`)
    .bind(routeId)
    .run();
  for (const report of reports) {
    await db
      .prepare(
        `INSERT OR REPLACE INTO trip_reports (
      id, route_id, report_date, title, snippet, issues, tags_json, url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        report.id,
        report.routeId,
        report.reportDate,
        report.title,
        report.snippet,
        report.issues,
        report.tagsJson,
        report.url
      )
      .run();
  }
}

export async function listRoutes(): Promise<RouteRow[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(`SELECT * FROM routes ORDER BY name`)
    .all<Record<string, unknown>>();
  return results.map(mapRoute);
}

export async function getTripReportsForRoute(
  routeId: string,
  sinceDate: string
): Promise<TripReportRow[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      `SELECT * FROM trip_reports
       WHERE route_id = ? AND report_date >= ?
       ORDER BY report_date DESC`
    )
    .bind(routeId, sinceDate)
    .all<Record<string, unknown>>();
  return results.map(mapReport);
}

export async function routeCount(): Promise<number> {
  const db = await getDb();
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM routes`)
    .first<{ c: number }>();
  return Number(row?.c ?? 0);
}
