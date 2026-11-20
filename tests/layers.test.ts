import { describe, expect, it } from 'vitest';
import { openersOf, type TrailClick } from '~/lib/client/layers';

// Layers are compared by identity only, so plain strings stand in for the dialog elements.
const a = (name: string) => ({ selector: `#${name}`, xpath: null, textSnippet: name, tagName: 'button' });
const click = (name: string, layer: string | null, open: string[]): TrailClick<string> => ({
  anchor: a(name),
  layer,
  open: new Set(open),
});

describe('openersOf', () => {
  it('takes the last click before the dialog appeared', () => {
    const trail = [click('menu', null, []), click('start', null, []), click('radio', 'D', ['D']), click('page', null, ['D'])];
    expect(openersOf(trail, 'D')).toEqual([a('start')]);
  });

  it('walks out through a dialog opened from another dialog', () => {
    const trail = [click('start', null, []), click('more', 'D', ['D']), click('confirm-radio', 'C', ['D', 'C'])];
    expect(openersOf(trail, 'C')).toEqual([a('start'), a('more')]);
  });

  it('finds the click that re-opened a dialog closed earlier', () => {
    // D was open, closed (gone from the DOM), then opened again by "start-again".
    const trail = [click('start', null, []), click('inside', 'D', ['D']), click('close', 'D', ['D']), click('start-again', null, [])];
    expect(openersOf(trail, 'D')).toEqual([a('start-again')]);
  });

  it('gives nothing when the opening click is not in the trail', () => {
    expect(openersOf([click('inside', 'D', ['D'])], 'D')).toEqual([]);
    expect(openersOf([], 'D')).toEqual([]);
  });

  it('gives nothing when an outer dialog has no known opener', () => {
    const trail = [click('more', 'D', ['D'])];
    expect(openersOf(trail, 'C')).toEqual([]);
  });

  it('stops at the depth limit', () => {
    const trail = [click('1', null, []), click('2', 'A', ['A']), click('3', 'B', ['A', 'B']), click('4', 'C', ['A', 'B', 'C'])];
    expect(openersOf(trail, 'D', 3)).toEqual([]);
    expect(openersOf(trail, 'D', 4)).toEqual([a('1'), a('2'), a('3'), a('4')]);
  });
});
