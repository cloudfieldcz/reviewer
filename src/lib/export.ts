import { stringify } from 'csv-stringify/sync';
import type { CommentDto } from './comments';
import type { Project } from './db/schema';

export type ExportFormat = 'csv' | 'md' | 'json';

export function exportComments(project: Project, comments: CommentDto[], format: ExportFormat): { body: string; contentType: string; filename: string } {
  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'projekt';
  const stamp = new Date().toISOString().slice(0, 10);
  switch (format) {
    case 'csv':
      return {
        body: stringify(
          comments.map((c) => ({
            id: c.id,
            created_at: c.createdAt,
            author_name: c.author.name ?? '',
            author_email: c.author.email,
            page_path: c.pagePath,
            viewport: c.viewport,
            tag_name: c.tagName ?? '',
            text_snippet: c.textSnippet ?? '',
            selector: c.selector ?? '',
            body: c.body,
          })),
          { header: true, bom: true },
        ),
        contentType: 'text/csv; charset=utf-8',
        filename: `reviewer-${slug}-${stamp}.csv`,
      };
    case 'md':
      return { body: toMarkdown(project, comments), contentType: 'text/markdown; charset=utf-8', filename: `reviewer-${slug}-${stamp}.md` };
    case 'json':
      return {
        body: JSON.stringify({ project: { id: project.id, name: project.name, baseUrl: project.baseUrl }, exportedAt: new Date().toISOString(), comments }, null, 2),
        contentType: 'application/json; charset=utf-8',
        filename: `reviewer-${slug}-${stamp}.json`,
      };
  }
}

export function toMarkdown(project: Project, comments: CommentDto[]): string {
  const byPage = new Map<string, CommentDto[]>();
  for (const c of comments) {
    const list = byPage.get(c.pagePath) ?? [];
    list.push(c);
    byPage.set(c.pagePath, list);
  }
  const lines: string[] = [`# ${project.name} – review comments`, '', `Site: ${project.baseUrl}  `, `Comments: ${comments.length}`, ''];
  for (const [path, list] of [...byPage.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${path}`, '', `<${project.baseUrl}${path}>`, '');
    for (const c of list) {
      const el = c.tagName ? `\`<${c.tagName}>\`` : '';
      const view = c.viewport === 'phone' ? ' _(iPhone 15)_' : '';
      const snippet = c.textSnippet ? ` “${truncate(c.textSnippet, 60)}”` : '';
      const body = c.body.replace(/\r?\n/g, '\n  ');
      lines.push(`- **${c.author.name ?? c.author.email}** (${formatDate(c.createdAt)})${view} – ${el}${snippet} – ${body}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function formatDate(sqlite: string): string {
  // stored as 'YYYY-MM-DD HH:MM:SS' UTC
  const d = new Date(sqlite.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? sqlite : d.toLocaleString('en-GB', { timeZone: 'Europe/Prague' });
}
