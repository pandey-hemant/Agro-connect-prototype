// Chrome DevTools Protocol driver for headless runtime test.
// Launches headless Chrome, opens the test page, waits for the verdict
// title, then prints the report and exits.

const { spawn } = require('child_process')
const http = require('http')

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9222
const URL = 'http://localhost:5173/__runtime_test__price_chart.html'
const TIMEOUT_MS = 25000

async function getJSON(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path }, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(body))
          } catch (e) {
            reject(new Error('Bad JSON: ' + body.slice(0, 200)))
          }
        })
      })
      .on('error', reject)
  })
}

async function main() {
  console.log('[driver] launching chrome headless on', PORT)
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
      '--user-data-dir=C:/Users/heman/AppData/Local/Temp/chrome-runtime-test',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  chrome.stderr.on('data', (d) => {
    const s = d.toString()
    if (/DevTools listening/.test(s)) console.log('[driver] devtools ready')
  })

  // Wait for devtools to be ready
  let version = null
  const t0 = Date.now()
  while (Date.now() - t0 < 10000) {
    try {
      version = await getJSON('/json/version')
      if (version && version.webSocketDebuggerUrl) break
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  if (!version) {
    console.error('[driver] chrome did not start DevTools in time')
    chrome.kill()
    process.exit(1)
  }
  console.log('[driver] chrome version:', version.Browser)

  const ws = new WebSocket(version.webSocketDebuggerUrl)
  let nextId = 1
  const pending = new Map()
  const consoleLogs = []

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
      consoleLogs.push({ level: msg.params.type, text: args })
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const e = msg.params.exceptionDetails
      consoleLogs.push({ level: 'EXCEPTION', text: (e.exception?.description || e.text || '') + ' @ ' + (e.url || '') + ':' + e.lineNumber })
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry
      consoleLogs.push({ level: e.level, text: e.text })
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
  console.log('[driver] WS open')

  await send('Target.setDiscoverTargets', { discover: true })
  // Create a new target
  const tgt = await send('Target.createTarget', { url: 'about:blank' })
  const targetId = tgt.targetId
  const att = await send('Target.attachToTarget', { targetId, flatten: true })
  const sessionId = att.sessionId

  // Helper to send to specific session
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

  console.log('[driver] navigating to', URL)
  await sendS('Page.navigate', { url: URL })

  // Wait for title to contain 'PASS' or 'FAILED' or timeout
  const start = Date.now()
  let lastTitle = ''
  while (Date.now() - start < TIMEOUT_MS) {
    const t = await sendS('Runtime.evaluate', {
      expression: 'document.title',
      returnByValue: true,
    })
    if (t.result && t.result.value) lastTitle = t.result.value
    if (/PASS|FAILED/.test(lastTitle)) break
    await new Promise((r) => setTimeout(r, 250))
  }

  // Get the report element
  const report = await sendS('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('[data-testid="report"]')
      if (!el) return null
      try { return JSON.parse(el.textContent) } catch (e) { return { rawText: el.textContent, parseError: e.message } }
    })()`,
    returnByValue: true,
  })

  console.log('=== TITLE ===')
  console.log(lastTitle)
  console.log('=== REPORT ===')
  console.log(JSON.stringify(report.result?.value, null, 2))
  console.log('=== CONSOLE (relevant) ===')
  for (const c of consoleLogs) {
    if (
      /RUNTIME_TEST|hooks|error|exception|warn/i.test(c.text) ||
      c.level === 'EXCEPTION' ||
      c.level === 'error'
    ) {
      console.log(`[${c.level}] ${c.text}`)
    }
  }

  ws.close()
  chrome.kill()
  process.exit(0)
}

main().catch((e) => {
  console.error('[driver] fatal:', e)
  process.exit(2)
})
