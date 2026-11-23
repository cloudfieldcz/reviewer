import type { APIRoute } from 'astro';
import { HttpError, idParam } from '~/lib/http';
import { getProject } from '~/lib/projects';
import { requestLocale } from '~/lib/i18n/server';
import { proxyRequest } from '~/lib/proxy/handler';
import { serveSite } from '~/lib/sites';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  let project;
  try {
    project = getProject(idParam(ctx.params.id));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return new Response(status === 404 ? 'Project not found' : 'Error', { status });
  }
  if (project.kind === 'static') {
    // `<base href="/p/{id}/">` only works with the trailing slash.
    if (ctx.url.pathname === `/p/${project.id}`) {
      return new Response(null, { status: 301, headers: { location: `/p/${project.id}/${ctx.url.search}` } });
    }
    return serveSite(project.id, ctx.params.path ?? '', requestLocale(ctx.request));
  }
  const pathAndQuery = '/' + (ctx.params.path ?? '') + ctx.url.search;
  return proxyRequest({ project, pathAndQuery, request: ctx.request });
};

// Everything else (POST forms etc.) is out of scope for the MVP proxy.
export const ALL: APIRoute = () => new Response('Method not allowed', { status: 405 });
