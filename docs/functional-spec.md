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
| **Comment** | A note by one person, anchored to one element on one page. |
| **Anchor** | The stored description of the element (CSS selector, XPath, text snippet) used to find it again on later visits. |
| **Comment mode** | Review screen state where clicks create comments instead of following links. |
| **Browse mode** | The opposite: the site behaves normally, so the reviewer can navigate to the page they want to comment on. |

## Roles and permissions

Two roles, `admin` and `user`. The role comes from Microsoft Entra ID app roles and is re-evaluated
on every request — see [architecture.md](./architecture.md#authentication-and-roles).

| Action | user | admin |
|---|---|---|
| List projects, open the review screen | ✅ | ✅ |
| See every comment in a project, with its author | ✅ | ✅ |
| Add a comment | ✅ | ✅ |
| Edit / delete **own** comment | ✅ | ✅ |
| Edit / delete someone else's comment | ❌ | ✅ |
| Create / edit / delete a project | ❌ | ✅ |
| Export comments | ❌ | ✅ |
| See the user overview | ❌ | ✅ |

Two deliberate choices here:

- **Everyone sees everything.** Reviews are a team activity; hiding other people's comments would
  produce duplicates. Visibility is shared, editing is not.
- **Permissions are enforced in the API layer**, not in the UI. Hidden buttons are a convenience;
  every endpoint checks the role itself.

There is no per-project assignment in the MVP — every signed-in user sees every project.

## User flows

### User

1. Sign in (Entra ID, no separate account) → the project list.
2. Pick a project → the review screen opens on the project's home page, with a card explaining the
   two modes. The card returns on every visit until the reviewer ticks *Got it, don't show this
   again*; the **?** button in the toolbar brings it back (unticking the box makes it return again).
3. Hover an element; it gets an outline and a `+` button. Click it, type the comment, save.
4. Switch to browse mode, navigate to another page, switch back and keep commenting.
5. Own comments can be edited or deleted from the sidebar at any time.

### Admin

1. *New project*: name and base URL. **Check URL** fetches the address first and reports the status
   and page title, so a typo or an unreachable host is caught before the project exists.
2. The project management screen lists every comment in the project — author, page, element, text,
   time — filterable by page and by author. Each row links straight to that comment on the review
   screen.
3. Export the whole project or a single page as Markdown, CSV or JSON.
4. Admins review like everybody else; the extra rights are additive.

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

**Markers.** Every resolved comment gets a numbered circle next to its element. Numbers follow the
element's position on the page, not the order comments were written, so they read top to bottom like
the page does. Markers reposition on scroll, resize and DOM changes. Clicking a marker highlights
the sidebar entry and vice versa.

**Sidebar.** Filter *All / Mine*, own comments visually distinct from other people's, edit and
delete on own entries only, author and timestamp on each. Comments whose element cannot be found are
listed with an **element not found** flag.

**Navigation.** Links inside the frame stay inside the proxy. The toolbar shows the current path,
offers back / forward / reload, and takes a typed path. The path is mirrored into the Reviewer URL
(`?path=…`) so a specific page under review can be linked to or reloaded.

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

Admin only, whole project or one page.

| Format | Shape | Use |
|---|---|---|
| **Markdown** | Grouped by page, one bullet per comment with author, time, element and body | Paste into an issue or a work order — the main format |
| **CSV** | `id, created_at, author_name, author_email, page_path, tag_name, text_snippet, selector, body` | Spreadsheets, filtering, sign-off tracking |
| **JSON** | Raw dump | Importing into another tool |

## Scope

**In the MVP**

- Entra ID sign-in, `admin` / `user` roles
- Admin: project CRUD with a reachability check, comment overview with filters, export
- User: pick a project, comment, see everyone's comments, edit and delete own
- Review screen: hover highlight, `+`, anchored comments, numbered markers, sidebar, in-frame
  navigation with a path bar
- Comments survive redeploys of the reviewed site
- One Docker image, SQLite on a volume, migrations at startup

**Deliberately not in the MVP**

Replies and threads · a "resolved" state · notifications · screenshots · a mobile layout · Jira or
GitHub integration · sites behind a login · assigning projects to specific users.

Sites with heavy client-side routing and sites requiring a login are outside what the proxy approach
covers; see the limitations in [architecture.md](./architecture.md#known-limitations).

## Possible next steps

Roughly in the order they would pay off:

1. Replies and a *resolved* / *done* state — the most common thing missing from a review round.
2. Per-project user assignment, once more than one client's site is in the same instance.
3. A screenshot of the element taken when the comment is written (`html2canvas` works, the frame is
   same-origin) — this makes a comment readable even after its element is gone.
4. Creating issues from the export (webhook or GitHub API) instead of pasting Markdown.
5. A Playwright snapshot mode for sites where the proxy cannot render the page.
6. Comparing comments between versions of a site — the stored anchors already allow it.
