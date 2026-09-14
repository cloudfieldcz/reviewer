# Comment status and project owners — a three-state verdict on every comment, and per-project managers

> Revised after BA / developer / security / performance cross-check. The migration section in the
> first draft was factually wrong and would have deleted every reply in the database; see
> *Migration mechanics*.

## Overview

Three changes that together turn Reviewer from "everyone comments, one global admin decides
everything" into "a review round ends in a verdict, and each project has people who can give it":

1. A comment carries a **status** — `open`, `approved` or `rejected` — replacing the boolean
   *resolved* shipped in v0.1.3.
2. **Export selects by status**, defaulting to `approved` only, and carries the whole thread
   (replies plus who set the status and when).
3. A project has **owners**: people picked from the user table who may decide that project's
   comments, without being admins anywhere else.

### Why

- **"Resolved" cannot say no.** A review round produces two kinds of outcome — *do it* and *we are
  not doing it* — and the current model collapses them into one. A rejected comment that looks
  identical to a done one makes the export useless as a work order, which is the export's only job.
- **The export is the deliverable.** What gets pasted into an issue tracker should be the agreed
  work, not the whole discussion including everything that was turned down. Defaulting the export to
  approved-only is the point of having statuses at all.
- **One global admin is the only way to delegate.** Today, letting someone decide a project's
  comments means making them an admin of the whole instance — which also hands them every other
  project's settings, the user overview and the ability to delete projects. Per-project owners are
  the smallest thing that fixes that. Note what this does **not** do: visibility is unchanged by
  request, so an owner still sees every other project's name, base URL and comments. This narrows
  *rights*, not *exposure*, and must not be read as tenant isolation.
- Reverses a documented MVP decision (`docs/functional-spec.md:62`: *"There is no per-project
  assignment in the MVP"*, and *Possible next steps* item 1, which is exactly this feature). Those
  lines are now wrong and say so deliberately, so they have to be rewritten rather than quietly
  contradicted.

### Requirements, as given

Stated by the user, not inferred:

- Statuses are `open`, `approved`, `rejected`. **`resolved` disappears entirely** — no alias, no
  compatibility shim.
- Export can select which statuses to include; the default is approved only.
- The export carries the whole thread — the comment, its replies, and the current status with who
  set it and when. **No audit log of intermediate transitions.**
- A project's owners are chosen as pills from the existing `users` table.
- A real admin creates the project and adds owners. Owners then work with that project's comments:
  the overview, export and approve/reject.
- Owners get **comments only, not settings** — renaming the project, changing its base URL and
  deleting it stay with global admins.
- Project **visibility does not change**: every signed-in user still sees every project and can
  comment. Ownership grants rights, never access.
- Owner pills are picked **only** from `users` — people who have signed in at least once. No
  pre-registering an e-mail that has never logged in.
- **A comment's author may delete their own comment only while it is `open`.** Once a verdict has
  been given, the comment is a record.

### Decisions taken during review

Five questions the first draft answered by itself, put back to the user and answered by them. Each
changes behaviour, so each is recorded rather than left as an assumption.

| Question | Decision |
|---|---|
| What may an owner do to somebody else's comment? | **Delete, not edit.** The first draft granted both, purely because it widened one shared helper. Rewriting a reviewer's words is a different power from removing spam, and was never asked for. |
| Does a comment's author keep the right to close their own comment, which they have in v0.1.3? | **No — the verdict belongs to a manager.** Accepted with its cost: on a project with no owners assigned, a reviewer needs a global admin even for their own item. |
| What happens to comments already resolved in v0.1.3? | **Admin-resolved → `approved`, everything else → `open`.** Keeps only the decisions that would also have been valid under the new rules. |
| Does a rejection need a reason field? | **No.** Whoever rejects writes the reason as a reply; the export carries the thread anyway. The UI opens the reply box when a manager rejects, so the habit forms without a schema column. |
| May an author still remove their own comment after it is decided? | **No — only while `open`.** Extended to editing as well: silently rewriting the text of an approved comment changes what was agreed, which is the same integrity problem as deleting it and harder to notice. |

### Assumptions, to be corrected if wrong

- Both `approved` and `rejected` are "decided" and both drop out of the review sidebar by default;
  `open` is the working set.
- Owners may not manage the owner list — that is escalation of privilege and stays with admins.
- Anyone may still reply to any comment in any status, as today. Replies themselves carry no status,
  so their author may edit and delete them at any time, unchanged from v0.1.3.
- A global admin keeps the right to edit anyone's comment text in any status, exactly as today. Only
  *owners* are held to delete-but-not-edit, and only *authors* are held to the open-only rule.

### The resulting permission matrix

| Action | author | owner | admin |
|---|---|---|---|
| Add a comment, reply to any comment | ✅ | ✅ | ✅ |
| Edit **own** comment while `open` | ✅ | ✅ (as author) | ✅ |
| Edit **own** comment once decided | ❌ | ❌ | ✅ |
| Edit someone else's comment | ❌ | ❌ | ✅ |
| Delete **own** comment while `open` | ✅ | ✅ | ✅ |
| Delete **own** comment once decided | ❌ | ✅ | ✅ |
| Delete someone else's comment or reply | ❌ | ✅ | ✅ |
| Edit / delete own reply | ✅ | ✅ | ✅ |
| Set status (approve / reject / reopen) | ❌ | ✅ | ✅ |
| Export, comment overview | ❌ | ✅ | ✅ |
| Project settings, delete project, manage owners, user overview | ❌ | ❌ | ✅ |

## Current state

### Authorization, today

Every authorization decision in the codebase is one of two shapes, and both ask the same global
question:

| Location | Check |
|---|---|
| `src/lib/http.ts:20-22` | `requireAdmin(ctx)` — `ctx.locals.user.role !== 'admin'` → 403 |
| `src/pages/api/projects/index.ts:8` | create project |
| `src/pages/api/projects/probe.ts:7` | probe a URL (the SSRF entry point) |
| `src/pages/api/projects/[id]/index.ts:8,14` | update / delete project |
| `src/pages/api/projects/[id]/export.ts:8` | export |
| `src/pages/admin/projects/[id].astro:7` | manage page |
| `src/pages/admin/users.astro:6` | user overview |
| `src/lib/comments.ts:164-168` | `assertCanModify()` — `!c.mine && viewer.role !== 'admin'`, guarding update, delete **and** `setResolved` |
| `src/lib/replies.ts:89-93` | same shape for replies |
| `src/components/Review.svelte:885,948,1013` | UI gating (convenience only) |
| `src/pages/index.astro:7` | the "Manage" button on a tile |
| `src/layouts/Layout.astro:58` | the "Users" nav link |

`role` is recomputed from the oauth2-proxy headers on every request in `resolveRole()`
(`src/lib/auth.ts:28-37`); `users.role` in SQLite is only a cache for the overview and is never
authorized against. That invariant must survive this change.

There is no concept of "this user, on this project". `getProject()` (`src/lib/projects.ts:29-33`)
takes no viewer, and `listProjects()` (`src/lib/projects.ts:8-27`) takes no arguments at all.

### The comment status, today

`comments.resolved_at` / `resolved_by` (`src/lib/db/schema.ts:45-47`), surfaced as
`CommentDto.resolvedAt` / `resolvedBy` (`src/lib/comments.ts:34-35`) via an aliased second join on
`users` (`src/lib/comments.ts:40`). Written by `setResolved()` (`src/lib/comments.ts:183-190`),
which is guarded by `assertCanModify()` — the comment's **author** or an admin.

The review screen hides resolved comments behind one boolean toggle
(`src/components/Review.svelte:43,77-88,807-818`) and the markers get a grey ✓
(`src/lib/client/overlay.ts:166-168`).

**`resolved` is an overloaded word in this codebase.** `Review.svelte:27` holds
`let resolved = $state<Record<number, { method: ResolveMethod } | null>>({})`, which is **anchor**
resolution — `resolveAnchor`, `ResolveMethod`, `src/lib/client/anchor.ts` — and has nothing to do
with comment status. A blind rename sweep breaks anchoring. Only these five identifiers are in
scope: `resolvedAt`, `resolvedBy`, `setResolved`, `showResolved`, `resolvedCount`.

### The export, today

`GET /api/projects/[id]/export.ts` is admin-only, takes `format` and an optional `path`, and hands
**every** comment of that scope to `exportComments()` (`src/lib/export.ts:7-44`). There is no way to
narrow by outcome. Markdown already nests replies (`src/lib/export.ts:70-72`) and flags resolved ones
(`src/lib/export.ts:68`) — but without a timestamp; CSV carries `resolved_at` / `resolved_by`
(`src/lib/export.ts:25-26`) and flattens replies into a count plus a joined string, losing per-reply
authors and times.

| Aspect | Current state | Proposed state |
|---|---|---|
| Comment outcome | `resolved_at` nullable — done / not done | `status` enum — `open` / `approved` / `rejected` |
| Who decides the outcome | comment author or global admin | project manager: global admin or project owner |
| Who may edit a comment | its author (any state) or global admin | its author **while open**, or a global admin |
| Who may delete a comment | its author (any state) or global admin | its author **while open**, or a project manager |
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
                                 no   ──▶  access = 'reviewer'   (comment, reply, own while open)
```

Four properties this must keep. Each is also a way the change could go wrong, so each has a test.

- **Ownership is additive, never a substitute for authentication.** A user who loses their Entra
  role is rejected by the middleware (`src/middleware.ts:10-20`) before ownership is ever consulted.
  Being an owner of a project cannot let anybody into the app.
- **`users.role` stays a cache.** `project_owners` stores a membership fact keyed by `users.id`, not
  a copy of a role, so reading it is not the thing CLAUDE.md forbids. The global role continues to
  come from the headers on every request. The **one** exception is the one-time data migration
  below, which has no other signal available and is explicitly not a precedent.
- **Owners cannot widen their own reach.** Managing the owner list, creating projects, changing
  settings, deleting a project and the user overview all stay on `requireAdmin`.
- **Owners can never reach the SSRF guard.** `assertPublicHost()` is only called from
  `createProject` / `updateProject` / `probeUrl` (`src/lib/projects.ts:47-56,68-95`), all of which
  stay admin-only. An owner cannot change `base_url`, therefore cannot aim the proxy anywhere, and
  since the proxy serves target HTML **same-origin**, that boundary is load-bearing.

### The status state machine

```
                approve
     ┌──────────────────────────▶ approved ──┐
     │                                       │
   open ◀───────── reopen ───────────────────┤
     │                                       │
     └──────────────────────────▶ rejected ──┘
                reject

  • approve / reject / reopen: project manager only (admin or owner)
  • approved ⇄ rejected goes through `open` — changing a verdict is two deliberate clicks,
    not a slip
  • reopen clears status_at and status_by; an open comment therefore has no decider,
    and the export shows none
  • setting the status a comment already holds is a no-op: the write is skipped, so
    "decided on" records the decision and not the last click
  • replying is possible in every status, by anyone
```

### Database changes

```sql
-- 1. status replaces the resolved pair
ALTER TABLE comments ADD COLUMN status    TEXT NOT NULL DEFAULT 'open';  -- open | approved | rejected
ALTER TABLE comments ADD COLUMN status_at TEXT;
ALTER TABLE comments ADD COLUMN status_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- carry over only the verdicts that would also be valid under the new rules:
-- those given by someone who is a global admin. See "Migration mechanics" for the caveat
-- about users.role being a cache.
UPDATE comments
   SET status    = 'approved',
       status_at = resolved_at,
       status_by = resolved_by
 WHERE resolved_at IS NOT NULL
   AND resolved_by IN (SELECT id FROM users WHERE role = 'admin');
-- everything else keeps the column default 'open' and is decided again

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
| `status` | `TEXT NOT NULL DEFAULT 'open'` | `open` \| `approved` \| `rejected`. SQLite has no enum; `normalizeStatus()` is the gate |
| `status_at` | `TEXT` | When the status was last changed; `NULL` while `open` |
| `status_by` | `INTEGER → users` | Who changed it; `SET NULL` so deleting a user never deletes a verdict |

**No index on `comments.status`, deliberately.** Three values, always filtered inside one project,
and `comments_project_path_idx (project_id, page_path)` already supplies the `project_id` prefix. An
index here would be write cost for nothing. Recorded so nobody adds one out of reflex.

**`project_owners`**

| Column | Type | Description |
|---|---|---|
| `project_id` | `INTEGER → projects CASCADE` | Deleting a project drops its ownership rows |
| `user_id` | `INTEGER → users CASCADE` | Deleting a user drops their ownerships |
| `added_at` | `TEXT NOT NULL` | Shown on the manage screen |
| `added_by` | `INTEGER → users SET NULL` | Who granted it — the one piece of audit worth keeping, since this is a privilege grant |
| PK | `(project_id, user_id)` | A duplicate grant is impossible at the storage layer, and the PK is the covering index for the forward lookup |

`project_owners_user_idx` serves the reverse lookup (*which projects may this person manage*) and is
also load-bearing for the `ON DELETE CASCADE` from `users`, which would otherwise scan the table on
every user delete.

**Ownership is keyed on `users.id`, which is keyed on Entra `oid`** (`upsertUser`,
`src/lib/auth.ts:39-41`). A re-provisioned account gets a new `oid` → a new `users` row → no
inherited ownership. That is correct fail-closed behaviour; nobody should "fix" the upsert to key on
e-mail.

### Migration mechanics — read this before running `db:generate`

**The first draft of this document was wrong here, and following it would have destroyed data.** It
claimed drizzle-kit emits `ADD COLUMN` / `DROP COLUMN` and that the `UPDATE` could be hand-edited
between them. It does not. For a column drop on SQLite, drizzle-kit (0.31.10, the pinned version)
emits a **full table rebuild**:

```sql
PRAGMA foreign_keys=OFF;
CREATE TABLE `__new_comments` (…);
INSERT INTO `__new_comments`(…) SELECT … FROM `comments`;
DROP TABLE `comments`;
ALTER TABLE `__new_comments` RENAME TO `comments`;
PRAGMA foreign_keys=ON;
```

`PRAGMA foreign_keys` is a **no-op inside a transaction**, and drizzle's migrator wraps each
migration in one. With `foreign_keys = ON` (`src/lib/db/index.ts:26`), `DROP TABLE comments` fires
`comment_replies.comment_id … ON DELETE CASCADE` and **every reply in the database is deleted**.
Reproduced against a database seeded through `0000`–`0002`:

```
before rebuild:  comments 1   replies 2
after  rebuild:  comments 1   replies 0
```

`PRAGMA defer_foreign_keys=ON` does not help. The hand-written `ALTER` script above was verified on
the same fixture and is correct:

```
after ALTERs:    comments 1   replies 2
                 status='approved', status_at and status_by carried from resolved_*
```

SQLite 3.53.4 (better-sqlite3 13) drops `resolved_by` happily despite its outbound FK, and neither
dropped column appears in `comments_project_path_idx` or `comments_user_idx`, so nothing blocks it.

Therefore, for Phase 1:

1. Run `npm run db:generate`. It **prompts** (`promptColumnsConflicts`: "is `resolved_at` renamed to
   `status_at`?") because two columns are dropped while three are added on the same table. It fails
   outright without a TTY, and answering *rename* produces a different, also wrong migration.
   Answer **create/drop**, not rename.
2. **Replace the generated SQL body entirely** with the hand-written `ADD` → `UPDATE` → `DROP COLUMN`
   script. Keep the generated `drizzle/meta/0003_snapshot.json` untouched — drizzle diffs against
   the snapshot, not against the SQL.
3. Separate every statement with `--> statement-breakpoint`. drizzle splits migration files on that
   literal token and feeds each fragment to better-sqlite3, which refuses more than one statement
   per `prepare()`. This fails closed (the app will not boot), so it is an availability trap rather
   than a data one — but it is the obvious way to get the hand-edit wrong.
4. Verify on a **copy of the real database**: every admin-resolved comment is `approved` with its
   original `status_at` / `status_by`, everything else is `open`, and **the reply count is
   unchanged**.

The migration itself is atomic — drizzle's `migrate()` wraps all pending statements in
`BEGIN … COMMIT` with `ROLLBACK` on error — so a crash mid-migration cannot leave the data half
converted. The risk is entirely "the wrong SQL ran successfully", not "the right SQL ran partially".

**The `users.role` read in that `UPDATE` is the one place in this change that touches the role
cache.** It is a one-time historical reconstruction with no other signal available, it reflects the
role at last login rather than at resolve time, and rows resolved by a since-deleted user
(`resolved_by IS NULL`) fall to `open`. It is not an authorization decision and is not a precedent.

**This trap outlives this change.** Any future migration that drops or retypes a column on
`comments` will regenerate the same reply-destroying rebuild. Phase 3 adds a note to `CLAUDE.md`
under *Schema changes*.

### Service layer changes

**New — `src/lib/access.ts`**

```ts
export type ProjectAccess = 'admin' | 'owner' | 'reviewer';

/** Global role first, then one indexed membership lookup. Never reads users.role. */
export function projectAccess(projectId: number, viewer: AuthUser): ProjectAccess;

/** True for 'admin' and 'owner'. */
export function canManageProject(projectId: number, viewer: AuthUser): boolean;

/** Throws HttpError(403) unless admin or owner of this project. */
export function requireProjectManager(projectId: number, viewer: AuthUser): void;

/** Owner list for the manage screen. Readable by managers, writable by admins. */
export function listOwners(projectId: number): OwnerDto[];

/**
 * Replaces the whole owner set, transactionally. Asserts `addedBy.role === 'admin'` itself —
 * this is the one function in the system that hands out rights, so it does not delegate its
 * own guard to its callers.
 */
export function setOwners(projectId: number, userIds: number[], addedBy: AuthUser): OwnerDto[];

/** 'all' for admins; an explicit Set for everyone else. Never an empty Set meaning "everything". */
export function managedProjects(viewer: AuthUser): 'all' | Set<number>;
```

Three constraints on this module, each from a review finding:

- **`access.ts` imports nothing from `projects.ts`.** `projects.ts` will import *it* (for
  `canManage` on the tiles), and `comments.ts` already imports `projects.ts`, so the reverse edge
  would make a cycle with `comments.ts` downstream of both. `requireProjectManager` therefore works
  off a raw id and never 404s; the route calls `getProject()` for that. Stated in the module
  docstring the way `src/lib/replies.ts:9-12` does.
- **`managedProjects` returns `'all' | Set`, never an empty set meaning "everything".** The obvious
  sentinel (`empty = admin`) fails open: any caller written `ids.size === 0 ? showAll() : filter()`
  hands a plain reviewer full manage rights, silently and untypeably.
- **`projectAccess` is called once per request, never inside `toDto()` or any map over comments.**
  It is the only realistic N+1 in the design: a per-comment `canManage` field would make it one
  query per row. If a route genuinely needs it twice, memoize on `ctx.locals`, never globally. Do
  **not** add a cache — a PK lookup against an in-process SQLite file is microseconds, and a cache
  would only create an invalidation bug when ownership is revoked.

`requireAdmin` (`src/lib/http.ts:20-22`) is unchanged and keeps guarding project creation, probing,
settings, deletion, owner writes and the user overview.

**Changed — `src/lib/comments.ts`**

```ts
export type CommentStatus = 'open' | 'approved' | 'rejected';

/** Throws HttpError(400) on anything outside the three values — a verdict is not coerced. */
export function normalizeStatus(input: unknown): CommentStatus;

interface CommentDto {                    // resolvedAt / resolvedBy removed
  status: CommentStatus;
  statusAt: string | null;
  statusBy: { id: number; name: string | null; email: string } | null;
  // …unchanged fields
}

/**
 * Manager action. Guarded by requireProjectManager(c.projectId, viewer) and NEVER by
 * assertCanEdit — the comment's own author has no say in its verdict. No-op when the status
 * is already the requested one.
 */
export function setStatus(id: number, status: CommentStatus, viewer: AuthUser): CommentDto;
```

`normalizeStatus` deliberately does **not** follow `normalizeViewport` (`:15-17`), which coerces
unknown input to `'desktop'`. A viewport is a display attribute where a wrong value is harmless; a
status is a decision record, and coercing `"aproved"` to `open` would silently reopen a decided
comment while answering `200`.

`setResolved()` is deleted. The aliased join at `:40` is renamed `statusSetter` and joins
`status_by`. The single `assertCanModify()` (`:164-168`) **splits in two**, because the three
operations it currently guards no longer share a rule:

```ts
/** Author while the comment is still open, or a global admin in any state. */
function assertCanEdit(id: number, viewer: AuthUser): CommentDto;

/** Author while the comment is still open, or a project manager in any state. */
function assertCanDelete(id: number, viewer: AuthUser): CommentDto;
```

Both read `projectId` and `status` off the DTO they already fetch, so neither adds a query, and
`c.mine` short-circuits before `canManageProject` touches the database.

**Changed — `src/lib/replies.ts`**

Replies carry no status, so their author keeps edit and delete unconditionally; only *someone
else's* reply needs the widened rule. `assertCanModify()` (`:89-93`) becomes
`c.mine || canManageProject(parentProjectId, viewer)`.

`getReply()` (`:64-74`) needs the parent's project, but `selectShape` (`:26-34`) is **shared** with
`repliesFor()` (`:47-62`). Widening it would put an extra join on every review-screen load and every
export, and leak `projectId` into every `ReplyDto` in JSON responses. `getReply()` therefore gets its
own select; `repliesFor()` and `ReplyDto` are untouched.

**Changed — `src/lib/export.ts`**

`exportComments()` and `toMarkdown()` keep their signatures. The Markdown header always names the
filter that was applied and what it excluded, so an empty file explains itself:

```
Comments: 12 approved  (filter: approved — 40 open and 3 rejected not included)
```

Each bullet carries the verdict **with who and when** (today's `✓ _resolved by Bob_` has no
timestamp). CSV swaps `resolved_at, resolved_by` for `status, status_at, status_by`; its `replies`
count and flattened `replies_text` stay as they are — accepted, since Markdown and JSON carry the
full thread and CSV exists for filtering and sign-off tracking.

**Changed — `src/lib/projects.ts`**

`listProjects()` becomes `listProjects(viewer: AuthUser)` and returns `canManage` per project. It
**must not** join `project_owners`: the query is a `LEFT JOIN comments … GROUP BY projects.id` with
`count(comments.id)`, and a second join fans rows out to `comments × owners`, multiplying
`commentCount` — the exact bug `tests/projects.test.ts:23-36` exists to pin. A correlated `exists(…)`
hits the documented drizzle gotcha where `schema.projects.id` renders as a bare `"id"`; it would
work today only by accident, because `project_owners` has no `id` column.

Instead: one call to `managedProjects(viewer)`, then `canManage` in memory. One extra indexed query
for non-admins, zero for admins, and the aggregate is not touched.

### API changes

```
PATCH  /api/comments/:id        { body }                             author while open, or admin
                                { status: open|approved|rejected }   project manager only
DELETE /api/comments/:id                                             author while open, or manager
DELETE /api/replies/:id                                              author, or project manager

GET    /api/projects/:id/export?format=…&status=approved             admin or owner
                                        status=approved,rejected
                                        status=all
                                        (absent → approved only)

GET    /api/projects/:id/owners                                      admin or owner (read)
PUT    /api/projects/:id/owners  { userIds: number[] }                admin only — replaces the set
```

**The `PATCH` branch rule, spelled out, because the obvious implementation is wrong.** The route
today dispatches on `typeof b.resolved === 'boolean'` (`src/pages/api/comments/[id].ts:10-12`) and
falls through to `updateComment` otherwise. Ported naively to validate-then-branch, an attacker sends
`{status: "aproved", body: "x"}`, the value fails validation, and the request **falls through to the
weaker author-only branch**. The permission must be chosen by the **presence of the key**, before any
value is inspected:

```
if ('body' in b && 'status' in b)  → 400          (never let one check cover the other)
if ('status' in b)                 → requireProjectManager(…), then normalizeStatus() which may 400
else                               → assertCanEdit(…), then updateComment
```

Four tests: `{body}`, `{status}`, `{body, status}`, `{status: <invalid>}`.

**The export `status` parameter must fail narrow.** Unknown token → `400`. An empty result after
parsing → `approved`, **never** `all` — a parser that degrades to "no filter" hands rejected and open
items over as agreed work. Tests for `status=garbage` and `status=` (empty).

`PUT` rather than `POST` for owners is a **security property, not a style choice**, and must not be
"simplified" later: `checkOrigin: false` (`astro.config.mjs`) means Astro performs no origin check,
so the app relies on CORS preflight. `PUT` with a JSON content type is not a simple request and
cannot be forged cross-site by a form; `POST` can. The project id comes from the URL only — the body
carries `userIds` and nothing else.

`setOwners` validates before writing: an array of positive integers, deduped, length-capped, and
unknown ids rejected with `400` rather than letting the foreign key surface as a `500` from
`handler()`. Delete-and-insert runs inside `db.transaction()` — better-sqlite3's is synchronous and
`setOwners` is already a sync signature — because without it a failed insert leaves the project with
**no owners at all**. To keep `added_at` meaningful the write diffs the set rather than re-inserting
unchanged rows.

`GET /owners` is readable by managers (an owner may reasonably ask "who else can approve this?") and
writable only by admins.

### UI changes

**Review screen** (`src/components/Review.svelte`)

The island is told what the viewer may do rather than deriving it: `review/[id].astro:32` grows a
`canManage` prop computed on the server. The island must never infer authorization from `role`,
because owners are `role: 'user'` — and `canManage` is a **rendering hint, not the authorization**;
the server checks in `setStatus` / `assertCanDelete` are. If ownership is revoked while the page is
open the buttons remain until reload and the API starts returning 403; the island surfaces that in
the existing error bar.

The single resolved toggle (`:807-818`) becomes three filter chips — `● Open n`, `✓ Approved n`,
`✕ Rejected n` — with only *Open* lit by default. `All` / `Mine` (`:802`) keeps filtering by author
*within* the chosen statuses, and its counts follow the selection; a reviewer whose comment was
rejected finds it under *Mine* with the Rejected chip lit, which is the only discovery path there is
without notifications. Card and marker colour by status: open keeps its number, approved a green ✓,
rejected a red ✕, both muted.

Action row: `Approve` / `Reject` for a manager on an open comment, `Reopen` on a decided one, nothing
for a plain reviewer. **Rejecting opens the reply composer** on that comment, so the reason lands in
the thread — this is what stands in for a `status_note` column. `Reply` stays available to everyone
in every status. `Edit` / `Delete` on own comments disappear once the comment is decided.

**Manage screen** (`src/pages/admin/projects/[id].astro`)

Splits into zones by access level:

| Zone | admin | owner |
|---|---|---|
| Settings (name, base URL, Delete project) | ✅ | not rendered, and the API refuses |
| Owners — pills editor | ✅ | read-only list |
| Comment table, filters, export | ✅ | ✅ |

**The user list for the pills typeahead must be fetched inside the admin branch of the frontmatter**,
not fetched always and hidden in the template. The first draft justified embedding it with "the page
is admin-only" — which is precisely what this change stops being true. Serializing `users` into HTML
an owner receives would hand every project owner the full internal directory (every colleague's
e-mail plus the cached role), data currently reachable only at `/admin/users`. Manual test: open the
page as an owner, view source, confirm neither the user list nor the owners payload is present.

A hint under the pills — *"Only people who have signed in at least once appear here"* — removes the
support question that otherwise recurs on every handover.

The status filter grows from `All / Open / Resolved` to `All / Open / Approved / Rejected`
(`:84-89`). The export row gets its **own** status select defaulting to *Approved*, independent of
the table filter (`:93-97`), showing the count that will actually be exported. The overview should
default to everything, because an admin needs to see what is undecided; the export should default to
approved, because that is what gets handed over. One control cannot have both defaults.

**Move the page to `/projects/[id]/manage`.** Promoted from optional to recommended on the security
review's reasoning: `/admin/*` currently means "global admin only" and that assumption is encoded in
`src/layouts/Layout.astro:58` and `src/pages/index.astro:7`. The danger is not only that someone
later adds a blanket `/admin/*` guard and locks owners out — it is that they then *weaken* that guard
to unbreak owners, exposing `/admin/users`. Two link sites change (`index.astro`,
`Review.svelte:1013`); `/admin/users` stays the only `/admin/*` page. If this is dropped, a comment
in `src/middleware.ts` recording the trap becomes mandatory.

**Project list** (`src/pages/index.astro:7,102-106`)

`canManage` from `listProjects(viewer)` drives the Manage button, so an owner sees it on their
projects and nobody else's.

### Configuration

N/A — no new environment variables, no feature flags. Ownership is data, not configuration.

## Affected files

### New files

- `src/lib/access.ts` — project access level, manager guard, owner CRUD
- `src/pages/api/projects/[id]/owners.ts` — `GET` (managers) / `PUT` (admins)
- `drizzle/0003_*.sql` — generated, then its body **replaced** by the hand-written script
- `tests/access.test.ts` — owner vs. admin vs. reviewer against an in-memory database
- `docs/plans/2026-09-14-comment-status-and-project-owners.md` — this document

### Modified files

- `src/lib/db/schema.ts:45-47` — drop `resolvedAt` / `resolvedBy`, add `status` / `statusAt` /
  `statusBy`; `:57-77` add `projectOwners` and its index
- `src/lib/comments.ts:34-35,40,55,65-85,96,109` — DTO, aliased join, row mapping;
  `:164-168` `assertCanModify` splits into `assertCanEdit` / `assertCanDelete`;
  `:174-190` `updateComment` / `deleteComment` re-guarded, `setResolved` → `setStatus`;
  new `normalizeStatus` beside `normalizeViewport:14-16`
- `src/lib/replies.ts:64-74` — `getReply` gets its own select carrying the parent `projectId`;
  `:89-93` widen to project managers
- `src/lib/export.ts:25-26` — CSV columns; `:53-58` header names the filter and the exclusions;
  `:68` verdict with who and when
- `src/lib/projects.ts:8-27` — `listProjects(viewer)` + `canManage` via `managedProjects`, no join
- `src/lib/client/api.ts` — `setResolved` → `setStatus`
- `src/lib/client/overlay.ts:13,29-32,166-168` — marker variants per status
- `src/components/Review.svelte:27 (do not touch — anchor state)`, `:43,77-88,316,421-434,802-818,`
  `870-871,885-1013` — status chips, `canManage` prop, approve/reject/reopen, reject-opens-reply,
  edit/delete hidden once decided, card and marker styling
- `src/pages/api/comments/[id].ts:8-13` — key-presence branch dispatch, 400 on both keys
- `src/pages/api/projects/[id]/export.ts:8,12-14` — `requireProjectManager`, `status` parameter,
  filter pushed into the query
- `src/pages/api/projects/index.ts:5` — `listProjects(ctx.locals.user)` signature change
- `src/pages/admin/projects/[id].astro:7,21-32,84-97,111,117,142-143` — access zones, owner pills,
  admin-gated user fetch, status filter, separate export select
- `src/pages/index.astro:7,102-106` — Manage button from `canManage`
- `src/pages/review/[id].astro:32` — pass `canManage`
- `tests/projects.test.ts:8,23+` — `listProjects(viewer)` signature; add a project having **both**
  comments and owners, asserting `commentCount` is still right
- `tests/comments.test.ts` — resolve cases become status cases with manager permissions
- `tests/export.test.ts` — status rendering, the filter default, the header's exclusion line
- `docs/functional-spec.md`, `docs/architecture.md`, `README.md`, `CLAUDE.md` — see Phase 3

### Unchanged files (important)

- `src/middleware.ts` — authentication untouched; ownership is checked per route, never here,
  because ownership grants rights and not access
- `src/lib/auth.ts` — global role resolution exactly as before; owners are `role: 'user'`
- `src/lib/http.ts` — `requireAdmin` keeps its meaning and its callers (`HttpError` and `handler`
  are merely imported by the new module and route)
- `src/pages/api/projects/probe.ts` — stays `requireAdmin`; this is the SSRF entry point
- `src/lib/proxy/*` — the proxy consults no role and must not start; visibility is unchanged
- `src/lib/client/anchor.ts` — anchor resolution, unrelated to comment status despite the word
- `src/pages/admin/users.astro` — stays admin-only
- `src/lib/db/index.ts:9` — reads `process.env.DATABASE_PATH` directly rather than through `env()`.
  Pre-existing, and the reason `DATABASE_PATH=':memory:'` works in tests. Do not "fix" it here.

## Implementation phases

### Phase 1: Comment status, and the export that selects on it

Re-sequenced from the first draft: export filtering depends only on the status model, not on owners.
The only owner-related part of the export is swapping one guard, which moves to Phase 2. This keeps
the highest-value half of the feature from sitting behind the authorization work.

- Outcome: three states and an approved-only export, under today's admin-only permissions.
- Depends on: nothing.
- [ ] Schema, then `db:generate` — answer **create/drop**, not rename, at the prompt
- [ ] Replace the generated SQL body with the hand-written script, `--> statement-breakpoint`
      between every statement; keep the generated snapshot
- [ ] Verify on a copy of the real DB: verdicts carried, others `open`, **reply count unchanged**
- [ ] `normalizeStatus` (throws), `setStatus` (admin-only for now, no-op when unchanged),
      `assertCanModify` splits into `assertCanEdit` / `assertCanDelete`; delete `setResolved`
- [ ] `PATCH` key-presence dispatch; four tests
- [ ] Export `status` parameter, failing narrow, filtered in the query; Markdown header names the
      filter and exclusions; CSV columns
- [ ] Review screen: chips, card chip, marker variants, approve/reject/reopen, reject opens the
      reply box, edit/delete hidden once decided
- [ ] Manage page: status column, four-way filter, separate export select with its count

### Phase 2: Project owners

- `project_owners`, `src/lib/access.ts`, the owners API and pills editor, the manage-page access
  split, `canManage` on tiles and in the review island. `setStatus`, `assertCanDelete`,
  `replies.assertCanModify` and the export guard widen from admin to project manager.
- Outcome: an admin can hand a project's comments to someone who is not an admin.
- Depends on: Phase 1.
- [ ] Table, index, `access.ts` — `'all' | Set` from `managedProjects`, no import of `projects.ts`
- [ ] `GET` (managers) / `PUT` (admins) `/api/projects/:id/owners`; `setOwners` self-guarding,
      transactional, validating, diffing
- [ ] Widen the four guards; `listProjects(viewer)` and its two other callers
- [ ] Manage page zones; user list fetched **inside** the admin branch; pills hint
- [ ] `canManage` into `Review.svelte`; remove all three `role === 'admin'` checks there
- [ ] Optional rename `/admin/projects/[id]` → `/projects/[id]/manage`
- [ ] Tests incl. the view-source check that an owner receives no user directory

### Phase 3: Documentation

- `docs/functional-spec.md` — `Concepts` (drop **Resolved**, add `Status` and `Owner`), the roles
  table gains an owner column and the open-only rule, the review-screen and export sections,
  `:62` ("no per-project assignment in the MVP"), the *Deliberately not in the MVP* line about
  assigning projects, and *Possible next steps* item 1, which is this feature
- `docs/architecture.md` — data model, access-level diagram, why ownership is additive, the SSRF
  invariant, the migration trap
- `README.md:3,19,139-154` — intro, feature list, the API table (`{ resolved }`), CSV columns
- `CLAUDE.md` — the *Auth* section, the *Replies and resolving* section, and a new line under
  *Schema changes*: **a generated migration that drops a column on `comments` rebuilds the table and
  cascades away every reply — replace the generated body by hand**
- Also: `src/pages/api/comments/[id]/replies.ts:5` and `src/lib/replies.ts:75` say "resolved thread"
  in doc comments
- Depends on: Phases 1-2.

## Risks and mitigations

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| The generated migration rebuilds `comments` and cascades away `comment_replies` | **Every reply in the database deleted**, invisible in a schema diff | **High — it is the default output** | Replace the generated body with the verified `ALTER` script; assert the reply count on a copy of the real DB before tagging; note it in `CLAUDE.md` for future migrations |
| `db:generate` answered "rename" at the prompt | A different, also wrong migration | Medium | Named in the Phase 1 checklist |
| Hand-edited SQL without `--> statement-breakpoint` | App will not boot | Medium | Fails closed, caught on first start; in the checklist |
| `setStatus` reuses the author-or-admin guard | **Any reviewer approves their own comment straight into the approved-only export** | High — it is the minimal diff from `setResolved` | The guard is written verbatim in this document; negative test "the author, being neither admin nor owner, gets 403" |
| `PATCH` branches on value validity instead of key presence | `{status:"aproved", body:"x"}` falls through to the weaker check | High — it is the natural port of the current code | Key-presence rule written out; four combination tests |
| `managedProjects` returns an empty Set meaning "all" | A plain reviewer gets manage rights, silently | Medium | Return `'all' | Set`; the type makes the mistake unwriteable |
| `listProjects` joins `project_owners` | `commentCount` multiplied by the owner count | Medium — the documented drizzle gotcha | Compute in memory from `managedProjects`; a test with both comments and owners on one project |
| The manage page ships the user directory to owners | Every owner reads every colleague's e-mail and cached role | Medium — hiding the zone in the template looks sufficient | Fetch inside the admin branch; view-source manual test |
| `normalizeStatus` coerces bad input to `open` | A decided comment silently reopens and leaves the export, with a 200 | Medium | Throws `400`; explicitly diverges from `normalizeViewport` |
| Export `status` parser degrades to "no filter" | Rejected and open items handed over as agreed work | Medium | Unknown token → 400; empty → `approved`, never `all` |
| `setOwners` not transactional | A failed insert leaves a project with no owners | Medium | `db.transaction()`; validate ids to `400` before writing |
| `/owners` relaxed from `PUT` to `POST` later | The privilege-granting endpoint becomes CSRF-forgeable under `checkOrigin: false` | Low | Recorded as a security property in the API section |
| A blanket `/admin/*` guard added later, then weakened to unbreak owners | `/admin/users` exposed | Medium if the page stays under `/admin/` | The rename; otherwise a mandatory comment in `middleware.ts` |
| Rename sweep follows `grep resolved` | Anchoring breaks (`Review.svelte:27`, `anchor.ts`) | Medium | Only five identifiers are in scope, listed in *Current state*; the verification grep is narrowed |
| Owners hold unaudited hard delete over others' comments | Irreversible, no trail | Low, accepted | `rejected` is the non-destructive path and is what the UI leads with; delete stays for spam |
| Deleting a user orphans verdicts | Export shows "unknown" | Low, accepted | `status_by` is `SET NULL`; the verdict survives |

## Testing

### Unit tests

Against an in-memory database (`DATABASE_PATH=':memory:'`, as `tests/projects.test.ts:6` does):

- `normalizeStatus` **throws** on unknown input, unlike `normalizeViewport`
- admin sets `approved` → `status_at` / `status_by` recorded; reopen clears both; re-setting the same
  status is a no-op that does not move `status_at`
- owner of the project sets `rejected`; owner of a *different* project gets 403
- the comment's own author, neither admin nor owner, gets 403 on `setStatus`
- author edits and deletes their own comment while `open`; both are refused once decided
- owner deletes someone else's comment, and their own decided one; owner **cannot edit** either
- admin edits any comment in any state
- owner deletes someone else's reply; a reviewer cannot; any author edits their own reply in any
  comment status
- `PATCH` combinations: `{body}` ok for the author while open, `{status}` refused for a reviewer,
  `{body, status}` → 400, `{status: "aproved"}` → 400 **and no fall-through to the body branch**
- export filter: default yields only `approved`; `all` yields everything; a comma list yields the
  union; `status=garbage` → 400; `status=` → `approved`
- Markdown header names the filter and the excluded counts; bullets carry verdict, who and when;
  CSV has `status, status_at, status_by` and no `resolved_*`
- `setOwners` replaces the set, is idempotent, rejects an unknown id with **400 not 500**, preserves
  `added_at` for unchanged rows, and leaves the set intact when it fails
- `setOwners` called with a non-admin `addedBy` throws, even though routes also guard it
- `projectAccess` returns `admin` for a global admin with no membership row
- `managedProjects` returns `'all'` for an admin and an explicit (possibly empty) Set otherwise
- `listProjects(viewer)`: `commentCount` is correct for a project that has **both** comments and
  owners; `canManage` true for the owner, false for a stranger, true everywhere for an admin
- deleting a project removes its `project_owners` rows; deleting a user removes theirs

### Integration / manual tests

- Admin: create a project, add a non-admin owner, approve and reject, confirm rejecting opens the
  reply box.
- As that owner (`DEV_USER=email:user`): the tile shows Manage; the manage page shows the comment
  table and a read-only owner list but no Settings and no pills editor; **view source contains no
  user directory**; export works; approve/reject works; `PATCH /api/projects/:id` and
  `PUT /api/projects/:id/owners` both 403.
- As a third non-owner user: no Manage button, the manage page 403s, the review screen offers Reply
  and their own Edit/Delete only while their comment is open, no verdict buttons, export 403s.
- **Migration:** copy the real `data/reviewer.db`, run the new build against it, confirm
  admin-resolved comments are `approved` with original `status_at` / `status_by`, author-resolved
  ones are `open`, and **the reply count is unchanged**.

### Verification

```bash
npm run check
npm test
npm run build

# only these five identifiers are the old status model — `resolved`/`resolveAnchor` in
# anchor.ts and Review.svelte:27 are anchoring and must survive
grep -rnE "resolvedAt|resolvedBy|setResolved|showResolved|resolvedCount" src/ docs/ README.md CLAUDE.md

# allowed survivors: Layout.astro:58,74 and admin/users.astro:6,44 — nothing else,
# and nothing at all under src/components/ or src/lib/client/
grep -rniE "role\s*[!=]==?\s*['\"]admin" src/
```

## Notes

- **Backward compatibility.** `CommentDto` is consumed only by this app's island and export, so the
  rename is safe. The migration is one-way: after it runs, `resolved_*` is gone and rolling back to
  v0.1.3 needs a database copy taken beforehand. This is the project's first column drop and belongs
  in the release note.
- **Performance.** `projectAccess` adds at most one indexed PK lookup per request, for non-admins
  only, off the proxy hot path. `listProjects` adds one indexed query. Comment list queries are
  untouched. The export's whole-project load and the manage page's are unchanged and already true
  today — single-digit MB at a few thousand comments, on one node serving tens of users. No
  streaming, paging or caching is warranted.
- **One known cliff.** `repliesFor()` uses `inArray(commentId, ids)`, one bound parameter per id;
  above SQLite's ~32k variable limit it throws rather than slows. Only the export and manage page
  pass unbounded id lists. Not a problem at this size, but it is a cliff, not a curve.
- **Edge case — the last owner.** Nothing prevents removing every owner; the project returns to
  admin-only management, which is its state today.
- **Edge case — an admin who is also an owner.** `projectAccess` returns `admin`; the membership row
  is harmless and becomes useful if they later lose the admin role.
- **Concurrent verdicts.** Two managers deciding the same comment: last write wins, no version
  check. Accepted at this scale.
- **The project tiles still count all comments**, decided ones included, so a finished project keeps
  advertising "17 comments". Left as is; revisit if it reads wrong in use.
- **Not built, deliberately.** No audit trail of transitions, no `status_note`, no notifications, no
  per-project reviewer assignment, no owner-managed owners, no tenant isolation.

## References

- `docs/architecture.md` — *Authentication and roles*, *Data model*
- `docs/functional-spec.md:62` — the MVP scope line this change reverses
- `CLAUDE.md` — *Auth*, *Replies and resolving*
- v0.1.3 introduced the resolved state this replaces: commit `a542cfc`
- In-memory DB test harness: `tests/projects.test.ts:1-20`
- Cross-check reviews: BA, developer, security and performance, 2026-09-14. The developer review's
  migration finding was reproduced before this revision.
