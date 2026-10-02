import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Package, Eye, EyeOff, Fingerprint, ArrowRight } from 'lucide-react'
import Mascot from '../components/Mascot'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = (e) => {
    e.preventDefault()
    setLoading(true)
    setTimeout(() => navigate('/dashboard'), 1200)
  }

  return (
    <div className="min-h-screen bg-[#0a0e0b] flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-brand-950/40 to-surface-950 items-center justify-center p-12">
        <div className="text-center max-w-md">
          <div className="animate-float mb-8">
            <Mascot size={200} />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">Connecter. Mesurer. Piloter.</h2>
          <p className="text-surface-400 text-sm leading-relaxed">
            Centralisez vos boutiques Shopify, synchronisez vos catalogues et pilotez votre chiffre d'affaires depuis une seule console.
          </p>
          <div className="flex items-center justify-center gap-6 mt-8">
            {[
              { v: '0 %', l: 'Commission' },
              { v: '∞', l: 'Boutiques' },
              { v: '24/7', l: 'Sync' },
            ].map((s, i) => (
              <div key={i} className="text-center">
                <div className="text-lg font-bold text-white">{s.v}</div>
                <div className="text-xs text-surface-500">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel - Login form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Link to="/" className="flex items-center gap-2 mb-10 no-underline w-fit">
            <div className="w-9 h-9 rounded-lg bg-brand-500/20 flex items-center justify-center">
              <Package className="w-5 h-5 text-brand-400" />
            </div>
            <span className="text-lg font-bold text-white">Noship It</span>
          </Link>

          <h1 className="text-2xl font-bold text-white mb-1">Connexion</h1>
          <p className="text-sm text-surface-400 mb-8">Accédez à votre espace de gestion.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-surface-400 mb-1.5 font-medium">Adresse email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                required
                className="w-full px-4 py-3 rounded-xl bg-surface-900/50 border border-surface-800/50 text-white text-sm placeholder:text-surface-600 outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-surface-400 font-medium">Mot de passe</label>
                <a href="#" className="text-xs text-brand-400 hover:text-brand-300 no-underline">Oublié ?</a>
              </div>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-4 py-3 rounded-xl bg-surface-900/50 border border-surface-800/50 text-white text-sm placeholder:text-surface-600 outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300 bg-transparent border-none cursor-pointer"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:bg-brand-500/50 text-white py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer border-none"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Ouverture de votre espace…
                </>
              ) : (
                <>
                  Se connecter
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 p-4 rounded-xl bg-surface-900/30 border border-surface-800/30">
            <div className="flex items-center gap-2 mb-2">
              <Fingerprint className="w-4 h-4 text-brand-400" />
              <span className="text-xs font-medium text-white">Passkey disponible</span>
            </div>
            <p className="text-xs text-surface-500 leading-relaxed">
              Face ID, Touch ID ou Windows Hello. Configurez une passkey dans les paramètres pour vous connecter sans mot de passe.
            </p>
          </div>

          <p className="mt-8 text-center text-xs text-surface-500">
            Pas encore de compte ?{' '}
            <Link to="/signup" className="text-brand-400 hover:text-brand-300 no-underline">Demander l'accès</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
