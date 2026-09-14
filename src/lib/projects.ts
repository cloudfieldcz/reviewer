import { desc, eq, sql } from 'drizzle-orm';
import { managedProjects } from './access';
import type { AuthUser } from './auth';
import { db, schema } from './db';
import type { Project } from './db/schema';
import { HttpError } from './http';
import { fetchTarget } from './proxy/fetch';
import { assertPublicHost, normalizeBaseUrl } from './url';

export interface ProjectTile {
  id: number;
  name: string;
  baseUrl: string;
  createdAt: string;
  commentCount: number;
  lastCommentAt: string | null;
  /** Rendering hint for the tile; the API routes decide for real. */
  canManage: boolean;
}

export function listProjects(viewer: AuthUser): ProjectTile[] {
  // Aggregate over a join instead of correlated subqueries: inside a subquery drizzle renders
  // `schema.projects.id` as a bare `"id"`, which SQLite would resolve against `comments` instead.
  // `project_owners` is NOT joined here – a second join would fan `commentCount` out by the owner
  // count. One indexed query, then `canManage` in memory.
  const managed = managedProjects(viewer);
  const lastCommentAt = sql<string | null>`max(${schema.comments.createdAt})`;
  const rows = db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      baseUrl: schema.projects.baseUrl,
      createdAt: schema.projects.createdAt,
      commentCount: sql<number>`count(${schema.comments.id})`,
      lastCommentAt,
    })
    .from(schema.projects)
    .leftJoin(schema.comments, eq(schema.comments.projectId, schema.projects.id))
    .groupBy(schema.projects.id)
    // Most recently touched project first – that is the one people come back to.
    .orderBy(desc(sql`coalesce(${lastCommentAt}, ${schema.projects.createdAt})`))
    .all();
  return rows.map((r) => ({ ...r, canManage: managed === 'all' || managed.has(r.id) }));
}

export function getProject(id: number): Project {
  const p = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!p) throw new HttpError(404, 'Project not found');
  return p;
}

export interface ProjectInput {
  name: string;
  baseUrl: string;
}

async function validateInput(input: Partial<ProjectInput>, partial = false): Promise<Partial<ProjectInput>> {
  const out: Partial<ProjectInput> = {};
  if (input.name !== undefined || !partial) {
    const name = (input.name ?? '').trim();
    if (!name) throw new HttpError(400, 'Name is required');
    out.name = name.slice(0, 200);
  }
  if (input.baseUrl !== undefined || !partial) {
    let baseUrl: string;
    try {
      baseUrl = normalizeBaseUrl(input.baseUrl ?? '');
      await assertPublicHost(baseUrl);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    out.baseUrl = baseUrl;
  }
  return out;
}

export async function createProject(input: Partial<ProjectInput>, userId: number): Promise<Project> {
  const v = (await validateInput(input)) as ProjectInput;
  return db.insert(schema.projects).values({ ...v, createdBy: userId }).returning().get();
}

export async function updateProject(id: number, input: Partial<ProjectInput>): Promise<Project> {
  getProject(id);
  const v = await validateInput(input, true);
  if (Object.keys(v).length === 0) throw new HttpError(400, 'Nothing to update');
  // `validateInput` awaits a DNS lookup, so the row may be gone by the time we write – unlike the
  // synchronous read-then-write paths elsewhere, this one has to check what the update actually hit.
  const row = db.update(schema.projects).set(v).where(eq(schema.projects.id, id)).returning().get();
  if (!row) throw new HttpError(404, 'Project not found');
  return row;
}

export function deleteProject(id: number): void {
  getProject(id);
  db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
}

/** Quick reachability check used by the "new project" form: does the URL answer with HTML? */
export async function probeUrl(rawUrl: string): Promise<{ ok: boolean; status?: number; title?: string; error?: string }> {
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(rawUrl);
    await assertPublicHost(baseUrl);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  try {
    const res = await fetchTarget(baseUrl + '/', { redirect: 'follow' });
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html')) return { ok: false, status: res.status, error: `Response is not HTML (${ct || 'no content-type'})` };
    const html = await res.text();
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    return { ok: res.ok, status: res.status, title };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
