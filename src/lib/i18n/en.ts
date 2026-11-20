/**
 * English texts of the review screen – the source of the keys. `cs.ts` is typed against this object,
 * so a key missing there fails `npm run check`. Only the review screen and the pages shown inside its
 * frame are translated; everything owners and admins use stays English.
 *
 * `{name}` is replaced by the parameter of that name. A plural entry is an object keyed by
 * `Intl.PluralRules` category (`one`, `few`, `many`, `other`, …) and is picked by the `count` parameter.
 */

/** A text that depends on a count: one entry per `Intl.PluralRules` category the language uses. */
export type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export const en = {
  // ---- page ----
  'page.title': 'Review · {name}',
  'page.projectNotFound': 'Project not found',
  'smallScreen.title': 'Reviewer needs a bigger screen',
  'smallScreen.body':
    'Reviewing means walking through a website with the comments next to it and pointing at the element you mean. That does not fit on a phone – open this page on a desktop or laptop.',

  // ---- toolbar ----
  'toolbar.allProjects': 'All projects',
  'toolbar.back': 'Back',
  'toolbar.forward': 'Forward',
  'toolbar.reload': 'Reload',
  'toolbar.pagePath': 'Page path',
  'toolbar.openOnSite': 'Open this page on the real site',
  'toolbar.uploadedSite': 'Uploaded site',
  'toolbar.viewport': 'Viewport',
  'toolbar.desktop': 'Desktop',
  'toolbar.desktopTitle': 'Desktop – the page fills the window',
  'toolbar.phone': 'iPhone 15',
  'toolbar.phoneTitle': 'iPhone 15 – 393 × 852 px viewport',
  'toolbar.mode': 'Interaction mode',
  'toolbar.browse': 'Browse',
  'toolbar.browseTitle': 'Browse mode (C) – clicking works like the real site',
  'toolbar.comment': 'Comment',
  'toolbar.commentTitle': 'Comment mode (C) – clicking an element writes a comment',
  'toolbar.help': 'How this works',

  // ---- mode chip under the page ----
  'hint.browseMode': 'Browse mode',
  'hint.commentMode': 'Comment mode',
  'hint.altHeld': '⌥ held – this click goes to the site',
  'hint.comment': 'Click any element to comment · hold ⌥ to use the page',
  'hint.browse': 'Clicks work like the real site · press C to comment',

  // ---- intro card ----
  'intro.title': 'Two ways to click',
  'intro.lead': 'The site below is live. You start in Browse mode; the mode decides what your clicks do.',
  'intro.browseName': 'Browse',
  'intro.browseText': '– the site behaves normally, so you can navigate to the page you want to review. Existing comments stay visible.',
  'intro.commentName': 'Comment',
  // The ⌥ key is drawn between these two parts.
  'intro.commentText': '– hover highlights an element, clicking it opens a new comment. Hold',
  'intro.commentTextAfter': 'to click through to the page once (cookie banners, menus).',
  // The C key is drawn between these two parts.
  'intro.switch': 'Switch with the toggle up top or the',
  'intro.switchAfter': ' key.',
  'intro.mute': "Got it, don't show this again",
  'intro.start': 'Start reviewing',

  // ---- sidebar ----
  'sidebar.title': 'Comments',
  'sidebar.viewportHint': 'Comments belong to the viewport they were written in – the page renders differently on a phone',
  'sidebar.filter': 'Filter comments',
  'sidebar.all': 'All {count}',
  'sidebar.mine': 'Mine {count}',
  'sidebar.statusFilter': 'Filter by status',
  'sidebar.showStatus': 'Show {status} comments',
  'sidebar.hideStatus': 'Hide {status} comments',
  'sidebar.otherDesktop': { one: '{count} comment in the desktop view – switch', other: '{count} comments in the desktop view – switch' },
  'sidebar.otherPhone': { one: '{count} comment in the iPhone 15 view – switch', other: '{count} comments in the iPhone 15 view – switch' },
  'sidebar.frameError': 'The target page could not be loaded through the proxy. Check the project base URL.',
  'sidebar.loading': 'Loading…',
  'sidebar.emptyMine': 'Nothing from you here',
  'sidebar.empty': 'No comments here',
  'sidebar.hiddenByStatus': { one: '{count} comment is hidden by the status filter.', other: '{count} comments are hidden by the status filter.' },
  'sidebar.emptyComment': 'Click anything in the page to write the first one.',
  'sidebar.emptyBrowse': 'Switch to Comment mode (C), then click an element to add one.',
  'sidebar.manage': 'Manage project & export',

  // ---- status: chips (a group of comments) and one comment's verdict ----
  'filter.open': 'Open',
  'filter.approved': 'Approved',
  'filter.rejected': 'Rejected',
  'status.open': 'Open',
  'status.approved': 'Approved',
  'status.rejected': 'Rejected',

  // ---- composer, cards, replies ----
  'draft.title': 'New comment',
  'draft.placeholder': 'What should change here?',
  'draft.keys': '⌘↵ save · esc cancel',
  'action.cancel': 'Cancel',
  'action.save': 'Save',
  'action.saving': 'Saving…',
  'action.edit': 'Edit',
  'action.delete': 'Delete',
  'action.reply': 'Reply',
  'action.sending': 'Sending…',
  'action.approve': 'Approve',
  'action.reject': 'Reject',
  'action.reopen': 'Reopen',
  'action.restore': 'Restore state',
  'action.restoreTitle': 'Put the page back into the state it was in when this comment was made',
  'card.you': 'You',
  'card.decidedBy': '{status} by {who}',
  'card.decidedByYou': 'you',
  'card.decidedBySomeone': 'someone',
  'card.notFound': 'Element not found',
  'card.notFoundTitle': 'The element this comment was anchored to is no longer on the page (site changed?). The comment is kept.',
  'card.byText': 'Matched by text',
  'card.byTextTitle': 'Matched by text content – the page structure changed since the comment was made.',
  'reply.placeholder': 'Reply…',
  'reply.keys': '⌘↵ send · esc cancel',
  'confirm.deleteComment': 'Delete this comment?',
  'confirm.deleteReply': 'Delete this reply?',
  'time.justNow': 'just now',
  /** The element's text quoted on a card. */
  quote: '“{text}”',

  // ---- overlay inside the frame ----
  'overlay.plus': 'Add a comment to this element',
  'overlay.marker': 'Comment #{number}',
  'overlay.markerDecided': 'Comment #{number} – {status}',

  // ---- errors shown in the error bar ----
  'error.restore': 'This page cannot restore the saved state.',
  'error.network': 'Reviewer could not be reached – check the connection and try again.',
  'error.http': 'The request failed (HTTP {status}).',
  'error.unexpected': '{detail}',
  // Known API messages, mapped from the server's English text in `API_ERRORS` (index.ts). The English
  // value must stay identical to the server's message – tests/i18n.test.ts checks that.
  'api.commentEmpty': 'Comment must not be empty',
  'api.replyEmpty': 'Reply must not be empty',
  'api.editOwn': 'You can only edit your own comments',
  'api.deleteOwn': 'You can only delete your own comments',
  'api.decidedEdit': 'A decided comment can no longer be edited',
  'api.decidedDelete': 'A decided comment can no longer be deleted',
  'api.replyOwn': 'You can only modify your own replies',
  'api.managerOnly': 'Only a project manager can do this',
  'api.commentNotFound': 'Comment not found',
  'api.replyNotFound': 'Reply not found',
  'api.projectNotFound': 'Project not found',
  'api.internal': 'Internal error',

  // ---- pages served inside the review frame ----
  'frame.emptyTitle': 'Reviewer – nothing uploaded',
  'frame.emptyHeading': 'Nothing has been uploaded yet',
  'frame.emptyBody': "An admin can upload the built site on the project's manage page.",
  'frame.errorTitle': 'Reviewer – proxy error',
  'frame.errorHeading': 'The page could not be loaded',
  'frame.noResponse': 'Target site did not respond: {detail}',
  'frame.readFailed': '{detail}',
  'frame.target': 'Target:',
} satisfies Record<string, string | Plural>;
