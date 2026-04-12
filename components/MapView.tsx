"use client";

import { useEffect, useRef, useState } from "react";
import { Route, Coordinates } from "@/lib/types";
import { scoreLabel } from "@/lib/scoring";

type MapboxMap = import("mapbox-gl").Map;
type MapboxMarker = import("mapbox-gl").Marker;

interface MapViewProps {
  routes?: Route[];
  selectedRoute?: Route | null;
  userLocation?: Coordinates | null;
  className?: string;
}

const NYC_CENTER: [number, number] = [-73.9857, 40.7484];

const COLOR_MAP: Record<string, string> = {
  green:  "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  red:    "#ef4444",
};

const BG_MAP: Record<string, string> = {
  green:  "#14532d",
  yellow: "#713f12",
  orange: "#7c2d12",
  red:    "#7f1d1d",
};

function removeRouteLayer(map: MapboxMap, i: number) {
  [`route-${i}`, `route-${i}-outline`].forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  });
}

export default function MapView({
  routes = [],
  selectedRoute,
  userLocation,
  className = "",
}: MapViewProps) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<MapboxMap | null>(null);
  const markersRef    = useRef<MapboxMarker[]>([]);
  const drawnCountRef = useRef(0); // how many route layers are currently on the map
  const [mapLoaded, setMapLoaded] = useState(false);

  // ── Initialize map ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) { console.warn("NEXT_PUBLIC_MAPBOX_TOKEN is not set"); return; }

    async function initMap() {
      const mapboxgl = (await import("mapbox-gl")).default;
      mapboxgl.accessToken = token!;

      const map = new mapboxgl.Map({
        container: containerRef.current!,
        style: "mapbox://styles/mapbox/dark-v11",
        center: userLocation ? [userLocation.lng, userLocation.lat] : NYC_CENTER,
        zoom: 14,
      });

      map.addControl(new mapboxgl.NavigationControl(), "top-right");
      map.addControl(
        new mapboxgl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
        }),
        "top-right"
      );

      map.on("load", () => {
        mapRef.current = map;
        setMapLoaded(true);
      });
    }

    initMap();

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [userLocation]);

  // ── Draw / update routes ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // 1. Remove all previously drawn route layers (use stored count, not new length)
    for (let i = 0; i < drawnCountRef.current; i++) {
      removeRouteLayer(map, i);
    }

    // 2. Remove all markers (score badges + origin/dest pins)
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (routes.length === 0) {
      drawnCountRef.current = 0;
      return;
    }

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;

      // 3. Draw each route polyline
      routes.forEach((route, i) => {
        const isSelected = selectedRoute?.id === route.id;
        const { color } = scoreLabel(route.safetyScore.overall);
        const lineColor  = COLOR_MAP[color] ?? "#3b82f6";
        const opacity    = isSelected ? 1 : 0.45;
        const width      = isSelected ? 6 : 3;

        map.addSource(`route-${i}`, { type: "geojson", data: route.geometry });

        map.addLayer({
          id: `route-${i}-outline`,
          type: "line",
          source: `route-${i}`,
          paint: {
            "line-color": "#000",
            "line-width": width + 2,
            "line-opacity": opacity * 0.4,
          },
        });

        map.addLayer({
          id: `route-${i}`,
          type: "line",
          source: `route-${i}`,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": lineColor,
            "line-width": width,
            "line-opacity": opacity,
          },
        });

        // 4. Score badge at midpoint of each route
        const coords = route.geometry.coordinates as [number, number][];
        if (coords.length === 0) return;

        const { label } = scoreLabel(route.safetyScore.overall);
        const midIdx = Math.floor(coords.length / 2);
        const [lng, lat] = coords[midIdx];

        const badgeEl = document.createElement("div");
        badgeEl.style.cssText = `
          display: flex;
          align-items: center;
          gap: 4px;
          padding: ${isSelected ? "6px 12px" : "4px 8px"};
          border-radius: 9999px;
          background: ${BG_MAP[color] ?? "#1e3a5f"};
          border: 2px solid ${lineColor};
          color: ${lineColor};
          font-size: ${isSelected ? "13px" : "11px"};
          font-weight: 700;
          font-family: system-ui, sans-serif;
          white-space: nowrap;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.6);
          opacity: ${isSelected ? "1" : "0.8"};
        `;
        badgeEl.innerHTML = `
          <span>${route.safetyScore.overall}</span>
          <span style="font-weight:400;font-size:${isSelected ? "11px" : "10px"};margin-left:2px">${label}</span>
        `;

        const badge = new mapboxgl.Marker({ element: badgeEl, anchor: "center" })
          .setLngLat([lng, lat])
          .addTo(map);
        markersRef.current.push(badge);
      });

      drawnCountRef.current = routes.length;

      // 5. Origin + destination pins for the selected route
      if (selectedRoute) {
        const { originCoords, destinationCoords } = selectedRoute;

        const makePin = (bg: string, size: number) => {
          const el = document.createElement("div");
          el.style.cssText = `
            width: ${size}px; height: ${size}px; border-radius: 50%;
            background: ${bg}; border: 2px solid white;
            box-shadow: 0 2px 6px rgba(0,0,0,0.7);
          `;
          return el;
        };

        markersRef.current.push(
          new mapboxgl.Marker({ element: makePin("#3b82f6", 14) })
            .setLngLat([originCoords.lng, originCoords.lat])
            .addTo(map),
          new mapboxgl.Marker({ element: makePin("#ef4444", 16) })
            .setLngLat([destinationCoords.lng, destinationCoords.lat])
            .addTo(map)
        );

        // 6. Fit bounds to ALL routes so they're all visible
        const allCoords = routes.flatMap(
          (r) => r.geometry.coordinates as [number, number][]
        );
        if (allCoords.length > 1) {
          const bounds = allCoords.reduce(
            (b, c) => b.extend(c),
            new mapboxgl.LngLatBounds(allCoords[0], allCoords[0])
          );
          map.fitBounds(bounds, { padding: 80, maxZoom: 16 });
        }
      }
    })();
  }, [routes, selectedRoute, mapLoaded]);

  return (
    <div className={`relative rounded-2xl overflow-hidden ${className}`}>
      <div ref={containerRef} className="w-full h-full" />
      {!process.env.NEXT_PUBLIC_MAPBOX_TOKEN && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90 text-gray-400 text-sm">
          Set NEXT_PUBLIC_MAPBOX_TOKEN to enable map
        </div>
      )}
    </div>
  );
}
