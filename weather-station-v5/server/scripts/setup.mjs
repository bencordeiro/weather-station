import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const destination = fileURLToPath(new URL('../.env', import.meta.url));
const template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
try {
  writeFileSync(destination, template.replace('INGEST_API_KEY=\n', `INGEST_API_KEY=${randomBytes(32).toString('hex')}\n`), { flag: 'wx', mode: 0o600 });
  console.log('Created .env with a new station key (file permissions 0600).');
  console.log('Set the firmware API_KEY to the INGEST_API_KEY in that file. The key is not printed.');
  console.log('Configure PUBLIC_ORIGIN when you have chosen your public HTTPS hostname.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('.env already exists; preserved its settings and station key.');
  else { console.error('Could not create .env:', error.code || error.name); process.exitCode = 1; }
}
