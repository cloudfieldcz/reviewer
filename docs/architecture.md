# Architecture

How Reviewer is built and why. For what it does and for whom see
[functional-spec.md](./functional-spec.md); for installation, configuration and deployment see the
[README](../README.md).

## Overview

```
Browser
  │  HTTPS
  ▼
Traefik  (TLS)
  │
  ▼
oauth2-proxy  (Entra ID OIDC, session in Redis, injects X-Forwarded-User / -Email / -Groups)
  │  HTTP, internal Docker network only
  ▼
reviewer (Node 22, Astro 5 SSR)
  ├── /                     project list
  ├── /review/{id}          review screen (iframe + sidebar)
  ├── /projects/{id}/manage project management (admins), comment overview and export (managers)
  ├── /admin/users          user overview – /admin/* means "global admin only"
  ├── /p/{id}/*             reverse proxy of the reviewed site
  └── /api/*                comments, projects, owners, export
  │
  ▼
SQLite  (/data/reviewer.db on a Docker volume)
```

The application has no login screen and no session of its own. It trusts the identity headers from
oauth2-proxy and listens only on the internal network, so it cannot be reached without passing
through authentication.

## The central decision: getting a third-party site into the frame

Everything else follows from this one. Three options were considered:

| Approach | Element anchoring | Effort | Note |
|---|---|---|---|
| Plain `<iframe src="https://site">` | ❌ cross-origin, the DOM is unreachable | low | Also blocked outright by `X-Frame-Options` / CSP |
| **Reverse proxy** — fetch the HTML, rewrite it, serve it from our own origin | ✅ the frame is same-origin, full DOM access | medium | **Chosen** |
| Playwright screenshot + a map of bounding boxes | ✅ but frozen in time | high | Fallback for sites the proxy cannot render |

The reverse proxy wins because it makes the iframe **same-origin**: the parent page can read and
modify `iframe.contentDocument` directly. No `postMessage` protocol for the core work, no script
installed on the reviewed site, and the headers that would block framing are simply removed on the
way through.

The price is that some sites will not render perfectly — client-side routers, login walls, strict
CORS. That trade was accepted: the target is ordinary marketing and content sites, and a
screenshot-based mode remains available later for the rest.

## Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node 22 LTS, TypeScript | |
| Framework | Astro 5 SSR + `@astrojs/node` (standalone) | Pages, API endpoints and middleware in one app |
| Review UI | One Svelte 5 island (`Review.svelte`) | Only one screen is interactive; the rest is server-rendered |
| Database | SQLite via `better-sqlite3` + Drizzle ORM | Typed queries and migrations, zero operational overhead |
| Proxy / HTML | `undici` (fetch) + `cheerio` (rewrite) | Server-side HTML parsing and rewriting |
| Selectors | `@medv/finder` | Generates short, stable, unique CSS selectors |
| Auth | oauth2-proxy | The OIDC flow is not our code to write |
| Styling | Tailwind 4, design tokens in `src/styles/global.css` | |
| Tests | Vitest on proxy rewriting, role mapping and URL validation | The riskiest pure logic |

SQLite is a deliberate fit, not a shortcut: a single long-lived server process, a handful of
concurrent reviewers, WAL mode, and a backup that is one file copy.

## Code map

```
src/
  middleware.ts          identity headers → locals.user; 401/403 for everything but PUBLIC_PATHS
  lib/auth.ts            role resolution, user upsert, DEV_USER fake identity
  lib/env.ts             env() / envFlag() – the only correct way to read configuration
  lib/http.ts            json / HttpError / handler() / requireAdmin / readJson / idParam / str
  lib/access.ts          project access level (admin / owner / reviewer), requireProjectManager, owner CRUD
  lib/db/                schema.ts (users, projects, project_owners, comments, replies) · index.ts (connection, migrations)
  lib/projects.ts        project CRUD, probeUrl(), canManage per tile
  lib/comments.ts        comment CRUD, status (approve / reject / reopen), edit and delete rules, DTO mapping
  lib/replies.ts         reply CRUD – no import of comments.ts, the dependency runs one way
  lib/export.ts          Markdown / CSV / JSON rendering
  lib/url.ts             base-URL normalization, SSRF guard
  lib/proxy/             fetch.ts (limits) · rewrite.ts (cheerio) · inject.ts · handler.ts
  lib/client/            anchor.ts (selector/xpath/text) · overlay.ts (outline, +, markers) · api.ts
  components/Review.svelte   the review screen
  pages/                 index · review/[id] · projects/[id]/manage · admin/users · p/[id]/[...path] · api/*
```

`access.ts` imports nothing from `projects.ts`: `projects.ts` imports it for `canManage` on the
tiles, and `comments.ts` imports `projects.ts`, so the reverse edge would close a cycle. That is why
`requireProjectManager()` takes a raw project id and never 404s — routes call `getProject()` first.

Business logic lives in `lib/`; API routes stay thin and wrap handlers in `handler()`, which turns a
thrown `HttpError` into a JSON error response.

## Look and feel

The tool is chrome around somebody else's website, so the reviewed page is the only bright surface:
the top bars are near-black (`--color-ink`), the neutrals are a graphite scale with a violet cast,
and the accent is violet `#6e56cf` — a colour few client sites use, so the annotation layer never
blends into the page it sits on. The same three colours carry meaning everywhere, in the sidebar and
on the in-page overlay alike: violet = yours, grey = somebody else's, amber = the comment in focus.
Two more carry the verdict and nothing else: a muted green ✓ for approved, a muted red ✕ for
rejected — on the sidebar card, its chip and the marker in the page.

Tokens live in the `@theme` block of `src/styles/global.css`, including the overridden `gray-*`
scale, so the whole app shifts from one place. The overlay drawn inside the proxied page repeats the
hex values in `overlay.ts` because it is injected into a document that never sees our stylesheet.

Type is IBM Plex Sans with IBM Plex Mono for machine strings (paths, tag names, e-mail addresses),
loaded from Google Fonts with a system fallback stack — a browser that cannot reach the CDN gets
system sans, and nothing else changes.

## Authentication and roles

Roles are **not managed in the application**. They are Entra ID app roles (`ADMIN`, `USER`) on the
app registration, delivered in the `roles` claim. oauth2-proxy is configured with
`oidc_groups_claim = "roles"`, so those roles reach the app as `X-Forwarded-Groups: ADMIN,USER`.

```
X-Forwarded-User:               <Entra object id>
X-Forwarded-Email:              jan@example.com
X-Forwarded-Preferred-Username: jan@example.com
X-Forwarded-Groups:             ADMIN,USER
```

Rules that must not be broken:

- **The role is derived from the header on every request.** The `users.role` column is only a cache
  for the admin overview — never authorize against it. Removing a role in Entra takes effect after
  the proxy's session refresh (1 h).
- **Requests without identity headers are rejected** (`401`), and the app binds only to the internal
  Docker network, so nobody can send those headers themselves.
- `ADMIN_EMAILS` is a bootstrap list for first run; `DEFAULT_ROLE` decides what happens to a
  signed-in user with no Reviewer role (`user`, or a `403` when empty).
- `DEV_USER` fakes the whole header set for local development and is hard-disabled when
  `NODE_ENV=production`.

The user row is upserted on sign-in, with the write throttled to once a minute per user to keep it
off the hot path.

### Project access level

The global role is the only thing Entra knows about. Who may *decide* a project's comments is a
second, per-project fact: `project_owners` rows, managed by admins in the app. `lib/access.ts`
derives one level per request:

```
        oauth2-proxy headers
                │
        resolveRole()  ──▶  role: 'admin' | 'user'      (per request, never from the DB cache)
                │
                ├── role === 'admin'          ──▶  access = 'admin'      (every project, everything)
                │
                └── role === 'user'
                        │
                        └── project_owners has (projectId, user.id)?
                                 yes  ──▶  access = 'owner'      (this project's comments)
                                 no   ──▶  access = 'reviewer'   (comment, reply, own while open)
```

`'admin'` and `'owner'` are both *managers*: they approve, reject and reopen, delete anyone's
comment or reply on the project, see the manage page and export. Everything that creates or changes
a project — name, base URL, deletion, the owner list, probing a URL — and the user overview stay
behind `requireAdmin`.

Four properties this must keep, each with a test:

- **Ownership is additive, never a substitute for authentication.** A user without an Entra role is
  rejected by the middleware before ownership is ever consulted. Owning a project cannot let anybody
  into the app.
- **`users.role` stays a cache.** `project_owners` stores a membership fact keyed by `users.id`,
  not a copy of a role; the global role still comes from the headers on every request. The one
  exception was the one-time data migration in `drizzle/0003_*`, which had no other signal and is
  not a precedent.
- **Owners cannot widen their own reach.** `setOwners()` asserts the admin role itself, and
  `managedProjects()` returns `'all'` for admins or an explicit `Set` — never an empty set meaning
  "everything", which any `size === 0 ? all : filter` caller would turn into a silent grant.
- **Owners can never reach the SSRF guard.** `assertPublicHost()` runs only from project creation,
  update and probing, all admin-only. An owner cannot change `base_url`, so cannot aim the proxy
  anywhere — and since the proxy serves target HTML same-origin, that boundary is load-bearing.

Ownership is keyed on `users.id`, which is keyed on the Entra `oid`. A re-provisioned account gets a
new row and inherits nothing; that is correct fail-closed behaviour, so the upsert must not be
"fixed" to key on e-mail. The review island receives the access level as a prop and never looks at
the role — owners are `role: 'user'`. It is a rendering hint: if ownership is revoked while the page
is open, the buttons stay until reload and the API answers 403 into the error bar.

The manage page lives at `/projects/{id}/manage`, not under `/admin/`, because owners reach it and
`/admin/*` must keep meaning "global admin only" — the danger of a blanket `/admin/*` guard is not
that it locks owners out but that someone then weakens it to let them in, exposing `/admin/users`.
The user directory behind the owner pills is fetched only in the admin branch of that page; an
owner's HTML never contains it.

## The reverse proxy

`GET /p/{projectId}/{path}` → fetch `{base_url}/{path}` → rewrite → serve. Only `GET` is proxied;
any other method returns `405`.

**Fetching** (`lib/proxy/fetch.ts`): fixed user agent, 10 s timeout, 10 MB response cap, no cookies
in either direction, redirects handled manually.

**Response headers** (`lib/proxy/rewrite.ts`): `X-Frame-Options`, `Content-Security-Policy` and its
report-only twin, `Set-Cookie`, HSTS, the COOP/COEP/CORP family and hop-by-hop headers are stripped.
Those are exactly the headers that would stop the page from being framed or would leak state between
the reviewed site and Reviewer.

**HTML rewriting** (cheerio):

- CSP and `X-Frame-Options` `<meta>` tags removed;
- any existing `<base>` removed, and `<base href="{URL of this page}">` inserted. Pointing it at the
  page rather than at the site root is what makes relative assets resolve correctly in
  subdirectories, and it means CSS, images and scripts load **straight from the origin** — the proxy
  only ever handles HTML;
- `a[href]`, `area[href]`, `form[action]` and `meta refresh` pointing inside the base URL are
  rewritten to **absolute** `{PUBLIC_ORIGIN}/p/{id}/…` URLs. They must be absolute precisely because
  `<base>` points at the target site — a relative rewrite would resolve against the wrong origin.
  Anything external gets `target="_blank"`;
- `3xx` `Location` headers are mapped back into the proxy when they stay on the target site;
- an inline script (`lib/proxy/inject.ts`) is appended to the body.

**The injected script** is the smallest possible shim, because the parent window can do everything
else through the same-origin DOM. It patches `history.pushState` / `replaceState` so a client-side
router keeps the `/p/{id}` prefix, catches clicks on links created after load, sends `GET` forms
through the proxy and `POST` forms to the original site in a new tab, and reports route changes to
the parent with `postMessage({type: 'reviewer:navigate'})`.

**Security.** There is no `?url=` open proxy — only paths under a registered project's base URL are
reachable. Base URLs are validated when the project is created: `https://` only, no credentials, no
query or fragment, and the host must resolve to public addresses (an SSRF guard in `lib/url.ts`).
`ALLOW_HTTP_TARGETS` and `ALLOW_PRIVATE_TARGETS` relax the last two for local development. Proxied
responses are served `no-store` and `noindex`.

## Element anchoring

The hardest requirement is that a comment still points at the right element after the site has been
rebuilt. When a comment is saved, `lib/client/anchor.ts` records five things: a short unique CSS
selector from `@medv/finder` (framework-generated class names and hashed ids filtered out), a
positional XPath, the first 80 characters of the element's text, the tag name, and the
document-relative `top` for ordering.

On every page load each comment is resolved in this order:

1. a selector hit **whose text still matches**;
2. an XPath hit **whose text matches**;
3. any element with the same tag and the same text, wherever it now sits (reported as *matched by
   text*);
4. a *unique* selector hit whose text has changed — the element was most likely edited in response
   to the comment.

Two properties of that order matter and should not be changed without a test. A positional XPath is
**never trusted on its own**, because inserting one paragraph shifts every sibling index. And a text
match outranks a stale selector, because a selector can stay valid while pointing at a different
element — during testing, a unique selector without a text check resolved to the wrong element after
the DOM changed, which is why the text check comes first.

Resolution is retried a few times after load for pages that render late. Anything that still fails
to resolve keeps its comment in the sidebar, flagged *element not found*.

### Viewport is part of the comment's identity

Responsive sites render a different DOM at phone width — collapsed navigation, reordered or dropped
sections — so an anchor recorded on the phone usually has nothing to match on the desktop and would
show up as *element not found* forever. Rather than making anchoring smarter, the viewport the
comment was written in is stored on the comment (`comments.viewport`, `'desktop' | 'phone'`) and the
review screen only anchors, numbers and lists the comments of the viewport currently shown. The
other viewport's comments are never hidden away silently: the sidebar names their count and switches
to them in one click, and the admin table and exports carry the viewport per row.

The switch itself resizes the frame instead of reloading it: the iframe element is kept, wrapped in
a shell of exactly 393 × 852 CSS pixels (iPhone 15) that is scaled down with a CSS transform when the
window is short. The page keeps a real 393 px viewport at any zoom level, so its own media queries —
not a simulated user agent — decide what it renders. The device pixel ratio and the user agent are
*not* faked; a site that serves a different page by user-agent sniffing will still serve the desktop
one.

## Data model

```sql
users     id, oid (unique, Entra object id), email, name,
          role,              -- 'admin' | 'user' – cache of the last sign-in only
          created_at, last_seen_at

projects  id, name,
          base_url,          -- https://site.example.com, no trailing slash
          created_by → users, created_at

comments  id, project_id → projects (cascade), user_id → users (cascade),
          page_path,         -- '/contact?x=1' – path + query, no origin
          viewport,          -- 'desktop' | 'phone' – the simulated screen it was written on
          body,
          selector, xpath, text_snippet, tag_name, rect_top,   -- anchors
          status,            -- 'open' | 'approved' | 'rejected', default 'open'
          status_at,         -- null while open
          status_by → users (set null),                         -- the verdict outlives its author
          created_at, updated_at

comment_replies
          id, comment_id → comments (cascade), user_id → users (cascade),
          body, created_at, updated_at

project_owners
          project_id → projects (cascade), user_id → users (cascade),
          added_at, added_by → users (set null),                -- who granted it
          primary key (project_id, user_id)
```

Indexes: `comments(project_id, page_path)` — the query behind every page load — `comments(user_id)`,
`comment_replies(comment_id)` and `project_owners(user_id)` for the reverse lookup ("which projects
may this person manage") and the cascade from `users`. There is deliberately **no index on
`comments.status`**: three values, always filtered inside one project whose prefix the path index
already supplies. Foreign keys are enforced (`PRAGMA foreign_keys = ON`); deleting a project takes
its comments and owner rows with it, a comment takes its replies, a user takes their ownerships.

**Replies are their own table, not a `parent_id` on `comments`.** Anchoring, viewport, marker
numbering and the comment counts on the project tiles all query `comments`; a self-join would mean
teaching every one of those queries to exclude reply rows, and each place that forgot would be a
quiet bug. A reply carries no anchor, no viewport and no position — the comment above it does — so
there is nothing for the two to share but a foreign key. Replies for a whole page are fetched in one
`where comment_id in (…)` and grouped in memory, never one query per comment.

**Status is a verdict on the comment, not a deletion.** `status_at` plus `status_by` record when and
by whom; reopening clears both, so an open comment has no decider. The column is plain `TEXT` —
SQLite has no enum — and `normalizeStatus()` is the gate: it *throws* on anything but the three
values, unlike `normalizeViewport()`, which coerces. A viewport is a display attribute where a wrong
value is harmless; a status is a decision record, and coercing `"aproved"` to `open` would silently
reopen a decided comment while answering `200`. Setting the status a comment already holds is a
no-op, so `status_at` records the decision and not the last click.

`PATCH /api/comments/:id` carries both the text edit and the verdict, and dispatches on the
**presence** of the `status` key before any value is inspected: `{ body, status }` is a `400`, and
`{ status: "aproved", body: "x" }` reaches the manager check and fails there, never the weaker
author-only branch. `setStatus()` checks the permission before it validates the value for the same
reason — a reviewer gets `403`, not a hint at what a valid status looks like.

**The export filter fails narrow.** `?status=` absent or empty means `approved`, never everything; an
unknown token is a `400`. A parser that degraded to "no filter" would hand rejected and open items
over as agreed work.

Migrations are generated with `drizzle-kit` into `drizzle/` and applied automatically at startup,
so a fresh volume becomes a working database with no manual step.

**Dropping a column on `comments` is a trap.** For a column drop on SQLite, drizzle-kit emits a full
table rebuild — `CREATE TABLE __new_comments … INSERT … SELECT … DROP TABLE comments … RENAME` —
wrapped in `PRAGMA foreign_keys=OFF/ON`. The migrator runs each migration inside a transaction, where
that pragma is a **no-op**, so with foreign keys on `DROP TABLE comments` fires
`comment_replies.comment_id ON DELETE CASCADE` and every reply in the database is gone (reproduced:
2 replies → 0). Migration `0003` therefore has a hand-written body of plain `ALTER TABLE … ADD /
DROP COLUMN` statements, verified on a copy of production data with the reply count unchanged. Any
future migration that drops or retypes a column on `comments` will regenerate the same rebuild and
must be hand-edited the same way, every statement separated by `--> statement-breakpoint`.

## Known limitations

Accepted for the MVP, listed so nobody rediscovers them as bugs:

| Problem | Effect | Handling |
|---|---|---|
| Client-side routers (`pushState`) | the path can escape `/p/…` | the injected script rewrites it and reports the change; a reload in browse mode always recovers |
| `fetch('/api/…')` from the page | CORS against the real origin | ignored — test sites rarely depend on it |
| Sites behind a login | do not render | out of scope |
| `POST` forms | not proxied (`405`) | the injected script sends them to the original site in a new tab |
| Fonts with strict CORS | occasionally do not load | cosmetic |
| `location.origin` used by page scripts | reads as Reviewer's origin | ignored |

## Testing

Vitest covers the pure logic where a silent regression would be expensive: HTML rewriting and
proxy-path mapping (`tests/rewrite.test.ts`), role resolution and URL validation / SSRF checks
(`tests/auth.test.ts`), and Markdown export rendering (`tests/export.test.ts`).

Four suites run against a real SQLite database opened at `:memory:` (set `DATABASE_PATH` before
importing `lib/db`), because the bugs they guard against are invisible to the type checker: the
project comment counts, including a project that has both comments and owners
(`tests/projects.test.ts`); the permission rules around replying, editing, deleting and deciding for
authors, owners and admins, plus the reply-to-comment grouping (`tests/comments.test.ts`); the
access level, `managedProjects` and `setOwners` (`tests/access.test.ts`); and the `PATCH` route's
key-presence dispatch, driven through the real handler (`tests/comment-patch.test.ts`).

The DOM-dependent parts — anchoring and the overlay — are verified by driving a real browser against
the running app.
