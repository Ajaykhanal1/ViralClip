import path from 'node:path';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { migrationStatus, migrate } from './migrations.js';

const migrationsDir = path.resolve(import.meta.dirname, '../../migrations');

const connection = await mysql.createConnection({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  multipleStatements: true,
  timezone: 'Z',
});

try {
  if (process.argv.includes('--status')) {
    const status = await migrationStatus(connection, migrationsDir);
    console.table(status);
  } else {
    const { applied } = await migrate(connection, migrationsDir);
    console.log(
      applied.length > 0 ? `Applied ${applied.length} migration(s).` : 'Database is up to date.',
    );
  }
} finally {
  await connection.end();
}
