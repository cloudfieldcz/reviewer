import type { APIRoute } from 'astro';
import { handler, idParam, json, readJson, str } from '~/lib/http';
import { deleteReply, updateReply } from '~/lib/replies';

export const PATCH: APIRoute = handler(async (ctx) => {
  const b = await readJson(ctx.request);
  return json(updateReply(idParam(ctx.params.id), str(b.body) ?? '', ctx.locals.user));
});

export const DELETE: APIRoute = handler((ctx) => {
  deleteReply(idParam(ctx.params.id), ctx.locals.user);
  return new Response(null, { status: 204 });
});
