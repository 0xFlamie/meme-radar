import { projectRoot } from './setup.mjs';
import { openRadarBrowser, waitForRadar } from './launcher-health.mjs';

const port = Number(process.env.RADAR_PORT || 3791);
const url = `http://127.0.0.1:${port}/`;

try {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('RADAR_PORT 必须为 1024 到 65535 的整数。');
  await waitForRadar({ root: projectRoot, port });
  await openRadarBrowser(url);
} catch (error) {
  console.error(`打开页面未完成：${error.message}\n确认本机服务就绪后可手动访问 ${url}`);
  process.exitCode = 1;
}
