// The 3x3x3 board: 27 cells indexed x + 3y + 9z, where z is height (z = 0 is the
// bottom layer in stacking mode). Pure data, shared by both modes.

export type Player = 0 | 1;
export type Cell = Player | null;
export type Vec = readonly [number, number, number];
export type Line = readonly [number, number, number];

export const CELLS = 27;
/** The middle cell, (1, 1, 1): the sealed Core in rotating mode. */
export const CENTER = 13;

export const index = (x: number, y: number, z: number): number => x + 3 * y + 9 * z;
export const coord = (i: number): Vec => [i % 3, Math.floor(i / 3) % 3, Math.floor(i / 9)];
export const other = (p: Player): Player => (p === 0 ? 1 : 0);

/** All 49 straight lines of three cells (rows, columns, pillars and every diagonal). */
export const LINES: readonly Line[] = (() => {
  const out: Line[] = [];
  const dirs: Vec[] = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        const d: Vec = [dx, dy, dz];
        const first = d.find((v) => v !== 0);
        if (first !== undefined && first > 0) dirs.push(d); // one of each opposite pair
      }
  for (let i = 0; i < CELLS; i++) {
    const [x, y, z] = coord(i);
    for (const [dx, dy, dz] of dirs) {
      const ends = [x + 2 * dx, y + 2 * dy, z + 2 * dz];
      if (ends.every((v) => v >= 0 && v < 3)) out.push([i, index(x + dx, y + dy, z + dz), index(ends[0], ends[1], ends[2])]);
    }
  }
  return out;
})();

/** For each cell, the indices into LINES of the lines through it. */
export const LINES_THROUGH: readonly (readonly number[])[] = Array.from({ length: CELLS }, (_, c) =>
  LINES.flatMap((l, i) => (l.includes(c) ? [i] : [])),
);

/** The 9 vertical columns (index x + 3y), each listed bottom to top. */
export const COLUMNS: readonly Line[] = Array.from({ length: 9 }, (_, c) => [index(c % 3, Math.floor(c / 3), 0), index(c % 3, Math.floor(c / 3), 1), index(c % 3, Math.floor(c / 3), 2)] as const);

/** Every line fully owned by `p`. */
export function linesOf(cells: readonly Cell[], p: Player): Line[] {
  return LINES.filter(([a, b, c]) => cells[a] === p && cells[b] === p && cells[c] === p);
}
