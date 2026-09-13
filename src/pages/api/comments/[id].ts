import type { APIRoute } from 'astro';
import { deleteComment, getComment, updateComment } from '~/lib/comments';
import { handler, idParam, json, readJson, str } from '~/lib/http';

export const GET: APIRoute = handler((ctx) => json(getComment(idParam(ctx.params.id), ctx.locals.user)));

export const PATCH: APIRoute = handler(async (ctx) => {
  const b = await readJson(ctx.request);
  return json(updateComment(idParam(ctx.params.id), str(b.body) ?? '', ctx.locals.user));
});

export const DELETE: APIRoute = handler((ctx) => {
  deleteComment(idParam(ctx.params.id), ctx.locals.user);
  return new Response(null, { status: 204 });
});
