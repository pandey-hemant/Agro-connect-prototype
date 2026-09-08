const axios = require('axios');
const HEADERS = { Accept: 'application/json, text/plain, */*', Origin: 'https://agmarknet.gov.in', Referer: 'https://agmarknet.gov.in/', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36' };
let lastCallAt = 0;
async function throttle() { const w = Math.max(0, 500 - (Date.now() - lastCallAt)); if (w > 0) await new Promise(r => setTimeout(r, w)); lastCallAt = Date.now(); }
async function test(y, m, cmid, sid) {
  await throttle();
  const url = 'https://api.agmarknet.gov.in/v1/prices-and-arrivals/date-wise/specific-commodity?year='+y+'&month='+m+'&stateId='+sid+'&commodityId='+cmid+'&includeExcel=false';
  try {
    const r = await axios.get(url, { headers: HEADERS, timeout: 30000, validateStatus: s => s >= 200 && s < 300, responseType: 'json' });
    const data = r.data && (r.data.data || r.data);
    let recs = 0, mkt = new Set();
    if (data && Array.isArray(data.markets)) for (const mm of data.markets) {
      if (mm.marketName || mm.market_name) mkt.add(mm.marketName||mm.market_name);
      const dates = mm.dates||mm.dateWiseData||mm.data||[];
      for (const d of dates) { const inner = Array.isArray(d.data)&&d.data.length>0?d.data:[d]; recs += inner.length; }
    }
    return {y, m, recs, mkts: mkt.size};
  } catch (e) { return {y, m, err: e.message}; }
}
(async () => {
  for (const cmid of [23, 65, 24]) {
    const cname = cmid===23?'Onion':cmid===65?'Tomato':'Potato';
    console.log('Tamil Nadu (31) / '+cname+' ('+cmid+'):');
    for (let y=2020; y<=2025; y++) {
      for (const m of [1, 6, 12]) {
        const r = await test(y, m, cmid, 31);
        console.log(' ', y, String(m).padStart(2,'0'), '->', r.recs||0, 'recs,', r.mkts||0, 'mkts', r.err?'['+r.err+']':'');
      }
    }
    console.log('');
  }
  // Also test all 12 months of 2024 and 2025 for TN/Onion to know exactly what exists
  console.log('Tamil Nadu / Onion full 2024 + 2025 month-by-month:');
  for (const y of [2024, 2025]) {
    for (let m = 1; m <= 12; m++) {
      const r = await test(y, m, 23, 31);
      console.log(' ', y, String(m).padStart(2,'0'), '->', r.recs||0, 'recs,', r.mkts||0, 'mkts');
    }
  }
})();
