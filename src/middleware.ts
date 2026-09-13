import { defineMiddleware } from 'astro:middleware';
import { authenticate } from '~/lib/auth';

const PUBLIC_PATHS = new Set(['/api/health', '/favicon.svg']);

export const onRequest = defineMiddleware(async (ctx, next) => {
  const path = ctx.url.pathname;
  if (PUBLIC_PATHS.has(path) || path.startsWith('/_astro/')) return next();

  const result = authenticate(ctx.request.headers);
  if ('error' in result) {
    if (result.error === 'unauthorized') {
      return new Response('Unauthorized – missing identity headers (app must be accessed through oauth2-proxy)', {
        status: 401,
      });
    }
    return new Response('Forbidden – your account has no Reviewer role (ADMIN/USER). Ask an admin to assign it in Entra ID.', {
      status: 403,
    });
  }

  ctx.locals.user = result.user;
  return next();
});
