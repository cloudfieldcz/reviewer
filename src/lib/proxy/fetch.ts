import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from 'undici';

export const PROXY_TIMEOUT_MS = 10_000;
export const PROXY_MAX_BYTES = 10 * 1024 * 1024;

const agent = new Agent({
  connect: { timeout: PROXY_TIMEOUT_MS },
  headersTimeout: PROXY_TIMEOUT_MS,
  bodyTimeout: PROXY_TIMEOUT_MS,
});

const USER_AGENT = 'Mozilla/5.0 (compatible; Reviewer/0.1; +https://github.com/cloudfieldcz/reviewer)';

export interface FetchTargetOptions {
  redirect?: 'manual' | 'follow';
  accept?: string | null;
  acceptLanguage?: string | null;
}

/** Fetches a target URL with a fixed UA, timeout and no cookies. */
export async function fetchTarget(url: string, opts: FetchTargetOptions = {}): Promise<UndiciResponse> {
  const headers: Record<string, string> = {
    'user-agent': USER_AGENT,
    accept: opts.accept || 'text/html,application/xhtml+xml,*/*;q=0.8',
    'accept-encoding': 'gzip, deflate, br',
  };
  if (opts.acceptLanguage) headers['accept-language'] = opts.acceptLanguage;
  return undiciFetch(url, {
    method: 'GET',
    headers,
    redirect: opts.redirect ?? 'manual',
    dispatcher: agent,
    signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
  });
}

/** Reads a body fully, throwing when it exceeds the configured cap. */
export async function readBodyLimited(res: UndiciResponse, max = PROXY_MAX_BYTES): Promise<Buffer> {
  const len = Number(res.headers.get('content-length'));
  if (len && len > max) throw new Error(`Response too large (${len} bytes)`);
  if (!res.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > max) throw new Error(`Response too large (> ${max} bytes)`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
