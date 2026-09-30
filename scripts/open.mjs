import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensureDependencies, projectRoot, withLocalLock } from './setup.mjs';
import { openRadarBrowser, probeRadar, waitForRadar } from './launcher-health.mjs';

const port = Number(process.env.RADAR_PORT || 3791);
const url = `http://127.0.0.1:${port}/`;

try {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('RADAR_PORT 必须为 1024 到 65535 的整数。');
  await ensureDependencies();
  await withLocalLock('open', async () => {
    const health = await probeRadar({ root: projectRoot, port });
    if (health.status === 'ready') return;
    // A connected but interrupted service may already be starting. Do not
    // create a second supervisor until an absent listener is confirmed.
    if (health.status === 'starting') {
      await waitForRadar({ root: projectRoot, port });
      return;
    }
    const logs = path.join(projectRoot, 'logs');
    fs.mkdirSync(logs, { recursive: true, mode: 0o700 });
    const fd = fs.openSync(path.join(logs, 'radar-launch.log'), 'a', 0o600);
    let child, spawnFailed = false;
    try {
      child = spawn(process.execPath, ['--use-env-proxy', path.join(projectRoot, 'scripts/supervise.mjs')], {
        cwd: projectRoot, env: { ...process.env, RADAR_PORT: String(port) },
        detached: true, windowsHide: true, stdio: ['ignore', fd, fd]
      });
      child.once('error', () => { spawnFailed = true; });
      child.unref();
    } finally { fs.closeSync(fd); }
    console.log('正在等待本机服务就绪（最多 90 秒）……');
    await waitForRadar({ root: projectRoot, port,
      stopped: () => spawnFailed || child.exitCode !== null || Boolean(child.signalCode) });
  });
  console.log(`雷达已打开：${url}\n首次使用：展开“AVE API”，填写自己的行情 Key 并保存测试。`);
  if (!process.argv.includes('--no-open')) await openRadarBrowser(url);
} catch (error) { console.error(`启动未完成：${error.message}\n可手动访问 ${url}`); process.exitCode = 1; }
