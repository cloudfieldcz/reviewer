import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
    /** 'open' | 'approved' | 'rejected' – the verdict on the comment; SQLite has no enum, `normalizeStatus()` is the gate. */
    status: text('status').notNull().default('open'),
    /** When the status was last changed; null while open. */
    statusAt: text('status_at'),
    /** Who decided; SET NULL so deleting a user never deletes a verdict. */
    statusBy: integer('status_by').references(() => users.id, { onDelete: 'set null' }),
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

/**
 * Who may decide a project's comments without being a global admin. A membership fact keyed on
 * `users.id`, not a copy of a role – the global role still comes from the oauth2-proxy headers on
 * every request. Ownership grants rights on one project's comments, never access to the app.
 */
export const projectOwners = sqliteTable(
  'project_owners',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addedAt: text('added_at').notNull().default(sql`(datetime('now'))`),
    /** Who granted it – a privilege grant is the one thing worth a trace. */
    addedBy: integer('added_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index('project_owners_user_idx').on(t.userId)],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type CommentReply = typeof commentReplies.$inferSelect;
export type ProjectOwner = typeof projectOwners.$inferSelect;
