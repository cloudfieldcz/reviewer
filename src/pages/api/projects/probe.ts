import type { APIRoute } from 'astro';
import { handler, json, readJson, requireAdmin, str } from '~/lib/http';
import { probeUrl } from '~/lib/projects';

/** POST { url } → { ok, status, title, error } – used by the new-project form preview. */
export const POST: APIRoute = handler(async (ctx) => {
  requireAdmin(ctx);
  const body = await readJson(ctx.request);
  return json(await probeUrl(str(body.url) ?? ''));
});
