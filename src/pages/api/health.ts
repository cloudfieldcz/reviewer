import type { APIRoute } from 'astro';
import { sql } from 'drizzle-orm';
import { db } from '~/lib/db';
import { json } from '~/lib/http';

export const GET: APIRoute = () => {
  db.run(sql`select 1`);
  return json({ ok: true });
};
