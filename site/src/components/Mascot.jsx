export default function Mascot({ size = 200, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none" className={className}>
      {/* Parcel */}
      <rect x="55" y="152" width="90" height="30" rx="4" fill="#5c4a1e" />
      <rect x="57" y="154" width="86" height="26" rx="3" fill="#7a6324" />
      <line x1="100" y1="154" x2="100" y2="180" stroke="#5c4a1e" strokeWidth="2" />
      <line x1="57" y1="167" x2="143" y2="167" stroke="#5c4a1e" strokeWidth="2" />
      <text x="100" y="176" textAnchor="middle" fontSize="8" fill="#c8a62e" fontWeight="bold" fontFamily="monospace">noship</text>
      {/* Body */}
      <ellipse cx="100" cy="115" rx="42" ry="40" fill="#3d5e3f" />
      <ellipse cx="100" cy="113" rx="39" ry="37" fill="#4a7a4d" />
      {/* Belly */}
      <ellipse cx="100" cy="120" rx="25" ry="24" fill="#7aab7d" />
      {/* Wings */}
      <ellipse cx="60" cy="108" rx="14" ry="28" fill="#3d5e3f" transform="rotate(-10 60 108)" />
      <ellipse cx="140" cy="108" rx="14" ry="28" fill="#3d5e3f" transform="rotate(10 140 108)" />
      {/* Feet / slippers */}
      <rect x="74" y="148" width="20" height="9" rx="4.5" fill="#a3e635" />
      <rect x="106" y="148" width="20" height="9" rx="4.5" fill="#a3e635" />
      <circle cx="77" cy="152" r="2.5" fill="#84cc16" />
      <circle cx="109" cy="152" r="2.5" fill="#84cc16" />
      {/* Head */}
      <circle cx="100" cy="65" r="28" fill="#4a7a4d" />
      <circle cx="100" cy="63" r="26" fill="#7aab7d" />
      {/* Eyes */}
      <ellipse cx="88" cy="58" rx="7" ry="7.5" fill="white" />
      <ellipse cx="112" cy="58" rx="7" ry="7.5" fill="white" />
      <circle cx="90" cy="57" r="4" fill="#1a2e05" />
      <circle cx="114" cy="57" r="4" fill="#1a2e05" />
      <circle cx="91.5" cy="55.5" r="1.5" fill="white" />
      <circle cx="115.5" cy="55.5" r="1.5" fill="white" />
      {/* Beak */}
      <path d="M94 68 L100 77 L106 68 Z" fill="#e5a825" />
      <path d="M96 68 L100 74 L104 68 Z" fill="#f0c040" />
      {/* Headphones band */}
      <path d="M70 55 Q70 30 100 28 Q130 30 130 55" stroke="#a3e635" strokeWidth="5" fill="none" strokeLinecap="round" />
      {/* Headphone cups */}
      <rect x="62" y="48" width="14" height="18" rx="5" fill="#a3e635" />
      <rect x="124" y="48" width="14" height="18" rx="5" fill="#a3e635" />
      <rect x="64" y="50" width="10" height="14" rx="4" fill="#84cc16" />
      <rect x="126" y="50" width="10" height="14" rx="4" fill="#84cc16" />
      {/* Headphone inner detail */}
      <rect x="66" y="53" width="6" height="8" rx="3" fill="#65a30d" />
      <rect x="128" y="53" width="6" height="8" rx="3" fill="#65a30d" />
    </svg>
  )
}
