"use client";

import * as React from "react";
import { useState } from "react";

interface SignInProps {
  apiBase: string;
  discordUrl: string;
  onSuccess?: (token: string) => void;
  openRegistration?: boolean;
}

const SignIn1 = ({ apiBase, discordUrl, onSuccess, openRegistration = false }: SignInProps) => {
  const [tab, setTab] = useState<"signin" | "register">("signin");
  const [number, setNumber] = useState("");
  const [showNumber, setShowNumber] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState<{ number: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const formatNumber = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 16);
    return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNumber(formatNumber(e.target.value));
    setError("");
  };

  const handleSignIn = async () => {
    const digits = number.replace(/\D/g, "");
    if (digits.length < 16) {
      setError("Enter all 16 digits of your edgey ID.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ number: digits }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "unknown_number") setError("No account uses this edgey ID.");
        else if (data.error === "too_many_requests") setError("Too many attempts. Wait a minute.");
        else setError("Something went wrong. Try again.");
        return;
      }
      localStorage.setItem("edgey-session", data.token);
      onSuccess?.(data.token);
      location.assign("/overview");
    } catch {
      setError("Can't reach the server right now.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/auth/register`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "registration_closed") setError("Registration is currently closed.");
        else if (data.error === "too_many_requests") setError("Too many attempts. Try again later.");
        else setError("Something went wrong. Try again.");
        return;
      }
      setRegistered({ number: data.number, token: data.token });
      localStorage.setItem("edgey-session", data.token);
    } catch {
      setError("Can't reach the server right now.");
    } finally {
      setLoading(false);
    }
  };

  const copyNumber = async () => {
    if (!registered) return;
    await navigator.clipboard.writeText(registered.number);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const enterWorkspace = () => {
    location.assign("/overview");
  };

  if (registered) {
    return (
      <div className="flex flex-col items-center w-full max-w-sm rounded-3xl bg-gradient-to-r from-[#ffffff10] to-[#0a0a0f] backdrop-blur-sm shadow-2xl p-8">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/20 mb-6">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-2xl font-semibold text-white mb-2 text-center">You're in.</h2>
        <p className="text-sm text-gray-400 mb-6 text-center">
          Save your edgey ID — it's your only way to sign in.
        </p>
        <div className="w-full flex flex-col gap-3">
          <div className="relative">
            <input
              readOnly
              value={registered.number.replace(/(\d{4})(?=\d)/g, "$1 ")}
              className="w-full px-5 py-3 rounded-xl bg-white/10 text-white font-mono text-center text-lg tracking-widest focus:outline-none"
            />
          </div>
          <button
            onClick={copyNumber}
            className="w-full bg-white/10 text-white font-medium px-5 py-3 rounded-full shadow hover:bg-white/20 transition text-sm"
          >
            {copied ? "Copied!" : "Copy edgey ID"}
          </button>
          <hr className="opacity-10" />
          <button
            onClick={enterWorkspace}
            className="w-full bg-gradient-to-b from-cyan-500 to-cyan-600 text-white font-medium px-5 py-3 rounded-full shadow hover:brightness-110 transition text-sm"
          >
            Open workspace
          </button>
          <p className="text-xs text-red-400/80 text-center mt-1">
            Keep your edgey ID private. You won't see it again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center w-full max-w-sm rounded-3xl bg-gradient-to-r from-[#ffffff10] to-[#0a0a0f] backdrop-blur-sm shadow-2xl p-8">
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white/20 mb-4 shadow-lg">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      </div>
      <h2 className="text-2xl font-semibold text-white mb-6 text-center">
        edgey<span className="text-cyan-400">.shop</span>
      </h2>

      {/* Tabs */}
      <div className="flex w-full rounded-xl bg-white/5 p-1 mb-6 gap-1">
        <button
          onClick={() => { setTab("signin"); setError(""); }}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
            tab === "signin" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
          }`}
        >
          Sign in
        </button>
        <button
          onClick={() => { setTab("register"); setError(""); }}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
            tab === "register" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
          }`}
        >
          Create account
        </button>
      </div>

      <div className="flex flex-col w-full gap-4">
        {tab === "signin" ? (
          <>
            <div className="w-full flex flex-col gap-3">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">edgey ID</label>
              <div className="relative">
                <input
                  placeholder="0000 0000 0000 0000"
                  type={showNumber ? "text" : "password"}
                  inputMode="numeric"
                  value={number}
                  maxLength={19}
                  className="w-full px-5 py-3 rounded-xl bg-white/10 text-white placeholder-gray-500 text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
                  onChange={handleNumberChange}
                  onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
                  autoComplete="current-password"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowNumber(!showNumber)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition"
                >
                  {showNumber ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              {error && <div className="text-sm text-red-400">{error}</div>}
            </div>
            <button
              onClick={handleSignIn}
              disabled={loading}
              className="w-full bg-gradient-to-b from-cyan-500 to-cyan-600 text-white font-medium px-5 py-3 rounded-full shadow hover:brightness-110 transition text-sm disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </>
        ) : (
          <>
            {openRegistration ? (
              <>
                <p className="text-sm text-gray-400 text-center">
                  Create a free account. You'll receive a 16-digit edgey ID to sign in.
                </p>
                {error && <div className="text-sm text-red-400 text-center">{error}</div>}
                <button
                  onClick={handleRegister}
                  disabled={loading}
                  className="w-full bg-gradient-to-b from-cyan-500 to-cyan-600 text-white font-medium px-5 py-3 rounded-full shadow hover:brightness-110 transition text-sm disabled:opacity-50"
                >
                  {loading ? "Creating..." : "Create account"}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-400 text-center">
                  Your edgey ID and CLI key are delivered with your purchase. No email or password needed.
                </p>
                <ol className="flex flex-col gap-2 text-sm text-gray-300">
                  <li className="flex gap-3 items-start">
                    <span className="text-cyan-400 font-mono text-xs mt-0.5">01</span>
                    Buy a plan on Discord.
                  </li>
                  <li className="flex gap-3 items-start">
                    <span className="text-cyan-400 font-mono text-xs mt-0.5">02</span>
                    Receive your edgey ID and CLI key.
                  </li>
                  <li className="flex gap-3 items-start">
                    <span className="text-cyan-400 font-mono text-xs mt-0.5">03</span>
                    Sign in here and start building.
                  </li>
                </ol>
                <a
                  href={discordUrl}
                  target="_blank"
                  rel="noopener"
                  className="w-full flex items-center justify-center gap-2 bg-[#5865F2] text-white font-medium px-5 py-3 rounded-full shadow hover:brightness-110 transition text-sm text-center"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" /></svg>
                  Get access on Discord
                </a>
              </>
            )}
          </>
        )}

        <hr className="opacity-10" />
        <div className="w-full text-center">
          <span className="text-xs text-gray-400">
            {tab === "signin" ? (
              <>New here?{" "}
                <button onClick={() => { setTab("register"); setError(""); }} className="underline text-white/80 hover:text-white">
                  Get your access.
                </button>
              </>
            ) : (
              <>Already have an ID?{" "}
                <button onClick={() => { setTab("signin"); setError(""); }} className="underline text-white/80 hover:text-white">
                  Sign in.
                </button>
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
};

export { SignIn1 };
export default SignIn1;
