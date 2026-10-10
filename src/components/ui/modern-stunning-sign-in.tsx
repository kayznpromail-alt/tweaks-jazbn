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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    if (!username.trim()) {
      setError("Enter your username.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "invalid_credentials") setError("Invalid username or password.");
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
    const user = username.trim().toLowerCase();
    if (!user || !/^[a-zA-Z0-9_]{3,20}$/.test(user)) {
      setError("Username must be 3–20 characters (letters, numbers, _).");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: user, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "registration_closed") setError("Registration is currently closed.");
        else if (data.error === "username_taken") setError("This username is already taken.");
        else if (data.error === "invalid_username") setError("Username must be 3–20 characters (letters, numbers, _).");
        else if (data.error === "password_too_short") setError("Password must be at least 6 characters.");
        else if (data.error === "too_many_requests") setError("Too many attempts. Try again later.");
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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      tab === "signin" ? handleSignIn() : handleRegister();
    }
  };

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
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Username</label>
              <input
                placeholder="your username"
                type="text"
                value={username}
                className="w-full px-5 py-3 rounded-xl bg-white/10 text-white placeholder-gray-500 text-sm tracking-wider focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
                onChange={(e) => { setUsername(e.target.value); setError(""); }}
                onKeyDown={onKeyDown}
                autoComplete="username"
                spellCheck={false}
              />
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Password</label>
              <div className="relative">
                <input
                  placeholder="your password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  className="w-full px-5 py-3 rounded-xl bg-white/10 text-white placeholder-gray-500 text-sm tracking-wider focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  onKeyDown={onKeyDown}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition"
                >
                  {showPassword ? (
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
                <div className="w-full flex flex-col gap-3">
                  <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Username</label>
                  <input
                    placeholder="choose a username"
                    type="text"
                    value={username}
                    maxLength={20}
                    className="w-full px-5 py-3 rounded-xl bg-white/10 text-white placeholder-gray-500 text-sm tracking-wider focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
                    onChange={(e) => { setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "")); setError(""); }}
                    onKeyDown={onKeyDown}
                    autoComplete="username"
                    spellCheck={false}
                  />
                  <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Password</label>
                  <div className="relative">
                    <input
                      placeholder="min 6 characters"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      className="w-full px-5 py-3 rounded-xl bg-white/10 text-white placeholder-gray-500 text-sm tracking-wider focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
                      onChange={(e) => { setPassword(e.target.value); setError(""); }}
                      onKeyDown={onKeyDown}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition"
                    >
                      {showPassword ? (
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
                  <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Confirm password</label>
                  <input
                    placeholder="re-enter password"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    className="w-full px-5 py-3 rounded-xl bg-white/10 text-white placeholder-gray-500 text-sm tracking-wider focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
                    onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
                    onKeyDown={onKeyDown}
                    autoComplete="new-password"
                  />
                  {error && <div className="text-sm text-red-400 text-center">{error}</div>}
                </div>
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
                  Your credentials are delivered with your purchase. No email needed.
                </p>
                <ol className="flex flex-col gap-2 text-sm text-gray-300">
                  <li className="flex gap-3 items-start">
                    <span className="text-cyan-400 font-mono text-xs mt-0.5">01</span>
                    Buy a plan on Discord.
                  </li>
                  <li className="flex gap-3 items-start">
                    <span className="text-cyan-400 font-mono text-xs mt-0.5">02</span>
                    Receive your username and password.
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
                  Create an account.
                </button>
              </>
            ) : (
              <>Already have an account?{" "}
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
