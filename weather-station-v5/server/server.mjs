import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { configFromEnv, HttpError, FIELDS, keyMatches, validateReading, RateLimiter, WeatherStore, RANGES, BUCKET_MS, startOfDay, adjustedReading } from './lib.mjs';

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const assetNames = { '/': ['index.html', 'text/html; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/theme.js': ['theme.js', 'text/javascript; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/model.js': ['model.js', 'text/javascript; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };

function json(res, status, body, extra = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', ...extra });
  res.end(bytes);
}

async function readBody(req) {
  if (req.headers['content-encoding']) throw new HttpError(415, 'Compressed uploads are not accepted.');
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Use application/json.');
  const length = Number(req.headers['content-length'] || 0);
  if (length > 4096) throw new HttpError(413, 'Payload too large.');
  const buffer = await new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0, rejected = false;
    req.on('data', chunk => {
      if (rejected) return;
      size += chunk.length;
      if (size > 4096) {
        rejected = true;
        rejectBody(new HttpError(413, 'Payload too large.'));
      } else chunks.push(chunk);
    });
    req.on('end', () => { if (!rejected) resolveBody(Buffer.concat(chunks)); });
    req.on('error', rejectBody);
    req.on('aborted', () => rejectBody(new HttpError(400, 'Upload interrupted.')));
  });
  try { return JSON.parse(buffer.toString('utf8')); }
  catch { throw new HttpError(400, 'Malformed JSON.'); }
}

export function createApp(config, { store = new WeatherStore(config.dbPath, config.retentionDays), now = Date.now } = {}) {
  const limiter = new RateLimiter();
  const cache = new Map();
  const assets = new Map(Object.entries(assetNames).map(([route, [name, type]]) => [route, { bytes: readFileSync(new URL(`./public/${name}`, import.meta.url)), type }]));
  let lastIngest = store.latest()?.received_at ?? -Infinity;
  const publicConfig = {
    town: config.town, region: config.region, timezone: config.timezone,
    rain_mm_per_tip: config.rainMmPerTip, refresh_seconds: 30, stale_after_seconds: config.staleAfterSeconds,
    units: { temp_c: '°C', humidity: '% RH', pressure: 'hPa (station pressure)', alt_m: 'm (pressure-derived)', lux: 'lx', uv: 'raw ADC', sound: 'raw peak-to-peak ADC', wind_kmh: 'km/h', rain_tips: 'tips per reporting interval' },
    wind_enabled: config.windEnabled, rain_enabled: config.rainEnabled,
    elevation_m: config.elevationM, elevation_verified: config.elevationVerified,
    pressure_offset_hpa: config.pressureOffsetHpa,
  };
  const server = http.createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.origin) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const peer = req.socket.remoteAddress || 'unknown';
    const forwarded = req.headers['x-forwarded-for'];
    // A trusted direct proxy must overwrite this with a single client address.
    // Ignore malformed values and chains; never trust this header by default.
    const ip = config.trustProxy && typeof forwarded === 'string' && isIP(forwarded.trim()) ? forwarded.trim() : peer;
    try {
      if (!limiter.allow('global', 18000, 60000, now()) || !limiter.allow(`ip:${ip}`, 240, 60000, now())) {
        throw new HttpError(429, 'Too many requests. Try again shortly.');
      }
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (req.method === 'POST' && path === '/ingest') {
        // No browser write flow exists. A station has no Origin header.
        if (req.headers.origin || req.headers['sec-fetch-site']) throw new HttpError(403, 'Station uploads only.');
        if (!keyMatches(req.headers['x-api-key'], config.key)) {
          if (!limiter.allow(`badkey:${ip}`, 10, 60000, now())) throw new HttpError(429, 'Too many authentication attempts.');
          throw new HttpError(401, 'Invalid station credentials.');
        }
        const reading = validateReading(await readBody(req), config.device, config);
        // One station posts roughly once a minute. Bound database growth if a
        // client loops accidentally; the limit is shared across client addresses.
        const time = now();
        if (time - lastIngest < 10000) throw new HttpError(429, 'Wait at least 10 seconds between readings.');
        store.insert(reading, time);
        lastIngest = time;
        cache.clear();
        return json(res, 200, { ok: true });
      }
      if (path === '/ingest' || (req.method !== 'GET' && req.method !== 'HEAD')) {
        return json(res, 405, { error: 'Method not allowed.' }, { Allow: path === '/ingest' ? 'POST' : 'GET, HEAD' });
      }
      if (path === '/healthz') { store.latest(); return json(res, 200, { ok: true }); }
      if (path === '/api/config') return json(res, 200, publicConfig);
      if (path === '/api/latest') {
        const time = now();
        let result = cache.get('latest');
        const dayStart = startOfDay(time, config.timezone);
        if (!result || time - result.time >= 10000 || result.dayStart !== dayStart) {
          const latest = store.latest();
          const today = store.summary(dayStart, time);
          const recent = store.summary(time - 86400000, time);
          result = { time, dayStart, body: { reading: adjustedReading(latest, config), today, last_24h: recent, pressure_trend: store.pressureTrend(latest) } };
          cache.set('latest', result);
        }
        const reading = result.body.reading;
        const age = reading ? Math.max(0, (time - reading.received_at) / 1000) : null;
        return json(res, 200, {
          ...result.body, server_time: time, today_start: dayStart,
          station: {
            state: !reading ? 'waiting' : age > config.staleAfterSeconds ? 'stale' : 'online',
            age_seconds: age === null ? null : Math.floor(age),
            bme280_ok: reading ? reading.temp_c !== null : null,
          },
        });
      }
      if (path === '/api/history' || path === '/api/export.csv') {
        const range = url.searchParams.get('range') || '24h';
        if (!Object.hasOwn(RANGES, range)) throw new HttpError(400, 'Range must be 6h, 24h, or 7d.');
        if (path === '/api/export.csv') {
          if (!limiter.allow('export:global', 12, 60000, now())) throw new HttpError(429, 'Export busy. Try again shortly.');
          const fields = ['received_at', ...FIELDS.filter(key => key !== 'rssi'), 'pressure_calibrated', 'pressure_sea_level', 'samples'];
          // Export the same bounded buckets as the chart API. Rain is summed;
          // other measurements are averaged, with missing BME values left blank.
          const rows = store.history(range, now()).map(row => adjustedReading(row, config));
          const csv = [fields.join(','), ...rows.map(row => fields.map(key => key === 'received_at' ? new Date(row[key]).toISOString() : row[key] ?? '').join(','))].join('\r\n') + '\r\n';
          res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Length': Buffer.byteLength(csv), 'Content-Disposition': `attachment; filename="shelburne-weather-${range}.csv"`, 'Cache-Control': 'no-store' });
          return res.end(req.method === 'HEAD' ? undefined : csv);
        }
        let result = cache.get(`history:${range}`);
        if (!result || now() - result.time >= 15000) {
          result = { time: now(), rows: store.history(range, now()).map(row => adjustedReading(row, config)) };
          cache.set(`history:${range}`, result);
        }
        return json(res, 200, { range, bucket_seconds: BUCKET_MS[range] / 1000, readings: result.rows });
      }
      const asset = assets.get(path);
      if (asset) {
        res.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.bytes.length, 'Cache-Control': path === '/' ? 'no-cache' : 'public, max-age=300' });
        return res.end(req.method === 'HEAD' ? undefined : asset.bytes);
      }
      throw new HttpError(404, 'Not found.');
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error('Request failed:', error.code || error.name);
      req.resume();
      const headers = { ...(status === 429 ? { 'Retry-After': '60' } : {}), ...(status === 413 ? { Connection: 'close' } : {}) };
      json(res, status, { error: status === 500 ? 'Service temporarily unavailable.' : error.message }, headers);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  server.on('close', () => store.close());
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.umask(0o077);
    const config = configFromEnv();
    const server = createApp(config);
    server.on('error', error => { console.error('Server could not listen:', error.code || error.name); process.exitCode = 1; });
    server.listen(config.port, config.host, () => console.log(`Shelburne Weather listening on http://${config.host}:${server.address().port}`));
    const stop = () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
