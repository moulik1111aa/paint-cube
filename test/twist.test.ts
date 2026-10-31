import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CELLS, CENTER, LINES, coord, index } from '../src/core/geometry.ts';
import { TWISTS, applyTwist, inverse, permutation, sameTwist } from '../src/core/twist.ts';

const ids = Array.from({ length: CELLS }, (_, i) => i);

test('18 distinct twists: 3 axes x 3 slices x 2 directions', () => {
  assert.equal(TWISTS.length, 18);
  for (let i = 0; i < TWISTS.length; i++)
    for (let j = i + 1; j < TWISTS.length; j++) assert.ok(!sameTwist(TWISTS[i], TWISTS[j]));
});

test('each twist is a permutation that moves exactly 8 cells of its slice', () => {
  for (const t of TWISTS) {
    const p = permutation(t);
    assert.deepEqual([...p].sort((a, b) => a - b), ids);
    const moved = ids.filter((i) => p[i] !== i);
    assert.equal(moved.length, 8);
    for (const i of moved) assert.equal(coord(i)[t.axis], t.slice);
  }
});

test('four turns return the start; a twist then its inverse returns the start', () => {
  for (const t of TWISTS) {
    let cells = ids.slice();
    for (let k = 0; k < 4; k++) cells = applyTwist(cells, t);
    assert.deepEqual(cells, ids);
    assert.deepEqual(applyTwist(applyTwist(ids, t), inverse(t)), ids);
  }
});

test('the center never moves', () => {
  for (const t of TWISTS) assert.equal(permutation(t)[CENTER], CENTER);
});

test('twists map lines inside the twisted layer onto lines', () => {
  const keys = new Set(LINES.map((l) => [...l].sort((a, b) => a - b).join(',')));
  for (const t of TWISTS) {
    const p = permutation(t);
    const inside = LINES.filter((l) => l.every((c) => coord(c)[t.axis] === t.slice));
    assert.equal(inside.length, 8, 'a 3x3 layer holds 8 lines');
    for (const l of inside) assert.ok(keys.has(l.map((c) => p[c]).sort((a, b) => a - b).join(',')));
  }
});

test('applyTwist moves contents: a quarter turn of the bottom layer about the vertical axis', () => {
  const cells: (string | null)[] = Array(CELLS).fill(null);
  cells[index(0, 0, 0)] = 'A';
  const t = { axis: 2, slice: 0, dir: 1 } as const;
  const out = applyTwist(cells, t);
  assert.equal(out[index(0, 0, 0)], null);
  assert.equal(out[permutation(t)[index(0, 0, 0)]], 'A');
  assert.equal(coord(permutation(t)[index(0, 0, 0)])[2], 0, 'stays in its layer');
});
