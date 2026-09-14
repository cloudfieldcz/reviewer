import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '~/lib/auth';

process.env.DATABASE_PATH = ':memory:';
const { db, schema } = await import('~/lib/db');
const { countByStatus, createComment, deleteComment, getComment, listComments, normalizeStatus, setStatus, updateComment } = await import('~/lib/comments');
const { createReply, deleteReply, updateReply } = await import('~/lib/replies');
const { setOwners } = await import('~/lib/access');

const anna: AuthUser = { id: 1, oid: 'oid-1', email: 'anna@example.com', name: 'Anna', role: 'user' };
const bob: AuthUser = { id: 2, oid: 'oid-2', email: 'bob@example.com', name: 'Bob', role: 'user' };
const root: AuthUser = { id: 3, oid: 'oid-3', email: 'root@example.com', name: 'Root', role: 'admin' };
/** Owner of project 1 only – a plain `user` role, rights come from `project_owners`. */
const olga: AuthUser = { id: 4, oid: 'oid-4', email: 'olga@example.com', name: 'Olga', role: 'user' };

beforeEach(() => {
  db.delete(schema.projectOwners).run();
  db.delete(schema.commentReplies).run();
  db.delete(schema.comments).run();
  db.delete(schema.projects).run();
  db.delete(schema.users).run();
  for (const u of [anna, bob, root, olga]) {
    db.insert(schema.users).values({ id: u.id, oid: u.oid, email: u.email, name: u.name, role: u.role }).run();
  }
  db.insert(schema.projects).values({ id: 1, name: 'site', baseUrl: 'https://site.example.com', createdBy: anna.id }).run();
  db.insert(schema.projects).values({ id: 2, name: 'other', baseUrl: 'https://other.example.com', createdBy: anna.id }).run();
  setOwners(1, [olga.id], root);
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
    const byBody = Object.fromEntries(listComments(1, { pagePath: '/' }, anna).map((c) => [c.body, c.replies.map((r) => r.body)]));
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

  it('lets only the reply author or a project manager edit and delete it', () => {
    const c = comment(anna);
    const r = createReply(c.id, 'mine', bob);
    expect(() => updateReply(r.id, 'edited', anna)).toThrow(/own/i);
    expect(() => deleteReply(r.id, anna)).toThrow(/own/i);
    expect(updateReply(r.id, 'edited', bob).body).toBe('edited');
    deleteReply(r.id, root);
    expect(getComment(c.id, anna).replies).toHaveLength(0);
  });

  it('lets the project owner delete someone else’s reply; an owner of another project cannot', () => {
    const c = comment(anna);
    const r = createReply(c.id, 'spam', bob);
    const elsewhere = createComment({ projectId: 2, pagePath: '/', viewport: 'desktop', body: 'x' }, anna);
    const r2 = createReply(elsewhere.id, 'spam', bob);
    expect(() => deleteReply(r2.id, olga)).toThrow(expect.objectContaining({ status: 403 }));
    deleteReply(r.id, olga);
    expect(getComment(c.id, anna).replies).toHaveLength(0);
  });

  it('lets a reply author edit their reply whatever the comment status', () => {
    const c = comment(anna);
    const r = createReply(c.id, 'first', bob);
    setStatus(c.id, 'rejected', olga);
    expect(updateReply(r.id, 'second', bob).body).toBe('second');
  });

  it('keeps replies when the comment is decided, drops them when the comment is deleted', () => {
    const c = comment(anna);
    createReply(c.id, 'still here', bob);
    setStatus(c.id, 'approved', root);
    expect(getComment(c.id, anna).replies).toHaveLength(1);
    db.delete(schema.comments).where(eq(schema.comments.id, c.id)).run();
    expect(db.select().from(schema.commentReplies).all()).toHaveLength(0);
  });
});

describe('normalizeStatus', () => {
  it('accepts exactly the three statuses', () => {
    expect(normalizeStatus('open')).toBe('open');
    expect(normalizeStatus('approved')).toBe('approved');
    expect(normalizeStatus('rejected')).toBe('rejected');
  });

  it('throws 400 instead of coercing – a typo must not silently reopen a decided comment', () => {
    for (const bad of ['aproved', 'resolved', '', null, undefined, true, 1, 'OPEN']) {
      expect(() => normalizeStatus(bad)).toThrow(expect.objectContaining({ status: 400 }));
    }
  });
});

describe('status', () => {
  it('starts open with no decider', () => {
    const c = comment(anna);
    expect(c.status).toBe('open');
    expect(c.statusAt).toBeNull();
    expect(c.statusBy).toBeNull();
  });

  it('lets an admin approve, records who and when, and reopen clears both', () => {
    const c = comment(anna);
    const approved = setStatus(c.id, 'approved', root);
    expect(approved.status).toBe('approved');
    expect(approved.statusAt).not.toBeNull();
    expect(approved.statusBy?.email).toBe(root.email);
    const reopened = setStatus(c.id, 'open', root);
    expect(reopened.status).toBe('open');
    expect(reopened.statusAt).toBeNull();
    expect(reopened.statusBy).toBeNull();
  });

  it('lets an admin reject', () => {
    const c = comment(anna);
    expect(setStatus(c.id, 'rejected', root).status).toBe('rejected');
  });

  it('refuses the comment author – nobody approves their own comment into the export', () => {
    const c = comment(anna);
    expect(() => setStatus(c.id, 'approved', anna)).toThrow(expect.objectContaining({ status: 403 }));
    expect(getComment(c.id, anna).status).toBe('open');
  });

  it('refuses an unrelated non-admin user', () => {
    const c = comment(anna);
    expect(() => setStatus(c.id, 'rejected', bob)).toThrow(expect.objectContaining({ status: 403 }));
  });

  it('lets the project owner reject; an owner of a different project gets 403', () => {
    const c = comment(anna);
    const elsewhere = createComment({ projectId: 2, pagePath: '/', viewport: 'desktop', body: 'x' }, anna);
    expect(() => setStatus(elsewhere.id, 'rejected', olga)).toThrow(expect.objectContaining({ status: 403 }));
    const rejected = setStatus(c.id, 'rejected', olga);
    expect(rejected.status).toBe('rejected');
    expect(rejected.statusBy?.email).toBe(olga.email);
  });

  it('checks the permission before the value – a reviewer with a typo gets 403, a manager 400', () => {
    const c = comment(anna);
    expect(() => setStatus(c.id, 'aproved', anna)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => setStatus(c.id, 'aproved', olga)).toThrow(expect.objectContaining({ status: 400 }));
    expect(getComment(c.id, anna).status).toBe('open');
  });

  it('is a no-op when the status is already the requested one – statusAt records the decision, not the last click', () => {
    const c = comment(anna);
    db.update(schema.comments).set({ status: 'approved', statusAt: '2026-01-01 00:00:00', statusBy: root.id }).where(eq(schema.comments.id, c.id)).run();
    const again = setStatus(c.id, 'approved', root);
    expect(again.statusAt).toBe('2026-01-01 00:00:00');
  });

  it('carries the decider on the listed comment', () => {
    const c = comment(anna);
    setStatus(c.id, 'approved', root);
    const listed = listComments(1, { pagePath: '/' }, bob)[0]!;
    expect(listed.statusBy?.name).toBe('Root');
    expect(listed.status).toBe('approved');
  });

  it('keeps the verdict when the decider is deleted', () => {
    const c = comment(anna);
    setStatus(c.id, 'approved', root);
    db.delete(schema.users).where(eq(schema.users.id, root.id)).run();
    const after = getComment(c.id, anna);
    expect(after.status).toBe('approved');
    expect(after.statusBy).toBeNull();
  });

  it('does not touch the body', () => {
    const c = comment(anna);
    expect(setStatus(c.id, 'approved', root).body).toBe('fix this');
  });
});

describe('editing and deleting under a verdict', () => {
  it('lets the author edit and delete their own comment while open', () => {
    const c = comment(anna);
    expect(updateComment(c.id, 'edited', anna).body).toBe('edited');
    deleteComment(c.id, anna);
    expect(() => getComment(c.id, anna)).toThrow(/not found/i);
  });

  it('refuses the author both once the comment is decided', () => {
    const c = comment(anna);
    setStatus(c.id, 'approved', root);
    expect(() => updateComment(c.id, 'rewritten', anna)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => deleteComment(c.id, anna)).toThrow(expect.objectContaining({ status: 403 }));
    expect(getComment(c.id, anna).body).toBe('fix this');
  });

  it('refuses a stranger in any state', () => {
    const c = comment(anna);
    expect(() => updateComment(c.id, 'x', bob)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => deleteComment(c.id, bob)).toThrow(expect.objectContaining({ status: 403 }));
  });

  it('lets the owner delete someone else’s comment and their own decided one, but edit neither', () => {
    const theirs = comment(anna);
    const own = comment(olga, 'my own');
    setStatus(own.id, 'approved', root);
    expect(() => updateComment(theirs.id, 'x', olga)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => updateComment(own.id, 'x', olga)).toThrow(expect.objectContaining({ status: 403 }));
    deleteComment(theirs.id, olga);
    deleteComment(own.id, olga);
    expect(listComments(1, {}, olga)).toHaveLength(0);
  });

  it('holds the owner to the open-only rule on another project, where they are a plain reviewer', () => {
    const c = createComment({ projectId: 2, pagePath: '/', viewport: 'desktop', body: 'x' }, olga);
    setStatus(c.id, 'approved', root);
    expect(() => deleteComment(c.id, olga)).toThrow(expect.objectContaining({ status: 403 }));
  });

  it('lets an admin edit and delete in any state', () => {
    const c = comment(anna);
    setStatus(c.id, 'rejected', root);
    expect(updateComment(c.id, 'admin edit', root).body).toBe('admin edit');
    deleteComment(c.id, root);
    expect(() => getComment(c.id, anna)).toThrow(/not found/i);
  });
});

describe('listing by status', () => {
  it('filters in the query and counts every status for the header', () => {
    const a = comment(anna, 'a');
    const b = comment(anna, 'b');
    comment(bob, 'c');
    setStatus(a.id, 'approved', root);
    setStatus(b.id, 'rejected', root);
    expect(listComments(1, { statuses: ['approved'] }, anna).map((c) => c.body)).toEqual(['a']);
    expect(listComments(1, { statuses: ['approved', 'rejected'] }, anna).map((c) => c.body).sort()).toEqual(['a', 'b']);
    expect(listComments(1, {}, anna)).toHaveLength(3);
    expect(countByStatus(1)).toEqual({ open: 1, approved: 1, rejected: 1 });
    expect(countByStatus(1, '/nowhere')).toEqual({ open: 0, approved: 0, rejected: 0 });
  });
});
