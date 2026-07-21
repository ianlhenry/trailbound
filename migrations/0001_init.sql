-- Trailbound D1 schema
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
