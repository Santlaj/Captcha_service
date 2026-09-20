import React, { useState } from 'react';
import { Shield, Key, BarChart3, Settings, CheckCircle2, Copy } from 'lucide-react';

export default function App() {
  const [copied, setCopied] = useState(false);
  const sampleSiteKey = 'cs_live_9f83a02b4e891c3d8204';

  const handleCopy = () => {
    navigator.clipboard.writeText(sampleSiteKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-white">CaptchaService</h1>
            <p className="text-xs text-slate-400">Developer Platform Console</p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            API Online :4000
          </span>
          <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-medium text-slate-300">
            Dev
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 space-y-8">
        {/* Welcome Banner */}
        <div className="rounded-xl border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900/90 to-emerald-950/40 p-6">
          <div className="max-w-2xl space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Self-Hosted Architecture</span>
            <h2 className="text-2xl font-bold text-white tracking-tight">Production CAPTCHA Infrastructure</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Manage your site verification keys, configure challenge difficulties, monitor verification rates, and inspect real-time anti-bot analytics across all connected applications.
            </p>
          </div>
        </div>

        {/* Project API Credentials */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Active Site Credentials</h3>
            </div>
            <span className="text-xs text-slate-400">Default Project: Production Web</span>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">Client Site Key (Public)</span>
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
                >
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <code className="text-xs font-mono text-emerald-300 block select-all">{sampleSiteKey}</code>
            </div>

            <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
              <span className="text-xs text-slate-400 font-medium">Backend Secret Key (Private)</span>
              <div className="flex items-center justify-between">
                <code className="text-xs font-mono text-slate-500 block">cs_sec_••••••••••••••••••••</code>
                <span className="text-[10px] text-amber-400/90 font-medium bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
                  Server-side only
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Analytics Snapshot Cards */}
        <section className="grid sm:grid-cols-3 gap-4">
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 space-y-2">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium">Total Challenges (24h)</span>
              <BarChart3 className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-2xl font-bold text-white">0</p>
            <p className="text-xs text-slate-500">Awaiting first challenge event</p>
          </div>

          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 space-y-2">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium">Verification Pass Rate</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-2xl font-bold text-white">— %</p>
            <p className="text-xs text-slate-500">Human vs bot telemetry pending</p>
          </div>

          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 space-y-2">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium">Active Security Level</span>
              <Settings className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-2xl font-bold text-white">Adaptive</p>
            <p className="text-xs text-slate-500">Rate-limiting & HMAC token signed</p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 px-6 py-4 text-center text-xs text-slate-500">
        CaptchaService Monorepo Platform · Self-Hostable Anti-Bot Defense
      </footer>
    </div>
  );
}
