import { stringify } from 'csv-stringify/sync';
import { COMMENT_STATUSES, type CommentDto, type CommentStatus } from './comments';
import type { Project } from './db/schema';
import { HttpError } from './http';

export type ExportFormat = 'csv' | 'md' | 'json';

/** What the export was narrowed to, so the file can say what it does not contain. */
export interface ExportScope {
  statuses: readonly CommentStatus[];
  /** Counts of every status in the exported path, filtered or not. */
  totals: Record<CommentStatus, number>;
}

/**
 * `?status=` parser. Fails narrow on purpose: an unknown token is a 400, and anything that parses
 * to nothing (absent, empty) means `approved` – never "no filter", which would hand rejected and open
 * items over as agreed work.
 */
export function parseStatusFilter(raw: string | null): CommentStatus[] {
  const tokens = (raw ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return ['approved'];
  if (tokens.includes('all')) {
    if (tokens.length > 1) throw new HttpError(400, 'status=all cannot be combined with other values');
    return [...COMMENT_STATUSES];
  }
  const out: CommentStatus[] = [];
  for (const t of tokens) {
    if (!(COMMENT_STATUSES as readonly string[]).includes(t)) throw new HttpError(400, `Unknown status "${t}" – use open, approved, rejected or all`);
    if (!out.includes(t as CommentStatus)) out.push(t as CommentStatus);
  }
  return out;
}

const who = (u: { name: string | null; email: string } | null | undefined) => (u ? (u.name ?? u.email) : '');

export function exportComments(
  project: Project,
  comments: CommentDto[],
  format: ExportFormat,
  scope?: ExportScope,
): { body: string; contentType: string; filename: string } {
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
            status: c.status,
            status_at: c.statusAt ?? '',
            status_by: who(c.statusBy),
            replies: c.replies.length,
            replies_text: c.replies.map((r) => `${r.author.name ?? r.author.email}: ${r.body}`).join('\n\n'),
          })),
          { header: true, bom: true },
        ),
        contentType: 'text/csv; charset=utf-8',
        filename: `reviewer-${slug}-${stamp}.csv`,
      };
    case 'md':
      return { body: toMarkdown(project, comments, scope), contentType: 'text/markdown; charset=utf-8', filename: `reviewer-${slug}-${stamp}.md` };
    case 'json':
      return {
        body: JSON.stringify(
          {
            project: { id: project.id, name: project.name, baseUrl: project.baseUrl },
            exportedAt: new Date().toISOString(),
            ...(scope ? { filter: { statuses: scope.statuses, totals: scope.totals } } : {}),
            comments,
          },
          null,
          2,
        ),
        contentType: 'application/json; charset=utf-8',
        filename: `reviewer-${slug}-${stamp}.json`,
      };
  }
}

const STATUS_MARK: Record<CommentStatus, string> = { open: '●', approved: '✓', rejected: '✕' };

/**
 * The header always names the filter and what it excluded, so an empty file explains itself:
 *   Comments: 12 approved (filter: approved – 40 open and 3 rejected not included)
 */
function headerLine(comments: CommentDto[], scope?: ExportScope): string {
  const inList = (s: CommentStatus) => comments.filter((c) => c.status === s).length;
  if (!scope) {
    return `Comments: ${comments.length} (${COMMENT_STATUSES.map((s) => `${inList(s)} ${s}`).join(', ')})`;
  }
  const included = scope.statuses.map((s) => `${inList(s)} ${s}`).join(', ');
  const excluded = COMMENT_STATUSES.filter((s) => !scope.statuses.includes(s)).map((s) => `${scope.totals[s]} ${s}`);
  const filter = scope.statuses.length === COMMENT_STATUSES.length ? 'all' : scope.statuses.join(', ');
  const tail = excluded.length ? ` – ${joinAnd(excluded)} not included` : '';
  return scope.statuses.length > 1
    ? `Comments: ${comments.length} (${included}; filter: ${filter}${tail})`
    : `Comments: ${comments.length} ${scope.statuses[0]} (filter: ${filter}${tail})`;
}

function joinAnd(parts: string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function toMarkdown(project: Project, comments: CommentDto[], scope?: ExportScope): string {
  const byPage = new Map<string, CommentDto[]>();
  for (const c of comments) {
    const list = byPage.get(c.pagePath) ?? [];
    list.push(c);
    byPage.set(c.pagePath, list);
  }
  const lines: string[] = [`# ${project.name} – review comments`, '', `Site: ${project.baseUrl}  `, headerLine(comments, scope), ''];
  for (const [path, list] of [...byPage.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${path}`, '', `<${project.baseUrl}${path}>`, '');
    for (const c of list) {
      const el = c.tagName ? `\`<${c.tagName}>\`` : '';
      const view = c.viewport === 'phone' ? ' _(iPhone 15)_' : '';
      const snippet = c.textSnippet ? ` “${truncate(c.textSnippet, 60)}”` : '';
      const body = c.body.replace(/\r?\n/g, '\n  ');
      const verdict =
        c.status === 'open'
          ? ''
          : ` ${STATUS_MARK[c.status]} _${c.status} by ${who(c.statusBy) || 'unknown'}${c.statusAt ? ` on ${formatDate(c.statusAt)}` : ''}_`;
      lines.push(`- **${c.author.name ?? c.author.email}** (${formatDate(c.createdAt)})${view}${verdict} – ${el}${snippet} – ${body}`);
      for (const r of c.replies) {
        lines.push(`  - ↳ **${r.author.name ?? r.author.email}** (${formatDate(r.createdAt)}) – ${r.body.replace(/\r?\n/g, '\n    ')}`);
      }
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
