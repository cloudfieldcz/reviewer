# Comment status and project owners — a three-state verdict on every comment, and per-project managers

## Overview

Three changes that together turn Reviewer from "everyone comments, one global admin decides
everything" into "a review round ends in a verdict, and each project has people who can give it":

1. A comment carries a **status** — `open`, `approved` or `rejected` — replacing the boolean
   *resolved* shipped in v0.1.3.
2. **Export selects by status**, defaulting to `approved` only, and carries the whole thread
   (replies plus who set the status and when).
3. A project has **owners**: people picked from the user table who may work with that project's
   comments exactly as an admin would, without being admins anywhere else.

### Why

- **"Resolved" cannot say no.** A review round produces two kinds of outcome — *do it* and *we are
  not doing it* — and the current model collapses them into one. A rejected comment that looks
  identical to a done one makes the export useless as a work order, which is the export's only job.
- **The export is the deliverable.** What gets pasted into an issue tracker should be the agreed
  work, not the whole discussion including everything that was turned down. Defaulting the export to
  approved-only is the point of having statuses at all.
- **One global admin does not scale past one client.** Today the only way to let someone manage a
  project's comments is to make them an admin of the whole instance — which also hands them every
  other client's project, the user overview and project deletion. Per-project owners are the
  smallest thing that fixes it.
- Reverses a documented MVP decision (`docs/functional-spec.md`: *"There is no per-project assignment
  in the MVP"*). That line is now wrong and the spec says so deliberately, so it has to be rewritten
  rather than quietly contradicted.

### Requirements, as given

Stated by the user, not inferred:

- Statuses are `open`, `approved`, `rejected`. **`resolved` disappears entirely** — no alias, no
  compatibility shim.
- Export can select which statuses to include; the default is approved only.
- The export carries the whole thread — the comment, its replies, and the current status with who
  set it and when. **No audit log of intermediate transitions.**
- A project's owners are chosen as pills from the existing `users` table.
- A real admin creates the project and adds owners. Owners then work with that project's comments:
  the overview, export, approve/reject, and deleting other people's comments.
- Owners get **comments only, not settings** — renaming the project, changing its base URL and
  deleting it stay with global admins.
- Project **visibility does not change**: every signed-in user still sees every project and can
  comment. Ownership grants rights, never access.
- Owner pills are picked **only** from `users` — people who have signed in at least once. No
  pre-registering an e-mail that has never logged in.

### Assumptions, to be corrected if wrong

- Both `approved` and `rejected` are "decided" and both drop out of the review sidebar by default;
  `open` is the working set.
- Owners may not manage the owner list — that is escalation of privilege and stays with admins.
- Anyone may still reply to any comment in any status, as today.
- Setting a status is not restricted to the comment's author: it is a manager action (admin or
  owner). The author of a comment has no say in its verdict.

## Current state

### Authorization, today

Every authorization decision in the codebase is one of two shapes, and both ask the same global
question:

| Location | Check |
|---|---|
| `src/lib/http.ts:20-22` | `requireAdmin(ctx)` — `ctx.locals.user.role !== 'admin'` → 403 |
| `src/pages/api/projects/index.ts:8` | create project |
| `src/pages/api/projects/probe.ts:7` | probe a URL |
| `src/pages/api/projects/[id]/index.ts:8,14` | update / delete project |
| `src/pages/api/projects/[id]/export.ts:8` | export |
| `src/pages/admin/projects/[id].astro:7` | manage page |
| `src/pages/admin/users.astro:6` | user overview |
| `src/lib/comments.ts:164-168` | `assertCanModify()` — `!c.mine && viewer.role !== 'admin'` |
| `src/lib/replies.ts:89-93` | same shape for replies |
| `src/components/Review.svelte:885,948,1013` | UI gating (convenience only) |
| `src/pages/index.astro:7` | the "Manage" button on a tile |
| `src/layouts/Layout.astro:58` | the "Users" nav link |

`role` is recomputed from the oauth2-proxy headers on every request in `resolveRole()`
(`src/lib/auth.ts:28-37`); `users.role` in SQLite is only a cache for the overview and is never
authorized against. That invariant must survive this change.

There is no concept of "this user, on this project". `getProject()` (`src/lib/projects.ts:29-33`)
takes no viewer at all.

### The comment status, today

`comments.resolved_at` / `resolved_by` (`src/lib/db/schema.ts:45-47`), surfaced as
`CommentDto.resolvedAt` / `resolvedBy` (`src/lib/comments.ts:34-35`) via an aliased second join on
`users` (`src/lib/comments.ts:40`). Written by `setResolved()` (`src/lib/comments.ts:183-190`),
which is guarded by `assertCanModify()` — the comment's **author** or an admin.

The review screen hides resolved comments behind one boolean toggle
(`src/components/Review.svelte:43,77-88,807-818`) and the markers get a grey ✓
(`src/lib/client/overlay.ts:166-168`).

### The export, today

`GET /api/projects/[id]/export.ts` is admin-only, takes `format` and an optional `path`, and hands
**every** comment of that scope to `exportComments()` (`src/lib/export.ts:7-44`). There is no way to
narrow by outcome. Markdown already nests replies (`src/lib/export.ts:70-72`) and flags resolved ones
(`src/lib/export.ts:68`); CSV carries `resolved_at` / `resolved_by` (`src/lib/export.ts:25-26`).

| Aspect | Current state | Proposed state |
|---|---|---|
| Comment outcome | `resolved_at` nullable — done / not done | `status` enum — `open` / `approved` / `rejected` |
| Who decides the outcome | comment author or global admin | project manager: global admin or project owner |
| Who may edit/delete a comment | its author or global admin | its author, or a project manager |
| Export scope | everything in the path | statuses selected by the caller, default `approved` |
| Export content | comment + replies + resolved flag | comment + replies + status, who set it, when |
| Project management | global admins only | admins (everything) + owners (comments only) |
| Project visibility | every signed-in user | unchanged — every signed-in user |
| Authorization primitive | `requireAdmin(ctx)` | `requireProjectManager(projectId, viewer)` alongside it |

## Proposed solution

### Architecture

One new idea, deliberately small: **project access level**, derived per request from the global role
plus one membership row.

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
                                 no   ──▶  access = 'reviewer'   (comment, reply, edit own)
```

Three properties this must keep, and each is a way the change could go wrong:

- **Ownership is additive, never a substitute for authentication.** A user who loses their Entra
  role is rejected by the middleware (`src/middleware.ts:10-20`) before ownership is ever consulted.
  Being an owner of a project cannot let anybody into the app.
- **`users.role` stays a cache.** `project_owners` stores a membership fact keyed by `users.id`, not
  a copy of a role, so reading it is not the thing CLAUDE.md forbids. The global role continues to
  come from the headers on every request.
- **Owners cannot widen their own reach.** Managing the owner list, creating projects, changing
  settings, deleting a project and the user overview all stay on `requireAdmin`. An owner's rights
  end at their project's comments.

### Database changes

```sql
-- 1. status replaces the resolved pair
ALTER TABLE comments ADD COLUMN status    TEXT NOT NULL DEFAULT 'open';  -- open | approved | rejected
ALTER TABLE comments ADD COLUMN status_at TEXT;                          -- when it was last set
ALTER TABLE comments ADD COLUMN status_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- data carry-over: everything resolved in v0.1.3 becomes approved, keeping who and when
UPDATE comments
   SET status = 'approved', status_at = resolved_at, status_by = resolved_by
 WHERE resolved_at IS NOT NULL;

ALTER TABLE comments DROP COLUMN resolved_at;
ALTER TABLE comments DROP COLUMN resolved_by;

-- 2. project owners
CREATE TABLE project_owners (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  added_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_owners_user_idx ON project_owners (user_id);
```

**`comments`, new columns**

| Column | Type | Description |
|---|---|---|
| `status` | `TEXT NOT NULL DEFAULT 'open'` | `open` \| `approved` \| `rejected`. Not a DB enum — SQLite has none; `normalizeStatus()` is the gate, matching how `viewport` is handled today |
| `status_at` | `TEXT` | When the status was last changed; `NULL` while still `open` |
| `status_by` | `INTEGER → users` | Who changed it; `SET NULL` so deleting a user never deletes a verdict |

**`project_owners`**

| Column | Type | Description |
|---|---|---|
| `project_id` | `INTEGER → projects CASCADE` | Deleting a project drops its ownership rows |
| `user_id` | `INTEGER → users CASCADE` | Deleting a user drops their ownerships |
| `added_at` | `TEXT NOT NULL` | For the manage screen |
| `added_by` | `INTEGER → users SET NULL` | Who granted it — the one piece of audit worth keeping, since this is a privilege grant |
| PK | `(project_id, user_id)` | Makes a duplicate grant impossible at the storage layer rather than in a check |

`project_owners_user_idx` serves the reverse lookup — "which projects may this person manage" — which
the project list needs to decide whether to show a Manage button per tile.

**Migration mechanics.** `npm run db:generate` produces schema DDL only; it will emit the two
`ADD COLUMN`s and the two `DROP COLUMN`s with no data step between them, which would silently
discard every existing verdict. The generated `drizzle/0003_*.sql` is therefore **hand-edited** to
insert the `UPDATE` between the adds and the drops, and that edit is the reason this migration must
be reviewed by eye rather than trusted. SQLite supports `ALTER TABLE ... DROP COLUMN` from 3.35;
better-sqlite3 ships far newer, so no table rebuild is needed.

### Service layer changes

**New — `src/lib/access.ts`**

```ts
export type ProjectAccess = 'admin' | 'owner' | 'reviewer';

/** Global role first, then one membership lookup. Never reads users.role. */
export function projectAccess(projectId: number, viewer: AuthUser): ProjectAccess;

/** True for 'admin' and 'owner'. */
export function canManageProject(projectId: number, viewer: AuthUser): boolean;

/** Throws HttpError(403) unless admin or owner of this project. */
export function requireProjectManager(projectId: number, viewer: AuthUser): void;

/** Owner list for the manage screen. */
export function listOwners(projectId: number): OwnerDto[];

/** Replaces the whole owner set. Admin only — enforced by the caller, not here. */
export function setOwners(projectId: number, userIds: number[], addedBy: AuthUser): OwnerDto[];

/** Project ids this viewer may manage; empty for admins, who may manage all. */
export function managedProjectIds(viewer: AuthUser): Set<number>;
```

`requireAdmin` in `src/lib/http.ts:20-22` stays exactly as it is and keeps guarding project
creation, settings, deletion, owner management and the user overview.

**Changed — `src/lib/comments.ts`**

```ts
export type CommentStatus = 'open' | 'approved' | 'rejected';
export function normalizeStatus(input: unknown): CommentStatus;      // mirrors normalizeViewport

interface CommentDto {                    // resolvedAt / resolvedBy removed
  status: CommentStatus;
  statusAt: string | null;
  statusBy: { id: number; name: string | null; email: string } | null;
  // …unchanged fields
}

/** Manager action — admin or project owner. Not the comment's author. */
export function setStatus(id: number, status: CommentStatus, viewer: AuthUser): CommentDto;
```

`setResolved()` is deleted. The aliased join at `src/lib/comments.ts:40` is renamed `statusSetter`
and now joins `status_by`. `assertCanModify()` (`:164-168`) widens from
`c.mine || role === 'admin'` to `c.mine || canManageProject(c.projectId, viewer)` — the DTO already
carries `projectId`, so no extra query.

**Changed — `src/lib/replies.ts`**

`assertCanModify()` (`:89-93`) needs the same widening, but `getReply()` (`:64-74`) does not select
the parent's project. Its select gains `comments.projectId` through a join, so a manager can delete a
reply in their project without a second round-trip.

**Changed — `src/lib/export.ts`**

`exportComments()` and `toMarkdown()` keep their signatures; filtering happens before they are
called. The Markdown header counts what it was actually given, broken down by status, and each
bullet carries its verdict inline. CSV swaps `resolved_at, resolved_by` for
`status, status_at, status_by`.

### API changes

```
PATCH  /api/comments/:id        { body }                       author or project manager
                                { status: open|approved|rejected }   project manager only
DELETE /api/comments/:id                                       author or project manager
DELETE /api/replies/:id                                        author or project manager

GET    /api/projects/:id/export?format=…&status=approved       admin or owner
                                        status=approved,rejected
                                        status=all
                                        (absent → approved only)

GET    /api/projects/:id/owners                                admin only
PUT    /api/projects/:id/owners  { userIds: number[] }          admin only — replaces the whole set
```

Two branches of one `PATCH` carrying **different** permissions is the one genuinely error-prone
shape here: `{ body }` is author-or-manager, `{ status }` is manager-only. The route must check the
branch it is actually taking, and a request carrying both must not let the weaker check through —
the simplest safe rule is to reject a body that contains both keys with `400`.

`PUT` (replace the set) rather than `POST`/`DELETE` per owner, because the UI is a pills field whose
natural save is "here is the list now"; it is also idempotent, which per-row endpoints are not.

No new user-search endpoint: the manage page embeds the user list server-side for the pills
typeahead. The table is small (one internal tenant) and the page is admin-only, so nothing leaks to
anyone who could not already open `/admin/users`. Worth revisiting above a few hundred users.

### UI changes

**Review screen** (`src/components/Review.svelte`)

The island is told what the viewer may do rather than deriving it: `review/[id].astro:32` grows a
`canManage` prop computed on the server. The island must never infer authorization from `role`
alone, because owners are `role: 'user'`.

The single resolved toggle (`:807-818`) becomes three filter chips — `● Open n`, `✓ Approved n`,
`✕ Rejected n` — with only *Open* lit by default. `All` / `Mine` (`:802`) keeps filtering by author
*within* the chosen statuses, and its counts follow the selection. Card and marker colour by status:
open keeps its number, approved a green ✓, rejected a red ✕, both muted.

Action row: `Approve` / `Reject` for a manager on an open comment, `Reopen` on a decided one, and
nothing for a plain reviewer. `Reply` stays available to everyone in every status.

**Manage screen** (`src/pages/admin/projects/[id].astro`)

Splits into two zones by access level:

| Zone | admin | owner |
|---|---|---|
| Settings (name, base URL, Delete project) | ✅ | hidden, and the API refuses |
| Owners (pills) | ✅ | hidden, and the API refuses |
| Comment table, filters, export | ✅ | ✅ |

The status filter grows from `All / Open / Resolved` to `All / Open / Approved / Rejected`
(`:84-89`). The export row gets its **own** status select defaulting to *Approved*, independent of
the table filter (`:93-97`): the overview should default to showing everything, because an admin
needs to see what is still undecided, while the export should default to approved only, because that
is what gets handed over. One control cannot have both defaults, so there are two, each labelled.

**Recommended, separable: move the page to `/projects/[id]/manage`.** `/admin/*` currently means
"global admin only" — `src/layouts/Layout.astro:58` and `src/pages/index.astro:7` both encode that
assumption. Letting owners into a URL that says `admin` invites someone to later re-add a blanket
`/admin/*` guard and silently lock owners out. Two link sites change (`index.astro`,
`Review.svelte:1013`) and `/admin/users` stays the only `/admin/*` page. This is a rename, not a
behaviour change, and can be dropped without affecting anything else in this document.

**Project list** (`src/pages/index.astro:7,101`)

`listProjects()` returns `canManage` per tile (a left join against `project_owners` for non-admins,
constant `true` for admins), so an owner sees the Manage button on their projects and nobody else's.

### Configuration

N/A — no new environment variables, no feature flags. Ownership is data, not configuration.

## Affected files

### New files

- `src/lib/access.ts` — project access level, manager guard, owner CRUD
- `src/pages/api/projects/[id]/owners.ts` — `GET` / `PUT`, admin only
- `drizzle/0003_*.sql` — generated, then hand-edited to carry `resolved_*` into `status`
- `tests/access.test.ts` — owner vs. admin vs. reviewer against an in-memory database
- `docs/plans/2026-09-14-comment-status-and-project-owners.md` — this document

### Modified files

- `src/lib/db/schema.ts:45-47` — drop `resolvedAt` / `resolvedBy`, add `status` / `statusAt` /
  `statusBy`; `:57-77` add the `projectOwners` table and its index
- `src/lib/comments.ts:34-35,40,55,65-85,96,109` — DTO, aliased join and row mapping move from
  resolved to status; `:164-168` `assertCanModify` widens to project managers; `:183-190`
  `setResolved` → `setStatus`; new `normalizeStatus`
- `src/lib/replies.ts:64-74` — `getReply` selects the parent's `projectId`; `:89-93` widen to managers
- `src/lib/export.ts:25-26` — CSV columns; `:53-58` header counts by status; `:68` per-bullet verdict
- `src/lib/projects.ts:8-27` — `listProjects()` returns `canManage`
- `src/lib/client/api.ts` — `setResolved` → `setStatus`; owner calls not needed (page-level form)
- `src/lib/client/overlay.ts:13,29-32,166-168` — marker variants per status instead of `resolved`
- `src/components/Review.svelte:43,77-88,316,421-434,802-818,870-871,885-1013` — status chips,
  `canManage` prop, approve/reject/reopen, card and marker styling
- `src/pages/api/comments/[id].ts:8-13` — `{ status }` branch, manager-only, reject mixed bodies
- `src/pages/api/projects/[id]/export.ts:8,12-14` — `requireProjectManager`, `status` parameter
  defaulting to `approved`
- `src/pages/admin/projects/[id].astro:7,21-32,84-97,111,117,142-143` — access split, owner pills,
  status filter, separate export status select
- `src/pages/index.astro:7,101` — Manage button from `canManage`
- `src/pages/review/[id].astro:32` — pass `canManage`
- `tests/comments.test.ts` — resolve cases become status cases with manager permissions
- `tests/export.test.ts` — status rendering and the filter default
- `docs/functional-spec.md`, `docs/architecture.md`, `README.md`, `CLAUDE.md` — see Phase 4

### Unchanged files (important)

- `src/middleware.ts` — authentication is untouched; ownership is checked per route, never in the
  middleware, because ownership grants rights and not access
- `src/lib/auth.ts` — global role resolution is exactly as before; owners are `role: 'user'`
- `src/lib/http.ts` — `requireAdmin` keeps its meaning and its callers for project settings,
  creation, deletion, owner management and the user overview
- `src/lib/proxy/*` — the proxy does not consult roles and must not start; project visibility is
  unchanged
- `src/lib/client/anchor.ts` — anchoring is independent of status
- `src/pages/admin/users.astro` — stays admin-only

## Implementation phases

### Phase 1: Comment status replaces resolved

- `status` / `status_at` / `status_by`, the hand-edited migration carrying v0.1.3 verdicts,
  `normalizeStatus()`, `setStatus()` (admin-only for now), DTO and export rendering, the three
  filter chips and the approve/reject UI.
- Outcome: a working three-state model with today's permissions. Ships on its own.
- Depends on: nothing.
- [ ] Schema + `npm run db:generate`, hand-edit the data step into the generated SQL
- [ ] `normalizeStatus`, `setStatus`, DTO and joins; delete `setResolved`
- [ ] `PATCH { status }` branch, admin-only, mixed-body rejection
- [ ] Review screen: chips, card chip, marker variants, approve/reject/reopen
- [ ] Admin table: status column and filter
- [ ] Tests: transitions, permissions, migration carry-over verified by hand on a copy of the dev DB

### Phase 2: Project owners

- `project_owners`, `src/lib/access.ts`, the owners API, the pills editor, the manage-page access
  split, `canManage` on tiles and in the review island. `setStatus` and both `assertCanModify`
  helpers widen from admin to project manager.
- Outcome: an admin can hand a project to someone who is not an admin.
- Depends on: Phase 1 (it is what `setStatus` widens).
- [ ] Table, index, `access.ts` with `projectAccess` / `requireProjectManager` / owner CRUD
- [ ] `GET` / `PUT /api/projects/:id/owners`, admin only
- [ ] Widen `setStatus`, `comments.assertCanModify`, `replies.assertCanModify`, export
- [ ] Manage page: zones by access, pills editor with typeahead from the embedded user list
- [ ] `listProjects().canManage`, tile button, `canManage` prop into `Review.svelte`
- [ ] Optional rename `/admin/projects/[id]` → `/projects/[id]/manage`
- [ ] Tests: owner may set status and delete others' comments; owner may not rename, delete or
      grant ownership; reviewer may do neither; admin may do all

### Phase 3: Export selects by status and carries the thread

- `status` query parameter defaulting to `approved`, the separate export select on the manage page,
  Markdown and CSV carrying status and the full reply thread.
- Outcome: the export is a work order of agreed items.
- Depends on: Phases 1 and 2.
- [ ] Parse and validate `status` (`all`, or a comma list), default `approved`
- [ ] `requireProjectManager` on the export route
- [ ] Markdown breakdown header, per-bullet verdict, nested replies; CSV columns
- [ ] Export status select on the manage page, labelled so the default is visible
- [ ] Tests: the default really excludes open and rejected; `all` includes everything

### Phase 4: Documentation

- `docs/functional-spec.md` — concepts (`Status`, `Owner`), the roles table gains an owner column,
  the review-screen and export sections, and the scope section which currently states the opposite
  of this change
- `docs/architecture.md` — data model, the access-level diagram, why ownership is additive
- `README.md` — feature list, the API table, project layout
- `CLAUDE.md` — the authorization section and the replies/resolving section that names `resolved`
- Outcome: no document describes a `resolved` state or claims there is no per-project assignment.
- Depends on: Phases 1-3.

## Risks and mitigations

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| The generated migration drops `resolved_*` without the data step | Every v0.1.3 verdict silently lost | Medium — it is the default output | Hand-edit the `UPDATE` in, read the file before committing, restore a copy of the production DB and run it before tagging |
| `PATCH` body carries both `body` and `status`, taking the weaker check | A reviewer approves their own comment | Medium | Reject a body containing both keys with `400`; a test per branch |
| `Review.svelte` keeps gating on `role === 'admin'` somewhere | Owners silently lose approve/reject | High — three such checks exist today | Pass `canManage` from the server and grep that no `role === 'admin'` remains in the island |
| Owner endpoints guarded by `requireProjectManager` instead of `requireAdmin` | An owner grants ownership to themselves elsewhere — privilege escalation | Low | Owner routes use `requireAdmin`; an explicit test asserts an owner gets 403 |
| Export route widened to owners also widens `path`-less dumps | An owner exports another project | Low | `requireProjectManager(projectId)` is bound to the id in the URL, not to the viewer's other projects; test with two projects |
| A blanket `/admin/*` guard is added later | Owners locked out of manage | Medium if the page stays under `/admin/` | The optional rename removes the trap; otherwise a comment at `middleware.ts` |
| `status` is a free string in SQLite | A typo'd status is stored and matches nothing | Low | `normalizeStatus()` on every write, as `normalizeViewport()` already does |
| Deleting a user orphans verdicts | Export shows "unknown" | Low, accepted | `status_by` is `SET NULL`; rendering falls back, the verdict itself survives |

## Testing

### Unit tests

Against an in-memory database (`DATABASE_PATH=':memory:'`, as `tests/projects.test.ts:6` and
`tests/comments.test.ts` already do):

- `normalizeStatus` maps unknown input to `open`, as `normalizeViewport` maps to `desktop`
- admin sets `approved` → `status_at` and `status_by` recorded; reopening clears both
- owner of the project sets `rejected`; owner of a *different* project gets 403
- comment author who is neither admin nor owner gets 403 on `setStatus`
- author may still edit and delete their own comment; owner may delete someone else's; reviewer may not
- owner may delete someone else's reply; reviewer may not
- `setOwners` replaces the set, is idempotent, and rejects a user id that does not exist
- `projectAccess` returns `admin` for a global admin even with no membership row
- deleting a project removes its `project_owners` rows; deleting a user removes theirs
- export filter: default yields only `approved`; `all` yields everything; a comma list yields the union
- Markdown carries the verdict and nested replies; CSV header has `status, status_at, status_by` and
  no `resolved_*`

### Integration / manual tests

- Sign in as `DEV_USER` admin: create a project, add a non-admin owner, approve and reject comments.
- Switch `DEV_USER` to that owner (`email:user`): the tile shows Manage, the manage page shows the
  comment table but no Settings and no Owners, export works, approve/reject works in the review
  screen, `PATCH /api/projects/:id` and `PUT /api/projects/:id/owners` both return 403.
- Switch to a third non-owner user: no Manage button, the manage page 403s, the review screen offers
  Reply and their own Edit/Delete but no verdict buttons, and the export endpoint 403s.
- **Migration:** copy the real `data/reviewer.db` aside, run the new build against the copy, confirm
  every previously resolved comment is `approved` with its original `status_at` / `status_by`.

### Verification

```bash
npm run check                 # astro check + tsc --noEmit
npm test
npm run build
grep -rn "resolved" src/ docs/ README.md CLAUDE.md     # must return nothing but unrelated prose
grep -rn "role === 'admin'" src/components/            # must return nothing
```

## Notes

- **Backward compatibility.** `CommentDto` is consumed only by this app's own island and export, so
  the field rename is safe. The migration is one-way: rolling back to v0.1.3 after it has run leaves
  `resolved_*` gone. Anyone who needs a rollback path takes a DB copy before deploying — worth saying
  in the release note, since this is the first migration in the project that drops a column.
- **Idempotence.** `PUT /owners` is idempotent by construction. `setStatus` to the value a comment
  already has is a no-op write that refreshes `status_at`; harmless, but the test should pin whether
  that is wanted — the alternative is to skip the write when unchanged.
- **Performance.** `projectAccess` adds at most one indexed primary-key lookup per request that needs
  it, and only for non-admins. `listProjects` adds one left join over a table with one row per
  grant. Neither is on the proxy hot path. The comment list queries are untouched.
- **Edge case — the last owner.** Nothing prevents removing every owner; the project simply returns
  to admin-only management, which is its state today. No special handling.
- **Edge case — an admin who is also an owner.** `projectAccess` returns `admin`; the membership row
  is harmless and survives if they later lose the admin role, which is the useful behaviour.
- **Not built, deliberately.** No audit trail of status transitions (explicitly out of scope), no
  notifications, no per-project reviewer assignment, no owner-managed owners.

## References

- `docs/architecture.md` — *Authentication and roles*, *Data model*
- `docs/functional-spec.md` — *Roles and permissions*, *Scope*
- `CLAUDE.md` — *Auth*, *Replies and resolving*
- v0.1.3 introduced the resolved state this document replaces: commit `a542cfc`
- Existing in-memory DB test harness: `tests/projects.test.ts:1-20`
