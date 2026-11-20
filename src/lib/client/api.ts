import type { ProjectAccess } from '~/lib/access';
import type { CommentDto, CommentStatus, ReplyDto, Viewport } from '~/lib/comments';
import type { ApiFailure } from '~/lib/i18n';
import type { Anchor } from './anchor';

export type { CommentDto, CommentStatus, ProjectAccess, ReplyDto, Viewport };

/**
 * A failed call. The message stays the API's English text; the review screen maps it to its own
 * locale (`errorText` in lib/i18n), so the API itself never has to know about languages.
 */
export class ApiError extends Error implements ApiFailure {
  constructor(
    message: string,
    /** null: the request never got an answer (offline, DNS, aborted). */
    public status: number | null,
    /** The message is the API's `{error}` text, not one made up here. */
    public fromServer: boolean,
  ) {
    super(message);
  }
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
    });
  } catch (e) {
    throw new ApiError((e as Error).message, null, false);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: unknown }).error;
    throw typeof message === 'string' ? new ApiError(message, res.status, true) : new ApiError(`HTTP ${res.status}`, res.status, false);
  }
  return data as T;
}

export const api = {
  listComments: (projectId: number, path: string) =>
    call<CommentDto[]>(`/api/comments?project=${projectId}&path=${encodeURIComponent(path)}`),
  createComment: (projectId: number, pagePath: string, viewport: Viewport, body: string, anchor: Anchor, context?: unknown) =>
    call<CommentDto>('/api/comments', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        page_path: pagePath,
        viewport,
        body,
        selector: anchor.selector,
        xpath: anchor.xpath,
        text_snippet: anchor.textSnippet,
        tag_name: anchor.tagName,
        rect_top: anchor.rectTop,
        context,
      }),
    }),
  updateComment: (id: number, body: string) => call<CommentDto>(`/api/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteComment: (id: number) => call<void>(`/api/comments/${id}`, { method: 'DELETE' }),
  setStatus: (id: number, status: CommentStatus) =>
    call<CommentDto>(`/api/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  createReply: (commentId: number, body: string) =>
    call<ReplyDto>(`/api/comments/${commentId}/replies`, { method: 'POST', body: JSON.stringify({ body }) }),
  updateReply: (id: number, body: string) => call<ReplyDto>(`/api/replies/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteReply: (id: number) => call<void>(`/api/replies/${id}`, { method: 'DELETE' }),
};
