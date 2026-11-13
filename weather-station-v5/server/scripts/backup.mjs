import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, chmodSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function backupDatabase(sourcePath, destination) {
  const source = resolve(sourcePath);
  const target = resolve(destination);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(source, { readOnly: true });
  let reserved = false;
  try {
    // Reserve a private file atomically before SQLite opens it. This avoids
    // both overwriting an existing backup and a temporarily readable backup.
    try { closeSync(openSync(target, 'wx', 0o600)); reserved = true; }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('Backup destination already exists; choose a new filename.');
      throw error;
    }
    await backup(db, target);
    chmodSync(target, 0o600);
    return target;
  } catch (error) { if (reserved) unlinkSync(target); throw error; }
  finally { db.close(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (!process.argv[2]) throw new Error('Usage: npm run backup -- /absolute/path/weather-backup.sqlite');
    await backupDatabase(process.env.DB_PATH || './data/weather.sqlite', process.argv[2]);
    console.log('SQLite backup completed.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
