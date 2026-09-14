import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '~/lib/auth';

// The PATCH route must pick its permission by the PRESENCE of `status`, never by whether its value
// validates – otherwise `{status: "aproved", body: "x"}` falls through to the weaker body branch.
process.env.DATABASE_PATH = ':memory:';
const { db, schema } = await import('~/lib/db');
const { createComment, getComment } = await import('~/lib/comments');
const { PATCH } = await import('~/pages/api/comments/[id]');

const anna: AuthUser = { id: 1, oid: 'oid-1', email: 'anna@example.com', name: 'Anna', role: 'user' };
const root: AuthUser = { id: 3, oid: 'oid-3', email: 'root@example.com', name: 'Root', role: 'admin' };

beforeEach(() => {
  db.delete(schema.comments).run();
  db.delete(schema.projects).run();
  db.delete(schema.users).run();
  for (const u of [anna, root]) db.insert(schema.users).values({ id: u.id, oid: u.oid, email: u.email, name: u.name, role: u.role }).run();
  db.insert(schema.projects).values({ id: 1, name: 'site', baseUrl: 'https://site.example.com', createdBy: anna.id }).run();
});

function patch(id: number, body: unknown, user: AuthUser) {
  const request = new Request(`http://reviewer.test/api/comments/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ctx = { request, params: { id: String(id) }, locals: { user }, url: new URL(request.url) } as unknown as APIContext;
  return PATCH(ctx);
}

const comment = () => createComment({ projectId: 1, pagePath: '/', viewport: 'desktop', body: 'fix this' }, anna);

describe('PATCH /api/comments/:id', () => {
  it('{body}: the author edits their own open comment', async () => {
    const c = comment();
    const res = await patch(c.id, { body: 'edited' }, anna);
    expect(res.status).toBe(200);
    expect(getComment(c.id, anna).body).toBe('edited');
  });

  it('{status}: refused for a plain reviewer, even the author', async () => {
    const c = comment();
    const res = await patch(c.id, { status: 'approved' }, anna);
    expect(res.status).toBe(403);
    expect(getComment(c.id, anna).status).toBe('open');
  });

  it('{status}: an admin approves', async () => {
    const c = comment();
    const res = await patch(c.id, { status: 'approved' }, root);
    expect(res.status).toBe(200);
    expect(getComment(c.id, anna).status).toBe('approved');
  });

  it('{body, status}: 400, one check never covers the other', async () => {
    const c = comment();
    const res = await patch(c.id, { body: 'x', status: 'approved' }, root);
    expect(res.status).toBe(400);
    expect(getComment(c.id, anna)).toMatchObject({ body: 'fix this', status: 'open' });
  });

  it('{status: invalid}: 400 for an admin, and no fall-through to the body branch', async () => {
    const c = comment();
    expect((await patch(c.id, { status: 'aproved' }, root)).status).toBe(400);
    // The author with an invalid status: the status branch is chosen (403), the body is untouched.
    const res = await patch(c.id, { status: 'aproved', body: 'sneaky' }, anna);
    expect(res.status).toBe(400);
    expect(getComment(c.id, anna).body).toBe('fix this');
    const res2 = await patch(c.id, { status: 'aproved' }, anna);
    expect(res2.status).toBe(403);
  });

  it('a non-object body is a 400, not a 500', async () => {
    const c = comment();
    expect((await patch(c.id, null, root)).status).toBe(400);
    expect((await patch(c.id, [1], root)).status).toBe(400);
  });
});
