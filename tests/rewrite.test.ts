import { describe, expect, it } from 'vitest';
import { rewriteHtml, stripProxyPrefix, toProxyPath, toTargetUrl } from '~/lib/proxy/rewrite';

const ctx = {
  baseUrl: 'https://test.example.com',
  projectId: 7,
  pageUrl: 'https://test.example.com/blog/post/',
  publicOrigin: 'https://reviewer.example.com',
};

describe('toProxyPath', () => {
  it('maps absolute internal URLs', () => {
    expect(toProxyPath('https://test.example.com/contact?x=1#top', ctx)).toBe('/p/7/contact?x=1#top');
  });
  it('maps relative URLs against the page URL', () => {
    expect(toProxyPath('../other', ctx)).toBe('/p/7/blog/other');
    expect(toProxyPath('/about', ctx)).toBe('/p/7/about');
    expect(toProxyPath('?page=2', ctx)).toBe('/p/7/blog/post/?page=2');
  });
  it('returns null for external hosts and non-http schemes', () => {
    expect(toProxyPath('https://google.com/', ctx)).toBeNull();
    expect(toProxyPath('mailto:a@b.cz', ctx)).toBeNull();
    expect(toProxyPath('//cdn.example.com/x.js', ctx)).toBeNull();
  });
  it('respects a base URL with a path prefix', () => {
    const sub = { ...ctx, baseUrl: 'https://host.cz/app', pageUrl: 'https://host.cz/app/' };
    expect(toProxyPath('/app/x', sub)).toBe('/p/7/x');
    expect(toProxyPath('/app', sub)).toBe('/p/7/');
    expect(toProxyPath('/other', sub)).toBeNull();
    expect(toProxyPath('/application', sub)).toBeNull();
  });
});

describe('toTargetUrl / stripProxyPrefix', () => {
  it('round-trips', () => {
    expect(toTargetUrl('https://test.example.com', '/contact?x=1')).toBe('https://test.example.com/contact?x=1');
    expect(stripProxyPrefix('/p/7/contact?x=1')).toBe('/contact?x=1');
    expect(stripProxyPrefix('/p/7')).toBe('/');
    expect(stripProxyPrefix('/p/7/')).toBe('/');
    expect(stripProxyPrefix('/p/70/x')).toBe('/x');
  });
});

describe('rewriteHtml', () => {
  const html = `<!doctype html><html><head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'">
    <base href="https://elsewhere.example/">
    <link rel="stylesheet" href="/styles.css">
    <title>Test</title></head>
    <body>
      <a id="rel" href="../about">About</a>
      <a id="abs" href="https://test.example.com/contact" target="_top">Contact</a>
      <a id="ext" href="https://github.com/x">GitHub</a>
      <a id="hash" href="#section">Section</a>
      <a id="mail" href="mailto:a@b.cz">Mail</a>
      <form action="/search" method="get"><input name="q"></form>
      <img src="img/pic.png">
    </body></html>`;
  const out = rewriteHtml(html, ctx);

  it('removes CSP meta and the original <base>, adds base pointing at the page', () => {
    expect(out).not.toContain('Content-Security-Policy');
    expect(out).not.toContain('elsewhere.example');
    expect(out).toContain('<base href="https://test.example.com/blog/post/">');
    // base must be the first child of <head>
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<meta charset'));
  });
  it('rewrites internal links to absolute proxy URLs and drops target=_top', () => {
    expect(out).toContain('<a id="rel" href="https://reviewer.example.com/p/7/blog/about">');
    expect(out).toContain('<a id="abs" href="https://reviewer.example.com/p/7/contact">');
    expect(out).toContain('<form action="https://reviewer.example.com/p/7/search" method="get">');
  });
  it('opens external links in a new tab and leaves hash/mailto untouched', () => {
    expect(out).toMatch(/<a id="ext" href="https:\/\/github.com\/x" target="_blank" rel="noopener noreferrer">/);
    expect(out).toContain('<a id="hash" href="#section">');
    expect(out).toContain('<a id="mail" href="mailto:a@b.cz">');
  });
  it('leaves asset URLs alone (resolved via <base>) and injects the script', () => {
    expect(out).toContain('<img src="img/pic.png">');
    expect(out).toContain('<link rel="stylesheet" href="/styles.css">');
    expect(out).toMatch(/<script data-reviewer-inject(="")?>/);
    expect(out).toContain('"projectId":7');
    expect(out.lastIndexOf('</script>')).toBeLessThan(out.lastIndexOf('</body>'));
  });
  it('survives documents without head/body', () => {
    const min = rewriteHtml('<p>hi</p><a href="/x">x</a>', ctx);
    expect(min).toContain('<base href=');
    expect(min).toContain('/p/7/x');
    expect(min).toContain('data-reviewer-inject');
  });
  it('rewrites meta refresh targets', () => {
    const r = rewriteHtml('<html><head><meta http-equiv="refresh" content="0; url=/new"></head><body></body></html>', ctx);
    expect(r).toContain('content="0; url=https://reviewer.example.com/p/7/new"');
  });
});
