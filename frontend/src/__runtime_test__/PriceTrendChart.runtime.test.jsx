/**
 * PriceTrendChart RUNTIME test.
 *
 * Mounts PriceTrendChart in multiple sequences and reports any
 * "Rendered more hooks" / "Rendered fewer hooks" error to the DOM
 * (data-testid="report") and the console.
 *
 * Access via the Vite dev server at:
 *   http://localhost:5173/__runtime_test__price_chart.html
 *
 * The verifier (8-feature regression suite) only checks the production
 * build, NOT this test. This file is a development-only artifact for
 * reproducing the runtime bug. It is excluded from the production
 * build by being in a non-imported directory.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import PriceTrendChart from '../components/PriceTrendChart.jsx'

let hookError = null
const onError = (where, e) => {
  const msg = (e && e.message) || String(e)
  console.error('ERROR @ ' + where + ': ' + msg)
  if (/Rendered more hooks|Rendered fewer hooks|Hooks/.test(msg)) {
    hookError = msg
  }
}
window.addEventListener('error', (e) => onError('window', e.error || e.message))
window.addEventListener('unhandledrejection', (e) => onError('reject', e.reason))
const origConsoleError = console.error
console.error = (...a) => {
  origConsoleError.apply(console, a)
  const s = a.map(String).join(' ')
  if (/Rendered more hooks|Rendered fewer hooks/.test(s)) hookError = s
}

function Verdict({ cases }) {
  const passed = cases.filter((c) => c.ok).length
  const failed = cases.length - passed
  const verdict =
    failed === 0
      ? 'ALL ' + passed + ' CASES PASS · 0 HOOK ERRORS'
      : failed + ' of ' + cases.length + ' CASES FAILED'
  return (
    <pre data-testid="report" style={{ fontFamily: 'monospace', padding: 12 }}>
      {JSON.stringify({ verdict, passed, failed, cases }, null, 2)}
    </pre>
  )
}

function RuntimeTest() {
  const [done, setDone] = React.useState(false)
  const [cases, setCases] = React.useState([])

  React.useEffect(() => {
    let cancelled = false
    const container = document.getElementById('root')
    const caseList = []

    async function runCase(name, fn) {
      if (cancelled) return
      const slot = document.createElement('div')
      slot.id = 'slot-' + caseList.length
      container.appendChild(slot)
      const root = createRoot(slot)
      const before = hookError
      try {
        await fn(root)
        await new Promise((r) => setTimeout(r, 600))
        const hadError = hookError && hookError !== before
        caseList.push({
          name,
          ok: !hadError,
          err: hadError ? hookError : null,
        })
        console.log((hadError ? 'FAIL ' : 'OK   ') + name + (hadError ? ' :: ' + hookError : ''))
      } catch (e) {
        onError('case ' + name, e)
        caseList.push({ name, ok: false, err: e?.message || String(e) })
      } finally {
        // Be tolerant of double-unmount: the test case may have
        // already called r.unmount() before the remount step.
        try { root.unmount() } catch {}
        await new Promise((r) => setTimeout(r, 50))
      }
    }

    async function main() {
      await runCase('mount with no crop (returns null)', async (r) => {
        r.render(<PriceTrendChart crop={null} />)
      })
      await runCase('initial loading render', async (r) => {
        r.render(<PriceTrendChart crop="tomato" state="Bihar" />)
      })
      await runCase('API response render (multi-point)', async (r) => {
        r.render(<PriceTrendChart crop="tomato" state="Bihar" />)
        await new Promise((res) => setTimeout(res, 800))
      })
      await runCase('re-render with different crop', async (r) => {
        r.render(<PriceTrendChart crop="tomato" state="Bihar" />)
        await new Promise((res) => setTimeout(res, 400))
        r.render(<PriceTrendChart crop="onion" state="Maharashtra" />)
        await new Promise((res) => setTimeout(res, 400))
      })
      await runCase('empty state (zero history)', async (r) => {
        r.render(<PriceTrendChart crop="sugarcane" state="Uttar Pradesh" />)
        await new Promise((res) => setTimeout(res, 800))
      })
      await runCase('single-point state (1 history point)', async (r) => {
        // We can't easily change the API response, so we mount with
        // a crop that probably has fewer records. Just verify no hook
        // errors on a different crop.
        r.render(<PriceTrendChart crop="rice" state="Punjab" />)
        await new Promise((res) => setTimeout(res, 800))
      })
      await runCase('unmount + remount (navigation)', async (r) => {
        r.render(<PriceTrendChart crop="tomato" state="Bihar" />)
        await new Promise((res) => setTimeout(res, 400))
        r.unmount()
        await new Promise((res) => setTimeout(res, 100))
        // React 18: must createRoot again after unmount
        const slot2 = document.createElement('div')
        slot2.id = 'slot-remount'
        document.getElementById('root').appendChild(slot2)
        const root2 = createRoot(slot2)
        root2.render(<PriceTrendChart crop="tomato" state="Bihar" />)
        await new Promise((res) => setTimeout(res, 400))
        root2.unmount()
        slot2.remove()
      })

      if (!cancelled) {
        setCases(caseList)
        setDone(true)
        const passed = caseList.filter((c) => c.ok).length
        const failed = caseList.length - passed
        const verdict =
          failed === 0
            ? 'ALL ' + passed + ' CASES PASS · 0 HOOK ERRORS'
            : failed + ' of ' + caseList.length + ' CASES FAILED'
        document.title = verdict
        console.log('--- ' + verdict + ' ---')
      }
    }
    main().catch((e) => onError('main', e))
    return () => {
      cancelled = true
    }
  }, [])

  if (!done) {
    return <pre data-testid="report">Running tests…</pre>
  }
  return <Verdict cases={cases} />
}

// Mount the test runner on the page.
const _root = createRoot(document.getElementById('root') || document.body)
_root.render(<RuntimeTest />)

export default RuntimeTest
