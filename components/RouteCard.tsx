"use client";

import { Clock, ShieldCheck, ShieldAlert, ShieldX, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Route } from "@/lib/types";
import { scoreLabel } from "@/lib/scoring";

interface RouteCardProps {
  route: Route;
  routeNumber: number;
  viaLabel?: string;
  isSelected?: boolean;
  isRecommended?: boolean;
  onSelect?: (route: Route) => void;
  explanation?: string;
}

export default function RouteCard({
  route,
  routeNumber,
  viaLabel,
  isSelected,
  isRecommended,
  onSelect,
  explanation,
}: RouteCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { label, color } = scoreLabel(route.safetyScore.overall);

  const colorClasses: Record<string, { bg: string; text: string; border: string; bar: string; icon: React.ReactNode }> = {
    green: {
      bg: "bg-green-500/10",
      text: "text-green-400",
      border: "border-green-500/30",
      bar: "bg-green-500",
      icon: <ShieldCheck className="w-4 h-4 text-green-400" />,
    },
    yellow: {
      bg: "bg-yellow-500/10",
      text: "text-yellow-400",
      border: "border-yellow-500/30",
      bar: "bg-yellow-500",
      icon: <ShieldAlert className="w-4 h-4 text-yellow-400" />,
    },
    orange: {
      bg: "bg-orange-500/10",
      text: "text-orange-400",
      border: "border-orange-500/30",
      bar: "bg-orange-500",
      icon: <ShieldAlert className="w-4 h-4 text-orange-400" />,
    },
    red: {
      bg: "bg-red-500/10",
      text: "text-red-400",
      border: "border-red-500/30",
      bar: "bg-red-500",
      icon: <ShieldX className="w-4 h-4 text-red-400" />,
    },
  };

  const c = colorClasses[color];

  return (
    <div
      onClick={() => onSelect?.(route)}
      className={`rounded-2xl border p-4 cursor-pointer transition-all ${
        isSelected
          ? "border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/10"
          : "border-white/10 bg-white/5 hover:bg-white/10"
      }`}
    >
      {/* Route number + via label row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Route {routeNumber}
          </span>
          {viaLabel && (
            <span className="text-xs text-gray-500 truncate max-w-[120px]">· {viaLabel}</span>
          )}
        </div>
        {isRecommended && (
          <span className="text-[10px] font-semibold text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 px-2 py-0.5 rounded-full">
            ★ Best
          </span>
        )}
      </div>

      {/* Score badge + label */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {c.icon}
          <span className={`font-semibold text-sm ${c.text}`}>{label}</span>
        </div>
        <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold ${c.bg} ${c.text} border ${c.border}`}>
          {route.safetyScore.overall}
          <span className="text-xs font-normal opacity-70">/100</span>
        </div>
      </div>

      {/* Time + distance + incidents */}
      <div className="flex items-center gap-4 text-xs text-gray-400 mb-3">
        <div className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          <span>{route.durationMinutes} min</span>
        </div>
        <span>{route.distanceMiles.toFixed(1)} mi</span>
        {route.safetyScore.recentIncidents > 0 && (
          <span className="text-orange-400">
            {route.safetyScore.recentIncidents} incident{route.safetyScore.recentIncidents > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Crime / Lighting / Signals bars */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Crime",    score: route.safetyScore.crimeIndex },
          { label: "Lighting", score: route.safetyScore.lightingIndex },
          { label: "Signals",  score: route.safetyScore.trafficSignalDensity },
        ].map(({ label: l, score }) => (
          <div key={l} className="flex flex-col gap-1">
            <span className="text-[10px] text-gray-500">{l}</span>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  score >= 70 ? "bg-green-500" : score >= 40 ? "bg-yellow-500" : "bg-red-500"
                }`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Explanation (expandable) */}
      {explanation && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "Less" : "Why this route?"}
          </button>
          {expanded && (
            <p className="mt-2 text-xs text-gray-300 leading-relaxed">{explanation}</p>
          )}
        </div>
      )}
    </div>
  );
}
