// Stacking mode (Cascade): drop paint down one of 9 columns. After every drop, every
// completed line scores for its owner and shatters; pieces above fall, and any lines
// the fall completes score again, worth more each wave (wave n scores n per line).
// First to 5 points wins; if both pass 5 in one chain, the higher score wins and a tie
// goes to the mover. A full board always contains a line, so play can never lock up.

import { CELLS, COLUMNS, linesOf, other, type Cell, type Player } from './geometry.ts';
import { IllegalMove, type GameEvent, type IllegalReason } from './events.ts';

export const TARGET = 5;

export interface CascadeState {
  mode: 'cascade';
  cells: Cell[];
  turn: Player;
  turns: number;
  scores: [number, number];
  /** `winner: null` is a draw (only Agents mode can draw a Cascade round). */
  result: { winner: Player | null } | null;
}

export type CascadeMove = { kind: 'drop'; column: number };

export function newCascade(first: Player): CascadeState {
  return { mode: 'cascade', cells: Array(CELLS).fill(null), turn: first, turns: 0, scores: [0, 0], result: null };
}

/** The lowest empty cell of a column, or -1 when it is full. */
export function landing(cells: readonly Cell[], column: number): number {
  return COLUMNS[column].find((c) => cells[c] === null) ?? -1;
}

export function checkCascade(s: CascadeState, move: CascadeMove): IllegalReason | null {
  if (s.result) return 'round-over';
  if (!Number.isInteger(move.column) || move.column < 0 || move.column > 8) return 'not-a-column';
  if (landing(s.cells, move.column) < 0) return 'column-full';
  return null;
}

export function legalCascade(s: CascadeState): CascadeMove[] {
  if (s.result) return [];
  return COLUMNS.flatMap((_, column) => (checkCascade(s, { kind: 'drop', column }) === null ? [{ kind: 'drop' as const, column }] : []));
}

/** Let pieces fall down their columns; returns what moved. */
function settle(cells: Cell[]): { from: number; to: number; player: Player }[] {
  const moves: { from: number; to: number; player: Player }[] = [];
  for (const col of COLUMNS) {
    let z = 0;
    for (let k = 0; k < 3; k++) {
      const p = cells[col[k]];
      if (p === null) continue;
      if (k !== z) {
        cells[col[z]] = p;
        cells[col[k]] = null;
        moves.push({ from: col[k], to: col[z], player: p });
      }
      z++;
    }
  }
  return moves;
}

export function applyCascade(s: CascadeState, move: CascadeMove): { state: CascadeState; events: GameEvent[] } {
  const why = checkCascade(s, move);
  if (why) throw new IllegalMove(why);
  const p = s.turn;
  const cells = s.cells.slice();
  const scores: [number, number] = [s.scores[0], s.scores[1]];
  const cell = landing(cells, move.column);
  cells[cell] = p;
  const events: GameEvent[] = [{ type: 'placed', player: p, cell, column: move.column }];

  for (let wave = 1; ; wave++) {
    const lines = [linesOf(cells, 0), linesOf(cells, 1)] as const;
    if (!lines[0].length && !lines[1].length) break;
    const cleared = new Set<number>();
    for (const q of [0, 1] as const) {
      for (const line of lines[q]) {
        events.push({ type: 'lineCompleted', player: q, cells: line, wave });
        line.forEach((c) => cleared.add(c));
      }
    }
    for (const q of [0, 1] as const) {
      if (!lines[q].length) continue;
      scores[q] += lines[q].length * wave;
      events.push({ type: 'scored', player: q, points: lines[q].length * wave, wave, total: scores[q] });
    }
    const shattered = [...cleared].sort((a, b) => a - b);
    shattered.forEach((c) => (cells[c] = null));
    events.push({ type: 'shattered', cells: shattered, wave });
    const fell = settle(cells);
    if (fell.length) events.push({ type: 'fell', moves: fell, wave });
  }

  let result: CascadeState['result'] = null;
  if (Math.max(scores[0], scores[1]) >= TARGET) {
    const o = other(p);
    result = { winner: scores[o] > scores[p] ? o : p };
    events.push({ type: 'roundOver', winner: result.winner });
  }
  return { state: { mode: 'cascade', cells, turn: other(p), turns: s.turns + 1, scores, result }, events };
}
