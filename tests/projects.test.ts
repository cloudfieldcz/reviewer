import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '~/lib/auth';

// The project tiles once miscounted comments because a correlated subquery interpolated
// `projects.id`, which drizzle renders as a bare `"id"` – SQLite then bound it to `comments`.
// Type checking cannot see that, so this has to run against a real database.
process.env.DATABASE_PATH = ':memory:';
const { db, schema } = await import('~/lib/db');
const { getProject, listProjects, updateProject } = await import('~/lib/projects');
const { setOwners } = await import('~/lib/access');
const { PATCH } = await import('~/pages/api/projects/[id]/index');

const admin: AuthUser = { id: 1, oid: 'oid-1', email: 'a@b.cz', name: 'A', role: 'admin' };
const owner: AuthUser = { id: 2, oid: 'oid-2', email: 'o@b.cz', name: 'O', role: 'user' };
const stranger: AuthUser = { id: 3, oid: 'oid-3', email: 's@b.cz', name: 'S', role: 'user' };

beforeEach(() => {
  db.delete(schema.projectOwners).run();
  db.delete(schema.comments).run();
  db.delete(schema.projects).run();
  db.delete(schema.users).run();
  for (const u of [admin, owner, stranger]) db.insert(schema.users).values({ id: u.id, oid: u.oid, email: u.email, name: u.name, role: u.role }).run();
});

const project = (id: number, name: string, createdAt: string) =>
  db.insert(schema.projects).values({ id, name, baseUrl: `https://${name}.example.com`, createdBy: 1, createdAt }).run();

const comment = (id: number, projectId: number, createdAt: string) =>
  db.insert(schema.comments).values({ id, projectId, userId: 1, pagePath: '/', body: 'x', createdAt }).run();

describe('listProjects', () => {
  it('counts the comments of each project, not comments whose id equals their project id', () => {
    project(1, 'three', '2026-01-01 00:00:00');
    project(2, 'none', '2026-01-02 00:00:00');
    // Comment id 1 sits in project 1, so the old bug reported 1 for *every* project.
    comment(1, 1, '2026-02-01 00:00:00');
    comment(2, 1, '2026-02-02 00:00:00');
    comment(3, 1, '2026-02-03 00:00:00');

    const byName = Object.fromEntries(listProjects(admin).map((p) => [p.name, p]));
    expect(byName.three!.commentCount).toBe(3);
    expect(byName.none!.commentCount).toBe(0);
    expect(byName.three!.lastCommentAt).toBe('2026-02-03 00:00:00');
    expect(byName.none!.lastCommentAt).toBeNull();
  });

  it('orders by last comment, falling back to the creation date for projects without comments', () => {
    project(1, 'old-but-active', '2020-01-01 00:00:00');
    project(2, 'fresh-but-silent', '2026-06-01 00:00:00');
    project(3, 'stale', '2019-01-01 00:00:00');
    comment(10, 1, '2026-09-01 00:00:00');

    expect(listProjects(admin).map((p) => p.name)).toEqual(['old-but-active', 'fresh-but-silent', 'stale']);
  });

  it('keeps commentCount right for a project that has both comments and owners, and sets canManage per viewer', () => {
    project(1, 'owned', '2026-01-01 00:00:00');
    project(2, 'other', '2026-01-02 00:00:00');
    comment(1, 1, '2026-02-01 00:00:00');
    comment(2, 1, '2026-02-02 00:00:00');
    comment(3, 1, '2026-02-03 00:00:00');
    // Two owners: a join would report 6 comments instead of 3.
    setOwners(1, [owner.id, stranger.id], admin);
    setOwners(1, [owner.id], admin);
    setOwners(1, [owner.id, admin.id], admin);

    const asOwner = Object.fromEntries(listProjects(owner).map((p) => [p.name, p]));
    expect(asOwner.owned!.commentCount).toBe(3);
    expect(asOwner.owned!.canManage).toBe(true);
    expect(asOwner.other!.canManage).toBe(false);

    const asStranger = listProjects(stranger);
    expect(asStranger.every((p) => !p.canManage)).toBe(true);
    expect(asStranger.find((p) => p.name === 'owned')!.commentCount).toBe(3);

    expect(listProjects(admin).every((p) => p.canManage)).toBe(true);
  });
});

describe('phone view flag', () => {
  function patch(id: number, body: unknown, user: AuthUser) {
    const request = new Request(`http://reviewer.test/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const ctx = { request, params: { id: String(id) }, locals: { user }, url: new URL(request.url) } as unknown as APIContext;
    return PATCH(ctx);
  }

  it('is on for a new project and for every project that existed before the column', () => {
    project(1, 'site', '2026-01-01 00:00:00');
    expect(getProject(1).phoneView).toBe(true);
  });

  it('is switched off and on again through updateProject, without touching the rest', async () => {
    project(1, 'site', '2026-01-01 00:00:00');
    expect((await updateProject(1, { phoneView: false })).phoneView).toBe(false);
    expect(getProject(1)).toMatchObject({ name: 'site', baseUrl: 'https://site.example.com', phoneView: false });
    // Renaming alone leaves the flag as it is.
    await updateProject(1, { name: 'renamed' });
    expect(getProject(1)).toMatchObject({ name: 'renamed', phoneView: false });
    expect((await updateProject(1, { phoneView: true })).phoneView).toBe(true);
  });

  it('can be switched off on an uploaded-site project, whose base URL stays empty', async () => {
    db.insert(schema.projects).values({ id: 2, name: 'proto', baseUrl: '', kind: 'static', createdBy: 1 }).run();
    await updateProject(2, { name: 'proto', phoneView: false });
    expect(getProject(2)).toMatchObject({ name: 'proto', baseUrl: '', kind: 'static', phoneView: false });
  });

  it('PATCH takes a boolean and refuses anything else', async () => {
    project(1, 'site', '2026-01-01 00:00:00');
    let res = await patch(1, { phoneView: false }, admin);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { phoneView: boolean }).phoneView).toBe(false);
    expect(getProject(1).phoneView).toBe(false);

    for (const bad of ['true', 'false', 0, 1, null]) {
      res = await patch(1, { phoneView: bad }, admin);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(getProject(1).phoneView).toBe(false);

    res = await patch(1, { phone_view: true }, admin);
    expect(res.status).toBe(200);
    expect(getProject(1).phoneView).toBe(true);
  });

  it('PATCH stays admin-only: an owner cannot change it', async () => {
    project(1, 'site', '2026-01-01 00:00:00');
    setOwners(1, [owner.id], admin);
    const res = await patch(1, { phoneView: false }, owner);
    expect(res.status).toBe(403);
    expect(getProject(1).phoneView).toBe(true);
  });
});
