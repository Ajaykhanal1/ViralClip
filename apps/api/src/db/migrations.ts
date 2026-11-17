import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Connection, RowDataPacket } from 'mysql2/promise';

const MIGRATION_FILE = /^(\d{3,})_[a-z0-9_]+\.sql$/i;

export interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

interface AppliedMigration extends RowDataPacket {
  name: string;
  checksum: string;
  applied_at: Date;
}

export async function loadMigrations(dir: string): Promise<Migration[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const sqlFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.sql'));

  const invalid = sqlFiles.filter((entry) => !MIGRATION_FILE.test(entry.name));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid migration filenames (expected 001_name.sql): ${invalid.map((f) => f.name).join(', ')}`,
    );
  }

  const seenPrefixes = new Set<string>();
  for (const file of sqlFiles) {
    const prefix = MIGRATION_FILE.exec(file.name)?.[1];
    if (!prefix) continue;
    if (seenPrefixes.has(prefix)) throw new Error(`Duplicate migration prefix: ${prefix}`);
    seenPrefixes.add(prefix);
  }

  const names = sqlFiles.map((entry) => entry.name).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(path.join(dir, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

export async function ensureMigrationsTable(connection: Connection): Promise<void> {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

async function getAppliedMigrations(connection: Connection): Promise<AppliedMigration[]> {
  const [rows] = await connection.query<AppliedMigration[]>(
    'SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name',
  );
  return rows;
}

/**
 * Applies pending SQL migrations in filename order.
 *
 * MySQL DDL is not transactional, so each file is applied then recorded. If a file
 * fails halfway, fix the database by hand before re-running.
 */
export async function migrate(
  connection: Connection,
  dir: string,
  log: (message: string) => void = console.log,
): Promise<{ applied: string[] }> {
  await ensureMigrationsTable(connection);

  const migrations = await loadMigrations(dir);
  const applied = await getAppliedMigrations(connection);
  const appliedByName = new Map(applied.map((row) => [row.name, row]));

  for (const row of applied) {
    const migration = migrations.find((candidate) => candidate.name === row.name);
    if (!migration) throw new Error(`Applied migration is missing from disk: ${row.name}`);
    if (migration.checksum !== row.checksum) {
      throw new Error(`Checksum mismatch for ${row.name}. Applied migrations are immutable.`);
    }
  }

  const pending = migrations.filter((migration) => !appliedByName.has(migration.name));
  for (const migration of pending) {
    log(`Applying ${migration.name}`);
    await connection.query(migration.sql);
    await connection.execute('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [
      migration.name,
      migration.checksum,
    ]);
  }

  if (pending.length === 0) log('No pending migrations.');
  return { applied: pending.map((migration) => migration.name) };
}

export async function migrationStatus(
  connection: Connection,
  dir: string,
): Promise<Array<{ name: string; applied: boolean }>> {
  await ensureMigrationsTable(connection);
  const migrations = await loadMigrations(dir);
  const applied = new Set((await getAppliedMigrations(connection)).map((row) => row.name));
  return migrations.map((migration) => ({
    name: migration.name,
    applied: applied.has(migration.name),
  }));
}
