import { beforeEach, describe, expect, it } from 'vitest';

// The project tiles once miscounted comments because a correlated subquery interpolated
// `projects.id`, which drizzle renders as a bare `"id"` – SQLite then bound it to `comments`.
// Type checking cannot see that, so this has to run against a real database.
process.env.DATABASE_PATH = ':memory:';
const { db, schema } = await import('~/lib/db');
const { listProjects } = await import('~/lib/projects');

beforeEach(() => {
  db.delete(schema.comments).run();
  db.delete(schema.projects).run();
  db.delete(schema.users).run();
  db.insert(schema.users).values({ id: 1, oid: 'oid-1', email: 'a@b.cz' }).run();
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

    const byName = Object.fromEntries(listProjects().map((p) => [p.name, p]));
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

    expect(listProjects().map((p) => p.name)).toEqual(['old-but-active', 'fresh-but-silent', 'stale']);
  });
});
