import "dotenv/config";
import {
  listRoutes,
  replaceTripReports,
  routeCount,
  updateRouteDrive,
  upsertRoute,
} from "../src/lib/db";
import { driveTimeFromSeattleWithDelay } from "../src/lib/drive/mapbox";
import { sleep } from "../src/lib/http";
import {
  collectOvernightCandidates,
  fetchHikeDetail,
  fetchTripReportsForRoute,
  type SearchHit,
} from "../src/lib/wta/scrape";

const TARGET = Number(process.env.INGEST_TARGET ?? 50);

/** Verified WTA overnight-friendly hike pages (details still scraped live). */
const SEED_URLS: string[] = [
  "https://www.wta.org/go-hiking/hikes/enchantment-lakes",
  "https://www.wta.org/go-hiking/hikes/seven-lakes-basin",
  "https://www.wta.org/go-hiking/hikes/enchanted-valley",
  "https://www.wta.org/go-hiking/hikes/necklace-valley",
  "https://www.wta.org/go-hiking/hikes/snow-lakes",
  "https://www.wta.org/go-hiking/hikes/colchuck-lake",
  "https://www.wta.org/go-hiking/hikes/spider-gap",
  "https://www.wta.org/go-hiking/hikes/image-lake",
  "https://www.wta.org/go-hiking/hikes/miners-ridge",
  "https://www.wta.org/go-hiking/hikes/sahale-arm",
  "https://www.wta.org/go-hiking/hikes/cascade-pass",
  "https://www.wta.org/go-hiking/hikes/gothic-basin",
  "https://www.wta.org/go-hiking/hikes/lake-ingalls",
  "https://www.wta.org/go-hiking/hikes/royal-basin",
  "https://www.wta.org/go-hiking/hikes/grand-valley",
  "https://www.wta.org/go-hiking/hikes/shi-shi-beach-and-point-of-arches",
  "https://www.wta.org/go-hiking/hikes/cape-alava",
  "https://www.wta.org/go-hiking/hikes/third-beach",
  "https://www.wta.org/go-hiking/hikes/second-beach",
  "https://www.wta.org/go-hiking/hikes/hoh-river",
  "https://www.wta.org/go-hiking/hikes/dosewallips-river",
  "https://www.wta.org/go-hiking/hikes/duckabush-river",
  "https://www.wta.org/go-hiking/hikes/obstruction-point-deer-park",
  "https://www.wta.org/go-hiking/hikes/summerland-panhandle-gap",
  "https://www.wta.org/go-hiking/hikes/spray-park",
  "https://www.wta.org/go-hiking/hikes/indian-henrys-hunting-ground",
  "https://www.wta.org/go-hiking/hikes/goat-lake",
  "https://www.wta.org/go-hiking/hikes/pete-lake",
  "https://www.wta.org/go-hiking/hikes/rachel-lake",
  "https://www.wta.org/go-hiking/hikes/alta-mountain",
  "https://www.wta.org/go-hiking/hikes/dutch-miller-gap",
  "https://www.wta.org/go-hiking/hikes/park-creek-pass",
  "https://www.wta.org/go-hiking/hikes/thunder-creek",
  "https://www.wta.org/go-hiking/hikes/copper-ridge",
  "https://www.wta.org/go-hiking/hikes/chain-lakes",
  "https://www.wta.org/go-hiking/hikes/ptarmigan-ridge",
  "https://www.wta.org/go-hiking/hikes/skyline-divide",
  "https://www.wta.org/go-hiking/hikes/park-butte",
  "https://www.wta.org/go-hiking/hikes/yellow-aster-butte",
  "https://www.wta.org/go-hiking/hikes/lake-ann",
  "https://www.wta.org/go-hiking/hikes/packwood-lake",
  "https://www.wta.org/go-hiking/hikes/jade-lake",
  "https://www.wta.org/go-hiking/hikes/marmot-lake",
  "https://www.wta.org/go-hiking/hikes/deep-lake",
  "https://www.wta.org/go-hiking/hikes/cathedral-rock",
  "https://www.wta.org/go-hiking/hikes/cathedral-pass-loop",
  "https://www.wta.org/go-hiking/hikes/boundary-trail-1",
  "https://www.wta.org/go-hiking/hikes/lake-of-the-angels",
  "https://www.wta.org/go-hiking/hikes/flapjack-lakes",
  "https://www.wta.org/go-hiking/hikes/upper-lena-lake",
  "https://www.wta.org/go-hiking/hikes/high-divide",
  "https://www.wta.org/go-hiking/hikes/blanca-lake",
  "https://www.wta.org/go-hiking/hikes/glacier-basin",
  "https://www.wta.org/go-hiking/hikes/copper-lake",
  "https://www.wta.org/go-hiking/hikes/navaho-pass",
  "https://www.wta.org/go-hiking/hikes/ingalls-creek",
  "https://www.wta.org/go-hiking/hikes/bean-creek-basin",
  "https://www.wta.org/go-hiking/hikes/monte-cristo",
  "https://www.wta.org/go-hiking/hikes/robin-lakes",
  "https://www.wta.org/go-hiking/hikes/hyas-lake",
  "https://www.wta.org/go-hiking/hikes/lake-isabel",
  "https://www.wta.org/go-hiking/hikes/surprise-lake",
  "https://www.wta.org/go-hiking/hikes/melakwa-lake",
  "https://www.wta.org/go-hiking/hikes/gem-lake",
  "https://www.wta.org/go-hiking/hikes/lake-janus-grizzly-peak",
  "https://www.wta.org/go-hiking/hikes/buckskin-ridge",
  "https://www.wta.org/go-hiking/hikes/middle-fork-pasayten-river",
  "https://www.wta.org/go-hiking/hikes/top-lake",
  "https://www.wta.org/go-hiking/hikes/heather-lake",
  "https://www.wta.org/go-hiking/hikes/eightmile-lake",
  "https://www.wta.org/go-hiking/hikes/lake-stuart",
];

function seedHits(): SearchHit[] {
  return SEED_URLS.map((url) => ({
    name: url.split("/").pop()!.replace(/-/g, " "),
    url,
    region: "Washington",
    totalMiles: null,
  }));
}

async function ingestOne(hit: SearchHit): Promise<boolean> {
  console.log(`Fetching ${hit.url}`);
  let route;
  try {
    route = await fetchHikeDetail(hit);
  } catch (err) {
    const msg = (err as Error).message || "";
    if (/\b404\b/.test(msg)) {
      console.log(`  skip (page not found)`);
      return false;
    }
    throw err;
  }
  await sleep(2500);
  if (!route) {
    console.log(`  skip (no coords or too short for overnight)`);
    return false;
  }

  upsertRoute(route);

  try {
    const reports = await fetchTripReportsForRoute(route);
    replaceTripReports(route.id, reports);
    console.log(`  saved with ${reports.length} recent trip reports`);
  } catch (err) {
    console.warn(`  trip reports failed:`, (err as Error).message);
    replaceTripReports(route.id, []);
  }

  if (process.env.MAPBOX_ACCESS_TOKEN) {
    try {
      const drive = await driveTimeFromSeattleWithDelay(
        route.latitude,
        route.longitude
      );
      if (drive) {
        updateRouteDrive(route.id, drive.minutes, drive.miles);
        console.log(`  drive from Seattle: ${(drive.minutes / 60).toFixed(1)}h`);
      }
    } catch (err) {
      console.warn(`  mapbox failed:`, (err as Error).message);
    }
  }

  console.log(`  saved — ${route.name}`);
  return true;
}

async function main() {
  console.log(`Starting WTA ingest (target ${TARGET} overnight routes)...`);
  const existing = new Set(listRoutes().map((r) => r.wtaUrl));
  let saved = existing.size;
  console.log(`Already in DB: ${saved}`);

  const byUrl = new Map<string, SearchHit>();
  for (const hit of seedHits()) byUrl.set(hit.url, hit);

  for (const hit of byUrl.values()) {
    if (saved >= TARGET) break;
    if (existing.has(hit.url)) continue;
    try {
      const ok = await ingestOne(hit);
      if (ok) {
        saved++;
        existing.add(hit.url);
        console.log(`  progress ${saved}/${TARGET}`);
      }
    } catch (err) {
      console.warn(`  failed:`, (err as Error).message);
      await sleep(3000);
    }
  }

  if (saved < TARGET) {
    try {
      const candidates = await collectOvernightCandidates(TARGET);
      console.log(`Search yielded ${candidates.length} long-hike candidates`);
      for (const hit of candidates) {
        if (saved >= TARGET) break;
        if (existing.has(hit.url)) continue;
        try {
          const ok = await ingestOne(hit);
          if (ok) {
            saved++;
            existing.add(hit.url);
            console.log(`  progress ${saved}/${TARGET}`);
          }
        } catch (err) {
          console.warn(`  failed:`, (err as Error).message);
          await sleep(3000);
        }
      }
    } catch (err) {
      console.warn("Search failed:", err);
    }
  }

  // Backfill Mapbox drive times for routes that were ingested before the token existed.
  if (process.env.MAPBOX_ACCESS_TOKEN) {
    const needingDrive = listRoutes().filter(
      (r) => r.driveMinutesFromSeattle == null
    );
    if (needingDrive.length) {
      console.log(
        `Backfilling Mapbox drive times for ${needingDrive.length} routes...`
      );
      let filled = 0;
      for (const route of needingDrive) {
        try {
          const drive = await driveTimeFromSeattleWithDelay(
            route.latitude,
            route.longitude
          );
          if (drive) {
            updateRouteDrive(route.id, drive.minutes, drive.miles);
            filled++;
            console.log(
              `  ${route.name}: ${(drive.minutes / 60).toFixed(1)}h`
            );
          } else {
            console.warn(`  ${route.name}: no route returned`);
          }
        } catch (err) {
          console.warn(`  ${route.name}:`, (err as Error).message);
        }
      }
      console.log(`Drive times filled: ${filled}/${needingDrive.length}`);
    } else {
      console.log("All routes already have drive times.");
    }
  } else {
    console.log("MAPBOX_ACCESS_TOKEN not set; skipping drive-time backfill.");
  }

  console.log(`Done. Routes in DB: ${routeCount()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
