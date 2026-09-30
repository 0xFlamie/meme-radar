import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from '../src/config.mjs';
import { createServer } from '../src/server.mjs';

const caddy = process.env.CADDY_BIN || 'caddy';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-proxy-'));
const settings = { ...config, port: 0 };
const state = { value: { status: 'AVE_AUTH_REQUIRED', candidates: [] } };
let writes = 0;
let aveWrites = 0;
const aveSnapshot = () => ({ data: { configured: false, status: 'unconfigured' } });
const server = createServer({ state, settings, supportedChains: ['sol'],
  ave: { snapshot: aveSnapshot, configure: async () => { aveWrites++; return aveSnapshot(); } },
  switchChain: async () => { writes++; return { activeChain: 'sol' }; } });
let proxy;
let proxyError = '';
const password = 'isolated-proxy-test';
const auth = 'Basic ' + Buffer.from(`test:${password}`).toString('base64');

async function freePort() {
  const probe = http.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  settings.port = server.address().port;
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const hashed = spawnSync(caddy, ['hash-password'], { input: password + '\n', encoding: 'utf8' });
  assert.equal(hashed.status, 0, 'Caddy password hashing failed');
  const authFile = path.join(temporary, 'auth.caddy');
  fs.writeFileSync(authFile, `basic_auth {\n test ${hashed.stdout.trim()}\n}\n`, { mode: 0o600 });
  const fixture = path.join(temporary, 'Caddyfile');
  fs.writeFileSync(fixture, '{\n admin off\n auto_https off\n}\n' +
    fs.readFileSync(new URL('./Caddyfile', import.meta.url), 'utf8'));
  proxy = spawn(caddy, ['run', '--config', fixture, '--adapter', 'caddyfile'], {
    env: { ...process.env, RADAR_SITE: base, RADAR_AUTH_FILE: authFile,
      RADAR_UPSTREAM: `127.0.0.1:${settings.port}` }, stdio: ['ignore', 'ignore', 'pipe'] });
  proxy.stderr.on('data', chunk => { proxyError += chunk; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { await fetch(base); ready = true; break; }
    catch { if (proxy.exitCode !== null) break; await delay(50); }
  }
  assert.ok(ready, `Caddy did not start: ${proxyError}`);
  const request = (route, options = {}) => fetch(base + route, {
    ...options, headers: { Authorization: auth, ...options.headers } });
  assert.equal((await fetch(base)).status, 401);
  assert.equal((await request('/', { headers: { Authorization: 'Basic dGVzdDpiYWQ=' } })).status, 401);
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/voice-ui.mjs')).status, 200);
  assert.equal((await request('/api/status')).status, 200);
  assert.equal((await request('/api/ave-status')).status, 200);
  const post = { method: 'POST', headers: { Origin: 'https://meme.polymeow.com',
    'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: '{"chain":"sol"}' };
  assert.equal((await request('/api/active-chain', post)).status, 202);
  assert.equal(writes, 1);
  const avePost = { ...post, body: '{"key":"isolated-test-not-real"}' };
  assert.equal((await request('/api/ave-configure', avePost)).status, 200);
  assert.equal((await request('/api/ave-configure', { ...avePost,
    headers: { ...post.headers, Origin: 'https://evil.invalid' } })).status, 403);
  assert.equal(aveWrites, 1);
  for (const origin of ['https://evil.invalid', 'https://pp.polymeow.com', 'null', 'http://meme.polymeow.com']) {
    assert.equal((await request('/api/active-chain', { ...post,
      headers: { ...post.headers, Origin: origin } })).status, 403);
  }
  assert.equal((await request('/api/active-chain', { ...post,
    headers: { 'Content-Type': 'application/json' } })).status, 403);
  assert.equal((await request('/api/active-chain', { ...post,
    headers: { ...post.headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await request('/api/active-chain', { ...post,
    headers: { ...post.headers, 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal(writes, 1);
  const page = await request('/');
  assert.match(page.headers.get('content-security-policy'), /script-src 'self' 'sha256-/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  console.log('Proxy verified: login, page/modules/API, same-origin writes, foreign/missing origin and cross-site rejection.');
} finally {
  if (proxy && proxy.exitCode === null) { proxy.kill('SIGTERM'); await once(proxy, 'exit'); }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
}
