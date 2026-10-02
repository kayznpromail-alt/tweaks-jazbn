import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X, ArrowRight } from 'lucide-react'
import Mascot from './Mascot'

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const [lang, setLang] = useState('EN')

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0a0e0b]/90 backdrop-blur-md border-b border-[#1a2a1c]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link to="/" className="flex items-center gap-2.5 no-underline">
            <Mascot size={32} />
            <span className="text-lg font-bold text-white">Noship <span className="text-[#a3e635]">It.</span></span>
          </Link>

          <div className="hidden md:flex items-center gap-3">
            <Link to="/signup" className="flex items-center gap-2 text-sm font-medium text-[#a3e635] border border-[#a3e635]/40 hover:bg-[#a3e635]/10 px-4 py-1.5 rounded-full transition-all no-underline">
              Open an account <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <a href="https://t.me/noshipit_bot" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm font-medium text-[#c8d6ca] border border-[#1a2a1c] hover:border-[#2a3d2c] px-4 py-1.5 rounded-full transition-all no-underline">
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#28a8ea]" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
              Contact us
            </a>
            <div className="flex items-center gap-1.5 ml-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#a3e635]" />
              <span className="font-mono text-[10px] tracking-[1.5px] uppercase text-[#5a7a5c]">PRIVATE WORKSPACE</span>
            </div>
            <div className="flex items-center gap-1 ml-2">
              <button onClick={() => setLang('EN')} className={`text-xs px-1 py-0.5 rounded cursor-pointer border-none transition-colors ${lang === 'EN' ? 'text-white bg-[#1a2a1c]' : 'text-[#5a7a5c] bg-transparent hover:text-[#c8d6ca]'}`}>
                EN
              </button>
              <button onClick={() => setLang('FR')} className={`text-xs px-1 py-0.5 rounded cursor-pointer border-none transition-colors ${lang === 'FR' ? 'text-white bg-[#1a2a1c]' : 'text-[#5a7a5c] bg-transparent hover:text-[#c8d6ca]'}`}>
                FR
              </button>
            </div>
          </div>

          <button onClick={() => setOpen(!open)} className="md:hidden text-[#c8d6ca] bg-transparent border-none cursor-pointer">
            {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-[#1a2a1c] bg-[#0a0e0b]/95 backdrop-blur-xl">
          <div className="px-4 py-4 space-y-3">
            <Link to="/signup" onClick={() => setOpen(false)} className="block text-sm text-[#a3e635] no-underline py-1">Open an account</Link>
            <a href="https://t.me/noshipit_bot" onClick={() => setOpen(false)} className="block text-sm text-[#c8d6ca] no-underline py-1">Contact us</a>
            <div className="pt-3 border-t border-[#1a2a1c] flex flex-col gap-2">
              <Link to="/login" className="text-sm text-center text-[#c8d6ca] py-2 no-underline">Log in</Link>
              <Link to="/signup" className="text-sm text-center bg-[#a3e635] text-[#0a0e0b] py-2 rounded-lg no-underline font-medium">Open an account</Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
