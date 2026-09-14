import { asc, eq, inArray } from 'drizzle-orm';
import type { AuthUser } from './auth';
import { db, schema } from './db';
import { HttpError } from './http';

/**
 * Replies to a comment. A flat thread, no nesting – the parent comment carries the anchor, the
 * viewport and the position, a reply carries nothing but text.
 *
 * This module deliberately does not import `./comments`: `comments.ts` pulls reply lists into its
 * DTOs, so the dependency has to run one way only.
 */
export interface ReplyDto {
  id: number;
  commentId: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: { id: number; name: string | null; email: string };
  mine: boolean;
}

const selectShape = {
  id: schema.commentReplies.id,
  commentId: schema.commentReplies.commentId,
  body: schema.commentReplies.body,
  createdAt: schema.commentReplies.createdAt,
  updatedAt: schema.commentReplies.updatedAt,
  authorId: schema.users.id,
  authorName: schema.users.name,
  authorEmail: schema.users.email,
};

type Row = Omit<ReplyDto, 'author' | 'mine'> & { authorId: number; authorName: string | null; authorEmail: string };

function toDto(r: Row, viewer: AuthUser): ReplyDto {
  const { authorId, authorName, authorEmail, ...rest } = r;
  return { ...rest, author: { id: authorId, name: authorName, email: authorEmail }, mine: authorId === viewer.id };
}

function sqlNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** One query for a whole page of comments – never one per comment. */
export function repliesFor(commentIds: number[], viewer: AuthUser): Map<number, ReplyDto[]> {
  const byComment = new Map<number, ReplyDto[]>();
  if (commentIds.length === 0) return byComment;
  const rows = db
    .select(selectShape)
    .from(schema.commentReplies)
    .innerJoin(schema.users, eq(schema.users.id, schema.commentReplies.userId))
    .where(inArray(schema.commentReplies.commentId, commentIds))
    .orderBy(asc(schema.commentReplies.commentId), asc(schema.commentReplies.createdAt), asc(schema.commentReplies.id))
    .all();
  for (const r of rows) {
    const list = byComment.get(r.commentId) ?? [];
    list.push(toDto(r, viewer));
    byComment.set(r.commentId, list);
  }
  return byComment;
}

export function getReply(id: number, viewer: AuthUser): ReplyDto {
  const r = db
    .select(selectShape)
    .from(schema.commentReplies)
    .innerJoin(schema.users, eq(schema.users.id, schema.commentReplies.userId))
    .where(eq(schema.commentReplies.id, id))
    .get();
  if (!r) throw new HttpError(404, 'Reply not found');
  return toDto(r, viewer);
}

/** Anyone who can see the project can reply – only closing a thread is restricted. */
export function createReply(commentId: number, body: string, viewer: AuthUser): ReplyDto {
  const parent = db.select({ id: schema.comments.id }).from(schema.comments).where(eq(schema.comments.id, commentId)).get();
  if (!parent) throw new HttpError(404, 'Comment not found');
  const text = body.trim();
  if (!text) throw new HttpError(400, 'Reply must not be empty');
  const row = db
    .insert(schema.commentReplies)
    .values({ commentId, userId: viewer.id, body: text })
    .returning({ id: schema.commentReplies.id })
    .get();
  return getReply(row.id, viewer);
}

function assertCanModify(id: number, viewer: AuthUser): ReplyDto {
  const r = getReply(id, viewer);
  if (!r.mine && viewer.role !== 'admin') throw new HttpError(403, 'You can only modify your own replies');
  return r;
}

export function updateReply(id: number, body: string, viewer: AuthUser): ReplyDto {
  assertCanModify(id, viewer);
  const text = body.trim();
  if (!text) throw new HttpError(400, 'Reply must not be empty');
  db.update(schema.commentReplies).set({ body: text, updatedAt: sqlNow() }).where(eq(schema.commentReplies.id, id)).run();
  return getReply(id, viewer);
}

export function deleteReply(id: number, viewer: AuthUser): void {
  assertCanModify(id, viewer);
  db.delete(schema.commentReplies).where(eq(schema.commentReplies.id, id)).run();
}
