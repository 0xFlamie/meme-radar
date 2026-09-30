import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const main = fs.readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const start = main.indexOf('// Windows portable supervisor bridge:');
const end = main.indexOf('// Browsers use the Windows system proxy', start);
const bridge = main.slice(start, end);

async function run(overrides = {}, failure = false) {
  let calls = 0, exitCode = null;
  const messages = [];
  const process = { platform: 'win32', execPath: 'C:\\MemeRadar\\runtime\\node.exe', argv: ['node', 'src/main.mjs'], env: {},
    ...overrides, exit(code) { exitCode = code; } };
  // Evaluate only the bridge with a stub import. Never initialize the actual
  // app, touch credentials/state, spawn a child or probe a local port.
  const code = bridge.replace("await import('../scripts/supervise.mjs')", '({ superviseRadar: runSupervisor })');
  await vm.runInNewContext('(async () => {' + code + '})()', {
    process, ROOT: 'C:\\MemeRadar', resolve: path.win32.resolve,
    console: { error(message) { messages.push(message); } },
    async runSupervisor() { calls++; if (failure) throw new Error('fixture failure'); }
  });
  return { calls, exitCode, messages };
}

test('Windows portable bridge runs before state setup and uses the existing side-effect-free supervisor', async () => {
  assert.ok(start > 0 && end > start);
  assert.ok(end < main.indexOf('new RadarState('));
  assert.match(bridge, /await import\('\.\.\/scripts\/supervise\.mjs'\)/);
  assert.deepEqual(await run(), { calls: 1, exitCode: 0, messages: [] });
  assert.equal((await run({ execPath: 'c:\\memeradar\\RUNTIME\\NODE.EXE' })).calls, 1);
});

test('non-Windows, non-bundled, one-shot and supervised child execution retain their original app path', async () => {
  for (const overrides of [
    { platform: 'darwin' }, { platform: 'linux' }, { execPath: 'C:\\Program Files\\nodejs\\node.exe' },
    { execPath: 'C:\\OtherRadar\\runtime\\node.exe' }, { argv: ['node', 'src/main.mjs', '--once'] },
    { env: { RADAR_SUPERVISED: '1' } }
  ]) assert.deepEqual(await run(overrides), { calls: 0, exitCode: null, messages: [] });
});

test('a failed portable supervisor exits nonzero without falling through into a second application', async () => {
  const result = await run({}, true);
  assert.equal(result.calls, 1); assert.equal(result.exitCode, 1);
  assert.match(result.messages[0], /守护启动未完成/);
});
