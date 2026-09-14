import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AuthUser } from './auth';
import { db, schema } from './db';
import { HttpError } from './http';

/**
 * Project access level: the global role first, then one indexed membership lookup in
 * `project_owners`. Never reads `users.role` – the role on `viewer` comes from the oauth2-proxy
 * headers on this very request.
 *
 * This module deliberately does not import `./projects`: `projects.ts` imports it (for `canManage`
 * on the tiles) and `comments.ts` imports `projects.ts`, so the reverse edge would be a cycle.
 * `requireProjectManager` therefore works off a raw id and never 404s – routes call `getProject()`
 * for that.
 */
export type ProjectAccess = 'admin' | 'owner' | 'reviewer';

export interface OwnerDto {
  id: number;
  name: string | null;
  email: string;
  addedAt: string;
}

const MAX_OWNERS = 100;

export function projectAccess(projectId: number, viewer: AuthUser): ProjectAccess {
  if (viewer.role === 'admin') return 'admin';
  const row = db
    .select({ userId: schema.projectOwners.userId })
    .from(schema.projectOwners)
    .where(and(eq(schema.projectOwners.projectId, projectId), eq(schema.projectOwners.userId, viewer.id)))
    .get();
  return row ? 'owner' : 'reviewer';
}

/** True for admins and this project's owners. */
export function canManageProject(projectId: number, viewer: AuthUser): boolean {
  return projectAccess(projectId, viewer) !== 'reviewer';
}

/** Throws 403 unless admin or owner of this project. */
export function requireProjectManager(projectId: number, viewer: AuthUser): void {
  if (!canManageProject(projectId, viewer)) throw new HttpError(403, 'Only a project manager can do this');
}

/**
 * Which projects the viewer may manage: `'all'` for admins, an explicit Set otherwise – never an
 * empty Set meaning "everything", which would fail open in any `size === 0 ? all : filter` caller.
 */
export function managedProjects(viewer: AuthUser): 'all' | Set<number> {
  if (viewer.role === 'admin') return 'all';
  const rows = db
    .select({ projectId: schema.projectOwners.projectId })
    .from(schema.projectOwners)
    .where(eq(schema.projectOwners.userId, viewer.id))
    .all();
  return new Set(rows.map((r) => r.projectId));
}

export function listOwners(projectId: number): OwnerDto[] {
  return db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, addedAt: schema.projectOwners.addedAt })
    .from(schema.projectOwners)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectOwners.userId))
    .where(eq(schema.projectOwners.projectId, projectId))
    .orderBy(asc(schema.users.name), asc(schema.users.email))
    .all();
}

/**
 * Replaces the whole owner set. Asserts the admin role itself – this is the one function that hands
 * out rights, so it does not delegate its guard to callers. Validates before writing (unknown ids
 * are a 400, not a foreign-key 500), diffs instead of re-inserting so `added_at` stays meaningful,
 * and runs in one transaction so a failure never leaves the project with no owners at all.
 */
export function setOwners(projectId: number, userIds: unknown, addedBy: AuthUser): OwnerDto[] {
  if (addedBy.role !== 'admin') throw new HttpError(403, 'Only an admin can change project owners');
  if (!Array.isArray(userIds)) throw new HttpError(400, 'userIds must be an array');
  const wanted = new Set<number>();
  for (const v of userIds) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) throw new HttpError(400, 'userIds must be positive integers');
    wanted.add(v);
  }
  if (wanted.size > MAX_OWNERS) throw new HttpError(400, `At most ${MAX_OWNERS} owners per project`);
  if (wanted.size > 0) {
    const known = db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.id, [...wanted])).all();
    if (known.length !== wanted.size) throw new HttpError(400, 'Unknown user id – only people who have signed in can be owners');
  }
  db.transaction((tx) => {
    const current = new Set(
      tx.select({ userId: schema.projectOwners.userId }).from(schema.projectOwners).where(eq(schema.projectOwners.projectId, projectId)).all().map((r) => r.userId),
    );
    const remove = [...current].filter((id) => !wanted.has(id));
    const add = [...wanted].filter((id) => !current.has(id));
    if (remove.length) {
      tx.delete(schema.projectOwners).where(and(eq(schema.projectOwners.projectId, projectId), inArray(schema.projectOwners.userId, remove))).run();
    }
    if (add.length) {
      tx.insert(schema.projectOwners).values(add.map((userId) => ({ projectId, userId, addedBy: addedBy.id }))).run();
    }
  });
  return listOwners(projectId);
}
