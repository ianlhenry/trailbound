/**
 * Export local SQLite data/routes.db to a D1-friendly SQL file.
 *
 * Usage:
 *   npx tsx scripts/export-d1.ts
 *   npx wrangler d1 execute trailbound --remote --file=data/d1-import.sql
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const DB_PATH = path.join(process.cwd(), "data", "routes.db");
const OUT_PATH = path.join(process.cwd(), "data", "d1-import.sql");

function sqlString(value: unknown): string {
  if (value == null) return "NULL";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Missing ${DB_PATH}. Run npm run ingest first.`);
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: true });
  const lines: string[] = [
    "PRAGMA foreign_keys=OFF;",
    "DELETE FROM weather_cache;",
    "DELETE FROM trip_reports;",
    "DELETE FROM routes;",
  ];

  const routes = db.prepare(`SELECT * FROM routes`).all() as Record<
    string,
    unknown
  >[];
  for (const r of routes) {
    lines.push(
      `INSERT INTO routes (id, name, region, wta_url, total_miles, elevation_gain_ft, high_point_ft, latitude, longitude, features_json, permit_required, permit_notes, suggested_nights, drive_minutes_from_seattle, drive_miles_from_seattle, summary, updated_at) VALUES (${[
        r.id,
        r.name,
        r.region,
        r.wta_url,
        r.total_miles,
        r.elevation_gain_ft,
        r.high_point_ft,
        r.latitude,
        r.longitude,
        r.features_json,
        r.permit_required,
        r.permit_notes,
        r.suggested_nights,
        r.drive_minutes_from_seattle,
        r.drive_miles_from_seattle,
        r.summary,
        r.updated_at,
      ]
        .map(sqlString)
        .join(", ")});`
    );
  }

  const reports = db.prepare(`SELECT * FROM trip_reports`).all() as Record<
    string,
    unknown
  >[];
  for (const r of reports) {
    lines.push(
      `INSERT INTO trip_reports (id, route_id, report_date, title, snippet, issues, tags_json, url) VALUES (${[
        r.id,
        r.route_id,
        r.report_date,
        r.title,
        r.snippet,
        r.issues,
        r.tags_json,
        r.url,
      ]
        .map(sqlString)
        .join(", ")});`
    );
  }

  lines.push("PRAGMA foreign_keys=ON;");
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, lines.join("\n") + "\n");
  console.log(
    `Wrote ${routes.length} routes and ${reports.length} trip reports → ${OUT_PATH}`
  );
}

main();
