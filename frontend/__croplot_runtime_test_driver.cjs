// CropLotDetail runtime test.
//
// 1. Logs in via /api/auth/demo-login
// 2. Pre-populates localStorage with the JWT + payload
// 3. Opens the actual CropLotDetail page in headless Chrome
// 4. Captures all console messages and exceptions
// 5. Reports PASS/FAIL based on whether any "Rendered more hooks" or
//    related hook-order errors were thrown
//
// Run from frontend/ with: node __croplot_runtime_test_driver.cjs

const { spawn } = require('child_process')
const http = require('http')

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9224
const FRONTEND = 'http://localhost:5173'
const BACKEND = 'http://localhost:5050'
const TIMEOUT_MS = 30000

function httpGetJSON(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(body) }) }
          catch { resolve({ status: res.statusCode, body }) }
        })
      })
      .on('error', reject)
  })
}

function httpPostJSON(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const u = new URL(url)
    const req = http.request(
      {
        host: u.hostname, port: u.port, path: u.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
      },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(body) }) }
          catch { resolve({ status: res.statusCode, body }) }
        })
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function getDevtoolsTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/json`, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (e) { reject(e) }
      })
    })
  })
}

async function main() {
  console.log('[driver] step 1: demo-login')
  const login = await httpPostJSON(`${BACKEND}/api/auth/demo-login`, { role: 'SELLER' })
  if (!login.body || !login.body.token) {
    console.error('login failed:', login)
    process.exit(1)
  }
  const { user, token } = login.body
  console.log('[driver] logged in as', user.public_id, user.role)

  console.log('[driver] step 2: pick a crop lot')
  const lots = await httpGetJSON(`${BACKEND}/api/crop-lots?limit=5`)
  const lot = lots.body.results.find((l) => l.crop_name && l.seller_user_public_id) || lots.body.results[0]
  console.log('[driver] using lot', lot.public_id, lot.crop_name)

  console.log('[driver] step 3: launch chrome')
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=C:/Users/heman/AppData/Local/Temp/chrome-croplot-test-3',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  chrome.stderr.on('data', (d) => {
    const s = d.toString()
    console.log('[chrome stderr]', s.trim().slice(0, 200))
  })
  chrome.stdout.on('data', (d) => {
    console.log('[chrome stdout]', d.toString().trim().slice(0, 200))
  })

  // Wait for DevTools
  let version = null
  const t0 = Date.now()
  while (Date.now() - t0 < 10000) {
    try {
      const t = await getDevtoolsTargets()
      if (t && t.length) { version = t[0]; break }
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  if (!version) { console.error('chrome did not start'); chrome.kill(); process.exit(1) }

  const ws = new WebSocket(version.webSocketDebuggerUrl)
  let nextId = 1
  const pending = new Map()
  const events = []
  let sessionId = null

  ws.addEventListener('message', (ev) => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
      events.push({ type: 'console', level: msg.params.type, text: args })
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const e = msg.params.exceptionDetails
      events.push({
        type: 'exception',
        text: (e.exception?.description || e.text || '') + ' @ ' + (e.url || '') + ':' + e.lineNumber,
      })
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry
      events.push({ type: 'log', level: e.level, text: e.text })
    } else if (msg.method === 'Network.responseReceived') {
      const r = msg.params.response
      if (r.status >= 400) {
        events.push({ type: 'http', status: r.status, url: r.url })
      }
    }
  })

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

  await new Promise((res) => ws.addEventListener('open', res, { once: true }))

  // Attach to the about:blank target
  const targets = await getDevtoolsTargets()
  const tgt = targets.find((t) => t.type === 'page') || targets[0]
  const att = await send('Target.attachToTarget', { targetId: tgt.id, flatten: true })
  sessionId = att.sessionId

  function sendS(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ sessionId, id, method, params }))
    })
  }

  await sendS('Runtime.enable')
  await sendS('Log.enable')
  await sendS('Page.enable')
  await sendS('Network.enable')

  // Pre-populate localStorage BEFORE navigating to the SPA.
  // We need to navigate to the same origin first so localStorage
  // is accessible.
  await sendS('Page.navigate', { url: FRONTEND + '/' })
  await new Promise((r) => setTimeout(r, 1500))

  const setLS = await sendS('Runtime.evaluate', {
    expression: `(() => {
      const auth = ${JSON.stringify({ publicId: user.public_id, role: user.role, displayName: user.display_name || user.name, activeBuyerId: user.active_buyer_id || null, activeFpoId: user.active_fpo_id || null, isDemo: !!user.is_demo, ts: Date.now() })};
      localStorage.setItem('agroconnect.auth.v1', JSON.stringify(auth));
      localStorage.setItem('agroconnect.auth.token.v1', ${JSON.stringify(token)});
      return 'set'
    })()`,
    returnByValue: true,
  })
  console.log('[driver] localStorage set:', setLS.result?.value)

  // Now navigate to CropLotDetail
  const url = `${FRONTEND}/seller/crop-lots/${lot.public_id}`
  console.log('[driver] navigating to', url)
  await sendS('Page.navigate', { url })

  // Wait for the page to render — we watch the title and the report
  // element OR a sentinel that PriceTrendChart has mounted.
  const start = Date.now()
  let title = ''
  let lastSentinel = ''
  while (Date.now() - start < TIMEOUT_MS) {
    const t = await sendS('Runtime.evaluate', {
      expression: `(() => {
        const ldr = document.querySelector('[aria-label="Loading price history"]')
        const chart = document.querySelector('.recharts-line')
        const h1 = document.querySelector('h1') ? document.querySelector('h1').textContent.slice(0, 60) : '(no h1)'
        const allHeadings = Array.from(document.querySelectorAll('h1,h2,h3')).map((h) => h.textContent.slice(0, 30)).slice(0, 5)
        return JSON.stringify({
          title: document.title.slice(0, 60),
          h1,
          allHeadings,
          loading: !!ldr,
          chart: !!chart,
          url: location.pathname,
        })
      })()`,
      returnByValue: true,
    })
    if (t.result?.value) lastSentinel = t.result.value
    if (Date.now() - start > 5000 && /chart/.test(lastSentinel)) break
    if (Date.now() - start > 15000) break
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log('[driver] final sentinel:', lastSentinel)

  // Give the chart a moment to fully render and any deferred effects
  await new Promise((r) => setTimeout(r, 1500))

  ws.close()
  chrome.kill()

  // Analyze events
  const errors = events.filter((e) =>
    /Rendered more hooks|Rendered fewer hooks/.test(e.text) ||
    (e.type === 'exception' && /hook/i.test(e.text))
  )
  const consoleErrors = events.filter((e) =>
    e.type === 'exception' || e.level === 'error'
  )

  console.log('=== EVENTS ===')
  console.log('total events:', events.length)
  console.log('hook errors:', errors.length)
  console.log('console/exception errors:', consoleErrors.length)
  console.log('http errors (4xx/5xx):')
  for (const e of events.filter((e) => e.type === 'http')) {
    console.log('  [' + e.status + '] ' + e.url)
  }
  for (const e of events) {
    if (e.type === 'exception' || e.level === 'error' || /hook/i.test(e.text)) {
      console.log('  [' + (e.level || e.type) + '] ' + e.text.slice(0, 300))
    }
  }

  if (errors.length === 0) {
    console.log('=== RUNTIME UI PASS: 0 hook-order errors on CropLotDetail ===')
    process.exit(0)
  } else {
    console.log('=== RUNTIME UI FAIL: ' + errors.length + ' hook-order error(s) ===')
    process.exit(1)
  }
}

main().catch((e) => { console.error('fatal:', e); process.exit(2) })
