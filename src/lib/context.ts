import { HttpError } from './http';

/** An element to click again, stored as the same anchors a comment uses. */
export interface OpenerAnchor {
  selector: string | null;
  xpath: string | null;
  textSnippet: string | null;
  tagName: string | null;
}

/** The dialog a comment was written in, and the clicks that opened it (outermost first). */
export interface CommentLayer {
  name?: string;
  openers: OpenerAnchor[];
}

/**
 * `label` and `state` are what a page reports about itself through `window.reviewerContext()`;
 * `layer` is added by the review screen when the element sits in a dialog.
 */
export interface CommentContext {
  label?: string;
  state?: unknown;
  layer?: CommentLayer;
}

export const MAX_LABEL_CHARS = 300;
export const MAX_CONTEXT_BYTES = 256 * 1024;
export const MAX_LAYER_NAME_CHARS = 120;
export const MAX_OPENERS = 5;
const MAX_ANCHOR_CHARS = 2000;

function anchorField(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== 'string') throw new HttpError(400, 'context.layer.openers must hold strings');
  return v.slice(0, MAX_ANCHOR_CHARS);
}

function parseLayer(input: unknown): CommentLayer | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'context.layer must be an object');
  const { name, openers } = input as { name?: unknown; openers?: unknown };
  if (name !== undefined && typeof name !== 'string') throw new HttpError(400, 'context.layer.name must be a string');
  if (openers !== undefined && !Array.isArray(openers)) throw new HttpError(400, 'context.layer.openers must be an array');
  const layer: CommentLayer = {
    openers: (openers ?? []).slice(0, MAX_OPENERS).map((o) => {
      if (!o || typeof o !== 'object') throw new HttpError(400, 'context.layer.openers must hold objects');
      const a = o as Record<string, unknown>;
      return { selector: anchorField(a.selector), xpath: anchorField(a.xpath), textSnippet: anchorField(a.textSnippet), tagName: anchorField(a.tagName) };
    }),
  };
  if (name) layer.name = name.slice(0, MAX_LAYER_NAME_CHARS);
  return layer;
}

/**
 * Validates the `context` of a new comment and returns the JSON to store (null = nothing to store).
 * A state that would push the stored JSON over 256 KB is dropped and the label kept – the comment
 * itself must never be lost to an oversized state.
 */
export function serializeContext(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'context must be an object');
  const { label, state, layer } = input as { label?: unknown; state?: unknown; layer?: unknown };
  if (label !== undefined && typeof label !== 'string') throw new HttpError(400, 'context.label must be a string');
  const ctx: CommentContext = {};
  if (label) ctx.label = label.slice(0, MAX_LABEL_CHARS);
  if (state !== undefined) ctx.state = state;
  const parsedLayer = parseLayer(layer);
  if (parsedLayer) ctx.layer = parsedLayer;
  if (ctx.label === undefined && ctx.state === undefined && ctx.layer === undefined) return null;
  let json = JSON.stringify(ctx);
  if (Buffer.byteLength(json) > MAX_CONTEXT_BYTES) {
    delete ctx.state;
    if (ctx.label === undefined && ctx.layer === undefined) return null;
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
