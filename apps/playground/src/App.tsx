import React, { useState } from 'react';
import { CaptchaWidget } from '@captcha-service/react';
import {
  User,
  Lock,
  Eye,
  EyeOff,
  KeyRound,
  Copy,
  Check,
  RefreshCw,
  Code2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState('alex.rivera');
  const [password, setPassword] = useState('SuperSecretPassword123');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [widgetKey, setWidgetKey] = useState(0);
  const [verifyingWithServer, setVerifyingWithServer] = useState(false);
  const [siteverifyDetails, setSiteverifyDetails] = useState<{
    success: boolean;
    challengeTimestamp?: number;
    hostname?: string;
  } | null>(null);

  // Parse JWT payload safely for demonstration in the playground
  const decodedPayload = React.useMemo(() => {
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length < 2 || !parts[1]) return null;
      return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch {
      return null;
    }
  }, [token]);

  const handleVerify = (receivedToken: string) => {
    setToken(receivedToken);
    setLoginError(null);
  };

  const handleCopyToken = () => {
    if (!token) return;
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setToken(null);
    setSubmitted(false);
    setLoginError(null);
    setSiteverifyDetails(null);
    setWidgetKey((k) => k + 1); // remount widget for fresh session
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setLoginError('Please solve the CAPTCHA before logging in.');
      return;
    }
    setLoginError(null);
    setVerifyingWithServer(true);

    try {
      const apiBase = ((import.meta as any).env?.VITE_API_BASE_URL as string) || 'http://localhost:4000';
      const res = await fetch(`${apiBase}/api/v1/siteverify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secretKey: 'development_only_jwt_secret_key_change_in_production_min32',
          token,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSubmitted(true);
        setSiteverifyDetails(data);
      } else {
        const errs = Array.isArray(data.errorCodes) ? data.errorCodes.join(', ') : 'Verification rejected';
        setLoginError(`Backend rejected token (${errs}). Tokens are single-use!`);
      }
    } catch {
      setLoginError('Could not reach backend siteverify endpoint.');
    } finally {
      setVerifyingWithServer(false);
    }
  };

  const isDark = theme === 'dark';

  return (
    <div
      className={`min-h-screen ${
        isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-100/80 text-slate-900'
      } flex flex-col items-center justify-center p-4 md:p-8 transition-colors`}
    >
      <div className="max-w-md w-full space-y-6">
        {/* Top Controls Bar */}
        <div className="flex items-center justify-between text-xs px-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold uppercase tracking-wider text-[11px] text-slate-400">
              Live Embed Preview
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              className={`px-3 py-1 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
                isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 shadow-sm'
              }`}
            >
              Theme: <span className="font-semibold text-blue-600 capitalize">{theme}</span>
            </button>
            <button
              type="button"
              onClick={handleReset}
              className={`px-3 py-1 rounded-md border text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 shadow-sm'
              }`}
              title="Reset Form & Challenge"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* User Login Form Card (Exact match to reference screenshot) */}
        <div
          className={`rounded-2xl border p-6 md:p-8 transition-all ${
            isDark
              ? 'bg-slate-900 border-slate-800 shadow-xl'
              : 'bg-white border-slate-200/80 shadow-lg shadow-slate-200/60'
          }`}
        >
          {/* Header with Title & Accent Bar */}
          <div className="text-center mb-6">
            <h1
              className={`text-xl font-bold tracking-tight ${
                isDark ? 'text-blue-400' : 'text-[#1e3a8a]'
              }`}
            >
              User Login
            </h1>
            <div className="w-9 h-0.5 bg-blue-600 rounded-full mx-auto mt-1.5" />
          </div>

          {/* Form */}
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            {/* Username Field */}
            <div className="space-y-1.5">
              <label
                htmlFor="username"
                className={`block text-xs font-semibold ${
                  isDark ? 'text-slate-300' : 'text-slate-700'
                }`}
              >
                Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  className={`w-full pl-9 pr-3.5 py-2.5 rounded-lg border text-sm transition-all focus:outline-none focus:ring-2 ${
                    isDark
                      ? 'bg-slate-950 border-slate-800 text-white focus:border-blue-500 focus:ring-blue-500/20'
                      : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500/20 shadow-sm'
                  }`}
                  required
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className={`block text-xs font-semibold ${
                  isDark ? 'text-slate-300' : 'text-slate-700'
                }`}
              >
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className={`w-full pl-9 pr-10 py-2.5 rounded-lg border text-sm transition-all focus:outline-none focus:ring-2 ${
                    isDark
                      ? 'bg-slate-950 border-slate-800 text-white focus:border-blue-500 focus:ring-blue-500/20'
                      : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500/20 shadow-sm'
                  }`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Seamless CAPTCHA Widget */}
            <div className="pt-1">
              <CaptchaWidget
                key={widgetKey}
                siteKey="cs_live_playground_test_sitekey"
                apiBaseUrl={((import.meta as any).env?.VITE_API_BASE_URL as string) || 'http://localhost:4000'}
                theme={theme}
                onVerify={handleVerify}
              />
            </div>

            {/* Login Error Notification */}
            {loginError && (
              <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            {/* Login Success Notification */}
            {submitted && (
              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300 text-xs flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                  <span className="font-semibold">
                    Login successful! Verified via server-to-server POST /api/v1/siteverify.
                  </span>
                </div>
                {siteverifyDetails?.challengeTimestamp && (
                  <div className="pl-6 text-[11px] text-emerald-600 dark:text-emerald-400 font-mono">
                    Timestamp: {new Date(siteverifyDetails.challengeTimestamp * 1000).toLocaleTimeString()}
                    {siteverifyDetails.hostname && ` • Hostname: ${siteverifyDetails.hostname}`}
                  </div>
                )}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={verifyingWithServer}
              className="w-full py-2.5 px-4 rounded-lg font-semibold text-sm text-white bg-[#1d4ed8] hover:bg-blue-700 active:scale-[0.99] transition-all shadow-md shadow-blue-500/25 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {verifyingWithServer ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Verifying with Server...</span>
                </>
              ) : (
                <span>Login</span>
              )}
            </button>
          </form>
        </div>

        {/* Live Token & Claims Context Inspector (Shows Server Verification Payload) */}
        {token && (
          <div
            className={`rounded-xl border p-5 space-y-3 transition-all ${
              isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold text-xs">
                <KeyRound className="w-4 h-4" />
                <span>Issued Verification Token (JWT via jose)</span>
              </div>
              <button
                type="button"
                onClick={handleCopyToken}
                className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs flex items-center gap-1 transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            {/* Raw Token String */}
            <div
              className={`p-2.5 rounded-lg font-mono text-[11px] break-all select-all border ${
                isDark
                  ? 'bg-slate-950 border-slate-800 text-emerald-400'
                  : 'bg-slate-50 border-slate-200 text-emerald-700'
              }`}
            >
              {token}
            </div>

            {/* Decoded Claims Preview */}
            {decodedPayload && (
              <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <Code2 className="w-3.5 h-3.5" /> Decoded Token Context (Validated by your backend)
                </span>
                <div
                  className={`p-2.5 rounded-lg font-mono text-[11px] border overflow-x-auto ${
                    isDark
                      ? 'bg-slate-950 border-slate-800 text-slate-300'
                      : 'bg-slate-50 border-slate-200 text-slate-800'
                  }`}
                >
                  <pre className="m-0 leading-relaxed">{JSON.stringify(decodedPayload, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
