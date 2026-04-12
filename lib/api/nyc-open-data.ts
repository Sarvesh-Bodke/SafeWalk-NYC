import { CrimeIncident, TrafficSignal, ThreeOneOneReport, Coordinates } from "../types";

// ---------------------------------------------------------------------------
// Socrata endpoints
// ---------------------------------------------------------------------------

const BASE = "https://data.cityofnewyork.us/resource";

const ENDPOINTS = {
  crime:          `${BASE}/5uac-w243.json`, // NYPD Complaint Data (Current Year)
  threeOneOne:    `${BASE}/erm2-nwe9.json`, // 311 Service Requests
  trafficSignals: `${BASE}/e5mv-wy8f.json`, // Traffic Signals
} as const;

// ---------------------------------------------------------------------------
// Shared query helpers
// ---------------------------------------------------------------------------

/**
 * Converts a lat/lng + radius in metres into a SoQL bounding-box predicate.
 * All three endpoints expose `latitude` / `longitude` columns, so this avoids
 * needing to know the point-column name for `within_circle`.
 */
function bboxWhere(lat: number, lng: number, radiusMeters: number): string {
  const deltaLat = radiusMeters / 111_320;
  const deltaLng = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return (
    `latitude  > '${lat - deltaLat}'  AND latitude  < '${lat + deltaLat}' AND ` +
    `longitude > '${lng - deltaLng}' AND longitude < '${lng + deltaLng}'`
  );
}

/** ISO-8601 date string for (now - daysBack days). */
function isoDateBefore(daysBack: number): string {
  return new Date(Date.now() - daysBack * 86_400_000).toISOString();
}

async function socrataFetch(url: string, revalidate: number): Promise<unknown[]> {
  const res = await fetch(url, { next: { revalidate } });
  if (!res.ok) {
    throw new Error(`Socrata fetch failed ${res.status}: ${url}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// fetchCrimeData
// ---------------------------------------------------------------------------

/**
 * Fetch NYPD complaint records within `radiusMeters` of (lat, lng)
 * from the last `daysBack` days.
 *
 * Severity tier is stored in the `law_cat_cd` field:
 *   FELONY | MISDEMEANOR | VIOLATION
 */
export async function fetchCrimeData(
  lat: number,
  lng: number,
  radiusMeters: number,
  daysBack: number
): Promise<CrimeIncident[]> {
  const dateFilter = `cmplnt_fr_dt >= '${isoDateBefore(daysBack)}'`;
  const where = `${bboxWhere(lat, lng, radiusMeters)} AND ${dateFilter}`;
  const params = new URLSearchParams({
    $where: where,
    $limit: "200",
    $order: "cmplnt_fr_dt DESC",
  });

  const rows = await socrataFetch(
    `${ENDPOINTS.crime}?${params}`,
    3_600 // revalidate every hour
  ) as Record<string, string>[];

  return rows.map((row) => ({
    id: row.cmplnt_num ?? row.objectid,
    type: row.law_cat_cd ?? row.ofns_desc ?? "UNKNOWN", // law_cat_cd = FELONY/MISDEMEANOR/VIOLATION
    description: row.ofns_desc ?? row.pd_desc ?? "",
    coordinates: {
      lat: parseFloat(row.latitude),
      lng: parseFloat(row.longitude),
    },
    date: row.cmplnt_fr_dt ?? "",
    borough: row.boro_nm ?? "",
    precinct: parseInt(row.addr_pct_cd ?? "0", 10),
  }));
}

// ---------------------------------------------------------------------------
// fetchStreetlightComplaints
// ---------------------------------------------------------------------------

/**
 * Fetch open 311 streetlight complaints within `radiusMeters` of (lat, lng).
 * Only pulls complaint_type = 'Street Light Condition'.
 */
export async function fetchStreetlightComplaints(
  lat: number,
  lng: number,
  radiusMeters: number
): Promise<ThreeOneOneReport[]> {
  const where =
    `${bboxWhere(lat, lng, radiusMeters)} AND ` +
    `complaint_type = 'Street Light Condition'`;
  const params = new URLSearchParams({
    $where: where,
    $limit: "100",
    $order: "created_date DESC",
  });

  const rows = await socrataFetch(
    `${ENDPOINTS.threeOneOne}?${params}`,
    3_600
  ) as Record<string, string>[];

  return rows.map((row) => ({
    id: row.unique_key,
    type: row.complaint_type,
    description: row.descriptor ?? "",
    coordinates: {
      lat: parseFloat(row.latitude),
      lng: parseFloat(row.longitude),
    },
    date: row.created_date,
    status: row.status,
  }));
}

// ---------------------------------------------------------------------------
// fetchTrafficSignals  (updated endpoint: e5mv-wy8f)
// ---------------------------------------------------------------------------

/**
 * Fetch traffic signals within `radiusMeters` of (lat, lng).
 * Sets `pedestrianExclusive: true` when the signal type indicates a
 * pedestrian-only phase (LPI / PED SIGNAL / EXCLUSIVE).
 */
export async function fetchTrafficSignals(
  lat: number,
  lng: number,
  radiusMeters: number
): Promise<TrafficSignal[]> {
  const where = bboxWhere(lat, lng, radiusMeters);
  const params = new URLSearchParams({
    $where: where,
    $limit: "300",
  });

  const rows = await socrataFetch(
    `${ENDPOINTS.trafficSignals}?${params}`,
    86_400 // revalidate daily — signals don't change often
  ) as Record<string, string>[];

  return rows.map((row) => {
    const rawType = (row.signal_type ?? row.type ?? "STANDARD").toUpperCase();
    const pedestrianExclusive =
      rawType.includes("PED") ||
      rawType.includes("LPI") ||
      rawType.includes("EXCLUSIVE");
    return {
      id: row.objectid ?? row.nodeid ?? row.node_id ?? "",
      coordinates: {
        lat: parseFloat(row.latitude ?? row.lat),
        lng: parseFloat(row.longitude ?? row.lng),
      },
      type: rawType,
      pedestrianExclusive,
    };
  });
}

// ---------------------------------------------------------------------------
// fetchRouteAreaData  (used by app/api/score-route)
// ---------------------------------------------------------------------------

const SAMPLE_RADIUS_M = 300;
const CRIME_DAYS_BACK = 90;

export async function fetchRouteAreaData(waypoints: Coordinates[]) {
  // Sample at most 5 evenly-spaced waypoints to limit API calls
  const step = Math.max(1, Math.floor(waypoints.length / 5));
  const samplePoints = waypoints.filter((_, i) => i % step === 0);

  type AreaData = {
    point: Coordinates;
    crimes: CrimeIncident[];
    signals: TrafficSignal[];
    streetLights: ThreeOneOneReport[];
  };

  const results = await Promise.allSettled(
    samplePoints.map(async (point): Promise<AreaData> => {
      const [crimes, signals, streetLights] = await Promise.all([
        fetchCrimeData(point.lat, point.lng, SAMPLE_RADIUS_M, CRIME_DAYS_BACK),
        fetchTrafficSignals(point.lat, point.lng, SAMPLE_RADIUS_M),
        fetchStreetlightComplaints(point.lat, point.lng, SAMPLE_RADIUS_M),
      ]);
      return { point, crimes, signals, streetLights };
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<AreaData> => r.status === "fulfilled")
    .map((r) => r.value);
}

// ---------------------------------------------------------------------------
// Legacy named exports kept for backward compatibility
// ---------------------------------------------------------------------------

/** @deprecated Use fetchCrimeData instead. */
export async function fetchCrimeIncidents(
  coords: Coordinates,
  radiusMiles = 0.5,
  limit = 50
): Promise<CrimeIncident[]> {
  return fetchCrimeData(coords.lat, coords.lng, radiusMiles * 1609.344, 90).then((r) =>
    r.slice(0, limit)
  );
}

/** @deprecated Use fetchStreetlightComplaints instead. */
export async function fetchThreeOneOneReports(
  coords: Coordinates,
  radiusMiles = 0.5
): Promise<ThreeOneOneReport[]> {
  return fetchStreetlightComplaints(coords.lat, coords.lng, radiusMiles * 1609.344);
}
