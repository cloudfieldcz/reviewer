import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '~/lib/auth';

process.env.DATABASE_PATH = ':memory:';
const { db, schema } = await import('~/lib/db');
const { createComment, getComment, listComments, setResolved } = await import('~/lib/comments');
const { createReply, deleteReply, updateReply } = await import('~/lib/replies');

const anna: AuthUser = { id: 1, oid: 'oid-1', email: 'anna@example.com', name: 'Anna', role: 'user' };
const bob: AuthUser = { id: 2, oid: 'oid-2', email: 'bob@example.com', name: 'Bob', role: 'user' };
const root: AuthUser = { id: 3, oid: 'oid-3', email: 'root@example.com', name: 'Root', role: 'admin' };

beforeEach(() => {
  db.delete(schema.commentReplies).run();
  db.delete(schema.comments).run();
  db.delete(schema.projects).run();
  db.delete(schema.users).run();
  for (const u of [anna, bob, root]) {
    db.insert(schema.users).values({ id: u.id, oid: u.oid, email: u.email, name: u.name, role: u.role }).run();
  }
  db.insert(schema.projects).values({ id: 1, name: 'site', baseUrl: 'https://site.example.com', createdBy: anna.id }).run();
});

const comment = (author: AuthUser, body = 'fix this') =>
  createComment({ projectId: 1, pagePath: '/', viewport: 'desktop', body }, author);

describe('replies', () => {
  it('lets any user reply to someone else’s comment', () => {
    const c = comment(anna);
    const r = createReply(c.id, 'agreed', bob);
    expect(r.body).toBe('agreed');
    expect(r.author.email).toBe(bob.email);
    expect(getComment(c.id, anna).replies).toHaveLength(1);
  });

  it('marks replies written by the viewer as mine', () => {
    const c = comment(anna);
    createReply(c.id, 'from bob', bob);
    expect(getComment(c.id, bob).replies[0]!.mine).toBe(true);
    expect(getComment(c.id, anna).replies[0]!.mine).toBe(false);
  });

  it('returns replies oldest first', () => {
    const c = comment(anna);
    createReply(c.id, 'first', bob);
    createReply(c.id, 'second', anna);
    expect(getComment(c.id, anna).replies.map((r) => r.body)).toEqual(['first', 'second']);
  });

  it('attaches replies to the right comment when listing a page', () => {
    const a = comment(anna, 'one');
    const b = comment(bob, 'two');
    createReply(a.id, 'on one', bob);
    createReply(b.id, 'on two', anna);
    createReply(b.id, 'also on two', anna);
    const byBody = Object.fromEntries(listComments(1, '/', anna).map((c) => [c.body, c.replies.map((r) => r.body)]));
    expect(byBody.one).toEqual(['on one']);
    expect(byBody.two).toEqual(['on two', 'also on two']);
  });

  it('rejects an empty reply', () => {
    const c = comment(anna);
    expect(() => createReply(c.id, '   ', bob)).toThrow(/empty/i);
  });

  it('404s on a reply to a comment that does not exist', () => {
    expect(() => createReply(999, 'hello', bob)).toThrow(/not found/i);
  });

  it('lets only the reply author or an admin edit and delete it', () => {
    const c = comment(anna);
    const r = createReply(c.id, 'mine', bob);
    expect(() => updateReply(r.id, 'edited', anna)).toThrow(/own/i);
    expect(() => deleteReply(r.id, anna)).toThrow(/own/i);
    expect(updateReply(r.id, 'edited', bob).body).toBe('edited');
    deleteReply(r.id, root);
    expect(getComment(c.id, anna).replies).toHaveLength(0);
  });

  it('keeps replies when the thread is resolved, drops them when the comment is deleted', () => {
    const c = comment(anna);
    createReply(c.id, 'still here', bob);
    setResolved(c.id, true, anna);
    expect(getComment(c.id, anna).replies).toHaveLength(1);
    db.delete(schema.comments).where(eq(schema.comments.id, c.id)).run();
    expect(db.select().from(schema.commentReplies).all()).toHaveLength(0);
  });
});

describe('resolving', () => {
  it('lets the comment author close and reopen the thread', () => {
    const c = comment(anna);
    expect(c.resolvedAt).toBeNull();
    const closed = setResolved(c.id, true, anna);
    expect(closed.resolvedAt).not.toBeNull();
    expect(closed.resolvedBy?.email).toBe(anna.email);
    const reopened = setResolved(c.id, false, anna);
    expect(reopened.resolvedAt).toBeNull();
    expect(reopened.resolvedBy).toBeNull();
  });

  it('lets an admin close someone else’s comment', () => {
    const c = comment(anna);
    expect(setResolved(c.id, true, root).resolvedBy?.email).toBe(root.email);
  });

  it('refuses to let an unrelated user close the comment', () => {
    const c = comment(anna);
    expect(() => setResolved(c.id, true, bob)).toThrow(/own/i);
  });

  it('leaves the resolver recorded on the listed comment', () => {
    const c = comment(anna);
    setResolved(c.id, true, root);
    const listed = listComments(1, '/', bob)[0]!;
    expect(listed.resolvedBy?.name).toBe('Root');
    expect(listed.resolvedAt).toBe(listed.resolvedAt);
  });

  it('does not touch the comment body timestamp semantics', () => {
    const c = comment(anna);
    expect(setResolved(c.id, true, anna).body).toBe('fix this');
  });
});
