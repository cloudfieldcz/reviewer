/**
 * Element anchoring – runs in the parent window against the same-origin iframe document.
 * Three anchors are stored per comment (CSS selector, XPath, text snippet) and resolved in that order.
 */
import { attr as defaultAttr, className as defaultClassName, finder, idName as defaultIdName } from '@medv/finder';

export interface Anchor {
  selector: string | null;
  xpath: string | null;
  textSnippet: string | null;
  tagName: string;
  rectTop: number;
}

export const SNIPPET_LENGTH = 80;

const SKIP_TAGS = new Set(['HTML', 'BODY', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
const MEDIA = new Set(['IMG', 'SVG', 'VIDEO', 'PICTURE', 'CANVAS', 'IFRAME', 'FIGURE']);

export function isReviewerNode(el: Element | null): boolean {
  return !!el?.closest?.('[data-reviewer-ui]');
}

/** Does the element carry its own text (not just descendants' text)? */
function hasOwnText(el: Element): boolean {
  for (const n of el.childNodes) {
    if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0) return true;
  }
  return false;
}

/**
 * Walks up from the hovered node to the closest "meaningful" element: something with its own text,
 * an image / media element, an interactive control, or an element with a stable id.
 * Falls back to the hovered element itself when nothing better is found in a few levels.
 */
export function pickMeaningful(start: Element | null): Element | null {
  if (!start || isReviewerNode(start)) return null;
  let el: Element | null = start;
  let depth = 0;
  while (el && depth < 6) {
    if (SKIP_TAGS.has(el.tagName)) return null;
    if (INTERACTIVE.has(el.tagName) || MEDIA.has(el.tagName)) return el;
    if (hasOwnText(el)) return el;
    if (el.id) return el;
    el = el.parentElement;
    depth++;
  }
  return SKIP_TAGS.has(start.tagName) ? null : start;
}

export function snippetOf(el: Element): string | null {
  const text = (el as HTMLElement).innerText ?? el.textContent ?? '';
  const alt = el.getAttribute('alt') ?? el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '';
  const t = (text.trim() || alt.trim()).replace(/\s+/g, ' ');
  return t ? t.slice(0, SNIPPET_LENGTH) : null;
}

export function xpathOf(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'HTML') {
    let index = 1;
    let sib = node.previousElementSibling;
    while (sib) {
      if (sib.tagName === node.tagName) index++;
      sib = sib.previousElementSibling;
    }
    parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
    node = node.parentElement;
  }
  return '/html/' + parts.join('/');
}

export function computeAnchor(el: Element, doc: Document): Anchor {
  let selector: string | null = null;
  try {
    selector = finder(el, {
      root: doc.body,
      // Ignore our own overlay nodes and volatile framework classes/ids.
      className: (n) => defaultClassName(n) && !/^(svelte-|astro-|css-|sc-|_)|[0-9a-f]{6,}/i.test(n),
      idName: (n) => defaultIdName(n) && !/[0-9a-f]{8,}|^(radix|headlessui|react-aria)/i.test(n),
      attr: (name, value) => (name === 'data-testid' || name === 'name' || name === 'aria-label') && defaultAttr(name, value),
      seedMinLength: 2,
      optimizedMinLength: 2,
      timeoutMs: 300,
    });
  } catch {
    selector = null;
  }
  const rect = el.getBoundingClientRect();
  const win = doc.defaultView!;
  return {
    selector,
    xpath: xpathOf(el),
    textSnippet: snippetOf(el),
    tagName: el.tagName.toLowerCase(),
    rectTop: rect.top + win.scrollY,
  };
}

export interface ResolveInput {
  selector: string | null;
  xpath: string | null;
  textSnippet: string | null;
  tagName: string | null;
}

export type ResolveMethod = 'selector' | 'xpath' | 'text';

/**
 * Finds the element a comment was anchored to.
 * Order: selector hit with matching text → xpath hit with matching text → any element with matching
 * text → unique selector hit whose text changed (the element was probably edited in response to the
 * comment). Positional xpath without a text match is never trusted.
 */
export function resolveAnchor(doc: Document, a: ResolveInput): { el: Element; method: ResolveMethod } | null {
  const tag = a.tagName?.toUpperCase();
  const tagMatches = (el: Element) => !tag || el.tagName === tag;
  const textMatches = (el: Element) => !a.textSnippet || snippetOf(el) === a.textSnippet;

  let selectorHits: Element[] = [];
  if (a.selector) {
    try {
      selectorHits = Array.from(doc.querySelectorAll(a.selector)).filter((e) => !isReviewerNode(e) && tagMatches(e));
    } catch {
      /* invalid selector */
    }
  }
  const bySelector = selectorHits.find(textMatches);
  if (bySelector) return { el: bySelector, method: 'selector' };

  if (a.xpath) {
    try {
      const r = doc.evaluate(a.xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      const el = r.singleNodeValue as Element | null;
      if (el && el.nodeType === Node.ELEMENT_NODE && tagMatches(el) && textMatches(el)) return { el, method: 'xpath' };
    } catch {
      /* ignore */
    }
  }
  if (a.textSnippet) {
    for (const el of doc.body.querySelectorAll(tag ? tag.toLowerCase() : '*')) {
      if (!isReviewerNode(el) && snippetOf(el) === a.textSnippet) return { el, method: 'text' };
    }
  }
  if (selectorHits.length === 1) return { el: selectorHits[0]!, method: 'selector' };
  return null;
}
