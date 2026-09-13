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
    body: text('body').notNull(),
    // element anchors
    selector: text('selector'),
    xpath: text('xpath'),
    textSnippet: text('text_snippet'),
    tagName: text('tag_name'),
    rectTop: real('rect_top'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('comments_project_path_idx').on(t.projectId, t.pagePath),
    index('comments_user_idx').on(t.userId),
  ],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Comment = typeof comments.$inferSelect;
