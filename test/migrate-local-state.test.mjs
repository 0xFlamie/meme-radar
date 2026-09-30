import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MIGRATION_FILES, migrateLocalState, parseMigrationArgs } from '../scripts/migrate-local-state.mjs';

const script = fileURLToPath(new URL('../scripts/migrate-local-state.mjs', import.meta.url));
function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-state-migration-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const from = path.join(temporary, 'old'), to = path.join(temporary, 'new');
  for (const root of [from, to]) {
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'meme-radar-open-source', version: '0.1.10' }));
  }
  fs.mkdirSync(path.join(from, 'state'));
  const values = {
    'ave-credentials.json': JSON.stringify({ schema: 2, key: 'SYNTHETIC_PRIVATE_ONLY_FOR_TEST' }),
    'ave-read-budget.json': JSON.stringify({ schema: 2, totalUsed: 123456, used: 456, hourUsed: 12, strikes: 2 }),
    'preferences.json': JSON.stringify({ enabledChains: ['bsc'], annotations: { saved: { note: 'synthetic private note' } } }),
    'radar.json': JSON.stringify({ outcomes: [{ id: 'history' }], riskExclusions: { saved: true } }),
    'radar.json.bak': JSON.stringify({ outcomes: [{ id: 'backup' }] }),
  };
  for (const [name, text] of Object.entries(values)) fs.writeFileSync(path.join(from, 'state', name), text);
  return { temporary, from, to, values, confirmedStopped: true };
}

test('explicit local migration preserves exact key, cumulative budget, settings, exclusions and history without scanning other files', t => {
  const value = fixture(t);
  fs.writeFileSync(path.join(value.from, '.env.production'), 'PRIVATE=must-not-import');
  fs.writeFileSync(path.join(value.from, 'state', 'unrelated-private.json'), '{"not":"requested"}');
  const result = migrateLocalState(value);
  assert.equal(result.originalPreserved, true);
  assert.equal(result.copied.at(-1), 'ave-credentials.json', 'credential is committed only after the budget');
  assert.deepEqual(result.copied, MIGRATION_FILES.filter(name => Object.hasOwn(value.values, name)));
  for (const [name, text] of Object.entries(value.values)) {
    assert.equal(fs.readFileSync(path.join(value.from, 'state', name), 'utf8'), text);
    assert.equal(fs.readFileSync(path.join(value.to, 'state', name), 'utf8'), text);
    assert.equal(fs.statSync(path.join(value.to, 'state', name)).mode & 0o777, 0o600);
  }
  assert.equal(fs.existsSync(path.join(value.to, '.env.production')), false);
  assert.equal(fs.existsSync(path.join(value.to, 'state', 'unrelated-private.json')), false);
  assert.equal(fs.existsSync(path.join(value.to, 'logs')), false);
  assert.equal(fs.existsSync(path.join(value.to, '.runtime')), false);
});

test('migration refuses overwrite, partial key-only migration, invalid JSON, active supervisors and linked source data', t => {
  for (const mode of ['existing', 'budget', 'corrupt', 'active', 'link', 'hardlink', 'unconfirmed']) {
    const value = fixture(t);
    if (mode === 'existing') fs.mkdirSync(path.join(value.to, 'state'));
    if (mode === 'budget') fs.unlinkSync(path.join(value.from, 'state/ave-read-budget.json'));
    if (mode === 'corrupt') fs.writeFileSync(path.join(value.from, 'state/radar.json'), 'broken');
    if (mode === 'active') {
      fs.mkdirSync(path.join(value.from, '.runtime/supervisor-3791.lock'), { recursive: true });
      fs.writeFileSync(path.join(value.from, '.runtime/supervisor-3791.lock/pid'), String(process.pid));
    }
    if (mode === 'link' || mode === 'hardlink') {
      const file = path.join(value.from, 'state/radar.json'); fs.unlinkSync(file);
      fs[mode === 'link' ? 'symlinkSync' : 'linkSync'](path.join(value.from, 'state/radar.json.bak'), file);
    }
    assert.throws(() => migrateLocalState({ ...value, confirmedStopped: mode !== 'unconfirmed' }),
      { code: { existing: 'MIGRATION_EXISTS', budget: 'MIGRATION_BUDGET', corrupt: 'MIGRATION_JSON', active: 'MIGRATION_BUSY',
        link: 'MIGRATION_FILE', hardlink: 'MIGRATION_FILE', unconfirmed: 'MIGRATION_CONFIRM' }[mode] });
    if (mode === 'existing') assert.deepEqual(fs.readdirSync(path.join(value.to, 'state')), []);
    else assert.equal(fs.existsSync(path.join(value.to, 'state')), false);
  }
});

test('migration requires independent verified application directories and an explicit source', t => {
  const value = fixture(t);
  assert.throws(() => migrateLocalState({ ...value, from: value.to }), { code: 'MIGRATION_PATH' });
  fs.writeFileSync(path.join(value.from, 'package.json'), '{"name":"some-other-application"}');
  assert.throws(() => migrateLocalState(value), { code: 'MIGRATION_APP' });
  assert.throws(() => parseMigrationArgs([]), { code: 'MIGRATION_INPUT' });
  assert.throws(() => parseMigrationArgs(['--from', '--confirm-stopped']), { code: 'MIGRATION_INPUT' });
  assert.deepEqual(parseMigrationArgs(['--from', '/explicit/old', '--to', '/explicit/new', '--confirm-stopped']),
    { from: '/explicit/old', to: '/explicit/new', confirmedStopped: true });
});

test('migration recognizes atomic PID-file locks and rejects active, malformed or still-linked owners', t => {
  for (const mode of ['active', 'empty', 'hardlink', 'symlink', 'stopped']) {
    const value = fixture(t), runtime = path.join(value.from, '.runtime');
    fs.mkdirSync(runtime);
    const file = path.join(runtime, 'supervisor-3791.lock');
    // A completed synthetic child supplies a real exited PID without touching
    // any running service or inferring ownership from an arbitrary PID.
    const child = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
    assert.equal(child.status, 0);
    fs.writeFileSync(file, mode === 'empty' ? '' : String(mode === 'active' ? process.pid : child.pid));
    if (mode === 'hardlink') fs.linkSync(file, path.join(runtime, 'publish.tmp'));
    if (mode === 'symlink') {
      fs.renameSync(file, path.join(runtime, 'owner'));
      fs.symlinkSync(path.join(runtime, 'owner'), file);
    }
    if (mode === 'stopped') assert.equal(migrateLocalState(value).originalPreserved, true);
    else {
      assert.throws(() => migrateLocalState(value), { code: ['hardlink', 'symlink'].includes(mode) ? 'MIGRATION_FILE' : 'MIGRATION_BUSY' });
      assert.equal(fs.existsSync(path.join(value.to, 'state')), false);
    }
  }
});

test('migration CLI never prints credentials or malformed JSON in success or error output', t => {
  for (const corrupt of [false, true]) {
    const value = fixture(t), secret = 'SYNTHETIC_PRIVATE_ONLY_FOR_TEST';
    if (corrupt) fs.writeFileSync(path.join(value.from, 'state/ave-credentials.json'), secret);
    const child = spawnSync(process.execPath, [script, '--from', value.from, '--to', value.to, '--confirm-stopped'], { encoding: 'utf8' });
    assert.equal(child.status, corrupt ? 1 : 0);
    assert.equal((child.stdout + child.stderr).includes(secret), false);
    assert.equal((child.stdout + child.stderr).includes(value.from), false);
    assert.equal((child.stdout + child.stderr).includes(value.to), false);
  }
});
