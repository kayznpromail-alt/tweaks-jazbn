export default function Mascot({ size = 200, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none" className={className}>
      {/* Body */}
      <ellipse cx="100" cy="120" rx="50" ry="45" fill="#475569" />
      <ellipse cx="100" cy="118" rx="47" ry="42" fill="#64748b" />
      {/* Belly */}
      <ellipse cx="100" cy="125" rx="30" ry="28" fill="#94a3b8" />
      {/* Head */}
      <circle cx="100" cy="72" r="30" fill="#64748b" />
      <circle cx="100" cy="70" r="28" fill="#94a3b8" />
      {/* Eyes */}
      <circle cx="88" cy="65" r="6" fill="white" />
      <circle cx="112" cy="65" r="6" fill="white" />
      <circle cx="89" cy="64" r="3" fill="#0f172a" />
      <circle cx="113" cy="64" r="3" fill="#0f172a" />
      <circle cx="90" cy="63" r="1" fill="white" />
      <circle cx="114" cy="63" r="1" fill="white" />
      {/* Beak */}
      <path d="M95 72 L100 80 L105 72 Z" fill="#f59e0b" />
      {/* Headphones */}
      <path d="M68 60 Q68 40 100 38 Q132 40 132 60" stroke="#10b981" strokeWidth="4" fill="none" strokeLinecap="round" />
      <rect x="62" y="55" width="12" height="16" rx="4" fill="#10b981" />
      <rect x="126" y="55" width="12" height="16" rx="4" fill="#10b981" />
      <rect x="64" y="57" width="8" height="12" rx="3" fill="#059669" />
      <rect x="128" y="57" width="8" height="12" rx="3" fill="#059669" />
      {/* Wings */}
      <ellipse cx="55" cy="115" rx="15" ry="25" fill="#64748b" transform="rotate(-15 55 115)" />
      <ellipse cx="145" cy="115" rx="15" ry="25" fill="#64748b" transform="rotate(15 145 115)" />
      {/* Feet with slippers */}
      <rect x="75" y="158" width="22" height="10" rx="5" fill="#10b981" />
      <rect x="103" y="158" width="22" height="10" rx="5" fill="#10b981" />
      <circle cx="77" cy="163" r="3" fill="#059669" />
      <circle cx="105" cy="163" r="3" fill="#059669" />
      {/* Parcel underneath */}
      <rect x="60" y="170" width="80" height="25" rx="3" fill="#92400e" />
      <rect x="62" y="172" width="76" height="21" rx="2" fill="#b45309" />
      <line x1="100" y1="172" x2="100" y2="193" stroke="#92400e" strokeWidth="2" />
      <line x1="62" y1="182" x2="138" y2="182" stroke="#92400e" strokeWidth="2" />
      <text x="100" y="190" textAnchor="middle" fontSize="7" fill="#fbbf24" fontWeight="bold">NOSHIP</text>
      {/* Zzz */}
      <text x="135" y="50" fontSize="12" fill="#10b981" opacity="0.7" fontWeight="bold">z</text>
      <text x="145" y="42" fontSize="10" fill="#10b981" opacity="0.5" fontWeight="bold">z</text>
      <text x="152" y="36" fontSize="8" fill="#10b981" opacity="0.3" fontWeight="bold">z</text>
    </svg>
  )
}
