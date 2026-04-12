import Link from "next/link";
import { Shield, MapPin, Bell, Zap } from "lucide-react";
import SignupForm from "@/components/SignupForm";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-blue-400" />
          <span className="font-bold text-lg">SafeWalk NYC</span>
        </div>
        <Link
          href="/route-planner"
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-medium transition-colors"
        >
          Open App
        </Link>
      </nav>

      {/* Hero */}
      <main className="max-w-4xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm mb-6">
            <MapPin className="w-4 h-4" />
            Built for NYC students
          </div>

          <h1 className="text-5xl sm:text-6xl font-extrabold mb-6 leading-tight">
            Walk NYC{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
              smarter
            </span>
            {" "}and safer
          </h1>

          <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
            AI-powered safety routing that analyzes real-time crime data, street lighting,
            and traffic signals to find you the safest path home — not just the fastest.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/route-planner"
              className="px-8 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 font-semibold text-lg transition-colors"
            >
              Plan a safe route
            </Link>
            <a
              href="#signup"
              className="px-8 py-4 rounded-2xl border border-white/20 hover:bg-white/5 font-semibold text-lg transition-colors"
            >
              Get early access
            </a>
          </div>
        </div>

        {/* Feature cards */}
        <div className="grid sm:grid-cols-3 gap-6 mb-20">
          {[
            {
              icon: <MapPin className="w-6 h-6 text-blue-400" />,
              title: "Real-time crime data",
              desc: "Routes scored against live NYPD complaint data and 311 reports.",
            },
            {
              icon: <Zap className="w-6 h-6 text-yellow-400" />,
              title: "AI safety reasoning",
              desc: "Claude explains why a route is safe or risky in plain English.",
            },
            {
              icon: <Bell className="w-6 h-6 text-red-400" />,
              title: "One-tap alerts",
              desc: "Instantly notify your campus safety office if you feel unsafe.",
            },
          ].map(({ icon, title, desc }) => (
            <div
              key={title}
              className="p-6 rounded-2xl bg-white/5 border border-white/10 flex flex-col gap-3"
            >
              {icon}
              <h3 className="font-semibold">{title}</h3>
              <p className="text-sm text-gray-400">{desc}</p>
            </div>
          ))}
        </div>

        {/* Signup */}
        <div id="signup" className="max-w-md mx-auto">
          <div className="p-8 rounded-3xl bg-white/5 border border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-5 h-5 text-blue-400" />
              <h2 className="font-bold text-xl">Get early access</h2>
            </div>
            <p className="text-sm text-gray-400 mb-6">
              University email? We&apos;ll connect you directly to your campus safety network.
            </p>
            <SignupForm />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-8 text-center text-sm text-gray-500">
        <p>SafeWalk NYC — keeping students safe, one block at a time.</p>
      </footer>
    </div>
  );
}
