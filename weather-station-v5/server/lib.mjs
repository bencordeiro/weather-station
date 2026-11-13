import { createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function numberSetting(env, name, fallback, min, max) {
  const value = env[name] === undefined || env[name] === '' ? fallback : Number(env[name]);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}

export function configFromEnv(env = process.env) {
  const key = env.INGEST_API_KEY || '';
  if (key.length < 1 || key.length > 256 || /[\s\x00-\x1f\x7f]/.test(key)) {
    throw new Error('INGEST_API_KEY must contain 1–256 non-whitespace characters. Run node scripts/setup.mjs.');
  }
  const device = env.DEVICE_ID || 'outdoor-esp32-v5';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(device)) throw new Error('Invalid DEVICE_ID');
  const timezone = env.TIME_ZONE || 'America/Toronto';
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format();
  const origin = env.PUBLIC_ORIGIN || '';
  if (origin && (new URL(origin).origin !== origin || new URL(origin).protocol !== 'https:')) {
    throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash or path.');
  }
  const town = env.TOWN || 'Shelburne';
  const region = env.REGION || 'Ontario';
  if (town.length > 80 || region.length > 80) throw new Error('Town/region too long');
  const port = numberSetting(env, 'PORT', 8787, 0, 65535);
  const retentionDays = numberSetting(env, 'RETENTION_DAYS', 365, 7, 3650);
  if (!Number.isInteger(port) || !Number.isInteger(retentionDays)) throw new Error('PORT and RETENTION_DAYS must be integers.');
  if (env.TRUST_PROXY && !['true', 'false'].includes(env.TRUST_PROXY)) throw new Error('TRUST_PROXY must be true or false.');
  for (const key of ['WIND_ENABLED', 'RAIN_ENABLED', 'ELEVATION_VERIFIED']) {
    if (env[key] && !['true', 'false'].includes(env[key])) throw new Error(`${key} must be true or false.`);
  }
  return {
    key, device, timezone, origin, town, region,
    host: env.HOST || '127.0.0.1',
    port,
    dbPath: env.DB_PATH || './data/weather.sqlite',
    trustProxy: env.TRUST_PROXY === 'true',
    retentionDays,
    staleAfterSeconds: numberSetting(env, 'STALE_AFTER_SECONDS', 300, 60, 86400),
    rainMmPerTip: env.RAIN_MM_PER_TIP ? numberSetting(env, 'RAIN_MM_PER_TIP', null, 0.001, 100) : null,
    windEnabled: env.WIND_ENABLED === 'true', rainEnabled: env.RAIN_ENABLED === 'true',
    elevationM: numberSetting(env, 'STATION_ELEVATION_M', 500, -400, 6000),
    elevationVerified: env.ELEVATION_VERIFIED === 'true',
    pressureOffsetHpa: numberSetting(env, 'PRESSURE_OFFSET_HPA', 0, -50, 50),
  };
}

const limits = {
  temp_c: [-60, 85], humidity: [0, 100], pressure: [300, 1200], alt_m: [-2000, 12000],
  lux: [0, 65535], uv: [0, 4095], sound: [0, 4095], wind_kmh: [0, 400],
  rain_tips: [0, 10000], rssi: [-127, 0],
};
export const FIELDS = Object.keys(limits);

export function validateReading(body, device, { windEnabled = true, rainEnabled = true } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object.');
  if (body.device !== device) throw new HttpError(400, 'Unknown station.');
  if (Object.keys(body).some(key => key !== 'device' && !FIELDS.includes(key))) throw new HttpError(400, 'Unexpected field.');
  const result = {};
  // V5 substitutes four zeros when BME initialization fails. Keep that sample,
  // but store its environmental values as NULL instead of publishing zero weather.
  const bmeFailed = ['temp_c', 'humidity', 'pressure', 'alt_m'].every(key => body[key] === 0);
  for (const [key, [min, max]] of Object.entries(limits)) {
    if ((key === 'wind_kmh' && !windEnabled) || (key === 'rain_tips' && !rainEnabled)) {
      result[key] = null;
      continue;
    }
    const value = body[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new HttpError(400, `Invalid ${key}.`);
    if ((key === 'rain_tips' || key === 'uv' || key === 'sound' || key === 'rssi') && !Number.isInteger(value)) {
      throw new HttpError(400, `Invalid ${key}.`);
    }
    const failed = bmeFailed && ['temp_c', 'humidity', 'pressure', 'alt_m'].includes(key);
    if (!failed && (value < min || value > max)) throw new HttpError(400, `Out-of-range ${key}.`);
    result[key] = failed ? null : value;
  }
  return result;
}

export function keyMatches(provided, expected) {
  if (typeof provided !== 'string' || provided.length > 256) return false;
  const hash = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(provided), hash(expected));
}

export class RateLimiter {
  constructor(maxEntries = 4096) { this.entries = new Map(); this.maxEntries = maxEntries; }
  allow(key, limit, windowMs = 60000, now = Date.now()) {
    let entry = this.entries.get(key);
    if (entry && now >= entry.until) { this.entries.delete(key); entry = undefined; }
    if (!entry) {
      if (this.entries.size >= this.maxEntries) {
        for (const [id, item] of this.entries) if (now >= item.until) this.entries.delete(id);
        if (this.entries.size >= this.maxEntries) return false;
      }
      entry = { until: now + windowMs, count: 0 };
      this.entries.set(key, entry);
    }
    entry.count++;
    return entry.count <= limit;
  }
}

export const RANGES = { '6h': 6 * 3600000, '24h': 24 * 3600000, '7d': 7 * 86400000 };
export const BUCKET_MS = { '6h': 60000, '24h': 300000, '7d': 1800000 };

export class WeatherStore {
  constructor(path, retentionDays = 365) {
    if (path !== ':memory:') {
      const file = resolve(path);
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(resolve(path), 0o600);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) { this.db.close(); throw new Error('Database schema is newer than this server.'); }
    if (version === 0) this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS readings (
        id INTEGER PRIMARY KEY,
        received_at INTEGER NOT NULL,
        temp_c REAL, humidity REAL, pressure REAL, alt_m REAL,
        lux REAL NOT NULL, uv INTEGER NOT NULL, sound INTEGER NOT NULL,
        wind_kmh REAL, rain_tips INTEGER, rssi INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS readings_time ON readings(received_at);
      PRAGMA user_version = 1;
      COMMIT;
    `);
    this.insertStatement = this.db.prepare(`INSERT INTO readings (received_at, ${FIELDS.join(', ')}) VALUES (${Array(FIELDS.length + 1).fill('?').join(', ')})`);
    this.retentionDays = retentionDays;
    this.lastCleanup = 0;
  }
  insert(reading, now = Date.now()) {
    const cleanup = now - this.lastCleanup > 3600000;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.insertStatement.run(now, ...FIELDS.map(key => reading[key]));
      if (cleanup) this.db.prepare('DELETE FROM readings WHERE received_at < ?').run(now - this.retentionDays * 86400000);
      this.db.exec('COMMIT');
      if (cleanup) this.lastCleanup = now;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  latest() { return this.db.prepare('SELECT * FROM readings ORDER BY received_at DESC, id DESC LIMIT 1').get() || null; }
  pressureTrend(latest) {
    if (!latest || latest.pressure === null) return null;
    const target = latest.received_at - 3 * 3600000;
    const baseline = this.db.prepare(`SELECT pressure, received_at FROM readings WHERE pressure IS NOT NULL
      AND received_at BETWEEN ? AND ? ORDER BY ABS(received_at - ?) LIMIT 1`)
      .get(target - 15 * 60000, target + 15 * 60000, target);
    if (!baseline) return null;
    const delta = latest.pressure - baseline.pressure;
    // Report continuity separately from the endpoint change. It describes data
    // coverage only; it cannot establish sensor accuracy or forecast skill.
    const samples = this.db.prepare(`SELECT pressure, received_at FROM readings
      WHERE received_at >= ? AND received_at <= ? ORDER BY received_at, id`)
      .all(baseline.received_at, latest.received_at);
    const valid = samples.filter(sample => sample.pressure !== null);
    const missingSamples = samples.length - valid.length;
    let maxGap = 0;
    for (let i = 1; i < valid.length; i++) maxGap = Math.max(maxGap, valid[i].received_at - valid[i - 1].received_at);
    // Include the boundaries so an absent endpoint can never appear complete.
    if (!valid.length) maxGap = latest.received_at - baseline.received_at;
    else maxGap = Math.max(maxGap, valid[0].received_at - baseline.received_at, latest.received_at - valid.at(-1).received_at);
    const coverage = { valid_samples: valid.length, missing_samples: missingSamples,
      max_gap_minutes: maxGap / 60000, consistent: valid.length >= 2 && missingSamples === 0 && maxGap <= 15 * 60000 };
    return { delta_hpa: delta, hours: (latest.received_at - baseline.received_at) / 3600000,
      direction: delta > 0.5 ? 'rising' : delta < -0.5 ? 'falling' : 'steady', coverage };
  }
  summary(since, until = Date.now()) {
    return this.db.prepare(`SELECT COUNT(*) AS samples, MIN(temp_c) AS low_c, MAX(temp_c) AS high_c,
      MAX(wind_kmh) AS peak_wind_kmh, SUM(rain_tips) AS rain_tips
      FROM readings WHERE received_at >= ? AND received_at <= ?`).get(since, until);
  }
  history(range, now = Date.now()) {
    const bucketMs = BUCKET_MS[range];
    if (!bucketMs) throw new Error('Invalid history range.');
    const averages = FIELDS.filter(key => key !== 'rain_tips').map(key => `AVG(${key}) AS ${key}`).join(', ');
    return this.db.prepare(`SELECT CAST(received_at / ? AS INTEGER) * ? AS received_at,
      ${averages}, SUM(rain_tips) AS rain_tips, COUNT(*) AS samples
      FROM readings WHERE received_at >= ? AND received_at <= ?
      GROUP BY CAST(received_at / ? AS INTEGER) ORDER BY received_at LIMIT 1441`)
      .all(bucketMs, bucketMs, now - RANGES[range], now, bucketMs);
  }
  close() { this.db.close(); }
}

export function startOfDay(now, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const day = formatter.format(new Date(now));
  // Find the exact local date boundary. This handles 23/25-hour DST days
  // without assuming today's UTC offset also applied at midnight.
  let low = now - 30 * 3600000, high = now;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (formatter.format(new Date(mid)) === day) high = mid;
    else low = mid;
  }
  return high;
}

export function publicReading(row) {
  if (!row) return null;
  const { id, rssi, ...safe } = row;
  return safe;
}

export function adjustedReading(row, config) {
  const safe = publicReading(row);
  if (!safe) return null;
  const calibrated = safe.pressure === null ? null : safe.pressure + config.pressureOffsetHpa;
  // Standard-atmosphere reduction (an altimeter-style estimate), not an
  // observed-temperature meteorological mean-sea-level pressure calculation.
  const sea = calibrated === null ? null : calibrated / (1 - 0.0065 * config.elevationM / 288) ** 5.2561;
  return { ...safe, pressure_calibrated: calibrated, pressure_sea_level: sea };
}
