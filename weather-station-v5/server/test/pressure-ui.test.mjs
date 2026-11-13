import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const render = app.slice(app.indexOf('  function renderPressureStory()'), app.indexOf('  async function refresh()'));
const NOW = 1800000000000;
function story({ trend = null, reading = { pressure: 960, received_at: NOW }, offline = false } = {}) {
  const result = {};
  runInNewContext(`${render}\nrenderPressureStory();`, {
    latest: { reading, pressure_trend: trend }, offline, demo: false,
    config: { stale_after_seconds: 300 }, now: () => NOW,
    fmt: (value, decimals = 1) => Number(value).toFixed(decimals),
    text: (id, value) => { result[id] = value; },
  });
  return result;
}
const trend = { delta_hpa: -2.2, hours: 3, direction: 'falling',
  coverage: { valid_samples: 19, missing_samples: 0, max_gap_minutes: 10, consistent: true } };

test('current pressure trend shows measured change with qualified weather context', () => {
  const view = story({ trend });
  assert.equal(view['pressure-story-title'], 'Pressure falling');
  assert.match(view['pressure-delta'], /-2\.2 hPa over 3\.0 hours/);
  assert.match(view['pressure-story-copy'], /cannot predict a storm/);
  assert.match(view['pressure-coverage'], /19 pressure readings/);
  assert.match(view['pressure-coverage'], /not a forecast or sensor calibration/);
});

test('incomplete and stale readings do not produce current weather interpretation', () => {
  const limited = story({ trend: { ...trend, coverage: { ...trend.coverage, consistent: false, max_gap_minutes: 60 } } });
  assert.equal(limited['pressure-story-title'], 'Pressure change');
  assert.match(limited['pressure-story-copy'], /gaps or missing sensor data/);
  assert.match(limited['pressure-coverage'], /limited/);
  const unknown = story({ trend: { ...trend, coverage: undefined } });
  assert.equal(unknown['pressure-story-title'], 'Pressure change');
  assert.match(unknown['pressure-story-copy'], /coverage is unavailable/);
  const stale = story({ trend, reading: { pressure: 960, received_at: NOW - 301000 } });
  assert.equal(stale['pressure-story-title'], 'Last pressure trend');
  assert.match(stale['pressure-story-copy'], /no longer recent/);
  assert.match(stale['pressure-coverage'], /Last recorded window/);
  assert.equal(story({ trend, reading: null })['pressure-story-title'], 'Last pressure trend');
});

test('missing BME pressure is distinguished from a new station collecting history', () => {
  assert.equal(story({ reading: { pressure: null, received_at: NOW } })['pressure-story-title'], 'Pressure unavailable');
  assert.match(story({ reading: null })['pressure-delta'], /Collecting local history/);
  const staleWithoutTrend = story({ reading: { pressure: 960, received_at: NOW - 301000 } });
  assert.equal(staleWithoutTrend['pressure-story-title'], 'Pressure unavailable');
  assert.match(staleWithoutTrend['pressure-story-copy'], /no recent connection or readings/);
});
