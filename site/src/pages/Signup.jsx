import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Package, ArrowRight, CheckCircle2, Send, User, Mail, Store, Globe, MessageSquare } from 'lucide-react'

const countries = ['France', 'Belgique', 'Suisse', 'Canada', 'Sénégal', 'Algérie', 'Allemagne', 'Autre pays']
const revenues = ['Pas encore lancé', '1 à 5 k€', '5 à 20 k€', '20 à 50 k€', '50 à 150 k€', '150 k€ +']
const channels = ['Meta (Facebook/Instagram)', 'TikTok Ads', 'Google Ads', 'Snapchat Ads', 'Pinterest Ads', 'SEO / Organique', 'Bouche-à-oreille', 'Autre']
const experience = ['Débutant', '1 à 2 ans', '3 à 5 ans', '5 ans +']

export default function Signup() {
  const [step, setStep] = useState(1)
  const [submitted, setSubmitted] = useState(false)
  const [form, setForm] = useState({
    name: '', email: '', shopDomain: '', country: '', revenue: '', experience: '', channels: [], message: '', terms: false
  })

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }))
  const toggleChannel = (ch) => {
    setForm(prev => ({
      ...prev,
      channels: prev.channels.includes(ch) ? prev.channels.filter(c => c !== ch) : [...prev.channels, ch]
    }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#0a0e0b] flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-brand-500/20 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-brand-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Demande envoyée</h1>
          <p className="text-sm text-surface-400 leading-relaxed mb-6">
            Un administrateur examine votre demande. Revenez sur cette page ou activez les notifications Telegram pour être informé.
          </p>
          <p className="text-xs text-surface-500 mb-8">
            Conservez ce lien : il vous montrera la décision et, si la demande est approuvée, votre lien de création de compte.
          </p>
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300 no-underline">
            <ArrowRight className="w-4 h-4 rotate-180" />
            Retour à l'accueil
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0e0b] flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <Link to="/" className="flex items-center gap-2 mb-8 no-underline w-fit">
          <div className="w-9 h-9 rounded-lg bg-brand-500/20 flex items-center justify-center">
            <Package className="w-5 h-5 text-brand-400" />
          </div>
          <span className="text-lg font-bold text-white">Noship It</span>
        </Link>

        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 mb-4">
            <span className="text-xs text-brand-400 font-medium">ACCÈS SUR DEMANDE</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Demander l'accès</h1>
          <p className="text-sm text-surface-400">
            Répondez à quelques questions. Vos réponses ne servent qu'à examiner votre demande.
          </p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3].map(s => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${s <= step ? 'bg-brand-500' : 'bg-surface-800'}`} />
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {step === 1 && (
            <div className="space-y-4 animate-fade-in-up" style={{ animationDuration: '0.4s' }}>
              <h3 className="text-sm font-semibold text-white mb-4">Votre profil</h3>
              <div>
                <label className="block text-xs text-surface-400 mb-1.5 font-medium">Nom complet</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-600" />
                  <input type="text" value={form.name} onChange={e => update('name', e.target.value)} required placeholder="Votre nom"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-surface-900/50 border border-surface-800/50 text-white text-sm placeholder:text-surface-600 outline-none focus:border-brand-500/50 transition-all" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-surface-400 mb-1.5 font-medium">Adresse email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-600" />
                  <input type="email" value={form.email} onChange={e => update('email', e.target.value)} required placeholder="vous@exemple.com"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-surface-900/50 border border-surface-800/50 text-white text-sm placeholder:text-surface-600 outline-none focus:border-brand-500/50 transition-all" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-surface-400 mb-1.5 font-medium">Domaine Shopify (si existant)</label>
                <div className="relative">
                  <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-600" />
                  <input type="text" value={form.shopDomain} onChange={e => update('shopDomain', e.target.value)} placeholder="ma-boutique.myshopify.com"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-surface-900/50 border border-surface-800/50 text-white text-sm placeholder:text-surface-600 outline-none focus:border-brand-500/50 transition-all" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-surface-400 mb-1.5 font-medium">Pays</label>
                <select value={form.country} onChange={e => update('country', e.target.value)} required
                  className="w-full px-4 py-3 rounded-xl bg-surface-900/50 border border-surface-800/50 text-white text-sm outline-none focus:border-brand-500/50 transition-all appearance-none cursor-pointer">
                  <option value="" className="bg-surface-900">Choisir un pays</option>
                  {countries.map(c => <option key={c} value={c} className="bg-surface-900">{c}</option>)}
                </select>
              </div>
              <button type="button" onClick={() => setStep(2)}
                className="w-full flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 text-white py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer border-none mt-2">
                Continuer <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 animate-fade-in-up" style={{ animationDuration: '0.4s' }}>
              <h3 className="text-sm font-semibold text-white mb-4">Votre activité</h3>
              <div>
                <label className="block text-xs text-surface-400 mb-2 font-medium">Chiffre d'affaires mensuel</label>
                <div className="grid grid-cols-2 gap-2">
                  {revenues.map(r => (
                    <button key={r} type="button" onClick={() => update('revenue', r)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer border ${form.revenue === r ? 'bg-brand-500/20 border-brand-500/50 text-brand-400' : 'bg-surface-900/50 border-surface-800/50 text-surface-400 hover:border-surface-600'}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-surface-400 mb-2 font-medium">Ancienneté en e-commerce</label>
                <div className="grid grid-cols-2 gap-2">
                  {experience.map(e => (
                    <button key={e} type="button" onClick={() => update('experience', e)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer border ${form.experience === e ? 'bg-brand-500/20 border-brand-500/50 text-brand-400' : 'bg-surface-900/50 border-surface-800/50 text-surface-400 hover:border-surface-600'}`}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-surface-400 mb-2 font-medium">Canaux publicitaires utilisés</label>
                <div className="flex flex-wrap gap-2">
                  {channels.map(ch => (
                    <button key={ch} type="button" onClick={() => toggleChannel(ch)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer border ${form.channels.includes(ch) ? 'bg-brand-500/20 border-brand-500/50 text-brand-400' : 'bg-surface-900/50 border-surface-800/50 text-surface-400 hover:border-surface-600'}`}>
                      {ch}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => setStep(1)}
                  className="flex-1 py-3 rounded-xl text-sm font-medium border border-surface-800 text-surface-400 hover:text-white hover:border-surface-600 transition-all cursor-pointer bg-transparent">
                  Retour
                </button>
                <button type="button" onClick={() => setStep(3)}
                  className="flex-1 flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 text-white py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer border-none">
                  Continuer <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 animate-fade-in-up" style={{ animationDuration: '0.4s' }}>
              <h3 className="text-sm font-semibold text-white mb-4">Dernière étape</h3>
              <div>
                <label className="block text-xs text-surface-400 mb-1.5 font-medium">Une question avant de demander l'accès ?</label>
                <div className="relative">
                  <MessageSquare className="absolute left-3 top-3 w-4 h-4 text-surface-600" />
                  <textarea value={form.message} onChange={e => update('message', e.target.value)} rows={3} placeholder="Posez votre question…"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-surface-900/50 border border-surface-800/50 text-white text-sm placeholder:text-surface-600 outline-none focus:border-brand-500/50 transition-all resize-none" />
                </div>
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={form.terms} onChange={e => update('terms', e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-surface-600 bg-surface-900 text-brand-500 focus:ring-brand-500/20 cursor-pointer accent-emerald-500" />
                <span className="text-xs text-surface-400 leading-relaxed">
                  J'accepte les <a href="#" className="text-brand-400 no-underline hover:text-brand-300">conditions d'utilisation</a> et la <a href="#" className="text-brand-400 no-underline hover:text-brand-300">politique de confidentialité</a>.
                </span>
              </label>
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => setStep(2)}
                  className="flex-1 py-3 rounded-xl text-sm font-medium border border-surface-800 text-surface-400 hover:text-white hover:border-surface-600 transition-all cursor-pointer bg-transparent">
                  Retour
                </button>
                <button type="submit" disabled={!form.terms}
                  className="flex-1 flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:bg-surface-800 disabled:text-surface-600 text-white py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer border-none">
                  <Send className="w-4 h-4" /> Envoyer
                </button>
              </div>
            </div>
          )}
        </form>

        <p className="mt-8 text-center text-xs text-surface-500">
          Déjà un compte ?{' '}
          <Link to="/login" className="text-brand-400 hover:text-brand-300 no-underline">Se connecter</Link>
        </p>
      </div>
    </div>
  )
}
