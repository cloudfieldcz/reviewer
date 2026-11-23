/**
 * Page layers – dialogs a site opens over its page. A comment written inside one cannot be shown
 * once the dialog is closed, so the review screen remembers which click opened it and clicks it
 * again to bring the comment back. Recognised through standard markup only; no site is special.
 */
import type { ResolveInput } from './anchor';

/** Open dialogs, native or ARIA. A closed `<dialog>` is in the DOM but not a layer. */
export const LAYER_SELECTOR = 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';

/** How many clicks back the review screen looks for the one that opened a dialog. */
export const TRAIL_LENGTH = 40;

/** What is stored of an opening click: enough to find the element again. */
export type OpenerAnchor = ResolveInput;

/** One click that reached the page (Browse mode, or ⌥-click in Comment mode). */
export interface TrailClick<L = Element> {
  anchor: OpenerAnchor;
  /** The layer the clicked element sat in, if any. */
  layer: L | null;
  /** Layers that were already open when the click happened. */
  open: ReadonlySet<L>;
}

export function layerOf(el: Element): Element | null {
  return el.closest(LAYER_SELECTOR);
}

export function openLayers(doc: Document): Set<Element> {
  return new Set(doc.querySelectorAll(LAYER_SELECTOR));
}

/** The dialog's accessible name: `aria-label`, then `aria-labelledby`, then its first heading. */
export function layerName(layer: Element): string {
  const clip = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 120);
  const label = clip(layer.getAttribute('aria-label') ?? '');
  if (label) return label;
  const doc = layer.ownerDocument;
  const ids = (layer.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  const labelled = clip(ids.map((id) => doc.getElementById(id)?.textContent ?? '').join(' '));
  if (labelled) return labelled;
  return clip(layer.querySelector('h1, h2, h3, h4, [role="heading"]')?.textContent ?? '');
}

/**
 * The clicks that opened `layer`, outermost first. The opener is the last click made while the
 * layer was not yet open (clicks inside it, or while it stood open, are skipped). When that click
 * itself sat in another dialog, that dialog's opener comes before it, up to `maxDepth` levels.
 * Empty when the chain cannot be completed – a partial chain could not be replayed anyway.
 */
export function openersOf<L>(trail: readonly TrailClick<L>[], layer: L, maxDepth = 3): OpenerAnchor[] {
  const chain: OpenerAnchor[] = [];
  let target: L | null = layer;
  let end = trail.length;
  while (target != null) {
    if (chain.length >= maxDepth) return [];
    let i = end - 1;
    while (i >= 0 && (trail[i].open.has(target) || trail[i].layer === target)) i--;
    if (i < 0) return [];
    chain.unshift(trail[i].anchor);
    target = trail[i].layer;
    end = i;
  }
  return chain;
}
