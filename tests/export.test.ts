import { describe, expect, it } from 'vitest';
import type { CommentDto } from '~/lib/comments';
import type { Project } from '~/lib/db/schema';
import { exportComments, parseStatusFilter, toMarkdown } from '~/lib/export';

const project = { id: 1, name: 'Site', baseUrl: 'https://site.example.com', createdBy: 1, createdAt: '2026-01-01 00:00:00' } as Project;

const anna = { id: 1, name: 'Anna', email: 'anna@example.com' };
const bob = { id: 2, name: 'Bob', email: 'bob@example.com' };

function comment(over: Partial<CommentDto> = {}): CommentDto {
  return {
    id: 1,
    projectId: 1,
    pagePath: '/',
    viewport: 'desktop',
    body: 'the heading is wrong',
    selector: null,
    xpath: null,
    textSnippet: null,
    tagName: 'h1',
    rectTop: 0,
    createdAt: '2026-03-01 10:00:00',
    updatedAt: '2026-03-01 10:00:00',
    author: anna,
    mine: false,
    status: 'open',
    statusAt: null,
    statusBy: null,
    replies: [],
    ...over,
  };
}

describe('parseStatusFilter', () => {
  it('defaults to approved only when absent or empty – never to everything', () => {
    expect(parseStatusFilter(null)).toEqual(['approved']);
    expect(parseStatusFilter('')).toEqual(['approved']);
    expect(parseStatusFilter(' , ')).toEqual(['approved']);
  });

  it('accepts a comma list and dedupes it', () => {
    expect(parseStatusFilter('approved,rejected')).toEqual(['approved', 'rejected']);
    expect(parseStatusFilter('open, open ,approved')).toEqual(['open', 'approved']);
  });

  it('expands all to the three statuses', () => {
    expect(parseStatusFilter('all')).toEqual(['open', 'approved', 'rejected']);
  });

  it('rejects unknown tokens with 400 instead of dropping the filter', () => {
    expect(() => parseStatusFilter('garbage')).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => parseStatusFilter('approved,resolved')).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => parseStatusFilter('all,open')).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('markdown export', () => {
  it('nests replies under their comment', () => {
    const md = toMarkdown(project, [
      comment({
        replies: [
          { id: 10, commentId: 1, body: 'fixed in staging', createdAt: '2026-03-01 11:00:00', updatedAt: '2026-03-01 11:00:00', author: bob, mine: false },
        ],
      }),
    ]);
    expect(md).toContain('- **Anna**');
    expect(md).toMatch(/\n {2}- ↳ \*\*Bob\*\*.*fixed in staging/);
  });

  it('marks the verdict with who and when, leaves open comments unmarked', () => {
    const md = toMarkdown(project, [
      comment({ id: 1, status: 'approved', statusAt: '2026-03-02 09:00:00', statusBy: bob }),
      comment({ id: 2, body: 'no thanks', status: 'rejected', statusAt: '2026-03-03 09:00:00', statusBy: bob }),
      comment({ id: 3, body: 'still open' }),
    ]);
    const line = (needle: string) => md.split('\n').find((l) => l.includes(needle))!;
    expect(line('the heading is wrong')).toMatch(/✓ _approved by Bob on 02\/03\/2026/);
    expect(line('no thanks')).toMatch(/✕ _rejected by Bob on 03\/03\/2026/);
    expect(line('still open')).not.toMatch(/✓|✕|_open/);
  });

  it('names the filter and what it excluded in the header', () => {
    const md = toMarkdown(project, [comment({ status: 'approved', statusAt: '2026-03-02 09:00:00', statusBy: bob })], {
      statuses: ['approved'],
      totals: { open: 40, approved: 1, rejected: 3 },
    });
    expect(md).toContain('Comments: 1 approved (filter: approved – 40 open and 3 rejected not included)');
  });

  it('explains an empty file', () => {
    const md = toMarkdown(project, [], { statuses: ['approved'], totals: { open: 2, approved: 0, rejected: 0 } });
    expect(md).toContain('Comments: 0 approved (filter: approved – 2 open and 0 rejected not included)');
  });

  it('breaks the count down when more than one status is included', () => {
    const md = toMarkdown(project, [comment({ id: 1, status: 'approved' }), comment({ id: 2, status: 'rejected' })], {
      statuses: ['approved', 'rejected'],
      totals: { open: 5, approved: 1, rejected: 1 },
    });
    expect(md).toContain('Comments: 2 (1 approved, 1 rejected; filter: approved, rejected – 5 open not included)');
  });

  it('says all when nothing was excluded', () => {
    const md = toMarkdown(project, [comment()], { statuses: ['open', 'approved', 'rejected'], totals: { open: 1, approved: 0, rejected: 0 } });
    expect(md).toContain('; filter: all)');
    expect(md).not.toContain('not included');
  });

  it('keeps a comment whose replies were all deleted rendering as a plain bullet', () => {
    const md = toMarkdown(project, [comment()]);
    expect(md).not.toContain('↳');
  });
});

describe('csv export', () => {
  it('carries status, status_at and status_by and no resolved_* columns', () => {
    const { body } = exportComments(project, [comment({ status: 'approved', statusAt: '2026-03-02 09:00:00', statusBy: bob })], 'csv');
    const [header, row] = body.replace(/^﻿/, '').trim().split('\n');
    expect(header).toContain('status,status_at,status_by');
    expect(header).not.toMatch(/resolved/);
    expect(row).toContain('approved,2026-03-02 09:00:00,Bob');
  });
});

describe('json export', () => {
  it('records the filter next to the comments', () => {
    const { body } = exportComments(project, [], 'json', { statuses: ['approved'], totals: { open: 1, approved: 0, rejected: 0 } });
    const parsed = JSON.parse(body);
    expect(parsed.filter).toEqual({ statuses: ['approved'], totals: { open: 1, approved: 0, rejected: 0 } });
    expect(parsed.comments).toEqual([]);
  });
});
