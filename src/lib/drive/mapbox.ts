import { fetchJson, sleep } from "../http";

export const SEATTLE = { lat: 47.6062, lon: -122.3321 };

interface MapboxDirectionsResponse {
  routes?: Array<{
    duration: number;
    distance: number;
  }>;
  message?: string;
  code?: string;
}

export async function driveTimeFromSeattle(
  lat: number,
  lon: number
): Promise<{ minutes: number; miles: number } | null> {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) {
    console.warn("MAPBOX_ACCESS_TOKEN missing; skipping drive time");
    return null;
  }

  const coords = `${SEATTLE.lon},${SEATTLE.lat};${lon},${lat}`;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
    `?overview=false&access_token=${token}`;

  const data = await fetchJson<MapboxDirectionsResponse>(url);
  const route = data.routes?.[0];
  if (!route) {
    console.warn(`No Mapbox route to ${lat},${lon}: ${data.message ?? data.code}`);
    return null;
  }

  return {
    minutes: route.duration / 60,
    miles: route.distance / 1609.344,
  };
}

export async function driveTimeFromSeattleWithDelay(
  lat: number,
  lon: number,
  delayMs = 300
): Promise<{ minutes: number; miles: number } | null> {
  const result = await driveTimeFromSeattle(lat, lon);
  await sleep(delayMs);
  return result;
}
