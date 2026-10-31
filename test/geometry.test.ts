import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CELLS, CENTER, COLUMNS, LINES, LINES_THROUGH, coord, index } from '../src/core/geometry.ts';

test('cells index and coordinates round-trip, z is height', () => {
  assert.equal(CELLS, 27);
  for (let i = 0; i < CELLS; i++) assert.equal(index(...coord(i)), i);
  assert.deepEqual(coord(CENTER), [1, 1, 1]);
  assert.deepEqual(coord(index(2, 0, 1)), [2, 0, 1]);
});

test('there are 49 distinct straight lines of 3', () => {
  assert.equal(LINES.length, 49);
  const keys = new Set(LINES.map((l) => [...l].sort((a, b) => a - b).join(',')));
  assert.equal(keys.size, 49);
  for (const [a, b, c] of LINES) {
    const [pa, pb, pc] = [coord(a), coord(b), coord(c)];
    for (let k = 0; k < 3; k++) assert.equal(pb[k] - pa[k], pc[k] - pb[k], 'evenly spaced');
    assert.ok(new Set([a, b, c]).size === 3);
  }
});

test('lines per cell: center 13, corners 7, face centers 5, edges 4', () => {
  const kind = (i: number) => coord(i).filter((v) => v === 1).length; // 0 corner, 1 edge, 2 face, 3 center
  const expected = [7, 4, 5, 13];
  for (let i = 0; i < CELLS; i++) {
    assert.equal(LINES_THROUGH[i].length, expected[kind(i)], `cell ${i}`);
    for (const li of LINES_THROUGH[i]) assert.ok(LINES[li].includes(i));
  }
});

test('9 columns, each listed bottom to top', () => {
  assert.equal(COLUMNS.length, 9);
  const seen = new Set<number>();
  COLUMNS.forEach((col, c) => {
    col.forEach((cell, z) => {
      const [x, y, cz] = coord(cell);
      assert.equal(cz, z);
      assert.equal(x + 3 * y, c);
      seen.add(cell);
    });
  });
  assert.equal(seen.size, 27);
});
