# Functional specification

What Reviewer does, who may do what, and where the boundaries of the product are.
For how it is built see [architecture.md](./architecture.md); for how to run and deploy it see the
[README](../README.md).

## Purpose

Reviewer collects review feedback on a website the way tracked changes work in Word. A reviewer opens
a project, sees the live site, points at a heading, a button or an image, and writes a comment
attached to *that element*. Everyone on the team sees the same comments in one place, and the person
fixing the site gets an export that says exactly which element on which page each note refers to.

The problem it solves: review feedback normally arrives as e-mail prose ("the button on the contact
page is the wrong colour"), which has to be translated back into elements by hand. Anchored comments
skip that translation.

Nothing is installed on the reviewed website. No script tag, no plugin, no cooperation from whoever
runs the site — Reviewer serves the page through its own reverse proxy. Any website reachable over
public HTTPS can be reviewed the moment an admin adds its URL.

## Concepts

| Concept | Meaning |
|---|---|
| **Project** | A website under review: a name plus a base URL. All comments belong to a project. |
| **Page** | One path inside a project, e.g. `/contact?lang=en`. Comments are grouped by page. |
| **Viewport** | The simulated screen the page is reviewed at: *Desktop* (the frame fills the window) or *iPhone 15* (393 × 852 px, centred in a phone shell). Comments belong to the viewport they were written in. |
| **Comment** | A note by one person, anchored to one element on one page in one viewport. |
| **Anchor** | The stored description of the element (CSS selector, XPath, text snippet) used to find it again on later visits. |
| **Reply** | An answer under a comment. A flat thread, no nesting — replies carry no anchor of their own. |
| **Status** | The verdict on a comment: **open** (the working set), **approved** (do it) or **rejected** (we are not doing it). A decided comment is kept, with who decided it and when, and stays out of the way until asked for. |
| **Owner** | A person who may decide a project's comments — approve, reject, export — without being an admin anywhere else. Owners are picked per project from people who have signed in at least once. |
| **Comment mode** | Review screen state where clicks create comments instead of following links. |
| **Browse mode** | The opposite: the site behaves normally, so the reviewer can navigate to the page they want to comment on. |

## Roles and permissions

Two global roles, `admin` and `user`. The role comes from Microsoft Entra ID app roles and is
re-evaluated on every request — see [architecture.md](./architecture.md#authentication-and-roles).
On top of that, a project has **owners**: users an admin has picked for that one project. An owner
is a `user` everywhere else; on their project they are a *manager*, like an admin is on every
project.

| Action | user | owner (on their project) | admin |
|---|---|---|---|
| List projects, open the review screen | ✅ | ✅ | ✅ |
| See every comment in a project, with its author | ✅ | ✅ | ✅ |
| Add a comment, reply to any comment | ✅ | ✅ | ✅ |
| Edit **own** comment while it is open | ✅ | ✅ | ✅ |
| Edit **own** comment once decided | ❌ | ❌ | ✅ |
| Edit someone else's comment | ❌ | ❌ | ✅ |
| Delete **own** comment while it is open | ✅ | ✅ | ✅ |
| Delete **own** comment once decided | ❌ | ✅ | ✅ |
| Delete someone else's comment or reply | ❌ | ✅ | ✅ |
| Edit / delete own reply | ✅ | ✅ | ✅ |
| Approve / reject / reopen a comment | ❌ | ✅ | ✅ |
| Comment overview and export | ❌ | ✅ | ✅ |
| Create / edit / delete a project, manage its owners | ❌ | ❌ | ✅ |
| See the user overview | ❌ | ❌ | ✅ |

Deliberate choices here:

- **Everyone sees everything.** Reviews are a team activity; hiding other people's comments would
  produce duplicates. Visibility is shared, rights are not — ownership narrows *who may decide*,
  not *who may look*. An owner still sees every other project. This is not tenant isolation.
- **The verdict belongs to a manager, never to the author.** A reviewer cannot approve their own
  comment into the export. The cost is accepted: on a project with no owners, a reviewer needs an
  admin even for their own item.
- **Once decided, a comment is a record.** Its author can no longer edit or delete it; silently
  rewriting an approved comment would change what was agreed.
- **Owners delete, they do not edit.** Removing spam is a different power from rewriting a
  reviewer's words.
- **Permissions are enforced in the API layer**, not in the UI. Hidden buttons are a convenience;
  every endpoint checks the role and the ownership itself.

## User flows

### User

1. Sign in (Entra ID, no separate account) → the project list.
2. Pick a project → the review screen opens on the project's home page, with a card explaining the
   two modes. The card returns on every visit until the reviewer ticks *Got it, don't show this
   again*; the **?** button in the toolbar brings it back (unticking the box makes it return again).
3. Hover an element; it gets an outline and a `+` button. Click it, type the comment, save.
4. Switch to browse mode, navigate to another page, switch back and keep commenting.
5. Own comments can be edited or deleted from the sidebar while they are still open. A rejected
   comment turns up under *Mine* with the *Rejected* chip lit, usually with a reply saying why.

### Owner

1. The tile of an owned project shows **Manage**; the review screen shows *Approve* / *Reject* on
   open comments and *Reopen* on decided ones.
2. Approve what should be done, reject what should not — rejecting opens the reply box so the reason
   lands in the thread.
3. On the manage screen, filter the comment table and export, by default only what was approved.
   The owner list is visible there but read-only; settings are not shown at all.

### Admin

1. *New project*: name and base URL. **Check URL** fetches the address first and reports the status
   and page title, so a typo or an unreachable host is caught before the project exists.
2. Add owners on the manage screen: pills picked from the people who have signed in at least once.
   There is no pre-registering an e-mail that has never logged in.
3. The manage screen lists every comment in the project — author, page, element, text, status, time
   — filterable by page, author and status. Each row links straight to that comment on the review
   screen.
4. Export the whole project or a single page as Markdown, CSV or JSON, choosing which statuses to
   include; the default is approved only.
5. Admins review and decide like an owner of every project; the extra rights are additive.

Deleting a project deletes its comments with it. This is intentional: a project is the unit of work,
and orphaned comments about a site nobody reviews any more are noise.

## The review screen

```
┌──────────────────────────────────────────────┬──────────────┐
│ [◱] name  ‹ › ↻  /contact  ↗  [Comment|Browse]│  Comments    │
├──────────────────────────────────────────────┤  All | Mine  │
│                                              │              │
│   <iframe src="/p/{id}/contact">             │  ① Heading…  │
│                                              │  ② Button…   │
│      ┌────────────┐                          │              │
│      │  element   │ (+)                      │              │
│      └────────────┘                          │              │
└──────────────────────────────────────────────┴──────────────┘
```

**Element picking.** Hovering walks up from the node under the cursor to the closest *meaningful*
element — one that carries its own text, or is an image or an interactive control, or has an id.
This skips the layout wrappers that would otherwise be picked constantly and mean nothing to the
person fixing the site. The highlight is an overlay element, never a change to the page's own
styling, so the site still looks the way it really looks.

**Comment mode blocks navigation.** Without that, a link could not be commented on — the click would
follow it. Browse mode turns clicks back on for getting around the site. Comment mode is on by
default, because commenting is the reason people are there. Holding **⌥ (Alt)** sends a single click
to the page instead of creating a comment — enough to accept a cookie banner or open a menu without
leaving comment mode; the hover highlight hides while the key is down.

**The mode is never in doubt.** It is a two-option switch in the toolbar, so the label can never be
read as an action, and it is stated three more ways at once: the reviewed page is framed in the
accent colour while comment mode is armed, the cursor over the page turns into a crosshair, and a
chip under the page names the current mode (it spells out what clicking does for a few seconds after
every switch, and while ⌥ is held). **C** toggles the mode from anywhere, including inside the page.

**Markers.** Every comment whose element was found gets a numbered circle next to it. Numbers follow
the element's position on the page, not the order comments were written, so they read top to bottom
like the page does. Markers reposition on scroll, resize and DOM changes. Clicking a marker
highlights the sidebar entry and vice versa.

**Sidebar.** Filter *All / Mine*, own comments visually distinct from other people's, edit and
delete on own open entries only, author and timestamp on each. Comments whose element cannot be
found are listed with an **element not found** flag.

**Replies.** Every comment takes replies from anyone who can see the project — the way a review
round actually goes: one person writes a note, another answers it. Replies are a flat list under the
comment, never a tree, and carry no anchor of their own; they belong to the comment, which is what
points at the element. A reply can be edited by whoever wrote it and deleted by its author or a
project manager.

**Status.** A review round ends in a verdict. A project manager — an owner of the project or an admin
— **approves** a comment (do it) or **rejects** it (we are not doing it), and can **reopen** either.
Changing a verdict goes through *open*: two deliberate clicks, not a slip. Nothing is deleted: the
thread keeps its replies, and the card says who decided and when. Rejecting opens the reply box, so
the reason lands in the thread — there is no separate reason field. Decided comments drop out of the
sidebar and their markers off the page, so what is left is what still needs doing. Three chips above
the list — *● Open*, *✓ Approved*, *✕ Rejected*, each with its count — choose what is shown; only
*Open* is lit by default, and the *All* / *Mine* counts follow the chips. Approved comments show a
green ✓, rejected ones a red ✕, both muted. Replying to a decided comment stays possible — the
verdict ends the work, not the conversation.

**Navigation.** Links inside the frame stay inside the proxy. The toolbar shows the current path,
offers back / forward / reload, and takes a typed path. The path is mirrored into the Reviewer URL
(`?path=…`) so a specific page under review can be linked to or reloaded.

**Viewport.** A second switch in the toolbar renders the page either at full width (*Desktop*) or in
an iPhone 15 shell — a real 393 × 852 px viewport, so the site's own media queries decide what it
shows. The frame is never reloaded when switching, only resized, and the shell scales down to fit a
short window (the page still believes it is 393 × 852). The choice is mirrored into the URL
(`?device=…`) and remembered per browser.

**Comments are kept per viewport.** A phone layout is a different DOM: the navigation collapses into
a burger, sections are reordered, elements disappear. A comment made on the phone would therefore
have no element to point at on the desktop, so the sidebar shows only the comments of the current
viewport, labelled with it, and a line above the list says how many comments the other viewport has
and switches to it. The admin table shows the viewport per comment, links to the review screen in
it, and exports carry it.

## Comments surviving site changes

The point of the tool is that comments are still attached to the right thing after the site is
redeployed. Each comment stores several descriptions of its element, and the strongest available
match wins when the page is loaded again — see
[architecture.md](./architecture.md#element-anchoring) for the resolution order.

Three outcomes are possible, and all three are designed for:

- **Found** — marker on the element, business as usual.
- **Found by text, somewhere else** — the element moved or was restructured; the comment follows the
  text rather than the position.
- **Not found** — the element is gone, probably because the comment was acted on. The comment stays
  in the sidebar flagged *element not found*.

A comment's text is never deleted or hidden because its element disappeared. Losing review feedback
is worse than showing it without a highlight.

## Export

Project managers (owners and admins), whole project or one page. **The export selects by status and
defaults to approved only** — what gets pasted into an issue tracker is the agreed work, not the
whole discussion including everything that was turned down. The manage screen has its own status
select next to the export buttons, independent of the table filter, showing the count that will
actually be exported; `status=all` or a comma list (`approved,rejected`) widens it. An unknown value
is refused rather than silently exporting everything.

| Format | Shape | Use |
|---|---|---|
| **Markdown** | Header names the filter and what it excluded (`Comments: 12 approved (filter: approved – 40 open and 3 rejected not included)`), then grouped by page, one bullet per comment with author, time, element, body and the verdict with who and when, replies nested under it | Paste into an issue or a work order — the main format |
| **CSV** | `id, created_at, author_name, author_email, page_path, viewport, tag_name, text_snippet, selector, body, status, status_at, status_by, replies, replies_text` | Spreadsheets, filtering, sign-off tracking |
| **JSON** | Raw dump plus the applied filter and per-status totals | Importing into another tool |

## Scope

**In the MVP**

- Entra ID sign-in, `admin` / `user` roles, plus per-project owners picked by admins
- Admin: project CRUD with a reachability check, owner list, comment overview with filters, export
- Owner: the comment overview, verdicts and export of their project — no settings
- User: pick a project, comment, see everyone's comments, edit and delete own while open, reply to
  any comment
- Status: a project manager approves or rejects a comment and can reopen it; decided comments are
  hidden from the review screen by default; the export selects by status, approved only by default
- Review screen: hover highlight, `+`, anchored comments, numbered markers, sidebar, in-frame
  navigation with a path bar
- Comments survive redeploys of the reviewed site
- One Docker image, SQLite on a volume, migrations at startup

**Deliberately not in the MVP**

Nested (threaded) replies · notifications · screenshots · a mobile layout · Jira or GitHub
integration · sites behind a login · an audit trail of status changes · a rejection-reason field
(the reply is the reason) · owners managing the owner list · hiding projects from non-owners.

Sites with heavy client-side routing and sites requiring a login are outside what the proxy approach
covers; see the limitations in [architecture.md](./architecture.md#known-limitations).

## Possible next steps

Roughly in the order they would pay off:

1. A screenshot of the element taken when the comment is written (`html2canvas` works, the frame is
   same-origin) — this makes a comment readable even after its element is gone.
2. Notifications when someone replies to your comment or decides it — today a rejected comment is
   only discovered under *Mine* with the *Rejected* chip lit.
3. Creating issues from the export (webhook or GitHub API) instead of pasting Markdown.
4. A Playwright snapshot mode for sites where the proxy cannot render the page.
5. Comparing comments between versions of a site — the stored anchors already allow it.
6. Per-project visibility, if one instance ever hosts sites that different clients must not see.
