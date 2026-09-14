import { and, asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { AuthUser } from './auth';
import { db, schema } from './db';
import { HttpError } from './http';
import { getProject } from './projects';
import { repliesFor, type ReplyDto } from './replies';

export type { ReplyDto };

/** The simulated viewport a comment belongs to – the target DOM differs between the two. */
export type Viewport = 'desktop' | 'phone';

export function normalizeViewport(input: unknown): Viewport {
  return input === 'phone' ? 'phone' : 'desktop';
}

export interface CommentDto {
  id: number;
  projectId: number;
  pagePath: string;
  viewport: Viewport;
  body: string;
  selector: string | null;
  xpath: string | null;
  textSnippet: string | null;
  tagName: string | null;
  rectTop: number | null;
  createdAt: string;
  updatedAt: string;
  author: { id: number; name: string | null; email: string };
  mine: boolean;
  /** Closed threads stay in the database and in exports; the review screen just hides them by default. */
  resolvedAt: string | null;
  resolvedBy: { id: number; name: string | null; email: string } | null;
  replies: ReplyDto[];
}

/** Second join onto `users`: the author and the person who closed the thread need not be the same. */
const resolver = alias(schema.users, 'resolver');

const selectShape = {
  id: schema.comments.id,
  projectId: schema.comments.projectId,
  pagePath: schema.comments.pagePath,
  viewport: schema.comments.viewport,
  body: schema.comments.body,
  selector: schema.comments.selector,
  xpath: schema.comments.xpath,
  textSnippet: schema.comments.textSnippet,
  tagName: schema.comments.tagName,
  rectTop: schema.comments.rectTop,
  createdAt: schema.comments.createdAt,
  updatedAt: schema.comments.updatedAt,
  resolvedAt: schema.comments.resolvedAt,
  authorId: schema.users.id,
  authorName: schema.users.name,
  authorEmail: schema.users.email,
  resolverId: resolver.id,
  resolverName: resolver.name,
  resolverEmail: resolver.email,
};


type Row = Omit<CommentDto, 'author' | 'mine' | 'viewport' | 'resolvedBy' | 'replies'> & {
  viewport: string;
  authorId: number;
  authorName: string | null;
  authorEmail: string;
  resolverId: number | null;
  resolverName: string | null;
  resolverEmail: string | null;
};

function toDto(r: Row, viewer: AuthUser, replies: ReplyDto[] = []): CommentDto {
  const { authorId, authorName, authorEmail, resolverId, resolverName, resolverEmail, viewport, ...rest } = r;
  return {
    ...rest,
    viewport: normalizeViewport(viewport),
    author: { id: authorId, name: authorName, email: authorEmail },
    mine: authorId === viewer.id,
    resolvedBy: resolverId != null && resolverEmail != null ? { id: resolverId, name: resolverName, email: resolverEmail } : null,
    replies,
  };
}

export function listComments(projectId: number, pagePath: string | undefined, viewer: AuthUser): CommentDto[] {
  getProject(projectId);
  const where = pagePath
    ? and(eq(schema.comments.projectId, projectId), eq(schema.comments.pagePath, pagePath))
    : eq(schema.comments.projectId, projectId);
  const rows = db
    .select(selectShape)
    .from(schema.comments)
    .innerJoin(schema.users, eq(schema.users.id, schema.comments.userId))
    .leftJoin(resolver, eq(resolver.id, schema.comments.resolvedBy))
    .where(where)
    .orderBy(asc(schema.comments.pagePath), asc(schema.comments.viewport), asc(schema.comments.rectTop), asc(schema.comments.id))
    .all();
  const replies = repliesFor(rows.map((r) => r.id), viewer);
  return rows.map((r) => toDto(r, viewer, replies.get(r.id) ?? []));
}

export function getComment(id: number, viewer: AuthUser): CommentDto {
  const r = db
    .select(selectShape)
    .from(schema.comments)
    .innerJoin(schema.users, eq(schema.users.id, schema.comments.userId))
    .leftJoin(resolver, eq(resolver.id, schema.comments.resolvedBy))
    .where(eq(schema.comments.id, id))
    .get();
  if (!r) throw new HttpError(404, 'Comment not found');
  return toDto(r, viewer, repliesFor([id], viewer).get(id) ?? []);
}

export interface CommentInput {
  projectId: number;
  pagePath: string;
  viewport: Viewport;
  body: string;
  selector?: string | null;
  xpath?: string | null;
  textSnippet?: string | null;
  tagName?: string | null;
  rectTop?: number | null;
}

/** Normalizes a page path coming from the client: always starts with '/', never contains the /p/{id} prefix or an origin. */
export function normalizePagePath(input: unknown): string {
  if (typeof input !== 'string') throw new HttpError(400, 'page_path is required');
  let p = input.trim();
  if (/^https?:\/\//i.test(p)) {
    const u = new URL(p);
    p = u.pathname + u.search;
  }
  p = p.replace(/^\/p\/\d+(?=\/|\?|$)/, '');
  if (!p.startsWith('/')) p = '/' + p;
  return p.slice(0, 2000);
}

export function createComment(input: CommentInput, viewer: AuthUser): CommentDto {
  getProject(input.projectId);
  const body = input.body.trim();
  if (!body) throw new HttpError(400, 'Comment must not be empty');
  const row = db
    .insert(schema.comments)
    .values({
      projectId: input.projectId,
      userId: viewer.id,
      pagePath: input.pagePath,
      viewport: input.viewport,
      body,
      selector: input.selector ?? null,
      xpath: input.xpath ?? null,
      textSnippet: input.textSnippet ?? null,
      tagName: input.tagName ?? null,
      rectTop: input.rectTop ?? null,
    })
    .returning({ id: schema.comments.id })
    .get();
  return getComment(row.id, viewer);
}

function assertCanModify(id: number, viewer: AuthUser): CommentDto {
  const c = getComment(id, viewer);
  if (!c.mine && viewer.role !== 'admin') throw new HttpError(403, 'You can only modify your own comments');
  return c;
}

function sqlNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function updateComment(id: number, body: string, viewer: AuthUser): CommentDto {
  assertCanModify(id, viewer);
  const text = body.trim();
  if (!text) throw new HttpError(400, 'Comment must not be empty');
  db.update(schema.comments).set({ body: text, updatedAt: sqlNow() }).where(eq(schema.comments.id, id)).run();
  return getComment(id, viewer);
}

/** Close or reopen a thread. Same permission as editing: the comment author or an admin. */
export function setResolved(id: number, resolved: boolean, viewer: AuthUser): CommentDto {
  assertCanModify(id, viewer);
  db.update(schema.comments)
    .set(resolved ? { resolvedAt: sqlNow(), resolvedBy: viewer.id } : { resolvedAt: null, resolvedBy: null })
    .where(eq(schema.comments.id, id))
    .run();
  return getComment(id, viewer);
}

export function deleteComment(id: number, viewer: AuthUser): void {
  assertCanModify(id, viewer);
  db.delete(schema.comments).where(eq(schema.comments.id, id)).run();
}
