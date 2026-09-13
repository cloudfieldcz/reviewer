import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

const DATABASE_PATH = process.env.DATABASE_PATH ?? './data/reviewer.db';

function migrationsFolder(): string {
  // Repo: <root>/drizzle. Docker image: /app/drizzle (dist/server/... → ../../drizzle).
  const candidates = [
    process.env.MIGRATIONS_PATH,
    resolve(process.cwd(), 'drizzle'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../drizzle'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../../drizzle'),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

function openDb() {
  mkdirSync(dirname(resolve(DATABASE_PATH)), { recursive: true });
  const sqlite = new Database(DATABASE_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsFolder() });
  return db;
}

// Single connection per process (SSR server is long-running); guarded against HMR re-evaluation in dev.
const g = globalThis as unknown as { __reviewerDb?: ReturnType<typeof openDb> };
export const db = g.__reviewerDb ?? (g.__reviewerDb = openDb());

export { schema };
export type Db = typeof db;
