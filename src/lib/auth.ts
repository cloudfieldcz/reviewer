import { eq } from 'drizzle-orm';
import { db, schema } from './db';
import type { User } from './db/schema';
import { env } from './env';

export type Role = 'admin' | 'user';

export interface AuthUser {
  id: number;
  oid: string;
  email: string;
  name: string;
  role: Role;
}

const list = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Resolves the role from the oauth2-proxy headers.
 *  - X-Forwarded-Groups carries the Entra `roles[]` claim (oidc_groups_claim = "roles").
 *  - ADMIN_EMAILS: bootstrap admins (comma separated), meant to be empty in production.
 *  - DEFAULT_ROLE: role for authenticated users without any Reviewer role ('user' | '' → 403).
 */
export function resolveRole(groupsHeader: string | null, email: string): Role | null {
  const roles = list(groupsHeader ?? '').map((r) => r.toUpperCase());
  const admins = list(env('ADMIN_EMAILS')).map((e) => e.toLowerCase());
  if (roles.includes('ADMIN') || admins.includes(email.toLowerCase())) return 'admin';
  if (roles.includes('USER')) return 'user';
  const fallback = env('DEFAULT_ROLE').trim().toLowerCase();
  if (fallback === 'user') return 'user';
  if (fallback === 'admin') return 'admin'; // only for local dev
  return null;
}

export function upsertUser(input: { oid: string; email: string; name: string; role: Role }): User {
  const existing = db.select().from(schema.users).where(eq(schema.users.oid, input.oid)).get();
  if (existing) {
    const changed = existing.email !== input.email || existing.name !== input.name || existing.role !== input.role;
    // Update at most once per minute per user to keep writes off the hot path.
    const stale = Date.now() - Date.parse(existing.lastSeenAt + 'Z') > 60_000;
    if (changed || stale) {
      return db
        .update(schema.users)
        .set({ email: input.email, name: input.name, role: input.role, lastSeenAt: new Date().toISOString().replace('T', ' ').slice(0, 19) })
        .where(eq(schema.users.id, existing.id))
        .returning()
        .get()!;
    }
    return existing;
  }
  return db.insert(schema.users).values(input).returning().get();
}

/**
 * Local development without oauth2-proxy: DEV_USER="email[:role]" fakes the identity headers.
 * Ignored when NODE_ENV=production (the Docker image) so it can never leak into a deployment.
 */
function devIdentity(): { oid: string; email: string; groups: string } | null {
  const raw = env('DEV_USER').trim();
  if (!raw || process.env.NODE_ENV === 'production') return null;
  const [email, role = 'admin'] = raw.split(':');
  return { oid: `dev-${email}`, email: email!, groups: role.toUpperCase() };
}

/** Pulls the identity from the request headers set by oauth2-proxy; null when missing. */
export function authenticate(headers: Headers): { user: AuthUser } | { error: 'unauthorized' | 'forbidden' } {
  const dev = devIdentity();
  const oid = dev?.oid ?? headers.get('x-forwarded-user')?.trim();
  const email = dev?.email ?? headers.get('x-forwarded-email')?.trim();
  if (!oid || !email) return { error: 'unauthorized' };

  const role = resolveRole(dev?.groups ?? headers.get('x-forwarded-groups'), email);
  if (!role) return { error: 'forbidden' };

  // oauth2-proxy has no "name" header out of the box; X-Forwarded-Name can be added via alpha config.
  const name =
    headers.get('x-forwarded-name')?.trim() || headers.get('x-forwarded-preferred-username')?.trim() || email;
  const row = upsertUser({ oid, email, name, role });
  return { user: { id: row.id, oid, email, name, role } };
}
