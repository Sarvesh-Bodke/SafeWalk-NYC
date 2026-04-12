"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, X, Loader2 } from "lucide-react";
import { AlertPayload } from "@/lib/types";

interface AlertButtonProps {
  userEmail?: string;
  currentRoute?: { origin?: string; destination?: string };
}

export default function AlertButton({ userEmail, currentRoute }: AlertButtonProps) {
  const [status, setStatus] = useState<"idle" | "confirming" | "sending" | "sent" | "error">("idle");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Pre-fetch location so it's ready when user needs it
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {} // Silently fail — we'll try again on click
      );
    }
  }, []);

  async function handleAlert() {
    if (status === "idle") {
      setStatus("confirming");
      return;
    }

    if (status === "confirming") {
      setStatus("sending");

      let coords = location;

      // Try to get fresh location
      if (!coords && navigator.geolocation) {
        coords = await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => resolve({ lat: 40.7128, lng: -74.006 }) // Default: NYC center
          );
        });
      }

      const payload: AlertPayload = {
        userEmail,
        location: coords ?? { lat: 40.7128, lng: -74.006 },
        message: "User triggered safety alert via SafeWalk NYC app.",
        timestamp: new Date().toISOString(),
        route: currentRoute
          ? { origin: currentRoute.origin, destination: currentRoute.destination }
          : undefined,
      };

      try {
        const res = await fetch("/api/alert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) throw new Error("Alert failed");
        setStatus("sent");

        // Reset after 5 seconds
        setTimeout(() => setStatus("idle"), 5000);
      } catch {
        setStatus("error");
        setTimeout(() => setStatus("idle"), 3000);
      }
    }
  }

  const config = {
    idle: {
      label: "I Feel Unsafe",
      className: "bg-red-600 hover:bg-red-500 shadow-red-900/50",
      icon: <AlertTriangle className="w-5 h-5" />,
    },
    confirming: {
      label: "Tap again to confirm",
      className: "bg-red-700 animate-pulse shadow-red-900/50",
      icon: <AlertTriangle className="w-5 h-5" />,
    },
    sending: {
      label: "Sending alert...",
      className: "bg-red-800 cursor-not-allowed shadow-red-900/50",
      icon: <Loader2 className="w-5 h-5 animate-spin" />,
    },
    sent: {
      label: "Alert sent!",
      className: "bg-green-600 shadow-green-900/50",
      icon: <AlertTriangle className="w-5 h-5" />,
    },
    error: {
      label: "Failed — retry",
      className: "bg-gray-700 shadow-gray-900/50",
      icon: <X className="w-5 h-5" />,
    },
  };

  const current = config[status];

  return (
    <div className="relative">
      {status === "confirming" && (
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap bg-gray-900 text-white text-xs px-3 py-1.5 rounded-lg border border-white/10">
          Tap again to send alert
        </div>
      )}
      <button
        onClick={handleAlert}
        disabled={status === "sending" || status === "sent"}
        className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-white font-semibold shadow-lg transition-all ${current.className}`}
      >
        {current.icon}
        {current.label}
      </button>
    </div>
  );
}
