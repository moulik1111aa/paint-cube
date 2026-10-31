// What the rules engine reports after each move. The renderer, sound and HUD only
// react to these; they never decide anything themselves. Plain JSON, so the host
// can publish them to the guest unchanged.

import type { Line, Player } from './geometry.ts';
import type { Twist } from './twist.ts';

export type GameEvent =
  /** A mark landed in a cell (a drop in stacking mode reports its landing cell). */
  | { type: 'placed'; player: Player; cell: number; column?: number }
  /** A player's oldest mark is now the next to fade (they have the maximum). */
  | { type: 'cracking'; player: Player; cell: number }
  /** A player's oldest mark faded away, before their new mark landed. */
  | { type: 'faded'; player: Player; cell: number }
  /** A layer turned; `moves` lists the marks that moved with it. */
  | { type: 'twisted'; twist: Twist; moves: { from: number; to: number }[] }
  /** A completed line. In stacking mode `wave` is the cascade wave (1, 2, ...). */
  | { type: 'lineCompleted'; player: Player; cells: Line; wave: number }
  /** These cells' paint shattered and cleared (stacking mode). */
  | { type: 'shattered'; cells: number[]; wave: number }
  /** Pieces fell down their columns after a clear (stacking mode). */
  | { type: 'fell'; moves: { from: number; to: number; player: Player }[]; wave: number }
  /** Points scored in one wave (stacking mode); `total` is the new score. */
  | { type: 'scored'; player: Player; points: number; wave: number; total: number }
  /** The round ended: a winner, or `null` for a draw. */
  | { type: 'roundOver'; winner: Player | null; line?: Line }
  /** Match level: a round result was counted. */
  | { type: 'roundWon'; winner: Player | null; round: number; wins: [number, number] }
  | { type: 'matchWon'; winner: Player; wins: [number, number] };

/** Why a move was refused. */
export type IllegalReason =
  | 'round-over'
  | 'not-a-cell'
  | 'not-a-twist'
  | 'occupied'
  | 'core'
  | 'twisted-last-turn'
  | 'undoes-last-twist'
  | 'not-a-column'
  | 'column-full'
  | 'wrong-mode'
  | 'match-over';

export class IllegalMove extends Error {
  readonly reason: IllegalReason;
  constructor(reason: IllegalReason) {
    super(`illegal move: ${reason}`);
    this.reason = reason;
  }
}
