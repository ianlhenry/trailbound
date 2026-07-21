import { NextResponse } from "next/server";
import { routeCount } from "@/lib/db";
import { recommendRoutes } from "@/lib/scoring/recommend";
import type {
  PermitPreference,
  RecommendCriteria,
  WeatherTolerance,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isTolerance(v: unknown): v is WeatherTolerance {
  return (
    v === "none" || v === "low" || v === "medium" || v === "high"
  );
}

function isPermit(v: unknown): v is PermitPreference {
  return v === "no_permit" || v === "permit_ok" || v === "any";
}

export async function POST(request: Request) {
  try {
    if (routeCount() === 0) {
      return NextResponse.json(
        {
          error:
            "No routes in the database yet. Run `npm run ingest` first.",
        },
        { status: 503 }
      );
    }

    const body = await request.json();
    const criteria: RecommendCriteria = {
      dateStart: String(body.dateStart ?? ""),
      dateEnd: String(body.dateEnd ?? ""),
      nights: Number(body.nights),
      minMilesPerDay: Number(body.minMilesPerDay ?? 0),
      maxMilesPerDay: Number(body.maxMilesPerDay),
      weatherTolerance: body.weatherTolerance,
      maxDriveHours: Number(body.maxDriveHours),
      permitPreference: body.permitPreference,
    };

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(criteria.dateStart) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(criteria.dateEnd)
    ) {
      return NextResponse.json(
        { error: "dateStart and dateEnd must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    if (
      !Number.isFinite(criteria.nights) ||
      criteria.nights < 1 ||
      criteria.nights > 14
    ) {
      return NextResponse.json(
        { error: "nights must be between 1 and 14" },
        { status: 400 }
      );
    }
    if (
      !Number.isFinite(criteria.minMilesPerDay) ||
      criteria.minMilesPerDay < 0
    ) {
      return NextResponse.json(
        { error: "minMilesPerDay must be >= 0" },
        { status: 400 }
      );
    }
    if (
      !Number.isFinite(criteria.maxMilesPerDay) ||
      criteria.maxMilesPerDay <= 0
    ) {
      return NextResponse.json(
        { error: "maxMilesPerDay must be > 0" },
        { status: 400 }
      );
    }
    if (criteria.minMilesPerDay > criteria.maxMilesPerDay) {
      return NextResponse.json(
        { error: "minMilesPerDay cannot exceed maxMilesPerDay" },
        { status: 400 }
      );
    }
    if (!isTolerance(criteria.weatherTolerance)) {
      return NextResponse.json(
        { error: "Invalid weatherTolerance" },
        { status: 400 }
      );
    }
    if (
      !Number.isFinite(criteria.maxDriveHours) ||
      criteria.maxDriveHours <= 0
    ) {
      return NextResponse.json(
        { error: "maxDriveHours must be > 0" },
        { status: 400 }
      );
    }
    if (!isPermit(criteria.permitPreference)) {
      return NextResponse.json(
        { error: "Invalid permitPreference" },
        { status: 400 }
      );
    }
    if (criteria.dateEnd < criteria.dateStart) {
      return NextResponse.json(
        { error: "dateEnd must be on or after dateStart" },
        { status: 400 }
      );
    }

    const results = await recommendRoutes(criteria);
    return NextResponse.json({
      count: results.length,
      results,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: (err as Error).message || "Recommendation failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    routesLoaded: routeCount(),
    ok: true,
  });
}
