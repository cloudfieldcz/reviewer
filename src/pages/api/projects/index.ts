import type { APIRoute } from 'astro';
import { handler, json, readJson, requireAdmin, str } from '~/lib/http';
import { createProject, listProjects } from '~/lib/projects';

export const GET: APIRoute = handler(() => json(listProjects()));

export const POST: APIRoute = handler(async (ctx) => {
  requireAdmin(ctx);
  const body = await readJson(ctx.request);
  const project = await createProject({ name: str(body.name), baseUrl: str(body.baseUrl ?? body.base_url) }, ctx.locals.user.id);
  return json(project, { status: 201 });
});
