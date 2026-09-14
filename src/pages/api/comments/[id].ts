import type { APIRoute } from 'astro';
import { deleteComment, getComment, setStatus, updateComment } from '~/lib/comments';
import { handler, HttpError, idParam, json, readJson, str } from '~/lib/http';

export const GET: APIRoute = handler((ctx) => json(getComment(idParam(ctx.params.id), ctx.locals.user)));

/**
 * PATCH { body } edits the text (author while open, or admin); PATCH { status } gives the verdict
 * (project manager only). The branch is chosen by the PRESENCE of the key, before any value is
 * inspected: validating first and falling through would let `{status: "aproved", body: "x"}` reach
 * the weaker author-only branch.
 */
export const PATCH: APIRoute = handler(async (ctx) => {
  const b = await readJson(ctx.request);
  const id = idParam(ctx.params.id);
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'Expected a JSON object');
  const hasBody = 'body' in b;
  const hasStatus = 'status' in b;
  if (hasBody && hasStatus) throw new HttpError(400, 'Send either body or status, not both');
  // setStatus checks the manager permission before it validates the value.
  if (hasStatus) return json(setStatus(id, b.status, ctx.locals.user));
  return json(updateComment(id, str(b.body) ?? '', ctx.locals.user));
});

export const DELETE: APIRoute = handler((ctx) => {
  deleteComment(idParam(ctx.params.id), ctx.locals.user);
  return new Response(null, { status: 204 });
});
