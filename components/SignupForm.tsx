"use client";

import { useState } from "react";
import { Mail, Shield, CheckCircle } from "lucide-react";
import { UNIVERSITIES } from "@/lib/alert-routing";
import { SignupPayload } from "@/lib/types";

interface SignupFormProps {
  onSuccess?: (payload: SignupPayload) => void;
  className?: string;
}

export default function SignupForm({ onSuccess, className = "" }: SignupFormProps) {
  const [email, setEmail] = useState("");
  const [notifyAlerts, setNotifyAlerts] = useState(true);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [detectedUniversity, setDetectedUniversity] = useState<string | null>(null);

  function handleEmailChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setEmail(val);

    // Auto-detect university
    const domain = val.split("@")[1]?.toLowerCase();
    if (domain) {
      const uni = UNIVERSITIES.find((u) => domain.endsWith(u.domain));
      setDetectedUniversity(uni?.name ?? null);
    } else {
      setDetectedUniversity(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;

    setStatus("loading");

    // Simulate signup (replace with real API call)
    await new Promise((r) => setTimeout(r, 800));

    const payload: SignupPayload = {
      email,
      university: detectedUniversity ?? undefined,
      notifyAlerts,
    };

    setStatus("success");
    onSuccess?.(payload);
  }

  if (status === "success") {
    return (
      <div className={`flex flex-col items-center gap-3 text-center ${className}`}>
        <CheckCircle className="w-12 h-12 text-green-500" />
        <p className="text-lg font-semibold text-white">You&apos;re on the list!</p>
        {detectedUniversity && (
          <p className="text-sm text-gray-300">
            Alerts will be routed through {detectedUniversity} campus safety.
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={`flex flex-col gap-4 ${className}`}>
      <div className="relative">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="email"
          value={email}
          onChange={handleEmailChange}
          placeholder="your@email.com"
          required
          className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
        />
      </div>

      {detectedUniversity && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/20 border border-blue-400/30">
          <Shield className="w-4 h-4 text-blue-400 shrink-0" />
          <p className="text-sm text-blue-300">
            Connected to {detectedUniversity} campus safety network
          </p>
        </div>
      )}

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={notifyAlerts}
          onChange={(e) => setNotifyAlerts(e.target.checked)}
          className="w-4 h-4 rounded accent-blue-500"
        />
        <span className="text-sm text-gray-300">Receive safety alerts for my area</span>
      </label>

      <button
        type="submit"
        disabled={status === "loading"}
        className="py-3 px-6 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold transition-colors"
      >
        {status === "loading" ? "Signing up..." : "Get Early Access"}
      </button>
    </form>
  );
}
