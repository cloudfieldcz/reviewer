import type { APIRoute } from 'astro';
import { deleteComment, getComment, setResolved, updateComment } from '~/lib/comments';
import { handler, idParam, json, readJson, str } from '~/lib/http';

export const GET: APIRoute = handler((ctx) => json(getComment(idParam(ctx.params.id), ctx.locals.user)));

/** PATCH { body } edits the text, PATCH { resolved } closes or reopens the thread – same permission. */
export const PATCH: APIRoute = handler(async (ctx) => {
  const b = await readJson(ctx.request);
  const id = idParam(ctx.params.id);
  if (typeof b.resolved === 'boolean') return json(setResolved(id, b.resolved, ctx.locals.user));
  return json(updateComment(id, str(b.body) ?? '', ctx.locals.user));
});

export const DELETE: APIRoute = handler((ctx) => {
  deleteComment(idParam(ctx.params.id), ctx.locals.user);
  return new Response(null, { status: 204 });
});
