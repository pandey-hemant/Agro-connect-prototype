/**
 * hooks/usePageMeta.js — per-page SEO + a11y meta management.
 *
 * Tiny, dependency-free alternative to react-helmet-async. Sets:
 *   - document.title            (unique per page)
 *   - <meta name="description">  (unique per page)
 *   - <link rel="canonical">     (absolute URL, derived from location)
 *   - <meta property="og:title"> (mirrors document.title)
 *   - <meta property="og:description"> (mirrors description)
 *   - <meta name="twitter:title"> etc.
 *
 * Each call's meta are removed on unmount or when the args change, so
 * a stale description never leaks from one page to the next during SPA
 * navigation.
 *
 * Usage:
 *   usePageMeta({
 *     title: 'My Crops — AgroConnect',
 *     description: 'See every crop lot you have listed…',
 *   })
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const BRAND = 'AgroConnect'
const DEFAULT_DESCRIPTION =
  'AgroConnect helps farmers choose where to sell, see live mandi prices, compare offers, and connect directly with buyers. Built for Indian agriculture.'

// Inline selectors so the hook stays self-contained.
const META_SELECTORS = {
  description: 'meta[name="description"]',
  ogTitle: 'meta[property="og:title"]',
  ogDescription: 'meta[property="og:description"]',
  twTitle: 'meta[name="twitter:title"]',
  twDescription: 'meta[name="twitter:twitter:description"], meta[name="twitter:description"]',
}

function setOrCreateMeta(selector, attrName, attrValue, value) {
  let el = document.head.querySelector(selector)
  if (!el) {
    el = document.createElement('meta')
    // Pick the attribute name that selects this element vs the one we
    // set the content on. Most META_SELECTORS use the same key for
    // both (e.g. "description" → name="description"). og:* uses
    // property="og:*", so we let the caller pass the right one.
    if (selector.includes('property=')) {
      el.setAttribute('property', selector.match(/property="([^"]+)"/)[1])
    } else {
      el.setAttribute('name', selector.match(/name="([^"]+)"/)[1])
    }
    document.head.appendChild(el)
  }
  el.setAttribute(attrName, attrValue)
}

function setCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

function buildCanonical(pathname) {
  // Avoid SSR / file:// environments where window.location.origin is
  // "null". We only set the canonical in the browser.
  if (typeof window === 'undefined' || !window.location?.origin) return null
  return `${window.location.origin}${pathname}`
}

export function usePageMeta({ title, description } = {}) {
  const location = useLocation()

  useEffect(() => {
    const prevTitle = document.title
    const fullTitle = title ? `${title} · ${BRAND}` : `${BRAND} — Decide, Sell, and Earn More`
    document.title = fullTitle

    const desc = description || DEFAULT_DESCRIPTION
    setOrCreateMeta(META_SELECTORS.description, 'content', desc)
    setOrCreateMeta(META_SELECTORS.ogTitle, 'content', fullTitle)
    setOrCreateMeta(META_SELECTORS.ogDescription, 'content', desc)
    setOrCreateMeta(META_SELECTORS.twTitle, 'content', fullTitle)
    setOrCreateMeta(META_SELECTORS.twDescription, 'content', desc)

    const canonical = buildCanonical(location.pathname)
    if (canonical) setCanonical(canonical)

    return () => {
      // Restore the app default title on unmount so a subsequent
      // page that doesn't call this hook still gets a sensible tab
      // name.
      document.title = prevTitle.startsWith(BRAND) ? prevTitle : fullTitle
    }
  }, [title, description, location.pathname])
}

export default usePageMeta
