// Rotating mode (Twist): each turn, place a mark or twist one layer. The center is the
// sealed Core. Each player keeps at most 3 marks: placing a fourth first fades the
// oldest. First to complete a line wins; if a turn completes lines for both players,
// the mover wins. No line after 40 turns is a draw.

import { CELLS, CENTER, LINES, other, type Cell, type Line, type Player } from './geometry.ts';
import { IllegalMove, type GameEvent, type IllegalReason } from './events.ts';
import { TWISTS, applyTwist, inverse, permutation, sameTwist, type Twist } from './twist.ts';

export const MAX_MARKS = 3;
export const DRAW_TURNS = 40;

export type RoundResult = { winner: Player; line: Line } | { winner: null };

export interface RotatingState {
  mode: 'rotating';
  cells: Cell[];
  /** Each player's marks, oldest first. */
  marks: [number[], number[]];
  /** Whose turn it is. */
  turn: Player;
  /** Turns played so far this round. */
  turns: number;
  /** The twist made on the previous turn, if that turn was a twist. */
  lastTwist: Twist | null;
  /** Whether each player's own previous turn was a twist. */
  twistedLast: [boolean, boolean];
  result: RoundResult | null;
}

export type RotatingMove = { kind: 'place'; cell: number } | { kind: 'twist'; twist: Twist };

export function newRotating(first: Player): RotatingState {
  return {
    mode: 'rotating',
    cells: Array(CELLS).fill(null),
    marks: [[], []],
    turn: first,
    turns: 0,
    lastTwist: null,
    twistedLast: [false, false],
    result: null,
  };
}

/** Why `move` is not allowed now, or null if it is. */
export function checkRotating(s: RotatingState, move: RotatingMove): IllegalReason | null {
  if (s.result) return 'round-over';
  if (move.kind === 'place') {
    const c = move.cell;
    if (!Number.isInteger(c) || c < 0 || c >= CELLS) return 'not-a-cell';
    if (c === CENTER) return 'core';
    if (s.cells[c] !== null) return 'occupied';
    return null;
  }
  if (!TWISTS.some((t) => sameTwist(t, move.twist))) return 'not-a-twist';
  if (s.twistedLast[s.turn]) return 'twisted-last-turn';
  if (s.lastTwist && sameTwist(move.twist, inverse(s.lastTwist))) return 'undoes-last-twist';
  return null;
}

export function legalRotating(s: RotatingState): RotatingMove[] {
  if (s.result) return [];
  const out: RotatingMove[] = [];
  for (let c = 0; c < CELLS; c++) if (checkRotating(s, { kind: 'place', cell: c }) === null) out.push({ kind: 'place', cell: c });
  for (const twist of TWISTS) if (checkRotating(s, { kind: 'twist', twist }) === null) out.push({ kind: 'twist', twist });
  return out;
}

/** Who wins with this board after `mover`'s turn: the mover first, then the opponent. */
export function roundWinner(cells: readonly Cell[], mover: Player): RoundResult | null {
  for (const p of [mover, other(mover)]) {
    const line = LINES.find(([a, b, c]) => cells[a] === p && cells[b] === p && cells[c] === p);
    if (line) return { winner: p, line };
  }
  return null;
}

export function applyRotating(s: RotatingState, move: RotatingMove): { state: RotatingState; events: GameEvent[] } {
  const why = checkRotating(s, move);
  if (why) throw new IllegalMove(why);
  const p = s.turn;
  const events: GameEvent[] = [];
  let cells = s.cells.slice();
  let marks: [number[], number[]] = [s.marks[0].slice(), s.marks[1].slice()];

  if (move.kind === 'place') {
    if (marks[p].length >= MAX_MARKS) {
      const old = marks[p].shift()!;
      cells[old] = null;
      events.push({ type: 'faded', player: p, cell: old });
    }
    cells[move.cell] = p;
    marks[p].push(move.cell);
    events.push({ type: 'placed', player: p, cell: move.cell });
    if (marks[p].length === MAX_MARKS) events.push({ type: 'cracking', player: p, cell: marks[p][0] });
  } else {
    const perm = permutation(move.twist);
    const moves = cells.flatMap((c, from) => (c !== null && perm[from] !== from ? [{ from, to: perm[from] }] : []));
    cells = applyTwist(cells, move.twist);
    marks = [marks[0].map((c) => perm[c]), marks[1].map((c) => perm[c])];
    events.push({ type: 'twisted', twist: { ...move.twist }, moves, player: p });
  }

  const turns = s.turns + 1;
  const twisted = move.kind === 'twist';
  let result = roundWinner(cells, p);
  if (!result && turns >= DRAW_TURNS) result = { winner: null };
  if (result) events.push(result.winner === null ? { type: 'roundOver', winner: null } : { type: 'roundOver', winner: result.winner, line: result.line });

  const twistedLast: [boolean, boolean] = [s.twistedLast[0], s.twistedLast[1]];
  twistedLast[p] = twisted;
  return {
    state: {
      mode: 'rotating',
      cells,
      marks,
      turn: other(p),
      turns,
      lastTwist: twisted ? { ...move.twist } : null,
      twistedLast,
      result,
    },
    events,
  };
}
