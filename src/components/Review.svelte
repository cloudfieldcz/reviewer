<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { computeAnchor, isReviewerNode, pickMeaningful, resolveAnchor, type Anchor, type ResolveMethod } from '~/lib/client/anchor';
  import { api, type CommentDto } from '~/lib/client/api';
  import { Overlay } from '~/lib/client/overlay';

  interface Props {
    project: { id: number; name: string; baseUrl: string };
    user: { id: number; name: string; role: 'admin' | 'user' };
    initialPath: string;
  }
  let { project, user, initialPath }: Props = $props();

  const PREFIX = `/p/${project.id}`;
  const INTRO_KEY = 'reviewer.intro.v2';
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
  let error = $state<string | null>(null);
  let loading = $state(true);
  let frameError = $state(false);

  // Non-reactive DOM handles (elements live inside the iframe document).
  let overlay: Overlay | null = null;
  let draftEl: Element | null = null;
  let elements = new Map<number, Element>();
  let detachFrame: (() => void) | null = null;
  let sidebarEl = $state<HTMLElement | null>(null);
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  const picking = $derived(commentMode && !altActive);

  const visible = $derived.by(() => {
    void resolved; // element positions change whenever anchors are re-resolved
    return comments
      .filter((c) => filter === 'all' || c.mine)
      .map((c) => ({ ...c, order: liveTop(c) }))
      .sort((a, b) => a.order - b.order || a.id - b.id);
  });
  const numberOf = $derived(new Map(visible.map((c, i) => [c.id, i + 1])));
  const mineCount = $derived(comments.filter((c) => c.mine).length);

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
    for (const c of comments) {
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
        .map((c) => ({ id: c.id, number: numberOf.get(c.id)!, el: elements.get(c.id)!, mine: c.mine, active: c.id === activeId })),
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
    clearTimeout(retryTimer);
    const missing = () => comments.some((c) => !elements.has(c.id));
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
      const created = await api.createComment(project.id, path, draft.body, draft.anchor);
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
      else if (editing) editing = null;
      else cancelDraft();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if (draft) saveDraft();
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
    <div class="relative min-w-0 flex-1 bg-white">
      <iframe
        bind:this={iframe}
        src={frameSrc(initialPath)}
        title={project.name}
        class="h-full w-full border-0"
        onload={onFrameLoad}
      ></iframe>

      <!-- The viewport is framed in the mode colour: state you read without reading. -->
      <div class={['pointer-events-none absolute inset-0 border-2 transition-colors duration-200', picking ? 'border-brand' : 'border-transparent']}></div>

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
          <h2 class="text-sm font-semibold tracking-tight">Comments</h2>
          <div class="seg" role="group" aria-label="Filter comments">
            <button class={filter === 'all' ? 'seg-item-on' : 'seg-item'} onclick={() => (filter = 'all')} aria-pressed={filter === 'all'}>All {comments.length}</button>
            <button class={filter === 'mine' ? 'seg-item-on' : 'seg-item'} onclick={() => (filter = 'mine')} aria-pressed={filter === 'mine'}>Mine {mineCount}</button>
          </div>
        </div>
        <p class="meta mt-1 truncate" title={project.baseUrl + path}>{path}</p>
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
            <p class="text-sm font-medium text-gray-700">{filter === 'mine' ? 'Nothing from you on this page' : 'No comments on this page'}</p>
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
          {@const canEdit = c.mine || user.role === 'admin'}
          {@const isActive = activeId === c.id}
          <article
            data-cid={c.id}
            class={[
              'group relative cursor-pointer overflow-hidden rounded-lg border bg-white p-3 pl-3.5 shadow-card transition-all',
              isActive ? 'border-amber-400 ring-2 ring-amber-400/30' : 'border-gray-200 hover:border-gray-300 hover:shadow-pop',
            ]}
            role="button"
            tabindex="0"
            onclick={() => focusComment(c.id, { scrollFrame: true })}
            onkeydown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) focusComment(c.id, { scrollFrame: true }); }}
          >
            <span class={['absolute inset-y-0 left-0 w-1', isActive ? 'bg-amber-400' : c.mine ? 'bg-brand' : 'bg-gray-300']}></span>

            <div class="mb-1.5 flex items-start justify-between gap-2">
              <div class="flex min-w-0 items-center gap-2">
                <span class={['inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums', isActive ? 'bg-amber-400 text-gray-900' : c.mine ? 'bg-brand text-white' : 'bg-gray-500 text-white']}>
                  {numberOf.get(c.id)}
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

            {#if editing?.id === c.id}
              <textarea class="input min-h-20 resize-y" bind:value={editing.body} disabled={editing.saving} onclick={(e) => e.stopPropagation()}></textarea>
              <div class="mt-2 flex justify-end gap-2">
                <button class="btn-ghost" onclick={(e) => { e.stopPropagation(); editing = null; }}>Cancel</button>
                <button class="btn-primary" onclick={(e) => { e.stopPropagation(); saveEdit(); }} disabled={editing.saving || !editing.body.trim()}>Save</button>
              </div>
            {:else}
              <p class="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{c.body}</p>
              {#if canEdit}
                <div class="mt-2 flex justify-end gap-1 text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <button class="btn-ghost !px-2 !py-0.5 !text-xs" onclick={(e) => { e.stopPropagation(); startEdit(c); }}>Edit</button>
                  <button class="btn-ghost !px-2 !py-0.5 !text-xs text-red-700 hover:bg-red-50 hover:text-red-800" onclick={(e) => { e.stopPropagation(); remove(c); }}>Delete</button>
                </div>
              {/if}
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
