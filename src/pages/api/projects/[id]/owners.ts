import type { APIRoute } from 'astro';
import { listOwners, requireProjectManager, setOwners } from '~/lib/access';
import { handler, idParam, json, readJson, requireAdmin } from '~/lib/http';
import { getProject } from '~/lib/projects';

/** Readable by managers – an owner may ask "who else can approve this?". */
export const GET: APIRoute = handler((ctx) => {
  const project = getProject(idParam(ctx.params.id));
  requireProjectManager(project.id, ctx.locals.user);
  return json(listOwners(project.id));
});

/**
 * Replaces the owner set. PUT, not POST, is a security property: with `checkOrigin: false` the app
 * relies on CORS preflight, and a PUT with a JSON body cannot be forged cross-site by a form. The
 * project id comes from the URL only.
 */
export const PUT: APIRoute = handler(async (ctx) => {
  requireAdmin(ctx);
  const project = getProject(idParam(ctx.params.id));
  const body = await readJson(ctx.request);
  return json(setOwners(project.id, body.userIds, ctx.locals.user));
});
