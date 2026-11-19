import { describe, expect, it } from 'vitest';
import { MAX_CONTEXT_BYTES, parseContext, serializeContext } from '~/lib/context';
import { HttpError } from '~/lib/http';

describe('serializeContext', () => {
  it('stores nothing for an absent or empty context', () => {
    expect(serializeContext(undefined)).toBeNull();
    expect(serializeContext(null)).toBeNull();
    expect(serializeContext({})).toBeNull();
  });

  it('keeps label and any JSON state', () => {
    const json = serializeContext({ label: 'Step 3', state: { run: 2, nested: [1, { a: null }] } })!;
    expect(parseContext(json)).toEqual({ label: 'Step 3', state: { run: 2, nested: [1, { a: null }] } });
  });

  it('rejects the wrong shapes', () => {
    expect(() => serializeContext('x')).toThrow(HttpError);
    expect(() => serializeContext([1])).toThrow(HttpError);
    expect(() => serializeContext({ label: 5 })).toThrow(HttpError);
  });

  it('truncates the label to 300 characters', () => {
    expect(parseContext(serializeContext({ label: 'x'.repeat(500) }))!.label).toHaveLength(300);
  });

  it('drops an oversized state but keeps the label', () => {
    const json = serializeContext({ label: 'Step 3', state: 'x'.repeat(MAX_CONTEXT_BYTES + 1) })!;
    expect(parseContext(json)).toEqual({ label: 'Step 3' });
  });

  it('stores nothing when an oversized state had no label', () => {
    expect(serializeContext({ state: 'x'.repeat(MAX_CONTEXT_BYTES + 1) })).toBeNull();
  });
});

describe('parseContext', () => {
  it('survives garbage', () => {
    expect(parseContext(null)).toBeNull();
    expect(parseContext('not json')).toBeNull();
    expect(parseContext('3')).toBeNull();
  });
});
