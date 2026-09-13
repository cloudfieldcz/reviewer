import type { APIContext } from 'astro';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
  });

export const error = (status: number, message: string) => json({ error: message }, { status });

export function requireAdmin(ctx: APIContext) {
  if (ctx.locals.user.role !== 'admin') throw new HttpError(403, 'Admin role required');
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

export function idParam(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id');
  return id;
}

/** Wraps an API handler: HttpError → JSON error response, anything else → 500. */
export function handler(fn: (ctx: APIContext) => Promise<Response> | Response) {
  return async (ctx: APIContext): Promise<Response> => {
    try {
      return await fn(ctx);
    } catch (e) {
      if (e instanceof HttpError) return error(e.status, e.message);
      console.error(`[api] ${ctx.request.method} ${ctx.url.pathname}`, e);
      return error(500, 'Internal error');
    }
  };
}

export const str = (v: unknown, max = 10_000): string | undefined =>
  typeof v === 'string' ? v.slice(0, max) : undefined;
