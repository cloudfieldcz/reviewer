import { describe, expect, it } from 'vitest';
import { isCovered, samplePoints, type Point } from '~/lib/client/overlay';

// The hit test itself needs a real browser (elementsFromPoint); what can go wrong in plain logic is
// where the samples land and how the per-point answers are combined.
const VIEWPORT = { width: 1000, height: 800 };

describe('samplePoints', () => {
  it('takes the centre and four points inset 25 % from the corners of a fully visible rect', () => {
    expect(samplePoints({ left: 100, top: 200, width: 400, height: 100 }, VIEWPORT)).toEqual([
      { x: 300, y: 250 },
      { x: 200, y: 225 },
      { x: 400, y: 225 },
      { x: 200, y: 275 },
      { x: 400, y: 275 },
    ]);
  });

  it('samples only the part of the rect that is on screen', () => {
    // Half of it hangs off the right edge and the top: the visible part is x 800–1000, y 0–100.
    const points = samplePoints({ left: 800, top: -100, width: 400, height: 200 }, VIEWPORT);
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual({ x: 900, y: 50 });
    for (const p of points) {
      expect(p.x).toBeGreaterThan(800);
      expect(p.x).toBeLessThan(1000);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(100);
    }
  });

  it('keeps every sample inside the viewport for an element larger than the screen', () => {
    const points = samplePoints({ left: -500, top: -2000, width: 3000, height: 6000 }, VIEWPORT);
    expect(points[0]).toEqual({ x: 500, y: 400 });
    expect(points.every((p) => p.x > 0 && p.x < VIEWPORT.width && p.y > 0 && p.y < VIEWPORT.height)).toBe(true);
  });

  it('returns nothing for an element scrolled out of view or with no size', () => {
    expect(samplePoints({ left: 10, top: 900, width: 100, height: 50 }, VIEWPORT)).toEqual([]);
    expect(samplePoints({ left: 10, top: -60, width: 100, height: 50 }, VIEWPORT)).toEqual([]);
    expect(samplePoints({ left: 1000, top: 10, width: 100, height: 50 }, VIEWPORT)).toEqual([]);
    expect(samplePoints({ left: 10, top: 10, width: 0, height: 50 }, VIEWPORT)).toEqual([]);
    expect(samplePoints({ left: 10, top: 10, width: 100, height: 0 }, VIEWPORT)).toEqual([]);
  });
});

describe('isCovered', () => {
  const pts: Point[] = [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 3 },
  ];
  const related = (n: string) => n === 'card' || n === 'card > span' || n === 'body';
  const topAt = (byX: Record<number, string | null>) => (p: Point) => byX[p.x];

  it('is covered when an unrelated node is on top at every sample', () => {
    expect(isCovered(pts, topAt({ 1: 'dialog', 2: 'dialog', 3: 'backdrop' }), related)).toBe(true);
  });

  it('is visible when one sample reaches the element, a descendant or an ancestor', () => {
    expect(isCovered(pts, topAt({ 1: 'dialog', 2: 'dialog', 3: 'card' }), related)).toBe(false);
    expect(isCovered(pts, topAt({ 1: 'header', 2: 'card > span', 3: 'header' }), related)).toBe(false);
    expect(isCovered(pts, topAt({ 1: 'body', 2: 'dialog', 3: 'dialog' }), related)).toBe(false);
  });

  it('never hides on missing evidence: no samples, or a point with no page node', () => {
    expect(isCovered([], topAt({}), related)).toBe(false);
    expect(isCovered(pts, topAt({ 1: 'dialog', 2: null, 3: 'dialog' }), related)).toBe(false);
  });
});
