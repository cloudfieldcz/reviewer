import type { APIRoute } from 'astro';
import { handler, idParam, json, readJson, requireAdmin, str } from '~/lib/http';
import { deleteProject, getProject, updateProject } from '~/lib/projects';

export const GET: APIRoute = handler((ctx) => json(getProject(idParam(ctx.params.id))));

export const PATCH: APIRoute = handler(async (ctx) => {
  requireAdmin(ctx);
  const body = await readJson(ctx.request);
  return json(await updateProject(idParam(ctx.params.id), { name: str(body.name), baseUrl: str(body.baseUrl ?? body.base_url) }));
});

export const DELETE: APIRoute = handler((ctx) => {
  requireAdmin(ctx);
  deleteProject(idParam(ctx.params.id));
  return new Response(null, { status: 204 });
});
