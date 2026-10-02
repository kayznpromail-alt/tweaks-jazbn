import { useState } from 'react'
import { Link, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import {
  Package, LayoutDashboard, Store, Link2, BarChart3, Bell, Settings,
  HelpCircle, LogOut, ChevronDown, Menu, X, TrendingUp, ShoppingCart,
  CreditCard, Target, Plus, ExternalLink, RefreshCw, CheckCircle2,
  AlertCircle, Globe, Eye, Zap, Send, Bot, ArrowRight, ArrowLeft,
  Wifi, WifiOff, Trash2, MoreHorizontal, Search, Filter, Calendar,
  Clock, Users, Smartphone, Shield, Palette, ChevronRight
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import Mascot from '../components/Mascot'

const revenueData = [
  { day: '01', value: 2400 }, { day: '02', value: 3100 }, { day: '03', value: 2800 },
  { day: '04', value: 4200 }, { day: '05', value: 3800 }, { day: '06', value: 5100 },
  { day: '07', value: 4600 }, { day: '08', value: 3900 }, { day: '09', value: 5800 },
  { day: '10', value: 6200 }, { day: '11', value: 5400 }, { day: '12', value: 4800 },
  { day: '13', value: 7100 }, { day: '14', value: 6500 }, { day: '15', value: 5900 },
  { day: '16', value: 7800 }, { day: '17', value: 6900 }, { day: '18', value: 8200 },
  { day: '19', value: 7400 }, { day: '20', value: 9100 },
]

const ordersData = [
  { day: 'Lun', orders: 12 }, { day: 'Mar', orders: 18 }, { day: 'Mer', orders: 15 },
  { day: 'Jeu', orders: 22 }, { day: 'Ven', orders: 28 }, { day: 'Sam', orders: 35 },
  { day: 'Dim', orders: 20 },
]

const stores = [
  { id: 1, name: 'ma-vitrine.myshopify.com', type: 'vitrine', status: 'connected', products: 142, orders: 847 },
  { id: 2, name: 'mon-backend.myshopify.com', type: 'backend', status: 'connected', products: 156, orders: 1203 },
  { id: 3, name: 'vitrine-deux.myshopify.com', type: 'vitrine', status: 'connected', products: 89, orders: 423 },
  { id: 4, name: 'backend-reserve.myshopify.com', type: 'backend', status: 'disconnected', products: 0, orders: 0 },
]

const connections = [
  { id: 1, front: 'ma-vitrine.myshopify.com', back: 'mon-backend.myshopify.com', matched: 138, total: 142, active: true },
  { id: 2, front: 'vitrine-deux.myshopify.com', back: 'mon-backend.myshopify.com', matched: 85, total: 89, active: true },
]

const notifications = [
  { id: 1, type: 'order', msg: 'Commande #4832 payée — 127 €', time: 'il y a 3 min' },
  { id: 2, type: 'sync', msg: 'Catalogues synchronisés (156 produits)', time: 'il y a 12 min' },
  { id: 3, type: 'alert', msg: 'Stock bas : T-shirt Classic (3 restants)', time: 'il y a 1h' },
  { id: 4, type: 'order', msg: 'Commande #4831 payée — 89 €', time: 'il y a 2h' },
  { id: 5, type: 'payout', msg: 'Versement Shopify reçu — 4 280 €', time: 'hier' },
]

const navItems = [
  { path: '/dashboard', icon: LayoutDashboard, label: 'Vue d\'ensemble' },
  { path: '/dashboard/stores', icon: Store, label: 'Boutiques' },
  { path: '/dashboard/connections', icon: Link2, label: 'Connexions' },
  { path: '/dashboard/stats', icon: BarChart3, label: 'Statistiques' },
  { path: '/dashboard/notifications', icon: Bell, label: 'Notifications' },
  { path: '/dashboard/support', icon: HelpCircle, label: 'Support' },
  { path: '/dashboard/settings', icon: Settings, label: 'Paramètres' },
]

function Sidebar({ open, setOpen }) {
  const location = useLocation()
  const isActive = (path) => path === '/dashboard' ? location.pathname === path : location.pathname.startsWith(path)

  return (
    <>
      {open && <div className="lg:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setOpen(false)} />}
      <aside className={`fixed lg:static top-0 left-0 h-full w-64 bg-surface-950 border-r border-surface-800/50 z-50 transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between p-4 border-b border-surface-800/50">
          <Link to="/" className="flex items-center gap-2 no-underline">
            <div className="w-8 h-8 rounded-lg bg-brand-500/20 flex items-center justify-center">
              <Package className="w-4 h-4 text-brand-400" />
            </div>
            <span className="font-bold text-white text-sm">Noship It</span>
          </Link>
          <button onClick={() => setOpen(false)} className="lg:hidden text-surface-400 bg-transparent border-none cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="p-3 space-y-1">
          {navItems.map(item => (
            <Link key={item.path} to={item.path} onClick={() => setOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm no-underline transition-all ${isActive(item.path) ? 'bg-brand-500/10 text-brand-400' : 'text-surface-400 hover:text-white hover:bg-surface-800/50'}`}>
              <item.icon className="w-4 h-4" />
              {item.label}
              {item.label === 'Notifications' && (
                <span className="ml-auto w-5 h-5 rounded-full bg-brand-500 text-[10px] text-white flex items-center justify-center font-bold">5</span>
              )}
            </Link>
          ))}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-surface-800/50">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-900/50 mb-2">
            <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center text-xs font-bold text-brand-400">JD</div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white truncate">Jean Dupont</div>
              <div className="text-[10px] text-surface-500 truncate">jean@exemple.com</div>
            </div>
          </div>
          <Link to="/" className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-surface-500 hover:text-red-400 transition-colors no-underline">
            <LogOut className="w-3.5 h-3.5" /> Déconnexion
          </Link>
        </div>
      </aside>
    </>
  )
}

function KPICard({ icon: Icon, label, value, change, positive = true }) {
  return (
    <div className="p-4 rounded-xl bg-surface-900/50 border border-surface-800/50 card-hover">
      <div className="flex items-center justify-between mb-3">
        <div className="w-9 h-9 rounded-lg bg-brand-500/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-brand-400" />
        </div>
        <span className={`text-xs font-medium ${positive ? 'text-brand-400' : 'text-red-400'}`}>{change}</span>
      </div>
      <div className="text-2xl font-bold text-white mb-0.5">{value}</div>
      <div className="text-xs text-surface-500">{label}</div>
    </div>
  )
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-xs">
      <div className="text-surface-400 mb-1">{label}</div>
      <div className="text-white font-semibold">{payload[0].value.toLocaleString('fr-FR')} €</div>
    </div>
  )
}

function Overview() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Vue d'ensemble</h1>
          <p className="text-sm text-surface-500">Bienvenue, Jean. Voici vos performances du jour.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-surface-500">
          <Clock className="w-3.5 h-3.5" />
          Mis à jour il y a 2 min
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard icon={TrendingUp} label="Chiffre d'affaires" value="9 100 €" change="+18%" />
        <KPICard icon={ShoppingCart} label="Commandes payées" value="47" change="+12%" />
        <KPICard icon={CreditCard} label="Panier moyen" value="194 €" change="+5%" />
        <KPICard icon={Target} label="Taux de conversion" value="3,2%" change="+0,4%" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 p-5 rounded-xl bg-surface-900/50 border border-surface-800/50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Chiffre d'affaires (20 derniers jours)</h3>
            <span className="text-xs text-surface-500">Avant remboursements</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={revenueData}>
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="value" stroke="#10b981" fill="url(#grad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="p-5 rounded-xl bg-surface-900/50 border border-surface-800/50">
          <h3 className="text-sm font-semibold text-white mb-4">Commandes cette semaine</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ordersData}>
              <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                <div className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-xs">
                  <div className="text-surface-400 mb-1">{label}</div>
                  <div className="text-white font-semibold">{payload[0].value} commandes</div>
                </div>
              ) : null} />
              <Bar dataKey="orders" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-5 rounded-xl bg-surface-900/50 border border-surface-800/50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Dernières commandes</h3>
            <span className="text-xs text-brand-400 cursor-pointer hover:text-brand-300">Tout voir</span>
          </div>
          <div className="space-y-3">
            {[
              { id: '#4832', amount: '127 €', time: '3 min', status: 'paid' },
              { id: '#4831', amount: '89 €', time: '2h', status: 'paid' },
              { id: '#4830', amount: '245 €', time: '4h', status: 'paid' },
              { id: '#4829', amount: '67 €', time: '6h', status: 'paid' },
              { id: '#4828', amount: '312 €', time: '8h', status: 'refunded' },
            ].map((o, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-surface-800/30 last:border-0">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${o.status === 'paid' ? 'bg-brand-400' : 'bg-amber-400'}`} />
                  <span className="text-sm text-white font-medium">{o.id}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-white">{o.amount}</span>
                  <span className="text-xs text-surface-500">il y a {o.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-5 rounded-xl bg-surface-900/50 border border-surface-800/50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Notifications récentes</h3>
            <span className="w-5 h-5 rounded-full bg-brand-500 text-[10px] text-white flex items-center justify-center font-bold">{notifications.length}</span>
          </div>
          <div className="space-y-3">
            {notifications.slice(0, 5).map(n => (
              <div key={n.id} className="flex items-start gap-3 py-2 border-b border-surface-800/30 last:border-0">
                <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${n.type === 'order' ? 'bg-brand-400' : n.type === 'alert' ? 'bg-amber-400' : n.type === 'payout' ? 'bg-blue-400' : 'bg-surface-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-surface-300 truncate">{n.msg}</div>
                  <div className="text-xs text-surface-600 mt-0.5">{n.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Stores() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Boutiques</h1>
          <p className="text-sm text-surface-500">{stores.length} boutiques configurées</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500/10 border border-brand-500/30 text-brand-400 text-xs font-medium cursor-pointer hover:bg-brand-500/20 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Boutique vitrine
          </button>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-800/50 border border-surface-700/50 text-surface-300 text-xs font-medium cursor-pointer hover:bg-surface-800 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Boutique backend
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {stores.map(s => (
          <div key={s.id} className="p-5 rounded-xl bg-surface-900/50 border border-surface-800/50 card-hover">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.type === 'vitrine' ? 'bg-blue-500/10' : 'bg-amber-500/10'}`}>
                  <Store className={`w-5 h-5 ${s.type === 'vitrine' ? 'text-blue-400' : 'text-amber-400'}`} />
                </div>
                <div>
                  <div className="text-sm font-medium text-white">{s.name}</div>
                  <div className="text-xs text-surface-500 capitalize">
                    {s.type === 'vitrine' ? 'Boutique vitrine (front)' : 'Boutique d\'offre (backend)'}
                  </div>
                </div>
              </div>
              <button className="text-surface-500 hover:text-surface-300 bg-transparent border-none cursor-pointer">
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-4 mb-4">
              <div className="flex items-center gap-1.5">
                {s.status === 'connected' ? <Wifi className="w-3.5 h-3.5 text-brand-400" /> : <WifiOff className="w-3.5 h-3.5 text-red-400" />}
                <span className={`text-xs ${s.status === 'connected' ? 'text-brand-400' : 'text-red-400'}`}>
                  {s.status === 'connected' ? 'Connectée' : 'Déconnectée'}
                </span>
              </div>
              <div className="text-xs text-surface-500">{s.products} produits</div>
              <div className="text-xs text-surface-500">{s.orders} commandes</div>
            </div>
            <div className="flex gap-2">
              <button className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-surface-800/50 text-xs text-surface-300 hover:text-white cursor-pointer transition-colors border border-surface-700/30">
                <RefreshCw className="w-3 h-3" /> Synchroniser
              </button>
              <button className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-surface-800/50 text-xs text-surface-300 hover:text-white cursor-pointer transition-colors border border-surface-700/30">
                <Eye className="w-3 h-3" /> Voir sur Shopify
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Connections() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Connexions Bridge</h1>
          <p className="text-sm text-surface-500">Reliez vos vitrines à vos backends.</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 text-white text-xs font-semibold cursor-pointer hover:bg-brand-600 transition-colors border-none">
          <Plus className="w-3.5 h-3.5" /> Nouvelle connexion
        </button>
      </div>

      <div className="space-y-4">
        {connections.map(c => (
          <div key={c.id} className="p-5 rounded-xl bg-surface-900/50 border border-surface-800/50 card-hover">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${c.active ? 'bg-brand-400' : 'bg-red-400'}`} />
                <span className="text-xs font-medium text-surface-400">{c.active ? 'Active' : 'Inactive'}</span>
              </div>
              <button className="text-surface-500 hover:text-surface-300 bg-transparent border-none cursor-pointer">
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1 p-3 rounded-lg bg-blue-500/5 border border-blue-500/10">
                <div className="text-xs text-blue-400 mb-1">Vitrine</div>
                <div className="text-sm text-white font-medium truncate">{c.front}</div>
              </div>
              <div className="flex items-center justify-center">
                <ArrowRight className="w-5 h-5 text-brand-400" />
              </div>
              <div className="flex-1 p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
                <div className="text-xs text-amber-400 mb-1">Backend</div>
                <div className="text-sm text-white font-medium truncate">{c.back}</div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-brand-400" />
                <span className="text-xs text-surface-400">{c.matched}/{c.total} produits associés</span>
              </div>
              <div className="w-32 h-1.5 rounded-full bg-surface-800">
                <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(c.matched / c.total) * 100}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="p-5 rounded-xl bg-surface-900/30 border border-dashed border-surface-700/50 text-center">
        <Link2 className="w-8 h-8 text-surface-600 mx-auto mb-3" />
        <p className="text-sm text-surface-500 mb-1">Connectez vos vitrines à vos backends</p>
        <p className="text-xs text-surface-600">Le bridge redirige automatiquement les commandes vers le bon fournisseur.</p>
      </div>
    </div>
  )
}

function Stats() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Statistiques</h1>
          <p className="text-sm text-surface-500">Analyse de performance de vos boutiques.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-800/50 border border-surface-700/50 text-xs text-surface-300 cursor-pointer">
            <Calendar className="w-3.5 h-3.5" /> 30 derniers jours
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-800/50 border border-surface-700/50 text-xs text-surface-300 cursor-pointer">
            <Filter className="w-3.5 h-3.5" /> Toutes les boutiques
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard icon={TrendingUp} label="CA du mois" value="142 800 €" change="+23%" />
        <KPICard icon={ShoppingCart} label="Commandes totales" value="1 247" change="+15%" />
        <KPICard icon={CreditCard} label="Panier moyen" value="114 €" change="+8%" />
        <KPICard icon={Users} label="Clients uniques" value="892" change="+19%" />
      </div>

      <div className="p-5 rounded-xl bg-surface-900/50 border border-surface-800/50">
        <h3 className="text-sm font-semibold text-white mb-4">Évolution du chiffre d'affaires</h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={revenueData}>
            <defs>
              <linearGradient id="grad2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k€`} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="value" stroke="#10b981" fill="url(#grad2)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-5 rounded-xl bg-surface-900/50 border border-surface-800/50">
          <h3 className="text-sm font-semibold text-white mb-4">Tracking publicitaire</h3>
          <div className="space-y-3">
            {[
              { name: 'Meta Pixel', status: 'active', events: '2 847 conversions' },
              { name: 'TikTok Pixel', status: 'active', events: '1 203 conversions' },
              { name: 'Google Ads (GA4)', status: 'active', events: '3 421 conversions' },
              { name: 'Snapchat Pixel', status: 'inactive', events: 'Non configuré' },
            ].map((p, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-surface-800/30 last:border-0">
                <div className="flex items-center gap-3">
                  <Globe className="w-4 h-4 text-surface-500" />
                  <span className="text-sm text-white">{p.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-surface-500">{p.events}</span>
                  <div className={`w-2 h-2 rounded-full ${p.status === 'active' ? 'bg-brand-400' : 'bg-surface-600'}`} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-5 rounded-xl bg-surface-900/50 border border-surface-800/50">
          <h3 className="text-sm font-semibold text-white mb-4">Versements Shopify</h3>
          <div className="space-y-3">
            {[
              { date: '28 sept.', amount: '4 280 €', status: 'paid' },
              { date: '21 sept.', amount: '3 920 €', status: 'paid' },
              { date: '14 sept.', amount: '5 130 €', status: 'paid' },
              { date: '7 sept.', amount: '2 870 €', status: 'paid' },
            ].map((p, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-surface-800/30 last:border-0">
                <span className="text-sm text-surface-400">{p.date}</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-white font-medium">{p.amount}</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Notifications() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Notifications</h1>
          <p className="text-sm text-surface-500">Alertes et récapitulatifs.</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-800/50 border border-surface-700/50 text-xs text-surface-300 cursor-pointer">
            <Smartphone className="w-3.5 h-3.5" /> Configurer Telegram
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {notifications.map(n => (
          <div key={n.id} className="flex items-start gap-4 p-4 rounded-xl bg-surface-900/50 border border-surface-800/50 card-hover">
            <div className={`mt-1 w-3 h-3 rounded-full shrink-0 ${n.type === 'order' ? 'bg-brand-400' : n.type === 'alert' ? 'bg-amber-400' : n.type === 'payout' ? 'bg-blue-400' : 'bg-surface-500'}`} />
            <div className="flex-1">
              <div className="text-sm text-white">{n.msg}</div>
              <div className="text-xs text-surface-500 mt-1">{n.time}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="p-5 rounded-xl bg-surface-900/30 border border-dashed border-surface-700/50">
        <div className="flex items-center gap-3 mb-3">
          <Send className="w-5 h-5 text-brand-400" />
          <h3 className="text-sm font-semibold text-white">Alertes Telegram</h3>
        </div>
        <p className="text-xs text-surface-500 mb-4">
          Un lien privé unique connecte votre compte Telegram à votre espace Noship It.
          Recevez chaque commande, alerte de stock et récapitulatif quotidien.
        </p>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500/10 border border-brand-500/30 text-brand-400 text-xs font-medium cursor-pointer hover:bg-brand-500/20 transition-colors">
          <Send className="w-3.5 h-3.5" /> Connecter Telegram
        </button>
      </div>
    </div>
  )
}

function Support() {
  const [messages, setMessages] = useState([
    { role: 'bot', text: 'Salut ! Je suis Bernie, le pigeon de Noship It. Comment puis-je t\'aider ?' },
  ])
  const [input, setInput] = useState('')

  const sendMessage = () => {
    if (!input.trim()) return
    const userMsg = input.trim()
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setInput('')
    setTimeout(() => {
      setMessages(prev => [...prev, {
        role: 'bot',
        text: 'AI · Je peux me tromper, vérifiez les chiffres dans vos statistiques. Pour cette question, je vous recommande de consulter la section FAQ ou de contacter le support.'
      }])
    }, 1500)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Support</h1>
        <p className="text-sm text-surface-500">Une question, un blocage ? Écrivez-nous.</p>
      </div>

      <div className="rounded-xl bg-surface-900/50 border border-surface-800/50 overflow-hidden">
        <div className="p-4 border-b border-surface-800/50 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center">
            <Bot className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <div className="text-sm font-medium text-white">Bernie</div>
            <div className="text-xs text-surface-500">Assistant IA</div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-brand-400 animate-pulse" />
            <span className="text-xs text-brand-400">En ligne</span>
          </div>
        </div>

        <div className="p-4 h-80 overflow-y-auto space-y-4">
          <div className="flex justify-center mb-4">
            <Mascot size={80} />
          </div>
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${m.role === 'user' ? 'bg-brand-500 text-white rounded-br-md' : 'bg-surface-800 text-surface-300 rounded-bl-md'}`}>
                {m.text}
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-surface-800/50">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder="Posez votre question…"
              className="flex-1 px-4 py-2.5 rounded-xl bg-surface-800/50 border border-surface-700/30 text-white text-sm placeholder:text-surface-600 outline-none focus:border-brand-500/50 transition-all"
            />
            <button onClick={sendMessage}
              className="w-10 h-10 rounded-xl bg-brand-500 hover:bg-brand-600 flex items-center justify-center cursor-pointer transition-colors border-none">
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
          <p className="text-[10px] text-surface-600 mt-2 text-center">
            AI · les réponses peuvent contenir des erreurs, vérifiez les chiffres.
          </p>
        </div>
      </div>
    </div>
  )
}

function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Paramètres</h1>
        <p className="text-sm text-surface-500">Compte et préférences.</p>
      </div>

      <div className="space-y-4">
        <div className="p-5 rounded-xl bg-surface-900/50 border border-surface-800/50">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-brand-400" /> Profil
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-surface-400 mb-1.5">Nom</label>
              <input type="text" defaultValue="Jean Dupont" className="w-full px-4 py-2.5 rounded-xl bg-surface-800/50 border border-surface-700/30 text-white text-sm outline-none focus:border-brand-500/50 transition-all" />
            </div>
            <div>
              <label className="block text-xs text-surface-400 mb-1.5">Email</label>
              <input type="email" defaultValue="jean@exemple.com" className="w-full px-4 py-2.5 rounded-xl bg-surface-800/50 border border-surface-700/30 text-white text-sm outline-none focus:border-brand-500/50 transition-all" />
            </div>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-surface-900/50 border border-surface-800/50">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Shield className="w-4 h-4 text-brand-400" /> Sécurité
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm text-white">Mot de passe</div>
                <div className="text-xs text-surface-500">Dernière modification il y a 3 mois</div>
              </div>
              <button className="px-4 py-2 rounded-lg bg-surface-800/50 border border-surface-700/30 text-xs text-surface-300 cursor-pointer hover:text-white transition-colors">
                Modifier
              </button>
            </div>
            <div className="flex items-center justify-between py-2 border-t border-surface-800/30">
              <div>
                <div className="text-sm text-white flex items-center gap-2">
                  Passkeys
                  <span className="text-xs text-brand-400 bg-brand-500/10 px-2 py-0.5 rounded-full">1 configurée</span>
                </div>
                <div className="text-xs text-surface-500">Demandée à chaque connexion</div>
              </div>
              <button className="px-4 py-2 rounded-lg bg-surface-800/50 border border-surface-700/30 text-xs text-surface-300 cursor-pointer hover:text-white transition-colors">
                Gérer
              </button>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-surface-900/50 border border-surface-800/50">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Send className="w-4 h-4 text-brand-400" /> Telegram
          </h3>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-white">Compte lié</div>
              <div className="text-xs text-surface-500">Alertes et récap quotidien actifs</div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-brand-400" />
              <span className="text-xs text-brand-400">Connecté</span>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-surface-900/50 border border-surface-800/50">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Globe className="w-4 h-4 text-brand-400" /> Tracking publicitaire
          </h3>
          <div className="space-y-3">
            {['Meta Pixel', 'TikTok Pixel', 'Google Ads (GA4)', 'Snapchat Pixel', 'Pinterest'].map((p, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-surface-800/30 last:border-0">
                <span className="text-sm text-white">{p}</span>
                <button className="px-3 py-1.5 rounded-lg bg-surface-800/50 border border-surface-700/30 text-xs text-surface-300 cursor-pointer hover:text-white transition-colors">
                  Configurer
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen bg-[#0a0e0b] flex">
      <Sidebar open={sidebarOpen} setOpen={setSidebarOpen} />

      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-30 glass px-4 py-3 flex items-center gap-3 lg:hidden">
          <button onClick={() => setSidebarOpen(true)} className="text-surface-400 bg-transparent border-none cursor-pointer">
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-white">Noship It</span>
        </header>

        <div className="p-4 sm:p-6 lg:p-8 max-w-6xl">
          <Routes>
            <Route index element={<Overview />} />
            <Route path="stores" element={<Stores />} />
            <Route path="connections" element={<Connections />} />
            <Route path="stats" element={<Stats />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="support" element={<Support />} />
            <Route path="settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
