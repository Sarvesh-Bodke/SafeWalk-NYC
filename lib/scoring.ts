import {
  CrimeIncident,
  TrafficSignal,
  ThreeOneOneReport,
  SafetyScore,
  Coordinates,
  RouteSegment,
} from "./types";

// ---------------------------------------------------------------------------
// Shared geometry helpers
// ---------------------------------------------------------------------------

/** Returns distance between two points in miles. */
function haversineMiles(a: Coordinates, b: Coordinates): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(s));
}

/** Returns distance between two points in metres. */
function haversineMeters(a: Coordinates, b: Coordinates): number {
  return haversineMiles(a, b) * 1609.344;
}

function midpoint(a: Coordinates, b: Coordinates): Coordinates {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

// ---------------------------------------------------------------------------
// scoreSegment
// ---------------------------------------------------------------------------

// Crime severity weights (felony=10, misdemeanor=5, violation=2)
const CRIME_SEVERITY: Record<string, number> = {
  FELONY: 10,
  MISDEMEANOR: 5,
  VIOLATION: 2,
};

// Maps raw law-category strings from NYPD data to severity tiers
function resolveSeverity(lawCatCd: string): number {
  const tier = lawCatCd?.toUpperCase();
  return CRIME_SEVERITY[tier] ?? 2; // Default to violation weight for unknowns
}

function cutoffDate(daysBack: number): Date {
  return new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
}

function computeCrimePenalty(
  crimes: CrimeIncident[],
  ref: Coordinates,
  radiusMeters = 200,
  daysBack = 90
): number {
  const cutoff = cutoffDate(daysBack);
  let penalty = 0;
  for (const c of crimes) {
    if (haversineMeters(ref, c.coordinates) > radiusMeters) continue;
    if (c.date && new Date(c.date) < cutoff) continue;
    penalty += resolveSeverity(c.type);
  }
  return penalty;
}

function computeLightingPenalty(
  complaints: ThreeOneOneReport[],
  ref: Coordinates,
  radiusMeters = 100
): number {
  let openCount = 0;
  for (const r of complaints) {
    if (haversineMeters(ref, r.coordinates) > radiusMeters) continue;
    if (r.status?.toLowerCase().includes("open")) openCount++;
  }
  return openCount * 8;
}

function computeTrafficSignalPenalty(
  signals: TrafficSignal[],
  ref: Coordinates,
  radiusMeters = 150
): number {
  const nearby = signals.filter(
    (s) => haversineMeters(ref, s.coordinates) <= radiusMeters
  );

  let penalty: number;
  if (nearby.length >= 2) penalty = 0;
  else if (nearby.length === 1) penalty = 5;
  else penalty = 15;

  // Bonus: -5 if any nearby signal is pedestrian-exclusive
  const hasPedExclusive = nearby.some((s) => s.pedestrianExclusive);
  if (hasPedExclusive) penalty -= 5;

  return penalty;
}

/**
 * Time-of-day modifier:
 *   06:00–20:00 → 1.0
 *   20:00–24:00 → 1.5
 *   00:00–04:00 → 2.0
 *   04:00–06:00 → 1.3
 */
function timeModifier(hour: number): number {
  if (hour >= 6 && hour < 20) return 1.0;
  if (hour >= 20 && hour < 24) return 1.5;
  if (hour >= 0 && hour < 4) return 2.0;
  return 1.3; // 04:00–06:00
}

export interface SegmentScore {
  overall: number; // 0–100
  crimePenalty: number;
  lightingPenalty: number;
  trafficSignalPenalty: number;
  newsPenalty: number;
  timeModifier: number;
}

/**
 * Score a single route segment on a 0–100 scale.
 *
 * Formula:
 *   score = 100 − (crime_penalty × 0.35 + lighting_penalty × 0.25
 *                  + signal_penalty × 0.15 + news_penalty × 0.10)
 *           × time_modifier
 *
 * Expects segment.crimes / .streetlightComplaints / .trafficSignals to be
 * pre-populated via the nyc-open-data fetch helpers.
 *
 * @param segment  Route segment with embedded NYC Open Data
 * @param timeOfDay  Current hour in 24-hour format (0–23)
 */
export function scoreSegment(segment: RouteSegment, timeOfDay: number): SegmentScore {
  const ref = midpoint(segment.startCoords, segment.endCoords);

  const crimePenalty = computeCrimePenalty(segment.crimes ?? [], ref);
  const lightingPenalty = computeLightingPenalty(segment.streetlightComplaints ?? [], ref);
  const trafficSignalPenalty = computeTrafficSignalPenalty(segment.trafficSignals ?? [], ref);
  const newsPenalty = Math.min(15, Math.max(0, segment.newsPenalty ?? 0));
  const modifier = timeModifier(timeOfDay);

  const rawPenalty =
    crimePenalty * 0.35 +
    lightingPenalty * 0.25 +
    trafficSignalPenalty * 0.15 +
    newsPenalty * 0.10;

  const overall = Math.round(Math.max(0, Math.min(100, 100 - rawPenalty * modifier)));

  return { overall, crimePenalty, lightingPenalty, trafficSignalPenalty, newsPenalty, timeModifier: modifier };
}

// ---------------------------------------------------------------------------
// scoreRoute
// ---------------------------------------------------------------------------

export interface RouteScore {
  overall: number;           // weighted average by segment length
  worstSegment: RouteSegment;
  worstSegmentIndex: number;
  worstSegmentScore: number;
  segmentScores: SegmentScore[];
}

/**
 * Score an entire route as the distance-weighted average of its segment scores.
 * Also surfaces the single worst segment so the UI can highlight it.
 */
export function scoreRoute(segments: RouteSegment[], timeOfDay: number): RouteScore {
  if (segments.length === 0) {
    throw new Error("scoreRoute requires at least one segment");
  }

  const totalDistance = segments.reduce((s, seg) => s + seg.distanceMiles, 0);
  const segmentScores = segments.map((seg) => scoreSegment(seg, timeOfDay));

  // Distance-weighted average; if all segments are length 0, fall back to simple average
  let overall: number;
  if (totalDistance === 0) {
    overall = Math.round(
      segmentScores.reduce((s, ss) => s + ss.overall, 0) / segmentScores.length
    );
  } else {
    overall = Math.round(
      segments.reduce((sum, seg, i) => {
        const weight = seg.distanceMiles / totalDistance;
        return sum + segmentScores[i].overall * weight;
      }, 0)
    );
  }

  // Worst = lowest score
  let worstIndex = 0;
  for (let i = 1; i < segmentScores.length; i++) {
    if (segmentScores[i].overall < segmentScores[worstIndex].overall) {
      worstIndex = i;
    }
  }

  return {
    overall,
    worstSegment: segments[worstIndex],
    worstSegmentIndex: worstIndex,
    worstSegmentScore: segmentScores[worstIndex].overall,
    segmentScores,
  };
}

// ---------------------------------------------------------------------------
// Legacy helpers (used by app/api/score-route/route.ts)
// ---------------------------------------------------------------------------

const LEGACY_WEIGHTS = {
  crime: 0.45,
  lighting: 0.30,
  traffic: 0.15,
  incidents: 0.10,
} as const;

/** @deprecated Prefer scoreSegment / scoreRoute for new code. */
export function computeSafetyScore(
  incidents: CrimeIncident[],
  signals: TrafficSignal[],
  streetLightIssues: ThreeOneOneReport[],
  waypoints: Coordinates[]
): SafetyScore {
  const crimeScore = legacyScoreCrime(incidents, waypoints);
  const lightingScore = legacyScoreLighting(streetLightIssues, waypoints);
  const trafficScore = legacyScoreTrafficSignals(signals, waypoints);
  const recentIncidents = incidents.filter((i) => {
    const daysAgo = i.date
      ? (Date.now() - new Date(i.date).getTime()) / (1000 * 60 * 60 * 24)
      : 999;
    return daysAgo < 7;
  }).length;

  const incidentScore = Math.max(0, 100 - recentIncidents * 15);

  const overall = Math.round(
    crimeScore * LEGACY_WEIGHTS.crime +
      lightingScore * LEGACY_WEIGHTS.lighting +
      trafficScore * LEGACY_WEIGHTS.traffic +
      incidentScore * LEGACY_WEIGHTS.incidents
  );

  return {
    overall,
    crimeIndex: crimeScore,
    lightingIndex: lightingScore,
    trafficSignalDensity: trafficScore,
    recentIncidents,
    breakdown: {
      crimeWeight: LEGACY_WEIGHTS.crime,
      lightingWeight: LEGACY_WEIGHTS.lighting,
      trafficWeight: LEGACY_WEIGHTS.traffic,
      incidentWeight: LEGACY_WEIGHTS.incidents,
      explanation: buildExplanation(crimeScore, lightingScore, trafficScore, recentIncidents),
    },
  };
}

function legacyScoreCrime(incidents: CrimeIncident[], waypoints: Coordinates[]): number {
  if (incidents.length === 0) return 100;
  const LEGACY_SEVERITY: Record<string, number> = { FELONY: 1.0, MISDEMEANOR: 0.5, VIOLATION: 0.2 };
  let total = 0;
  for (const incident of incidents) {
    const minDist = Math.min(...waypoints.map((wp) => haversineMiles(wp, incident.coordinates)));
    const proximityWeight = Math.max(0, 1 - minDist / 0.5);
    const severity = LEGACY_SEVERITY[incident.type?.toUpperCase()] ?? 0.3;
    const daysAgo = incident.date
      ? (Date.now() - new Date(incident.date).getTime()) / (1000 * 60 * 60 * 24)
      : 90;
    const recencyWeight = daysAgo < 30 ? 1.0 : daysAgo < 90 ? 0.6 : 0.3;
    total += proximityWeight * severity * recencyWeight;
  }
  return Math.round(Math.max(0, 100 - total * 10));
}

function legacyScoreLighting(reports: ThreeOneOneReport[], waypoints: Coordinates[]): number {
  if (reports.length === 0) return 85;
  let penalty = 0;
  for (const r of reports) {
    if (!r.coordinates.lat || !r.coordinates.lng) continue;
    const minDist = Math.min(...waypoints.map((wp) => haversineMiles(wp, r.coordinates)));
    const prox = Math.max(0, 1 - minDist / 0.25);
    const isOpen = r.status?.toLowerCase().includes("open") ? 1.5 : 0.5;
    penalty += prox * isOpen * 5;
  }
  return Math.max(0, Math.round(85 - penalty));
}

function legacyScoreTrafficSignals(signals: TrafficSignal[], waypoints: Coordinates[]): number {
  if (waypoints.length === 0) return 50;
  const RADIUS_MILES = 0.05;
  const covered = waypoints.filter((wp) =>
    signals.some((s) => haversineMiles(wp, s.coordinates) < RADIUS_MILES)
  ).length;
  return Math.round((covered / waypoints.length) * 100);
}

function buildExplanation(crime: number, lighting: number, traffic: number, recent: number): string {
  const parts: string[] = [];
  if (crime < 40) parts.push("high crime density");
  else if (crime < 70) parts.push("moderate crime history");
  else parts.push("low crime history");
  if (lighting < 50) parts.push("several street lighting outages reported");
  else if (lighting >= 80) parts.push("good street lighting");
  if (traffic < 30) parts.push("few pedestrian crossing signals");
  else if (traffic >= 70) parts.push("well-covered with traffic signals");
  if (recent > 0) parts.push(`${recent} incident(s) in the past week`);
  return parts.join("; ") + ".";
}

export function scoreLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "Safe", color: "green" };
  if (score >= 60) return { label: "Moderate", color: "yellow" };
  if (score >= 40) return { label: "Use Caution", color: "orange" };
  return { label: "High Risk", color: "red" };
}
