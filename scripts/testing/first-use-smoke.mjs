import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from '../../src/config.mjs';
import { createAveSettings, AveError } from '../../src/ave-settings.mjs';
import { RadarState } from '../../src/state.mjs';
import { Scanner } from '../../src/scanner.mjs';
import { createServer } from '../../src/server.mjs';

// Offline AVE-only exercise: synthetic keys and provider responses.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-first-use-'));
const valid = 'synthetic-ave-valid-key', invalid = 'synthetic-ave-invalid-key';
const state = new RadarState(temporary);
let scanner, clock = Date.now();
const provider = { keyEpoch: 0, metrics: {}, configured: () => Boolean(ave.getKey()), discover: async () => [] };
const ave = createAveSettings({ directory: temporary, now: () => clock,
  verifyData: async key => {
    if (key !== valid) throw new AveError('AVE_AUTH', 'synthetic rejected key');
    return true;
  },
  onChange: () => { provider.keyEpoch++; scanner?.requestCycle(); },
});
scanner = new Scanner({ provider, state });
const settings = { ...config, port: 0 };
const server = createServer({ state, settings, ave, getAveConnection: () => ave.snapshot() });

function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const base = `http://127.0.0.1:${settings.port}`;
    const req = http.request(`${base}${route}`, { method, headers: { Origin: base, 'Content-Type': 'application/json' } }, response => {
      let output = '';
      response.on('data', chunk => { output += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(output) }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  settings.port = server.address().port;
  await scanner.cycle();
  const before = await request('GET', '/api/status');
  assert.match(before.body.status, /AUTH_REQUIRED$/);
  assert.equal(before.body.aveConnection.configured, false);
  const rejected = await request('POST', '/api/ave-configure', { key: invalid });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, 'AVE_AUTH');
  assert.equal(ave.getKey(), '');
  clock += 3000;
  const accepted = await request('POST', '/api/ave-configure', { key: valid });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.ave.configured, true);
  assert.equal(accepted.body.ave.data.status, 'connected');
  for (let count = 0; count < 40 && state.value.scanCount === 0; count++) await delay(25);
  const after = await request('GET', '/api/status');
  assert.equal(after.body.status, 'RUNNING');
  assert.ok(after.body.scanCount > 0);
  assert.equal(after.body.aveConnection.configured, true);
  assert.equal(JSON.stringify(after.body).includes(valid), false);
  clock += 3000;
  const replaceRejected = await request('POST', '/api/ave-configure', { key: invalid });
  assert.equal(replaceRejected.status, 400);
  assert.equal(replaceRejected.body.error, 'AVE_AUTH');
  assert.equal(ave.getKey(), valid);
  const restored = createAveSettings({ directory: temporary, verifyData: async () => true });
  assert.equal(restored.getKey(), valid, '保存后的配置可以跨重启恢复');
  console.log('首次使用 HTTP 流程通过：无 Key 等待 → 无效 Key 拒绝 → 验证成功保存 → 自动扫描 → 错误换 Key 保留原配置 → 重启可恢复。');
} finally {
  scanner.stop();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
}
