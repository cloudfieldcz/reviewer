# Changelog

All notable changes to Reviewer. Newest first.

## Unreleased — branch `poc-static-sites`

Changes made while using Reviewer to collect comments on a clickable prototype: a static React build
that Czech officials click through. Everything is generic: Reviewer knows nothing about that
prototype, and a page that uses none of the new hooks behaves as before.

### Added

- **Uploaded sites.** A new project kind next to proxied websites. An admin creates a project of kind
  *Uploaded site* and uploads a built folder from the manage page (folder picker, no zip; at most
  3,000 files and 150 MB). A new upload replaces the old one at once, and comments stay with their
  page addresses. Reviewer serves the folder at `/p/{id}/` with `<base href="/p/{id}/">` and an SPA
  fallback, so a client-side router works inside the frame. Files live in `SITES_DIR`.
- **Page context on comments.** A page may define `window.reviewerContext()` returning
  `{label?, state?}`. Reviewer stores it with each new comment (a state over 256 KB is dropped and the
  label kept). The label shows on the comment card, in the manage table and in all exports.
- **Restore state.** A page may define `window.reviewerRestore(state)`. A comment with a saved state
  then offers *Restore state*: Reviewer hands the state to the page, reloads the frame and focuses
  the comment.
- **Links to a comment.** `/review/{id}?path=…&comment={commentId}` opens the comment's page, viewport
  and status filter, restores its state when it has one, and focuses it.
- **Stable anchors declared by the page.** A page names its own stable attributes with
  `<meta name="reviewer-anchors" content="data-foo data-bar">`. Reviewer's own `data-review-anchor`
  always works too. An element with such an attribute and a unique value is anchored by it directly,
  and an ancestor's anchor can appear in a derived selector.
- **Comments inside dialogs.** A comment written inside a dialog (`<dialog open>`, `role="dialog"` or
  `"alertdialog"`, `aria-modal="true"`) records the dialog's name and the click that opened it, also
  through a dialog opened from another dialog. The card says *In the dialog “…”*. Once the dialog is
  closed, the card offers *Open the dialog*, which clicks the opener again and points at the element.
  A card click, a comment link and *Restore state* do the same. Exports name the dialog after the
  label.
- **Phone view per project.** Admins can switch off the *Desktop / iPhone 15* switch in the manage
  page settings, for sites not built for phones. The review screen then always shows the desktop
  view. Existing phone comments are kept.
- **Czech on the review screen.** The review screen (and the two pages shown inside its frame:
  *nothing uploaded yet* and the proxy error) follows the browser's language: Czech for `cs` and
  `sk`, otherwise English, or `DEFAULT_LOCALE` when the browser names neither. The project list,
  manage page, admin pages, exports and API messages stay English.

### Changed

- **Browse mode is the default.** The review screen used to open in Comment mode, so the first click
  on a page was swallowed. It now opens in Browse mode; the `C` key and the mode switch still change
  it.
- **Some English texts on the review screen.** Relative times now come from `Intl` (for example
  "yesterday" instead of "1 d ago"), and network errors read "Reviewer could not be reached – …".

### Fixed

- **Markers drawn over dialogs.** A comment's marker and outline were drawn over a dialog, drawer,
  menu or sticky header that the page opened above the commented element. Reviewer now checks
  whether the element is really visible and hides the marker while something covers it.
- **Crosshair cursor in Browse mode.** Switching modes did not change the cursor in the frame; it
  stayed the way the page loaded. Browse mode now shows the normal cursor and Comment mode the
  crosshair.
- **Comment cards out of step with the page.** Cards and markers were re-anchored only on a page load
  or navigation, so an element that a page added or removed without navigating (a dialog, a tab)
  left the card pointing at nothing. Reviewer now re-anchors after such changes.
- **Comment card buttons wrapping.** Longer labels such as *Obnovit stav* no longer break onto two
  lines.

### Upgrading

- **Database:** three plain `ALTER TABLE … ADD` migrations run on start-up: `0006` adds
  `projects.kind`, `projects.site_uploaded_at` and `comments.context`; `0007` adds
  `projects.phone_view` (on for existing projects). No data is rewritten.
- **New settings:**
  - `SITES_DIR` is where uploaded sites live (default `./data/sites`; `/data/sites` in the Docker
    image). Put it on the same persistent volume as the database.
  - `DEFAULT_LOCALE` (`cs` or `en`, default `en`) sets the review screen's language when the browser
    names neither.
- **Reverse proxy:** an upload sends the whole folder in one request. A proxy in front of Reviewer
  needs a request body limit above the size of the largest build, up to 150 MB.
- **Pages that used `data-poc-anchor`** (the earlier name in this branch) need
  `<meta name="reviewer-anchors" content="data-poc-anchor">` so that new comments keep anchoring by
  it. Comments already stored resolve as before.
