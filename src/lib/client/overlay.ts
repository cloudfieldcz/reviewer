/**
 * Overlay drawn inside the proxied iframe document: hover outline with a "+" button, numbered
 * markers for existing comments. Everything lives in one container (`[data-reviewer-ui]`) so it can
 * be ignored by anchoring and removed on navigation. Element styles are never touched.
 */

export interface MarkerSpec {
  id: number;
  number: number;
  el: Element;
  mine: boolean;
  active: boolean;
  resolved: boolean;
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
.rz-marker.resolved{background:#9ca3af;opacity:.6}
.rz-marker.resolved.active{background:#f59e0b;opacity:1}
.rz-marker:hover{transform:scale(1.12)}
.rz-outline.resolved{border-color:rgba(156,163,175,.6);opacity:.6}
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
    this.plus.title = 'Add a comment to this element';
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
      nodes.dot.textContent = m.resolved ? '✓' : String(m.number);
      nodes.dot.title = m.resolved ? `Comment #${m.number} – resolved` : `Comment #${m.number}`;
      const mods = `${m.mine ? ' mine' : ''}${m.resolved ? ' resolved' : ''}${m.active ? ' active' : ''}`;
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

  private layoutMarkers() {
    // Stack markers that would land on the same spot.
    const taken: Array<{ top: number; left: number }> = [];
    for (const m of this.markers) {
      const nodes = this.markerNodes.get(m.id)!;
      if (!m.el.isConnected) {
        nodes.dot.style.display = nodes.box.style.display = 'none';
        continue;
      }
      nodes.dot.style.display = nodes.box.style.display = '';
      const r = this.rectOf(m.el);
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
