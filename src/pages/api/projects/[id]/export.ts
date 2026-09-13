import type { APIRoute } from 'astro';
import { listComments, normalizePagePath } from '~/lib/comments';
import { exportComments, type ExportFormat } from '~/lib/export';
import { handler, HttpError, idParam, requireAdmin } from '~/lib/http';
import { getProject } from '~/lib/projects';

export const GET: APIRoute = handler((ctx) => {
  requireAdmin(ctx);
  const project = getProject(idParam(ctx.params.id));
  const format = (ctx.url.searchParams.get('format') ?? 'md') as ExportFormat;
  if (!['csv', 'md', 'json'].includes(format)) throw new HttpError(400, 'format must be csv|md|json');
  const rawPath = ctx.url.searchParams.get('path');
  const path = rawPath ? normalizePagePath(rawPath) : undefined;
  const { body, contentType, filename } = exportComments(project, listComments(project.id, path, ctx.locals.user), format);
  const disposition = ctx.url.searchParams.get('download') === '0' ? 'inline' : `attachment; filename="${filename}"`;
  return new Response(body, { headers: { 'content-type': contentType, 'content-disposition': disposition } });
});
