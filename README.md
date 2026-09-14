# Reviewer

A tool for reviewing websites. Pick a project (a website URL), see the site in a frame, click any element, write a comment – it stays anchored to that element like a tracked change in Word. Anyone can reply to a comment; a project manager – an admin, or an owner the admin picked for that project – approves or rejects it, and the export carries only the approved ones by default. Everyone sees all comments; users edit only their own while they are open.

No widget on the target site: the page is served through Reviewer's own reverse proxy, so the frame is same-origin and the app can work with its DOM directly.

```
Browser ── HTTPS ──▶ Traefik ──▶ oauth2-proxy (Entra ID) ──▶ reviewer (Astro SSR, Node 22) ──▶ SQLite (/data)
                                                                   └── /p/{projectId}/*  ──▶ target website
```

Documentation: [`docs/functional-spec.md`](./docs/functional-spec.md) – what the tool does, roles, flows, scope · [`docs/architecture.md`](./docs/architecture.md) – how it is built and why. This README covers running and deploying it.

## Features (MVP)

- Sign-in via Microsoft Entra ID (oauth2-proxy), roles `admin` / `user` from Entra **app roles**
- Admin: create / edit / delete projects (name + base URL, with reachability check), pick project owners, overview of all comments with filters, export to Markdown / CSV / JSON
- Owner: a non-admin who manages one project's comments – approve / reject, overview, export – without touching its settings
- User: pick a project, comment, see everybody's comments, edit / delete own while open, reply to anyone's
- Replies and a status: flat threads under each comment; a project manager approves, rejects or reopens; decided comments are hidden from the review screen until asked for; the export selects by status and defaults to approved only
- Review screen: site in an iframe, hover highlight, `+` button, comment anchored to the element, right-hand sidebar (all / mine), in-frame navigation with path bar, back / forward / reload
- Comments survive redeploys: three anchors per comment (CSS selector → XPath → text snippet), "element not found" fallback – the text never disappears
- Single Docker image, SQLite on a volume, migrations run at start

## Local development (no oauth2-proxy)

```bash
npm install
cp .env.example .env        # DEV_USER=you@example.com:admin, ALLOW_PRIVATE_TARGETS=true …
npm run dev                 # http://localhost:4321
```

`DEV_USER="email[:role]"` fakes the identity headers oauth2-proxy would send. It is ignored when `NODE_ENV=production`, so it can never leak into a deployment. `ALLOW_PRIVATE_TARGETS=true` / `ALLOW_HTTP_TARGETS=true` let you register `http://localhost:…` sites.

Other scripts:

```bash
npm test                    # vitest – proxy rewriting, auth/role mapping, URL validation
npm run build && npm start  # production build, served by node dist/server/entry.mjs
npm run db:generate         # new Drizzle migration after editing src/lib/db/schema.ts
docker compose up --build   # same thing in Docker, still without auth (see docker-compose.yml)
```

## Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_PATH` | `./data/reviewer.db` (`/data/reviewer.db` in Docker) | SQLite file; parent dir is created |
| `PUBLIC_ORIGIN` | derived from `X-Forwarded-Proto/Host` | Public origin of Reviewer, e.g. `https://reviewer.example.com`. Used for absolute links inside proxied pages – set it in production |
| `ADMIN_EMAILS` | – | Comma-separated bootstrap admins (case-insensitive). Keep empty once app roles are assigned |
| `DEFAULT_ROLE` | – | Role for signed-in users without an `ADMIN`/`USER` app role: `user`, or empty (→ 403). `admin` also works, for local dev only |
| `DEV_USER` | – | Dev only: fake identity `email[:role]` |
| `ALLOW_PRIVATE_TARGETS` | `false` | Dev only: allow project URLs resolving to private / loopback addresses |
| `ALLOW_HTTP_TARGETS` | `false` | Allow `http://` project URLs |
| `HOST`, `PORT` | `0.0.0.0`, `4321` | Listen address |

## Deployment

[`deploy/docker-compose.yaml`](./deploy/docker-compose.yaml) is a complete, self-contained stack:
Traefik (TLS via Let's Encrypt) → oauth2-proxy (Entra ID, sessions in Redis) → reviewer → SQLite on a
volume. Nothing in it is tied to a particular environment – all site-specific values live in
`deploy/.env`.

1. **Entra ID app registration** (see below) → tenant id, client id, client secret, redirect URI
   `https://<your-host>/oauth2/callback`.
2. `cp deploy/.env.example deploy/.env && chmod 600 deploy/.env`, then fill in the host, the ACME
   contact e-mail, the Entra credentials and a cookie secret.
3. Point DNS for that host at the server and make sure ports 80 and 443 are free.
4. `docker compose -f deploy/docker-compose.yaml up -d` – the image is pulled from GHCR, which is
   public, so no registry login is needed.
5. Sign in. Verify what the proxy sees at `https://<your-host>/oauth2/userinfo` – `groups` should
   list your app roles.

Already running Traefik and Redis? Take only the `oauth2-reviewer` and `reviewer` services from the
file, drop `traefik`/`redis` from their `depends_on` and point
`OAUTH2_PROXY_REDIS_CONNECTION_URL` at your Redis.

### Releases

`.github/workflows/release.yml` builds the image, pushes it to GHCR and opens a GitHub Release whenever a version tag is pushed:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The tag `v0.1.0` publishes `ghcr.io/cloudfieldcz/reviewer:0.1.0` and `:latest`, and then creates the release
`v0.1.0` with notes listing every commit since the previous version tag plus the `docker pull` line. The release
step runs after the image build, so a release never points at an image that failed to publish. To roll a
deployment forward, pull and recreate: `docker compose pull reviewer && docker compose up -d reviewer`.

The app listens only on the internal Docker network and rejects requests without the identity headers (`401`), so it cannot be used without going through oauth2-proxy. Backup = copy `/data/reviewer.db` from the `reviewer-data` volume.

### Entra ID app registration

1. *App registrations → New registration*: Web platform, redirect URI `https://<your-host>/oauth2/callback`. Create a client secret.
2. *Token configuration → Add optional claim → ID → `email`* (Entra does not include it by default).
3. *App roles → Create app role* twice:

   | Display name | Value | Allowed member types |
   |---|---|---|
   | Admin | `ADMIN` | Users/Groups |
   | User | `USER` | Users/Groups |

4. *Enterprise applications → Reviewer → Users and groups*: assign users or groups (e.g. `sg-reviewer-admins`, `sg-reviewer-users`) to the roles.
5. Optional hardening: *Properties → Assignment required = Yes* and `OAUTH2_PROXY_ALLOWED_GROUPS=ADMIN,USER` + `DEFAULT_ROLE=""` – then only assigned people get in at all. With the defaults in `deploy/.env.example` (`DEFAULT_ROLE=user`) anyone in the tenant can sign in and comment, and admins are whoever has the `ADMIN` role or is listed in `ADMIN_EMAILS`.

oauth2-proxy reads the `roles` claim as groups (`OAUTH2_PROXY_OIDC_GROUPS_CLAIM=roles`) and forwards it as `X-Forwarded-Groups: ADMIN,USER`. The role is evaluated **on every request** from that header – the `users.role` column is only a cache for the admin overview. Removing a role in Entra takes effect after the session refresh (`OAUTH2_PROXY_COOKIE_REFRESH`, 1 h).

## How the proxy works

`GET /p/{projectId}/{path}` fetches `{base_url}/{path}` (10 s timeout, 10 MB cap, fixed user agent, no cookies) and:

- strips `X-Frame-Options`, `Content-Security-Policy*`, `Set-Cookie`, COOP/COEP/CORP and friends;
- removes CSP `<meta>` tags and any `<base>`, then inserts `<base href="{original page URL}">` so assets, CSS and scripts load straight from the origin;
- rewrites `a[href]`, `area[href]`, `form[action]` and `meta refresh` that point inside the base URL to absolute `{PUBLIC_ORIGIN}/p/{id}/…` URLs; external links get `target="_blank"`;
- maps 3xx `Location` headers back into the proxy;
- appends a small inline script that keeps client-side routers (`pushState`) and dynamically created links inside the proxy and reports route changes to the parent via `postMessage`;
- non-HTML responses are streamed through unchanged (a fallback – normally assets never touch the proxy).

Only paths under the registered base URL are proxied – there is no `?url=` open proxy. Base URLs are validated when a project is created: `https://` only (unless `ALLOW_HTTP_TARGETS`), no credentials, and the host must resolve to public addresses (`ALLOW_PRIVATE_TARGETS` disables this for dev).

Only `GET` is proxied – any other method on `/p/{id}/…` returns `405`. `GET` forms therefore work through the proxy; the injected script sends `POST` forms to the original site in a new tab.

Known limitations (accepted for the MVP): sites behind a login, `fetch('/api/…')` calls from the page (CORS against the origin), `location.origin` used by page scripts, fonts with strict CORS. Heavy SPA routing may need the browse-mode reload.

## Anchoring

When a comment is saved, the app stores: a short unique CSS selector (`@medv/finder`), a positional XPath, the first 80 characters of the element's text, the tag name and the element's document-relative `top` (for sidebar ordering).

Resolution order when a page loads: selector hit whose text still matches → XPath hit whose text matches → any element of the same tag with the same text (shown as *matched by text*) → unique selector hit with changed text (the element was probably edited in response to the comment). A positional XPath alone is never trusted. Anchoring is retried a few times after load for pages that render late. If nothing matches, the comment stays in the sidebar flagged *element not found*.

## API

All under `/api`, JSON, identity from the middleware.

```
GET    /api/me                                   { email, name, role }
GET    /api/health                               (no auth) { ok: true }

GET    /api/projects                             both roles
POST   /api/projects                             admin   { name, baseUrl }
POST   /api/projects/probe                       admin   { url } → { ok, status, title, error }
GET    /api/projects/:id
PATCH  /api/projects/:id                         admin
DELETE /api/projects/:id                         admin   (cascades to comments)
GET    /api/projects/:id/export?format=csv|md|json[&status=approved,rejected|all][&path=/x][&download=0]
                                                 admin or owner; status defaults to approved, unknown values → 400
GET    /api/projects/:id/owners                  admin or owner   [{ id, name, email, addedAt }]
PUT    /api/projects/:id/owners                  admin   { userIds: number[] } – replaces the set (PUT on purpose: not forgeable by a cross-site form)

GET    /api/comments?project=ID[&path=/x]        every comment of the page; items carry author {name,email}, mine,
                                                 status / statusAt / statusBy and the full replies[] list
POST   /api/comments                             { project_id, page_path, viewport, body, selector, xpath, text_snippet, tag_name, rect_top }
GET    /api/comments/:id
PATCH  /api/comments/:id                         { body }    author while open (admin: any)
                                                 { status: open|approved|rejected }   admin or project owner
                                                 both keys at once → 400
DELETE /api/comments/:id                         author while open, or admin / project owner   (cascades to replies)

POST   /api/comments/:id/replies                 any signed-in user, in every comment status   { body }
PATCH  /api/replies/:id                          own only   { body }
DELETE /api/replies/:id                          own, or admin / project owner
```

## Project layout

```
src/
  middleware.ts            identity headers → locals.user (401/403)
  lib/auth.ts              role mapping (X-Forwarded-Groups, ADMIN_EMAILS, DEFAULT_ROLE, DEV_USER)
  lib/db/                  Drizzle schema + SQLite connection + migrations (drizzle/)
  lib/access.ts            project access level (admin / owner / reviewer), owner CRUD
  lib/projects.ts, comments.ts, replies.ts, export.ts, url.ts (SSRF guard)
  lib/proxy/               fetch.ts (undici, limits) · rewrite.ts (cheerio) · inject.ts · handler.ts
  lib/client/              anchor.ts (finder/xpath/text) · overlay.ts (outline, +, markers) · api.ts
  components/Review.svelte the review screen island (toolbar, iframe wiring, sidebar)
  pages/                   index (projects) · review/[id] · projects/[id]/manage · admin/users · p/[id]/[...path] · api/*
tests/                     vitest: proxy rewriting, auth, URL validation, project counts, access levels and owners,
                           comment / reply / status permissions, the PATCH dispatch, export rendering and filter
deploy/                    full compose stack (Traefik + oauth2-proxy + Redis) + env example
```

## License

Apache-2.0 – see [LICENSE](./LICENSE).
