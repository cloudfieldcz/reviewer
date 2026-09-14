<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { computeAnchor, isReviewerNode, pickMeaningful, resolveAnchor, type Anchor, type ResolveMethod } from '~/lib/client/anchor';
  import { api, type CommentDto, type CommentStatus, type ReplyDto, type Viewport } from '~/lib/client/api';
  import { Overlay } from '~/lib/client/overlay';

  interface Props {
    project: { id: number; name: string; baseUrl: string };
    user: { id: number; name: string; role: 'admin' | 'user' };
    initialPath: string;
    initialDevice: Viewport;
  }
  let { project, user, initialPath, initialDevice }: Props = $props();

  const PREFIX = `/p/${project.id}`;
  const INTRO_KEY = 'reviewer.intro.v2';
  const DEVICE_KEY = 'reviewer.device';
  /** iPhone 15 CSS viewport; the bezel is cosmetic and sits outside the page box. */
  const PHONE = { w: 393, h: 852, bezel: 14, top: 40 };
  const host = project.baseUrl.replace(/^https?:\/\//, '');

  // ---- state ----------------------------------------------------------------
  let iframe = $state<HTMLIFrameElement | null>(null);
  let path = $state(initialPath);
  let pathInput = $state(initialPath);
  let comments = $state<CommentDto[]>([]);
  let resolved = $state<Record<number, { method: ResolveMethod } | null>>({});
  let filter = $state<'all' | 'mine'>('all');
  let commentMode = $state(true);
  /** ⌥ held: clicks fall through to the page, so the mode indicator has to say so too. */
  let altActive = $state(false);
  let hintOpen = $state(true);
  let intro = $state(false);
  /** "Don't show again" – mirrors the stored preference, so re-opening the card can undo it. */
  let introMute = $state(false);
  // #c123 in the URL (links from the admin table) focuses that comment once loaded.
  let activeId = $state<number | null>(Number(location.hash.match(/^#c(\d+)$/)?.[1]) || null);
  let draft = $state<{ anchor: Anchor; body: string; saving: boolean } | null>(null);
  let editing = $state<{ id: number; body: string; saving: boolean } | null>(null);
  let replying = $state<{ commentId: number; body: string; saving: boolean } | null>(null);
  let editingReply = $state<{ id: number; commentId: number; body: string; saving: boolean } | null>(null);
  /**
   * Which statuses are listed and drawn. Decided comments (approved / rejected) are kept but stay out
   * of the way until asked for; `open` is the working set.
   */
  let statusFilter = $state<Record<CommentStatus, boolean>>({ open: true, approved: false, rejected: false });
  const STATUS_LABEL: Record<CommentStatus, string> = { open: 'Open', approved: 'Approved', rejected: 'Rejected' };
  const STATUS_MARK: Record<CommentStatus, string> = { open: '●', approved: '✓', rejected: '✕' };
  /** Rendering hint only – the server decides in setStatus / delete. Becomes a prop with project owners. */
  const canManage = $derived(user.role === 'admin');
  let error = $state<string | null>(null);
  let loading = $state(true);
  let frameError = $state(false);
  /**
   * Simulated viewport. The target site renders a different DOM at phone width, so comments belong
   * to the viewport they were written in – see `visible` / `forDevice`.
   */
  let device = $state<Viewport>(initialDevice);
  let stageW = $state(0);
  let stageH = $state(0);

  // Non-reactive DOM handles (elements live inside the iframe document).
  let overlay: Overlay | null = null;
  let draftEl: Element | null = null;
  let elements = new Map<number, Element>();
  let detachFrame: (() => void) | null = null;
  let sidebarEl = $state<HTMLElement | null>(null);
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  const picking = $derived(commentMode && !altActive);

  /** The phone shell shrinks to fit a short window instead of being cut off. */
  const phoneScale = $derived.by(() => {
    if (device !== 'phone' || !stageW || !stageH) return 1;
    const s = Math.min(1, (stageW - 32) / (PHONE.w + 2 * PHONE.bezel), (stageH - 32) / (PHONE.h + PHONE.top + PHONE.bezel));
    return Math.max(0.3, Math.round(s * 1000) / 1000);
  });
  const deviceLabel = $derived(device === 'phone' ? 'iPhone 15' : 'Desktop');

  /** Only the current viewport's comments are anchored, numbered and drawn. */
  const forDevice = $derived(comments.filter((c) => c.viewport === device));
  const otherCount = $derived(comments.length - forDevice.length);

  const countByStatus = $derived.by(() => {
    const n: Record<CommentStatus, number> = { open: 0, approved: 0, rejected: 0 };
    for (const c of forDevice) n[c.status]++;
    return n;
  });
  const hiddenCount = $derived(forDevice.filter((c) => !statusFilter[c.status]).length);
  /**
   * Comments in the chosen statuses. A comment being replied to or edited stays until the composer
   * closes, so rejecting (which opens the reply box for the reason) does not pull the card away.
   */
  const inStatus = $derived(forDevice.filter((c) => statusFilter[c.status] || replying?.commentId === c.id || editing?.id === c.id));

  const visible = $derived.by(() => {
    void resolved; // element positions change whenever anchors are re-resolved
    return inStatus
      .filter((c) => filter === 'all' || c.mine)
      .map((c) => ({ ...c, order: liveTop(c) }))
      .sort((a, b) => a.order - b.order || a.id - b.id);
  });
  const numberOf = $derived(new Map(visible.map((c, i) => [c.id, i + 1])));
  const mineCount = $derived(inStatus.filter((c) => c.mine).length);

  function liveTop(c: CommentDto): number {
    const el = elements.get(c.id);
    const win = iframe?.contentWindow;
    if (el && el.isConnected && win) return el.getBoundingClientRect().top + win.scrollY;
    return c.rectTop ?? Number.MAX_SAFE_INTEGER;
  }

  // ---- mode -----------------------------------------------------------------
  function setMode(on: boolean) {
    if (commentMode === on) return;
    commentMode = on;
    if (!on) cancelDraft();
    else overlay?.setHover(null);
    flashHint();
  }

  function setDevice(d: Viewport) {
    if (device === d) return;
    device = d;
    cancelDraft();
    activeId = null;
    try {
      localStorage.setItem(DEVICE_KEY, d);
    } catch {
      // private mode: the URL still carries the choice
    }
    const url = new URL(location.href);
    url.searchParams.set('device', d);
    history.replaceState(null, '', url);
    // The frame reflows at the new width, so every anchor and marker has to be recomputed.
    setTimeout(resolveAll, 150);
  }

  function flashHint() {
    hintOpen = true;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (hintOpen = false), 4500);
  }

  // The cursor inside the frame is the fastest way to tell the two modes apart.
  $effect(() => {
    overlay?.setPicking(picking);
  });

  /** The card returns on every visit until the reviewer opts out of it. */
  function dismissIntro() {
    intro = false;
    try {
      if (introMute) localStorage.setItem(INTRO_KEY, 'done');
      else localStorage.removeItem(INTRO_KEY);
    } catch {
      /* private mode – the card simply shows again */
    }
  }

  // ---- iframe lifecycle -----------------------------------------------------
  function frameSrc(p: string) {
    return PREFIX + (p.startsWith('/') ? p : '/' + p);
  }

  function currentFramePath(): string {
    const loc = iframe?.contentWindow?.location;
    if (!loc || loc.href === 'about:blank') return path;
    const p = loc.pathname.replace(new RegExp(`^${PREFIX.replace(/\//g, '\\/')}(?=/|$)`), '') || '/';
    return p + loc.search;
  }

  async function onFrameLoad() {
    detachFrame?.();
    const win = iframe?.contentWindow;
    const doc = win?.document;
    if (!win || !doc) return;

    frameError = doc.title === 'Reviewer – proxy error';
    setPath(currentFramePath());
    draft = null;
    draftEl = null;
    elements = new Map();

    overlay = new Overlay(doc, {
      onPlus: (el) => startDraft(el),
      onMarker: (id) => focusComment(id, { scrollSidebar: true }),
    });
    overlay.setPicking(picking);

    const onMove = (e: MouseEvent) => {
      altActive = e.altKey;
      if (!commentMode || draft) return;
      if (e.altKey) return overlay?.setHover(null);
      const target = e.target as Element;
      if (isReviewerNode(target)) return; // moving onto the "+" button keeps the current highlight
      const el = pickMeaningful(target);
      if (el) overlay?.setHover(el); // over bare body/html: keep the last highlight so "+" stays reachable
    };
    const onLeave = () => overlay?.setHover(null);
    const onClick = (e: MouseEvent) => {
      if (!commentMode) return;
      altActive = e.altKey;
      if (e.altKey) return; // ⌥-click drives the page itself: cookie banners, menus, tabs
      if (isReviewerNode(e.target as Element)) return; // our own buttons
      // Block the page's own behaviour so links & buttons can be commented on.
      e.preventDefault();
      e.stopPropagation();
      if (draft) return;
      const el = pickMeaningful(e.target as Element);
      if (el) startDraft(el);
    };
    const swallow = (e: Event) => {
      // `submit` carries no modifier state – reuse the one from the click that triggered it.
      if (commentMode && !altActive && !isReviewerNode(e.target as Element)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      altActive = e.altKey;
      if (e.key === 'Escape') cancelDraft();
      if ((e.key === 'c' || e.key === 'C') && !isTyping(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setMode(!commentMode);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => (altActive = e.altKey);
    const onBlur = () => (altActive = false);
    // Window-level capture listeners fire before the page's own (and the injected script's) document listeners.
    win.addEventListener('mousemove', onMove, true);
    win.addEventListener('click', onClick, true);
    win.addEventListener('submit', swallow, true);
    win.addEventListener('auxclick', swallow, true);
    win.addEventListener('keydown', onKey, true);
    win.addEventListener('keyup', onKeyUp, true);
    win.addEventListener('blur', onBlur);
    doc.addEventListener('mouseleave', onLeave);
    detachFrame = () => {
      win.removeEventListener('mousemove', onMove, true);
      win.removeEventListener('click', onClick, true);
      win.removeEventListener('submit', swallow, true);
      win.removeEventListener('auxclick', swallow, true);
      win.removeEventListener('keydown', onKey, true);
      win.removeEventListener('keyup', onKeyUp, true);
      win.removeEventListener('blur', onBlur);
      doc.removeEventListener('mouseleave', onLeave);
      overlay?.destroy();
      overlay = null;
      detachFrame = null;
    };

    await loadComments();
  }

  function setPath(p: string) {
    if (p === path) return;
    path = p;
    pathInput = p;
    const url = new URL(location.href);
    url.searchParams.set('path', p);
    history.replaceState(null, '', url);
  }

  // Client-side routers inside the frame report via postMessage (see proxy inject script).
  let navTimer: ReturnType<typeof setTimeout> | undefined;
  function onMessage(e: MessageEvent) {
    if (e.source !== iframe?.contentWindow || e.data?.type !== 'reviewer:navigate') return;
    const p = String(e.data.path ?? '/');
    if (p === path) return;
    clearTimeout(navTimer);
    navTimer = setTimeout(async () => {
      setPath(p);
      await loadComments();
    }, 150);
  }

  function navigate(p: string) {
    if (!iframe) return;
    const clean = p.trim().replace(/^https?:\/\/[^/]+/, '') || '/';
    iframe.contentWindow?.location.assign(frameSrc(clean.startsWith('/') ? clean : '/' + clean));
  }
  const goBack = () => iframe?.contentWindow?.history.back();
  const goForward = () => iframe?.contentWindow?.history.forward();
  const reload = () => iframe?.contentWindow?.location.reload();

  // ---- comments -------------------------------------------------------------
  async function loadComments() {
    loading = true;
    error = null;
    try {
      comments = await api.listComments(project.id, path);
    } catch (e) {
      error = (e as Error).message;
      comments = [];
    } finally {
      loading = false;
    }
    resolveAll();
    if (activeId != null) {
      const id = activeId;
      await tick();
      if (comments.some((c) => c.id === id)) focusComment(id, { scrollFrame: true, scrollSidebar: true });
      else activeId = null;
    }
  }

  function resolveAll() {
    const doc = iframe?.contentWindow?.document;
    if (!doc || !doc.body) return;
    const next: Record<number, { method: ResolveMethod } | null> = {};
    elements = new Map();
    for (const c of forDevice) {
      const r = resolveAnchor(doc, c);
      next[c.id] = r ? { method: r.method } : null;
      if (r) elements.set(c.id, r.el);
    }
    resolved = next;
    paintMarkers();
  }

  function paintMarkers() {
    overlay?.setMarkers(
      visible
        .filter((c) => elements.has(c.id))
        .map((c) => ({
          id: c.id,
          number: numberOf.get(c.id)!,
          el: elements.get(c.id)!,
          mine: c.mine,
          active: c.id === activeId,
          status: c.status,
        })),
    );
  }
  $effect(() => {
    // re-paint when filter/active/comments change
    void visible;
    void activeId;
    paintMarkers();
  });

  // Pages with late-arriving content: retry anchoring a few times after load.
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void comments;
    void device;
    clearTimeout(retryTimer);
    const missing = () => forDevice.some((c) => !elements.has(c.id));
    let attempts = 0;
    const tickRetry = () => {
      if (!missing() || attempts++ >= 5) return;
      resolveAll();
      retryTimer = setTimeout(tickRetry, 800 * attempts);
    };
    retryTimer = setTimeout(tickRetry, 500);
    return () => clearTimeout(retryTimer);
  });

  function focusComment(id: number, opts: { scrollFrame?: boolean; scrollSidebar?: boolean } = {}) {
    activeId = id;
    const el = elements.get(id);
    if (opts.scrollFrame && el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (opts.scrollSidebar) {
      tick().then(() => sidebarEl?.querySelector<HTMLElement>(`[data-cid="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  }

  async function startDraft(el: Element) {
    const doc = iframe?.contentWindow?.document;
    if (!doc) return;
    draftEl = el;
    overlay?.setHover(el);
    draft = { anchor: computeAnchor(el, doc), body: '', saving: false };
    editing = null;
    activeId = null;
    await tick();
    sidebarEl?.querySelector<HTMLTextAreaElement>('#draft-body')?.focus();
  }

  function cancelDraft() {
    draft = null;
    draftEl = null;
    overlay?.setHover(null);
  }

  async function saveDraft() {
    if (!draft || !draft.body.trim()) return;
    draft.saving = true;
    error = null;
    try {
      const created = await api.createComment(project.id, path, device, draft.body, draft.anchor);
      comments = [...comments, created];
      if (draftEl) elements.set(created.id, draftEl);
      resolved = { ...resolved, [created.id]: { method: 'selector' } };
      cancelDraft();
      focusComment(created.id, { scrollSidebar: true });
    } catch (e) {
      error = (e as Error).message;
      if (draft) draft.saving = false;
    }
  }

  function startEdit(c: CommentDto) {
    editing = { id: c.id, body: c.body, saving: false };
    draft = null;
  }

  async function saveEdit() {
    if (!editing || !editing.body.trim()) return;
    editing.saving = true;
    try {
      const updated = await api.updateComment(editing.id, editing.body);
      comments = comments.map((c) => (c.id === updated.id ? updated : c));
      editing = null;
    } catch (e) {
      error = (e as Error).message;
      if (editing) editing.saving = false;
    }
  }

  async function remove(c: CommentDto) {
    if (!confirm('Delete this comment?')) return;
    try {
      await api.deleteComment(c.id);
      comments = comments.filter((x) => x.id !== c.id);
      elements.delete(c.id);
      if (activeId === c.id) activeId = null;
      if (replying?.commentId === c.id) replying = null;
      if (editingReply?.commentId === c.id) editingReply = null;
    } catch (e) {
      error = (e as Error).message;
    }
  }

  // ---- verdict --------------------------------------------------------------
  /** Approve, reject or reopen. Rejecting opens the reply box so the reason lands in the thread. */
  async function decide(c: CommentDto, status: CommentStatus) {
    try {
      const updated = await api.setStatus(c.id, status);
      comments = comments.map((x) => (x.id === updated.id ? updated : x));
      if (status === 'rejected') {
        await startReply(updated);
        return;
      }
      // A freshly decided comment drops out of the list unless its status is shown.
      if (!statusFilter[updated.status]) {
        if (activeId === c.id) activeId = null;
        if (replying?.commentId === c.id) replying = null;
        if (editing?.id === c.id) editing = null;
      }
    } catch (e) {
      error = (e as Error).message;
    }
  }

  // ---- replies --------------------------------------------------------------
  /** Replaces the reply list of one comment without touching the rest of the DTO. */
  function patchReplies(commentId: number, fn: (replies: ReplyDto[]) => ReplyDto[]) {
    comments = comments.map((c) => (c.id === commentId ? { ...c, replies: fn(c.replies) } : c));
  }

  async function startReply(c: CommentDto) {
    replying = { commentId: c.id, body: '', saving: false };
    editing = null;
    editingReply = null;
    draft = null;
    activeId = c.id;
    await tick();
    sidebarEl?.querySelector<HTMLTextAreaElement>(`#reply-${c.id}`)?.focus();
  }

  async function saveReply() {
    if (!replying || !replying.body.trim()) return;
    replying.saving = true;
    const commentId = replying.commentId;
    try {
      const created = await api.createReply(commentId, replying.body);
      patchReplies(commentId, (rs) => [...rs, created]);
      replying = null;
    } catch (e) {
      error = (e as Error).message;
      if (replying) replying.saving = false;
    }
  }

  function startReplyEdit(c: CommentDto, r: ReplyDto) {
    editingReply = { id: r.id, commentId: c.id, body: r.body, saving: false };
    replying = null;
    editing = null;
  }

  async function saveReplyEdit() {
    if (!editingReply || !editingReply.body.trim()) return;
    editingReply.saving = true;
    const commentId = editingReply.commentId;
    try {
      const updated = await api.updateReply(editingReply.id, editingReply.body);
      patchReplies(commentId, (rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
      editingReply = null;
    } catch (e) {
      error = (e as Error).message;
      if (editingReply) editingReply.saving = false;
    }
  }

  async function removeReply(c: CommentDto, r: ReplyDto) {
    if (!confirm('Delete this reply?')) return;
    try {
      await api.deleteReply(r.id);
      patchReplies(c.id, (rs) => rs.filter((x) => x.id !== r.id));
      if (editingReply?.id === r.id) editingReply = null;
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function fmt(s: string) {
    return new Date(s.replace(' ', 'T') + 'Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  /** Short relative time – the exact stamp stays in the title attribute. */
  function ago(s: string) {
    const diff = (Date.now() - new Date(s.replace(' ', 'T') + 'Z').getTime()) / 1000;
    if (diff < 90) return 'just now';
    if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
    if (diff < 604800) return `${Math.round(diff / 86400)} d ago`;
    return new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function initials(name: string) {
    return name
      .split(/[\s.@_-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('');
  }

  function isTyping(t: EventTarget | null) {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  function onKeydown(e: KeyboardEvent) {
    altActive = e.altKey;
    if (e.key === 'Escape') {
      if (intro) dismissIntro();
      else if (editingReply) editingReply = null;
      else if (replying) replying = null;
      else if (editing) editing = null;
      else cancelDraft();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if (draft) saveDraft();
      else if (editingReply) saveReplyEdit();
      else if (replying) saveReply();
      else if (editing) saveEdit();
    }
    if ((e.key === 'c' || e.key === 'C') && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !draft) {
      e.preventDefault();
      setMode(!commentMode);
    }
  }
  const onKeyup = (e: KeyboardEvent) => (altActive = e.altKey);

  onMount(() => {
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('keyup', onKeyup);
    if (!new URL(location.href).searchParams.has('device')) {
      try {
        const saved = localStorage.getItem(DEVICE_KEY);
        if (saved === 'phone' || saved === 'desktop') device = saved;
      } catch {
        // keep the server-side default
      }
    }
    try {
      introMute = localStorage.getItem(INTRO_KEY) === 'done';
    } catch {
      introMute = false;
    }
    intro = !introMute;
    flashHint();
  });
  onDestroy(() => {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('keyup', onKeyup);
    clearTimeout(hintTimer);
    detachFrame?.();
  });
</script>

{#snippet iconComment(cls: string)}
  <svg viewBox="0 0 16 16" class={cls} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M13.5 8.2c0 2.5-2.5 4.5-5.5 4.5-.7 0-1.3-.1-1.9-.3L2.5 13.5l1-2.8C2.6 9.9 2.5 9.1 2.5 8.2c0-2.5 2.5-4.5 5.5-4.5s5.5 2 5.5 4.5Z" />
  </svg>
{/snippet}

{#snippet iconDesktop(cls: string)}
  <svg viewBox="0 0 16 16" class={cls} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="1.8" y="2.8" width="12.4" height="8.4" rx="1.3" />
    <path d="M5.5 13.8h5" />
  </svg>
{/snippet}

{#snippet iconPhone(cls: string)}
  <svg viewBox="0 0 16 16" class={cls} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="4.3" y="1.6" width="7.4" height="12.8" rx="1.8" />
    <path d="M7 3.3h2" />
  </svg>
{/snippet}

{#snippet iconCursor(cls: string)}
  <svg viewBox="0 0 16 16" class={cls} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
    <path d="M3.5 2.5 12 8.6l-3.7.6-1.9 3.4-2.9-10.1Z" />
  </svg>
{/snippet}

<div class="flex h-full min-h-0 flex-1 flex-col bg-gray-900">
  <!-- toolbar -->
  <header class="chrome flex h-14 shrink-0 items-center gap-2 px-3">
    <a href="/" class="chrome-btn !px-1.5" title="All projects" aria-label="All projects">
      <svg viewBox="0 0 24 24" class="h-5 w-5 text-white" aria-hidden="true">
        <rect x="2.6" y="3.6" width="14.8" height="14.8" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.7" opacity="0.6" />
        <circle cx="17.6" cy="17.6" r="4.6" fill="var(--color-brand)" />
      </svg>
    </a>
    <div class="hidden min-w-0 max-w-52 sm:block">
      <div class="truncate text-[13px] font-semibold leading-4 text-white" title={project.name}>{project.name}</div>
      <div class="meta truncate leading-4" title={project.baseUrl}>{host}</div>
    </div>

    <span class="mx-1 h-6 w-px bg-white/10"></span>

    <button class="chrome-btn !px-1.5" onclick={goBack} title="Back" aria-label="Back">
      <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5" /></svg>
    </button>
    <button class="chrome-btn !px-1.5" onclick={goForward} title="Forward" aria-label="Forward">
      <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5" /></svg>
    </button>
    <button class="chrome-btn !px-1.5" onclick={reload} title="Reload" aria-label="Reload">
      <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3" /></svg>
    </button>

    <form class="flex min-w-0 flex-1 items-center" onsubmit={(e) => { e.preventDefault(); navigate(pathInput); }}>
      <input class="chrome-input" bind:value={pathInput} spellcheck="false" placeholder="/path" aria-label="Page path" />
    </form>

    <a class="chrome-btn !px-1.5" href={project.baseUrl + path} target="_blank" rel="noopener" title="Open this page on the real site">
      <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h7v7M13 3 7 9M11 9.5V13H3V5h3.5" /></svg>
    </a>

    <span class="mx-1 h-6 w-px bg-white/10"></span>

    <!-- Viewport: the site is rendered at the real width, so responsive layouts can be reviewed too. -->
    <div class="chrome-seg" role="group" aria-label="Viewport">
      <button
        class={['chrome-seg-item !px-2', device === 'desktop' && 'bg-white/15 text-white hover:text-white']}
        onclick={() => setDevice('desktop')}
        aria-pressed={device === 'desktop'}
        title="Desktop – the page fills the window"
      >
        {@render iconDesktop('h-3.5 w-3.5')}
        <span class="hidden xl:inline">Desktop</span>
      </button>
      <button
        class={['chrome-seg-item !px-2', device === 'phone' && 'bg-white/15 text-white hover:text-white']}
        onclick={() => setDevice('phone')}
        aria-pressed={device === 'phone'}
        title="iPhone 15 – 393 × 852 px viewport"
      >
        {@render iconPhone('h-3.5 w-3.5')}
        <span class="hidden xl:inline">iPhone 15</span>
      </button>
    </div>

    <span class="mx-1 h-6 w-px bg-white/10"></span>

    <!-- Mode: both options are always on screen, so the label can never be read as an action. -->
    <div class="chrome-seg" role="group" aria-label="Interaction mode">
      <button
        class={['chrome-seg-item', commentMode && 'bg-brand text-white hover:text-white']}
        onclick={() => setMode(true)}
        aria-pressed={commentMode}
        title="Comment mode (C) – clicking an element writes a comment"
      >
        {@render iconComment('h-3.5 w-3.5')}
        Comment
      </button>
      <button
        class={['chrome-seg-item', !commentMode && 'bg-white text-gray-900 hover:text-gray-900']}
        onclick={() => setMode(false)}
        aria-pressed={!commentMode}
        title="Browse mode (C) – clicking works like the real site"
      >
        {@render iconCursor('h-3.5 w-3.5')}
        Browse
      </button>
    </div>

    <button class="chrome-btn !px-1.5" onclick={() => (intro = true)} title="How this works" aria-label="How this works">
      <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.2" /><path d="M6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.3" /><circle cx="8" cy="11.6" r=".7" fill="currentColor" stroke="none" /></svg>
    </button>
  </header>

  <div class="flex min-h-0 flex-1">
    <!-- frame -->
    <div
      class={['relative min-w-0 flex-1', device === 'phone' ? 'bg-gray-800' : 'bg-white']}
      bind:clientWidth={stageW}
      bind:clientHeight={stageH}
    >
      <!-- The iframe element is never recreated, so switching viewports reflows the page instead of reloading it. -->
      <div class="absolute inset-0 flex items-center justify-center overflow-hidden">
        <div
          class={['relative shrink-0', device === 'phone' && 'rounded-[54px] bg-gray-950 shadow-2xl ring-1 ring-white/15']}
          style={device === 'phone'
            ? `width:${PHONE.w + 2 * PHONE.bezel}px;height:${PHONE.h + PHONE.top + PHONE.bezel}px;padding:${PHONE.top}px ${PHONE.bezel}px ${PHONE.bezel}px;transform:scale(${phoneScale})`
            : 'width:100%;height:100%'}
        >
          <iframe
            bind:this={iframe}
            src={frameSrc(initialPath)}
            title={project.name}
            class={['h-full w-full border-0 bg-white', device === 'phone' && 'rounded-[40px]']}
            onload={onFrameLoad}
          ></iframe>

          {#if device === 'phone'}
            <!-- Cosmetic dynamic island – drawn in the bezel, never over the page being reviewed. -->
            <div class="pointer-events-none absolute left-1/2 top-[9px] h-[22px] w-[86px] -translate-x-1/2 rounded-full bg-black ring-1 ring-white/10"></div>
          {/if}

          <!-- The viewport is framed in the mode colour: state you read without reading. -->
          <div
            class={[
              'pointer-events-none absolute inset-0 border-2 transition-colors duration-200',
              device === 'phone' && 'rounded-[54px]',
              picking ? 'border-brand' : 'border-transparent',
            ]}
          ></div>
        </div>
      </div>

      <div class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
        <div
          class={[
            'flex max-w-full items-center gap-2 rounded-full py-1.5 pl-3 pr-3.5 text-xs shadow-pop backdrop-blur transition-all duration-200',
            picking ? 'bg-brand/95 text-white' : 'bg-gray-900/90 text-gray-200',
          ]}
        >
          <span class={['h-2 w-2 shrink-0 rounded-full', picking ? 'bg-white' : 'bg-gray-400']}></span>
          <span class="font-semibold">{commentMode ? 'Comment mode' : 'Browse mode'}</span>
          {#if hintOpen || altActive}
            <span class="truncate opacity-80">
              {#if altActive}
                ⌥ held – this click goes to the site
              {:else if commentMode}
                Click any element to comment · hold ⌥ to use the page
              {:else}
                Clicks work like the real site · press C to comment
              {/if}
            </span>
          {/if}
        </div>
      </div>

      {#if intro}
        <div class="absolute inset-0 z-10 flex items-center justify-center bg-gray-900/40 p-6">
          <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-pop">
            <h2 class="text-lg font-semibold tracking-tight">Two ways to click</h2>
            <p class="mt-1 text-sm text-gray-600">The site below is live. The mode decides what your clicks do.</p>
            <ul class="mt-5 space-y-3">
              <li class="flex gap-3 rounded-lg border border-brand/30 bg-brand-soft p-3">
                <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand text-white">
                  {@render iconComment('h-4 w-4')}
                </span>
                <span class="text-sm">
                  <span class="font-semibold">Comment</span> – hover highlights an element, clicking it opens a new comment. Hold
                  <kbd class="rounded border border-gray-300 bg-white px-1 font-mono text-[11px]">⌥</kbd> to click through to the page once (cookie banners, menus).
                </span>
              </li>
              <li class="flex gap-3 rounded-lg border border-gray-200 p-3">
                <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-200 text-gray-700">
                  {@render iconCursor('h-4 w-4')}
                </span>
                <span class="text-sm">
                  <span class="font-semibold">Browse</span> – the site behaves normally, so you can navigate to the page you want to review. Existing comments stay visible.
                </span>
              </li>
            </ul>
            <p class="mt-4 text-xs text-gray-500">
              Switch any time with the toggle up top or the <kbd class="rounded border border-gray-300 bg-gray-50 px-1 font-mono text-[11px]">C</kbd> key.
            </p>
            <div class="mt-5 flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
              <label class="flex cursor-pointer items-center gap-2 text-xs text-gray-600 select-none">
                <input type="checkbox" class="h-4 w-4 rounded border-gray-300 accent-[var(--color-brand)]" bind:checked={introMute} />
                Got it, don't show this again
              </label>
              <button class="btn-primary" onclick={dismissIntro}>Start reviewing</button>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- sidebar -->
    <aside class="flex w-96 shrink-0 flex-col border-l border-gray-200 bg-gray-50" bind:this={sidebarEl}>
      <div class="border-b border-gray-200 bg-white px-3 py-2.5">
        <div class="flex items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-1.5">
            <h2 class="text-sm font-semibold tracking-tight">Comments</h2>
            <span
              class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500"
              title="Comments belong to the viewport they were written in – the page renders differently on a phone"
            >{deviceLabel}</span>
          </div>
          <div class="seg" role="group" aria-label="Filter comments">
            <button class={filter === 'all' ? 'seg-item-on' : 'seg-item'} onclick={() => (filter = 'all')} aria-pressed={filter === 'all'}>All {inStatus.length}</button>
            <button class={filter === 'mine' ? 'seg-item-on' : 'seg-item'} onclick={() => (filter = 'mine')} aria-pressed={filter === 'mine'}>Mine {mineCount}</button>
          </div>
        </div>
        <p class="meta mt-1 truncate" title={project.baseUrl + path}>{path}</p>
        <div class="mt-1.5 flex gap-1" role="group" aria-label="Filter by status">
          {#each ['open', 'approved', 'rejected'] as const as st (st)}
            {@const on = statusFilter[st]}
            <button
              class={[
                'flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                on && st === 'open' ? 'bg-gray-700 text-white hover:bg-gray-800' : '',
                on && st === 'approved' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : '',
                on && st === 'rejected' ? 'bg-red-600 text-white hover:bg-red-700' : '',
                !on ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' : '',
              ]}
              onclick={() => (statusFilter = { ...statusFilter, [st]: !on })}
              aria-pressed={on}
              title={`${on ? 'Hide' : 'Show'} ${STATUS_LABEL[st].toLowerCase()} comments`}
            >
              <span aria-hidden="true">{STATUS_MARK[st]}</span>
              {STATUS_LABEL[st]} {countByStatus[st]}
            </button>
          {/each}
        </div>
        {#if otherCount > 0}
          <button
            class="mt-1.5 flex w-full items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-left text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-100"
            onclick={() => setDevice(device === 'phone' ? 'desktop' : 'phone')}
          >
            {otherCount}
            {otherCount === 1 ? 'comment' : 'comments'} in the {device === 'phone' ? 'desktop' : 'iPhone 15'} view – switch
          </button>
        {/if}
      </div>

      {#if error}
        <div class="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      {/if}
      {#if frameError}
        <div class="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">The target page could not be loaded through the proxy. Check the project base URL.</div>
      {/if}

      <div class="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {#if draft}
          <div class="rounded-lg border border-brand bg-white p-3 shadow-pop ring-4 ring-brand/15">
            <div class="mb-1.5 flex items-center justify-between">
              <span class="text-xs font-semibold text-brand">New comment</span>
              <code class="meta rounded bg-gray-100 px-1 py-0.5">&lt;{draft.anchor.tagName}&gt;</code>
            </div>
            {#if draft.anchor.textSnippet}
              <p class="mb-2 line-clamp-2 text-xs italic text-gray-500">“{draft.anchor.textSnippet}”</p>
            {/if}
            <textarea id="draft-body" class="input min-h-24 resize-y" placeholder="What should change here?" bind:value={draft.body} disabled={draft.saving}></textarea>
            <div class="mt-2 flex items-center justify-between">
              <span class="meta">⌘↵ save · esc cancel</span>
              <div class="flex gap-2">
                <button class="btn-ghost" onclick={cancelDraft} disabled={draft.saving}>Cancel</button>
                <button class="btn-primary" onclick={saveDraft} disabled={draft.saving || !draft.body.trim()}>{draft.saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </div>
        {/if}

        {#if loading}
          <p class="py-6 text-center text-sm text-gray-400">Loading…</p>
        {:else if visible.length === 0 && !draft}
          <div class="px-4 py-12 text-center">
            <span class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-gray-500">
              {@render iconComment('h-5 w-5')}
            </span>
            <p class="text-sm font-medium text-gray-700">
              {filter === 'mine' ? 'Nothing from you here' : 'No comments here'}
            </p>
            <p class="mt-0.5 text-xs text-gray-400">{path} · {deviceLabel}</p>
            {#if hiddenCount > 0}
              <p class="mt-1 text-xs text-gray-500">{hiddenCount} {hiddenCount === 1 ? 'comment is' : 'comments are'} hidden by the status filter.</p>
            {/if}
            <p class="mt-1 text-xs text-gray-500">
              {#if commentMode}
                Click anything in the page to write the first one.
              {:else}
                Switch to Comment mode to add one.
              {/if}
            </p>
          </div>
        {/if}

        {#each visible as c (c.id)}
          {@const found = resolved[c.id] != null}
          {@const decided = c.status !== 'open'}
          {@const canEdit = user.role === 'admin' || (c.mine && !decided)}
          {@const isActive = activeId === c.id}
          <article
            data-cid={c.id}
            class={[
              'group relative cursor-pointer overflow-hidden rounded-lg border p-3 pl-3.5 shadow-card transition-all',
              decided ? 'bg-gray-50' : 'bg-white',
              isActive ? 'border-amber-400 ring-2 ring-amber-400/30' : 'border-gray-200 hover:border-gray-300 hover:shadow-pop',
            ]}
            role="button"
            tabindex="0"
            onclick={() => focusComment(c.id, { scrollFrame: true })}
            onkeydown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) focusComment(c.id, { scrollFrame: true }); }}
          >
            <span class={['absolute inset-y-0 left-0 w-1', isActive ? 'bg-amber-400' : c.status === 'approved' ? 'bg-emerald-300' : c.status === 'rejected' ? 'bg-red-300' : c.mine ? 'bg-brand' : 'bg-gray-400']}></span>

            <div class="mb-1.5 flex items-start justify-between gap-2">
              <div class="flex min-w-0 items-center gap-2">
                <span class={['inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums', isActive ? 'bg-amber-400 text-gray-900' : c.status === 'approved' ? 'bg-emerald-600/70 text-white' : c.status === 'rejected' ? 'bg-red-600/70 text-white' : c.mine ? 'bg-brand text-white' : 'bg-gray-500 text-white']}>
                  {decided ? STATUS_MARK[c.status] : numberOf.get(c.id)}
                </span>
                <span class="truncate text-sm font-medium" title={c.author.email}>{c.mine ? 'You' : (c.author.name ?? c.author.email)}</span>
              </div>
              <time class="shrink-0 text-[11px] text-gray-400" datetime={c.createdAt} title={fmt(c.createdAt)}>{ago(c.createdAt)}</time>
            </div>

            <p class="mb-2 truncate">
              {#if c.tagName}<code class="meta rounded bg-gray-100 px-1 py-0.5">&lt;{c.tagName}&gt;</code>{/if}
              {#if c.textSnippet}<span class="text-xs italic text-gray-500"> “{c.textSnippet}”</span>{/if}
            </p>

            {#if !found}
              <p class="mb-2 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800" title="The element this comment was anchored to is no longer on the page (site changed?). The comment is kept.">
                Element not found
              </p>
            {:else if resolved[c.id]?.method === 'text'}
              <p class="mb-2 inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600" title="Matched by text content – the page structure changed since the comment was made.">
                Matched by text
              </p>
            {/if}

            {#if decided}
              <p class={['mb-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium', c.status === 'approved' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800']}>
                <span aria-hidden="true">{STATUS_MARK[c.status]}</span>
                {STATUS_LABEL[c.status]} by {c.statusBy?.id === user.id ? 'you' : (c.statusBy?.name ?? c.statusBy?.email ?? 'someone')}
                {#if c.statusAt}<time datetime={c.statusAt} title={fmt(c.statusAt)}>· {ago(c.statusAt)}</time>{/if}
              </p>
            {/if}

            {#if editing?.id === c.id}
              <textarea class="input min-h-20 resize-y" bind:value={editing.body} disabled={editing.saving} onclick={(e) => e.stopPropagation()}></textarea>
              <div class="mt-2 flex justify-end gap-2">
                <button class="btn-ghost" onclick={(e) => { e.stopPropagation(); editing = null; }}>Cancel</button>
                <button class="btn-primary" onclick={(e) => { e.stopPropagation(); saveEdit(); }} disabled={editing.saving || !editing.body.trim()}>Save</button>
              </div>
            {:else}
              <p class={['whitespace-pre-wrap text-sm leading-relaxed', decided ? 'text-gray-500' : 'text-gray-800']}>{c.body}</p>
            {/if}

            {#if c.replies.length > 0}
              <ul class="mt-2.5 space-y-2 border-l-2 border-gray-200 pl-2.5">
                {#each c.replies as r (r.id)}
                  {@const canEditReply = r.mine || user.role === 'admin'}
                  <li class="group/reply">
                    <div class="flex items-baseline justify-between gap-2">
                      <span class="truncate text-xs font-medium text-gray-700" title={r.author.email}>{r.mine ? 'You' : (r.author.name ?? r.author.email)}</span>
                      <time class="shrink-0 text-[10px] text-gray-400" datetime={r.createdAt} title={fmt(r.createdAt)}>{ago(r.createdAt)}</time>
                    </div>
                    {#if editingReply?.id === r.id}
                      <textarea class="input mt-1 min-h-16 resize-y" bind:value={editingReply.body} disabled={editingReply.saving} onclick={(e) => e.stopPropagation()}></textarea>
                      <div class="mt-1.5 flex justify-end gap-2">
                        <button class="btn-ghost !px-2 !py-0.5 !text-xs" onclick={(e) => { e.stopPropagation(); editingReply = null; }}>Cancel</button>
                        <button class="btn-primary !px-2 !py-0.5 !text-xs" onclick={(e) => { e.stopPropagation(); saveReplyEdit(); }} disabled={editingReply.saving || !editingReply.body.trim()}>Save</button>
                      </div>
                    {:else}
                      <p class="whitespace-pre-wrap text-[13px] leading-relaxed text-gray-700">{r.body}</p>
                      {#if canEditReply}
                        <div class="mt-0.5 flex gap-1 text-xs opacity-0 transition-opacity group-hover/reply:opacity-100 group-focus-within/reply:opacity-100">
                          <button class="btn-ghost !px-1.5 !py-0 !text-[11px]" onclick={(e) => { e.stopPropagation(); startReplyEdit(c, r); }}>Edit</button>
                          <button class="btn-ghost !px-1.5 !py-0 !text-[11px] text-red-700 hover:bg-red-50 hover:text-red-800" onclick={(e) => { e.stopPropagation(); removeReply(c, r); }}>Delete</button>
                        </div>
                      {/if}
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}

            {#if replying?.commentId === c.id}
              <div class="mt-2.5">
                <textarea
                  id={`reply-${c.id}`}
                  class="input min-h-16 resize-y"
                  placeholder="Reply…"
                  bind:value={replying.body}
                  disabled={replying.saving}
                  onclick={(e) => e.stopPropagation()}
                ></textarea>
                <div class="mt-1.5 flex items-center justify-between">
                  <span class="meta">⌘↵ send · esc cancel</span>
                  <div class="flex gap-2">
                    <button class="btn-ghost !px-2 !py-0.5 !text-xs" onclick={(e) => { e.stopPropagation(); replying = null; }} disabled={replying.saving}>Cancel</button>
                    <button class="btn-primary !px-2 !py-0.5 !text-xs" onclick={(e) => { e.stopPropagation(); saveReply(); }} disabled={replying.saving || !replying.body.trim()}>
                      {replying.saving ? 'Sending…' : 'Reply'}
                    </button>
                  </div>
                </div>
              </div>
            {:else if editing?.id !== c.id}
              <div class="mt-2 flex items-center justify-between gap-1 text-xs">
                <button class="btn-ghost !px-2 !py-0.5 !text-xs" onclick={(e) => { e.stopPropagation(); startReply(c); }}>Reply</button>
                <div class="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  {#if canManage}
                    {#if decided}
                      <button class="btn-ghost !px-2 !py-0.5 !text-xs" onclick={(e) => { e.stopPropagation(); decide(c, 'open'); }}>Reopen</button>
                    {:else}
                      <button class="btn-ghost !px-2 !py-0.5 !text-xs text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800" onclick={(e) => { e.stopPropagation(); decide(c, 'approved'); }}>Approve</button>
                      <button class="btn-ghost !px-2 !py-0.5 !text-xs text-red-700 hover:bg-red-50 hover:text-red-800" onclick={(e) => { e.stopPropagation(); decide(c, 'rejected'); }}>Reject</button>
                    {/if}
                  {/if}
                  {#if canEdit}
                    <button class="btn-ghost !px-2 !py-0.5 !text-xs" onclick={(e) => { e.stopPropagation(); startEdit(c); }}>Edit</button>
                    <button class="btn-ghost !px-2 !py-0.5 !text-xs text-red-700 hover:bg-red-50 hover:text-red-800" onclick={(e) => { e.stopPropagation(); remove(c); }}>Delete</button>
                  {/if}
                </div>
              </div>
            {/if}
          </article>
        {/each}
      </div>

      {#if user.role === 'admin'}
        <a class="flex items-center justify-between border-t border-gray-200 bg-white px-3 py-2.5 text-xs font-medium text-gray-600 transition-colors hover:text-gray-900" href={`/admin/projects/${project.id}`}>
          Manage project &amp; export
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </a>
      {/if}
    </aside>
  </div>
</div>
