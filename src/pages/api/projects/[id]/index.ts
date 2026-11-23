import type { APIRoute } from 'astro';
import { handler, HttpError, idParam, json, readJson, requireAdmin, str } from '~/lib/http';
import { deleteProject, getProject, updateProject } from '~/lib/projects';

export const GET: APIRoute = handler((ctx) => json(getProject(idParam(ctx.params.id))));

export const PATCH: APIRoute = handler(async (ctx) => {
  requireAdmin(ctx);
  const body = await readJson(ctx.request);
  const phoneView = body.phoneView ?? body.phone_view;
  // A flag, not a string: "false" must not quietly turn the phone view on.
  if (phoneView !== undefined && typeof phoneView !== 'boolean') throw new HttpError(400, 'phoneView must be true or false');
  return json(await updateProject(idParam(ctx.params.id), { name: str(body.name), baseUrl: str(body.baseUrl ?? body.base_url), phoneView }));
});

export const DELETE: APIRoute = handler(async (ctx) => {
  requireAdmin(ctx);
  await deleteProject(idParam(ctx.params.id));
  return new Response(null, { status: 204 });
});
