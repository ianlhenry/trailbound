# Trailbound — WA Backpacking Finder

Suggests Washington overnight backpacking routes from your trip criteria, ranked best → worst.

## What it does

Given:

- a date window
- number of nights
- max mileage per day
- weather tolerance (`none` / `low` / `medium` / `high`)
- max drive time from Seattle
- permit preference

…the app:

1. Filters a local cache of ~50 WTA overnight routes
2. Picks the best weather window of length `nights + 1` inside your date range
3. Cross-checks **NOAA/NWS** and **Windy** forecasts
4. Factors recent **WTA trip reports** (last 30 days)
5. Uses **Mapbox** driving time Seattle → trailhead (cached at ingest)
6. Scores and lists routes from best to worst

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Purpose |
| --- | --- |
| `WINDY_API_KEY` | [Windy Point Forecast](https://api.windy.com/point-forecast/docs) key (trial key works for wiring; returns altered data) |
| `MAPBOX_ACCESS_TOKEN` | [Mapbox](https://account.mapbox.com/) token for Directions API |
| `NWS_USER_AGENT` | Required identity string for [api.weather.gov](https://www.weather.gov/documentation/services-web-api) |

## Ingest route data

Scrapes WTA for overnight-friendly hikes, last-30-day trip reports, permit flags, and Mapbox drive times:

```bash
npm run ingest
```

This is rate-limited (~2–3s between WTA requests) and can take a while for 50 routes. Re-run anytime to refresh.

Without `MAPBOX_ACCESS_TOKEN`, routes still ingest but drive times stay empty (drive soft-score is neutral; hard drive filter only applies when times exist).

## Cloudflare D1 (production)

Local `npm run dev` / `npm run ingest` still use `data/routes.db` via better-sqlite3. On Cloudflare, the app uses the **D1** binding `DB`.

1. Create the database (once):
   ```bash
   npx wrangler d1 create trailbound
   ```
2. Paste the returned `database_id` into `wrangler.jsonc` (`d1_databases[0].database_id`).
3. Apply schema:
   ```bash
   npm run d1:migrate:remote
   ```
4. Export local data and import into D1:
   ```bash
   npm run d1:import:remote
   ```
5. Redeploy. Set secrets (`WINDY_API_KEY`, `MAPBOX_ACCESS_TOKEN`, `NWS_USER_AGENT`) in the Cloudflare dashboard.

`wrangler.jsonc` also sets the Worker name and `WORKER_SELF_REFERENCE` to `trailbound` (must match the Cloudflare Worker name).

## Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## API

`POST /api/recommend`

```json
{
  "dateStart": "2026-07-22",
  "dateEnd": "2026-07-28",
  "nights": 2,
  "minMilesPerDay": 0,
  "maxMilesPerDay": 10,
  "weatherTolerance": "low",
  "maxDriveHours": 4,
  "permitPreference": "any"
}
```

`permitPreference`: `no_permit` | `permit_ok` | `any`

## Notes

- Forecast horizon is ~7 days; longer date windows are clipped with a note.
- Permit detection is heuristic from WTA page text (overnight/wilderness permits vs parking passes).
- Mapbox times are typical road routing; long FS roads / seasonal gates can still be optimistic.
- Be respectful of WTA — the ingest script rate-limits and identifies itself via User-Agent.

To pull more than the default 50 routes:

```bash
INGEST_TARGET=150 npm run ingest
```

Ingest keeps existing routes and adds new ones from the seed list, then from WTA’s paginated hike listing (`/go-outside/hikes`). Short day hikes and dead seed URLs are skipped.
