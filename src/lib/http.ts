export const WTA_USER_AGENT =
  process.env.NWS_USER_AGENT ??
  "route-finder/1.0 (WA backpacking planner; personal project)";

export async function fetchText(
  url: string,
  init: RequestInit = {},
  retries = 3
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          "User-Agent": WTA_USER_AGENT,
          Accept: "text/html,application/json",
          ...(init.headers ?? {}),
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return await res.text();
    } catch (err) {
      lastError = err;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  retries = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          "User-Agent": WTA_USER_AGENT,
          Accept: "application/geo+json,application/json",
          ...(init.headers ?? {}),
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} for ${url}: ${body.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function slugFromWtaUrl(url: string): string {
  const cleaned = url.replace(/\/$/, "");
  const parts = cleaned.split("/");
  return parts[parts.length - 1] || cleaned;
}
