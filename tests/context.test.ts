import { describe, expect, it } from 'vitest';
import { MAX_CONTEXT_BYTES, MAX_LAYER_NAME_CHARS, MAX_OPENERS, parseContext, serializeContext } from '~/lib/context';
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

  it('keeps the dialog a comment was written in, alone or with the page context', () => {
    const opener = { selector: '#start', xpath: '/html/body/button[1]', textSnippet: 'Start', tagName: 'button' };
    expect(parseContext(serializeContext({ layer: { name: 'Start analysis', openers: [opener] } }))).toEqual({
      layer: { name: 'Start analysis', openers: [opener] },
    });
    const json = serializeContext({ label: 'Step 1', state: { a: 1 }, layer: { openers: [{ selector: '#x' }] } })!;
    expect(parseContext(json)).toEqual({
      label: 'Step 1',
      state: { a: 1 },
      layer: { openers: [{ selector: '#x', xpath: null, textSnippet: null, tagName: null }] },
    });
  });

  it('limits the dialog name and the number of openers', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ selector: `#b${i}` }));
    const ctx = parseContext(serializeContext({ layer: { name: 'x'.repeat(500), openers: many } }))!;
    expect(ctx.layer!.name).toHaveLength(MAX_LAYER_NAME_CHARS);
    expect(ctx.layer!.openers).toHaveLength(MAX_OPENERS);
  });

  it('rejects a malformed dialog', () => {
    expect(() => serializeContext({ layer: 'x' })).toThrow(HttpError);
    expect(() => serializeContext({ layer: { name: 5 } })).toThrow(HttpError);
    expect(() => serializeContext({ layer: { openers: {} } })).toThrow(HttpError);
    expect(() => serializeContext({ layer: { openers: [1] } })).toThrow(HttpError);
    expect(() => serializeContext({ layer: { openers: [{ selector: 5 }] } })).toThrow(HttpError);
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
