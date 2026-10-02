import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, ChevronDown, Check } from 'lucide-react'
import Navbar from '../components/Navbar'
import Mascot from '../components/Mascot'

function CommissionCalc() {
  const [period, setPeriod] = useState('month')
  const [revenue, setRevenue] = useState(30000)
  const [commission, setCommission] = useState(20)

  const multiplier = period === 'day' ? 1 : period === 'month' ? 30 : 365
  const dailyRevenue = period === 'day' ? revenue : period === 'month' ? revenue / 30 : revenue / 365
  const monthlyRevenue = period === 'month' ? revenue : period === 'day' ? revenue * 30 : revenue / 12
  const yearlyRevenue = period === 'year' ? revenue : period === 'day' ? revenue * 365 : revenue * 12

  const lossPerDay = Math.round(dailyRevenue * commission / 100)
  const lossPerMonth = Math.round(monthlyRevenue * commission / 100)
  const lossPerYear = Math.round(yearlyRevenue * commission / 100)

  const displayRevenue = revenue.toLocaleString('en-US')
  const periodLabel = period === 'day' ? 'day' : period === 'month' ? 'month' : 'year'

  const maxRevenue = period === 'day' ? 50000 : period === 'month' ? 1500000 : 18000000
  const minRevenue = period === 'day' ? 100 : period === 'month' ? 1500 : 18000

  const pctFilled = ((revenue - minRevenue) / (maxRevenue - minRevenue)) * 100
  const commPctFilled = ((commission - 1) / 29) * 100

  return (
    <div className="terminal-window">
      <div className="terminal-titlebar">
        <div className="terminal-dot bg-[#ff5f57]" />
        <div className="terminal-dot bg-[#febc2e]" />
        <div className="terminal-dot bg-[#28c840]" />
        <span className="flex-1 text-center font-mono text-xs text-[#5a7a5c]">commission.calc</span>
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 text-[#5a7a5c]" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="12" height="12" rx="2"/></svg>
      </div>
      <div className="p-6 space-y-6">
        {/* Revenue */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="label">YOUR REVENUE</span>
            <div className="flex gap-1">
              {['day', 'month', 'year'].map(p => (
                <button key={p} onClick={() => { setPeriod(p); setRevenue(p === 'day' ? 1000 : p === 'month' ? 30000 : 360000) }}
                  className={`text-xs px-3 py-1 rounded-md cursor-pointer border transition-colors ${period === p ? 'bg-[#1a2a1c] border-[#2a3d2c] text-white' : 'bg-transparent border-[#1a2a1c] text-[#5a7a5c] hover:text-[#c8d6ca]'}`}>
                  Per {p}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-3xl font-bold text-white">{displayRevenue}</span>
            <span className="text-lg text-[#5a7a5c]">€</span>
            <span className="text-sm text-[#5a7a5c]">/ {periodLabel}</span>
          </div>
          <div className="relative">
            <input type="range" min={minRevenue} max={maxRevenue} value={revenue} onChange={e => setRevenue(Number(e.target.value))}
              className="green-slider w-full" style={{ background: `linear-gradient(to right, #a3e635 0%, #a3e635 ${pctFilled}%, #1a2a1c ${pctFilled}%, #1a2a1c 100%)` }} />
            <div className="flex justify-between mt-1">
              <span className="font-mono text-[10px] text-[#3a4d3c]">€{minRevenue.toLocaleString('en-US')}</span>
              <span className="font-mono text-[10px] text-[#3a4d3c]">€{maxRevenue.toLocaleString('en-US')}</span>
            </div>
          </div>
        </div>

        {/* Commission */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="label">TYPICAL PLATFORM COMMISSION</span>
            <span className="text-lg font-bold text-white">{commission} <span className="text-[#5a7a5c]">%</span></span>
          </div>
          <div className="relative">
            <input type="range" min={1} max={30} value={commission} onChange={e => setCommission(Number(e.target.value))}
              className="red-slider w-full" style={{ background: `linear-gradient(to right, #ef4444 0%, #ef4444 ${commPctFilled}%, #1a2a1c ${commPctFilled}%, #1a2a1c 100%)` }} />
            <div className="flex justify-between mt-1">
              <span className="font-mono text-[10px] text-[#3a4d3c]">1 %</span>
              <span className="font-mono text-[10px] text-[#3a4d3c]">30 %</span>
            </div>
          </div>
        </div>

        {/* Loss calculation */}
        <div className="bg-[#0a0e0b] border border-[#1a2a1c] rounded-lg p-5">
          <span className="label block mb-2">WHAT YOU WOULD LOSE ELSEWHERE</span>
          <div className="text-4xl font-bold text-[#ef4444] mb-1">-€{lossPerMonth.toLocaleString('en-US')}</div>
          <p className="text-xs text-[#5a7a5c]">per month · with Noship It: <span className="text-[#a3e635] font-semibold">€0 commission</span></p>
        </div>

        {/* Comparison bars */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-[#5a7a5c] w-24 text-right shrink-0">Platform at {commission}%</span>
            <div className="flex-1 h-3 rounded-full overflow-hidden bg-[#1a2a1c]">
              <div className="h-full rounded-full" style={{ width: '60%', background: 'repeating-linear-gradient(90deg, #a3e635, #a3e635 4px, #ef4444 4px, #ef4444 8px)' }} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-[#5a7a5c] w-24 text-right shrink-0">Noship It</span>
            <div className="flex-1 h-3 rounded-full overflow-hidden bg-[#1a2a1c]">
              <div className="h-full rounded-full bg-[#a3e635]" style={{ width: '100%' }} />
            </div>
          </div>
        </div>

        {/* Infinity note */}
        <div className="flex items-center gap-3 bg-[#111a13] border border-[#1a2a1c] rounded-lg px-4 py-3">
          <span className="text-lg text-[#a3e635]">&#8734;</span>
          <span className="text-xs text-[#c8d6ca]">Noship It: €800 once, paid back in <strong className="text-white">less than a day</strong>.</span>
        </div>

        {/* Per day/month/year */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'PER DAY', value: `-€${lossPerDay.toLocaleString('en-US')}` },
            { label: 'PER MONTH', value: `-€${lossPerMonth.toLocaleString('en-US')}` },
            { label: 'PER YEAR', value: `-€${lossPerYear.toLocaleString('en-US')}` },
          ].map((item, i) => (
            <div key={i} className="bg-[#0a0e0b] border border-[#1a2a1c] rounded-lg p-3">
              <span className="label block mb-1">{item.label}</span>
              <span className="text-sm font-bold text-white">{item.value}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[10px] font-mono text-[#3a4d3c] pt-2 border-t border-[#1a2a1c]">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#a3e635]" />
            <span>0% · €800 ONCE · FOR LIFE</span>
          </div>
          <span>1 YEAR = 12 MONTHS = 365 D</span>
        </div>
      </div>
    </div>
  )
}

export default function Landing() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleLogin = (e) => {
    e.preventDefault()
    setLoading(true)
    setTimeout(() => navigate('/dashboard'), 1200)
  }

  return (
    <div className="min-h-screen bg-[#0a0e0b]">
      <Navbar />

      {/* Hero Section — split layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start pt-8">
          {/* Left: Hero content */}
          <div className="pt-4">
            <div className="font-mono text-[10px] tracking-[2px] uppercase text-[#5a7a5c] mb-6">
              SHOPIFY / NOBAN · REBILL · TRACKING
            </div>

            <div className="flex items-start gap-6 mb-6">
              <div className="flex-1">
                <h1 className="text-5xl sm:text-6xl font-black text-white leading-[1.1] mb-1">
                  Noban.
                </h1>
                <h1 className="text-5xl sm:text-6xl font-black text-white leading-[1.1] mb-1">
                  Anti-link.
                </h1>
                <h1 className="text-5xl sm:text-6xl font-black text-[#a3e635] leading-[1.1]">
                  Rebill.
                </h1>
              </div>
              <div className="hidden sm:block shrink-0 animate-float">
                <Mascot size={140} />
              </div>
            </div>

            <p className="text-sm text-[#8a9a8c] leading-relaxed mb-6 max-w-md">
              Your stores stay online, your links hold and your subscriptions rebill. And on the ad side, no conversion gets lost: ad tracking runs non-stop.
            </p>

            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#111a13] border border-[#1a2a1c] mb-10">
              <span className="flex items-center gap-1">
                <span className="w-5 h-5 rounded-full bg-[#a3e635] flex items-center justify-center text-[#0a0e0b] text-[10px] font-bold">0</span>
                <span className="text-[10px] font-bold text-[#a3e635]">%</span>
              </span>
              <span className="text-xs text-[#c8d6ca]">commission · €800 once, lifetime service</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#a3e635]" />
            </div>

            {/* Feature cards 2x2 */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="card">
                <div className="w-8 h-8 rounded-lg bg-[#0a0e0b] border border-[#1a2a1c] flex items-center justify-center mb-3">
                  <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#5a7a5c]" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>
                </div>
                <h3 className="text-sm font-semibold text-white mb-1">Noban</h3>
                <p className="text-xs text-[#5a7a5c] leading-relaxed">Stores protected against bans, no surprise suspensions.</p>
              </div>
              <div className="card">
                <div className="w-8 h-8 rounded-lg bg-[#0a0e0b] border border-[#1a2a1c] flex items-center justify-center mb-3">
                  <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#5a7a5c]" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                </div>
                <h3 className="text-sm font-semibold text-white mb-1">Anti-link</h3>
                <p className="text-xs text-[#5a7a5c] leading-relaxed">Your redirect links hold, without being cut or flagged.</p>
              </div>
              <div className="card">
                <div className="w-8 h-8 rounded-lg bg-[#0a0e0b] border border-[#1a2a1c] flex items-center justify-center mb-3">
                  <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#5a7a5c]" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
                </div>
                <h3 className="text-sm font-semibold text-white mb-1">Rebill</h3>
                <p className="text-xs text-[#5a7a5c] leading-relaxed">Every subscription renewal is tied to its original sale.</p>
              </div>
              <div className="card">
                <div className="w-8 h-8 rounded-lg bg-[#0a0e0b] border border-[#1a2a1c] flex items-center justify-center mb-3">
                  <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#a3e635]" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </div>
                <h3 className="text-sm font-semibold text-white mb-1">Ads tracking</h3>
                <p className="text-xs text-[#5a7a5c] leading-relaxed">Conversions tracked server-side and sent to your ad networks, one network at a time.</p>
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-lg">&#8734;</span>
                  <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#5a7a5c]" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                  <svg viewBox="0 0 448 512" className="w-4 h-4 text-[#5a7a5c]" fill="currentColor"><path d="M448 209.91a210.06 210.06 0 01-122.77-39.25V349.38A162.55 162.55 0 11185 188.31V278.2a74.62 74.62 0 1052.23 71.18V0l88 0a121.18 121.18 0 0034.29 79.57A115.79 115.79 0 00448 116.89z"/></svg>
                  <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#5a7a5c]" fill="currentColor"><path d="M22.46 6c-.77.35-1.6.58-2.46.69.88-.53 1.56-1.37 1.88-2.38-.83.5-1.75.85-2.72 1.05C18.37 4.5 17.26 4 16 4c-2.35 0-4.27 1.92-4.27 4.29 0 .34.04.67.11.98C8.28 9.09 5.11 7.38 3 4.79c-.37.63-.58 1.37-.58 2.15 0 1.49.75 2.81 1.91 3.56-.71 0-1.37-.2-1.95-.5v.03c0 2.08 1.48 3.82 3.44 4.21a4.22 4.22 0 01-1.93.07 4.28 4.28 0 004 2.98 8.521 8.521 0 01-5.33 1.84c-.34 0-.68-.02-1.02-.06C3.44 20.29 5.7 21 8.12 21 16 21 20.33 14.46 20.33 8.79c0-.19 0-.37-.01-.56.84-.6 1.56-1.36 2.14-2.23z"/></svg>
                </div>
              </div>
            </div>

            {/* Works with */}
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] tracking-[2px] uppercase text-[#3a4d3c]">WORKS WITH</span>
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#65a30d]" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#65a30d]" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#28a8ea]" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
              </div>
            </div>
          </div>

          {/* Right: Terminal login */}
          <div>
            <div className="terminal-window">
              <div className="terminal-titlebar">
                <div className="terminal-dot bg-[#ff5f57]" />
                <div className="terminal-dot bg-[#febc2e]" />
                <div className="terminal-dot bg-[#28c840]" />
                <span className="flex-1 text-center font-mono text-xs text-[#5a7a5c]">noship.it — access</span>
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#5a7a5c]" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
              </div>
              <div className="p-6">
                <div className="font-mono text-sm text-[#a3e635] mb-4">
                  <span className="font-bold text-white">visitor@noship</span>:<span className="text-[#a3e635]">~$</span> open a session
                </div>
                <div className="font-mono text-xs text-[#5a7a5c] mb-6">
                  ↳ Private space · authentication required
                </div>

                <h2 className="text-2xl font-bold text-white mb-1">Enter the system.</h2>
                <p className="text-sm text-[#5a7a5c] mb-6">Your stores are waiting on the other side.</p>

                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs text-[#5a7a5c] mb-1.5 font-medium">Email address</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@company.com"
                      className="input-field" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#5a7a5c] mb-1.5 font-medium">Password</label>
                    <div className="relative">
                      <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required placeholder="Your password"
                        className="input-field pr-10" />
                      <button type="button" onClick={() => setShowPw(!showPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5a7a5c] hover:text-[#c8d6ca] bg-transparent border-none cursor-pointer">
                        {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button type="submit" disabled={loading}
                    className="w-full flex items-center justify-between bg-[#a3e635] hover:bg-[#bef264] disabled:bg-[#a3e635]/50 text-[#0a0e0b] py-3 px-5 rounded-lg text-sm font-semibold transition-all cursor-pointer border-none">
                    {loading ? (
                      <>
                        <span>Opening session...</span>
                        <div className="w-4 h-4 border-2 border-[#0a0e0b]/30 border-t-[#0a0e0b] rounded-full animate-spin" />
                      </>
                    ) : (
                      <>
                        <span>Log in</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>

                <div className="flex items-center gap-2 mt-5 font-mono text-xs text-[#3a4d3c]">
                  <span className="animate-blink">›</span>
                  <span>waiting for credentials</span>
                  <span className="animate-blink">█</span>
                </div>

                <div className="mt-6 pt-5 border-t border-[#1a2a1c]">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#a3e635]" />
                      <span className="label">ACCESS ON REQUEST</span>
                    </div>
                    <span className="font-mono text-[10px] text-[#3a4d3c]">NS / 01</span>
                  </div>
                  <div className="bg-[#0a0e0b] border border-[#1a2a1c] rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <svg viewBox="0 0 24 24" className="w-8 h-8 text-[#28a8ea] shrink-0" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
                      <div>
                        <p className="text-sm text-white font-medium">A question before requesting access?</p>
                        <p className="text-xs text-[#5a7a5c]">Write to us on Telegram · @noshipit_bot</p>
                      </div>
                    </div>
                  </div>
                </div>

                <p className="text-center text-xs text-[#5a7a5c] mt-5">
                  No account yet?{' '}
                  <Link to="/signup" className="text-[#a3e635] hover:text-[#bef264] no-underline font-medium">Open an account</Link>
                  {' · '}
                  <Link to="/signup" className="text-[#a3e635] hover:text-[#bef264] no-underline font-medium">Track my request</Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-[#1a2a1c]" />

      {/* Pricing / Commission section — split layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          {/* Left: Zero commission */}
          <div className="pt-4">
            <div className="label mb-6">PRICING / COMMISSION</div>

            <div className="mb-6">
              <span className="text-[120px] sm:text-[160px] font-black text-[#a3e635] leading-none">0</span>
              <span className="text-4xl sm:text-5xl font-bold text-[#a3e635] relative -top-16 ml-1">%</span>
            </div>

            <h2 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-4">
              Zero commission. <span className="text-[#5a7a5c]">On every sale.</span>
            </h2>

            <p className="text-sm text-[#5a7a5c] leading-relaxed mb-6 max-w-md">
              Most platforms take a cut of your revenue, and the bill grows as you do.
              At Noship It, your sales stay entirely yours.
            </p>

            <div className="space-y-3 mb-8">
              {[
                'No percentage taken from your revenue',
                'No hidden per-order fees',
                'The more you sell, the wider the gap in your favour',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#a3e635] shrink-0" />
                  <span className="text-sm text-[#c8d6ca]">{item}</span>
                </div>
              ))}
            </div>

            {/* €800 card */}
            <div className="bg-[#111a13] border border-[#1a2a1c] rounded-xl p-5 max-w-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#a3e635]/10 flex items-center justify-center shrink-0">
                  <span className="text-xl text-[#a3e635]">&#8734;</span>
                </div>
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-white">€800</span>
                    <span className="label">ONE TIME</span>
                  </div>
                  <p className="text-xs text-[#5a7a5c] mt-1">Lifetime service. No subscription, no commission: you pay once, that's it.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Commission calculator */}
          <div>
            <CommissionCalc />
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-[#1a2a1c] py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="font-mono text-[10px] tracking-[1px] uppercase text-[#3a4d3c]">
            NOSHIP IT / NOBAN · ANTI-LINK · REBILL · AD TRACKING
          </div>
          <div className="flex items-center gap-4">
            <a href="#" className="text-xs text-[#5a7a5c] hover:text-[#c8d6ca] no-underline transition-colors">Privacy</a>
            <a href="#" className="text-xs text-[#5a7a5c] hover:text-[#c8d6ca] no-underline transition-colors">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
