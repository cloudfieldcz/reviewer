import type { APIRoute } from 'astro';
import { countByStatus, listComments, normalizePagePath } from '~/lib/comments';
import { exportComments, parseStatusFilter, type ExportFormat } from '~/lib/export';
import { handler, HttpError, idParam, requireAdmin } from '~/lib/http';
import { getProject } from '~/lib/projects';

/** `?status=approved,rejected` or `status=all`; absent → approved only. Unknown values are a 400. */
export const GET: APIRoute = handler((ctx) => {
  requireAdmin(ctx);
  const project = getProject(idParam(ctx.params.id));
  const format = (ctx.url.searchParams.get('format') ?? 'md') as ExportFormat;
  if (!['csv', 'md', 'json'].includes(format)) throw new HttpError(400, 'format must be csv|md|json');
  const rawPath = ctx.url.searchParams.get('path');
  const path = rawPath ? normalizePagePath(rawPath) : undefined;
  const statuses = parseStatusFilter(ctx.url.searchParams.get('status'));
  const comments = listComments(project.id, { pagePath: path, statuses }, ctx.locals.user);
  const scope = { statuses, totals: countByStatus(project.id, path) };
  const { body, contentType, filename } = exportComments(project, comments, format, scope);
  const disposition = ctx.url.searchParams.get('download') === '0' ? 'inline' : `attachment; filename="${filename}"`;
  return new Response(body, { headers: { 'content-type': contentType, 'content-disposition': disposition } });
});
