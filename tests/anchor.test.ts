import { describe, expect, it } from 'vitest';
import { parseAnchorAttrs, REVIEW_ANCHOR_ATTR } from '~/lib/client/anchor';

describe('parseAnchorAttrs (the reviewer-anchors meta)', () => {
  it('has only Reviewer’s own attribute when the page declares none', () => {
    expect(parseAnchorAttrs(null)).toEqual([REVIEW_ANCHOR_ATTR]);
    expect(parseAnchorAttrs(undefined)).toEqual(['data-review-anchor']);
    expect(parseAnchorAttrs('')).toEqual(['data-review-anchor']);
    expect(parseAnchorAttrs('  , ,  ')).toEqual(['data-review-anchor']);
  });

  it('keeps the page’s order and puts data-review-anchor last', () => {
    expect(parseAnchorAttrs('data-poc-anchor data-foo')).toEqual(['data-poc-anchor', 'data-foo', 'data-review-anchor']);
    expect(parseAnchorAttrs('data-foo data-poc-anchor')).toEqual(['data-foo', 'data-poc-anchor', 'data-review-anchor']);
  });

  it('accepts spaces, commas, tabs and new lines as separators', () => {
    expect(parseAnchorAttrs(' data-a,data-b ,\tdata-c\n data-d ')).toEqual(['data-a', 'data-b', 'data-c', 'data-d', 'data-review-anchor']);
  });

  it('ignores anything that is not a data-[a-z0-9-]+ name', () => {
    expect(parseAnchorAttrs('id class aria-label data- data-foo_bar data-x"] data-ok data-2 [data-y] data-é')).toEqual([
      'data-ok',
      'data-2',
      'data-review-anchor',
    ]);
  });

  it('lower-cases names, since HTML attribute names are case-insensitive', () => {
    expect(parseAnchorAttrs('Data-Foo DATA-BAR')).toEqual(['data-foo', 'data-bar', 'data-review-anchor']);
  });

  it('drops duplicates, keeping the first place – also for data-review-anchor named by the page', () => {
    expect(parseAnchorAttrs('data-a data-b data-a')).toEqual(['data-a', 'data-b', 'data-review-anchor']);
    expect(parseAnchorAttrs('data-review-anchor data-a')).toEqual(['data-review-anchor', 'data-a']);
  });
});
