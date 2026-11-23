import type { APIRoute } from 'astro';
import { handler, HttpError, idParam, json, requireAdmin } from '~/lib/http';
import { getProject, markSiteUploaded } from '~/lib/projects';
import { installSite, MAX_SITE_BYTES, MAX_SITE_FILES, sanitizeUploadPath, type UploadFile } from '~/lib/sites';

export const POST: APIRoute = handler(async (ctx) => {
  requireAdmin(ctx);
  const project = getProject(idParam(ctx.params.id));
  if (project.kind !== 'static') throw new HttpError(400, 'Only uploaded-site projects take an upload');
  const declared = Number(ctx.request.headers.get('content-length'));
  if (declared > MAX_SITE_BYTES + 1024 * 1024) throw new HttpError(413, 'Upload is larger than 150 MB');

  let form: FormData;
  try {
    form = await ctx.request.formData();
  } catch {
    throw new HttpError(400, 'Expected multipart/form-data');
  }
  const entries = form.getAll('files').filter((f): f is File => typeof f !== 'string');
  if (entries.length === 0) throw new HttpError(400, 'No files');
  if (entries.length > MAX_SITE_FILES) throw new HttpError(400, `At most ${MAX_SITE_FILES} files`);

  const files: UploadFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const f of entries) {
    const path = sanitizeUploadPath(f.name);
    if (path === null) continue;
    total += f.size;
    if (total > MAX_SITE_BYTES) throw new HttpError(400, 'Upload is larger than 150 MB');
    if (seen.has(path)) throw new HttpError(400, `Duplicate file: ${path}`);
    seen.add(path);
    files.push({ path, data: Buffer.from(await f.arrayBuffer()) });
  }
  const count = await installSite(project.id, files);
  const row = markSiteUploaded(project.id);
  return json({ files: count, uploadedAt: row.siteUploadedAt });
});
