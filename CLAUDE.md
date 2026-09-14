# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Reviewer – an internal website review tool. A project = a target website URL. The site is served
through Reviewer's own reverse proxy at `/p/{projectId}/*`, so the review iframe is **same-origin**
and the app can read and annotate the target DOM directly. Comments are anchored to elements and
survive redeploys of the target site.

Documentation, all of it worth keeping current:
- `docs/functional-spec.md` – product behaviour, roles and permissions, user flows, scope
- `docs/architecture.md` – design decisions, proxy pipeline, anchoring, data model, limitations
- `README.md` – running locally, configuration, Entra ID setup, deployment

## Stack

Astro 5 SSR (`output: 'server'`, `@astrojs/node` standalone) · Svelte 5 (runes) for the single
interactive island · Tailwind 4 via `@tailwindcss/vite` · Drizzle ORM + better-sqlite3 ·
cheerio (HTML rewriting) · undici (target fetches) · vitest · Node 22.

## Commands

```bash
npm install
npm run dev          # http://localhost:4321 – needs DEV_USER in .env (cp .env.example .env)
npm test             # vitest: tests/auth.test.ts, tests/rewrite.test.ts
npm run check        # astro check + tsc --noEmit  (run this before claiming a change compiles)
npm run build        # → dist/, served by `npm start`
npm run db:generate  # drizzle-kit generate, after editing src/lib/db/schema.ts
```

`node_modules` may be absent in a fresh checkout – run `npm install` first.

## Architecture

```
src/
  middleware.ts          identity headers → locals.user; 401/403 for everything except PUBLIC_PATHS
  lib/auth.ts            resolveRole(), upsertUser(), DEV_USER fake identity
  lib/http.ts            json/HttpError/handler()/requireAdmin/readJson/idParam/str helpers
  lib/env.ts             env() / envFlag() – the only correct way to read configuration
  lib/db/                schema.ts (users, projects, comments, replies) + index.ts (connection, migrations)
  lib/projects.ts        CRUD + probeUrl()          lib/comments.ts  CRUD + resolve + DTO mapping
  lib/replies.ts         reply CRUD (must not import comments.ts – comments.ts imports it)
  lib/export.ts          md / csv / json export     lib/url.ts       base-URL normalization + SSRF guard
  lib/proxy/             fetch.ts (undici, limits) · rewrite.ts (cheerio) · inject.ts · handler.ts
  lib/client/            anchor.ts (finder/xpath/text) · overlay.ts (outline, +, markers) · api.ts
  components/Review.svelte   the review screen island
  pages/                 index · review/[id] · admin/projects/[id] · admin/users · p/[id]/[...path] · api/*
```

### Auth
Identity comes **only** from oauth2-proxy headers: `X-Forwarded-User` (oid), `X-Forwarded-Email`,
`X-Forwarded-Groups` (Entra app roles), optionally `X-Forwarded-Name`. The role is recomputed on
every request in `resolveRole()`; `users.role` in SQLite is just a cache for the admin overview –
never authorize against it. `DEV_USER` fakes these headers locally and is hard-disabled when
`NODE_ENV=production`. Keep it that way.

`ctx.locals.user` is set by the middleware and typed as non-optional, so API routes can use it
directly; anything added to `PUBLIC_PATHS` must not touch it.

### Proxy
`GET /p/{id}/{path}` only – every other method returns 405. The handler strips framing/CSP/cookie
headers (`STRIPPED_RESPONSE_HEADERS`), removes CSP `<meta>` and any `<base>`, injects
`<base href="{original page URL}">` so assets load straight from the origin, rewrites
`a[href] / area[href] / form[action] / meta refresh` that stay inside the base URL to **absolute**
`{PUBLIC_ORIGIN}/p/{id}/…` URLs, and appends the inline script from `inject.ts` (client-side router
and dynamic links stay in the proxy; route changes are reported to the parent via
`postMessage {type:'reviewer:navigate'}`).

Rules to preserve:
- No open proxy. Only paths under the project's registered `base_url` are reachable.
- SSRF guard (`assertPublicHost`) runs when a project is created; `ALLOW_PRIVATE_TARGETS` /
  `ALLOW_HTTP_TARGETS` relax it for dev only.
- Limits are `PROXY_TIMEOUT_MS` 10 s and `PROXY_MAX_BYTES` 10 MB, no cookies forwarded either way.
- Links must be rewritten **absolute** (via `PUBLIC_ORIGIN`), because `<base>` points at the target
  site – a relative rewrite would resolve against the target, not against Reviewer.

### Anchoring
`computeAnchor()` stores a `@medv/finder` CSS selector, a positional XPath, the first 80 chars of
text, the tag name and the document-relative `top`. `resolveAnchor()` order:

1. selector hit whose text still matches
2. XPath hit whose text matches
3. any element of the same tag with the same text (`method: 'text'`)
4. a *unique* selector hit whose text changed (element likely edited in response to the comment)

A positional XPath alone is never trusted, and text match outranks a stale selector – do not reorder
these without a test. No match → the comment stays in the sidebar flagged "element not found";
comment text must never disappear.

### Replies and resolving
Replies live in `comment_replies`, **not** as `parent_id` on `comments` – every query behind
anchoring, marker numbering and the project comment counts selects from `comments` and must not have
to filter reply rows out. A reply has no anchor and no viewport; it belongs to the comment. Replies
for a page are loaded in one `inArray` query and grouped in memory – never one query per comment.

Anyone may reply, including on a resolved thread. Resolving is `resolved_at` + `resolved_by` on the
comment and goes through `PATCH /api/comments/:id { resolved }`, guarded by the same
`assertCanModify()` rule as editing: the comment's author or an admin. Reopening clears both
columns; nothing is ever deleted. The review screen hides resolved comments and their markers by
default, and the sidebar's *All* / *Mine* counts mean *open* – but a resolved comment is never
dropped from the list silently, there is always a labelled toggle that brings it back.

Comments also carry the viewport they were written in (`comments.viewport`, `'desktop' | 'phone'`),
because the phone DOM is a different DOM. The review screen anchors and lists **only** the current
viewport's comments; the others are announced in the sidebar with a one-click switch, never dropped.

## Conventions

- **English** everywhere in the repo: code, comments, UI strings, docs, commit messages.
- Business logic lives in `src/lib/*`; `src/pages/api/*` routes stay thin and wrap handlers in
  `handler()` from `lib/http.ts`, throwing `HttpError` for 4xx.
- Svelte 5 runes (`$state`, `$derived`, `$props`) – no legacy stores or `export let`.
- Elements inside the iframe are handled with plain DOM, not Svelte reactivity; overlay nodes are
  marked `data-reviewer-ui` and skipped by `isReviewerNode()`.
- Schema changes: edit `src/lib/db/schema.ts`, then `npm run db:generate` and commit the generated
  file in `drizzle/`. Migrations run automatically at startup from `lib/db/index.ts`.
- Tests cover pure logic (role mapping, URL validation, HTML rewriting). Add cases there when
  touching `lib/auth.ts`, `lib/url.ts` or `lib/proxy/rewrite.ts`.

## Gotchas

- **Always read configuration through `env()` / `envFlag()` from `lib/env.ts`.** Astro loads `.env`
  into `import.meta.env`, while Docker and shell variables land in `process.env` – reading
  `process.env.FOO` directly silently ignores everything in `.env` during `npm run dev`.
- `checkOrigin: false` in `astro.config.mjs` is deliberate: requests arrive via oauth2-proxy with a
  rewritten `Host`, and the app is only reachable on the internal Docker network.
- `PUBLIC_ORIGIN` must be set in production – otherwise rewritten links fall back to the forwarded
  headers and can point at the wrong host.
- oauth2-proxy sends no display name by default, so the UI shows the UPN/e-mail unless
  `X-Forwarded-Name` is configured via its alpha config.
- Deployment is a self-contained stack (`deploy/docker-compose.yaml`: Traefik + Redis +
  oauth2-proxy + reviewer) configured from `deploy/.env`; see the Deployment section of `README.md`.
  Keep it environment-agnostic – no organisation-specific hostnames, tenant ids or e-mails.
