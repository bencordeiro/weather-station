import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WeatherStore } from '../lib.mjs';
import { backupDatabase } from '../scripts/backup.mjs';

test('online backup is readable, consistent, private, and never overwrites an existing backup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'weather-backup-'));
  const source = join(dir, 'source.sqlite'), target = join(dir, 'backup.sqlite');
  const store = new WeatherStore(source);
  try {
    store.insert({ temp_c: 10, humidity: 60, pressure: 954, alt_m: 500, lux: 12000, uv: 12, sound: 40, wind_kmh: null, rain_tips: null, rssi: -65 });
    assert.equal(await backupDatabase(source, target), target);
    assert.equal(statSync(target).mode & 0o777, 0o600);
    const copy = new DatabaseSync(target, { readOnly: true });
    try { assert.equal(copy.prepare('SELECT COUNT(*) AS count FROM readings').get().count, 1); }
    finally { copy.close(); }
    await assert.rejects(backupDatabase(source, target), /already exists/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
