import path from "node:path";
import { mkdirSync } from "node:fs";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import * as schema from "@/server/db/schema";

export type DB = PgliteDatabase<typeof schema>;

type Holder = { db?: DB; ready?: Promise<DB> };
// Survive Next.js dev hot reloads: one database handle per process.
const holder = ((globalThis as unknown as { __growthosDb?: Holder }).__growthosDb ??= {});

const MIGRATIONS = path.join(process.cwd(), "drizzle");

async function open(): Promise<DB> {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
    try {
      const db = drizzlePg(pool, { schema });
      await migratePg(db, { migrationsFolder: MIGRATIONS });
      // Both drivers expose the same query-builder surface; the cast keeps one type across the app.
      return db as unknown as DB;
    } catch (error) {
      await pool.end();
      throw error;
    }
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR || path.join(process.cwd(), ".data", "pglite");
  if (dir !== "memory://") mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return db;
}

/** Lazily opens and migrates the database once per process. */
export function getDb(): Promise<DB> {
  if (holder.db) return Promise.resolve(holder.db);
  holder.ready ??= open()
    .then((db) => (holder.db = db))
    .catch((error) => {
      holder.ready = undefined;
      throw error;
    });
  return holder.ready;
}

export { schema };
