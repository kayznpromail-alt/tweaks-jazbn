import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Package, ArrowRight, Store, Link2, BarChart3, Bell, Shield, Zap,
  Globe, Target, TrendingUp, ChevronDown, ChevronUp, CheckCircle2,
  Smartphone, Layers, RefreshCw, Eye, ShoppingCart, CreditCard,
  MonitorSmartphone, Palette, Bot, Send
} from 'lucide-react'
import Navbar from '../components/Navbar'
import Mascot from '../components/Mascot'

function useInView(threshold = 0.15) {
  const ref = useRef()
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect() } }, { threshold })
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return [ref, visible]
}

function AnimatedCounter({ end, duration = 2000, suffix = '' }) {
  const [count, setCount] = useState(0)
  const [ref, visible] = useInView()
  useEffect(() => {
    if (!visible) return
    let start = 0
    const step = end / (duration / 16)
    const timer = setInterval(() => {
      start += step
      if (start >= end) { setCount(end); clearInterval(timer) }
      else setCount(Math.floor(start))
    }, 16)
    return () => clearInterval(timer)
  }, [visible, end, duration])
  return <span ref={ref}>{count}{suffix}</span>
}

function Section({ children, id, className = '' }) {
  const [ref, visible] = useInView()
  return (
    <section id={id} ref={ref} className={`${className} transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
      {children}
    </section>
  )
}

const features = [
  { icon: Link2, title: 'Bridge multi-boutiques', desc: 'Connectez vos vitrines à vos boutiques backend. Le bridge redirige automatiquement les commandes vers le bon fournisseur.' },
  { icon: Target, title: 'Tracking publicitaire', desc: 'Pixels Meta, TikTok, Google Ads et Snapchat installés en un clic. Conversions serveur-side via le Measurement Protocol.' },
  { icon: BarChart3, title: 'Statistiques en temps réel', desc: 'Chiffre d\'affaires, commandes payées, panier moyen et taux de conversion sur un tableau de bord centralisé.' },
  { icon: RefreshCw, title: 'Synchronisation catalogues', desc: 'Produits, variantes et stocks synchronisés entre vitrine et backend. Association automatique par titre.' },
  { icon: Bell, title: 'Alertes Telegram', desc: 'Recevez chaque commande, alerte de stock et récapitulatif quotidien directement sur Telegram.' },
  { icon: CreditCard, title: 'Versements Shopify', desc: 'Suivez les versements Shopify Payments de tous vos backends, synchronisés automatiquement.' },
  { icon: Palette, title: 'Thème auto-patché', desc: 'Le script de redirection et les pixels s\'installent tout seuls sur votre thème Shopify. Analyse et diagnostic intégrés.' },
  { icon: Shield, title: 'Sécurité renforcée', desc: 'Passkeys (Touch ID, Face ID, Windows Hello), tokens chiffrés au repos, données supprimées sous 7 jours.' },
  { icon: Bot, title: 'Assistant IA', desc: 'Bernie, notre pigeon mascotte, répond à vos questions et analyse vos performances directement dans la console.' },
]

const steps = [
  { num: '01', title: 'Ajoutez votre vitrine', desc: 'Connectez la boutique Shopify que voient vos clients. L\'assistant vous guide pour l\'app et les autorisations.' },
  { num: '02', title: 'Reliez un backend', desc: 'Ajoutez la boutique qui encaisse. URLs et autorisations à copier, le script et les webhooks s\'installent tout seuls.' },
  { num: '03', title: 'Associez les produits', desc: 'Chaque produit vitrine est relié à un produit d\'offre. Association automatique par titre ou manuelle.' },
  { num: '04', title: 'Pilotez vos ventes', desc: 'Statistiques, alertes Telegram et tableau de bord centralisé. Tout est synchronisé en temps réel.' },
]

const faqs = [
  { q: 'Comment fonctionne le bridge entre les boutiques ?', a: 'Le bridge redirige les sessions visiteur de votre vitrine vers la boutique backend qui encaisse. Les pixels de conversion sont installés sur la page de remerciement du backend. Le visiteur ne voit qu\'une seule boutique.' },
  { q: 'Quelles plateformes publicitaires sont supportées ?', a: 'Meta (Facebook/Instagram), TikTok, Google Ads (via GA4 et Measurement Protocol), Snapchat et Pinterest. Les conversions sont envoyées côté serveur pour une meilleure précision.' },
  { q: 'Mes données sont-elles en sécurité ?', a: 'Les tokens Shopify sont chiffrés au repos. Les emails et téléphones clients ne servent qu\'à envoyer les conversions aux régies publicitaires et sont effacés sous 7 jours. Aucune revente de données.' },
  { q: 'Puis-je connecter plusieurs backends ?', a: 'Oui. Le système bascule automatiquement vers un autre backend disponible si le premier est indisponible ou a atteint son plafond du jour.' },
  { q: 'Comment fonctionnent les alertes Telegram ?', a: 'Un lien privé unique connecte votre compte Telegram à votre espace Noship It. Vous recevez chaque commande, alerte de stock et un récapitulatif quotidien.' },
  { q: 'Quel est le modèle de tarification ?', a: 'Zéro pourcentage sur votre chiffre d\'affaires. Un paiement unique, un accès à vie. Pas d\'abonnement mensuel, pas de commission cachée.' },
]

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-surface-800/50 rounded-xl overflow-hidden card-hover">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between p-5 text-left bg-transparent border-none cursor-pointer text-white">
        <span className="font-medium text-sm sm:text-base pr-4">{q}</span>
        {open ? <ChevronUp className="w-5 h-5 text-brand-400 shrink-0" /> : <ChevronDown className="w-5 h-5 text-surface-500 shrink-0" />}
      </button>
      {open && (
        <div className="px-5 pb-5 text-sm text-surface-400 leading-relaxed animate-fade-in-up" style={{ animationDuration: '0.3s' }}>
          {a}
        </div>
      )}
    </div>
  )
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#0a0e0b]">
      <Navbar />

      {/* Hero */}
      <div className="hero-glow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 sm:pt-36 pb-20 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/20 mb-8">
            <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse" />
            <span className="text-xs text-brand-400 font-medium">Votre réseau de boutiques</span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold text-white tracking-tight leading-tight mb-6">
            <span className="gradient-text">Connecter.</span>{' '}
            <span className="text-white">Mesurer.</span>{' '}
            <span className="gradient-text">Piloter.</span>
          </h1>

          <p className="text-lg sm:text-xl text-surface-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Centralisez vos boutiques Shopify, synchronisez vos catalogues, suivez vos conversions publicitaires et pilotez votre chiffre d'affaires depuis une seule console.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Link to="/signup" className="group flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-8 py-3.5 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-brand-500/25 no-underline">
              Demander l'accès
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link to="/login" className="flex items-center gap-2 text-surface-400 hover:text-white px-6 py-3.5 rounded-xl text-sm font-medium border border-surface-800 hover:border-surface-600 transition-all no-underline">
              Se connecter
            </Link>
          </div>

          {/* Mascot */}
          <div className="animate-float mx-auto w-fit">
            <Mascot size={180} />
          </div>
          <p className="text-xs text-surface-600 mt-4">Bernie se repose sur son colis, casque sur les oreilles et pantoufles aux pieds.</p>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-16 max-w-3xl mx-auto">
            {[
              { value: <AnimatedCounter end={0} suffix=" %" />, label: 'Commission' },
              { value: <AnimatedCounter end={99} suffix=",9 %" />, label: 'Disponibilité' },
              { value: <AnimatedCounter end={5} suffix=" min" />, label: 'Installation' },
              { value: <AnimatedCounter end={24} suffix="/7" />, label: 'Synchronisation' },
            ].map((s, i) => (
              <div key={i} className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-white">{s.value}</div>
                <div className="text-xs text-surface-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Features */}
      <Section id="features" className="py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Un œil sur vos boutiques.{' '}
              <span className="gradient-text">Un pas d'avance.</span>
            </h2>
            <p className="text-surface-400 max-w-xl mx-auto">
              Toutes les fonctionnalités pour gérer votre réseau de boutiques Shopify depuis un seul endroit.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f, i) => (
              <div key={i} className="p-6 rounded-2xl border border-surface-800/50 bg-surface-950/50 card-hover group">
                <div className="w-11 h-11 rounded-xl bg-brand-500/10 flex items-center justify-center mb-4 group-hover:bg-brand-500/20 transition-colors">
                  <f.icon className="w-5 h-5 text-brand-400" />
                </div>
                <h3 className="text-white font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-surface-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Dashboard Preview */}
      <Section className="py-20 sm:py-28 bg-surface-950/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Votre tableau de bord, <span className="gradient-text">en un coup d'œil</span>
            </h2>
          </div>
          <div className="rounded-2xl border border-surface-800/50 bg-surface-900/50 p-4 sm:p-8 max-w-5xl mx-auto">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              {[
                { label: 'CA du jour', value: '4 832 €', change: '+18%', icon: TrendingUp },
                { label: 'Commandes payées', value: '47', change: '+12%', icon: ShoppingCart },
                { label: 'Panier moyen', value: '102 €', change: '+5%', icon: CreditCard },
                { label: 'Taux conversion', value: '3,2%', change: '+0,4%', icon: Target },
              ].map((kpi, i) => (
                <div key={i} className="p-4 rounded-xl bg-surface-800/50 border border-surface-700/30">
                  <div className="flex items-center gap-2 mb-2">
                    <kpi.icon className="w-4 h-4 text-brand-400" />
                    <span className="text-xs text-surface-500">{kpi.label}</span>
                  </div>
                  <div className="text-xl font-bold text-white">{kpi.value}</div>
                  <span className="text-xs text-brand-400">{kpi.change}</span>
                </div>
              ))}
            </div>
            <div className="h-48 rounded-xl bg-surface-800/30 border border-surface-700/20 flex items-center justify-center">
              <div className="flex items-end gap-1.5 h-32">
                {[35, 52, 45, 68, 55, 72, 48, 85, 62, 78, 90, 75, 95, 82, 70, 88, 65, 92, 58, 80].map((h, i) => (
                  <div key={i} className="w-3 sm:w-4 rounded-t bg-brand-500/60 hover:bg-brand-400 transition-colors" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between mt-4 text-xs text-surface-600">
              <span>Dernière mise à jour : il y a 2 min</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-brand-400" /> Synchronisé</span>
            </div>
          </div>
        </div>
      </Section>

      {/* How it works */}
      <Section id="how-it-works" className="py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              <span className="gradient-text">4 étapes</span> pour démarrer
            </h2>
            <p className="text-surface-400 max-w-xl mx-auto">
              De la connexion à la première vente, tout est guidé.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((s, i) => (
              <div key={i} className="relative p-6 rounded-2xl border border-surface-800/50 bg-surface-950/50 card-hover">
                <div className="text-5xl font-black text-brand-500/15 absolute top-4 right-4">{s.num}</div>
                <div className="w-10 h-10 rounded-full bg-brand-500/20 flex items-center justify-center mb-4">
                  <span className="text-sm font-bold text-brand-400">{s.num}</span>
                </div>
                <h3 className="text-white font-semibold mb-2">{s.title}</h3>
                <p className="text-sm text-surface-400 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Integrations */}
      <Section className="py-20 sm:py-28 bg-surface-950/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Intégrations <span className="gradient-text">disponibles</span>
          </h2>
          <p className="text-surface-400 max-w-xl mx-auto mb-12">
            Connectez vos régies publicitaires et vos outils préférés.
          </p>
          <div className="flex flex-wrap justify-center gap-4 max-w-3xl mx-auto">
            {['Shopify', 'Meta Ads', 'TikTok Ads', 'Google Ads', 'GA4', 'Snapchat', 'Pinterest', 'Telegram'].map((name, i) => (
              <div key={i} className="flex items-center gap-2 px-5 py-3 rounded-xl border border-surface-800/50 bg-surface-900/50 card-hover">
                <Globe className="w-4 h-4 text-brand-400" />
                <span className="text-sm text-white font-medium">{name}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Pricing */}
      <Section id="pricing" className="py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              <span className="gradient-text">0 %</span> de commission
            </h2>
            <p className="text-surface-400 max-w-xl mx-auto">
              Aucun pourcentage sur votre chiffre d'affaires. Un paiement unique, un accès à vie.
            </p>
          </div>

          <div className="max-w-lg mx-auto">
            <div className="relative p-8 rounded-2xl border-2 border-brand-500/30 bg-surface-950/80 animate-pulse-glow">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-brand-500 text-xs font-bold text-white">
                À VIE
              </div>
              <div className="text-center mb-8">
                <div className="text-5xl font-black text-white mb-2">0 %</div>
                <div className="text-surface-400">de commission sur vos ventes</div>
                <div className="mt-4 text-sm text-surface-500">Un paiement unique · Accès à vie</div>
              </div>
              <div className="space-y-3 mb-8">
                {[
                  'Boutiques illimitées (vitrine + backend)',
                  'Bridge multi-boutiques avec failover',
                  'Pixels Meta, TikTok, Google, Snapchat',
                  'Conversions server-side (CAPI)',
                  'Statistiques et tableau de bord',
                  'Alertes et récap Telegram',
                  'Synchronisation catalogues',
                  'Versements Shopify Payments',
                  'Assistant IA (Bernie)',
                  'Passkeys et sécurité renforcée',
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <CheckCircle2 className="w-4 h-4 text-brand-400 shrink-0" />
                    <span className="text-sm text-surface-300">{f}</span>
                  </div>
                ))}
              </div>
              <Link to="/signup" className="block w-full text-center bg-brand-500 hover:bg-brand-600 text-white py-3.5 rounded-xl text-sm font-semibold transition-colors no-underline">
                Demander l'accès
              </Link>
            </div>
          </div>
        </div>
      </Section>

      {/* FAQ */}
      <Section id="faq" className="py-20 sm:py-28 bg-surface-950/50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Questions <span className="gradient-text">fréquentes</span>
            </h2>
          </div>
          <div className="space-y-3">
            {faqs.map((faq, i) => <FAQItem key={i} {...faq} />)}
          </div>
        </div>
      </Section>

      {/* CTA */}
      <Section className="py-20 sm:py-28">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="p-10 sm:p-16 rounded-3xl bg-gradient-to-br from-brand-950/80 to-surface-950/80 border border-brand-800/30">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Prêt à piloter votre réseau ?
            </h2>
            <p className="text-surface-400 max-w-lg mx-auto mb-8">
              Demandez l'accès et commencez à connecter vos boutiques en quelques minutes.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/signup" className="group flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-8 py-3.5 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-brand-500/25 no-underline">
                Commencer maintenant
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a href="#features" className="text-sm text-surface-400 hover:text-white transition-colors no-underline">
                En savoir plus
              </a>
            </div>
          </div>
        </div>
      </Section>

      {/* Footer */}
      <footer className="border-t border-surface-800/50 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-8 mb-10">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-brand-500/20 flex items-center justify-center">
                  <Package className="w-4 h-4 text-brand-400" />
                </div>
                <span className="font-bold text-white">Noship It</span>
              </div>
              <p className="text-xs text-surface-500 leading-relaxed">
                Votre réseau de boutiques Shopify, centralisé et piloté depuis une seule console.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3">Produit</h4>
              <div className="space-y-2">
                <a href="#features" className="block text-sm text-surface-500 hover:text-brand-400 no-underline transition-colors">Fonctionnalités</a>
                <a href="#pricing" className="block text-sm text-surface-500 hover:text-brand-400 no-underline transition-colors">Tarifs</a>
                <a href="#faq" className="block text-sm text-surface-500 hover:text-brand-400 no-underline transition-colors">FAQ</a>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3">Ressources</h4>
              <div className="space-y-2">
                <a href="#" className="block text-sm text-surface-500 hover:text-brand-400 no-underline transition-colors">Documentation</a>
                <a href="#" className="block text-sm text-surface-500 hover:text-brand-400 no-underline transition-colors">Support</a>
                <a href="#" className="block text-sm text-surface-500 hover:text-brand-400 no-underline transition-colors">Telegram</a>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3">Légal</h4>
              <div className="space-y-2">
                <a href="#" className="block text-sm text-surface-500 hover:text-brand-400 no-underline transition-colors">Conditions d'utilisation</a>
                <a href="#" className="block text-sm text-surface-500 hover:text-brand-400 no-underline transition-colors">Politique de confidentialité</a>
                <a href="#" className="block text-sm text-surface-500 hover:text-brand-400 no-underline transition-colors">Mentions légales</a>
              </div>
            </div>
          </div>
          <div className="border-t border-surface-800/50 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <span className="text-xs text-surface-600">© {new Date().getFullYear()} Noship It. Tous droits réservés.</span>
            <span className="text-xs text-surface-600">Connecter. Mesurer. Piloter.</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
