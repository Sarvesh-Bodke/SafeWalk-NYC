// ---------------------------------------------------------------------------
// Linkup API wrapper
// Docs: https://docs.linkup.so
// ---------------------------------------------------------------------------

const LINKUP_BASE = "https://api.linkup.so/v1";
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

// ---------------------------------------------------------------------------
// Internal Linkup types
// ---------------------------------------------------------------------------

interface LinkupSource {
  name: string;
  url: string;
}

interface LinkupSearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  source?: LinkupSource;
}

interface LinkupSearchResponse {
  results: LinkupSearchResult[];
  query: string;
}

interface LinkupRequestBody {
  q: string;
  depth: "standard" | "deep";
  outputType: "searchResults" | "sourcedAnswer";
  fromDate?: string;
  includeSources?: boolean;
}

// ---------------------------------------------------------------------------
// Public result shape (feeds news_penalty in scoring engine)
// ---------------------------------------------------------------------------

export interface LocalContextResult {
  type: "incident" | "closure" | "alert";
  summary: string;
  severity: number; // 1–5 per result; summed + clamped to 0–15 for news_penalty
  source?: string;
  date?: string;
}

// ---------------------------------------------------------------------------
// Reverse geocoder (Nominatim / OpenStreetMap — free, no key required)
// Returns a human-readable cross-street / neighbourhood description.
// Fails gracefully — callers fall back to coordinate string on error.
// ---------------------------------------------------------------------------

interface NominatimAddress {
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  city_district?: string;
  quarter?: string;
}

interface NominatimResponse {
  address: NominatimAddress;
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);

  try {
    const url =
      `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lng}` +
      `&format=json&addressdetails=1&zoom=17`;

    const res = await fetch(url, {
      headers: { "User-Agent": "SafeWalkNYC/1.0 (contact@safewalk.nyc)" },
      signal: controller.signal,
    });

    if (!res.ok) return `${lat.toFixed(4)},${lng.toFixed(4)}`;

    const data: NominatimResponse = await res.json();
    const addr = data.address;

    const street = addr.road;
    const area =
      addr.neighbourhood ?? addr.suburb ?? addr.city_district ?? addr.quarter;

    if (street && area) return `${street}, ${area}`;
    if (street) return street;
    if (area) return area;
    return `${lat.toFixed(4)},${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)},${lng.toFixed(4)}`;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

function sevenDaysAgo(): string {
  return new Date(Date.now() - 7 * 86_400_000).toISOString().split("T")[0];
}

function buildQueries(locationDesc: string, customQuery?: string): string[] {
  if (customQuery) return [customQuery];
  return [
    `safety incidents crime alerts near ${locationDesc} NYC last 7 days`,
    `construction road closures detour near ${locationDesc} NYC today`,
  ];
}

// ---------------------------------------------------------------------------
// Core Linkup call
// ---------------------------------------------------------------------------

async function callLinkup(
  query: string,
  fromDate: string
): Promise<LinkupSearchResult[]> {
  const apiKey = process.env.LINKUP_API_KEY;
  if (!apiKey) throw new Error("LINKUP_API_KEY is not configured");

  const body: LinkupRequestBody = {
    q: query,
    depth: "standard",
    outputType: "searchResults",
    fromDate,
    includeSources: true,
  };

  const res = await fetch(`${LINKUP_BASE}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(unreadable body)");
    throw new Error(`Linkup ${res.status}: ${text}`);
  }

  const data: LinkupSearchResponse = await res.json();
  return data.results ?? [];
}

// ---------------------------------------------------------------------------
// Result classifier
// ---------------------------------------------------------------------------

// Each entry: [regex to match title+snippet, type, severity (1–5)]
const CLASSIFICATION_RULES: [RegExp, LocalContextResult["type"], number][] = [
  // High-severity incidents (5)
  [/shooting|gunshot|homicide|murder|stabbing/i,        "incident", 5],
  // Mid-high incidents (4)
  [/robbery|assault|attack|carjack|mugging/i,           "incident", 4],
  // Mid incidents (3)
  [/theft|larceny|burglary|break.?in|suspicious person/i, "incident", 3],
  // Lower incidents / nuisance (2)
  [/harassment|vandalism|drug|trespass/i,               "incident", 2],
  // Closures / construction (2)
  [/road closure|street closure|construction|detour|blocked/i, "closure", 2],
  // Utility / infrastructure issues (1)
  [/water main|gas leak|power outage|sinkhole/i,        "closure", 1],
  // Alerts / warnings (2)
  [/alert|warning|advisory|emergency|bolo/i,            "alert",    2],
  // General safety mention (1)
  [/unsafe|danger|avoid|caution/i,                      "alert",    1],
];

function classifyResult(result: LinkupSearchResult): LocalContextResult | null {
  const text = `${result.title} ${result.snippet}`.toLowerCase();

  for (const [pattern, type, severity] of CLASSIFICATION_RULES) {
    if (pattern.test(text)) {
      return {
        type,
        summary: result.snippet?.slice(0, 200) ?? result.title,
        severity,
        source: result.source?.name ?? result.url,
        date: result.date,
      };
    }
  }

  // Drop results that don't match any safety/closure pattern
  return null;
}

// ---------------------------------------------------------------------------
// searchLocalContext  (main export)
// ---------------------------------------------------------------------------

/**
 * Search Linkup for recent safety incidents, road closures, and alerts near
 * a given lat/lng. Returns parsed results ready to feed `computeNewsPenalty`.
 *
 * Fails silently — any network or API error returns `[]` so the scoring
 * engine continues with `newsPenalty = 0`.
 *
 * @param lat        Latitude of the location to search around
 * @param lng        Longitude of the location to search around
 * @param query      Optional override query; auto-generated if omitted
 */
export async function searchLocalContext(
  lat: number,
  lng: number,
  query?: string
): Promise<LocalContextResult[]> {
  try {
    const locationDesc = await reverseGeocode(lat, lng);
    const queries = buildQueries(locationDesc, query);
    const fromDate = sevenDaysAgo();

    // Run both queries in parallel; tolerate individual failures
    const settled = await Promise.allSettled(
      queries.map((q) => callLinkup(q, fromDate))
    );

    const allResults: LinkupSearchResult[] = settled.flatMap((r) =>
      r.status === "fulfilled" ? r.value : []
    );

    // Deduplicate by URL, classify, drop nulls
    const seen = new Set<string>();
    const classified: LocalContextResult[] = [];

    for (const result of allResults) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);

      const classified_result = classifyResult(result);
      if (classified_result) classified.push(classified_result);
    }

    // Sort highest severity first
    classified.sort((a, b) => b.severity - a.severity);

    return classified;
  } catch {
    // Linkup unavailable — caller defaults news_penalty to 0
    return [];
  }
}

// ---------------------------------------------------------------------------
// computeNewsPenalty
// Aggregates LocalContextResult[] into the 0–15 scale used by scoreSegment.
// ---------------------------------------------------------------------------

/**
 * Convert an array of local context results into a single `newsPenalty` value
 * in the [0, 15] range expected by `scoreSegment`.
 *
 * Summing severity across results naturally reaches the cap after ~3 serious
 * incidents (3 × 5 = 15) without over-penalising areas with many minor items.
 */
export function computeNewsPenalty(results: LocalContextResult[]): number {
  const raw = results.reduce((sum, r) => sum + r.severity, 0);
  return Math.min(15, Math.max(0, raw));
}

// ---------------------------------------------------------------------------
// Legacy exports kept for backward compatibility
// ---------------------------------------------------------------------------

/** @deprecated Use searchLocalContext instead. */
export async function searchSafetyNews(location: string): Promise<LinkupSearchResult[]> {
  try {
    return await callLinkup(
      `safety incidents crime alerts ${location} NYC recent`,
      sevenDaysAgo()
    );
  } catch {
    return [];
  }
}

/** @deprecated Use searchLocalContext instead. */
export async function searchNeighborhoodSafety(neighborhood: string): Promise<string> {
  const apiKey = process.env.LINKUP_API_KEY;
  if (!apiKey) return "No information available.";

  try {
    const res = await fetch(`${LINKUP_BASE}/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: `${neighborhood} New York City safety crime rate walking at night`,
        depth: "deep",
        outputType: "sourcedAnswer",
      }),
    });
    if (!res.ok) return "No information available.";
    const data: LinkupSearchResponse = await res.json();
    return data.results[0]?.snippet ?? "No information found.";
  } catch {
    return "No information available.";
  }
}

/** @deprecated Use searchLocalContext / callLinkup directly. */
export async function searchLinkup(
  query: string,
  options: { depth?: "standard" | "deep"; outputType?: "sourcedAnswer" | "searchResults" } = {}
): Promise<LinkupSearchResponse> {
  const apiKey = process.env.LINKUP_API_KEY;
  if (!apiKey) throw new Error("LINKUP_API_KEY is not set");

  const { depth = "standard", outputType = "searchResults" } = options;

  const res = await fetch(`${LINKUP_BASE}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, depth, outputType }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Linkup search failed (${res.status}): ${text}`);
  }

  return res.json();
}
