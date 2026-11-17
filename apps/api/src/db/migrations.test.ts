import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadMigrations } from './migrations.js';

async function fixture(t: test.TestContext, files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viralclip-migrations-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(dir, name), contents);
  }
  return dir;
}

test('loadMigrations orders by filename and hashes contents', async (t) => {
  const dir = await fixture(t, {
    '010_second.sql': 'SELECT 2;',
    '002_first.sql': 'SELECT 1;',
  });

  const migrations = await loadMigrations(dir);

  assert.deepEqual(
    migrations.map((m) => m.name),
    ['002_first.sql', '010_second.sql'],
  );
  assert.match(migrations[0]?.checksum ?? '', /^[a-f0-9]{64}$/);
  assert.notEqual(migrations[0]?.checksum, migrations[1]?.checksum);
});

test('loadMigrations rejects files without a numeric prefix', async (t) => {
  const dir = await fixture(t, { 'init.sql': 'SELECT 1;' });
  await assert.rejects(() => loadMigrations(dir), /Invalid migration filenames/);
});

test('loadMigrations rejects duplicate prefixes', async (t) => {
  const dir = await fixture(t, {
    '001_one.sql': 'SELECT 1;',
    '001_two.sql': 'SELECT 2;',
  });
  await assert.rejects(() => loadMigrations(dir), /Duplicate migration prefix/);
});
