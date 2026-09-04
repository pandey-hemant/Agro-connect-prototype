/**
 * components/CropImage.jsx — on-brand crop visual system.
 *
 * Each crop name is mapped to a hand-illustrated SVG composition that
 * actually looks like the crop (not a generic seedling emoji). All
 * illustrations live in a 0..100 viewBox and use a fixed palette
 * (deep ink + warm crop colour) so the tile set reads as one product.
 *
 * Usage:
 *   <CropImage crop="Onion" />
 *   <CropImage crop="Tomato" className="h-24 w-24" />
 *   <CropImage crop="Wheat" showName />
 *
 * Accessibility:
 *   - root element has role="img" + aria-label so screen readers
 *     announce the crop, not the SVG.
 *   - decorative inner SVG is aria-hidden.
 *
 * Lookup:
 *   - exact key first ("onion", "tomato", ...)
 *   - then substring match ("red onion" -> onion)
 *   - falls back to a neutral "harvest" tile so unknown crops still
 *     look intentional, never broken.
 */
import { useMemo } from 'react'

// Two-stop warm gradient per crop — gives the tile its identity.
const CROP_TILES = {
  onion:       { g: ['#fbe9d8', '#e8b89a'], accent: '#c46a4a' },
  tomato:      { g: ['#fde3dc', '#f3a48a'], accent: '#c43822' },
  potato:      { g: ['#f3e6c8', '#caa97a'], accent: '#8a6235' },
  wheat:       { g: ['#fbf1cf', '#e6c35a'], accent: '#9b6f1a' },
  rice:        { g: ['#ecf4dc', '#bfd089'], accent: '#5b7a2c' },
  paddy:       { g: ['#ecf4dc', '#bfd089'], accent: '#5b7a2c' },
  maize:       { g: ['#fbe9a8', '#e9b237'], accent: '#a06a14' },
  corn:        { g: ['#fbe9a8', '#e9b237'], accent: '#a06a14' },
  soybean:     { g: ['#eef3d6', '#a8bf5b'], accent: '#4f6a1a' },
  cotton:      { g: ['#f1ece1', '#c4b896'], accent: '#6e5d3a' },
  sugarcane:   { g: ['#dcecc6', '#7fb069'], accent: '#3e6a26' },
  groundnut:   { g: ['#f4dec1', '#c89172'], accent: '#6a3e1f' },
  chilli:      { g: ['#fbd6c2', '#d8593a'], accent: '#8a2210' },
  chili:       { g: ['#fbd6c2', '#d8593a'], accent: '#8a2210' },
  turmeric:    { g: ['#fbe1a4', '#cf861e'], accent: '#7a4a0a' },
  ginger:      { g: ['#f4dec1', '#c89172'], accent: '#6a3e1f' },
  garlic:      { g: ['#f1ece1', '#d6c79b'], accent: '#7a6a3e' },
  mango:       { g: ['#fde3a0', '#e3a437'], accent: '#8a5a0a' },
  banana:      { g: ['#fbe9a8', '#e9c344'], accent: '#7a5a0a' },
  apple:       { g: ['#fbd6c2', '#c43822'], accent: '#7a1810' },
  grape:       { g: ['#e6dff0', '#8a6db3'], accent: '#3e2a5a' },
  cauliflower: { g: ['#f1ece1', '#b9b09a'], accent: '#6a624a' },
  cabbage:     { g: ['#dcecc6', '#7fb069'], accent: '#3e6a26' },
  spinach:     { g: ['#cde0a6', '#5e8a3e'], accent: '#2a4a1a' },
  carrot:      { g: ['#fbe1a4', '#d6833a'], accent: '#7a3a0a' },
  brinjal:     { g: ['#e3dcf0', '#7a5fb0'], accent: '#3a1f6a' },
  eggplant:    { g: ['#e3dcf0', '#7a5fb0'], accent: '#3a1f6a' },
  okra:        { g: ['#dcecc6', '#7fb069'], accent: '#3e6a26' },
  ladyfinger:  { g: ['#dcecc6', '#7fb069'], accent: '#3e6a26' },
  peas:        { g: ['#cde0a6', '#7fb069'], accent: '#3e6a26' },
  lentil:      { g: ['#f4dec1', '#b3854a'], accent: '#5a3a1a' },
  mustard:     { g: ['#fbe9a8', '#e9b237'], accent: '#7a5a0a' },
}

const DEFAULT_TILE = { g: ['#f3ede1', '#d3c5a8'], accent: '#6a5d3a' }

// Common shadow ellipse used under each illustration to ground it
// in the tile. Slight transparency so it doesn't fight the gradient.
function GroundShadow({ cy = 84, rx = 28, opacity = 0.18 }) {
  return (
    <ellipse
      cx="50"
      cy={cy}
      rx={rx}
      ry="4"
      fill="#000"
      opacity={opacity}
    />
  )
}

/* ----------------------------- Illustrations ----------------------------- */
// Each illustration is composed in a 0..100 viewBox.
// They use accent colour (the crop's signature colour) + deep ink for
// outlines + a soft white/cream highlight so the shape reads as
// three-dimensional even at small sizes.

function OnionArt({ c }) {
  return (
    <g>
      <GroundShadow cy={86} rx={26} />
      {/* Outer onion bulb */}
      <path
        d="M50 18 C30 22 22 40 22 56 C22 74 34 86 50 86 C66 86 78 74 78 56 C78 40 70 22 50 18 Z"
        fill="#fff"
        stroke={c}
        strokeWidth="2.5"
      />
      {/* Body shading - left half darker */}
      <path
        d="M50 18 C30 22 22 40 22 56 C22 74 34 86 50 86 C66 86 78 74 78 56 C78 40 70 22 50 18 Z"
        fill={c}
        opacity="0.18"
      />
      {/* Concentric layer lines */}
      <path d="M50 28 C36 32 32 48 36 64 C40 76 50 80 50 80 C50 80 60 76 64 64 C68 48 64 32 50 28 Z"
        fill="none" stroke={c} strokeWidth="1" opacity="0.5" />
      <path d="M50 38 C42 42 40 56 44 68 C46 74 50 76 50 76 C50 76 54 74 56 68 C60 56 58 42 50 38 Z"
        fill="none" stroke={c} strokeWidth="0.8" opacity="0.45" />
      {/* Highlight */}
      <ellipse cx="38" cy="38" rx="4" ry="8" fill="#fff" opacity="0.5" />
      {/* Sprout tops */}
      <path d="M50 18 L50 8" stroke="#5b7a2c" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M44 18 L42 6 M56 18 L58 6" stroke="#5b7a2c" strokeWidth="2" strokeLinecap="round" />
    </g>
  )
}

function TomatoArt({ c }) {
  return (
    <g>
      <GroundShadow cy={86} rx={30} />
      {/* Body */}
      <circle cx="50" cy="58" r="28" fill={c} stroke={c} strokeWidth="2" />
      {/* Highlight */}
      <ellipse cx="38" cy="44" rx="8" ry="12" fill="#fff" opacity="0.35" />
      {/* Body shading */}
      <path
        d="M70 50 C76 70 60 84 46 84 C58 80 70 70 70 50 Z"
        fill="#000"
        opacity="0.12"
      />
      {/* Leafy calyx */}
      <path d="M50 30 L42 22 L46 30 L38 26 L46 32 L40 36 L48 34 L50 40 L52 34 L60 36 L54 32 L62 26 L54 30 L58 22 Z"
        fill="#5b7a2c" stroke="#3e5a1a" strokeWidth="1" strokeLinejoin="round" />
      <circle cx="50" cy="30" r="2" fill="#3e5a1a" />
    </g>
  )
}

function PotatoArt({ c }) {
  return (
    <g>
      <GroundShadow cy={84} rx={32} />
      {/* Lumpy potato shape */}
      <path
        d="M22 50 C20 36 32 22 48 22 C66 22 80 32 82 48 C84 64 74 80 56 82 C40 84 24 76 22 62 C20 58 22 54 22 50 Z"
        fill="#c8a36e"
        stroke={c}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Highlight */}
      <path d="M32 36 C40 30 50 32 54 38 C46 38 36 44 32 50 Z" fill="#fff" opacity="0.35" />
      {/* Eyes (sprouts) */}
      <ellipse cx="36" cy="48" rx="3" ry="2" fill={c} opacity="0.6" />
      <ellipse cx="56" cy="42" rx="3" ry="2" fill={c} opacity="0.6" />
      <ellipse cx="66" cy="58" rx="3" ry="2" fill={c} opacity="0.6" />
      <ellipse cx="44" cy="68" rx="3" ry="2" fill={c} opacity="0.6" />
      <ellipse cx="60" cy="72" rx="3" ry="2" fill={c} opacity="0.6" />
    </g>
  )
}

function WheatArt({ c }) {
  return (
    <g>
      <GroundShadow cy={88} rx={18} />
      {/* Central stalk */}
      <line x1="50" y1="20" x2="50" y2="86" stroke="#5b7a2c" strokeWidth="2.5" strokeLinecap="round" />
      {/* 6 pairs of grain spikelets going up the stalk */}
      {[28, 38, 48, 58, 68, 78].map((y, i) => (
        <g key={i}>
          <ellipse cx="38" cy={y} rx="6" ry="3" fill={c} stroke={c} strokeWidth="1" transform={`rotate(-30 38 ${y})`} />
          <ellipse cx="62" cy={y} rx="6" ry="3" fill={c} stroke={c} strokeWidth="1" transform={`rotate(30 62 ${y})`} />
          {/* Awns (whiskers) */}
          <line x1="34" y1={y - 3} x2="28" y2={y - 8} stroke={c} strokeWidth="1" opacity="0.6" />
          <line x1="66" y1={y - 3} x2="72" y2={y - 8} stroke={c} strokeWidth="1" opacity="0.6" />
        </g>
      ))}
      {/* Top kernel */}
      <ellipse cx="50" cy="20" rx="4" ry="6" fill={c} />
      {/* Awn whiskers at top */}
      <line x1="50" y1="14" x2="50" y2="6" stroke={c} strokeWidth="1" strokeLinecap="round" />
      <line x1="48" y1="16" x2="44" y2="10" stroke={c} strokeWidth="1" strokeLinecap="round" />
      <line x1="52" y1="16" x2="56" y2="10" stroke={c} strokeWidth="1" strokeLinecap="round" />
    </g>
  )
}

function RiceArt({ c }) {
  return (
    <g>
      <GroundShadow cy={88} rx={20} />
      {/* Three drooping panicle stalks */}
      {[0, 1, 2].map((i) => {
        const cx = 30 + i * 20
        return (
          <g key={i}>
            <path
              d={`M${cx} 20 Q ${cx - 4} 50 ${cx - 6} 80`}
              stroke="#5b7a2c"
              strokeWidth="1.5"
              fill="none"
            />
            {/* Rice grains along the stalk */}
            {Array.from({ length: 7 }).map((_, j) => {
              const t = j / 7
              const gx = cx - 6 * t
              const gy = 28 + 52 * t
              return (
                <ellipse
                  key={j}
                  cx={gx}
                  cy={gy}
                  rx="2.5"
                  ry="4"
                  fill={c}
                  stroke={c}
                  strokeWidth="0.5"
                  transform={`rotate(-30 ${gx} ${gy})`}
                />
              )
            })}
          </g>
        )
      })}
    </g>
  )
}

function MaizeArt({ c }) {
  return (
    <g>
      <GroundShadow cy={88} rx={22} />
      {/* Husk (green leaves) peeled back */}
      <path
        d="M50 30 C30 36 22 60 28 86 L36 84 C32 64 38 44 50 38 Z"
        fill="#7fb069"
        stroke="#3e6a26"
        strokeWidth="1.5"
      />
      <path
        d="M50 30 C70 36 78 60 72 86 L64 84 C68 64 62 44 50 38 Z"
        fill="#7fb069"
        stroke="#3e6a26"
        strokeWidth="1.5"
      />
      {/* Cob (yellow) */}
      <ellipse cx="50" cy="58" rx="14" ry="28" fill={c} stroke={c} strokeWidth="1.5" />
      {/* Kernel grid */}
      {Array.from({ length: 6 }).map((_, row) =>
        Array.from({ length: 4 }).map((_, col) => {
          const y = 36 + row * 9
          const x = 42 + col * 5 + (row % 2 === 0 ? 0 : 2.5)
          return (
            <circle
              key={`${row}-${col}`}
              cx={x}
              cy={y}
              r="1.8"
              fill="#fff"
              opacity="0.4"
            />
          )
        })
      )}
      {/* Silk at top */}
      <path d="M50 28 C46 24 42 18 40 14 M50 28 C50 22 50 14 50 8 M50 28 C54 24 58 18 60 14" stroke="#caa97a" strokeWidth="1" fill="none" />
    </g>
  )
}

function SoybeanArt({ c }) {
  return (
    <g>
      <GroundShadow cy={86} rx={28} />
      {/* Leafy plant backdrop */}
      <path
        d="M50 18 C40 26 36 40 38 56 C30 50 22 56 22 64 C32 60 38 64 42 70 C44 78 50 80 50 80 Z"
        fill="#7fb069"
        opacity="0.7"
      />
      <path
        d="M50 18 C60 26 64 40 62 56 C70 50 78 56 78 64 C68 60 62 64 58 70 C56 78 50 80 50 80 Z"
        fill="#7fb069"
        opacity="0.7"
      />
      {/* Pods - 3 of them */}
      <g stroke={c} strokeWidth="1.5" fill={c}>
        <ellipse cx="32" cy="68" rx="8" ry="4" transform="rotate(-25 32 68)" />
        <ellipse cx="50" cy="76" rx="9" ry="4.5" />
        <ellipse cx="68" cy="68" rx="8" ry="4" transform="rotate(25 68 68)" />
      </g>
      {/* Bean bumps inside pod */}
      <circle cx="30" cy="68" r="1.5" fill="#fff" opacity="0.5" />
      <circle cx="48" cy="76" r="1.5" fill="#fff" opacity="0.5" />
      <circle cx="70" cy="68" r="1.5" fill="#fff" opacity="0.5" />
    </g>
  )
}

function CottonArt({ c }) {
  return (
    <g>
      <GroundShadow cy={86} rx={26} />
      {/* Stem */}
      <line x1="50" y1="22" x2="50" y2="86" stroke="#5b7a2c" strokeWidth="2.5" />
      {/* Three cotton bolls at branch tips */}
      <g>
        {/* Left boll */}
        <line x1="50" y1="40" x2="32" y2="34" stroke="#5b7a2c" strokeWidth="2" />
        <circle cx="28" cy="34" r="10" fill="#fff" stroke={c} strokeWidth="1.5" />
        <path d="M22 30 L28 26 M28 26 L34 30 M28 26 L28 38" stroke={c} strokeWidth="1" />
        {/* Right boll */}
        <line x1="50" y1="54" x2="70" y2="48" stroke="#5b7a2c" strokeWidth="2" />
        <circle cx="74" cy="48" r="10" fill="#fff" stroke={c} strokeWidth="1.5" />
        <path d="M68 44 L74 40 M74 40 L80 44 M74 40 L74 52" stroke={c} strokeWidth="1" />
        {/* Bottom centre boll - biggest */}
        <circle cx="50" cy="70" r="12" fill="#fff" stroke={c} strokeWidth="1.5" />
        <path d="M42 64 L50 58 M50 58 L58 64 M50 58 L50 76" stroke={c} strokeWidth="1" />
        {/* Cotton fluffy texture dots */}
        <circle cx="46" cy="68" r="2" fill={c} opacity="0.15" />
        <circle cx="54" cy="72" r="2" fill={c} opacity="0.15" />
      </g>
    </g>
  )
}

function SugarcaneArt({ c }) {
  return (
    <g>
      <GroundShadow cy={88} rx={24} />
      {/* Three stalks with nodes */}
      <g>
        <rect x="34" y="14" width="10" height="72" rx="2" fill={c} stroke={c} strokeWidth="1.5" />
        <line x1="34" y1="30" x2="44" y2="30" stroke="#3e5a1a" strokeWidth="1" />
        <line x1="34" y1="50" x2="44" y2="50" stroke="#3e5a1a" strokeWidth="1" />
        <line x1="34" y1="70" x2="44" y2="70" stroke="#3e5a1a" strokeWidth="1" />
        <line x1="38" y1="16" x2="38" y2="84" stroke="#fff" opacity="0.3" strokeWidth="1.5" />
      </g>
      <g>
        <rect x="46" y="10" width="10" height="76" rx="2" fill={c} stroke={c} strokeWidth="1.5" />
        <line x1="46" y1="28" x2="56" y2="28" stroke="#3e5a1a" strokeWidth="1" />
        <line x1="46" y1="48" x2="56" y2="48" stroke="#3e5a1a" strokeWidth="1" />
        <line x1="46" y1="68" x2="56" y2="68" stroke="#3e5a1a" strokeWidth="1" />
        <line x1="50" y1="12" x2="50" y2="84" stroke="#fff" opacity="0.3" strokeWidth="1.5" />
      </g>
      <g>
        <rect x="58" y="16" width="10" height="70" rx="2" fill={c} stroke={c} strokeWidth="1.5" />
        <line x1="58" y1="32" x2="68" y2="32" stroke="#3e5a1a" strokeWidth="1" />
        <line x1="58" y1="52" x2="68" y2="52" stroke="#3e5a1a" strokeWidth="1" />
        <line x1="58" y1="72" x2="68" y2="72" stroke="#3e5a1a" strokeWidth="1" />
        <line x1="62" y1="18" x2="62" y2="84" stroke="#fff" opacity="0.3" strokeWidth="1.5" />
      </g>
      {/* Leafy tops */}
      <path d="M50 10 Q 40 4 32 8 Q 38 14 50 14 Z" fill="#5b7a2c" />
      <path d="M52 8 Q 62 2 70 6 Q 64 12 52 12 Z" fill="#5b7a2c" />
    </g>
  )
}

function GenericBeanArt({ c }) {
  return (
    <g>
      <GroundShadow cy={86} rx={22} />
      <path
        d="M30 50 C24 36 36 22 50 22 C64 22 76 36 70 50 C64 64 36 64 30 50 Z"
        fill={c}
        stroke={c}
        strokeWidth="2"
      />
      <path
        d="M50 26 C44 36 44 60 50 70"
        stroke="#fff"
        strokeWidth="1.5"
        fill="none"
        opacity="0.4"
      />
      <ellipse cx="42" cy="36" rx="3" ry="6" fill="#fff" opacity="0.3" />
    </g>
  )
}

function GenericRootArt({ c }) {
  return (
    <g>
      <GroundShadow cy={86} rx={22} />
      <path
        d="M50 18 C40 22 36 30 36 40 C36 56 42 80 50 80 C58 80 64 56 64 40 C64 30 60 22 50 18 Z"
        fill={c}
        stroke={c}
        strokeWidth="2"
      />
      <path
        d="M50 26 L50 76"
        stroke="#fff"
        strokeWidth="1"
        opacity="0.3"
      />
      {/* Sprout top */}
      <path d="M50 18 L50 8 M46 14 L42 4 M54 14 L58 4" stroke="#5b7a2c" strokeWidth="2" strokeLinecap="round" fill="none" />
    </g>
  )
}

function GenericChilliArt({ c }) {
  return (
    <g>
      <GroundShadow cy={86} rx={22} />
      <path
        d="M30 30 C24 40 28 60 50 78 C72 60 76 40 70 30 C64 22 36 22 30 30 Z"
        fill={c}
        stroke={c}
        strokeWidth="2"
      />
      <ellipse cx="42" cy="38" rx="3" ry="6" fill="#fff" opacity="0.3" transform="rotate(-30 42 38)" />
      <path d="M50 22 L50 12 M46 22 L42 12 M54 22 L58 12" stroke="#5b7a2c" strokeWidth="2" strokeLinecap="round" fill="none" />
    </g>
  )
}

function GenericFlowerArt({ c }) {
  return (
    <g>
      <GroundShadow cy={86} rx={22} />
      <line x1="50" y1="50" x2="50" y2="86" stroke="#5b7a2c" strokeWidth="2.5" />
      {[0, 60, 120, 180, 240, 300].map((deg, i) => (
        <ellipse
          key={i}
          cx="50"
          cy="32"
          rx="8"
          ry="14"
          fill="#fff"
          stroke={c}
          strokeWidth="1.5"
          transform={`rotate(${deg} 50 50)`}
        />
      ))}
      <circle cx="50" cy="50" r="6" fill={c} />
      <circle cx="50" cy="50" r="2" fill="#fff" opacity="0.5" />
    </g>
  )
}

function GenericStalkArt({ c }) {
  return (
    <g>
      <GroundShadow cy={86} rx={18} />
      <line x1="50" y1="14" x2="50" y2="86" stroke="#5b7a2c" strokeWidth="2.5" />
      {[26, 38, 50, 62, 74].map((y, i) => (
        <g key={i}>
          <path d={`M50 ${y} Q ${i % 2 ? 70 : 30} ${y - 4} ${i % 2 ? 76 : 24} ${y - 10}`} fill={c} stroke={c} strokeWidth="1" />
          <path d={`M50 ${y} L 50 ${y - 8}`} stroke="#5b7a2c" strokeWidth="1.5" />
        </g>
      ))}
    </g>
  )
}

function GenericLeafArt({ c }) {
  return (
    <g>
      <GroundShadow cy={86} rx={28} />
      <path
        d="M14 80 C18 50 38 22 78 22 C72 50 50 78 14 80 Z"
        fill={c}
        stroke={c}
        strokeWidth="2"
      />
      <path d="M14 80 L78 22" stroke="#fff" strokeWidth="1.5" opacity="0.5" />
      <path d="M28 64 L50 50 M36 50 L60 38 M50 32 L66 30" stroke={c} strokeWidth="0.8" opacity="0.4" fill="none" />
    </g>
  )
}

function GenericFruitArt({ c }) {
  return (
    <g>
      <GroundShadow cy={86} rx={26} />
      <ellipse cx="50" cy="56" rx="24" ry="28" fill={c} stroke={c} strokeWidth="2" />
      <ellipse cx="40" cy="44" rx="6" ry="10" fill="#fff" opacity="0.3" />
      <path d="M50 28 Q 46 20 48 14 Q 52 18 50 28 Z" fill="#5b7a2c" />
      <line x1="50" y1="28" x2="50" y2="34" stroke="#3e5a1a" strokeWidth="2" />
    </g>
  )
}

function DefaultArt({ c }) {
  // Neutral "harvest" — a leafy plant in primary green. Used for any
  // unknown crop, so the tile never looks broken.
  return (
    <g>
      <GroundShadow cy={86} rx={22} />
      <line x1="50" y1="80" x2="50" y2="44" stroke="#5b7a2c" strokeWidth="2.5" strokeLinecap="round" />
      {/* Two large leaves */}
      <path d="M50 60 C30 56 18 44 18 28 C32 30 46 42 50 56 Z" fill="#5b7a2c" />
      <path d="M50 60 C70 56 82 44 82 28 C68 30 54 42 50 56 Z" fill="#5b7a2c" />
      <path d="M50 44 C50 36 50 24 50 14" stroke="#5b7a2c" strokeWidth="1.5" />
      {/* Top sprout */}
      <path d="M50 14 C44 10 40 6 36 4 C42 12 46 14 50 16 Z" fill="#7fb069" />
      <path d="M50 14 C56 10 60 6 64 4 C58 12 54 14 50 16 Z" fill="#7fb069" />
    </g>
  )
}

const ART_FOR_GLYPH = {
  onion: OnionArt,
  tomato: TomatoArt,
  potato: PotatoArt,
  wheat: WheatArt,
  grain: RiceArt,
  rice: RiceArt,
  bean: GenericBeanArt,
  soybean: GenericBeanArt,
  flower: GenericFlowerArt,
  cotton: CottonArt,
  stalk: GenericStalkArt,
  sugarcane: GenericStalkArt,
  maize: MaizeArt,
  corn: MaizeArt,
  root: GenericRootArt,
  chilli: GenericChilliArt,
  chili: GenericChilliArt,
  leaf: GenericLeafArt,
  fruit: GenericFruitArt,
  default: DefaultArt,
}

function lookup(cropName) {
  if (!cropName) return DEFAULT_TILE
  const key = String(cropName).trim().toLowerCase()
  if (CROP_TILES[key]) return CROP_TILES[key]
  // Substring match: "red onion" still finds "onion".
  for (const k of Object.keys(CROP_TILES)) {
    if (key.includes(k)) return CROP_TILES[k]
  }
  return DEFAULT_TILE
}

export default function CropImage({
  crop,
  className = '',
  showName = false,
  label = '',
  size = 'md',
}) {
  const tile = useMemo(() => lookup(crop), [crop])
  const [from, to] = tile.g
  const accent = tile.accent
  const art = ART_FOR_GLYPH[crop?.toLowerCase()] || DefaultArt
  // Some glyphs are mapped via lookup match — pick art by exact tile glyph
  // (e.g. 'grain' key maps to rice art, 'stalk' to stalk art, etc.)
  const artName = (() => {
    if (!crop) return 'default'
    const k = String(crop).trim().toLowerCase()
    if (ART_FOR_GLYPH[k]) return k
    for (const cand of Object.keys(ART_FOR_GLYPH)) {
      if (k.includes(cand)) return cand
    }
    return 'default'
  })()
  const ArtComponent = ART_FOR_GLYPH[artName] || DefaultArt
  const id = useMemo(
    () => `cg-${(crop || 'x').toString().replace(/\s+/g, '-')}`,
    [crop],
  )

  // Optional size hint: sm removes the showName text anchor so it
  // can be used inside tight grids; md is default.
  const textSizeClass =
    size === 'sm' ? 'text-[10px]' : 'text-xs'

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-card ${className}`}
      style={{
        background: `linear-gradient(155deg, ${from} 0%, ${to} 100%)`,
      }}
      role="img"
      aria-label={label || crop || 'Crop'}
    >
      <svg
        viewBox="0 0 100 100"
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {/* Soft top-left sheen so the gradient doesn't feel flat */}
        <defs>
          <radialGradient id={`${id}-sheen`} cx="30%" cy="20%" r="60%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#${id}-sheen)`} />
        <g>
          <ArtComponent c={accent} />
        </g>
      </svg>
      {showName && (
        <span
          className={`absolute bottom-1.5 left-1.5 right-1.5 truncate rounded bg-black/15 px-1.5 py-0.5 text-center font-medium text-white shadow-sm backdrop-blur-sm ${textSizeClass}`}
        >
          {crop}
        </span>
      )}
    </div>
  )
}
