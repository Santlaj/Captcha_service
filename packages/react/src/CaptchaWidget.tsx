import React, { useState, useEffect, useCallback, useRef } from 'react';

export interface ChallengeClientResponse {
  challengeId: string;
  image: string;
  expiresAt: string;
}

export interface CaptchaWidgetProps {
  siteKey: string;
  apiBaseUrl?: string;
  autoVerify?: boolean;
  onVerify?: (token: string) => void;
  onError?: (error: string) => void;
  onExpire?: () => void;
  theme?: 'light' | 'dark';
  className?: string;
  label?: string;
  placeholder?: string;
}

type ChallengeData = ChallengeClientResponse;

/**
 * CaptchaWidget is a reusable, self-contained React component for numeric image CAPTCHA.
 * Features:
 * - Exact single-line layout matching reference screenshot: [ CAPTCHA Image ] [ enter captcha ] 🔄
 * - Symmetrical, clean input with lowercase placeholder
 * - Frameless circular refresh icon beside input
 * - Automatic verification upon typing 6 digits (configurable via autoVerify)
 * - Seamless embed inside any parent form (no nested form tags, no reload)
 * - Robust request cancellation via AbortController
 * - Callback ref stabilization preventing unwanted re-render loops
 */
export const CaptchaWidget: React.FC<CaptchaWidgetProps> = ({
  siteKey,
  apiBaseUrl = 'http://localhost:4000',
  autoVerify = true,
  onVerify,
  onError,
  onExpire,
  theme = 'light',
  className = '',
  label,
  placeholder = 'enter captcha',
}) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'verifying' | 'verified' | 'error'>('idle');
  const [challenge, setChallenge] = useState<ChallengeData | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [_remainingAttempts, setRemainingAttempts] = useState<number | null>(null);

  const isDark = theme === 'dark';
  const abortControllerRef = useRef<AbortController | null>(null);

  // Guard callback props in refs to prevent parent re-renders from recreating callbacks
  // and triggering infinite challenge-reload loops
  const onVerifyRef = useRef(onVerify);
  onVerifyRef.current = onVerify;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  /**
   * Fetches a fresh challenge from the CAPTCHA API.
   */
  const loadChallenge = useCallback(async () => {
    // Abort any in-flight challenge fetch to prevent race conditions
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setStatus('loading');
    setErrorMessage(null);
    setInputValue('');
    setRemainingAttempts(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/challenge`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-Site-Key': siteKey,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const errData = (await response.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };

        if (response.status === 429 || errData.code === 'RATE_LIMIT_EXCEEDED') {
          throw new Error('Rate limit exceeded. Please wait a moment before requesting a new challenge.');
        }
        if (response.status === 503 || errData.code === 'RATE_LIMIT_UNAVAILABLE') {
          throw new Error('Service is temporarily unavailable. Please try again shortly.');
        }

        throw new Error(errData.error || `Failed to load challenge (HTTP ${response.status})`);
      }

      const data = (await response.json()) as ChallengeData;
      if (!controller.signal.aborted) {
        setChallenge(data);
        setStatus('ready');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // Aborted by subsequent call, ignore safely
      }
      const msg = err instanceof Error ? err.message : 'Unable to connect to CAPTCHA service';
      setErrorMessage(msg);
      setStatus('error');
      onErrorRef.current?.(msg);
    }
  }, [apiBaseUrl, siteKey]);

  // Load initial challenge on mount and abort on unmount
  useEffect(() => {
    void loadChallenge();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [loadChallenge]);

  // Handle client-side expiration timer safely without infinite reload loops
  useEffect(() => {
    if (!challenge || status === 'verified') return;

    const expiresMs = new Date(challenge.expiresAt).getTime() - Date.now();
    if (expiresMs <= 0) {
      setChallenge(null);
      setErrorMessage('Challenge has expired. Please click refresh.');
      setStatus('error');
      onExpireRef.current?.();
      return;
    }

    const timer = setTimeout(() => {
      setChallenge(null);
      setErrorMessage('Challenge has expired. Please click refresh.');
      setStatus('error');
      onExpireRef.current?.();
    }, expiresMs);

    return () => clearTimeout(timer);
  }, [challenge, status]);

  /**
   * Submits the 6-digit answer to the server for verification.
   */
  const handleVerifyAnswer = useCallback(
    async (answerToVerify: string) => {
      if (!challenge || answerToVerify.length !== 6 || status === 'verifying' || status === 'verified') {
        return;
      }

      setStatus('verifying');
      setErrorMessage(null);

      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/solution`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            challengeId: challenge.challengeId,
            answer: answerToVerify,
          }),
        });

        const data = (await response.json().catch(() => ({}))) as {
          success?: boolean;
          verificationToken?: string;
          error?: string;
          code?: string;
          details?: {
            code?: string;
            remainingAttempts?: number;
          };
        };

        if (response.ok && data.success && data.verificationToken) {
          setStatus('verified');
          onVerifyRef.current?.(data.verificationToken);
          return;
        }

        // Handle HTTP 429 and 503 specifically
        if (response.status === 429 || data.code === 'RATE_LIMIT_EXCEEDED') {
          setErrorMessage('Too many attempts. Please wait a moment.');
          setStatus('ready');
          onErrorRef.current?.('Rate limit exceeded');
          return;
        }

        if (response.status === 503 || data.code === 'RATE_LIMIT_UNAVAILABLE') {
          setErrorMessage('Verification service is temporarily unavailable.');
          setStatus('ready');
          onErrorRef.current?.('Service unavailable');
          return;
        }

        // Handle specific verification failure modes
        const code = data.details?.code;

        if (code === 'ATTEMPTS_EXCEEDED') {
          setRemainingAttempts(0);
          setInputValue('');
          setChallenge(null);
          setStatus('error');
          setErrorMessage('Maximum attempts exceeded. Please click refresh.');
          onErrorRef.current?.(data.error || 'Maximum attempts exceeded');
          return;
        }

        if (code === 'CHALLENGE_EXPIRED_OR_NOT_FOUND') {
          setRemainingAttempts(0);
          setInputValue('');
          setChallenge(null);
          setStatus('error');
          setErrorMessage('Challenge expired or already used. Please click refresh.');
          onErrorRef.current?.(data.error || 'Challenge expired or not found');
          return;
        }

        // Incorrect answer with remaining attempts
        if (data.details?.remainingAttempts !== undefined) {
          setRemainingAttempts(data.details.remainingAttempts);
          setErrorMessage(`Incorrect CAPTCHA. ${data.details.remainingAttempts} attempt(s) remaining.`);
        } else {
          setErrorMessage(data.error || 'Incorrect CAPTCHA. Please try again.');
        }

        setStatus('ready');
        onErrorRef.current?.(data.error || 'Verification failed');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Network error during verification';
        setErrorMessage(msg);
        setStatus('ready');
        onErrorRef.current?.(msg);
      }
    },
    [apiBaseUrl, challenge, status],
  );

  /**
   * Sanitizes input to accept only numeric digits up to 6 characters.
   * Automatically triggers verification upon entering the 6th digit.
   */
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = e.target as HTMLInputElement;
    const numericOnly = target.value.replace(/\D/g, '').slice(0, 6);
    setInputValue(numericOnly);
    if (errorMessage && status !== 'error') {
      setErrorMessage(null);
    }

    // Auto-verify when 6 digits are reached if autoVerify is enabled
    if (autoVerify && numericOnly.length === 6 && status === 'ready' && challenge) {
      void handleVerifyAnswer(numericOnly);
    }
  };

  /**
   * Enter key triggers verification without submitting any parent form.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (inputValue.length === 6 && status === 'ready' && challenge) {
        void handleVerifyAnswer(inputValue);
      }
    }
  };

  return (
    <div
      className={`space-y-1.5 w-full font-sans select-none ${className}`}
      role="region"
      aria-label="Numeric CAPTCHA Verification"
    >
      {/* Optional Label */}
      {label && (
        <label
          htmlFor="captcha-input"
          className={`block text-xs font-semibold tracking-tight ${
            isDark ? 'text-slate-300' : 'text-slate-700'
          }`}
        >
          {label}
        </label>
      )}

      {/* Single-Line Row: [ CAPTCHA Image ] [ enter captcha ] 🔄 */}
      <div className="flex items-center gap-2.5 w-full">
        {/* 1. Left: CAPTCHA Image Container */}
        <div
          className={`w-[110px] h-11 shrink-0 rounded-lg border flex items-center justify-center overflow-hidden transition-colors shadow-sm ${
            isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'
          }`}
        >
          {status === 'loading' ? (
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <span className="text-[11px]">Loading...</span>
            </div>
          ) : challenge ? (
            <img
              src={challenge.image}
              alt="Numeric CAPTCHA digits to solve"
              className="w-full h-full block pointer-events-none select-none"
            />
          ) : (
            <span className="text-[11px] text-rose-500 font-medium">Error</span>
          )}
        </div>

        {/* 2. Middle: Input Field [ enter captcha ] */}
        <div className="relative flex-1 min-w-0">
          <input
            id="captcha-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={status === 'loading' || status === 'verifying' || status === 'verified'}
            placeholder={status === 'verified' ? 'verified ✓' : placeholder}
            className={`w-full h-11 px-3.5 rounded-lg border text-sm transition-all focus:outline-none focus:ring-2 ${
              status === 'verified'
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold focus:ring-emerald-500/20'
                : isDark
                ? 'bg-slate-900 border-slate-700 text-white placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500/20'
                : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500/20 shadow-sm'
            }`}
            autoComplete="off"
            spellCheck="false"
          />

          {/* Verification Status Indicator inside input */}
          <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none">
            {status === 'verifying' && (
              <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            )}
            {status === 'verified' && (
              <div className="w-4 h-4 text-emerald-500 flex items-center justify-center">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* 3. Right: Frameless Circular Refresh Icon (matching screenshot 🔄) */}
        <button
          type="button"
          onClick={() => void loadChallenge()}
          disabled={status === 'loading' || status === 'verifying'}
          className="p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all cursor-pointer disabled:opacity-50 shrink-0"
          title="Refresh CAPTCHA"
          aria-label="Refresh CAPTCHA"
        >
          <svg
            className={`w-5 h-5 transition-transform ${status === 'loading' ? 'animate-spin' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {/* Error or Verified Status Text */}
      {errorMessage && (
        <p className="text-xs text-rose-500 font-medium pl-0.5">{errorMessage}</p>
      )}
      {status === 'verified' && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium pl-0.5 flex items-center gap-1">
          <span>✓ CAPTCHA verified successfully</span>
        </p>
      )}
    </div>
  );
};
