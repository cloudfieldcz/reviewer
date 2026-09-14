import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '~/lib/auth';

process.env.DATABASE_PATH = ':memory:';
const { db, schema } = await import('~/lib/db');
const { canManageProject, listOwners, managedProjects, projectAccess, requireProjectManager, setOwners } = await import('~/lib/access');

const anna: AuthUser = { id: 1, oid: 'oid-1', email: 'anna@example.com', name: 'Anna', role: 'user' };
const bob: AuthUser = { id: 2, oid: 'oid-2', email: 'bob@example.com', name: 'Bob', role: 'user' };
const root: AuthUser = { id: 3, oid: 'oid-3', email: 'root@example.com', name: 'Root', role: 'admin' };

beforeEach(() => {
  db.delete(schema.projectOwners).run();
  db.delete(schema.projects).run();
  db.delete(schema.users).run();
  for (const u of [anna, bob, root]) db.insert(schema.users).values({ id: u.id, oid: u.oid, email: u.email, name: u.name, role: u.role }).run();
  db.insert(schema.projects).values({ id: 1, name: 'one', baseUrl: 'https://one.example.com', createdBy: root.id }).run();
  db.insert(schema.projects).values({ id: 2, name: 'two', baseUrl: 'https://two.example.com', createdBy: root.id }).run();
});

describe('projectAccess', () => {
  it('is admin for a global admin with no membership row', () => {
    expect(projectAccess(1, root)).toBe('admin');
    expect(canManageProject(1, root)).toBe(true);
  });

  it('is owner only on the projects the user owns, reviewer elsewhere', () => {
    setOwners(1, [anna.id], root);
    expect(projectAccess(1, anna)).toBe('owner');
    expect(projectAccess(2, anna)).toBe('reviewer');
    expect(projectAccess(1, bob)).toBe('reviewer');
  });

  it('ignores the cached users.role – only the request role counts', () => {
    db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, bob.id)).run();
    expect(projectAccess(1, bob)).toBe('reviewer');
  });

  it('requireProjectManager throws 403 for a reviewer and passes for owner and admin', () => {
    setOwners(1, [anna.id], root);
    expect(() => requireProjectManager(1, bob)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => requireProjectManager(2, anna)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => requireProjectManager(1, anna)).not.toThrow();
    expect(() => requireProjectManager(2, root)).not.toThrow();
  });
});

describe('managedProjects', () => {
  it("returns 'all' for an admin and an explicit Set otherwise – an empty Set for a plain reviewer", () => {
    setOwners(1, [anna.id], root);
    expect(managedProjects(root)).toBe('all');
    expect(managedProjects(anna)).toEqual(new Set([1]));
    expect(managedProjects(bob)).toEqual(new Set());
  });
});

describe('setOwners', () => {
  it('replaces the set and is idempotent', () => {
    expect(setOwners(1, [anna.id, bob.id], root).map((o) => o.id).sort()).toEqual([1, 2]);
    expect(setOwners(1, [bob.id], root).map((o) => o.id)).toEqual([2]);
    expect(setOwners(1, [bob.id], root).map((o) => o.id)).toEqual([2]);
    expect(setOwners(1, [], root)).toEqual([]);
  });

  it('preserves added_at for unchanged rows', () => {
    setOwners(1, [anna.id], root);
    db.update(schema.projectOwners).set({ addedAt: '2020-01-01 00:00:00' }).where(eq(schema.projectOwners.userId, anna.id)).run();
    const after = setOwners(1, [anna.id, bob.id], root);
    expect(after.find((o) => o.id === anna.id)?.addedAt).toBe('2020-01-01 00:00:00');
  });

  it('rejects an unknown id with 400 and leaves the set intact', () => {
    setOwners(1, [anna.id], root);
    expect(() => setOwners(1, [anna.id, 999], root)).toThrow(expect.objectContaining({ status: 400 }));
    expect(listOwners(1).map((o) => o.id)).toEqual([anna.id]);
  });

  it('rejects malformed input with 400', () => {
    for (const bad of ['1', [1.5], ['1'], [-1], [0], null, { userIds: [1] }]) {
      expect(() => setOwners(1, bad, root)).toThrow(expect.objectContaining({ status: 400 }));
    }
  });

  it('dedupes ids', () => {
    expect(setOwners(1, [anna.id, anna.id], root)).toHaveLength(1);
  });

  it('refuses a non-admin caller even though routes also guard it', () => {
    expect(() => setOwners(1, [bob.id], anna)).toThrow(expect.objectContaining({ status: 403 }));
    expect(listOwners(1)).toEqual([]);
  });

  it('records who granted the ownership', () => {
    setOwners(1, [anna.id], root);
    expect(db.select().from(schema.projectOwners).get()?.addedBy).toBe(root.id);
  });
});

describe('cascades', () => {
  it('deleting a project removes its owner rows', () => {
    setOwners(1, [anna.id], root);
    db.delete(schema.projects).where(eq(schema.projects.id, 1)).run();
    expect(db.select().from(schema.projectOwners).all()).toEqual([]);
  });

  it('deleting a user removes their ownerships', () => {
    setOwners(1, [anna.id, bob.id], root);
    db.delete(schema.users).where(eq(schema.users.id, anna.id)).run();
    expect(listOwners(1).map((o) => o.id)).toEqual([bob.id]);
  });
});
