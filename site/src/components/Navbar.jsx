import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X, Package } from 'lucide-react'

export default function Navbar() {
  const [open, setOpen] = useState(false)

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2 no-underline">
            <div className="w-9 h-9 rounded-lg bg-brand-500/20 flex items-center justify-center">
              <Package className="w-5 h-5 text-brand-400" />
            </div>
            <span className="text-lg font-bold text-white">Noship It</span>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-surface-400 hover:text-brand-400 transition-colors no-underline">Fonctionnalités</a>
            <a href="#how-it-works" className="text-sm text-surface-400 hover:text-brand-400 transition-colors no-underline">Comment ça marche</a>
            <a href="#pricing" className="text-sm text-surface-400 hover:text-brand-400 transition-colors no-underline">Tarifs</a>
            <a href="#faq" className="text-sm text-surface-400 hover:text-brand-400 transition-colors no-underline">FAQ</a>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Link to="/login" className="text-sm text-surface-300 hover:text-white transition-colors px-4 py-2 no-underline">
              Connexion
            </Link>
            <Link to="/signup" className="text-sm bg-brand-500 hover:bg-brand-600 text-white px-5 py-2 rounded-lg transition-colors no-underline font-medium">
              Demander l'accès
            </Link>
          </div>

          <button onClick={() => setOpen(!open)} className="md:hidden text-surface-400 bg-transparent border-none cursor-pointer">
            {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-surface-800/50 bg-surface-950/95 backdrop-blur-xl">
          <div className="px-4 py-4 space-y-3">
            <a href="#features" onClick={() => setOpen(false)} className="block text-sm text-surface-400 hover:text-brand-400 no-underline py-1">Fonctionnalités</a>
            <a href="#how-it-works" onClick={() => setOpen(false)} className="block text-sm text-surface-400 hover:text-brand-400 no-underline py-1">Comment ça marche</a>
            <a href="#pricing" onClick={() => setOpen(false)} className="block text-sm text-surface-400 hover:text-brand-400 no-underline py-1">Tarifs</a>
            <a href="#faq" onClick={() => setOpen(false)} className="block text-sm text-surface-400 hover:text-brand-400 no-underline py-1">FAQ</a>
            <div className="pt-3 border-t border-surface-800/50 flex flex-col gap-2">
              <Link to="/login" className="text-sm text-center text-surface-300 py-2 no-underline">Connexion</Link>
              <Link to="/signup" className="text-sm text-center bg-brand-500 text-white py-2 rounded-lg no-underline font-medium">Demander l'accès</Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
