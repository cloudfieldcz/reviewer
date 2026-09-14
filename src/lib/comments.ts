import { and, asc, count, eq, inArray } from 'drizzle-orm';
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

/** The verdict on a comment. `open` is the working set; `approved` and `rejected` are decided. */
export type CommentStatus = 'open' | 'approved' | 'rejected';

export const COMMENT_STATUSES: readonly CommentStatus[] = ['open', 'approved', 'rejected'];

/**
 * Unlike `normalizeViewport`, this throws: a viewport is a display attribute where a wrong value is
 * harmless, a status is a decision record – coercing "aproved" to `open` would silently reopen a
 * decided comment while answering 200.
 */
export function normalizeStatus(input: unknown): CommentStatus {
  if (input === 'open' || input === 'approved' || input === 'rejected') return input;
  throw new HttpError(400, 'status must be open|approved|rejected');
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
  status: CommentStatus;
  /** When the verdict was given; null while open. */
  statusAt: string | null;
  /** Who gave it; null while open or when that user has been deleted. */
  statusBy: { id: number; name: string | null; email: string } | null;
  replies: ReplyDto[];
}

/** Second join onto `users`: the author and the person who decided the comment need not be the same. */
const statusSetter = alias(schema.users, 'status_setter');

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
  status: schema.comments.status,
  statusAt: schema.comments.statusAt,
  authorId: schema.users.id,
  authorName: schema.users.name,
  authorEmail: schema.users.email,
  setterId: statusSetter.id,
  setterName: statusSetter.name,
  setterEmail: statusSetter.email,
};

type Row = Omit<CommentDto, 'author' | 'mine' | 'viewport' | 'status' | 'statusBy' | 'replies'> & {
  viewport: string;
  status: string;
  authorId: number;
  authorName: string | null;
  authorEmail: string;
  setterId: number | null;
  setterName: string | null;
  setterEmail: string | null;
};

function toDto(r: Row, viewer: AuthUser, replies: ReplyDto[] = []): CommentDto {
  const { authorId, authorName, authorEmail, setterId, setterName, setterEmail, viewport, status, ...rest } = r;
  return {
    ...rest,
    viewport: normalizeViewport(viewport),
    // The column is unconstrained TEXT; anything the app did not write is a bug, not a state to invent.
    status: normalizeStatus(status),
    author: { id: authorId, name: authorName, email: authorEmail },
    mine: authorId === viewer.id,
    statusBy: setterId != null && setterEmail != null ? { id: setterId, name: setterName, email: setterEmail } : null,
    replies,
  };
}

export interface ListFilter {
  pagePath?: string;
  /** Restrict to these statuses; omitted means every status. */
  statuses?: readonly CommentStatus[];
}

export function listComments(projectId: number, filter: ListFilter, viewer: AuthUser): CommentDto[] {
  getProject(projectId);
  const where = and(
    eq(schema.comments.projectId, projectId),
    filter.pagePath ? eq(schema.comments.pagePath, filter.pagePath) : undefined,
    filter.statuses ? inArray(schema.comments.status, [...filter.statuses]) : undefined,
  );
  const rows = db
    .select(selectShape)
    .from(schema.comments)
    .innerJoin(schema.users, eq(schema.users.id, schema.comments.userId))
    .leftJoin(statusSetter, eq(statusSetter.id, schema.comments.statusBy))
    .where(where)
    .orderBy(asc(schema.comments.pagePath), asc(schema.comments.viewport), asc(schema.comments.rectTop), asc(schema.comments.id))
    .all();
  const replies = repliesFor(rows.map((r) => r.id), viewer);
  return rows.map((r) => toDto(r, viewer, replies.get(r.id) ?? []));
}

/** One grouped query – the export header names what the status filter left out. */
export function countByStatus(projectId: number, pagePath?: string): Record<CommentStatus, number> {
  const rows = db
    .select({ status: schema.comments.status, n: count() })
    .from(schema.comments)
    .where(and(eq(schema.comments.projectId, projectId), pagePath ? eq(schema.comments.pagePath, pagePath) : undefined))
    .groupBy(schema.comments.status)
    .all();
  const out: Record<CommentStatus, number> = { open: 0, approved: 0, rejected: 0 };
  for (const r of rows) out[normalizeStatus(r.status)] = r.n;
  return out;
}

export function getComment(id: number, viewer: AuthUser): CommentDto {
  const r = db
    .select(selectShape)
    .from(schema.comments)
    .innerJoin(schema.users, eq(schema.users.id, schema.comments.userId))
    .leftJoin(statusSetter, eq(statusSetter.id, schema.comments.statusBy))
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

/** The author while the comment is still open, or a global admin in any state. */
function assertCanEdit(id: number, viewer: AuthUser): CommentDto {
  const c = getComment(id, viewer);
  if (viewer.role === 'admin') return c;
  if (!c.mine) throw new HttpError(403, 'You can only edit your own comments');
  if (c.status !== 'open') throw new HttpError(403, 'A decided comment can no longer be edited');
  return c;
}

/**
 * The author while the comment is still open, or a global admin in any state.
 * Phase 2 widens the manager side to project owners; the author rule stays.
 */
function assertCanDelete(id: number, viewer: AuthUser): CommentDto {
  const c = getComment(id, viewer);
  if (viewer.role === 'admin') return c;
  if (!c.mine) throw new HttpError(403, 'You can only delete your own comments');
  if (c.status !== 'open') throw new HttpError(403, 'A decided comment can no longer be deleted');
  return c;
}

function sqlNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function updateComment(id: number, body: string, viewer: AuthUser): CommentDto {
  assertCanEdit(id, viewer);
  const text = body.trim();
  if (!text) throw new HttpError(400, 'Comment must not be empty');
  db.update(schema.comments).set({ body: text, updatedAt: sqlNow() }).where(eq(schema.comments.id, id)).run();
  return getComment(id, viewer);
}

/**
 * Approve, reject or reopen. A manager action – deliberately NOT guarded by `assertCanEdit`: the
 * comment's own author has no say in its verdict, otherwise anyone could approve their own comment
 * straight into the approved-only export. Admin-only until project owners arrive (Phase 2).
 * Setting the status the comment already holds is a no-op, so `statusAt` records the decision and
 * not the last click.
 */
export function setStatus(id: number, status: CommentStatus, viewer: AuthUser): CommentDto {
  if (viewer.role !== 'admin') throw new HttpError(403, 'Only a project manager can decide a comment');
  const c = getComment(id, viewer);
  if (c.status === status) return c;
  db.update(schema.comments)
    .set(status === 'open' ? { status, statusAt: null, statusBy: null } : { status, statusAt: sqlNow(), statusBy: viewer.id })
    .where(eq(schema.comments.id, id))
    .run();
  return getComment(id, viewer);
}

export function deleteComment(id: number, viewer: AuthUser): void {
  assertCanDelete(id, viewer);
  db.delete(schema.comments).where(eq(schema.comments.id, id)).run();
}
