"use client";

import { useState, useCallback } from "react";
import { Shield, ChevronLeft } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import ChatInput from "@/components/ChatInput";
import RouteCard from "@/components/RouteCard";
import AlertButton from "@/components/AlertButton";
import { Route, Coordinates, SafetyScore } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

// ---------------------------------------------------------------------------
// Types matching the /api/score-route response
// ---------------------------------------------------------------------------

interface ApiSegment {
  startCoords: Coordinates;
  endCoords: Coordinates;
  streetName: string | null;
  score: number;
  crimePenalty: number;
  lightingPenalty: number;
  trafficSignalPenalty: number;
  newsPenalty: number;
  crimeCount: number;
  openLightingIssues: number;
  nearbySignals: number;
}

interface ApiRoute {
  path: GeoJSON.LineString;
  score: number;
  scoreLabel: { label: string; color: string };
  distanceMiles: number;
  durationMinutes: number;
  label: string;
  segments: ApiSegment[];
}

interface ApiResponse {
  routes: ApiRoute[];
  recommended: number;
  explanation: string;
  origin: Coordinates;
  destination: Coordinates;
  timeOfDay: number;
  parsedIntent: { originAddress: string; destinationAddress: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSafetyScore(apiRoute: ApiRoute): SafetyScore {
  const segs = apiRoute.segments;
  const n = Math.max(1, segs.length);

  const avgCrime    = segs.reduce((s, g) => s + g.crimePenalty,         0) / n;
  const avgLighting = segs.reduce((s, g) => s + g.lightingPenalty,      0) / n;
  const avgTraffic  = segs.reduce((s, g) => s + g.trafficSignalPenalty, 0) / n;
  const recentCrimes = segs.reduce((s, g) => s + g.crimeCount,          0);

  const crimeIndex           = Math.max(0, Math.min(100, Math.round(100 - avgCrime    * 0.7)));
  const lightingIndex        = Math.max(0, Math.min(100, Math.round(100 - avgLighting * 0.5)));
  const trafficSignalDensity = Math.max(0, Math.min(100, Math.round(100 - avgTraffic  * 3.0)));

  return {
    overall: apiRoute.score,
    crimeIndex,
    lightingIndex,
    trafficSignalDensity,
    recentIncidents: recentCrimes,
    breakdown: {
      crimeWeight: 0.35,
      lightingWeight: 0.25,
      trafficWeight: 0.15,
      incidentWeight: 0.10,
      explanation: `${apiRoute.label} — safety score ${apiRoute.score}/100.`,
    },
  };
}

function apiRouteToRoute(
  apiRoute: ApiRoute,
  idx: number,
  origin: Coordinates,
  destination: Coordinates,
  parsedIntent: ApiResponse["parsedIntent"]
): Route {
  const coords = apiRoute.path.coordinates as [number, number][];
  const waypoints: Coordinates[] = coords.map(([lng, lat]) => ({ lat, lng }));

  return {
    id: `route-${idx}-${Date.now()}`,
    origin: parsedIntent.originAddress,
    destination: parsedIntent.destinationAddress,
    originCoords: origin,
    destinationCoords: destination,
    waypoints,
    distanceMiles: apiRoute.distanceMiles,
    durationMinutes: apiRoute.durationMinutes,
    safetyScore: buildSafetyScore(apiRoute),
    geometry: apiRoute.path,
  };
}

/** Build a brief plain-text note for a route from its safety data (no extra API call). */
function buildRouteNote(apiRoute: ApiRoute): string {
  const segs = apiRoute.segments;
  const totalCrimes  = segs.reduce((n, s) => n + s.crimeCount, 0);
  const totalLighting = segs.reduce((n, s) => n + s.openLightingIssues, 0);
  const avgSignals   = segs.reduce((n, s) => n + s.nearbySignals, 0) / Math.max(1, segs.length);

  const parts: string[] = [];

  if (totalCrimes === 0)       parts.push("No nearby crime incidents");
  else if (totalCrimes <= 3)   parts.push(`${totalCrimes} nearby crime incident${totalCrimes > 1 ? "s" : ""}`);
  else                         parts.push(`${totalCrimes} crime incidents nearby — use caution`);

  if (totalLighting === 0)     parts.push("good street lighting");
  else if (totalLighting <= 2) parts.push(`${totalLighting} open lighting complaint${totalLighting > 1 ? "s" : ""}`);
  else                         parts.push(`${totalLighting} lighting issues reported`);

  if (avgSignals >= 2)         parts.push("frequent pedestrian signals");
  else if (avgSignals >= 1)    parts.push("some pedestrian signals");
  else                         parts.push("few traffic signals");

  return parts.join(" · ") + ".";
}

// Strip "via " prefix to get a clean label for display
function extractViaLabel(breakdownExplanation: string): string {
  const part = breakdownExplanation.split(" — ")[0]; // "via Broadway"
  return part.startsWith("via ") ? part.slice(4) : part;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RoutePlannerPage() {
  const [routes, setRoutes]           = useState<Route[]>([]);
  const [apiRoutes, setApiRoutes]     = useState<ApiRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [explanations, setExplanations]   = useState<Record<string, string>>({});
  const [recommendedId, setRecommendedId] = useState<string | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const handleRouteExtracted = useCallback(
    async (origin: string, destination: string) => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/score-route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: `Walk me from ${origin} to ${destination}` }),
        });

        const data: ApiResponse & { error?: string } = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Route scoring failed");

        const mapped: Route[] = data.routes.map((r, i) =>
          apiRouteToRoute(r, i, data.origin, data.destination, data.parsedIntent)
        );

        // Build explanations map:
        //  - recommended route → full Claude explanation
        //  - all others        → auto-generated note from safety data
        const expMap: Record<string, string> = {};
        data.routes.forEach((apiRoute, i) => {
          const route = mapped[i];
          if (i === data.recommended && data.explanation) {
            expMap[route.id] = data.explanation;
          } else {
            expMap[route.id] = buildRouteNote(apiRoute);
          }
        });

        setRoutes(mapped);
        setApiRoutes(data.routes);
        setSelectedRoute(mapped[data.recommended] ?? mapped[0] ?? null);
        setExplanations(expMap);
        setRecommendedId(mapped[data.recommended]?.id ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
        <Link href="/" className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
          <ChevronLeft className="w-5 h-5 text-gray-400" />
        </Link>
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-400" />
          <span className="font-semibold">SafeWalk NYC</span>
        </div>
        <div className="ml-auto">
          <AlertButton
            currentRoute={
              selectedRoute
                ? { origin: selectedRoute.origin, destination: selectedRoute.destination }
                : undefined
            }
          />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 shrink-0 flex flex-col gap-4 p-4 border-r border-white/10 overflow-y-auto">
          <div>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
              Plan your route
            </h2>
            <ChatInput
              onRouteExtracted={handleRouteExtracted}
              placeholder="Where do you want to go tonight?"
            />
          </div>

          {loading && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
              Scoring routes with live NYC data…
            </div>
          )}

          {error && (
            <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
              {error}
            </div>
          )}

          {routes.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                {routes.length} route{routes.length > 1 ? "s" : ""} found
              </h2>

              {routes.map((route, i) => {
                const viaLabel = extractViaLabel(
                  route.safetyScore.breakdown.explanation
                );
                return (
                  <RouteCard
                    key={route.id}
                    route={route}
                    routeNumber={i + 1}
                    viaLabel={viaLabel}
                    isSelected={selectedRoute?.id === route.id}
                    isRecommended={route.id === recommendedId}
                    onSelect={setSelectedRoute}
                    explanation={explanations[route.id]}
                  />
                );
              })}
            </div>
          )}

          {routes.length === 0 && !loading && (
            <div className="text-center py-10 text-gray-600 text-sm">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p>Type a destination to see safe route options.</p>
            </div>
          )}
        </aside>

        {/* Map */}
        <main className="flex-1 relative">
          <MapView
            routes={routes}
            selectedRoute={selectedRoute}
            className="w-full h-full"
          />
        </main>
      </div>
    </div>
  );
}
