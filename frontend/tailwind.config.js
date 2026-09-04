/** @type {import('tailwindcss').Config} */
//
// AGROCONNECT DESIGN SYSTEM
// ---------------------------------------------------------------------------
// Token rationale (deliberate — not "vibe-coded"):
//
//   primary  — deep agricultural green. Anchors the brand. Never neon, never
//              gradient. Used for the AppBar, primary CTAs, selected states,
//              positive trends. The 50–900 ramp goes from a near-white
//              parchment at 50 to a dark forest at 900.
//
//   earth    — warm earthy neutrals. Parchment / clay / soil. The "ground"
//              the green grows out of. Used for the page background (50),
//              card surfaces, dividers, and disabled states.
//
//   honey    — muted yellow / golden accent. Used sparingly for cautions,
//              amber alerts, the "demo data" badge, and a single accent
//              glyph. NOT a primary action color.
//
//   rust     — desaturated terracotta. Only for "sell now", destructive
//              actions, and rejection badges. Warm, not alarming.
//
//   success  — slightly bluer green than primary, reserved for "you earned
//              this" / positive outcome chips (e.g. "SELL_NOW" decision,
//              an accepted offer).
//
//   ink      — text color scale. 900 is the default body color, 700 is
//              secondary, 500 is muted, 400 is placeholder. The scale
//              keeps 4.5:1 contrast on the lightest backgrounds (WCAG AA).
//
// Typography uses two type families:
//   - "Fraunces"  (serif) for headlines, the brand wordmark, and any
//                  "human" / editorial moment (greetings, decision labels).
//   - "Inter"     (sans) for body, forms, tables, dense UI.
//
// Motion is calibrated for trust — small distances, slow easing. The
// `transition-*` keys map to a single easing curve so all motion feels
// the same.
//
// The dark variant is intentionally NOT primary; the app is a daytime
// farming tool. Tokens are still exposed so future dark mode is a
// one-line decision.
// ---------------------------------------------------------------------------
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Deep agricultural green — the brand anchor.
        primary: {
          50:  '#f1f8f1',
          100: '#dcecdc',
          200: '#b9d9b9',
          300: '#8abf8a',
          400: '#5a9f5a',
          500: '#3d7a3d',
          600: '#2f6230',
          700: '#264e27',
          800: '#1f3f20',
          900: '#0f2810',
        },
        // Warm earth neutrals — page background and surfaces.
        earth: {
          50:  '#faf6ef',  // ivory page background
          100: '#f3ede1',
          200: '#e6dcc7',
          300: '#d3c5a8',
          400: '#b3a081',
          500: '#8a785b',
          600: '#6b5b43',
          700: '#4f432f',
          800: '#332b1d',
          900: '#1c170d',
        },
        // Muted yellow / golden accent — for cautions and accents.
        honey: {
          50:  '#fdf8e8',
          100: '#f9ecbf',
          200: '#f2d97e',
          300: '#e8c14c',
          400: '#d3a32a',
          500: '#a87e1d',
          600: '#7d5b14',
          700: '#543c0c',
        },
        // Desaturated terracotta — sell now, destructive.
        rust: {
          50:  '#fbf1ed',
          100: '#f4d8cb',
          200: '#e6a98e',
          300: '#cf7954',
          400: '#b45a32',
          500: '#8a4020',
          600: '#5e2b14',
        },
        // Outcome / acceptance.
        success: {
          50:  '#eef7f4',
          100: '#cfe8e0',
          200: '#9fd0c1',
          300: '#5fae97',
          400: '#2d8a72',
          500: '#1f6e5a',
          600: '#155345',
        },
        // Body text scale.
        ink: {
          50:  '#f7f7f5',
          100: '#ececea',
          200: '#d6d6d2',
          300: '#b3b3ad',
          400: '#7c7c75',
          500: '#5a5a54',
          600: '#3f3f3b',
          700: '#2a2a27',
          800: '#1a1a18',
          900: '#0e0e0d',
        },
      },
      fontFamily: {
        // Serif for headlines and the brand wordmark.
        display: ['Fraunces', 'Georgia', 'Cambria', 'Times New Roman', 'serif'],
        // Sans for body and dense UI.
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Helvetica Neue', 'sans-serif'],
      },
      fontSize: {
        // Tighter step so headlines don't get over-blown on small screens.
        'display-xl': ['3.5rem',  { lineHeight: '1.05', letterSpacing: '-0.02em', fontWeight: '500' }],
        'display-lg': ['2.75rem', { lineHeight: '1.1',  letterSpacing: '-0.02em', fontWeight: '500' }],
        'display-md': ['2rem',     { lineHeight: '1.15', letterSpacing: '-0.015em', fontWeight: '500' }],
      },
      borderRadius: {
        // Slightly more rounded than the default 6px; gives cards a softer
        // hand-built feel that matches the warm palette.
        'card': '14px',
        'pill': '999px',
      },
      boxShadow: {
        // Two custom shadows. The first is for cards at rest; the second
        // is the lift on hover/focus. Both are warm-tinted, not blue.
        'card': '0 1px 2px rgba(38, 78, 39, 0.05), 0 1px 3px rgba(38, 78, 39, 0.04)',
        'card-hover': '0 4px 14px rgba(38, 78, 39, 0.08), 0 2px 6px rgba(38, 78, 39, 0.05)',
        'inset-line': 'inset 0 -1px 0 0 rgba(38, 78, 39, 0.08)',
      },
      transitionTimingFunction: {
        // Single easing for everything: gentle ease-out for "settling",
        // slightly stronger for "snapping in" components like the
        // DecisionCard.
        'ease-out-soft': 'cubic-bezier(0.22, 0.61, 0.36, 1)',
        'ease-out-firm': 'cubic-bezier(0.18, 0.89, 0.32, 1.0)',
      },
      transitionDuration: {
        // 200 / 300 are our two standard durations. 500 only for the
        // initial page fade-in. Anything slower is "vibe-coded" — not
        // welcome here.
        '180': '180ms',
        '240': '240ms',
        '500': '500ms',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: 0, transform: 'translateY(6px)' },
          to:   { opacity: 1, transform: 'translateY(0)' },
        },
        'fade-in-slow': {
          from: { opacity: 0, transform: 'translateY(10px)' },
          to:   { opacity: 1, transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: 0.7 },
          '50%': { opacity: 1 },
        },
        'shimmer': {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        // Subtle press effect for buttons / status chips.
        'scale-in': {
          from: { opacity: 0, transform: 'scale(0.96)' },
          to:   { opacity: 1, transform: 'scale(1)' },
        },
        // Soft glow used for the SELL_NOW / recommendation hero pulse.
        'glow-soft': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(47, 98, 48, 0.0)' },
          '50%':      { boxShadow: '0 0 0 6px rgba(47, 98, 48, 0.12)' },
        },
        // Stagger helper: a child element gets delayed entry based on
        // its --stagger-index CSS var. Used by ac-stagger-children.
        'rise-in': {
          from: { opacity: 0, transform: 'translateY(10px)' },
          to:   { opacity: 1, transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in':     'fade-in 240ms cubic-bezier(0.22, 0.61, 0.36, 1) both',
        'fade-in-slow':'fade-in-slow 500ms cubic-bezier(0.22, 0.61, 0.36, 1) both',
        'pulse-soft':  'pulse-soft 2s ease-in-out infinite',
        'shimmer':     'shimmer 2.4s linear infinite',
        'scale-in':    'scale-in 220ms cubic-bezier(0.18, 0.89, 0.32, 1.0) both',
        'glow-soft':   'glow-soft 2.6s ease-in-out infinite',
        'rise-in':     'rise-in 360ms cubic-bezier(0.22, 0.61, 0.36, 1) both',
      },
      backgroundImage: {
        'parchment': 'radial-gradient(ellipse 80% 60% at 50% 0%, #fdf8e8 0%, #faf6ef 60%, #f3ede1 100%)',
        'paper':     'linear-gradient(180deg, #faf6ef 0%, #f3ede1 100%)',
      },
    },
  },
  plugins: [],
}
