import type { APIRoute } from 'astro';
import { createComment, listComments, normalizePagePath, normalizeViewport } from '~/lib/comments';
import { handler, HttpError, json, readJson, str } from '~/lib/http';

export const GET: APIRoute = handler((ctx) => {
  const project = Number(ctx.url.searchParams.get('project'));
  if (!Number.isInteger(project) || project <= 0) throw new HttpError(400, 'project is required');
  const rawPath = ctx.url.searchParams.get('path');
  const path = rawPath == null ? undefined : normalizePagePath(rawPath);
  return json(listComments(project, { pagePath: path }, ctx.locals.user));
});

export const POST: APIRoute = handler(async (ctx) => {
  const b = await readJson(ctx.request);
  const projectId = Number(b.project_id ?? b.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) throw new HttpError(400, 'project_id is required');
  const rectTop = Number(b.rect_top ?? b.rectTop);
  const comment = createComment(
    {
      projectId,
      pagePath: normalizePagePath(b.page_path ?? b.pagePath),
      viewport: normalizeViewport(b.viewport),
      body: str(b.body) ?? '',
      selector: str(b.selector, 2000),
      xpath: str(b.xpath, 2000),
      textSnippet: str(b.text_snippet ?? b.textSnippet, 200),
      tagName: str(b.tag_name ?? b.tagName, 50)?.toLowerCase(),
      rectTop: Number.isFinite(rectTop) ? rectTop : null,
    },
    ctx.locals.user,
  );
  return json(comment, { status: 201 });
});
