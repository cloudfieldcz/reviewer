import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  oid: text('oid').notNull().unique(),
  email: text('email').notNull(),
  name: text('name'),
  /** 'admin' | 'user' – cache of the last login only; the oauth2-proxy header is authoritative */
  role: text('role').notNull().default('user'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  lastSeenAt: text('last_seen_at').notNull().default(sql`(datetime('now'))`),
});

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** https://test.example.com  (no trailing slash) */
  baseUrl: text('base_url').notNull(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const comments = sqliteTable(
  'comments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** '/contact?x=1' – path + query without origin */
    pagePath: text('page_path').notNull(),
    /** 'desktop' | 'phone' – the simulated viewport the comment was made in; the DOM differs between them */
    viewport: text('viewport').notNull().default('desktop'),
    body: text('body').notNull(),
    // element anchors
    selector: text('selector'),
    xpath: text('xpath'),
    textSnippet: text('text_snippet'),
    tagName: text('tag_name'),
    rectTop: real('rect_top'),
    /** Set when the thread is closed; null means open. */
    resolvedAt: text('resolved_at'),
    resolvedBy: integer('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('comments_project_path_idx').on(t.projectId, t.pagePath),
    index('comments_user_idx').on(t.userId),
  ],
);

/**
 * Flat list of replies under a comment – a thread, not a tree. Kept out of `comments` on purpose:
 * anchoring, viewport, marker numbering and the project comment counts all query `comments`, and a
 * self-join would mean teaching every one of those about parent rows.
 */
export const commentReplies = sqliteTable(
  'comment_replies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    commentId: integer('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index('comment_replies_comment_idx').on(t.commentId)],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type CommentReply = typeof commentReplies.$inferSelect;
