import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  fetchCrimeData,
  fetchStreetlightComplaints,
  fetchTrafficSignals,
} from "@/lib/api/nyc-open-data";
import { searchLocalContext, computeNewsPenalty } from "@/lib/api/linkup";
import { scoreSegment, scoreRoute, scoreLabel, SegmentScore } from "@/lib/scoring";
import { Coordinates, RouteSegment } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT =
  "You are SafeWalk NYC, a safety-focused walking route advisor for NYC. " +
  "Parse the user's route request and extract origin coordinates, destination " +
  "coordinates, and time of day. Then explain route recommendations by " +
  "referencing specific safety data: crime incidents, broken streetlights, " +
  "traffic signals, and real-time alerts.";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const MAPBOX_BASE = "https://api.mapbox.com";
const SEGMENT_TARGET_M = 200;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ParsedIntent {
  originAddress: string;
  destinationAddress: string;
  timeOfDay: number; // 0–23, or -1 if not specified in the message
  preference: "safest" | "fastest" | "balanced";
}

interface MapboxStep {
  name: string;
  distance: number; // metres
  duration: number; // seconds
  geometry: { type: "LineString"; coordinates: [number, number][] };
  maneuver: { instruction: string };
}

interface MapboxRoute {
  geometry: { type: "LineString"; coordinates: [number, number][] };
  distance: number; // metres
  duration: number; // seconds
  legs: Array<{ steps: MapboxStep[]; distance: number; duration: number }>;
}

type EnrichedSegment = RouteSegment & { segmentScore: SegmentScore };

interface ScoredRoute {
  path: MapboxRoute["geometry"];
  score: number;
  distanceMiles: number;
  durationMinutes: number;
  label: string;
  segments: EnrichedSegment[];
  worstStreet: string;
  crimeCount: number;
  lightingIssues: number;
}

// ---------------------------------------------------------------------------
// Step 1 – Parse user intent with Claude
// ---------------------------------------------------------------------------

async function parseIntent(
  client: Anthropic,
  message: string,
  userLocation?: Coordinates
): Promise<ParsedIntent> {
  const locationHint = userLocation
    ? `User's GPS: ${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)} ` +
      `(use as origin if the user says "here", "my location", etc.)\n\n`
    : "";

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          `${locationHint}Parse this walking route request into JSON:\n"${message}"\n\n` +
          `Critical rules for originAddress / destinationAddress:\n` +
          `1. ALWAYS use the street address when the place has one — street addresses geocode reliably.\n` +
          `   Columbia Business School  →  "665 W 130th St"\n` +
          `   Riverside Church          →  "490 Riverside Dr"\n` +
          `   Penn Station              →  "4 Penn Plaza"\n` +
          `   NYU Stern                 →  "44 W 4th St"\n` +
          `   Barnard College           →  "3009 Broadway"\n` +
          `   Trader Joe's on 72nd      →  "2075 Broadway"\n` +
          `2. Only use a bare name for places with no single address:\n` +
          `   "Central Park", "Times Square", "Columbia University main campus"\n` +
          `3. NEVER append city, borough, or state ("NYC", "Manhattan", "New York").\n` +
          `4. Use the number + street form whenever possible.\n\n` +
          `{\n` +
          `  "originAddress": "street address or bare landmark only",\n` +
          `  "destinationAddress": "street address or bare landmark only",\n` +
          `  "timeOfDay": 22,\n` +
          `  "preference": "safest"\n` +
          `}`,
      },
    ],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Claude parse returned no text");

  const match = block.text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Claude parse did not return JSON");

  const parsed = JSON.parse(match[0]) as Partial<ParsedIntent>;

  if (!parsed.originAddress || !parsed.destinationAddress) {
    throw new Error("Could not extract origin and destination from your message");
  }

  return {
    originAddress: parsed.originAddress,
    destinationAddress: parsed.destinationAddress,
    timeOfDay: typeof parsed.timeOfDay === "number" ? parsed.timeOfDay : -1,
    preference: parsed.preference ?? "safest",
  };
}

// ---------------------------------------------------------------------------
// Step 2 – Geocode with Mapbox
// ---------------------------------------------------------------------------

/** Strip any trailing borough/city/state that Claude sometimes appends. */
function cleanAddress(raw: string): string {
  return raw
    .replace(/,?\s*(manhattan|brooklyn|queens|bronx|staten island|new york city|nyc|new york|ny)\s*$/gi, "")
    .replace(/,?\s*[A-Z]{2}\s*\d{5}(-\d{4})?\s*$/i, "") // strip zip codes
    .trim();
}

// Hard bounding box for all five NYC boroughs.
// Prevents Mapbox from returning NJ/CT results for ambiguous queries.
const NYC_BBOX = "&bbox=-74.259,40.477,-73.700,40.917";

// "place" is intentionally excluded: it matches city-level features like
// "New York, United States" and is returned as a fallback when Mapbox can't
// resolve the POI name — giving us Financial District coords for any unknown
// institution. We only want address / poi / neighborhood results.
const GEOCODE_TYPES = "address,poi,neighborhood";

async function tryGeocode(query: string, prox: string): Promise<Coordinates | null> {
  const url =
    `${MAPBOX_BASE}/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${MAPBOX_TOKEN}` +
    `&country=US&types=${GEOCODE_TYPES}&language=en` +
    `${NYC_BBOX}${prox}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  // Require the result to be within NYC boroughs (lng -74.26 to -73.70, lat 40.48 to 40.92)
  for (const feature of data.features ?? []) {
    const [lng, lat] = feature.center as [number, number];
    if (lng >= -74.26 && lng <= -73.70 && lat >= 40.48 && lat <= 40.92) {
      return { lat, lng };
    }
  }
  return null;
}

/** Returns true if the address starts with a street number, e.g. "505 Manhattan Ave". */
function isStreetAddress(addr: string): boolean {
  return /^\d+/.test(addr.trim());
}

async function geocode(address: string, proximity?: Coordinates): Promise<Coordinates> {
  if (!MAPBOX_TOKEN) throw new Error("NEXT_PUBLIC_MAPBOX_TOKEN is not configured");

  const prox = proximity
    ? `&proximity=${proximity.lng},${proximity.lat}`
    : "&proximity=-73.9624,40.8075"; // Default: Columbia University area

  const cleaned = cleanAddress(address);
  const firstPart = cleaned.split(",")[0].trim();

  // Strategy differs by whether the address is a street number or a named POI:
  //
  // Street addresses ("505 Manhattan Ave", "665 W 130th St"):
  //   Append ", New York, NY" so Mapbox picks Manhattan over Brooklyn/NJ streets
  //   that share the same name. Fall back to bare + bbox if that fails.
  //
  // Named POIs ("Columbia University", "Times Square"):
  //   Append " NYC" — short suffix that hints city context without triggering
  //   the city-fallback bug. Never append "Manhattan, New York" — Mapbox
  //   interprets that as a place qualifier and returns the city centroid.
  const candidates: string[] = isStreetAddress(firstPart)
    ? [
        `${cleaned}, New York, NY`,
        `${cleaned}, New York City`,
        cleaned,
      ]
    : [
        `${firstPart} NYC`,
        `${cleaned} NYC`,
        firstPart,
        cleaned,
      ];

  for (const candidate of candidates) {
    const result = await tryGeocode(candidate, prox);
    if (result) return result;
  }

  // Mapbox exhausted — try Nominatim (OpenStreetMap).
  // Nominatim is better at named institutions that Mapbox doesn't index as POIs.
  const nominatimResult = await geocodeViaNominatim(cleaned);
  if (nominatimResult) return nominatimResult;

  throw new Error(`Could not find "${address}" in NYC — try a more specific address`);
}

// Nominatim fallback: handles institution names Mapbox misses.
// Uses a NYC-bounded viewbox and a 4-second timeout so it can't stall routing.
async function geocodeViaNominatim(address: string): Promise<Coordinates | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    // Nominatim viewbox: west,north,east,south
    const viewbox = "-74.259,40.917,-73.700,40.477";
    const q = encodeURIComponent(`${address} New York`);
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${q}&format=json&limit=1&countrycodes=us&viewbox=${viewbox}&bounded=1`;

    const res = await fetch(url, {
      headers: { "User-Agent": "SafeWalkNYC/1.0 (contact@safewalk.nyc)" },
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (!data[0]) return null;

    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Step 3 – Fetch up to 3 walking routes from Mapbox Directions
// ---------------------------------------------------------------------------

/**
 * Fetch a single Mapbox walking route, optionally with one forced waypoint.
 * Returns null if the request fails or no route is found.
 */
async function fetchOneRoute(
  origin: Coordinates,
  dest: Coordinates,
  via?: Coordinates
): Promise<MapboxRoute | null> {
  if (!MAPBOX_TOKEN) return null;

  const waypoints = via
    ? `${origin.lng},${origin.lat};${via.lng},${via.lat};${dest.lng},${dest.lat}`
    : `${origin.lng},${origin.lat};${dest.lng},${dest.lat}`;

  const url =
    `${MAPBOX_BASE}/directions/v5/mapbox/walking/${waypoints}` +
    `?alternatives=false&geometries=geojson&steps=true&overview=full` +
    `&access_token=${MAPBOX_TOKEN}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.routes as MapboxRoute[])?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Compute two waypoints perpendicular to the origin→dest vector, offset by
 * ~3–4 Manhattan blocks (~350 m).  For a mostly north–south trip this gives
 * one route shifted east (different avenues) and one shifted west.
 */
function perpendicularWaypoints(
  origin: Coordinates,
  dest: Coordinates
): [Coordinates, Coordinates] {
  const dlng = dest.lng - origin.lng;
  const dlat = dest.lat - origin.lat;

  // Perpendicular unit vector (rotate 90°): (-dlat, dlng)
  const len = Math.sqrt(dlng * dlng + dlat * dlat) || 1;
  const perpLng = -dlat / len;
  const perpLat =  dlng / len;

  // Scale: 0.012° ≈ 1 km — forces a meaningfully different corridor in Manhattan
  const OFFSET = 0.012;

  const midLng = (origin.lng + dest.lng) / 2;
  const midLat = (origin.lat + dest.lat) / 2;

  return [
    { lng: midLng + perpLng * OFFSET, lat: midLat + perpLat * OFFSET },
    { lng: midLng - perpLng * OFFSET, lat: midLat - perpLat * OFFSET },
  ];
}

/**
 * Returns up to 3 meaningfully different walking routes between two points.
 *
 * Mapbox walking directions rarely returns alternatives for NYC grid streets,
 * so we generate three routes explicitly:
 *   Route 1 – direct (no waypoint)
 *   Route 2 – via midpoint shifted ~3 blocks in one perpendicular direction
 *   Route 3 – via midpoint shifted ~3 blocks in the opposite direction
 *
 * Duplicate paths (same dominant street) are dropped so we never show
 * redundant routes.
 */
async function getWalkingRoutes(
  origin: Coordinates,
  dest: Coordinates
): Promise<MapboxRoute[]> {
  if (!MAPBOX_TOKEN) throw new Error("NEXT_PUBLIC_MAPBOX_TOKEN is not configured");

  const [wpA, wpB] = perpendicularWaypoints(origin, dest);

  // Fetch all three in parallel
  const [direct, altA, altB] = await Promise.all([
    fetchOneRoute(origin, dest),
    fetchOneRoute(origin, dest, wpA),
    fetchOneRoute(origin, dest, wpB),
  ]);

  if (!direct) throw new Error("No walking route found between these locations");

  // Deduplicate: two routes are the same if they share the same 2nd-most-travelled
  // street AND are within 5% of each other in distance.
  // (The 1st street is often shared — e.g. Broadway for all Manhattan N-S routes.)
  function routeKey(r: MapboxRoute): string {
    const dist: Record<string, number> = {};
    for (const step of r.legs[0]?.steps ?? []) {
      if (step.name) dist[step.name] = (dist[step.name] ?? 0) + step.distance;
    }
    const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1]);
    // Use the 2nd-most-prominent street as the key, fall back to 1st
    const key2nd = sorted[1]?.[0] ?? sorted[0]?.[0] ?? "";
    // Bucket distance to 0.1 mi granularity
    const distBucket = Math.round(r.distance / 160);
    return `${key2nd}|${distBucket}`;
  }

  const seen = new Set<string>();
  const routes: MapboxRoute[] = [];

  for (const r of [direct, altA, altB]) {
    if (!r) continue;
    const key = routeKey(r);
    if (!seen.has(key)) {
      seen.add(key);
      routes.push(r);
    }
  }

  return routes; // 1–3 routes
}

// ---------------------------------------------------------------------------
// Step 4 – Split a Mapbox route into ~200 m RouteSegments
// ---------------------------------------------------------------------------

/** Street-distance map for a route's steps. */
function streetDistances(steps: MapboxStep[]): Record<string, number> {
  const d: Record<string, number> = {};
  for (const step of steps) {
    if (step.name) d[step.name] = (d[step.name] ?? 0) + step.distance;
  }
  return d;
}

/**
 * Assign human-readable labels to a set of routes.
 * Each route gets a "via X" label where X is its most distinctive street
 * (the one with the most distance NOT shared by other routes).
 * Falls back to ordinal suffixes if all routes share every street.
 */
function assignRouteLabels(allSteps: MapboxStep[][]): string[] {
  const distMaps = allSteps.map(streetDistances);

  // For each route, compute how much distance each street contributes
  // that NO other route has (uniqueness score).
  return distMaps.map((dm, i) => {
    let bestStreet = "";
    let bestUnique = -1;

    for (const [street, dist] of Object.entries(dm)) {
      const sharedMax = Math.max(
        0,
        ...distMaps
          .filter((_, j) => j !== i)
          .map((other) => other[street] ?? 0)
      );
      const unique = dist - sharedMax;
      if (unique > bestUnique) {
        bestUnique = unique;
        bestStreet = street;
      }
    }

    return bestStreet ? `via ${bestStreet}` : `Route ${i + 1}`;
  });
}

function buildSegments(steps: MapboxStep[]): RouteSegment[] {
  const segments: RouteSegment[] = [];
  let coords: [number, number][] = [];
  let distM = 0;
  let durationS = 0;
  let streetName = "";

  function flush() {
    if (coords.length < 2) return;
    const first = coords[0];
    const last = coords[coords.length - 1];
    segments.push({
      startCoords: { lat: first[1], lng: first[0] },
      endCoords: { lat: last[1], lng: last[0] },
      distanceMiles: distM / 1609.344,
      durationMinutes: durationS / 60,
      streetName: streetName || undefined,
      geometry: { type: "LineString", coordinates: [...coords] },
    });
    coords = [last]; // next segment begins at current end
    distM = 0;
    durationS = 0;
  }

  for (const step of steps) {
    if (step.name) streetName = step.name;

    for (const c of step.geometry.coordinates) {
      const last = coords[coords.length - 1];
      // Skip duplicate endpoints where adjacent steps share a coordinate
      if (!last || c[0] !== last[0] || c[1] !== last[1]) coords.push(c);
    }

    distM += step.distance;
    durationS += step.duration;

    if (distM >= SEGMENT_TARGET_M) flush();
  }

  if (distM > 0 && coords.length >= 2) flush(); // trailing partial segment

  return segments;
}

// ---------------------------------------------------------------------------
// Step 5 – Enrich one segment with NYC Open Data
// ---------------------------------------------------------------------------

async function enrichSegment(segment: RouteSegment): Promise<RouteSegment> {
  const mid: Coordinates = {
    lat: (segment.startCoords.lat + segment.endCoords.lat) / 2,
    lng: (segment.startCoords.lng + segment.endCoords.lng) / 2,
  };

  // All three fetches in parallel; each degrades to [] on failure
  const [crimeRes, lightRes, signalRes] = await Promise.allSettled([
    fetchCrimeData(mid.lat, mid.lng, 250, 90),
    fetchStreetlightComplaints(mid.lat, mid.lng, 150),
    fetchTrafficSignals(mid.lat, mid.lng, 150),
  ]);

  return {
    ...segment,
    crimes:                crimeRes.status  === "fulfilled" ? crimeRes.value  : [],
    streetlightComplaints: lightRes.status  === "fulfilled" ? lightRes.value  : [],
    trafficSignals:        signalRes.status === "fulfilled" ? signalRes.value : [],
  };
}

// ---------------------------------------------------------------------------
// Step 7 – Claude explanation comparing routes
// ---------------------------------------------------------------------------

async function generateExplanation(
  client: Anthropic,
  routes: ScoredRoute[],
  recommendedIdx: number,
  originalMessage: string,
  timeOfDay: number
): Promise<string> {
  const hour = timeOfDay === -1 ? new Date().getHours() : timeOfDay;
  const timeLabel = new Date(0, 0, 0, hour).toLocaleTimeString("en-US", {
    hour: "numeric",
    hour12: true,
  });

  const summaries = routes
    .map((r, i) => {
      const tag = i === recommendedIdx ? " ✓ RECOMMENDED" : "";
      return (
        `Route ${i + 1} (${r.label})${tag}:\n` +
        `  Score: ${r.score}/100 — ${scoreLabel(r.score).label}\n` +
        `  ${r.distanceMiles.toFixed(2)} mi · ${Math.round(r.durationMinutes)} min\n` +
        `  Crime incidents nearby: ${r.crimeCount}\n` +
        `  Open streetlight complaints: ${r.lightingIssues}\n` +
        `  Worst block: ${r.worstStreet || "unknown"}`
      );
    })
    .join("\n\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          `User asked: "${originalMessage}"\nTime: ${timeLabel}\n\n` +
          `${summaries}\n\n` +
          `Write 2–3 sentences recommending Route ${recommendedIdx + 1}. ` +
          `Compare it to the others by name, citing specific safety factors ` +
          `(crime counts, lighting, worst block). Be direct and practical.`,
      },
    ],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : "Route analysis complete.";
}

// ---------------------------------------------------------------------------
// POST /api/score-route
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const body = (await req.json()) as {
      message: string;
      userLocation?: Coordinates;
    };

    const { message, userLocation } = body;
    if (!message?.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    // ── 1. Parse intent ────────────────────────────────────────────────────
    let intent: ParsedIntent;
    try {
      intent = await parseIntent(client, message, userLocation);
    } catch (err) {
      return NextResponse.json(
        { error: `Could not understand route request: ${(err as Error).message}` },
        { status: 400 }
      );
    }

    const timeOfDay =
      intent.timeOfDay === -1
        ? new Date(
            new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
          ).getHours()
        : intent.timeOfDay;

    // ── 2. Geocode ─────────────────────────────────────────────────────────
    let originCoords: Coordinates;
    let destinationCoords: Coordinates;

    try {
      // If the user said "from here" and GPS is available, skip geocoding for origin
      const originPromise: Promise<Coordinates> =
        userLocation &&
        /\b(here|my location|current location|where i am)\b/i.test(message)
          ? Promise.resolve(userLocation)
          : geocode(intent.originAddress, userLocation);

      [originCoords, destinationCoords] = await Promise.all([
        originPromise,
        geocode(intent.destinationAddress, userLocation),
      ]);
    } catch (err) {
      return NextResponse.json(
        { error: `Geocoding failed: ${(err as Error).message}` },
        { status: 400 }
      );
    }

    // ── 3. Fetch walking routes ────────────────────────────────────────────
    let mapboxRoutes: MapboxRoute[];
    try {
      mapboxRoutes = await getWalkingRoutes(originCoords, destinationCoords);
    } catch (err) {
      return NextResponse.json(
        { error: `Could not find walking routes: ${(err as Error).message}` },
        { status: 400 }
      );
    }

    // ── 4–6. Score each route ──────────────────────────────────────────────
    // Compute distinguishing labels across all routes before scoring
    const allSteps = mapboxRoutes.map((r) => r.legs[0]?.steps ?? []);
    const routeLabels = assignRouteLabels(allSteps);

    const scoredRoutes: ScoredRoute[] = await Promise.all(
      mapboxRoutes.map(async (mRoute, routeIdx): Promise<ScoredRoute> => {
        const steps = mRoute.legs[0]?.steps ?? [];
        const label = routeLabels[routeIdx];

        // 4. Segment splitting
        let rawSegments = buildSegments(steps);
        if (rawSegments.length === 0) {
          // Degenerate fallback: treat whole route as one segment
          const c = mRoute.geometry.coordinates;
          rawSegments = [
            {
              startCoords: { lat: c[0][1], lng: c[0][0] },
              endCoords: { lat: c[c.length - 1][1], lng: c[c.length - 1][0] },
              distanceMiles: mRoute.distance / 1609.344,
              durationMinutes: mRoute.duration / 60,
              geometry: mRoute.geometry,
            },
          ];
        }

        // 5a. Enrich segments with NYC Open Data (all in parallel, fail-safe)
        const enriched = await Promise.all(rawSegments.map(enrichSegment));

        // 5b. Linkup news — fetched once at the route midpoint
        const midSeg = enriched[Math.floor(enriched.length / 2)];
        const midLat = (midSeg.startCoords.lat + midSeg.endCoords.lat) / 2;
        const midLng = (midSeg.startCoords.lng + midSeg.endCoords.lng) / 2;
        const newsItems = await searchLocalContext(midLat, midLng).catch(() => []);
        const newsPenalty = computeNewsPenalty(newsItems);

        // Attach shared news penalty to every segment
        const segmentsWithNews = enriched.map((s) => ({ ...s, newsPenalty }));

        // 6. Score
        const routeScore = scoreRoute(segmentsWithNews, timeOfDay);
        const enrichedFinal: EnrichedSegment[] = segmentsWithNews.map((s) => ({
          ...s,
          segmentScore: scoreSegment(s, timeOfDay),
        }));

        // Aggregate stats for the explanation prompt
        const crimeCount = enriched.reduce(
          (n, s) => n + (s.crimes?.length ?? 0),
          0
        );
        const lightingIssues = enriched.reduce(
          (n, s) =>
            n +
            (s.streetlightComplaints?.filter((r) =>
              r.status?.toLowerCase().includes("open")
            ).length ?? 0),
          0
        );

        return {
          path: mRoute.geometry,
          score: routeScore.overall,
          distanceMiles: mRoute.distance / 1609.344,
          durationMinutes: mRoute.duration / 60,
          label,
          segments: enrichedFinal,
          worstStreet: routeScore.worstSegment.streetName ?? "",
          crimeCount,
          lightingIssues,
        };
      })
    );

    // Pick recommended: highest safety score; break ties by shortest distance
    const recommendedIdx = scoredRoutes.reduce((best, r, i) => {
      const b = scoredRoutes[best];
      if (r.score > b.score) return i;
      if (r.score === b.score && r.distanceMiles < b.distanceMiles) return i;
      return best;
    }, 0);

    // ── 7. Generate natural-language explanation ───────────────────────────
    const explanation = await generateExplanation(
      client,
      scoredRoutes,
      recommendedIdx,
      message,
      timeOfDay
    ).catch(() => "Route analysis complete. See individual scores for details.");

    // ── 8. Return ──────────────────────────────────────────────────────────
    return NextResponse.json({
      routes: scoredRoutes.map((r) => ({
        path: r.path,
        score: r.score,
        scoreLabel: scoreLabel(r.score),
        distanceMiles: parseFloat(r.distanceMiles.toFixed(2)),
        durationMinutes: Math.round(r.durationMinutes),
        label: r.label,
        segments: r.segments.map((s) => ({
          startCoords: s.startCoords,
          endCoords: s.endCoords,
          streetName: s.streetName ?? null,
          distanceMiles: parseFloat(s.distanceMiles.toFixed(3)),
          score: s.segmentScore.overall,
          crimePenalty: s.segmentScore.crimePenalty,
          lightingPenalty: s.segmentScore.lightingPenalty,
          trafficSignalPenalty: s.segmentScore.trafficSignalPenalty,
          newsPenalty: s.segmentScore.newsPenalty,
          crimeCount: s.crimes?.length ?? 0,
          openLightingIssues:
            s.streetlightComplaints?.filter((c) =>
              c.status?.toLowerCase().includes("open")
            ).length ?? 0,
          nearbySignals: s.trafficSignals?.length ?? 0,
        })),
      })),
      recommended: recommendedIdx,
      explanation,
      origin: originCoords,
      destination: destinationCoords,
      timeOfDay,
      parsedIntent: {
        originAddress: intent.originAddress,
        destinationAddress: intent.destinationAddress,
        preference: intent.preference,
      },
    });
  } catch (err) {
    console.error("[score-route]", err);
    return NextResponse.json(
      { error: "Route scoring failed. Please try again." },
      { status: 500 }
    );
  }
}
