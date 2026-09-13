import * as cheerio from 'cheerio';
import { injectScript } from './inject';

export interface RewriteContext {
  /** Registered project base URL, normalized, no trailing slash. e.g. https://test.example.com or https://host/sub */
  baseUrl: string;
  projectId: number;
  /** Full URL of the page that was fetched (used to resolve relative links). */
  pageUrl: string;
  /** Public origin of Reviewer itself, e.g. https://reviewer.example.com – used for absolute rewritten links. */
  publicOrigin: string;
}

/** Headers that must never reach the browser from the proxied site. */
export const STRIPPED_RESPONSE_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'set-cookie',
  'set-cookie2',
  'strict-transport-security',
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'alt-svc',
  'report-to',
  'nel',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
]);

/**
 * Maps a target-site URL to its `/p/{id}/...` counterpart.
 * Returns null when the URL is outside the project's base URL (external link).
 */
export function toProxyPath(href: string, ctx: Pick<RewriteContext, 'baseUrl' | 'projectId' | 'pageUrl'>): string | null {
  let url: URL;
  try {
    url = new URL(href, ctx.pageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const base = new URL(ctx.baseUrl);
  if (url.host !== base.host) return null;
  const basePath = base.pathname.replace(/\/$/, '');
  if (basePath && url.pathname !== basePath && !url.pathname.startsWith(basePath + '/')) return null;
  const rest = url.pathname.slice(basePath.length) || '/';
  return `/p/${ctx.projectId}${rest}${url.search}${url.hash}`;
}

/** Maps a `/p/{id}/path?query` request to the target URL. */
export function toTargetUrl(baseUrl: string, pathAndQuery: string): string {
  const path = pathAndQuery.startsWith('/') ? pathAndQuery : '/' + pathAndQuery;
  return baseUrl + path;
}

/** Strips the `/p/{id}` prefix: `/p/3/contact?x=1` → `/contact?x=1`. */
export function stripProxyPrefix(pathAndQuery: string): string {
  return pathAndQuery.replace(/^\/p\/\d+(?=\/|\?|$)/, '') || '/';
}

const URL_ATTRS: Array<[selector: string, attr: string]> = [
  ['a[href]', 'href'],
  ['area[href]', 'href'],
  ['form[action]', 'action'],
];

export function rewriteHtml(html: string, ctx: RewriteContext): string {
  const $ = cheerio.load(html, { xml: false });

  // 1. CSP meta tags away, base pointing at the original page so assets load from the origin.
  $('meta[http-equiv]').each((_, el) => {
    const v = ($(el).attr('http-equiv') ?? '').toLowerCase();
    if (v === 'content-security-policy' || v === 'x-frame-options') $(el).remove();
    if (v === 'refresh') {
      const content = $(el).attr('content') ?? '';
      const m = content.match(/url\s*=\s*['"]?([^'";]+)/i);
      if (m) {
        const p = toProxyPath(m[1]!, ctx);
        if (p) $(el).attr('content', content.replace(m[1]!, ctx.publicOrigin + p));
      }
    }
  });
  $('base').remove();
  let head = $('head');
  if (head.length === 0) {
    $('html').prepend('<head></head>');
    head = $('head');
  }
  head.prepend(`<base href="${escapeAttr(ctx.pageUrl)}">`);

  // 2. Links & forms: internal → absolute Reviewer proxy URL, external → new tab.
  for (const [selector, attr] of URL_ATTRS) {
    $(selector).each((_, el) => {
      const $el = $(el);
      const raw = $el.attr(attr);
      if (!raw) return;
      const trimmed = raw.trim();
      if (trimmed.startsWith('#') || /^(javascript|mailto|tel|sms|data):/i.test(trimmed)) return;
      const proxied = toProxyPath(trimmed, ctx);
      if (proxied) {
        $el.attr(attr, ctx.publicOrigin + proxied);
        const target = ($el.attr('target') ?? '').toLowerCase();
        if (target === '_top' || target === '_parent') $el.removeAttr('target');
      } else if (attr === 'href' && isHttpUrl(trimmed, ctx.pageUrl)) {
        $el.attr('target', '_blank');
        $el.attr('rel', 'noopener noreferrer');
      }
    });
  }

  // 3. Frame busting / navigation escape hatches are handled by the injected script.
  const script = `<script data-reviewer-inject>${injectScript(ctx)}</script>`;
  const body = $('body');
  if (body.length) body.append(script);
  else $.root().append(script);

  return $.html();
}

function isHttpUrl(href: string, base: string): boolean {
  try {
    return /^https?:$/.test(new URL(href, base).protocol);
  } catch {
    return false;
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
