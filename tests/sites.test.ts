import { describe, expect, it } from 'vitest';
import { HttpError } from '~/lib/http';
import { injectStaticHtml, mimeFor, resolveInside, sanitizeUploadPath } from '~/lib/sites';

describe('sanitizeUploadPath', () => {
  it('drops the picked folder name', () => {
    expect(sanitizeUploadPath('dist/index.html')).toBe('index.html');
    expect(sanitizeUploadPath('dist/assets/app.js')).toBe('assets/app.js');
  });

  it.each(['/etc/passwd', 'dist/../../x', 'dist/a/../b', '../x', 'dist\\a.js', 'dist//a.js', 'dist/./a.js', 'dist/a/', '', 'dist/a\0.js'])(
    'rejects %j',
    (p) => {
      expect(() => sanitizeUploadPath(p)).toThrow(HttpError);
    },
  );

  it('rejects a file outside any folder', () => {
    expect(() => sanitizeUploadPath('index.html')).toThrow(HttpError);
  });

  it('skips .DS_Store silently', () => {
    expect(sanitizeUploadPath('dist/assets/.DS_Store')).toBeNull();
  });
});

describe('resolveInside', () => {
  it('stays inside the folder', () => {
    expect(resolveInside('/data/sites/1', 'assets/app.js')).toBe('/data/sites/1/assets/app.js');
    expect(resolveInside('/data/sites/1', '')).toBe('/data/sites/1');
    expect(resolveInside('/data/sites/1', '../2/index.html')).toBeNull();
    expect(resolveInside('/data/sites/1', '../1-evil/x')).toBeNull();
    expect(resolveInside('/data/sites/1', 'a\0b')).toBeNull();
  });
});

describe('mimeFor', () => {
  it('maps known extensions and falls back to octet-stream', () => {
    expect(mimeFor('a/b.JS')).toContain('text/javascript');
    expect(mimeFor('x.woff2')).toBe('font/woff2');
    expect(mimeFor('x.bin')).toBe('application/octet-stream');
  });
});

describe('injectStaticHtml', () => {
  const out = injectStaticHtml('<!doctype html><html><head><base href="/old/"><title>T</title></head><body><div id="root"></div></body></html>', 7);

  it('puts <base> first in <head> and removes the old one', () => {
    expect(out).toMatch(/<head><base href="\/p\/7\/">/);
    expect(out.match(/<base /g)).toHaveLength(1);
    expect(out).not.toContain('/old/');
  });

  it('adds a <head> when the page has none', () => {
    expect(injectStaticHtml('<p>hi</p>', 3)).toContain('<base href="/p/3/">');
  });

  it('appends the reduced script without click, form or fragment interception', () => {
    expect(out).toContain("data-reviewer");
    expect(out).toContain('reviewer:navigate');
    expect(out).not.toContain("'click'");
    expect(out).not.toContain("'submit'");
    expect(out).not.toContain('location.hash=');
  });
});
