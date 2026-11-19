#!/usr/bin/env node
/**
 * noaa-tides — a tiny MCP server for NOAA CO-OPS tide-gauge data.
 *
 * Zero dependencies: needs only Node 18+ (which Claude Code already requires).
 * Speaks the Model Context Protocol over stdio (newline-delimited JSON-RPC 2.0).
 *
 * Tools: geocode, find_stations, list_stations, get_monthly_mean, compute_trend,
 *        get_long_term_trend, get_water_levels, plot_sea_level
 *
 * Data is cached in <agent folder>/data/cache for 10 days. If NOAA is unreachable, the
 * server falls back to the built-in copies in shared/data/builtin (27 gauges, 2016-2025).
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// Shared by both agents. Downloads, cache and plots go to the folder of the agent that
// started this server (its working directory, or SEALEVEL_WORKDIR); offline data lives
// next to this file in shared/data/builtin.
const ROOT = path.resolve(process.env.SEALEVEL_WORKDIR || process.cwd());
const DATA = path.join(ROOT, 'data');
const CACHE = path.join(DATA, 'cache');
const BUILTIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'builtin');
const OUT = path.join(ROOT, 'outputs');
for (const d of [DATA, CACHE, OUT]) fs.mkdirSync(d, { recursive: true });

const NOAA = process.env.NOAA_API_BASE || 'https://api.tidesandcurrents.noaa.gov';
const NOMINATIM = process.env.NOMINATIM_BASE || 'https://nominatim.openstreetmap.org';
const CACHE_DAYS = 10;
const UA = 'NCSU-MEAS-sealevel-demo/1.0 (teaching demo)';
const log = (...a) => process.stderr.write('[noaa-tides] ' + a.join(' ') + '\n');
const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));

/* ---------------------------------------------------------------- cache */
async function cached(key, loader) {
  const f = path.join(CACHE, key.replace(/[^\w.-]+/g, '_') + '.json');
  if (fs.existsSync(f)) {
    const ageDays = (Date.now() - fs.statSync(f).mtimeMs) / 864e5;
    if (ageDays < CACHE_DAYS) return { value: readJSON(f), source: `cache (${ageDays.toFixed(1)} days old)` };
  }
  const value = await loader();
  fs.writeFileSync(f, JSON.stringify(value));
  return { value, source: 'downloaded from NOAA (cached for 10 days)' };
}
async function getJSON(url, ms = 20000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* ---------------------------------------------------------------- stations */
let STATIONS = null, STATIONS_SRC = '';
async function stations() {
  if (STATIONS) return STATIONS;
  try {
    const r = await cached('stations_waterlevels', async () => {
      const j = await getJSON(`${NOAA}/mdapi/prod/webapi/stations.json?type=waterlevels`);
      return j.stations.map(s => ({ id: s.id, name: s.name, state: s.state || '', lat: +s.lat, lon: +s.lng }));
    });
    STATIONS = r.value; STATIONS_SRC = r.source;
  } catch (e) {
    STATIONS = readJSON(path.join(BUILTIN, 'stations.json')); STATIONS_SRC = 'built-in list (NOAA unreachable)';
  }
  return STATIONS;
}
const KM_PER_MI = 1.609344;
function km(a, b, c, d) { const R = 6371, r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
const round = (x, n = 1) => Math.round(x * 10 ** n) / 10 ** n;

/* ---------------------------------------------------------------- data */
async function monthlyMean(id, y0, y1) {
  try {
    const r = await cached(`monthly_${id}_${y0}_${y1}`, async () => {
      const j = await getJSON(`${NOAA}/api/prod/datagetter?product=monthly_mean&datum=MSL&units=metric&time_zone=gmt&format=json&application=NCSU_MEAS_demo&station=${id}&begin_date=${y0}0101&end_date=${y1}1231`);
      if (j.error || !j.data) throw new Error(j.error ? j.error.message : 'no data');
      return j.data.map(d => [+d.year, +d.month, d.MSL === '' ? null : +d.MSL]);
    });
    return { rows: r.value, source: r.source };
  } catch (e) {
    if (/no data|not found|wrong/i.test(e.message)) throw e;
    const snap = readJSON(path.join(BUILTIN, 'monthly_mean_2016_2025.json'))[id];
    if (!snap) throw new Error(`NOAA unreachable (${e.message}) and no built-in data for ${id}`);
    const rows = snap.filter(r => r[0] >= y0 && r[0] <= y1);
    if (!rows.length) throw new Error('NOAA unreachable and built-in data only covers 2016-2025');
    return { rows, source: 'built-in copy, 2016-2025 (NOAA unreachable)' };
  }
}
function writeCSV(id, y0, y1, rows) {
  const f = path.join(DATA, `monthly_mean_${id}_${y0}_${y1}.csv`);
  fs.writeFileSync(f, 'year,month,msl_m\n' + rows.map(r => `${r[0]},${r[1]},${r[2] ?? ''}`).join('\n') + '\n');
  return path.relative(ROOT, f);
}
/** Remove the mean seasonal cycle, fit OLS, 95% CI corrected for lag-1 autocorrelation. */
function analyze(rows) {
  const ok = rows.filter(r => r[2] != null && isFinite(r[2])).map(([y, m, v]) => ({ y, m, v, t: y + (m - 0.5) / 12 }));
  if (ok.length < 24) throw new Error(`only ${ok.length} months of data`);
  const clim = {}; for (let m = 1; m <= 12; m++) { const v = ok.filter(r => r.m === m).map(r => r.v); clim[m] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; }
  const an = ok.map(r => ({ ...r, a: r.v - clim[r.m] }));
  const n = an.length, mt = an.reduce((s, r) => s + r.t, 0) / n, ma = an.reduce((s, r) => s + r.a, 0) / n;
  let sxx = 0, sxy = 0; an.forEach(r => { sxx += (r.t - mt) ** 2; sxy += (r.t - mt) * (r.a - ma); });
  const b = sxy / sxx, a0 = ma - b * mt, res = an.map(r => r.a - (a0 + b * r.t));
  const s2 = res.reduce((s, e) => s + e * e, 0) / (n - 2);
  let num = 0, den = 0; for (let i = 1; i < n; i++) num += res[i] * res[i - 1]; for (const e of res) den += e * e;
  const r1 = Math.max(0, num / den), neff = Math.max(3, n * (1 - r1) / (1 + r1));
  const se = Math.sqrt(s2 / sxx) * Math.sqrt((n - 2) / (neff - 2));
  const smooth = an.map((r, i) => { const w = an.slice(Math.max(0, i - 5), i + 7); return w.length >= 12 ? { t: r.t, a: w.reduce((s, x) => s + x.a, 0) / w.length } : null; }).filter(Boolean);
  const top = [...an].sort((p, q) => q.v - p.v)[0], low = [...an].sort((p, q) => p.v - q.v)[0];
  const years = {}; an.forEach(r => (years[r.y] = years[r.y] || []).push(r.a));
  const annual = Object.entries(years).filter(([, v]) => v.length >= 10).map(([y, v]) => ({ year: +y, anomaly_mm: round(1000 * v.reduce((a, b) => a + b, 0) / v.length) }));
  return { an, smooth, a0, b, n, r1, trend: b * 1000, ci95: 1.96 * se * 1000, top, low, annual, t0: an[0].t, t1: an[n - 1].t };
}
async function longTerm(id) {
  try {
    const r = await cached('long_term_trends', async () => {
      const j = await getJSON(`${NOAA}/dpapi/prod/webapi/product/sealvltrends.json?affil=US`);
      return Object.fromEntries(j.SeaLvlTrends.map(x => [x.stationId, { trend: round(x.trend * 2.54, 2), ci95: round(x.trendError * 2.54, 2), start: +x.startDate.slice(-4), end: +x.endDate.slice(-4) }]));
    });
    return { v: r.value[id], source: 'NOAA sealvltrends, ' + r.source };
  } catch (e) {
    return { v: readJSON(path.join(BUILTIN, 'long_term_trends.json'))[id], source: 'NOAA sealvltrends, built-in copy (Nov 2026)' };
  }
}

/* ---------------------------------------------------------------- SVG plot */
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
function svgChart(series, title) {
  const W = 960, H = 480, L = 70, R = 150, T = 50, B = 50, pw = W - L - R, ph = H - T - B;
  const xs = series.flatMap(s => s.A.smooth.map(p => p.t)), ys = series.flatMap(s => [...s.A.smooth.map(p => p.a * 1000), (s.A.a0 + s.A.b * s.A.t0) * 1000, (s.A.a0 + s.A.b * s.A.t1) * 1000]);
  const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs));
  const step = (Math.max(...ys) - Math.min(...ys)) > 200 ? 50 : 20;
  const y0 = Math.floor(Math.min(...ys) / step) * step, y1 = Math.ceil(Math.max(...ys) / step) * step;
  const X = t => L + (t - x0) / (x1 - x0) * pw, Y = v => T + (1 - (v - y0) / (y1 - y0)) * ph;
  let g = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Helvetica,Arial,sans-serif" font-size="13">
<rect width="${W}" height="${H}" fill="#fcfcfb"/><text x="${L}" y="28" font-size="17" font-weight="600" fill="#0b0b0b">${esc(title)}</text>`;
  for (let v = y0; v <= y1; v += step) g += `<line x1="${L}" x2="${L + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e6e5e0"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" fill="#52514e">${v}</text>`;
  const xstep = (x1 - x0) > 30 ? 10 : (x1 - x0) > 12 ? 5 : 1;
  for (let t = x0; t <= x1; t += xstep) g += `<line x1="${X(t)}" x2="${X(t)}" y1="${T}" y2="${T + ph}" stroke="#e6e5e0"/><text x="${X(t)}" y="${T + ph + 20}" text-anchor="middle" fill="#52514e">${t}</text>`;
  g += `<text transform="translate(18,${T + ph / 2}) rotate(-90)" text-anchor="middle" fill="#52514e">Sea level anomaly (mm), seasonal cycle removed</text>`;
  if (y0 < 0 && y1 > 0) g += `<line x1="${L}" x2="${L + pw}" y1="${Y(0)}" y2="${Y(0)}" stroke="#7a7974"/>`;
  series.forEach((s, i) => {
    const c = PALETTE[i % 4], A = s.A;
    g += `<polyline fill="none" stroke="${c}" stroke-width="2" points="${A.smooth.map(p => `${X(p.t).toFixed(1)},${Y(p.a * 1000).toFixed(1)}`).join(' ')}"/>`;
    g += `<line x1="${X(A.t0)}" y1="${Y((A.a0 + A.b * A.t0) * 1000)}" x2="${X(A.t1)}" y2="${Y((A.a0 + A.b * A.t1) * 1000)}" stroke="${c}" stroke-width="1.5" stroke-dasharray="6 4"/>`;
    g += `<rect x="${L + pw + 16}" y="${T + 6 + i * 40}" width="14" height="3" fill="${c}"/><text x="${L + pw + 36}" y="${T + 11 + i * 40}" fill="#0b0b0b" font-weight="600">${esc(s.label)}</text><text x="${L + pw + 36}" y="${T + 27 + i * 40}" fill="#52514e" font-size="12">${A.trend >= 0 ? '+' : ''}${A.trend.toFixed(1)} ± ${A.ci95.toFixed(1)} mm/yr</text>`;
  });
  g += `<text x="${L}" y="${H - 10}" fill="#7a7974" font-size="11">Solid: 12-month running mean. Dashed: linear trend (95% CI in legend). Data: NOAA CO-OPS monthly mean sea level.</text></svg>`;
  return g;
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/* ---------------------------------------------------------------- tools */
const TOOLS = [
  { name: 'geocode', description: 'Convert a US place name to latitude/longitude (OpenStreetMap). Also matches NOAA gauge names.',
    inputSchema: { type: 'object', properties: { place: { type: 'string' } }, required: ['place'] },
    async run({ place }) {
      const st = (await stations()).find(s => s.name.toLowerCase() === String(place).toLowerCase().replace(/,?\s+[a-z]{2}$/i, ''));
      if (st) return { place, lat: st.lat, lon: st.lon, label: `${st.name}, ${st.state} (NOAA gauge ${st.id})` };
      const r = await cached('geo_' + place.toLowerCase(), async () => {
        const j = await getJSON(`${NOMINATIM}/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(place)}`);
        if (!j[0]) throw new Error('place not found: ' + place);
        return { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name.split(',').slice(0, 3).join(',') };
      });
      return { place, ...r.value };
    } },
  { name: 'find_stations', description: 'NOAA water-level tide gauges within a radius of a point, nearest first, with great-circle distance in miles. If none is in range, returns the nearest one outside it.',
    inputSchema: { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' }, radius_miles: { type: 'number', default: 50 } }, required: ['lat', 'lon'] },
    async run({ lat, lon, radius_miles = 50 }) {
      const all = (await stations()).map(s => ({ ...s, distance_mi: round(km(lat, lon, s.lat, s.lon) / KM_PER_MI) })).sort((a, b) => a.distance_mi - b.distance_mi);
      const inside = all.filter(s => s.distance_mi <= radius_miles);
      return { radius_miles, station_list_source: STATIONS_SRC, stations: inside.slice(0, 15), ...(inside.length ? {} : { nearest_outside_radius: all[0] }) };
    } },
  { name: 'list_stations', description: 'All NOAA water-level tide gauges in a US state or territory (two-letter code).',
    inputSchema: { type: 'object', properties: { state: { type: 'string' } }, required: ['state'] },
    async run({ state }) { const a = String(state).toUpperCase(); return { state: a, stations: (await stations()).filter(s => s.state === a) }; } },
  { name: 'get_monthly_mean', description: 'Download NOAA monthly mean sea level (meters relative to station MSL datum) for a gauge and year range. Saves a CSV in data/ that you can analyze with your own code, and returns its path plus coverage.',
    inputSchema: { type: 'object', properties: { station_id: { type: 'string' }, start_year: { type: 'integer' }, end_year: { type: 'integer' } }, required: ['station_id', 'start_year', 'end_year'] },
    async run({ station_id, start_year, end_year }) {
      const { rows, source } = await monthlyMean(station_id, start_year, end_year);
      const good = rows.filter(r => r[2] != null).length, req = 12 * (end_year - start_year + 1);
      const ya = Math.min(...rows.map(r => r[0])), yb = Math.max(...rows.map(r => r[0]));
      return { station_id, start_year: ya, end_year: yb, ...((ya > start_year || yb < end_year) ? { note: `requested ${start_year}-${end_year}, data available only for ${ya}-${yb}` } : {}), csv: writeCSV(station_id, start_year, end_year, rows), months_with_data: good, months_requested: req, coverage_pct: Math.round(100 * good / req), source, columns: 'year,month,msl_m' };
    } },
  { name: 'compute_trend', description: 'Linear sea-level trend for a gauge and period: removes the mean seasonal cycle, fits OLS, and returns mm/yr with a 95% CI corrected for lag-1 autocorrelation, plus annual anomalies and record months.',
    inputSchema: { type: 'object', properties: { station_id: { type: 'string' }, start_year: { type: 'integer' }, end_year: { type: 'integer' } }, required: ['station_id', 'start_year', 'end_year'] },
    async run({ station_id, start_year, end_year }) {
      const { rows, source } = await monthlyMean(station_id, start_year, end_year);
      const A = analyze(rows), st = (await stations()).find(s => s.id === station_id);
      const ya = Math.min(...rows.map(r => r[0])), yb = Math.max(...rows.map(r => r[0]));
      return { station_id, name: st ? `${st.name}, ${st.state}` : station_id, period: `${ya}-${yb}`,
        ...((ya > start_year || yb < end_year) ? { note: `requested ${start_year}-${end_year}, data available only for ${ya}-${yb}` } : {}), months_used: A.n,
        trend_mm_per_yr: round(A.trend), ci95_mm_per_yr: round(A.ci95), lag1_autocorrelation: round(A.r1, 2),
        highest_month: `${A.top.y}-${String(A.top.m).padStart(2, '0')} (${round(A.top.v, 3)} m)`, lowest_month: `${A.low.y}-${String(A.low.m).padStart(2, '0')} (${round(A.low.v, 3)} m)`,
        annual_anomalies_mm: A.annual, source };
    } },
  { name: 'get_long_term_trend', description: "NOAA's official long-term relative sea level trend for a gauge (whole record, mm/yr with 95% CI). Use to put short-window trends in context.",
    inputSchema: { type: 'object', properties: { station_id: { type: 'string' } }, required: ['station_id'] },
    async run({ station_id }) {
      const { v, source } = await longTerm(station_id);
      if (!v) return { station_id, error: 'NOAA publishes no long-term trend for this gauge (record too short)' };
      return { station_id, long_term_trend_mm_per_yr: v.trend, ci95_mm_per_yr: v.ci95, record: `${v.start}-${v.end}`, source };
    } },
  { name: 'get_water_levels', description: 'Hourly observed water level and astronomical tide prediction (meters, MLLW datum) for a gauge between two dates (max 31 days). Saves a CSV and returns peak observed level and peak surge (observed minus predicted). Use for storms and flooding events.',
    inputSchema: { type: 'object', properties: { station_id: { type: 'string' }, begin_date: { type: 'string', description: 'YYYYMMDD' }, end_date: { type: 'string', description: 'YYYYMMDD' } }, required: ['station_id', 'begin_date', 'end_date'] },
    async run({ station_id, begin_date, end_date }) {
      const q = p => `${NOAA}/api/prod/datagetter?product=${p}&datum=MLLW&units=metric&time_zone=gmt&format=json&application=NCSU_MEAS_demo&station=${station_id}&begin_date=${begin_date}&end_date=${end_date}&interval=h`;
      const r = await cached(`wl_${station_id}_${begin_date}_${end_date}`, async () => {
        const [o, p] = await Promise.all([getJSON(q('hourly_height')), getJSON(q('predictions'))]);
        if (o.error) throw new Error(o.error.message);
        const pred = Object.fromEntries((p.predictions || []).map(x => [x.t, +x.v]));
        return o.data.map(x => [x.t, x.v === '' ? null : +x.v, pred[x.t] ?? null]);
      });
      const rows = r.value, f = path.join(DATA, `water_levels_${station_id}_${begin_date}_${end_date}.csv`);
      fs.writeFileSync(f, 'time_gmt,observed_m,predicted_m,surge_m\n' + rows.map(x => `${x[0]},${x[1] ?? ''},${x[2] ?? ''},${x[1] != null && x[2] != null ? round(x[1] - x[2], 3) : ''}`).join('\n') + '\n');
      const obs = rows.filter(x => x[1] != null), sur = obs.filter(x => x[2] != null).map(x => ({ t: x[0], s: x[1] - x[2] }));
      const pk = obs.sort((a, b) => b[1] - a[1])[0], ps = sur.sort((a, b) => b.s - a.s)[0];
      return { station_id, csv: path.relative(ROOT, f), hours: rows.length, peak_observed: pk ? { time_gmt: pk[0], meters_above_MLLW: pk[1] } : null, peak_surge: ps ? { time_gmt: ps.t, meters: round(ps.s, 2) } : null, source: r.source };
    } },
  { name: 'plot_sea_level', description: 'Plot seasonal-anomaly time series (12-month running mean) and linear trends for 1-4 gauges over a period. Writes an SVG to outputs/ and returns its path.',
    inputSchema: { type: 'object', properties: { station_ids: { type: 'array', items: { type: 'string' }, maxItems: 4 }, start_year: { type: 'integer' }, end_year: { type: 'integer' }, title: { type: 'string' }, filename: { type: 'string', description: 'optional, e.g. nc_compare.svg' } }, required: ['station_ids', 'start_year', 'end_year'] },
    async run({ station_ids, start_year, end_year, title, filename }) {
      const all = await stations(), series = [];
      for (const id of station_ids.slice(0, 4)) { const { rows } = await monthlyMean(id, start_year, end_year); const st = all.find(s => s.id === id); series.push({ label: st ? st.name.split(',')[0] : id, A: analyze(rows) }); }
      const name = (filename || `sea_level_${station_ids.join('_')}_${start_year}_${end_year}.svg`).replace(/[^\w.-]/g, '_');
      const f = path.join(OUT, name.endsWith('.svg') ? name : name + '.svg');
      fs.writeFileSync(f, svgChart(series, title || `Sea level ${start_year}–${end_year}`));
      return { file: path.relative(ROOT, f), absolute_path: f, series: series.map(s => ({ label: s.label, trend_mm_per_yr: round(s.A.trend), ci95: round(s.A.ci95) })) };
    } },
];

/* ---------------------------------------------------------------- MCP stdio loop */
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async line => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
  const { id, method, params = {} } = msg;
  if (id === undefined) return; // notifications (e.g. notifications/initialized)
  try {
    if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'noaa-tides', version: '1.0.0' }, instructions: 'NOAA CO-OPS tide-gauge data: find gauges, download monthly means and hourly water levels, compute trends, and plot. Data is cached for 10 days.' } });
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
    if (method === 'tools/call') {
      const tool = TOOLS.find(t => t.name === params.name);
      if (!tool) return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'unknown tool ' + params.name }], isError: true } });
      log('call', params.name, JSON.stringify(params.arguments || {}));
      try { const out = await tool.run(params.arguments || {}); return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] } }); }
      catch (e) { return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true } }); }
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } });
  } catch (e) { send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } }); }
});
log('ready; data in', DATA);
