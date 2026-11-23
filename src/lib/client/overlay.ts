/**
 * Overlay drawn inside the proxied iframe document: hover outline with a "+" button, numbered
 * markers for existing comments. Everything lives in one container (`[data-reviewer-ui]`) so it can
 * be ignored by anchoring and removed on navigation. Element styles are never touched.
 */
import { isReviewerNode } from './anchor';

export interface MarkerSpec {
  id: number;
  number: number;
  el: Element;
  mine: boolean;
  active: boolean;
  status: 'open' | 'approved' | 'rejected';
}

/** Texts drawn into the page; the caller owns them, so the overlay never has to know the locale. */
export interface OverlayLabels {
  /** Title of the "+" button. */
  plus: string;
  /** Title of a marker. */
  marker: (m: MarkerSpec) => string;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Where to hit-test an element for "is something drawn over it": the centre of its rect clipped to
 * the viewport plus four points inset 25 % from the clipped corners. Viewport (client) coordinates in
 * and out. Empty when no part of the rect is on screen (scrolled away, zero size) – the caller must not
 * read that as "covered".
 */
export function samplePoints(rect: { left: number; top: number; width: number; height: number }, viewport: { width: number; height: number }): Point[] {
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.left + rect.width, viewport.width);
  const bottom = Math.min(rect.top + rect.height, viewport.height);
  const w = right - left;
  const h = bottom - top;
  if (!(w > 0 && h > 0)) return [];
  const at = (fx: number, fy: number): Point => ({ x: left + w * fx, y: top + h * fy });
  return [at(0.5, 0.5), at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75)];
}

/**
 * True when every sample point is topped by something unrelated to the element (a dialog, drawer,
 * menu or sticky header drawn over it). `topAt` returns the topmost page node at a point, ignoring
 * Reviewer's own; `related` says whether that node is the element, inside it or around it. No samples,
 * or a point with no page node at all, never counts as covered – the marker stays when in doubt.
 */
export function isCovered<T>(points: Point[], topAt: (p: Point) => T | null | undefined, related: (node: T) => boolean): boolean {
  if (points.length === 0) return false;
  for (const p of points) {
    const node = topAt(p);
    if (node == null || related(node)) return false;
  }
  return true;
}

const STYLE = `
[data-reviewer-ui]{position:absolute;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483000;pointer-events:none;font:500 12px/1 'IBM Plex Sans',system-ui,-apple-system,Segoe UI,sans-serif}
[data-reviewer-ui] *{box-sizing:border-box}
.rz-hover{position:absolute;border:2px solid #6e56cf;border-radius:4px;background:rgba(110,86,207,.07);pointer-events:none;transition:top .05s,left .05s,width .05s,height .05s}
.rz-plus{position:absolute;width:26px;height:26px;border-radius:50%;background:#6e56cf;color:#fff;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:500;cursor:pointer;pointer-events:auto;box-shadow:0 2px 8px rgba(21,21,29,.35);user-select:none;transition:transform .08s}
.rz-plus:hover{background:#5b44b8;transform:scale(1.08)}
.rz-tag{position:absolute;background:#6e56cf;color:#fff;padding:2px 5px;border-radius:3px;font-size:10px;font-family:'IBM Plex Mono',ui-monospace,monospace;pointer-events:none;white-space:nowrap}
.rz-outline{position:absolute;border:1.5px dashed rgba(113,113,138,.75);border-radius:4px;pointer-events:none}
.rz-outline.mine{border-color:rgba(110,86,207,.75)}
.rz-outline.active{border-style:solid;border-width:2px;background:rgba(245,158,11,.10);border-color:#f59e0b}
.rz-marker{position:absolute;min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:#71718a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;cursor:pointer;pointer-events:auto;box-shadow:0 2px 6px rgba(21,21,29,.3);border:2px solid #fff;transition:transform .08s}
.rz-marker.mine{background:#6e56cf}
.rz-marker.active{background:#f59e0b;color:#15151d;transform:scale(1.15)}
.rz-marker.approved{background:#059669;opacity:.7}
.rz-marker.rejected{background:#dc2626;opacity:.7}
.rz-marker.approved.active,.rz-marker.rejected.active{background:#f59e0b;color:#15151d;opacity:1}
.rz-marker:hover{transform:scale(1.12)}
.rz-outline.approved{border-color:rgba(5,150,105,.55);opacity:.7}
.rz-outline.rejected{border-color:rgba(220,38,38,.55);opacity:.7}
/* Comment mode is felt before it is read: the cursor changes across the whole page. */
html.rz-picking,html.rz-picking *{cursor:crosshair!important}
html.rz-picking .rz-plus,html.rz-picking .rz-marker{cursor:pointer!important}
`;

export class Overlay {
  private root: HTMLElement;
  private hoverBox: HTMLElement;
  private plus: HTMLElement;
  private tag: HTMLElement;
  private hoverEl: Element | null = null;
  private markers: MarkerSpec[] = [];
  private markerNodes = new Map<number, { dot: HTMLElement; box: HTMLElement }>();
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private mo: MutationObserver | null = null;
  private cleanup: Array<() => void> = [];

  constructor(
    private doc: Document,
    private handlers: { onPlus: (el: Element) => void; onMarker: (id: number) => void },
    private labels: OverlayLabels,
  ) {
    const style = doc.createElement('style');
    style.setAttribute('data-reviewer-ui', '');
    style.textContent = STYLE;
    doc.head.appendChild(style);

    this.root = doc.createElement('div');
    this.root.setAttribute('data-reviewer-ui', '');
    this.hoverBox = this.mk('rz-hover');
    this.plus = this.mk('rz-plus');
    this.plus.textContent = '+';
    this.plus.title = labels.plus;
    this.tag = this.mk('rz-tag');
    this.hideHover();
    this.root.append(this.hoverBox, this.tag, this.plus);
    doc.body.appendChild(this.root);

    this.plus.addEventListener('mousedown', (e) => e.stopPropagation(), true);
    this.plus.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.hoverEl) this.handlers.onPlus(this.hoverEl);
    });

    const win = doc.defaultView!;
    const schedule = () => this.schedule();
    win.addEventListener('scroll', schedule, { passive: true, capture: true });
    win.addEventListener('resize', schedule);
    this.cleanup.push(() => win.removeEventListener('scroll', schedule, true), () => win.removeEventListener('resize', schedule));
    if ('ResizeObserver' in win) {
      this.ro = new win.ResizeObserver(schedule);
      this.ro.observe(doc.documentElement);
    }
    this.mo = new win.MutationObserver((records) => {
      if (records.every((r) => this.root.contains(r.target))) return;
      this.schedule();
    });
    this.mo.observe(doc.body, { childList: true, subtree: true, attributes: true, characterData: true });
    // Pages also open and close dialogs with a class on <html> (`html.modal-open`), outside the body subtree.
    this.mo.observe(doc.documentElement, { attributes: true });
    // A dialog that fades out changes a class first and only stops covering its element when the
    // transition ends – no mutation fires then, so re-test the markers when it does.
    doc.addEventListener('transitionend', schedule, true);
    doc.addEventListener('animationend', schedule, true);
    this.cleanup.push(() => doc.removeEventListener('transitionend', schedule, true), () => doc.removeEventListener('animationend', schedule, true));
    // Late-loading images / fonts move things around.
    win.addEventListener('load', schedule);
    doc.fonts?.ready.then(schedule).catch(() => {});
  }

  private mk(cls: string): HTMLElement {
    const d = this.doc.createElement('div');
    d.className = cls;
    return d;
  }

  private rectOf(el: Element) {
    const r = el.getBoundingClientRect();
    const win = this.doc.defaultView!;
    return { top: r.top + win.scrollY, left: r.left + win.scrollX, width: r.width, height: r.height };
  }

  private place(node: HTMLElement, r: { top: number; left: number; width: number; height: number }) {
    node.style.top = `${r.top}px`;
    node.style.left = `${r.left}px`;
    node.style.width = `${r.width}px`;
    node.style.height = `${r.height}px`;
  }

  /** Comment mode on: crosshair cursor over the whole document. */
  setPicking(on: boolean) {
    this.doc.documentElement.classList.toggle('rz-picking', on);
    if (!on) this.setHover(null);
  }

  setHover(el: Element | null) {
    if (el === this.hoverEl) return;
    this.hoverEl = el;
    if (!el) return this.hideHover();
    this.hoverBox.style.display = this.plus.style.display = this.tag.style.display = '';
    this.layoutHover();
  }

  private hideHover() {
    this.hoverBox.style.display = this.plus.style.display = this.tag.style.display = 'none';
  }

  private layoutHover() {
    if (!this.hoverEl || !this.hoverEl.isConnected) return this.hideHover();
    const r = this.rectOf(this.hoverEl);
    this.place(this.hoverBox, r);
    const docWidth = this.doc.documentElement.clientWidth + (this.doc.defaultView?.scrollX ?? 0);
    const plusLeft = Math.min(r.left + r.width - 12, docWidth - 28);
    this.plus.style.top = `${Math.max(r.top - 12, 0)}px`;
    this.plus.style.left = `${Math.max(plusLeft, 0)}px`;
    this.tag.textContent = this.hoverEl.tagName.toLowerCase() + (this.hoverEl.id ? '#' + this.hoverEl.id : '');
    this.tag.style.top = `${Math.max(r.top - 16, 0)}px`;
    this.tag.style.left = `${Math.max(r.left, 0)}px`;
  }

  setMarkers(markers: MarkerSpec[]) {
    this.markers = markers;
    const seen = new Set<number>();
    for (const m of markers) {
      seen.add(m.id);
      let nodes = this.markerNodes.get(m.id);
      if (!nodes) {
        const dot = this.mk('rz-marker');
        const box = this.mk('rz-outline');
        dot.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.handlers.onMarker(m.id);
        });
        dot.addEventListener('mousedown', (e) => e.stopPropagation(), true);
        this.root.append(box, dot);
        nodes = { dot, box };
        this.markerNodes.set(m.id, nodes);
      }
      const mark = m.status === 'approved' ? '✓' : m.status === 'rejected' ? '✕' : String(m.number);
      nodes.dot.textContent = mark;
      nodes.dot.title = this.labels.marker(m);
      const mods = `${m.mine ? ' mine' : ''}${m.status === 'open' ? '' : ` ${m.status}`}${m.active ? ' active' : ''}`;
      nodes.dot.className = `rz-marker${mods}`;
      nodes.box.className = `rz-outline${mods}`;
    }
    for (const [id, nodes] of this.markerNodes) {
      if (!seen.has(id)) {
        nodes.dot.remove();
        nodes.box.remove();
        this.markerNodes.delete(id);
      }
    }
    this.layoutMarkers();
  }

  /**
   * Hit test: is the element hidden under something the page drew over it? Our container sits at the
   * top of the z-order, so without this a marker would float over a modal opened above its element.
   */
  private covered(el: Element): boolean {
    const win = this.doc.defaultView!;
    const root = this.doc.documentElement;
    const viewport = { width: Math.min(win.innerWidth, root.clientWidth || win.innerWidth), height: Math.min(win.innerHeight, root.clientHeight || win.innerHeight) };
    return isCovered(
      samplePoints(el.getBoundingClientRect(), viewport),
      (p) => this.doc.elementsFromPoint(p.x, p.y).find((n) => !isReviewerNode(n)),
      // An ancestor on top means the element itself is not hit-testable there (pointer-events: none).
      (n) => n === el || el.contains(n) || n.contains(el),
    );
  }

  private layoutMarkers() {
    // Measure every element before moving any marker: interleaving reads and writes forces a reflow per marker.
    // A detached or covered element hides its marker and outline and takes no slot below.
    const measured = this.markers.map((m) => ({ m, r: m.el.isConnected && !this.covered(m.el) ? this.rectOf(m.el) : null }));
    // Stack markers that would land on the same spot.
    const taken: Array<{ top: number; left: number }> = [];
    for (const { m, r } of measured) {
      const nodes = this.markerNodes.get(m.id)!;
      if (!r) {
        nodes.dot.style.display = nodes.box.style.display = 'none';
        continue;
      }
      nodes.dot.style.display = nodes.box.style.display = '';
      this.place(nodes.box, r);
      // Sit just outside the element's top-left corner so small inline elements stay readable.
      let top = Math.max(r.top - 11, 0);
      let left = r.left >= 26 ? r.left - 26 : r.left + r.width + 4;
      while (taken.some((t) => Math.abs(t.top - top) < 20 && Math.abs(t.left - left) < 24)) left += 26;
      taken.push({ top, left });
      nodes.dot.style.top = `${top}px`;
      nodes.dot.style.left = `${left}px`;
    }
  }

  /** Re-measures everything on the next frame (debounced). */
  schedule() {
    if (this.raf) return;
    this.raf = this.doc.defaultView!.requestAnimationFrame(() => {
      this.raf = 0;
      this.layoutHover();
      this.layoutMarkers();
    });
  }

  destroy() {
    this.ro?.disconnect();
    this.mo?.disconnect();
    this.cleanup.forEach((fn) => fn());
    this.doc.documentElement.classList.remove('rz-picking');
    this.root.remove();
    this.doc.head.querySelector('style[data-reviewer-ui]')?.remove();
  }
}
