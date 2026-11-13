import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/model.js';

const M = globalThis.WeatherModel;

test('display model preserves zero readings and omits missing data rather than drawing zero weather', () => {
  const rows = [{ received_at: 1000, temp_c: 0 }, { received_at: 2000, temp_c: null }, { received_at: 3000, temp_c: NaN }];
  assert.deepEqual(M.points(rows, 'temp_c'), [{ time: 1000, value: 0 }]);
  assert.deepEqual(M.points(rows, 'temp_c', 'F'), [{ time: 1000, value: 32 }]);
  assert.equal(M.temperature(null, 'F'), null);
  assert.equal(M.seaLevel(null), null);
});

test('sample preview is deterministic browser data, with uncommissioned instruments absent', () => {
  const data = M.demo(M.defaults, Date.parse('2026-10-21T17:00:00Z'));
  assert.ok(data.readings.length > 200 && data.readings.length < 400);
  assert.ok(data.latest.today.high_c > data.latest.today.low_c);
  assert.equal(data.latest.reading.wind_kmh, null);
  assert.equal(data.latest.reading.rain_tips, null);
  assert.equal(data.latest.pressure_trend.coverage.consistent, true);
  assert.ok(data.latest.pressure_trend.coverage.valid_samples > 30);
  assert.ok(data.latest.reading.pressure_sea_level > data.latest.reading.pressure);
  assert.equal(M.demo(M.defaults, Date.parse('2026-10-21T17:00:00Z')).latest.reading.temp_c, data.latest.reading.temp_c);
  for (const range of ['6h', '24h', '7d']) assert.ok(M.demo(M.defaults, Date.now(), range).readings.length <= 1441);
});
