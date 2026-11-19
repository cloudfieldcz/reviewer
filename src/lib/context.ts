import { HttpError } from './http';

/** What a page reports about its own state through `window.reviewerContext()`. */
export interface CommentContext {
  label?: string;
  state?: unknown;
}

export const MAX_LABEL_CHARS = 300;
export const MAX_CONTEXT_BYTES = 256 * 1024;

/**
 * Validates the `context` of a new comment and returns the JSON to store (null = nothing to store).
 * A state that would push the stored JSON over 256 KB is dropped and the label kept – the comment
 * itself must never be lost to an oversized state.
 */
export function serializeContext(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'context must be an object');
  const { label, state } = input as { label?: unknown; state?: unknown };
  if (label !== undefined && typeof label !== 'string') throw new HttpError(400, 'context.label must be a string');
  const ctx: CommentContext = {};
  if (label) ctx.label = label.slice(0, MAX_LABEL_CHARS);
  if (state !== undefined) ctx.state = state;
  if (ctx.label === undefined && ctx.state === undefined) return null;
  let json = JSON.stringify(ctx);
  if (Buffer.byteLength(json) > MAX_CONTEXT_BYTES) {
    delete ctx.state;
    if (ctx.label === undefined) return null;
    json = JSON.stringify(ctx);
  }
  return json;
}

export function parseContext(raw: string | null): CommentContext | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as CommentContext) : null;
  } catch {
    return null;
  }
}
