import type { ProjectAccess } from '~/lib/access';
import type { CommentDto, CommentStatus, ReplyDto, Viewport } from '~/lib/comments';
import type { Anchor } from './anchor';

export type { CommentDto, CommentStatus, ProjectAccess, ReplyDto, Viewport };

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  listComments: (projectId: number, path: string) =>
    call<CommentDto[]>(`/api/comments?project=${projectId}&path=${encodeURIComponent(path)}`),
  createComment: (projectId: number, pagePath: string, viewport: Viewport, body: string, anchor: Anchor) =>
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
