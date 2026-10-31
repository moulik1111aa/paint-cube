// Twists: a quarter turn of one of the 9 layers (3 per axis, middle slices included),
// in either direction. Every mark in the layer moves with it; the center never moves.

import { CELLS, coord, index } from './geometry.ts';

export type Axis = 0 | 1 | 2;
export type Slice = 0 | 1 | 2;
export type Dir = 1 | -1;
export interface Twist {
  axis: Axis;
  slice: Slice;
  dir: Dir;
}

export const TWISTS: readonly Twist[] = ([0, 1, 2] as const).flatMap((axis) =>
  ([0, 1, 2] as const).flatMap((slice) => ([1, -1] as const).map((dir) => ({ axis, slice, dir }))),
);

export const sameTwist = (a: Twist, b: Twist): boolean => a.axis === b.axis && a.slice === b.slice && a.dir === b.dir;
export const inverse = (t: Twist): Twist => ({ axis: t.axis, slice: t.slice, dir: t.dir === 1 ? -1 : 1 });

const cache = new Map<string, readonly number[]>();

/** `permutation(t)[from]` is where the contents of cell `from` end up. */
export function permutation(t: Twist): readonly number[] {
  const key = `${t.axis}${t.slice}${t.dir}`;
  let p = cache.get(key);
  if (!p) {
    const [u, v] = ([0, 1, 2] as const).filter((a) => a !== t.axis);
    const out: number[] = [];
    for (let i = 0; i < CELLS; i++) {
      const c = [...coord(i)];
      if (c[t.axis] === t.slice) {
        const [cu, cv] = [c[u], c[v]];
        if (t.dir === 1) [c[u], c[v]] = [2 - cv, cu];
        else [c[u], c[v]] = [cv, 2 - cu];
      }
      out.push(index(c[0], c[1], c[2]));
    }
    p = out;
    cache.set(key, p);
  }
  return p;
}

/** A new array with every cell's contents moved by the twist. */
export function applyTwist<T>(cells: readonly T[], t: Twist): T[] {
  const p = permutation(t);
  const out = cells.slice();
  for (let i = 0; i < cells.length; i++) out[p[i]] = cells[i];
  return out;
}
