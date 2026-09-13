import { and, asc, eq } from 'drizzle-orm';
import type { AuthUser } from './auth';
import { db, schema } from './db';
import { HttpError } from './http';
import { getProject } from './projects';

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
}

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
  authorId: schema.users.id,
  authorName: schema.users.name,
  authorEmail: schema.users.email,
};


type Row = Omit<CommentDto, 'author' | 'mine' | 'viewport'> & {
  viewport: string;
  authorId: number;
  authorName: string | null;
  authorEmail: string;
};

function toDto(r: Row, viewer: AuthUser): CommentDto {
  const { authorId, authorName, authorEmail, viewport, ...rest } = r;
  return {
    ...rest,
    viewport: normalizeViewport(viewport),
    author: { id: authorId, name: authorName, email: authorEmail },
    mine: authorId === viewer.id,
  };
}

export function listComments(projectId: number, pagePath: string | undefined, viewer: AuthUser): CommentDto[] {
  getProject(projectId);
  const where = pagePath
    ? and(eq(schema.comments.projectId, projectId), eq(schema.comments.pagePath, pagePath))
    : eq(schema.comments.projectId, projectId);
  return db
    .select(selectShape)
    .from(schema.comments)
    .innerJoin(schema.users, eq(schema.users.id, schema.comments.userId))
    .where(where)
    .orderBy(asc(schema.comments.pagePath), asc(schema.comments.viewport), asc(schema.comments.rectTop), asc(schema.comments.id))
    .all()
    .map((r) => toDto(r, viewer));
}

export function getComment(id: number, viewer: AuthUser): CommentDto {
  const r = db
    .select(selectShape)
    .from(schema.comments)
    .innerJoin(schema.users, eq(schema.users.id, schema.comments.userId))
    .where(eq(schema.comments.id, id))
    .get();
  if (!r) throw new HttpError(404, 'Comment not found');
  return toDto(r, viewer);
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

export function updateComment(id: number, body: string, viewer: AuthUser): CommentDto {
  assertCanModify(id, viewer);
  const text = body.trim();
  if (!text) throw new HttpError(400, 'Comment must not be empty');
  db.update(schema.comments)
    .set({ body: text, updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) })
    .where(eq(schema.comments.id, id))
    .run();
  return getComment(id, viewer);
}

export function deleteComment(id: number, viewer: AuthUser): void {
  assertCanModify(id, viewer);
  db.delete(schema.comments).where(eq(schema.comments.id, id)).run();
}
