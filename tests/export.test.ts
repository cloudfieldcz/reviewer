import { describe, expect, it } from 'vitest';
import type { CommentDto } from '~/lib/comments';
import type { Project } from '~/lib/db/schema';
import { toMarkdown } from '~/lib/export';

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
    resolvedAt: null,
    resolvedBy: null,
    replies: [],
    ...over,
  };
}

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

  it('marks resolved comments and counts them in the header', () => {
    const md = toMarkdown(project, [
      comment({ id: 1, resolvedAt: '2026-03-02 09:00:00', resolvedBy: bob }),
      comment({ id: 2, body: 'still open' }),
    ]);
    expect(md).toContain('Comments: 2 (1 open, 1 resolved)');
    expect(md).toContain('✓ _resolved by Bob_');
    expect(md.split('\n').filter((l) => l.includes('still open'))[0]).not.toContain('✓');
  });

  it('keeps a comment whose replies were all deleted rendering as a plain bullet', () => {
    const md = toMarkdown(project, [comment()]);
    expect(md).not.toContain('↳');
  });
});
