import type { APIRoute } from 'astro';
import { handler, idParam, json, readJson, str } from '~/lib/http';
import { createReply } from '~/lib/replies';

/** POST { body } – anyone who can see the project may reply, in every comment status. */
export const POST: APIRoute = handler(async (ctx) => {
  const b = await readJson(ctx.request);
  return json(createReply(idParam(ctx.params.id), str(b.body) ?? '', ctx.locals.user), { status: 201 });
});
