import { Duplex } from 'node:stream';
import { once } from 'node:events';
import http from 'node:http';

// Feed serialized requests through the real Node HTTP parser without opening a
// network port. No request/response handlers or database behavior are mocked.
class MemorySocket extends Duplex {
  remoteAddress = '127.0.0.1';
  remotePort = 40000;
  writable = true;
  chunks = [];
  _read() {}
  _write(chunk, encoding, callback) { this.chunks.push(Buffer.from(chunk)); callback(); }
  setTimeout() { return this; }
  setNoDelay() { return this; }
  setKeepAlive() { return this; }
  ref() { return this; }
  unref() { return this; }
}

export async function memoryRequest(app, path, options = {}, chunked = false) {
  const socket = new MemorySocket();
  const done = once(socket, 'finish');
  const method = options.method || 'GET';
  const headers = new Headers(options.headers);
  headers.set('Host', 'localhost');
  headers.set('Connection', 'close');
  const body = Buffer.from(options.body || '');
  if (chunked) headers.set('Transfer-Encoding', 'chunked');
  else if (body.length) headers.set('Content-Length', String(body.length));
  let request = `${method} ${path} HTTP/1.1\r\n`;
  headers.forEach((value, name) => { request += `${name}: ${value}\r\n`; });
  request += '\r\n';
  app.emit('connection', socket);
  socket.push(Buffer.from(request));
  if (chunked) {
    for (let offset = 0; offset < body.length; offset += 2000) {
      const chunk = body.subarray(offset, offset + 2000);
      socket.push(Buffer.concat([Buffer.from(chunk.length.toString(16) + '\r\n'), chunk, Buffer.from('\r\n')]));
    }
    socket.push(Buffer.from('0\r\n\r\n'));
  } else if (body.length) socket.push(body);
  await done;
  const raw = Buffer.concat(socket.chunks);
  socket.destroy();
  const end = raw.indexOf('\r\n\r\n');
  if (end < 0) throw new Error('Missing HTTP response headers');
  const lines = raw.subarray(0, end).toString('utf8').split('\r\n');
  const status = Number(lines.shift().split(' ')[1]);
  const responseHeaders = new Headers();
  for (const line of lines) {
    const colon = line.indexOf(':');
    responseHeaders.append(line.slice(0, colon), line.slice(colon + 1).trim());
  }
  return new Response(method === 'HEAD' || status === 204 ? null : raw.subarray(end + 4), { status, headers: responseHeaders });
}

export function tcpChunkedRequest(base, path, options) {
  return new Promise((resolve, reject) => {
    const request = http.request(base + path, { method: 'POST', headers: options.headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    });
    request.on('error', reject);
    const body = options.body || '';
    request.write(body.slice(0, 2000));
    request.end(body.slice(2000));
  });
}
