import type { Project } from '../db/schema';
import { fetchTarget, readBodyLimited } from './fetch';
import { rewriteHtml, STRIPPED_RESPONSE_HEADERS, toProxyPath, toTargetUrl } from './rewrite';

/** Origin under which Reviewer is reachable by the browser (for absolute rewritten links). */
export function publicOrigin(request: Request): string {
  const env = process.env.PUBLIC_ORIGIN?.trim();
  if (env) return env.replace(/\/$/, '');
  const h = request.headers;
  const proto = h.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? new URL(request.url).host;
  return `${proto}://${host}`;
}

export interface ProxyRequest {
  project: Project;
  /** `/contact?x=1` – path + query relative to the project base URL */
  pathAndQuery: string;
  request: Request;
}

const ALWAYS_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex',
};

export async function proxyRequest({ project, pathAndQuery, request }: ProxyRequest): Promise<Response> {
  const target = toTargetUrl(project.baseUrl, pathAndQuery);
  const origin = publicOrigin(request);

  let upstream;
  try {
    upstream = await fetchTarget(target, {
      accept: request.headers.get('accept'),
      acceptLanguage: request.headers.get('accept-language'),
    });
  } catch (e) {
    return errorPage(502, `Target site did not respond: ${(e as Error).message}`, target);
  }

  const ctx = { baseUrl: project.baseUrl, projectId: project.id, pageUrl: target, publicOrigin: origin };

  // 3xx: keep the user inside the proxy when the redirect stays on the target site.
  if (upstream.status >= 300 && upstream.status < 400) {
    const loc = upstream.headers.get('location');
    const headers = new Headers(ALWAYS_HEADERS);
    if (loc) {
      const proxied = toProxyPath(loc, ctx);
      headers.set('location', proxied ? origin + proxied : new URL(loc, target).href);
    }
    return new Response(null, { status: upstream.status, headers });
  }

  const contentType = upstream.headers.get('content-type') ?? '';
  const headers = new Headers(ALWAYS_HEADERS);
  for (const [k, v] of upstream.headers) {
    if (!STRIPPED_RESPONSE_HEADERS.has(k.toLowerCase())) headers.set(k, v);
  }

  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    // Non-HTML (fallback – assets normally load straight from the origin thanks to <base>).
    return new Response(upstream.body as unknown as ReadableStream | null, { status: upstream.status, headers });
  }

  let body: Buffer;
  try {
    body = await readBodyLimited(upstream);
  } catch (e) {
    return errorPage(502, (e as Error).message, target);
  }
  const html = rewriteHtml(decodeHtml(body, contentType), ctx);
  headers.set('content-type', 'text/html; charset=utf-8');
  return new Response(html, { status: upstream.status, headers });
}

function decodeHtml(buf: Buffer, contentType: string): string {
  const m = contentType.match(/charset=([^;]+)/i);
  let charset = (m?.[1] ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (!charset) {
    const head = buf.subarray(0, 2048).toString('latin1');
    charset = head.match(/<meta[^>]+charset=["']?\s*([\w-]+)/i)?.[1]?.toLowerCase() ?? 'utf-8';
  }
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

function errorPage(status: number, message: string, target: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Reviewer – proxy error</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:3rem;color:#333;background:#fafafa}code{background:#eee;padding:.1em .3em;border-radius:3px}</style></head>
<body><h1 style="font-size:1.25rem">The page could not be loaded</h1><p>${escapeHtml(message)}</p><p>Target: <code>${escapeHtml(target)}</code></p></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...ALWAYS_HEADERS } });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
