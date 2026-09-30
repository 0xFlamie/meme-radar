import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('AVE production has no retired provider client, key store, worker or external package imports', () => {
  for (const name of ['gmgn.mjs', 'gmgn-connection.mjs', 'gmgn-key-store.mjs', 'gmgn-readonly-worker.mjs']) {
    assert.equal(fs.existsSync(path.join(root, 'src', name)), false, name);
  }
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = fs.readFileSync(file, 'utf8');
    const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)];
    for (const [, specifier] of imports) {
      assert.doesNotMatch(specifier, /gmgn/i, file);
      assert.ok(specifier.startsWith('.') || specifier.startsWith('node:'), `Unexpected runtime dependency: ${specifier}`);
      if (specifier.startsWith('.')) visit(path.resolve(path.dirname(file), specifier));
    }
  }
  visit(path.join(root, 'src/main.mjs'));
  assert.ok(visited.size > 10, 'The whole production import graph must be inspected');
});

test('the AVE-only distribution installs no legacy dependency and exports no legacy credential endpoints', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.deepEqual(manifest.dependencies || {}, {});
  assert.deepEqual(Object.keys(lock.packages), ['']);
  const server = fs.readFileSync(path.join(root, 'src/server.mjs'), 'utf8');
  assert.doesNotMatch(server, /\/api\/gmgn|saveGmgnKey|disconnectGmgnKey|getGmgnOnboarding|getGmgnConnection|gmgnConnection|gmgnUrl/);
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.doesNotMatch(html, /gmgn/i);
});
