// A match: best of 3 rounds in one mode. The starting player alternates every round
// (drawn rounds included), and a drawn round counts for nobody and is replayed.

import { other, type Player } from './geometry.ts';
import { IllegalMove, type GameEvent, type IllegalReason } from './events.ts';
import { applyRotating, checkRotating, legalRotating, newRotating, type RotatingMove, type RotatingState } from './rotating.ts';
import { applyCascade, checkCascade, legalCascade, newCascade, type CascadeMove, type CascadeState } from './cascade.ts';
import { pick } from './rng.ts';

export type Mode = 'rotating' | 'cascade';
export type Round = RotatingState | CascadeState;
export type Move = RotatingMove | CascadeMove;

export const WINS_NEEDED = 2;

export interface MatchState {
  mode: Mode;
  round: Round;
  /** 1-based; every round counts, draws included. */
  roundNumber: number;
  /** Who started the current round. */
  starter: Player;
  wins: [number, number];
  /** The match winner, once someone reaches 2 round wins. */
  winner: Player | null;
}

const freshRound = (mode: Mode, starter: Player): Round => (mode === 'rotating' ? newRotating(starter) : newCascade(starter));

export function newMatch(mode: Mode, starter: Player = 0): MatchState {
  return { mode, round: freshRound(mode, starter), roundNumber: 1, starter, wins: [0, 0], winner: null };
}

export function checkMove(m: MatchState, move: Move): IllegalReason | null {
  if (m.winner !== null) return 'match-over';
  if (m.round.mode === 'rotating') return move.kind === 'drop' ? 'wrong-mode' : checkRotating(m.round, move);
  return move.kind !== 'drop' ? 'wrong-mode' : checkCascade(m.round, move);
}

export function legalMoves(m: MatchState): Move[] {
  if (m.winner !== null) return [];
  return m.round.mode === 'rotating' ? legalRotating(m.round) : legalCascade(m.round);
}

/** A random legal move (for the online turn timer). */
export function randomMove(m: MatchState, random: () => number): Move {
  return pick(legalMoves(m), random);
}

export function applyMove(m: MatchState, move: Move): { state: MatchState; events: GameEvent[] } {
  const why = checkMove(m, move);
  if (why) throw new IllegalMove(why);
  const out = m.round.mode === 'rotating' ? applyRotating(m.round, move as RotatingMove) : applyCascade(m.round, move as CascadeMove);
  const state: MatchState = { ...m, round: out.state, wins: [m.wins[0], m.wins[1]] };
  const events = out.events.slice();
  const result = out.state.result;
  if (result) {
    if (result.winner !== null) state.wins[result.winner]++;
    events.push({ type: 'roundWon', winner: result.winner, round: m.roundNumber, wins: [state.wins[0], state.wins[1]] });
    if (result.winner !== null && state.wins[result.winner] >= WINS_NEEDED) {
      state.winner = result.winner;
      events.push({ type: 'matchWon', winner: result.winner, wins: [state.wins[0], state.wins[1]] });
    }
  }
  return { state, events };
}

/** Start the next round, with the other player starting. */
export function nextRound(m: MatchState): MatchState {
  if (m.winner !== null) throw new IllegalMove('match-over');
  if (!m.round.result) throw new Error('the current round is still being played');
  const starter = other(m.starter);
  return { ...m, round: freshRound(m.mode, starter), roundNumber: m.roundNumber + 1, starter };
}
