import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
import { configFromEnv, WeatherStore, startOfDay, validateReading, RateLimiter, adjustedReading } from '../lib.mjs';
import { memoryRequest, tcpChunkedRequest } from './transport.mjs';

const KEY = 'test-only-key-with-at-least-thirty-two-characters';
const DEVICE = 'outdoor-esp32-v5';
const NOW = Date.parse('2026-10-21T17:00:00Z');
const sample = {
  device: DEVICE, temp_c: 12.35, humidity: 62.5, pressure: 966.21, alt_m: 402.1,
  lux: 18300, uv: 412, sound: 90, wind_kmh: 8.45, rain_tips: 2, rssi: -61,
};
const credentials = { 'Content-Type': 'application/json', 'X-Api-Key': KEY };

async function start(t, { env = {}, path = ':memory:', initialNow = NOW } = {}) {
  let clock = initialNow;
  const config = configFromEnv({ INGEST_API_KEY: KEY, DB_PATH: path, WIND_ENABLED: 'true', RAIN_ENABLED: 'true', ...env });
  const store = new WeatherStore(path, config.retentionDays);
  const app = createApp(config, { store, now: () => clock });
  const tcp = process.env.WEATHER_TEST_TRANSPORT === 'tcp';
  if (tcp) {
    app.listen(0, '127.0.0.1');
    await once(app, 'listening');
  }
  let closed = false;
  const stop = async () => {
    if (closed) return;
    closed = true;
    if (!tcp) { app.close(); return; }
    const closing = once(app, 'close');
    app.close();
    app.closeIdleConnections();
    await closing;
  };
  t.after(stop);
  const base = tcp ? `http://127.0.0.1:${app.address().port}` : 'http://memory.test';
  const request = (path, options) => tcp ? fetch(base + path, options) : memoryRequest(app, path, options);
  return {
    base, store, config, app, stop,
    advance: ms => { clock += ms; },
    get: request,
    chunked: options => tcp ? tcpChunkedRequest(base, '/ingest', options) : memoryRequest(app, '/ingest', options, true),
    post: (body = sample, options = {}) => request('/ingest', { method: 'POST', headers: credentials, body: JSON.stringify(body), ...options }),
  };
}

test('dashboard and its assets are served; empty station has an honest waiting state', async t => {
  const app = await start(t);
  const root = await app.get('/');
  assert.equal(root.status, 200);
  assert.match(await root.text(), /ESP Weather Shelburne/);
  for (const path of ['/app.js', '/model.js', '/theme.js', '/styles.css', '/favicon.svg']) assert.equal((await app.get(path)).status, 200);
  const latest = await (await app.get('/api/latest')).json();
  assert.equal(latest.reading, null);
  assert.equal(latest.station.state, 'waiting');
  assert.equal(latest.station.age_seconds, null);
  assert.equal(latest.today.samples, 0);
  assert.equal(latest.today.high_c, null);
  assert.deepEqual(await (await app.get('/healthz')).json(), { ok: true });
  const config = await (await app.get('/api/config')).json();
  assert.equal(config.town, 'Shelburne');
  assert.equal(config.timezone, 'America/Toronto');
  assert.equal(config.rain_mm_per_tip, null);
  assert.equal(JSON.stringify(config).includes(KEY), false);
  assert.equal(JSON.stringify(config).includes(DEVICE), false);
});

test('V5 upload persists all measurements while public responses omit internal IDs and signal strength', async t => {
  const app = await start(t);
  const response = await app.post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  const result = await (await app.get('/api/latest')).json();
  assert.equal(result.reading.temp_c, sample.temp_c);
  assert.equal(result.reading.received_at, NOW);
  assert.equal(result.station.state, 'online');
  assert.equal(result.station.bme280_ok, true);
  assert.equal(result.today.rain_tips, 2);
  assert.equal(Object.hasOwn(result.reading, 'rssi'), false);
  assert.equal(Object.hasOwn(result.reading, 'id'), false);
  assert.equal(Object.hasOwn(result.reading, 'device'), false);
  assert.equal(app.store.latest().rssi, -61);
  app.advance(301000);
  const stale = await (await app.get('/api/latest')).json();
  assert.equal(stale.station.state, 'stale');
  assert.equal(stale.station.age_seconds, 301);
});

test('missing and wrong upload keys cannot write; a read-only visitor never needs a key', async t => {
  const app = await start(t);
  for (const headers of [{ 'Content-Type': 'application/json' }, { ...credentials, 'X-Api-Key': 'wrong' }]) {
    const response = await app.post(sample, { headers });
    assert.equal(response.status, 401);
    assert.equal(JSON.stringify(await response.json()).includes(KEY), false);
  }
  assert.equal(app.store.latest(), null);
  assert.equal((await app.get('/api/latest')).status, 200);
  assert.equal((await app.get('/ingest')).status, 405);
});

test('rejects browser writes and CORS preflight without enabling CORS', async t => {
  const app = await start(t);
  for (const extra of [{ Origin: 'https://other.example' }, { 'Sec-Fetch-Site': 'same-origin' }]) {
    assert.equal((await app.post(sample, { headers: { ...credentials, ...extra } })).status, 403);
  }
  const options = await app.get('/ingest', { method: 'OPTIONS', headers: { Origin: 'https://other.example' } });
  assert.equal(options.status, 405);
  assert.equal(options.headers.has('access-control-allow-origin'), false);
  assert.equal(app.store.latest(), null);
});

test('rejects malformed, missing, unknown, and out-of-range input before writing', async t => {
  const app = await start(t);
  const bad = [null, [], {}, { ...sample, temp_c: '12.3' }, { ...sample, humidity: null },
    { ...sample, device: 'other-station' }, { ...sample, humidity: 101 }, { ...sample, uv: 4096 },
    { ...sample, rain_tips: -1 }, { ...sample, rain_tips: 0.5 }, { ...sample, extra: true },
    { ...sample, received_at: 1 }, { ...sample, sound: 65535 }, { ...sample, pressure: 0 }];
  for (const body of bad) {
    const response = await app.post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  const missing = { ...sample }; delete missing.wind_kmh;
  assert.equal((await app.post(missing)).status, 400);
  assert.equal((await app.post(sample, { body: '{"temp_c":nan}' })).status, 400);
  assert.equal((await app.post(sample, { body: JSON.stringify(sample).replace('12.35', '1e999') })).status, 400);
  assert.equal(app.store.latest(), null);
  assert.equal((await app.post()).status, 200);
});

test('BME280 failure sentinel becomes missing measurements without losing wind/light/rain', async t => {
  const app = await start(t);
  const failed = { ...sample, temp_c: 0, humidity: 0, pressure: 0, alt_m: 0 };
  assert.equal((await app.post(failed)).status, 200);
  const result = await (await app.get('/api/latest')).json();
  assert.equal(result.station.bme280_ok, false);
  for (const key of ['temp_c', 'humidity', 'pressure', 'alt_m']) assert.equal(result.reading[key], null);
  assert.equal(result.reading.lux, sample.lux);
  assert.equal(result.reading.wind_kmh, sample.wind_kmh);
  assert.equal(result.today.high_c, null);
  assert.equal(result.today.rain_tips, 2);
  const csv = await (await app.get('/api/export.csv')).text();
  assert.match(csv, /Z,,,,,18300/);
});

test('temperature zero alone is valid weather', () => {
  assert.equal(validateReading({ ...sample, temp_c: 0 }, DEVICE).temp_c, 0);
});

test('content-type, compressed, declared oversized, and chunked oversized payloads are bounded', async t => {
  const app = await start(t);
  assert.equal((await app.post(sample, { headers: { ...credentials, 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await app.post(sample, { headers: { ...credentials, 'Content-Encoding': 'gzip' } })).status, 415);
  assert.equal((await app.post(sample, { body: 'a'.repeat(4097) })).status, 413);
  const response = await app.chunked({ method: 'POST', headers: credentials, body: 'a'.repeat(5000) });
  assert.equal(response.status, 413);
  assert.equal(app.store.latest(), null);
});

test('ingest interval survives restarts and database records persist', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'weather-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'weather.sqlite');
  const first = await start(t, { path });
  assert.equal((await first.post()).status, 200);
  const tooSoon = await first.post();
  assert.equal(tooSoon.status, 429);
  assert.equal(tooSoon.headers.get('retry-after'), '60');
  await first.stop();
  const second = await start(t, { path, initialNow: NOW + 1000 });
  assert.equal((await (await second.get('/api/latest')).json()).reading.temp_c, sample.temp_c);
  assert.equal((await second.post()).status, 429);
  second.advance(9000);
  assert.equal((await second.post()).status, 200);
  assert.equal(second.store.summary(NOW).samples, 2);
  await second.stop();
});

test('history buckets average weather, sum rain, omit gaps, and stay bounded for every range', async t => {
  const app = await start(t);
  const minute = Math.floor(NOW / 60000) * 60000;
  const reading = validateReading(sample, DEVICE);
  app.store.insert({ ...reading, temp_c: 10, rain_tips: 1 }, minute - 60000);
  app.store.insert({ ...reading, temp_c: 14, rain_tips: 2 }, minute - 50000);
  app.store.insert({ ...reading, temp_c: null, humidity: null, pressure: null, alt_m: null, rain_tips: 3 }, minute - 40000);
  const response = await app.get('/api/history?range=6h');
  const history = await response.json();
  assert.equal(history.bucket_seconds, 60);
  assert.equal(history.readings.length, 1);
  assert.equal(history.readings[0].temp_c, 12);
  assert.equal(history.readings[0].rain_tips, 6);
  assert.equal(history.readings[0].samples, 3);
  assert.equal(Object.hasOwn(history.readings[0], 'rssi'), false);
  for (const range of ['6h', '24h', '7d']) {
    const result = await (await app.get('/api/history?range=' + range)).json();
    assert.ok(result.readings.length <= 1441);
  }
  for (const range of ['forever', '__proto__', 'constructor', "24h'; DROP TABLE readings;--"]) {
    assert.equal((await app.get('/api/history?range=' + encodeURIComponent(range))).status, 400);
  }
  const csv = await app.get('/api/export.csv?range=6h');
  assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(csv.headers.get('content-disposition'), 'attachment; filename="shelburne-weather-6h.csv"');
  assert.equal((await csv.text()).split('\r\n').length, 3);
});

test('public APIs cannot read filesystem paths, credentials, source, or database files', async t => {
  const app = await start(t, { env: { PUBLIC_ORIGIN: 'https://weather.example' } });
  for (const path of ['/.env', '/server.mjs', '/data/weather.sqlite', '/%2e%2e/.env', '/favicon.ico']) {
    const response = await app.get(path);
    assert.equal(response.status, 404);
    assert.equal((await response.text()).includes(KEY), false);
  }
  const response = await app.get('/api/config');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await (await app.get('/api/latest', { method: 'HEAD' })).text(), '');
});

test('brute-force limits do not block a valid key after failed guesses', async t => {
  const app = await start(t);
  for (let i = 0; i < 10; i++) assert.equal((await app.post(sample, { headers: { ...credentials, 'X-Api-Key': 'wrong' } })).status, 401);
  assert.equal((await app.post(sample, { headers: { ...credentials, 'X-Api-Key': 'wrong' } })).status, 429);
  assert.equal((await app.post()).status, 200);
});

test('forged forwarded addresses cannot bypass rate limits with proxy trust disabled', async t => {
  const app = await start(t);
  for (let i = 0; i < 240; i++) {
    assert.equal((await app.get('/healthz', { headers: { 'X-Forwarded-For': `192.0.2.${i % 250 + 1}` } })).status, 200);
  }
  assert.equal((await app.get('/healthz', { headers: { 'X-Forwarded-For': '198.51.100.1' } })).status, 429);
});

test('explicit proxy trust separates clients; comma-separated or invalid headers are ignored', async t => {
  const app = await start(t, { env: { TRUST_PROXY: 'true' } });
  for (let i = 0; i < 240; i++) assert.equal((await app.get('/healthz', { headers: { 'X-Forwarded-For': '192.0.2.1' } })).status, 200);
  assert.equal((await app.get('/healthz', { headers: { 'X-Forwarded-For': '192.0.2.1' } })).status, 429);
  assert.equal((await app.get('/healthz', { headers: { 'X-Forwarded-For': '192.0.2.2' } })).status, 200);
  assert.equal((await app.get('/healthz', { headers: { 'X-Forwarded-For': 'spoofed, 192.0.2.1' } })).status, 200);
});

test('rate limiter bounds attacker-controlled entries and recovers after expiry', () => {
  const limit = new RateLimiter(2);
  assert.equal(limit.allow('a', 1, 1000, 0), true);
  assert.equal(limit.allow('b', 1, 1000, 0), true);
  assert.equal(limit.allow('a', 1, 1000, 1), false);
  assert.equal(limit.allow('c', 1, 1000, 1), false);
  assert.equal(limit.allow('c', 1, 1000, 1000), true);
  assert.ok(limit.entries.size <= 2);
});

test('Toronto daily boundaries follow EST/EDT, including 23-hour and 25-hour days', () => {
  const zone = 'America/Toronto';
  for (const [now, expected] of [
    ['2026-03-08T18:00:00Z', '2026-03-08T05:00:00Z'],
    ['2026-03-09T18:00:00Z', '2026-03-09T04:00:00Z'],
    ['2026-11-01T18:00:00Z', '2026-11-01T04:00:00Z'],
    ['2026-11-02T18:00:00Z', '2026-11-02T05:00:00Z'],
    ['2026-10-21T04:00:00Z', '2026-10-21T04:00:00Z'],
  ]) assert.equal(new Date(startOfDay(Date.parse(now), zone)).toISOString(), new Date(expected).toISOString());
});

test('retention removes expired samples while preserving recent history', () => {
  const store = new WeatherStore(':memory:', 7);
  try {
    const reading = validateReading(sample, DEVICE);
    store.insert(reading, NOW - 8 * 86400000);
    store.insert(reading, NOW - 86400000);
    store.insert(reading, NOW);
    assert.equal(store.summary(0).samples, 2);
    assert.equal(store.latest().received_at, NOW);
  } finally { store.close(); }
});

test('unsafe or invalid server configuration is rejected before accepting traffic', () => {
  for (const env of [
    { INGEST_API_KEY: 'short' }, { INGEST_API_KEY: ' ' .repeat(40) },
    { PORT: '1.5' }, { PORT: '70000' }, { TIME_ZONE: 'Invalid/Zone' },
    { DEVICE_ID: '../station' }, { TRUST_PROXY: 'yes' }, { RETENTION_DAYS: '0' },
    { PUBLIC_ORIGIN: 'http://weather.example' }, { PUBLIC_ORIGIN: 'https://weather.example/path' },
    { RAIN_MM_PER_TIP: '-1' }, { STALE_AFTER_SECONDS: '0' }, { STATION_ELEVATION_M: '99999' },
    { PRESSURE_OFFSET_HPA: '200' }, { WIND_ENABLED: 'yes' },
  ]) assert.throws(() => configFromEnv({ INGEST_API_KEY: KEY, ...env }));
});

test('uncommissioned wind and rain are missing, never published as calm or dry weather', async t => {
  const app = await start(t, { env: { WIND_ENABLED: 'false', RAIN_ENABLED: 'false' } });
  const unbuilt = { ...sample, wind_kmh: 99999 };
  delete unbuilt.rain_tips;
  assert.equal((await app.post(unbuilt)).status, 200);
  const latest = await (await app.get('/api/latest')).json();
  assert.equal(latest.reading.wind_kmh, null);
  assert.equal(latest.reading.rain_tips, null);
  assert.equal(latest.today.rain_tips, null);
  assert.equal(latest.today.peak_wind_kmh, null);
  assert.equal(latest.reading.temp_c, sample.temp_c);
  const config = await (await app.get('/api/config')).json();
  assert.equal(config.wind_enabled, false);
  assert.equal(config.rain_enabled, false);
});

test('pressure estimate preserves the measurement and separates sensor offset from elevation', () => {
  const raw = { ...validateReading(sample, DEVICE), received_at: NOW };
  const base = configFromEnv({ INGEST_API_KEY: KEY, STATION_ELEVATION_M: '0' });
  assert.equal(adjustedReading(raw, base).pressure_sea_level, raw.pressure);
  const adjusted = adjustedReading(raw, { ...base, elevationM: 500, pressureOffsetHpa: 1.5 });
  assert.equal(adjusted.pressure, sample.pressure);
  assert.equal(adjusted.pressure_calibrated, sample.pressure + 1.5);
  assert.ok(adjusted.pressure_sea_level > 1020 && adjusted.pressure_sea_level < 1040);
  assert.equal(adjustedReading({ ...raw, pressure: null }, base).pressure_sea_level, null);
});

test('three-hour pressure tendency requires a real nearby baseline', () => {
  const store = new WeatherStore(':memory:');
  try {
    const reading = validateReading(sample, DEVICE);
    store.insert({ ...reading, pressure: 960 }, NOW - 3 * 3600000);
    store.insert({ ...reading, pressure: 958 }, NOW);
    assert.equal(store.pressureTrend(store.latest()).delta_hpa, -2);
    assert.equal(store.pressureTrend(store.latest()).direction, 'falling');
    assert.equal(store.pressureTrend({ ...store.latest(), received_at: NOW + 3600000 }), null);
    assert.equal(store.pressureTrend({ ...store.latest(), pressure: null }), null);
  } finally { store.close(); }
});

test('a storage write failure returns 500 without storing or acknowledging the upload', async t => {
  const app = await start(t);
  app.store.db.exec('PRAGMA query_only = ON');
  const response = await app.post();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Service temporarily unavailable.' });
  assert.equal(app.store.latest(), null);
});
