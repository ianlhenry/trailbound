import * as cheerio from "cheerio";
import { fetchText, sleep, slugFromWtaUrl } from "../http";
import type { RouteRow, TripReportRow } from "../types";

const WTA_BASE = "https://www.wta.org";
const SEARCH_PAGE_SIZE = 30;
const MIN_MILES = 5;
const TARGET_ROUTES = 50;
const REPORT_LOOKBACK_DAYS = 30;

export interface SearchHit {
  name: string;
  url: string;
  region: string;
  totalMiles: number | null;
}

function parseMiles(text: string): number | null {
  const m = text.match(/([\d,.]+)\s*miles/i);
  if (!m) return null;
  return Number(m[1].replace(/,/g, ""));
}

function parseIntLoose(text: string): number | null {
  const m = text.replace(/,/g, "").match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function parseReportDate(title: string): string | null {
  // e.g. "The Enchantments — Jul. 17, 2026"
  const m = title.match(
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2},\s+\d{4}/i
  );
  if (!m) return null;
  const d = new Date(m[0]);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function detectPermit(html: string): {
  required: boolean;
  notes: string | null;
} {
  const $ = cheerio.load(html);
  const permitHeading = $("h4")
    .filter((_, el) => $(el).text().toLowerCase().includes("permits required"))
    .first();
  let notes: string | null = null;
  if (permitHeading.length) {
    const container = permitHeading.parent();
    const link = container.find("a").first();
    notes = (link.text() || container.text())
      .replace(/Permits Required/i, "")
      .trim();
  }

  const sidebarText = $(".hike-sidebar, .alerts, .stat-table, .darksky")
    .text()
    .toLowerCase();
  const focused = `${(notes ?? "").toLowerCase()}\n${sidebarText}`;

  if (!notes && !focused.trim()) {
    // Fall back to a narrow keyword scan near permit heading only
    return { required: false, notes: null };
  }

  const overnightSignals = [
    "wilderness permit",
    "backcountry camping permit",
    "backcountry permit",
    "overnight permit",
    "camping permit",
    "permit only",
    "apply online",
    "lottery",
  ];

  if (notes && /no permits? required/i.test(notes)) {
    return { required: false, notes };
  }

  const required =
    Boolean(notes && /permit/i.test(notes)) ||
    overnightSignals.some((s) => focused.includes(s) || (notes ?? "").toLowerCase().includes(s));

  if (!notes && required) {
    notes = "Overnight/wilderness permit indicated on WTA page";
  }
  return { required, notes };
}

function suggestedNights(totalMiles: number, elevationGainFt: number | null): number {
  const gainFactor = elevationGainFt ? elevationGainFt / 2000 : 0;
  const rough = Math.round(totalMiles / 8 + gainFactor * 0.5);
  return Math.max(1, Math.min(7, rough));
}

export function parseSearchPage(html: string): SearchHit[] {
  const $ = cheerio.load(html);
  const hits: SearchHit[] = [];
  $(".search-result-item").each((_, el) => {
    const item = $(el);
    const anchor = item.find(".listitem-title a").first();
    const href = anchor.attr("href");
    const name = anchor.find("span").first().text().trim() || anchor.text().trim();
    if (!href || !name) return;
    const region = item.find(".region").first().text().replace(/\s+/g, " ").trim();
    const lengthText = item.find(".hike-length dd").text();
    hits.push({
      name,
      url: href.startsWith("http") ? href : `${WTA_BASE}${href}`,
      region,
      totalMiles: parseMiles(lengthText),
    });
  });
  return hits;
}

export async function collectOvernightCandidates(
  target = TARGET_ROUTES
): Promise<SearchHit[]> {
  const selected: SearchHit[] = [];
  const seen = new Set<string>();
  // WTA's paginated hike listing lives under /go-outside/hikes (not /go-hiking/hikes).
  const listBase = `${WTA_BASE}/go-outside/hikes`;

  for (
    let start = 0;
    start < 5000 && selected.length < target * 3;
    start += SEARCH_PAGE_SIZE
  ) {
    const url =
      `${listBase}?b_size=${SEARCH_PAGE_SIZE}` +
      `&b_start:int=${start}&show_incomplete=on`;
    const html = await fetchText(url);
    const hits = parseSearchPage(html);
    if (hits.length === 0) break;

    let newOnPage = 0;
    for (const hit of hits) {
      const id = slugFromWtaUrl(hit.url);
      if (seen.has(id)) continue;
      seen.add(id);
      newOnPage++;
      if (hit.totalMiles != null && hit.totalMiles >= MIN_MILES) {
        selected.push(hit);
      }
    }
    // Stop if pagination is stuck returning the same page
    if (newOnPage === 0) break;
    await sleep(2500);
  }

  return selected.slice(0, Math.max(target * 2, target));
}

export function parseHikeDetail(
  html: string,
  fallback: SearchHit
): RouteRow | null {
  const $ = cheerio.load(html);
  const schemaMatch = html.match(
    /"geo"\s*:\s*\{\s*"@type"\s*:\s*"GeoCoordinates"\s*,\s*"latitude"\s*:\s*([-\d.]+)\s*,\s*"longitude"\s*:\s*([-\d.]+)\s*\}/
  );
  if (!schemaMatch) return null;

  const latitude = Number(schemaMatch[1]);
  const longitude = Number(schemaMatch[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const name =
    $("h1.documentFirstHeading").first().text().trim() ||
    $("h1").first().text().trim() ||
    fallback.name;

  const region =
    $(".hike-region, .region").first().text().replace(/\s+/g, " ").trim() ||
    fallback.region;

  const stats: Record<string, string> = {};
  $(".hike-stats__stat, .hike-stat").each((_, el) => {
    const label = $(el).find("dt").text().replace(/\s+/g, " ").trim().toLowerCase();
    const value = $(el).find("dd").text().replace(/\s+/g, " ").trim();
    if (label) stats[label] = value;
  });

  const lengthText =
    stats["length"] ||
    $(".hike-length dd").text() ||
    "";
  const totalMiles = parseMiles(lengthText) ?? fallback.totalMiles;
  if (totalMiles == null || totalMiles < MIN_MILES) return null;

  const elevationGainFt =
    parseIntLoose(stats["elevation gain"] || $(".hike-gain dd").text());
  const highPointFt = parseIntLoose(
    stats["highest point"] || $(".hike-highpoint dd").text()
  );

  const features: string[] = [];
  $(".wta-icon__label").each((_, el) => {
    const label = $(el).text().trim();
    if (label) features.push(label);
  });

  const summary =
    $('meta[name="description"]').attr("content")?.trim() ||
    $(".hike-description, #hike-body").text().replace(/\s+/g, " ").trim().slice(0, 400) ||
    null;

  const permit = detectPermit(html);

  const id = slugFromWtaUrl(fallback.url);

  return {
    id,
    name,
    region,
    wtaUrl: fallback.url,
    totalMiles,
    elevationGainFt,
    highPointFt,
    latitude,
    longitude,
    featuresJson: JSON.stringify(features),
    permitRequired: permit.required ? 1 : 0,
    permitNotes: permit.notes,
    suggestedNights: suggestedNights(totalMiles, elevationGainFt),
    driveMinutesFromSeattle: null,
    driveMilesFromSeattle: null,
    summary,
    updatedAt: new Date().toISOString(),
  };
}

export function parseTripReports(
  html: string,
  routeId: string,
  sinceDate: string
): TripReportRow[] {
  const $ = cheerio.load(html);
  const reports: TripReportRow[] = [];

  $("#trip-reports .item").each((_, el) => {
    const item = $(el);
    const anchor = item.find(".listitem-title a").first();
    const href = anchor.attr("href");
    const title = anchor.text().replace(/\s+/g, " ").trim();
    if (!href || !title) return;

    const reportDate = parseReportDate(title);
    if (!reportDate || reportDate < sinceDate) return;

    const issues = item.find(".trail-issues").text().replace(/\s+/g, " ").trim() || null;
    const snippet = item
      .find(".trip-report-full-text, .report-text")
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

    const tags: string[] = [];
    item.find(".wta-icon__label").each((__, tagEl) => {
      const t = $(tagEl).text().trim();
      if (t) tags.push(t);
    });
    if (issues) {
      issues
        .replace(/^Beware of:\s*/i, "")
        .split(/,|&/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((t) => tags.push(t));
    }

    const url = href.startsWith("http") ? href : `${WTA_BASE}${href}`;
    const id = `${routeId}:${slugFromWtaUrl(url)}`;

    reports.push({
      id,
      routeId,
      reportDate,
      title,
      snippet,
      issues,
      tagsJson: JSON.stringify([...new Set(tags)]),
      url,
    });
  });

  // Dedupe by id in case pagination overlaps
  const seen = new Set<string>();
  return reports.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

export async function fetchTripReportsForRoute(
  route: RouteRow
): Promise<TripReportRow[]> {
  const since = daysAgoIso(REPORT_LOOKBACK_DAYS);
  const collected: TripReportRow[] = [];
  const seen = new Set<string>();

  for (let start = 0; start < 40; start += 10) {
    const url =
      `${route.wtaUrl.replace(/\/$/, "")}/@@related_tripreport_listing` +
      `?b_size=10&b_start:int=${start}`;
    const html = await fetchText(url);
    const batch = parseTripReports(html, route.id, since);
    if (batch.length === 0) {
      // If first page empty, stop; if later pages empty because older than window, stop
      break;
    }
    let added = 0;
    for (const r of batch) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      collected.push(r);
      added++;
    }
    // If the oldest in this batch is already before window, further pages are older
    const oldest = batch.map((r) => r.reportDate).sort()[0];
    if (!oldest || oldest < since || added === 0) break;
    await sleep(2000);
  }

  return collected;
}

export async function fetchHikeDetail(hit: SearchHit): Promise<RouteRow | null> {
  const html = await fetchText(hit.url);
  return parseHikeDetail(html, hit);
}
