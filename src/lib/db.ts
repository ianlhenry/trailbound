import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import type { RouteRow, TripReportRow } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "routes.db");

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
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
  `);
  dbInstance = db;
  return db;
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

export function upsertRoute(route: RouteRow): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO routes (
      id, name, region, wta_url, total_miles, elevation_gain_ft, high_point_ft,
      latitude, longitude, features_json, permit_required, permit_notes,
      suggested_nights, drive_minutes_from_seattle, drive_miles_from_seattle,
      summary, updated_at
    ) VALUES (
      @id, @name, @region, @wtaUrl, @totalMiles, @elevationGainFt, @highPointFt,
      @latitude, @longitude, @featuresJson, @permitRequired, @permitNotes,
      @suggestedNights, @driveMinutesFromSeattle, @driveMilesFromSeattle,
      @summary, @updatedAt
    )
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
  ).run(route);
}

export function updateRouteDrive(
  id: string,
  driveMinutes: number,
  driveMiles: number
): void {
  getDb()
    .prepare(
      `UPDATE routes SET drive_minutes_from_seattle = ?, drive_miles_from_seattle = ? WHERE id = ?`
    )
    .run(driveMinutes, driveMiles, id);
}

export function replaceTripReports(
  routeId: string,
  reports: TripReportRow[]
): void {
  const db = getDb();
  const del = db.prepare(`DELETE FROM trip_reports WHERE route_id = ?`);
  const ins = db.prepare(
    `INSERT OR REPLACE INTO trip_reports (
      id, route_id, report_date, title, snippet, issues, tags_json, url
    ) VALUES (
      @id, @routeId, @reportDate, @title, @snippet, @issues, @tagsJson, @url
    )`
  );
  const tx = db.transaction(() => {
    del.run(routeId);
    for (const report of reports) ins.run(report);
  });
  tx();
}

export function listRoutes(): RouteRow[] {
  const rows = getDb().prepare(`SELECT * FROM routes ORDER BY name`).all();
  return rows.map((r) => mapRoute(r as Record<string, unknown>));
}

export function getTripReportsForRoute(
  routeId: string,
  sinceDate: string
): TripReportRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM trip_reports
       WHERE route_id = ? AND report_date >= ?
       ORDER BY report_date DESC`
    )
    .all(routeId, sinceDate);
  return rows.map((r) => mapReport(r as Record<string, unknown>));
}

export function routeCount(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS c FROM routes`).get() as {
    c: number;
  };
  return row.c;
}
